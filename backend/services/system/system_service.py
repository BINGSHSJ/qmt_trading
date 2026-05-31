import json
import platform
import shutil
import sqlite3
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

from backend.adapters.qmt.qmt_import_path import find_xtquant_spec
from backend.adapters.qmt.real_qmt_guard import RealQmtReadOnlyGuard
from backend.core.config import settings
from backend.core.database import initialize_database
from backend.core.exceptions import ConfigError, TaskCancelledError
from backend.repositories.system.system_repository import SystemRepository, now_text
from backend.schemas.common import PageQuery, PageResult
from backend.schemas.system import (
    BackupRecord,
    EnvironmentCheckResult,
    MaintenanceCleanupResult,
    OperationLogRecord,
    PathTestRequest,
    PathTestResult,
    RuntimeTaskRecord,
    StartupCheckItem,
    StartupCheckResult,
    SystemConfig,
    SystemLogRecord,
    SystemMonitor,
    TaskCreated,
)


CONFIG_META: dict[str, tuple[str, str]] = {
    "qmt_path": ("string", "QMT / MiniQMT 本地路径"),
    "account_id": ("string", "QMT 账户 ID"),
    "database_path": ("string", "SQLite 数据库路径"),
    "strategy_dir": ("string", "用户策略目录"),
    "backup_dir": ("string", "备份目录"),
    "auto_connect": ("bool", "启动自动连接"),
    "auto_sync": ("bool", "启动自动同步"),
    "default_order_amount": ("float", "默认单笔金额"),
    "max_order_amount": ("float", "最大单笔金额"),
    "order_confirm_required": ("bool", "下单前确认"),
    "default_order_type": ("string", "默认委托方式"),
    "price_offset": ("float", "委托价格偏移"),
    "simulation_mode": ("bool", "是否启用测试隔离数据源"),
    "strategy_timeout_seconds": ("int", "策略默认超时"),
    "strategy_run_interval_seconds": ("int", "策略运行间隔"),
    "intraday_auto_run": ("bool", "是否盘中自动运行"),
    "strategy_log_level": ("string", "默认日志级别"),
    "strategy_max_log_mb": ("int", "策略最大日志大小"),
    "log_retention_days": ("int", "日志保留天数"),
    "task_retention_days": ("int", "任务保留天数"),
}

DEVELOPMENT_LOG_PATTERNS = (
    "manual_*.log",
    "codex_*.log",
    "dev_*.log",
    "debug_*.log",
    "batch_*.log",
    "*_stdout.log",
    "*_stderr.log",
)
PROTECTED_LOG_NAMES = {"app.log", "error.log", ".gitkeep"}


