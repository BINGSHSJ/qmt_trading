import json
import sqlite3
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from uuid import uuid4

from backend.core.config import settings
from backend.core.database import db_session
from backend.repositories.query_utils import append_date_filter, append_status_filter, build_sort_clause
from backend.schemas.common import PageQuery, PageResult
from backend.schemas.system import (
    BackupRecord,
    EnvironmentCheckResult,
    MaintenanceCleanupResult,
    OperationLogRecord,
    RuntimeTaskRecord,
    SystemLogRecord,
)


def now_text() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def task_source_info(task_type: str | None) -> dict[str, str]:
    normalized = (task_type or "").lower()
    if normalized.startswith("sync_"):
        return {
            "source_module": "数据中心",
            "source_route": "/data-center?tab=数据同步",
            "source_label": "数据中心 / 数据同步",
        }
    if normalized.startswith("backtest"):
        return {
            "source_module": "回测研究",
            "source_route": "/backtest?tab=回测任务",
            "source_label": "回测研究 / 回测任务",
        }
    if normalized.startswith("strategy"):
        return {
            "source_module": "策略开发",
            "source_route": "/strategy-dev?tab=运行调试",
            "source_label": "策略开发 / 运行调试",
        }
    if normalized.startswith("trading"):
        return {
            "source_module": "交易执行",
            "source_route": "/trading?tab=委托记录",
            "source_label": "交易执行 / 委托记录",
        }
    if normalized == "environment_check":
        return {
            "source_module": "系统管理",
            "source_route": "/system?tab=环境检测",
            "source_label": "系统管理 / 环境检测",
        }
    if normalized.startswith("backup"):
        return {
            "source_module": "系统管理",
            "source_route": "/system?tab=备份恢复",
            "source_label": "系统管理 / 备份恢复",
        }
    return {
        "source_module": "系统管理",
        "source_route": "/system?tab=运行监控",
        "source_label": "系统管理 / 运行监控",
    }


def build_runtime_task_record(row: sqlite3.Row | dict[str, object]) -> RuntimeTaskRecord:
    payload = dict(row)
    payload.update(task_source_info(str(payload.get("task_type") or "")))
    return RuntimeTaskRecord(**payload)


