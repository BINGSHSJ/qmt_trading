"""
启动前检查清单 (Preflight Check)

应用启动时执行，验证所有必要条件：
  1. 配置完整性（.env + yaml）
  2. 数据库可连接 + WAL 模式
  3. 运行时目录可写
  4. Adapter 连接正常
  5. 磁盘空间充足

检查不通过会记录 WARNING 但 **不阻止启动**（降级运行）。
"""

from __future__ import annotations

import logging
import os
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.config import (
    BASE_DIR, get_env_settings, get_yaml_config,
    get_db_path, get_runtime_dir, yaml_get,
)
from app.adapters.factory import get_xtdata_adapter, get_xttrader_adapter

logger = logging.getLogger("preflight")


class CheckItem:
    def __init__(self, name: str, passed: bool, detail: str = "",
                 level: str = "warning"):
        self.name = name
        self.passed = passed
        self.detail = detail
        self.level = level  # "critical" | "warning"

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "passed": self.passed,
            "detail": self.detail,
            "level": self.level,
        }


async def run_preflight(conn: AsyncConnection) -> list[CheckItem]:
    """执行全部启动前检查，返回检查结果列表"""
    results: list[CheckItem] = []

    # ── 1. 配置完整性 ────────────────────────────────
    results.append(_check_env())
    results.append(_check_yaml())

    # ── 2. 数据库 ────────────────────────────────────
    results.append(await _check_database(conn))

    # ── 3. 运行时目录 ────────────────────────────────
    results.append(_check_runtime_dirs())

    # ── 4. Adapter 连接 ──────────────────────────────
    results.append(await _check_adapters())

    # ── 5. 磁盘空间 ──────────────────────────────────
    results.append(_check_disk_space())

    # ── 6. 时间同步 ──────────────────────────────────
    results.append(_check_time_sync())

    # 汇总日志
    passed = sum(1 for r in results if r.passed)
    total = len(results)
    for r in results:
        lvl = "✓" if r.passed else "✗"
        logger.info("Preflight %s %s: %s", lvl, r.name, r.detail)
    logger.info("Preflight 完成: %d/%d 通过", passed, total)

    return results


def _check_env() -> CheckItem:
    """检查 .env 关键配置 (warning 级)"""
    try:
        settings = get_env_settings()
        issues = []
        if settings.api_key in ("dev-api-key", "change-me", ""):
            issues.append("API_KEY 使用默认值（生产环境需修改）")
        if settings.secret_key == "change-me":
            issues.append("SECRET_KEY 使用默认值")
        if not settings.qmt_account_id:
            issues.append("QMT_ACCOUNT_ID 未配置")

        if issues:
            return CheckItem("环境变量", True, "警告: " + "; ".join(issues), level="warning")
        return CheckItem("环境变量", True, "配置完整", level="warning")
    except Exception as e:
        return CheckItem("环境变量", False, str(e), level="warning")


def _check_yaml() -> CheckItem:
    """检查 YAML 配置关键字段 (critical 级)"""
    try:
        cfg = get_yaml_config()
        required_sections = ["server", "database", "risk", "trading_calendar", "polling"]
        missing = [s for s in required_sections if s not in cfg]
        if missing:
            return CheckItem("YAML 配置", False, f"缺少配置段: {missing}", level="critical")
        return CheckItem("YAML 配置", True, "配置完整", level="critical")
    except Exception as e:
        return CheckItem("YAML 配置", False, str(e), level="critical")


async def _check_database(conn: AsyncConnection) -> CheckItem:
    """检查数据库连接 + WAL 模式"""
    try:
        result = await conn.execute(text("PRAGMA journal_mode;"))
        mode = result.scalar()
        if mode != "wal":
            return CheckItem("数据库", False, f"journal_mode={mode}，期望 wal", level="critical")

        result2 = await conn.execute(text("PRAGMA busy_timeout;"))
        timeout = result2.scalar()

        return CheckItem("数据库", True, f"WAL 模式, busy_timeout={timeout}ms", level="critical")
    except Exception as e:
        return CheckItem("数据库", False, str(e), level="critical")


def _check_runtime_dirs() -> CheckItem:
    """检查运行时目录可写"""
    try:
        dirs = ["heartbeat", "strategy_state", "logs", "backup"]
        results = []
        for sub in dirs:
            d = get_runtime_dir(sub)
            if d.exists() and os.access(str(d), os.W_OK):
                results.append(f"{sub}:OK")
            else:
                results.append(f"{sub}:MISSING")
        all_ok = all("OK" in r for r in results)
        return CheckItem("运行时目录", all_ok, ", ".join(results), level="critical")
    except Exception as e:
        return CheckItem("运行时目录", False, str(e), level="critical")


async def _check_adapters() -> CheckItem:
    """检查 Adapter 连接"""
    try:
        xtdata = get_xtdata_adapter()
        xttrader = get_xttrader_adapter()

        d_health = await xtdata.check_health()
        t_health = await xttrader.check_health()

        d_ok = d_health.get("connected", False)
        t_ok = t_health.get("connected", False)

        detail = f"xtdata={'OK' if d_ok else 'FAIL'}, xttrader={'OK' if t_ok else 'FAIL'}"
        return CheckItem("Adapter 连接", d_ok and t_ok, detail, level="warning")
    except Exception as e:
        return CheckItem("Adapter 连接", False, str(e), level="warning")


def _check_disk_space() -> CheckItem:
    """检查数据库所在磁盘空间"""
    try:
        db_path = get_db_path()
        usage = shutil.disk_usage(str(db_path.parent))
        free_mb = usage.free / (1024 * 1024)
        if free_mb < 100:
            return CheckItem("磁盘空间", False, f"剩余 {free_mb:.0f}MB (<100MB)", level="warning")
        return CheckItem("磁盘空间", True, f"剩余 {free_mb:.0f}MB", level="warning")
    except Exception as e:
        return CheckItem("磁盘空间", False, str(e), level="warning")


def _check_time_sync() -> CheckItem:
    """检查本地时间与 NTP 服务器偏差，>5s 告警"""
    import ntplib

    try:
        client = ntplib.NTPClient()
        resp = client.request("ntp.aliyun.com", timeout=3)
        offset = abs(resp.offset)
        if offset > 5:
            return CheckItem(
                "时间同步", False,
                f"本地时间偏差 {offset:.1f}s (>5s)，可能影响交易时间判断",
                level="warning",
            )
        return CheckItem("时间同步", True, f"偏差 {offset:.2f}s", level="warning")
    except ImportError:
        return CheckItem("时间同步", True, "ntplib 未安装，跳过检查", level="warning")
    except Exception as e:
        logger.warning("NTP 时间同步检查失败（不可达）: %s", e)
        return CheckItem("时间同步", True, f"NTP 不可达: {e}（跳过）", level="warning")


def get_critical_failures(preflight_results: list[dict[str, Any]] | None) -> list[str]:
    """从 preflight 结果中提取失败的 critical 项名称列表"""
    if not preflight_results:
        return []
    return [
        c["name"] for c in preflight_results
        if c.get("level") == "critical" and not c.get("passed")
    ]