class SystemService:
    def __init__(self) -> None:
        self.repository = SystemRepository()

    def recover_interrupted_tasks_on_startup(self) -> list[RuntimeTaskRecord]:
        interrupted_tasks = self.repository.mark_active_tasks_interrupted()
        if not interrupted_tasks:
            return []

        for task in interrupted_tasks:
            self._mark_interrupted_related_record(task)

        detail = json.dumps(
            [
                {
                    "task_id": task.task_id,
                    "task_type": task.task_type,
                    "previous_detail": task.technical_detail,
                }
                for task in interrupted_tasks
            ],
            ensure_ascii=False,
        )
        message = f"服务重启导致 {len(interrupted_tasks)} 个任务中断，已自动标记为失败。"
        self.repository.add_system_log(
            module="系统管理",
            level="error",
            message=message,
            technical_detail=detail,
            related_id=interrupted_tasks[0].task_id,
        )
        self.repository.add_operation_log(
            module="系统管理",
            action="启动任务扫尾",
            target_type="runtime_task",
            target_id=interrupted_tasks[0].task_id,
            result="成功",
            message=message,
            technical_detail=detail,
        )
        return interrupted_tasks

    def ensure_defaults(self) -> SystemConfig:
        defaults = SystemConfig(
            database_path=str(settings.database_path),
            strategy_dir=str(settings.strategy_user_dir),
            backup_dir=str(settings.backups_dir),
        )
        existing = self.repository.get_config_map()
        missing = {
            key: (self._serialize(value), CONFIG_META[key][0], CONFIG_META[key][1])
            for key, value in defaults.model_dump().items()
            if key not in existing
        }
        if missing:
            self.repository.upsert_config(missing)
        return self.get_config()

    def get_config(self) -> SystemConfig:
        values = self.repository.get_config_map()
        defaults = SystemConfig(
            database_path=str(settings.database_path),
            strategy_dir=str(settings.strategy_user_dir),
            backup_dir=str(settings.backups_dir),
        ).model_dump()
        merged = {**defaults, **values}
        parsed = {key: self._parse(merged[key], CONFIG_META[key][0]) for key in CONFIG_META}
        return SystemConfig(**parsed)

    def save_config(self, config: SystemConfig) -> SystemConfig:
        self._validate_config(config)
        self._normalize_config(config)
        payload = {
            key: (self._serialize(value), CONFIG_META[key][0], CONFIG_META[key][1])
            for key, value in config.model_dump().items()
        }
        self.repository.upsert_config(payload)
        self.repository.add_operation_log(
            module="系统管理",
            action="保存设置",
            target_type="app_config",
            target_id=None,
            result="成功",
            message="已保存系统基础、交易和策略设置。",
        )
        return self.get_config()

    def _validate_config(self, config: SystemConfig) -> None:
        if config.max_order_amount < config.default_order_amount:
            raise ConfigError(
                message="最大单笔金额不能小于默认单笔金额。",
                code="CONFIG_INVALID",
                detail=f"max_order_amount={config.max_order_amount}, default_order_amount={config.default_order_amount}",
                suggestion="请调大最大单笔金额，或调小默认单笔金额。",
            )
        numeric_rules = [
            ("默认单笔金额", config.default_order_amount, 0),
            ("最大单笔金额", config.max_order_amount, 0),
            ("策略默认超时", config.strategy_timeout_seconds, 1),
            ("策略运行间隔", config.strategy_run_interval_seconds, 5),
            ("策略最大日志大小", config.strategy_max_log_mb, 1),
            ("日志保留天数", config.log_retention_days, 1),
            ("任务保留天数", config.task_retention_days, 1),
        ]
        for label, value, minimum in numeric_rules:
            if value < minimum:
                raise ConfigError(
                    message=f"{label}配置不合法。",
                    code="CONFIG_INVALID",
                    detail=f"{label}={value}; minimum={minimum}",
                    suggestion=f"请把{label}设置为不小于 {minimum} 的数值。",
                )
        if not config.simulation_mode and not config.order_confirm_required:
            raise ConfigError(
                message="真实 QMT 模式必须开启下单前确认。",
                code="CONFIG_INVALID",
                detail="simulation_mode=false; order_confirm_required=false",
                suggestion="请保持“下单前确认”开启；真实小额下单验收也必须人工确认。",
            )

    def _normalize_config(self, config: SystemConfig) -> None:
        config.qmt_path = str(Path(config.qmt_path).expanduser()) if config.qmt_path else ""
        config.database_path = str(Path(config.database_path).expanduser()) if config.database_path else ""
        config.strategy_dir = str(Path(config.strategy_dir).expanduser()) if config.strategy_dir else ""
        config.backup_dir = str(Path(config.backup_dir).expanduser()) if config.backup_dir else ""
        config.account_id = config.account_id.strip()
        config.default_order_type = config.default_order_type.strip() or "限价委托"
        config.strategy_log_level = config.strategy_log_level.strip().lower() or "info"

    def test_path(self, request: PathTestRequest) -> PathTestResult:
        path = Path(request.path).expanduser()
        exists = path.exists()
        is_directory = path.is_dir()
        ok = exists and (is_directory if request.expect_directory else path.is_file())
        message = "路径检测通过。" if ok else "路径检测未通过。"
        suggestion = None if ok else "请确认路径是否存在，以及选择的是目录还是文件。"
        self.repository.add_operation_log(
            module="系统管理",
            action="测试路径",
            target_type="path",
            target_id=str(path),
            result="成功" if ok else "失败",
            message=message,
            technical_detail=f"exists={exists}, is_directory={is_directory}",
        )
        return PathTestResult(
            path=str(path),
            exists=exists,
            is_directory=is_directory,
            message=message,
            suggestion=suggestion,
        )

    def create_environment_check_task(self) -> TaskCreated:
        task = self.repository.create_task("environment_check", "正在执行系统环境检测。")
        self.repository.add_operation_log(
            module="系统管理",
            action="环境检测",
            target_type="runtime_task",
            target_id=task.task_id,
            result="成功",
            message="已创建环境检测任务。",
        )
        return TaskCreated(
            task_id=task.task_id,
            task_type=task.task_type,
            status=task.status,
            progress=task.progress,
            message=task.message,
        )

    def run_environment_check(self, task_id: str) -> None:
        if self.repository.is_task_cancelled(task_id):
            return
        config = self.get_config()
        python_ok = sys.version_info >= (3, 10)
        guard = RealQmtReadOnlyGuard(
            qmt_path=config.qmt_path,
            account_id=config.account_id,
            simulation_mode=config.simulation_mode,
            order_confirm_required=config.order_confirm_required,
            max_order_amount=config.max_order_amount,
        )
        results: list[dict[str, str | None]] = [
            item.as_environment_result()
            for item in guard.build_environment_items()
        ] + [
            {
                "check_item": "Python版本是否兼容",
                "status": "success" if python_ok else "failed",
                "message": f"当前 Python 版本：{platform.python_version()}。",
                "suggestion": None if python_ok else "建议使用 Python 3.10 或更高版本。",
                "technical_detail": sys.version,
            },
        ]
        failed_count = sum(1 for item in results if item["status"] == "failed")
        if self.repository.is_task_cancelled(task_id):
            return
        self.repository.add_environment_results(task_id, results)
        self.repository.update_task_if_not_cancelled(
            task_id=task_id,
            status="failed" if failed_count else "success",
            progress=100,
            message="环境检测完成。" if failed_count == 0 else "环境检测完成，但存在失败项。",
            technical_detail=f"failed_count={failed_count}; simulation_mode={config.simulation_mode}; real_order_submitted=false",
            finished=True,
        )
        if not self.repository.is_task_cancelled(task_id):
            self.repository.add_system_log(
                module="系统管理",
                level="info" if failed_count == 0 else "warning",
                message="环境检测完成；真实 QMT 验收仅执行前置检查，未提交真实委托。",
                technical_detail=json.dumps(results, ensure_ascii=False),
                related_id=task_id,
            )

    def list_environment_results(self, task_id: str | None = None) -> list[EnvironmentCheckResult]:
        return self.repository.list_environment_results(task_id)

    def list_logs(self, query: PageQuery, module: str | None = None, level: str | None = None) -> PageResult[SystemLogRecord]:
        return self.repository.list_logs(query, module=module, level=level)

    def get_monitor(self) -> SystemMonitor:
        today = now_text()[:10]
        running = self.repository.list_tasks(status="running", limit=100)
        failed_today = self.repository.list_tasks(status="failed", limit=100, start_date=today)
        failed_all = self.repository.list_tasks(status="failed", limit=1000)
        logs_page = self.repository.list_logs(PageQuery(page=1, page_size=5), level="error")
        tasks = self.repository.list_tasks(limit=10)
        return SystemMonitor(
            running_task_count=len(running),
            failed_task_count=len(failed_today),
            historical_failed_task_count=max(0, len(failed_all) - len(failed_today)),
            database_size_bytes=self.repository.database_size(),
            log_size_bytes=self.repository.directory_size(settings.logs_dir),
            backup_count=self.repository.count_backups(),
            recent_errors=logs_page.items,
            slow_tasks=[task for task in tasks if task.status in {"running", "failed"}],
        )

    def get_startup_check(self) -> StartupCheckResult:
        items = [
            self._check_backend(),
            self._check_frontend(),
            self._check_database(),
            *self._check_directories(),
            self._check_xtquant(),
        ]
        overall_status = "success"
        if any(item.status == "failed" for item in items):
            overall_status = "failed"
        elif any(item.status == "warning" for item in items):
            overall_status = "warning"
        return StartupCheckResult(
            app_name=settings.app_name,
            version=settings.app_version,
            checked_at=now_text(),
            overall_status=overall_status,
            items=items,
        )

    def create_backup(self) -> BackupRecord:
        return self._write_backup_archive()

    def create_backup_task(self) -> TaskCreated:
        self._ensure_no_same_type_active_task("backup_create")
        task = self.repository.create_task("backup_create", "正在创建系统备份。")
        self.repository.add_operation_log("系统管理", "创建备份任务", "runtime_task", task.task_id, "成功", "已创建备份任务。")
        return TaskCreated(task_id=task.task_id, task_type=task.task_type, status=task.status, progress=task.progress, message=task.message)

    def run_backup_task(self, task_id: str) -> None:
        try:
            self.ensure_not_cancelled(task_id)
            record = self._write_backup_archive()
            self.finish_task_if_active(
                task_id,
                "success",
                100,
                "系统备份已创建。",
                f"backup_id={record.id}; path={record.backup_path}",
                finished=True,
            )
        except TaskCancelledError:
            return
        except Exception as exc:
            if not self.repository.is_task_cancelled(task_id):
                self.finish_task_if_active(task_id, "failed", 100, "系统备份创建失败。", str(exc), finished=True)
                self.repository.add_operation_log("系统管理", "创建备份", "runtime_task", task_id, "失败", "系统备份创建失败。", str(exc))

    def _write_backup_archive(self, prefix: str = "backup") -> BackupRecord:
        backup_root = self._backup_root()
        backup_name = f"{prefix}_{now_text().replace(':', '').replace(' ', '_')}"
        backup_path = backup_root / f"{backup_name}.zip"
        with tempfile.TemporaryDirectory() as temp_dir:
            temp_db = Path(temp_dir) / "local_quant_console.db"
            if settings.database_path.exists():
                source = sqlite3.connect(settings.database_path)
                try:
                    target = sqlite3.connect(temp_db)
                    try:
                        source.backup(target)
                    finally:
                        target.close()
                finally:
                    source.close()
            with zipfile.ZipFile(backup_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                if temp_db.exists():
                    archive.write(temp_db, arcname="data/local_quant_console.db")
                config_json = json.dumps(self.get_config().model_dump(), ensure_ascii=False, indent=2)
                archive.writestr("config/app_config.json", config_json)
                strategy_dir = Path(self.get_config().strategy_dir)
                if strategy_dir.exists():
                    for file in strategy_dir.rglob("*"):
                        if file.is_file():
                            archive.write(file, arcname=f"strategies/user/{file.relative_to(strategy_dir)}")
                for log_file in settings.logs_dir.glob("*.log"):
                    archive.write(log_file, arcname=f"logs/{log_file.name}")
                manifest = {
                    "app_name": settings.app_name,
                    "version": settings.app_version,
                    "created_at": now_text(),
                    "strategy_restore_policy": "策略文件只备份，恢复时提取到 backups/restored_strategies，不覆盖 strategies/user。",
                }
                archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        record = self.repository.add_backup_record(
            backup_name=backup_name,
            backup_path=backup_path,
            backup_size=backup_path.stat().st_size,
            status="success",
        )
        self.repository.add_operation_log(
            module="系统管理",
            action="立即备份",
            target_type="backup_record",
            target_id=str(record.id),
            result="成功",
            message="已生成系统备份文件。",
            technical_detail=str(backup_path),
        )
        return record

    def list_backups(self, query: PageQuery) -> PageResult[BackupRecord]:
        return self.repository.list_backups_page(query)

    def restore_backup(self, backup_id: int) -> TaskCreated:
        backup = self._get_backup_or_error(backup_id)
        if not Path(backup.backup_path).exists():
            raise ConfigError(
                message="备份文件不存在，无法恢复。",
                code="BACKUP_NOT_FOUND",
                detail=backup.backup_path,
                suggestion="请确认备份文件没有被移动或删除。",
            )
        self._ensure_no_same_type_active_task("backup_restore")
        self._ensure_restore_safe()
        self.repository.add_operation_log(
            module="系统管理",
            action="创建恢复任务",
            target_type="backup_record",
            target_id=str(backup_id),
            result="成功",
            message="已创建备份恢复任务；恢复任务启动后会先自动生成当前快照。",
            technical_detail=f"backup_path={backup.backup_path}; pre_restore_snapshot=pending",
        )
        task = self.repository.create_task("backup_restore", "正在准备恢复备份；将先生成当前快照。")
        return TaskCreated(
            task_id=task.task_id,
            task_type=task.task_type,
            status=task.status,
            progress=task.progress,
            message=task.message,
        )

    def run_backup_verify_task(self, task_id: str, backup_id: int) -> None:
        self.run_backup_restore_task(task_id, backup_id)

    def run_backup_restore_task(self, task_id: str, backup_id: int) -> None:
        try:
            self.ensure_not_cancelled(task_id)
            self._ensure_restore_safe(exclude_task_id=task_id)
            backup = self._get_backup_or_error(backup_id)
            path = Path(backup.backup_path)
            if not path.exists():
                raise ConfigError("备份文件不存在，无法验证。", "BACKUP_NOT_FOUND", backup.backup_path, "请确认备份文件没有被移动或删除。")
            self.finish_task_if_active(task_id, "running", 10, "正在创建恢复前当前快照。")
            snapshot = self._write_backup_archive(prefix="pre_restore")
            self.repository.add_operation_log(
                module="系统管理",
                action="恢复前快照",
                target_type="backup_record",
                target_id=str(snapshot.id),
                result="成功",
                message="恢复前当前快照已创建。",
                technical_detail=snapshot.backup_path,
            )
            self.finish_task_if_active(task_id, "running", 30, "恢复前快照已创建，正在验证备份文件。", f"pre_restore_snapshot={snapshot.backup_path}")
            current_tasks = self.repository.dump_runtime_tasks()
            current_backups = self.repository.list_backups()
            restored_config: SystemConfig | None = None
            with tempfile.TemporaryDirectory() as temp_dir:
                temp_path = Path(temp_dir)
                with zipfile.ZipFile(path) as archive:
                    names = set(archive.namelist())
                    if "data/local_quant_console.db" not in names:
                        raise ConfigError(
                            "备份文件缺少数据库，无法恢复。",
                            "BACKUP_DATABASE_MISSING",
                            backup.backup_path,
                            "请换一个完整备份文件重试。",
                        )
                    archive.extract("data/local_quant_console.db", temp_path)
                    if "config/app_config.json" in names:
                        archive.extract("config/app_config.json", temp_path)
                    strategy_names = [name for name in names if name.startswith("strategies/user/") and not name.endswith("/")]
                    if strategy_names:
                        restore_dir = self._backup_root() / "restored_strategies" / backup.backup_name
                        restore_dir.mkdir(parents=True, exist_ok=True)
                        for name in strategy_names:
                            archive.extract(name, temp_path)
                            source = temp_path / name
                            target = restore_dir / Path(name).relative_to("strategies/user")
                            target.parent.mkdir(parents=True, exist_ok=True)
                            shutil.copy2(source, target)
                config_path = temp_path / "config" / "app_config.json"
                if config_path.exists():
                    restored_config = SystemConfig(**json.loads(config_path.read_text(encoding="utf-8")))
                    try:
                        self._validate_config(restored_config)
                    except ConfigError as exc:
                        raise ConfigError(
                            "备份中的系统配置不合法，已停止恢复。",
                            "BACKUP_CONFIG_INVALID",
                            exc.detail,
                            f"{exc.message} {exc.suggestion or ''}".strip(),
                        ) from exc
                    self._normalize_config(restored_config)
                restored_db = temp_path / "data" / "local_quant_console.db"
                self._verify_database_file(restored_db, "备份文件中的数据库无法通过完整性校验，已停止恢复。")
                settings.data_dir.mkdir(parents=True, exist_ok=True)
                self.finish_task_if_active(task_id, "running", 60, "备份文件校验通过，正在恢复 SQLite 数据库。")
                for suffix in ("", "-wal", "-shm"):
                    existing = Path(f"{settings.database_path}{suffix}")
                    if existing.exists():
                        existing.unlink()
                shutil.copy2(restored_db, settings.database_path)
                self._verify_database_file(settings.database_path, "恢复后的数据库无法通过完整性校验。")
                initialize_database()
                self.repository.restore_runtime_tasks(current_tasks)
                self.repository.restore_backup_records(current_backups)
                self.repository.ensure_task_record(task_id, "backup_restore", "正在恢复备份；恢复前已生成当前快照。")
                if restored_config is not None:
                    payload = {
                        key: (self._serialize(value), CONFIG_META[key][0], CONFIG_META[key][1])
                        for key, value in restored_config.model_dump().items()
                    }
                    self.repository.upsert_config(payload)
            self.finish_task_if_active(
                task_id,
                "success",
                100,
                "备份恢复完成；用户策略已提取到备份目录，未覆盖 strategies/user。",
                f"backup_id={backup_id}; restored_database=true; strategies_overwrite=false",
                finished=True,
            )
            self.repository.add_operation_log(
                module="系统管理",
                action="恢复备份",
                target_type="backup_record",
                target_id=str(backup_id),
                result="成功",
                message="备份恢复完成。用户策略文件只提取到备份目录，未覆盖当前策略目录。",
                technical_detail=backup.backup_path,
            )
        except TaskCancelledError:
            return
        except ConfigError as exc:
            if not self.repository.is_task_cancelled(task_id):
                self.finish_task_if_active(task_id, "failed", 100, exc.message, exc.detail, finished=True)
                self.repository.add_operation_log("系统管理", "恢复备份", "backup_record", str(backup_id), "失败", exc.message, exc.detail)
        except Exception as exc:
            if not self.repository.is_task_cancelled(task_id):
                self.finish_task_if_active(task_id, "failed", 100, "备份恢复失败。", str(exc), finished=True)
                self.repository.add_operation_log("系统管理", "恢复备份", "backup_record", str(backup_id), "失败", "备份恢复失败。", str(exc))

    def export_logs_archive(self) -> Path:
        export_dir = self._backup_root() / "exports"
        export_dir.mkdir(parents=True, exist_ok=True)
        export_path = export_dir / f"system_logs_{now_text().replace(':', '').replace(' ', '_')}.zip"
        rows = self.repository.export_logs()
        with zipfile.ZipFile(export_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("system_log.json", json.dumps(rows, ensure_ascii=False, indent=2))
            for log_file in settings.logs_dir.glob("*.log"):
                archive.write(log_file, arcname=f"logs/{log_file.name}")
        self.repository.add_operation_log(
            "系统管理",
            "导出日志",
            "export_file",
            export_path.name,
            "成功",
            "已导出系统日志和重要日志文件。",
            str(export_path),
        )
        return export_path

    def export_config_file(self) -> Path:
        export_dir = self._backup_root() / "exports"
        export_dir.mkdir(parents=True, exist_ok=True)
        export_path = export_dir / f"system_config_{now_text().replace(':', '').replace(' ', '_')}.json"
        payload = {
            "app_name": settings.app_name,
            "version": settings.app_version,
            "exported_at": now_text(),
            "config": self.get_config().model_dump(),
        }
        export_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        self.repository.add_operation_log(
            "系统管理",
            "导出配置",
            "export_file",
            export_path.name,
            "成功",
            "已导出系统配置。",
            str(export_path),
        )
        return export_path

    def delete_backup(self, backup_id: int) -> None:
        backup = self._get_backup_or_error(backup_id)
        path = Path(backup.backup_path)
        if path.exists():
            path.unlink()
        self.repository.delete_backup(backup_id)
        self.repository.add_operation_log(
            module="系统管理",
            action="删除备份",
            target_type="backup_record",
            target_id=str(backup_id),
            result="成功",
            message="已删除备份记录和备份文件。",
            technical_detail=backup.backup_path,
        )

    def list_operations(self, query: PageQuery) -> PageResult[OperationLogRecord]:
        return self.repository.list_operations(query)

    def create_cleanup_task(self) -> TaskCreated:
        config = self.get_config()
        task = self.repository.create_task("maintenance_cleanup", "正在清理并归档历史日志和任务记录。")
        self.repository.add_operation_log(
            "系统管理",
            "创建清理任务",
            "runtime_task",
            task.task_id,
            "成功",
            f"保留日志 {config.log_retention_days} 天，任务 {config.task_retention_days} 天。",
        )
        return TaskCreated(task_id=task.task_id, task_type=task.task_type, status=task.status, progress=task.progress, message=task.message)

    def run_cleanup_task(self, task_id: str) -> None:
        try:
            self.ensure_not_cancelled(task_id)
            config = self.get_config()
            result = self.repository.cleanup_old_records(config.log_retention_days, config.task_retention_days, self._backup_root())
            development_log_archive_path, development_log_count = self._archive_development_log_files()
            result = result.model_copy(
                update={
                    "development_log_archive_path": development_log_archive_path,
                    "development_log_files_archived": development_log_count,
                }
            )
            detail = result.model_dump_json()
            message = "历史日志和任务记录清理完成。"
            if development_log_count:
                message = f"历史日志和任务记录清理完成，已归档 {development_log_count} 个开发排障日志文件。"
            self.finish_task_if_active(task_id, "success", 100, message, detail, finished=True)
            self.repository.add_operation_log("系统管理", "清理归档", "runtime_task", task_id, "成功", message, detail)
        except TaskCancelledError:
            return
        except Exception as exc:
            if not self.repository.is_task_cancelled(task_id):
                self.finish_task_if_active(task_id, "failed", 100, "历史日志和任务记录清理失败。", str(exc), finished=True)
                self.repository.add_operation_log("系统管理", "清理归档", "runtime_task", task_id, "失败", "历史日志和任务记录清理失败。", str(exc))

    def get_task(self, task_id: str) -> RuntimeTaskRecord:
        try:
            return self.repository.get_task(task_id)
        except KeyError as exc:
            raise ConfigError(
                message="任务不存在。",
                code="TASK_NOT_FOUND",
                detail=str(exc),
                suggestion="请刷新页面后重试。",
                status_code=404,
            ) from exc

    def cancel_task(self, task_id: str) -> RuntimeTaskRecord:
        task = self.get_task(task_id)
        if task.status not in {"running", "pending"}:
            return task
        self.repository.update_task(task_id, "cancelled", task.progress, "任务已取消。", finished=True)
        self._cancel_related_record(task.task_type, task_id)
        self.repository.add_operation_log(
            module="系统管理",
            action="取消任务",
            target_type="runtime_task",
            target_id=task_id,
            result="成功",
            message="已取消任务。",
        )
        return self.get_task(task_id)

    def ensure_not_cancelled(self, task_id: str) -> None:
        if self.repository.is_task_cancelled(task_id):
            raise TaskCancelledError("任务已取消。", "TASK_CANCELLED", task_id, "任务已经取消，后续结果不会继续写入。")

    def finish_task_if_active(
        self,
        task_id: str,
        status: str,
        progress: int,
        message: str,
        technical_detail: str | None = None,
        finished: bool = False,
    ) -> bool:
        return self.repository.update_task_if_not_cancelled(task_id, status, progress, message, technical_detail, finished)

    def _ensure_restore_safe(self, exclude_task_id: str | None = None) -> None:
        active_tasks = self.repository.list_active_tasks(exclude_task_id=exclude_task_id)
        if not active_tasks:
            return
        task_summary = ", ".join(f"{task.task_id}:{task.task_type}:{task.status}" for task in active_tasks[:5])
        raise ConfigError(
            message="当前存在运行中的任务，已停止备份恢复以保护数据库。",
            code="BACKUP_RESTORE_BUSY",
            detail=f"active_tasks={task_summary}",
            suggestion="请等待同步、回测、策略运行、交易同步或其他后台任务完成后，再重新执行备份恢复。",
        )

    def _ensure_no_same_type_active_task(self, task_type: str) -> None:
        active = self.repository.find_active_task_by_type(task_type)
        if not active:
            return
        raise ConfigError(
            message="同类型任务正在执行，请等待完成后重试。",
            code="TASK_ALREADY_RUNNING",
            detail=f"task_type={task_type}; active_task_id={active.task_id}; status={active.status}",
            suggestion="请到系统管理的运行监控查看任务进度，任务结束后再重新发起。",
        )

    def _get_backup_or_error(self, backup_id: int) -> BackupRecord:
        try:
            return self.repository.get_backup(backup_id)
        except KeyError as exc:
            raise ConfigError(
                message="备份记录不存在。",
                code="BACKUP_NOT_FOUND",
                detail=f"backup_id={backup_id}",
                suggestion="请刷新备份列表后重试，或重新创建备份。",
                status_code=404,
            ) from exc

    def _backup_root(self) -> Path:
        config = self.get_config()
        root = Path(config.backup_dir or str(settings.backups_dir)).expanduser()
        root.mkdir(parents=True, exist_ok=True)
        return root

    def _archive_development_log_files(self) -> tuple[str | None, int]:
        logs_dir = settings.logs_dir
        if not logs_dir.exists():
            return None, 0

        root = logs_dir.resolve()
        candidates: dict[Path, Path] = {}
        for pattern in DEVELOPMENT_LOG_PATTERNS:
            for path in logs_dir.glob(pattern):
                resolved = path.resolve()
                if (
                    path.is_file()
                    and resolved.parent == root
                    and path.name not in PROTECTED_LOG_NAMES
                    and not path.name.startswith("app.log")
                    and not path.name.startswith("error.log")
                ):
                    candidates[resolved] = path

        files = [candidates[key] for key in sorted(candidates)]
        if not files:
            return None, 0

        archive_dir = logs_dir / "archive"
        archive_dir.mkdir(parents=True, exist_ok=True)
        archive_path = archive_dir / f"development_logs_{now_text().replace(':', '').replace(' ', '_')}.zip"

        with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for file in files:
                archive.write(file, arcname=file.name)

        for file in files:
            try:
                file.unlink()
            except FileNotFoundError:
                continue

        return str(archive_path), len(files)

    def _verify_database_file(self, database_path: Path, message: str) -> None:
        try:
            with sqlite3.connect(database_path) as connection:
                row = connection.execute("PRAGMA integrity_check").fetchone()
        except Exception as exc:
            raise ConfigError(
                message=message,
                code="BACKUP_DATABASE_INVALID",
                detail=repr(exc),
                suggestion="请换用最近一次完整备份，或先联系开发者排查备份文件。",
            ) from exc
        result = row[0] if row else "empty"
        if result != "ok":
            raise ConfigError(
                message=message,
                code="BACKUP_DATABASE_INVALID",
                detail=f"integrity_check={result}",
                suggestion="请换用最近一次完整备份，或先联系开发者排查备份文件。",
            )

    def _cancel_related_record(self, task_type: str, task_id: str) -> None:
        if task_type.startswith("sync_"):
            from backend.repositories.data_center.data_center_repository import DataCenterRepository

            DataCenterRepository().finish_sync_task(task_id, "cancelled", 0, 0, 0)
        elif task_type == "strategy_run":
            from backend.repositories.strategy_dev.strategy_repository import StrategyRepository

            StrategyRepository().cancel_run_by_task(task_id)
        elif task_type == "backtest_run":
            from backend.repositories.backtest_center.backtest_repository import BacktestRepository

            try:
                BacktestRepository().update_status(task_id, "cancelled")
            except KeyError:
                return

    def _mark_interrupted_related_record(self, task: RuntimeTaskRecord) -> None:
        message = "服务重启导致任务中断，请重新创建任务。"
        if task.task_type.startswith("sync_"):
            from backend.repositories.data_center.data_center_repository import DataCenterRepository

            repository = DataCenterRepository()
            repository.finish_sync_task(task.task_id, "failed", 0, 0, 1)
            repository.add_sync_log(task.task_id, task.task_type, "error", message, task.technical_detail)
        elif task.task_type == "strategy_run":
            from backend.repositories.strategy_dev.strategy_repository import StrategyRepository

            StrategyRepository().fail_run_by_task(task.task_id, message, task.technical_detail)
        elif task.task_type == "backtest_run":
            from backend.repositories.backtest_center.backtest_repository import BacktestRepository

            repository = BacktestRepository()
            try:
                backtest = repository.get_task(task.task_id)
                repository.update_status(task.task_id, "failed")
                repository.add_log(backtest.id, "error", message, task.technical_detail)
            except KeyError:
                return

    def _serialize(self, value: object) -> str:
        return json.dumps(value, ensure_ascii=False)

    def _parse(self, value: str, value_type: str) -> object:
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
            except json.JSONDecodeError:
                parsed = value
        else:
            parsed = value
        if value_type == "bool":
            return bool(parsed)
        if value_type == "int":
            return int(parsed)
        if value_type == "float":
            return float(parsed)
        return str(parsed)

    def _check_backend(self) -> StartupCheckItem:
        return StartupCheckItem(check_item="后端服务", status="success", message="后端 API 正常运行。", technical_detail="api_status=ok")

    def _check_frontend(self) -> StartupCheckItem:
        try:
            with urllib.request.urlopen("http://127.0.0.1:3000/dashboard", timeout=1) as response:
                ok = 200 <= response.status < 500
            return StartupCheckItem(
                check_item="前端页面",
                status="success" if ok else "warning",
                message="前端页面可访问。" if ok else "前端返回非预期状态。",
                suggestion=None if ok else "请确认 start.bat 是否已启动前端。",
                technical_detail=f"http_status={response.status}",
            )
        except Exception as exc:
            return StartupCheckItem(
                check_item="前端页面",
                status="warning",
                message="后端暂未检测到前端页面。",
                suggestion="如果浏览器可以打开 http://127.0.0.1:3000/dashboard，可忽略该提示；否则请重新运行 start.bat。",
                technical_detail=repr(exc),
            )

    def _check_database(self) -> StartupCheckItem:
        try:
            with sqlite3.connect(settings.database_path) as connection:
                connection.execute("SELECT 1").fetchone()
            return StartupCheckItem(check_item="SQLite 数据库", status="success", message="数据库可打开并可查询。", technical_detail=str(settings.database_path))
        except Exception as exc:
            return StartupCheckItem(
                check_item="SQLite 数据库",
                status="failed",
                message="数据库无法打开或查询。",
                suggestion="请先执行备份，必要时用最近备份恢复。",
                technical_detail=repr(exc),
            )

    def _check_directories(self) -> list[StartupCheckItem]:
        results: list[StartupCheckItem] = []
        config = self.get_config()
        directories = {
            "数据目录": settings.data_dir,
            "日志目录": settings.logs_dir,
            "备份目录": Path(config.backup_dir or str(settings.backups_dir)).expanduser(),
            "用户策略目录": Path(config.strategy_dir or str(settings.strategy_user_dir)).expanduser(),
        }
        for name, path in directories.items():
            try:
                path.mkdir(parents=True, exist_ok=True)
                test_file = path / ".write_test"
                test_file.write_text("ok", encoding="utf-8")
                test_file.unlink(missing_ok=True)
                results.append(StartupCheckItem(check_item=name, status="success", message=f"{name}存在且可写。", technical_detail=str(path)))
            except Exception as exc:
                results.append(
                    StartupCheckItem(
                        check_item=name,
                        status="failed",
                        message=f"{name}不可写。",
                        suggestion="请检查目录权限，或换到可写目录。",
                        technical_detail=f"{path}; {exc!r}",
                    )
                )
        return results

    def _check_xtquant(self) -> StartupCheckItem:
        config = self.get_config()
        spec = find_xtquant_spec(config.qmt_path)
        return StartupCheckItem(
            check_item="xtquant 导入",
            status="success" if spec else "warning",
            message="当前 Python 环境可导入 xtquant。" if spec else "当前 Python 环境未安装 xtquant，真实 QMT 数据源不可用。",
            suggestion=None if spec else "请在系统管理填写 QMT 路径；系统会尝试从 QMT 安装目录加载 xtquant。",
            technical_detail=f"qmt_path={config.qmt_path}; spec={spec}",
        )