class SystemRepository:
    def get_config_map(self) -> dict[str, str]:
        with db_session() as connection:
            rows = connection.execute("SELECT config_key, config_value FROM app_config").fetchall()
        return {row["config_key"]: row["config_value"] for row in rows}

    def upsert_config(self, values: dict[str, tuple[str, str, str]]) -> None:
        updated_at = now_text()
        with db_session() as connection:
            connection.executemany(
                """
                INSERT INTO app_config(config_key, config_value, value_type, description, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(config_key) DO UPDATE SET
                    config_value = excluded.config_value,
                    value_type = excluded.value_type,
                    description = excluded.description,
                    updated_at = excluded.updated_at
                """,
                [
                    (key, value, value_type, description, updated_at)
                    for key, (value, value_type, description) in values.items()
                ],
            )

    def create_task(self, task_type: str, message: str) -> RuntimeTaskRecord:
        task_id = f"task_{datetime.now():%Y%m%d%H%M%S}_{uuid4().hex[:6]}"
        created_at = now_text()
        with db_session() as connection:
            connection.execute(
                """
                INSERT INTO runtime_task(task_id, task_type, status, progress, message, started_at, created_at)
                VALUES (?, ?, 'running', 0, ?, ?, ?)
                """,
                (task_id, task_type, message, created_at, created_at),
            )
        return self.get_task(task_id)

    def update_task(
        self,
        task_id: str,
        status: str,
        progress: int,
        message: str,
        technical_detail: str | None = None,
        finished: bool = False,
    ) -> None:
        finished_at = now_text() if finished else None
        with db_session() as connection:
            connection.execute(
                """
                UPDATE runtime_task
                SET status = ?, progress = ?, message = ?, technical_detail = ?,
                    finished_at = COALESCE(?, finished_at)
                WHERE task_id = ?
                """,
                (status, progress, message, technical_detail, finished_at, task_id),
            )

    def update_task_if_not_cancelled(
        self,
        task_id: str,
        status: str,
        progress: int,
        message: str,
        technical_detail: str | None = None,
        finished: bool = False,
    ) -> bool:
        finished_at = now_text() if finished else None
        with db_session() as connection:
            cursor = connection.execute(
                """
                UPDATE runtime_task
                SET status = ?, progress = ?, message = ?, technical_detail = ?,
                    finished_at = COALESCE(?, finished_at)
                WHERE task_id = ? AND status != 'cancelled'
                """,
                (status, progress, message, technical_detail, finished_at, task_id),
            )
        return cursor.rowcount > 0

    def is_task_cancelled(self, task_id: str) -> bool:
        with db_session() as connection:
            row = connection.execute("SELECT status FROM runtime_task WHERE task_id = ?", (task_id,)).fetchone()
        return bool(row and row["status"] == "cancelled")

    def get_task(self, task_id: str) -> RuntimeTaskRecord:
        with db_session() as connection:
            row = connection.execute(
                """
                SELECT task_id, task_type, status, progress, message, technical_detail,
                       started_at, finished_at, created_at
                FROM runtime_task WHERE task_id = ?
                """,
                (task_id,),
            ).fetchone()
        if row is None:
            raise KeyError(task_id)
        return build_runtime_task_record(row)

    def ensure_task_record(self, task_id: str, task_type: str, message: str) -> RuntimeTaskRecord:
        with db_session() as connection:
            row = connection.execute("SELECT id FROM runtime_task WHERE task_id = ?", (task_id,)).fetchone()
            if row is None:
                created_at = now_text()
                connection.execute(
                    """
                    INSERT INTO runtime_task(task_id, task_type, status, progress, message, started_at, created_at)
                    VALUES (?, ?, 'running', 0, ?, ?, ?)
                    """,
                    (task_id, task_type, message, created_at, created_at),
                )
        return self.get_task(task_id)

    def list_tasks(self, status: str | None = None, limit: int = 20, start_date: str | None = None) -> list[RuntimeTaskRecord]:
        sql = """
            SELECT task_id, task_type, status, progress, message, technical_detail,
                   started_at, finished_at, created_at
            FROM runtime_task
        """
        clauses: list[str] = []
        params: list[object] = []
        if status:
            clauses.append("status = ?")
            params.append(status)
        if start_date:
            clauses.append("substr(created_at, 1, 10) >= ?")
            params.append(start_date)
        if clauses:
            sql += f" WHERE {' AND '.join(clauses)}"
        sql += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        with db_session() as connection:
            rows = connection.execute(sql, params).fetchall()
        return [build_runtime_task_record(row) for row in rows]

    def list_active_tasks(self, exclude_task_id: str | None = None, limit: int = 100) -> list[RuntimeTaskRecord]:
        clauses = ["status IN ('running', 'pending')"]
        params: list[object] = []
        if exclude_task_id:
            clauses.append("task_id != ?")
            params.append(exclude_task_id)
        params.append(limit)
        with db_session() as connection:
            rows = connection.execute(
                f"""
                SELECT task_id, task_type, status, progress, message, technical_detail,
                       started_at, finished_at, created_at
                FROM runtime_task
                WHERE {' AND '.join(clauses)}
                ORDER BY created_at DESC
                LIMIT ?
                """,
                params,
            ).fetchall()
        return [build_runtime_task_record(row) for row in rows]

    def find_active_task_by_type(self, task_type: str, exclude_task_id: str | None = None) -> RuntimeTaskRecord | None:
        clauses = ["task_type = ?", "status IN ('running', 'pending')"]
        params: list[object] = [task_type]
        if exclude_task_id:
            clauses.append("task_id != ?")
            params.append(exclude_task_id)
        with db_session() as connection:
            row = connection.execute(
                f"""
                SELECT task_id, task_type, status, progress, message, technical_detail,
                       started_at, finished_at, created_at
                FROM runtime_task
                WHERE {' AND '.join(clauses)}
                ORDER BY created_at DESC, id DESC
                LIMIT 1
                """,
                params,
            ).fetchone()
        return build_runtime_task_record(row) if row else None

    def mark_active_tasks_interrupted(self) -> list[RuntimeTaskRecord]:
        finished_at = now_text()
        message = "服务重启导致任务中断，请重新创建任务。"
        updated: list[RuntimeTaskRecord] = []
        with db_session() as connection:
            rows = connection.execute(
                """
                SELECT task_id, task_type, status, progress, message, technical_detail,
                       started_at, finished_at, created_at
                FROM runtime_task
                WHERE status IN ('running', 'pending')
                ORDER BY created_at DESC
                """
            ).fetchall()
            for row in rows:
                technical_detail = json.dumps(
                    {
                        "reason": "process_restart",
                        "previous_status": row["status"],
                        "previous_progress": row["progress"],
                        "interrupted_at": finished_at,
                        "recovery": "local_startup_sweep",
                    },
                    ensure_ascii=False,
                )
                connection.execute(
                    """
                    UPDATE runtime_task
                    SET status='failed', progress=100, message=?, technical_detail=?,
                        finished_at=COALESCE(finished_at, ?)
                    WHERE task_id=? AND status IN ('running', 'pending')
                    """,
                    (message, technical_detail, finished_at, row["task_id"]),
                )
                payload = dict(row)
                payload.update(
                    {
                        "status": "failed",
                        "progress": 100,
                        "message": message,
                        "technical_detail": technical_detail,
                        "finished_at": payload.get("finished_at") or finished_at,
                    }
                )
                updated.append(build_runtime_task_record(payload))
        return updated

    def dump_runtime_tasks(self, limit: int = 10000) -> list[dict[str, object]]:
        with db_session() as connection:
            rows = connection.execute(
                """
                SELECT task_id, task_type, status, progress, message, technical_detail,
                       started_at, finished_at, created_at
                FROM runtime_task
                ORDER BY id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [dict(row) for row in rows]

    def restore_runtime_tasks(self, rows: list[dict[str, object]]) -> None:
        if not rows:
            return
        with db_session() as connection:
            connection.executemany(
                """
                INSERT INTO runtime_task(task_id, task_type, status, progress, message, technical_detail, started_at, finished_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(task_id) DO UPDATE SET
                    task_type = excluded.task_type,
                    status = excluded.status,
                    progress = excluded.progress,
                    message = excluded.message,
                    technical_detail = excluded.technical_detail,
                    started_at = excluded.started_at,
                    finished_at = excluded.finished_at,
                    created_at = excluded.created_at
                """,
                [
                    (
                        row["task_id"],
                        row["task_type"],
                        row["status"],
                        row["progress"],
                        row["message"],
                        row.get("technical_detail"),
                        row.get("started_at"),
                        row.get("finished_at"),
                        row["created_at"],
                    )
                    for row in rows
                ],
            )

    def cleanup_old_records(self, log_retention_days: int, task_retention_days: int, archive_dir: Path) -> MaintenanceCleanupResult:
        log_cutoff = self._cutoff_date(log_retention_days)
        task_cutoff = self._cutoff_date(task_retention_days)
        archive_dir.mkdir(parents=True, exist_ok=True)
        archive_path = archive_dir / f"maintenance_cleanup_{now_text().replace(':', '').replace(' ', '_')}.zip"
        tables = [
            ("system_log", "created_at", log_cutoff),
            ("operation_log", "created_at", log_cutoff),
            ("sync_log", "created_at", log_cutoff),
            ("execution_log", "created_at", log_cutoff),
            ("runtime_task", "created_at", task_cutoff),
        ]
        archived: dict[str, list[dict[str, object]]] = {}
        deleted: dict[str, int] = {}
        with db_session() as connection:
            for table, date_field, cutoff in tables:
                active_guard = " AND status NOT IN ('running', 'pending')" if table == "runtime_task" else ""
                rows = connection.execute(
                    f"SELECT * FROM {table} WHERE substr({date_field}, 1, 10) < ?{active_guard} ORDER BY id ASC",
                    (cutoff,),
                ).fetchall()
                archived[table] = [dict(row) for row in rows]
                deleted[table] = len(rows)
                if rows:
                    connection.execute(f"DELETE FROM {table} WHERE substr({date_field}, 1, 10) < ?{active_guard}", (cutoff,))
        if any(deleted.values()):
            with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for table, rows in archived.items():
                    archive.writestr(f"{table}.json", json.dumps(rows, ensure_ascii=False, indent=2))
        else:
            archive_path = None
        return MaintenanceCleanupResult(
            archive_path=str(archive_path) if archive_path else None,
            system_log_deleted=deleted["system_log"],
            operation_log_deleted=deleted["operation_log"],
            sync_log_deleted=deleted["sync_log"],
            execution_log_deleted=deleted["execution_log"],
            runtime_task_deleted=deleted["runtime_task"],
        )

    def add_environment_results(self, task_id: str, results: list[dict[str, str | None]]) -> None:
        created_at = now_text()
        with db_session() as connection:
            connection.execute("DELETE FROM environment_check WHERE task_id = ?", (task_id,))
            connection.executemany(
                """
                INSERT INTO environment_check(
                    task_id, check_item, status, message, suggestion, technical_detail, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        task_id,
                        item["check_item"],
                        item["status"],
                        item["message"],
                        item.get("suggestion"),
                        item.get("technical_detail"),
                        created_at,
                    )
                    for item in results
                ],
            )

    def list_environment_results(self, task_id: str | None = None) -> list[EnvironmentCheckResult]:
        params: list[object] = []
        if task_id is None:
            with db_session() as connection:
                latest = connection.execute(
                    "SELECT task_id FROM environment_check ORDER BY created_at DESC, id DESC LIMIT 1"
                ).fetchone()
            task_id = latest["task_id"] if latest else None
        sql = """
            SELECT id, task_id, check_item, status, message, suggestion, technical_detail, created_at
            FROM environment_check
        """
        if task_id:
            sql += " WHERE task_id = ?"
            params.append(task_id)
        sql += " ORDER BY id ASC"
        with db_session() as connection:
            rows = connection.execute(sql, params).fetchall()
        return [EnvironmentCheckResult(**dict(row)) for row in rows]

    def add_system_log(
        self,
        module: str,
        level: str,
        message: str,
        technical_detail: str | None = None,
        related_id: str | None = None,
    ) -> None:
        with db_session() as connection:
            connection.execute(
                """
                INSERT INTO system_log(module, level, message, technical_detail, related_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (module, level, message, technical_detail, related_id, now_text()),
            )

    def add_operation_log(
        self,
        module: str,
        action: str,
        target_type: str,
        target_id: str | None,
        result: str,
        message: str,
        technical_detail: str | None = None,
    ) -> None:
        created_at = now_text()
        with db_session() as connection:
            if action == "保存设置" and target_type == "app_config":
                duplicate = connection.execute(
                    """
                    SELECT id
                    FROM operation_log
                    WHERE module = ? AND action = ? AND target_type = ? AND COALESCE(target_id, '') = COALESCE(?, '')
                      AND result = ? AND created_at >= datetime(?, '-30 seconds')
                    ORDER BY created_at DESC, id DESC
                    LIMIT 1
                    """,
                    (module, action, target_type, target_id, result, created_at),
                ).fetchone()
                if duplicate:
                    connection.execute(
                        """
                        UPDATE operation_log
                        SET message = ?, technical_detail = ?, created_at = ?
                        WHERE id = ?
                        """,
                        (message, technical_detail, created_at, duplicate["id"]),
                    )
                    system_log_update = connection.execute(
                        """
                        UPDATE system_log
                        SET level = ?, message = ?, technical_detail = ?, created_at = ?
                        WHERE id = (
                            SELECT id
                            FROM system_log
                            WHERE module = ? AND COALESCE(related_id, '') = COALESCE(?, '')
                              AND created_at >= datetime(?, '-30 seconds')
                            ORDER BY created_at DESC, id DESC
                            LIMIT 1
                        )
                        """,
                        ("info" if result == "成功" else "error", message, technical_detail, created_at, module, target_id, created_at),
                    )
                    if system_log_update.rowcount == 0:
                        connection.execute(
                            """
                            INSERT INTO system_log(module, level, message, technical_detail, related_id, created_at)
                            VALUES (?, ?, ?, ?, ?, ?)
                            """,
                            (module, "info" if result == "成功" else "error", message, technical_detail, target_id, created_at),
                        )
                    return
            connection.execute(
                """
                INSERT INTO operation_log(
                    module, action, target_type, target_id, result, message, technical_detail, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (module, action, target_type, target_id, result, message, technical_detail, created_at),
            )
            connection.execute(
                """
                INSERT INTO system_log(module, level, message, technical_detail, related_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (module, "info" if result == "成功" else "error", message, technical_detail, target_id, created_at),
            )

    def add_backup_record(self, backup_name: str, backup_path: Path, backup_size: int, status: str) -> BackupRecord:
        with db_session() as connection:
            cursor = connection.execute(
                """
                INSERT INTO backup_record(backup_name, backup_path, backup_size, status, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (backup_name, str(backup_path), backup_size, status, now_text()),
            )
            backup_id = cursor.lastrowid
            row = connection.execute(
                "SELECT id, backup_name, backup_path, backup_size, status, created_at FROM backup_record WHERE id = ?",
                (backup_id,),
            ).fetchone()
        return BackupRecord(**dict(row))

    def get_backup(self, backup_id: int) -> BackupRecord:
        with db_session() as connection:
            row = connection.execute(
                "SELECT id, backup_name, backup_path, backup_size, status, created_at FROM backup_record WHERE id = ?",
                (backup_id,),
            ).fetchone()
        if row is None:
            raise KeyError(str(backup_id))
        return BackupRecord(**dict(row))

    def delete_backup(self, backup_id: int) -> None:
        with db_session() as connection:
            connection.execute("DELETE FROM backup_record WHERE id = ?", (backup_id,))

    def list_backups(self) -> list[BackupRecord]:
        with db_session() as connection:
            rows = connection.execute(
                """
                SELECT id, backup_name, backup_path, backup_size, status, created_at
                FROM backup_record ORDER BY created_at DESC
                """
            ).fetchall()
        return [BackupRecord(**dict(row)) for row in rows]

    def count_backups(self) -> int:
        with db_session() as connection:
            row = connection.execute("SELECT COUNT(*) AS total FROM backup_record").fetchone()
        return int(row["total"])

    def list_backups_page(self, query: PageQuery) -> PageResult[BackupRecord]:
        clauses: list[str] = []
        params: list[object] = []
        if query.keyword:
            keyword = f"%{query.keyword}%"
            clauses.append("(backup_name LIKE ? OR backup_path LIKE ? OR status LIKE ?)")
            params.extend([keyword, keyword, keyword])
        append_status_filter(clauses, params, "status", query)
        append_date_filter(clauses, params, "created_at", query)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        offset = (query.page - 1) * query.page_size
        order_by = build_sort_clause(
            query,
            {
                "created_at": "created_at",
                "backup_name": "backup_name",
                "backup_size": "backup_size",
                "status": "status",
            },
            "created_at",
        )
        with db_session() as connection:
            total = connection.execute(f"SELECT COUNT(*) AS total FROM backup_record {where}", params).fetchone()["total"]
            rows = connection.execute(
                f"""
                SELECT id, backup_name, backup_path, backup_size, status, created_at
                FROM backup_record {where}
                ORDER BY {order_by}, id DESC
                LIMIT ? OFFSET ?
                """,
                [*params, query.page_size, offset],
            ).fetchall()
        return PageResult(
            items=[BackupRecord(**dict(row)) for row in rows],
            page=query.page,
            page_size=query.page_size,
            total=total,
            has_more=offset + query.page_size < total,
        )

    def restore_backup_records(self, records: list[BackupRecord]) -> None:
        if not records:
            return
        with db_session() as connection:
            connection.executemany(
                """
                INSERT INTO backup_record(id, backup_name, backup_path, backup_size, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    backup_name = excluded.backup_name,
                    backup_path = excluded.backup_path,
                    backup_size = excluded.backup_size,
                    status = excluded.status,
                    created_at = excluded.created_at
                """,
                [
                    (record.id, record.backup_name, record.backup_path, record.backup_size, record.status, record.created_at)
                    for record in records
                ],
            )

    def list_logs(self, query: PageQuery, module: str | None = None, level: str | None = None) -> PageResult[SystemLogRecord]:
        clauses: list[str] = []
        params: list[object] = []
        if module:
            clauses.append("module = ?")
            params.append(module)
        if level:
            clauses.append("level = ?")
            params.append(level)
        if query.keyword:
            clauses.append("(message LIKE ? OR technical_detail LIKE ?)")
            keyword = f"%{query.keyword}%"
            params.extend([keyword, keyword])
        append_date_filter(clauses, params, "created_at", query)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        offset = (query.page - 1) * query.page_size
        order_by = build_sort_clause(query, {"created_at": "created_at", "module": "module", "level": "level"}, "created_at")
        with db_session() as connection:
            total = connection.execute(f"SELECT COUNT(*) AS total FROM system_log {where}", params).fetchone()["total"]
            rows = connection.execute(
                f"""
                SELECT id, module, level, message, technical_detail, related_id, created_at
                FROM system_log {where}
                ORDER BY {order_by}, id DESC
                LIMIT ? OFFSET ?
                """,
                [*params, query.page_size, offset],
            ).fetchall()
        return PageResult(
            items=[SystemLogRecord(**dict(row)) for row in rows],
            page=query.page,
            page_size=query.page_size,
            total=total,
            has_more=offset + query.page_size < total,
        )

    def export_logs(self, limit: int = 10000) -> list[dict[str, object]]:
        with db_session() as connection:
            rows = connection.execute(
                """
                SELECT id, module, level, message, technical_detail, related_id, created_at
                FROM system_log
                ORDER BY created_at DESC, id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [dict(row) for row in rows]

    def list_operations(self, query: PageQuery) -> PageResult[OperationLogRecord]:
        clauses: list[str] = []
        params: list[object] = []
        if query.keyword:
            keyword = f"%{query.keyword}%"
            clauses.append("(message LIKE ? OR action LIKE ? OR module LIKE ?)")
            params.extend([keyword, keyword, keyword])
        append_status_filter(clauses, params, "result", query)
        append_date_filter(clauses, params, "created_at", query)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        offset = (query.page - 1) * query.page_size
        order_by = build_sort_clause(query, {"created_at": "created_at", "module": "module", "action": "action", "result": "result"}, "created_at")
        with db_session() as connection:
            total = connection.execute(f"SELECT COUNT(*) AS total FROM operation_log {where}", params).fetchone()["total"]
            rows = connection.execute(
                f"""
                SELECT id, module, action, target_type, target_id, result, message, technical_detail, created_at
                FROM operation_log {where}
                ORDER BY {order_by}, id DESC
                LIMIT ? OFFSET ?
                """,
                [*params, query.page_size, offset],
            ).fetchall()
        return PageResult(
            items=[OperationLogRecord(**dict(row)) for row in rows],
            page=query.page,
            page_size=query.page_size,
            total=total,
            has_more=offset + query.page_size < total,
        )

    def database_size(self) -> int:
        return settings.database_path.stat().st_size if settings.database_path.exists() else 0

    def directory_size(self, path: Path) -> int:
        if not path.exists():
            return 0
        return sum(file.stat().st_size for file in path.rglob("*") if file.is_file())

    def _cutoff_date(self, days: int) -> str:
        return (datetime.now() - timedelta(days=max(days, 1))).strftime("%Y-%m-%d")
