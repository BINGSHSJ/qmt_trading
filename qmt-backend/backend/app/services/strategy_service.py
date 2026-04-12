"""
策略生命周期管理 Service

核心职责：
  - 策略注册 / 查询 / 启动 / 停止
  - 心跳文件读取 → runtime_state 更新
  - pending_restart 状态处理
  - start_script / stop_script / working_dir / env_overrides 契约

第2批收口：
  - 非 mock 模式真实执行 start_script / stop_script
  - env_overrides 注入子进程环境
  - stdout/stderr 落盘到 runtime/logs/strategy_{id}.log
  - 脚本返回码契约：0 成功，非 0 失败
  - 优雅停止 → 超时强制终止

第3批收口：
  - stop_script 异常 → StrategyStopError(6003)
  - 启动前依赖校验：脚本存在、working_dir 有效
  - start/stop 关键节点写 system_log 含耗时
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import signal
import subprocess
import sys
import time as _time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_env_settings, get_runtime_dir, yaml_get, BASE_DIR
from app.core.enums import StrategyStatus
from app.core.exceptions import (
    NotFound, StateConflict, ParamMissing, ParamInvalid,
    StrategyStartError, StrategyStopError,
)
from app.models.tables import Strategy, StrategyRuntimeState, SystemLog
from app.repositories.strategy_repo import StrategyRepository, RuntimeStateRepository
from app.services.audit_service import write_audit
from app.api.ws import ws_manager

logger = logging.getLogger("strategy_service")


def _get_heartbeat_timeout() -> int:
    """从配置获取心跳超时阈值（秒），默认 120"""
    return yaml_get("strategy", "heartbeat_timeout_sec", default=120)

# 可启动的状态集合
_STARTABLE = {
    StrategyStatus.REGISTERED.value,
    StrategyStatus.STOPPED.value,
    StrategyStatus.ERROR.value,
    StrategyStatus.PAUSED.value,
    StrategyStatus.PENDING_RESTART.value,
}

# 可停止的状态集合
_STOPPABLE = {
    StrategyStatus.RUNNING.value,
    StrategyStatus.LOADED.value,
    StrategyStatus.PAUSED.value,
    StrategyStatus.PENDING_RESTART.value,
    StrategyStatus.ERROR.value,
}

# env_overrides 白名单前缀（只允许这些前缀的环境变量被注入）
_ENV_WHITELIST_PREFIXES = (
    "QMT_", "STRATEGY_", "PYTHONPATH", "PATH",
    "LOG_LEVEL", "CONFIG_", "DATA_DIR",
)


def _is_env_key_allowed(key: str) -> bool:
    """检查环境变量 key 是否在白名单中"""
    upper = key.upper()
    return any(upper.startswith(p) for p in _ENV_WHITELIST_PREFIXES)


def _get_strategy_log_path(strategy_id: str) -> Path:
    """获取策略进程日志路径 runtime/logs/strategy_{id}.log"""
    log_dir = get_runtime_dir("log")
    return log_dir / f"strategy_{strategy_id}.log"


class StrategyService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.strategy_repo = StrategyRepository(session)
        self.runtime_repo = RuntimeStateRepository(session)

    # ── 注册策略 ───────────────────────────────────────
    async def register(
        self,
        strategy_id: str,
        name: str,
        description: str = "",
        source_type: str = "strategy",
        config_json: str = "{}",
        start_script: str = "",
        stop_script: str = "",
        working_dir: str = "",
        env_overrides: dict | None = None,
    ) -> dict[str, Any]:
        if not strategy_id or not name:
            raise ParamMissing("strategy_id 和 name 为必填")

        if await self.strategy_repo.exists(strategy_id):
            raise StateConflict(f"策略 {strategy_id} 已存在")

        env_json = json.dumps(env_overrides or {}, ensure_ascii=False)

        entity = Strategy(
            strategy_id=strategy_id,
            name=name,
            description=description,
            source_type=source_type,
            config_json=config_json,
            start_script=start_script,
            stop_script=stop_script,
            working_dir=working_dir,
            env_overrides=env_json,
            status=StrategyStatus.REGISTERED.value,
        )
        await self.strategy_repo.insert(entity)

        # 同步创建 runtime_state 初始记录
        await self.runtime_repo.upsert(
            strategy_id,
            status=StrategyStatus.REGISTERED.value,
            pid=0,
            error_message="",
        )

        await write_audit(
            self.session, action="register", target_type="strategy",
            target_id=strategy_id,
            after={"name": name, "status": "registered",
                   "env_overrides": env_overrides or {}},
        )
        await self.session.commit()
        logger.info("策略注册: %s (%s)", strategy_id, name)
        return self._strategy_to_dict(entity)

    # ── 查询策略列表 ──────────────────────────────────
    async def list_strategies(self, offset: int = 0, limit: int = 100) -> list[dict[str, Any]]:
        strategies = await self.strategy_repo.list_all(offset=offset, limit=limit)
        result = []
        for s in strategies:
            d = self._strategy_to_dict(s)
            rt = await self.runtime_repo.get_by_strategy_id(s.strategy_id)
            if rt:
                d["runtime"] = self._runtime_to_dict(rt)
            result.append(d)
        return result

    # ── 查询策略详情 ──────────────────────────────────
    async def get_detail(self, strategy_id: str) -> dict[str, Any]:
        entity = await self._must_get(strategy_id)
        d = self._strategy_to_dict(entity)
        rt = await self.runtime_repo.get_by_strategy_id(strategy_id)
        if rt:
            d["runtime"] = self._runtime_to_dict(rt)
        # 附加心跳文件信息
        hb = self._read_heartbeat_file(strategy_id)
        if hb:
            d["heartbeat"] = hb
        return d

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # 启动策略
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    async def start(self, strategy_id: str) -> dict[str, Any]:
        entity = await self._must_get(strategy_id)

        if entity.status not in _STARTABLE:
            raise StateConflict(
                f"策略 {strategy_id} 当前状态 {entity.status}，不可启动"
            )

        settings = get_env_settings()
        old_status = entity.status

        if settings.mock_mode:
            return await self._start_mock(entity, old_status)
        else:
            return await self._start_real(entity, old_status)

    async def _start_mock(self, entity: Strategy, old_status: str) -> dict[str, Any]:
        """Mock 模式：直接模拟启动成功"""
        strategy_id = entity.strategy_id
        new_status = StrategyStatus.RUNNING.value
        mock_pid = 99999
        logger.info("Mock 启动策略: %s", strategy_id)
        self._write_mock_heartbeat(strategy_id, mock_pid)

        await self.strategy_repo.update_status(strategy_id, new_status)
        await self.runtime_repo.upsert(
            strategy_id,
            status=new_status,
            pid=mock_pid,
            last_heartbeat_time=datetime.now(),
            error_message="",
        )
        await write_audit(
            self.session, action="start", target_type="strategy",
            target_id=strategy_id,
            before={"status": old_status},
            after={"status": new_status, "pid": mock_pid, "mode": "mock"},
        )
        await self._write_system_log(
            module="strategy_service",
            level="INFO",
            message=f"策略 {strategy_id} 启动成功, PID={mock_pid}, mode=mock",
        )
        await self.session.commit()
        return {"strategy_id": strategy_id, "status": new_status, "pid": mock_pid}

    async def _start_real(self, entity: Strategy, old_status: str) -> dict[str, Any]:
        """非 mock：真实执行 start_script 子进程"""
        strategy_id = entity.strategy_id
        t0 = _time.monotonic()
        settings = get_env_settings()

        # 1. 校验 start_script
        if not entity.start_script:
            raise StrategyStartError(f"策略 {strategy_id} 未配置 start_script")

        # 2. 解析 working_dir 并校验
        cwd = self._resolve_working_dir(entity.working_dir)
        if not cwd.exists() or not cwd.is_dir():
            raise ParamInvalid(
                f"策略 {strategy_id} working_dir 无效: {cwd} 不存在或非目录"
            )

        # 3. 校验脚本可运行性（提取首个可执行文件）
        self._validate_script_runnable(entity.start_script, cwd)

        # 4. 构建进程环境变量
        proc_env = self._build_process_env(entity.env_overrides, strategy_id)

        # 5. 准备日志文件
        log_path = _get_strategy_log_path(strategy_id)

        # 6. 启动子进程
        try:
            log_file = open(log_path, "a", encoding="utf-8")
            log_file.write(f"\n{'='*60}\n")
            log_file.write(f"[{datetime.now().isoformat(timespec='seconds')}] "
                           f"START: {entity.start_script}\n")
            log_file.write(f"CWD: {cwd}\n")
            log_file.write(f"{'='*60}\n")
            log_file.flush()

            # 使用 shell 模式运行脚本
            proc = subprocess.Popen(
                entity.start_script,
                shell=True,
                cwd=str(cwd),
                env=proc_env,
                stdout=log_file,
                stderr=subprocess.STDOUT,
                creationflags=(subprocess.CREATE_NEW_PROCESS_GROUP
                               if sys.platform == "win32" else 0),
            )
        except OSError as e:
            error_msg = f"启动脚本执行失败: {e}"
            logger.error("策略 %s 启动失败: %s", strategy_id, e)
            await self._write_system_log(
                module="strategy_service",
                level="ERROR",
                message=f"策略 {strategy_id} 启动失败: {e}",
                detail=str(e),
            )
            await ws_manager.broadcast("strategy_error", {
                "strategy_id": strategy_id, "action": "start", "message": error_msg,
            })
            raise StrategyStartError(error_msg)

        pid = proc.pid

        # 7. 短时间健康探测
        probe_sec = yaml_get("strategy", "start_probe_sec", default=2)
        await asyncio.sleep(probe_sec)

        exit_code = proc.poll()
        if exit_code is not None:
            # 进程已退出 — 启动失败
            try:
                remaining = log_path.read_text(encoding="utf-8")[-2000:]
            except Exception:
                remaining = ""
            error_msg = (f"启动脚本在 {probe_sec}s 内退出, "
                         f"exit_code={exit_code}")
            logger.error("策略 %s %s", strategy_id, error_msg)

            # 标记 error 状态
            await self.strategy_repo.update_status(strategy_id, StrategyStatus.ERROR.value)
            await self.runtime_repo.upsert(
                strategy_id,
                status=StrategyStatus.ERROR.value,
                pid=0,
                error_message=error_msg,
            )
            await write_audit(
                self.session, action="start_failed", target_type="strategy",
                target_id=strategy_id,
                before={"status": old_status},
                after={"status": "error", "exit_code": exit_code},
                remark=error_msg,
            )
            await self._write_system_log(
                module="strategy_service",
                level="ERROR",
                message=f"策略 {strategy_id} 启动脚本退出 code={exit_code}",
                detail=remaining[-500:],
            )
            await self.session.commit()
            await ws_manager.broadcast("strategy_error", {
                "strategy_id": strategy_id, "action": "start",
                "message": error_msg, "exit_code": exit_code,
            })
            raise StrategyStartError(error_msg)

        # 8. 启动成功 — 更新状态
        new_status = StrategyStatus.RUNNING.value
        elapsed_ms = int((_time.monotonic() - t0) * 1000)
        await self.strategy_repo.update_status(strategy_id, new_status)
        await self.runtime_repo.upsert(
            strategy_id,
            status=new_status,
            pid=pid,
            last_heartbeat_time=datetime.now(),
            error_message="",
        )
        await write_audit(
            self.session, action="start", target_type="strategy",
            target_id=strategy_id,
            before={"status": old_status},
            after={"status": new_status, "pid": pid, "mode": "real"},
        )
        await self._write_system_log(
            module="strategy_service",
            level="INFO",
            message=f"策略 {strategy_id} 启动成功, PID={pid}, 耗时={elapsed_ms}ms, mode=real",
            detail=f"script={entity.start_script}, cwd={cwd}",
        )
        await self.session.commit()

        logger.info("策略 %s 启动成功, PID=%d, 耗时=%dms", strategy_id, pid, elapsed_ms)
        return {"strategy_id": strategy_id, "status": new_status, "pid": pid}

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # 停止策略
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    async def stop(self, strategy_id: str) -> dict[str, Any]:
        entity = await self._must_get(strategy_id)

        if entity.status not in _STOPPABLE:
            raise StateConflict(
                f"策略 {strategy_id} 当前状态 {entity.status}，不可停止"
            )

        settings = get_env_settings()
        old_status = entity.status

        if settings.mock_mode:
            return await self._stop_mock(entity, old_status)
        else:
            return await self._stop_real(entity, old_status)

    async def _stop_mock(self, entity: Strategy, old_status: str) -> dict[str, Any]:
        """Mock 模式停止"""
        strategy_id = entity.strategy_id
        logger.info("Mock 停止策略: %s", strategy_id)
        self._remove_heartbeat_file(strategy_id)

        new_status = StrategyStatus.STOPPED.value
        await self.strategy_repo.update_status(strategy_id, new_status)
        await self.runtime_repo.upsert(
            strategy_id, status=new_status, pid=0, error_message="",
        )
        await write_audit(
            self.session, action="stop", target_type="strategy",
            target_id=strategy_id,
            before={"status": old_status},
            after={"status": new_status, "mode": "mock"},
        )
        await self._write_system_log(
            module="strategy_service",
            level="INFO",
            message=f"策略 {strategy_id} 停止成功, mode=mock",
        )
        await self.session.commit()
        return {"strategy_id": strategy_id, "status": new_status}

    async def _stop_real(self, entity: Strategy, old_status: str) -> dict[str, Any]:
        """非 mock：真实停止策略进程"""
        strategy_id = entity.strategy_id
        t0 = _time.monotonic()
        timeout_sec = yaml_get("strategy", "stop_timeout_sec", default=30)

        # 获取当前 PID
        rt = await self.runtime_repo.get_by_strategy_id(strategy_id)
        current_pid = rt.pid if rt else 0

        log_path = _get_strategy_log_path(strategy_id)
        force_killed = False
        error_msg = ""

        try:
            log_file = open(log_path, "a", encoding="utf-8")
            log_file.write(f"\n[{datetime.now().isoformat(timespec='seconds')}] "
                           f"STOP: strategy={strategy_id}, pid={current_pid}\n")
            log_file.flush()
        except OSError:
            log_file = None

        # 方式 1: 有 stop_script → 执行它
        if entity.stop_script:
            cwd = self._resolve_working_dir(entity.working_dir)
            proc_env = self._build_process_env(entity.env_overrides, strategy_id)
            try:
                result = subprocess.run(
                    entity.stop_script,
                    shell=True,
                    cwd=str(cwd),
                    env=proc_env,
                    capture_output=True,
                    text=True,
                    timeout=timeout_sec,
                )
                if log_file:
                    log_file.write(f"stop_script stdout: {result.stdout}\n")
                    log_file.write(f"stop_script stderr: {result.stderr}\n")
                    log_file.write(f"stop_script exit_code: {result.returncode}\n")
                    log_file.flush()
                if result.returncode != 0:
                    error_msg = (f"stop_script 退出码 {result.returncode}: "
                                 f"{result.stderr[:200]}")
                    logger.warning("策略 %s stop_script 非0退出: %d",
                                   strategy_id, result.returncode)
            except subprocess.TimeoutExpired:
                error_msg = f"stop_script 执行超时 ({timeout_sec}s)"
                logger.warning("策略 %s stop_script 超时", strategy_id)
            except OSError as e:
                error_msg = f"stop_script 执行失败: {e}"
                logger.error("策略 %s stop_script 失败: %s", strategy_id, e)

        # 方式 2: 有 PID → 发送终止信号
        if current_pid > 0:
            process_alive = self._is_process_alive(current_pid)
            if process_alive:
                # 优雅终止
                try:
                    if sys.platform == "win32":
                        os.kill(current_pid, signal.CTRL_BREAK_EVENT)
                    else:
                        os.kill(current_pid, signal.SIGTERM)
                except OSError:
                    pass

                # 等待进程退出
                waited = 0
                poll_interval = 0.5
                while waited < timeout_sec:
                    if not self._is_process_alive(current_pid):
                        break
                    await asyncio.sleep(poll_interval)
                    waited += poll_interval

                # 超时后强制终止
                if self._is_process_alive(current_pid):
                    logger.warning("策略 %s PID=%d 优雅停止超时, 强制终止",
                                   strategy_id, current_pid)
                    try:
                        if sys.platform == "win32":
                            subprocess.run(
                                ["taskkill", "/F", "/PID", str(current_pid)],
                                capture_output=True, timeout=10,
                            )
                        else:
                            os.kill(current_pid, signal.SIGKILL)
                    except Exception as e:
                        logger.error("强制终止失败 PID=%d: %s", current_pid, e)

                    force_killed = True
                    if not error_msg:
                        error_msg = f"进程 PID={current_pid} 优雅停止超时, 已强制终止"

                    if log_file:
                        log_file.write(f"[FORCE KILL] PID={current_pid}\n")
                        log_file.flush()

        if log_file:
            log_file.write(f"[{datetime.now().isoformat(timespec='seconds')}] "
                           f"STOPPED (force={force_killed})\n")
            log_file.close()

        # 更新状态
        elapsed_ms = int((_time.monotonic() - t0) * 1000)
        new_status = StrategyStatus.STOPPED.value
        await self.strategy_repo.update_status(strategy_id, new_status)
        await self.runtime_repo.upsert(
            strategy_id,
            status=new_status,
            pid=0,
            error_message=error_msg,
        )

        audit_remark = ""
        if force_killed:
            audit_remark = "进程超时被强制终止"
        await write_audit(
            self.session, action="stop", target_type="strategy",
            target_id=strategy_id,
            before={"status": old_status, "pid": current_pid},
            after={"status": new_status, "force_killed": force_killed},
            remark=audit_remark,
        )
        log_level = "WARNING" if (force_killed or error_msg) else "INFO"
        await self._write_system_log(
            module="strategy_service",
            level=log_level,
            message=(f"策略 {strategy_id} 停止{'(强制)' if force_killed else ''}完成"
                     f", PID={current_pid}, 耗时={elapsed_ms}ms, mode=real"),
            detail=error_msg,
        )
        await self.session.commit()

        self._remove_heartbeat_file(strategy_id)

        logger.info("策略 %s 停止完成 (force=%s, 耗时=%dms)", strategy_id, force_killed, elapsed_ms)

        # 第3批收口：stop_script 异常时抛出 StrategyStopError(6003)
        if error_msg:
            await ws_manager.broadcast("strategy_error", {
                "strategy_id": strategy_id, "action": "stop", "message": error_msg,
            })
            raise StrategyStopError(error_msg)

        return {
            "strategy_id": strategy_id,
            "status": new_status,
            "force_killed": force_killed,
            "error_message": error_msg,
        }

    # ── 一键暂停全部策略 ─────────────────────────────
    async def pause_all(self, operator: str = "system") -> list[dict[str, Any]]:
        """停止所有 running/loaded/paused/pending_restart 状态的策略"""
        strategies = await self.strategy_repo.list_all(limit=1000, order_desc=False)
        stopped: list[dict[str, Any]] = []

        for s in strategies:
            if s.status not in _STOPPABLE:
                continue
            try:
                result = await self.stop(s.strategy_id)
                stopped.append(result)
            except Exception as e:
                logger.error("pause_all: 停止策略 %s 失败: %s", s.strategy_id, e)
                stopped.append({
                    "strategy_id": s.strategy_id,
                    "status": "error",
                    "error_message": str(e),
                })

        return stopped

    # ── 心跳扫描：读取心跳文件更新 runtime_state ──────
    async def scan_heartbeats(self) -> list[dict[str, Any]]:
        """
        扫描所有 running 状态的策略心跳文件，更新 runtime_state。
        返回状态发生变化的策略列表。
        """
        strategies = await self.strategy_repo.list_all(limit=1000, order_desc=False)
        changed: list[dict[str, Any]] = []

        for s in strategies:
            if s.status not in (
                StrategyStatus.RUNNING.value,
                StrategyStatus.PENDING_RESTART.value,
            ):
                continue

            hb = self._read_heartbeat_file(s.strategy_id)
            rt = await self.runtime_repo.get_by_strategy_id(s.strategy_id)

            if hb and hb.get("status") == "running":
                # 心跳正常
                last_hb_str = hb.get("last_heartbeat_time", "")
                try:
                    last_hb = datetime.fromisoformat(last_hb_str)
                except (ValueError, TypeError):
                    last_hb = None

                if last_hb and (datetime.now() - last_hb).total_seconds() > _get_heartbeat_timeout():
                    # 心跳超时
                    await self._mark_heartbeat_timeout(s, rt, last_hb_str)
                    changed.append({"strategy_id": s.strategy_id, "event": "heartbeat_timeout"})
                else:
                    # 正常更新
                    await self.runtime_repo.upsert(
                        s.strategy_id,
                        status=StrategyStatus.RUNNING.value,
                        pid=hb.get("pid", 0),
                        last_heartbeat_time=last_hb or datetime.now(),
                        last_signal_time=self._parse_dt(hb.get("last_signal_time")),
                        error_message="",
                    )
            else:
                # 心跳文件不存在或状态异常
                if s.status == StrategyStatus.RUNNING.value:
                    await self._mark_heartbeat_timeout(s, rt, "无心跳文件")
                    changed.append({"strategy_id": s.strategy_id, "event": "no_heartbeat_file"})

        if changed:
            await self.session.commit()

        return changed

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # 进程工具方法
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    @staticmethod
    def _validate_script_runnable(script_cmd: str, cwd: Path) -> None:
        """校验脚本可运行性（提取首个可执行文件，检查存在性）

        在 Windows 下用 shutil.which 检查 PATH 可找到性；
        对带引号的绝对路径直接检查文件是否存在。
        """
        cmd = script_cmd.strip()
        if not cmd:
            raise StrategyStartError("start_script 为空")

        # 提取首个 token（处理引号）
        if cmd.startswith('"'):
            end = cmd.find('"', 1)
            exe = cmd[1:end] if end > 0 else cmd[1:]
        elif cmd.startswith("'"):
            end = cmd.find("'", 1)
            exe = cmd[1:end] if end > 0 else cmd[1:]
        else:
            exe = cmd.split()[0]

        # 检查可执行文件
        exe_path = Path(exe)
        if exe_path.is_absolute():
            if not exe_path.exists():
                raise ParamInvalid(f"start_script 可执行文件不存在: {exe}")
        else:
            # 尝试在 cwd 或 PATH 中查找
            if (cwd / exe).exists():
                pass  # OK
            elif shutil.which(exe) is not None:
                pass  # OK
            else:
                raise ParamInvalid(f"start_script 可执行文件未找到: {exe}")

    def _resolve_working_dir(self, working_dir: str) -> Path:
        """解析 working_dir，为空时使用 backend/ 根目录"""
        if working_dir:
            p = Path(working_dir)
            if not p.is_absolute():
                p = BASE_DIR / p
            return p
        return BASE_DIR

    def _build_process_env(self, env_overrides_json: str, strategy_id: str) -> dict[str, str]:
        """构建子进程环境变量：系统环境 + 白名单过滤的 env_overrides"""
        env = os.environ.copy()
        # 注入策略标识
        env["QMT_STRATEGY_ID"] = strategy_id

        try:
            overrides = json.loads(env_overrides_json) if env_overrides_json else {}
        except (json.JSONDecodeError, TypeError):
            overrides = {}

        for key, value in overrides.items():
            if _is_env_key_allowed(key):
                env[key] = str(value)
            else:
                logger.warning("env_overrides 中的 %s 不在白名单, 已忽略", key)

        return env

    @staticmethod
    def _is_process_alive(pid: int) -> bool:
        """检查进程是否存活"""
        if pid <= 0:
            return False
        try:
            if sys.platform == "win32":
                # Windows: 尝试 OpenProcess
                import ctypes
                kernel32 = ctypes.windll.kernel32
                handle = kernel32.OpenProcess(0x0400, False, pid)  # PROCESS_QUERY_INFORMATION
                if handle:
                    exit_code = ctypes.c_ulong()
                    kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code))
                    kernel32.CloseHandle(handle)
                    return exit_code.value == 259  # STILL_ACTIVE
                return False
            else:
                os.kill(pid, 0)
                return True
        except (OSError, PermissionError):
            return False

    async def _write_system_log(
        self, module: str, level: str, message: str, detail: str = "",
    ) -> None:
        """写入 system_log 表"""
        entry = SystemLog(
            module=module,
            level=level,
            message=message,
            detail=detail,
        )
        self.session.add(entry)
        await self.session.flush()

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # 内部方法（未变化）
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    async def _must_get(self, strategy_id: str) -> Strategy:
        entity = await self.strategy_repo.get_by_strategy_id(strategy_id)
        if entity is None:
            raise NotFound(f"策略 {strategy_id} 不存在")
        return entity

    async def _mark_heartbeat_timeout(
        self, strategy: Strategy, rt: StrategyRuntimeState | None, detail: str
    ) -> None:
        """心跳超时 → 标记 error 状态"""
        new_status = StrategyStatus.ERROR.value
        msg = f"心跳超时: {detail}"
        logger.warning("策略 %s 心跳超时: %s", strategy.strategy_id, detail)
        await self.strategy_repo.update_status(strategy.strategy_id, new_status)
        await self.runtime_repo.upsert(
            strategy.strategy_id,
            status=new_status,
            error_message=msg,
        )
        await ws_manager.broadcast("strategy_error", {
            "strategy_id": strategy.strategy_id,
            "action": "heartbeat_timeout",
            "message": msg,
        })

    def _read_heartbeat_file(self, strategy_id: str) -> dict[str, Any] | None:
        """读取 runtime/heartbeat/{strategy_id}.json"""
        hb_dir = get_runtime_dir("heartbeat")
        hb_file = hb_dir / f"{strategy_id}.json"
        if not hb_file.exists():
            return None
        try:
            with open(hb_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError) as e:
            logger.warning("读取心跳文件失败 %s: %s", hb_file, e)
            return None

    def _write_mock_heartbeat(self, strategy_id: str, pid: int) -> None:
        """Mock 模式写入模拟心跳文件"""
        hb_dir = get_runtime_dir("heartbeat")
        hb_file = hb_dir / f"{strategy_id}.json"
        now = datetime.now().isoformat(timespec="seconds")
        data = {
            "strategy_id": strategy_id,
            "pid": pid,
            "status": "running",
            "last_signal_time": now,
            "last_heartbeat_time": now,
            "error": None,
        }
        with open(hb_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def _remove_heartbeat_file(self, strategy_id: str) -> None:
        hb_dir = get_runtime_dir("heartbeat")
        hb_file = hb_dir / f"{strategy_id}.json"
        if hb_file.exists():
            hb_file.unlink()

    @staticmethod
    def _parse_dt(value: str | None) -> datetime | None:
        if not value:
            return None
        try:
            return datetime.fromisoformat(value)
        except (ValueError, TypeError):
            return None

    @staticmethod
    def _strategy_to_dict(s: Strategy) -> dict[str, Any]:
        try:
            env_ov = json.loads(s.env_overrides) if s.env_overrides else {}
        except (json.JSONDecodeError, TypeError):
            env_ov = {}

        return {
            "id": s.id,
            "strategy_id": s.strategy_id,
            "name": s.name,
            "description": s.description,
            "status": s.status,
            "source_type": s.source_type,
            "config_json": s.config_json,
            "start_script": s.start_script,
            "stop_script": s.stop_script,
            "working_dir": s.working_dir,
            "env_overrides": env_ov,
            "created_at": s.created_at.isoformat(timespec="seconds") if s.created_at else "",
            "updated_at": s.updated_at.isoformat(timespec="seconds") if s.updated_at else "",
        }

    @staticmethod
    def _runtime_to_dict(rt: StrategyRuntimeState) -> dict[str, Any]:
        return {
            "strategy_id": rt.strategy_id,
            "pid": rt.pid,
            "status": rt.status,
            "last_heartbeat_time": rt.last_heartbeat_time.isoformat(timespec="seconds") if rt.last_heartbeat_time else None,
            "last_signal_time": rt.last_signal_time.isoformat(timespec="seconds") if rt.last_signal_time else None,
            "error_message": rt.error_message,
        }
