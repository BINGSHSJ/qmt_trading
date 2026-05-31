from pathlib import Path
from typing import Any

from backend.core.database import db_session
from backend.repositories.query_utils import append_date_filter, append_status_filter, build_sort_clause
from backend.repositories.system.system_repository import now_text
from backend.schemas.common import PageQuery, PageResult
from backend.schemas.strategy_dev import (
    StrategyFileRecord,
    StrategyRunRecord,
    StrategySignalRecord,
    StrategyVersionDetail,
    StrategyVersionRecord,
)


class StrategyRepository:
    def upsert_strategy_file(
        self,
        file_name: str,
        file_path: Path,
        strategy_name: str,
        version: str,
        description: str,
        modified_at: str | None = None,
    ) -> StrategyFileRecord:
        current = now_text()
        last_modified_at = modified_at or current
        with db_session() as connection:
            connection.execute(
                """
                INSERT INTO strategy_file(
                    file_name, file_path, strategy_name, version, description, status,
                    last_modified_at, created_at
                ) VALUES (?, ?, ?, ?, ?, 'enabled', ?, ?)
                ON CONFLICT(file_path) DO UPDATE SET
                    strategy_name=excluded.strategy_name,
                    version=excluded.version,
                    description=excluded.description,
                    last_modified_at=excluded.last_modified_at
                """,
                (file_name, str(file_path), strategy_name, version, description, last_modified_at, current),
            )
            row = connection.execute(
                """
                SELECT sf.*, (
                    SELECT COUNT(*) FROM strategy_signal ss
                    WHERE ss.strategy_id = sf.id AND substr(ss.signal_time, 1, 10) = substr(?, 1, 10)
                ) AS today_signal_count
                FROM strategy_file sf WHERE file_path = ?
                """,
                (current, str(file_path)),
            ).fetchone()
        return StrategyFileRecord(**dict(row))

    def list_files(self, query: PageQuery) -> PageResult[StrategyFileRecord]:
        clauses: list[str] = []
        params: list[object] = []
        last_run_at_expr = """
            COALESCE(
                sf.last_run_at,
                (
                    SELECT MAX(COALESCE(srl.finished_at, srl.started_at))
                    FROM strategy_run_log srl
                    WHERE srl.strategy_id = sf.id
                )
            )
        """
        if query.keyword:
            clauses.append("(file_name LIKE ? OR strategy_name LIKE ? OR description LIKE ?)")
            keyword = f"%{query.keyword}%"
            params.extend([keyword, keyword, keyword])
        append_status_filter(clauses, params, "status", query)
        append_date_filter(clauses, params, "COALESCE(last_modified_at, created_at)", query)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        offset = (query.page - 1) * query.page_size
        current = now_text()
        order_by = build_sort_clause(
            query,
            {
                "created_at": "sf.created_at",
                "last_modified_at": "sf.last_modified_at",
                "last_run_at": last_run_at_expr,
                "strategy_name": "sf.strategy_name",
                "file_name": "sf.file_name",
                "status": "sf.status",
            },
            "created_at",
        )
        with db_session() as connection:
            total = connection.execute(f"SELECT COUNT(*) AS total FROM strategy_file {where}", params).fetchone()["total"]
            rows = connection.execute(
                f"""
                SELECT
                    sf.id,
                    sf.file_name,
                    sf.file_path,
                    sf.strategy_name,
                    sf.version,
                    sf.description,
                    sf.status,
                    sf.last_modified_at,
                    {last_run_at_expr} AS last_run_at,
                    sf.created_at,
                    (
                    SELECT COUNT(*) FROM strategy_signal ss
                    WHERE ss.strategy_id = sf.id AND substr(ss.signal_time, 1, 10) = substr(?, 1, 10)
                ) AS today_signal_count
                FROM strategy_file sf {where}
                ORDER BY {order_by}, sf.id DESC LIMIT ? OFFSET ?
                """,
                [current, *params, query.page_size, offset],
            ).fetchall()
        return PageResult(
            items=[StrategyFileRecord(**dict(row)) for row in rows],
            page=query.page,
            page_size=query.page_size,
            total=total,
            has_more=offset + query.page_size < total,
        )

    def list_file_records(self, limit: int = 10000) -> list[StrategyFileRecord]:
        with db_session() as connection:
            rows = connection.execute(
                """
                SELECT sf.*, 0 AS today_signal_count
                FROM strategy_file sf
                ORDER BY id ASC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [StrategyFileRecord(**dict(row)) for row in rows]

    def get_file(self, strategy_id: int) -> StrategyFileRecord:
        with db_session() as connection:
            row = connection.execute(
                """
                SELECT sf.*, 0 AS today_signal_count
                FROM strategy_file sf WHERE id = ?
                """,
                (strategy_id,),
            ).fetchone()
        if row is None:
            raise KeyError(str(strategy_id))
        return StrategyFileRecord(**dict(row))

    def update_file_metadata(self, strategy_id: int, strategy_name: str, version: str, description: str) -> None:
        with db_session() as connection:
            connection.execute(
                """
                UPDATE strategy_file
                SET strategy_name=?, version=?, description=?, last_modified_at=?
                WHERE id=?
                """,
                (strategy_name, version, description, now_text(), strategy_id),
            )

    def update_status(self, strategy_id: int, status: str) -> None:
        with db_session() as connection:
            connection.execute("UPDATE strategy_file SET status=?, last_modified_at=? WHERE id=?", (status, now_text(), strategy_id))

    def delete_file_record(self, strategy_id: int) -> None:
        with db_session() as connection:
            connection.execute("DELETE FROM strategy_file WHERE id=?", (strategy_id,))

    def add_version(self, strategy_id: int, version_no: str, code_content: str, code_hash: str, remark: str | None) -> StrategyVersionRecord:
        current = now_text()
        with db_session() as connection:
            cursor = connection.execute(
                """
                INSERT INTO strategy_version(strategy_id, version_no, code_content, code_hash, remark, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (strategy_id, version_no, code_content, code_hash, remark, current),
            )
            row = connection.execute(
                "SELECT id, strategy_id, version_no, code_hash, remark, created_at FROM strategy_version WHERE id=?",
                (cursor.lastrowid,),
            ).fetchone()
        return StrategyVersionRecord(**dict(row))

    def list_versions(self, strategy_id: int, query: PageQuery) -> PageResult[StrategyVersionRecord]:
        clauses = ["strategy_id=?"]
        params: list[object] = [strategy_id]
        if query.keyword:
            keyword = f"%{query.keyword}%"
            clauses.append("(version_no LIKE ? OR code_hash LIKE ? OR remark LIKE ?)")
            params.extend([keyword, keyword, keyword])
        append_date_filter(clauses, params, "created_at", query)
        where = f"WHERE {' AND '.join(clauses)}"
        offset = (query.page - 1) * query.page_size
        order_by = build_sort_clause(
            query,
            {
                "created_at": "created_at",
                "version_no": "version_no",
                "code_hash": "code_hash",
            },
            "created_at",
        )
        with db_session() as connection:
            total = connection.execute(f"SELECT COUNT(*) AS total FROM strategy_version {where}", params).fetchone()["total"]
            rows = connection.execute(
                f"""
                SELECT id, strategy_id, version_no, code_hash, remark, created_at
                FROM strategy_version {where}
                ORDER BY {order_by}, id DESC LIMIT ? OFFSET ?
                """,
                [*params, query.page_size, offset],
            ).fetchall()
        return PageResult(
            items=[StrategyVersionRecord(**dict(row)) for row in rows],
            page=query.page,
            page_size=query.page_size,
            total=total,
            has_more=offset + query.page_size < total,
        )

    def count_versions(self, strategy_id: int) -> int:
        with db_session() as connection:
            row = connection.execute("SELECT COUNT(*) AS total FROM strategy_version WHERE strategy_id=?", (strategy_id,)).fetchone()
        return int(row["total"] if row else 0)

    def get_version(self, version_id: int) -> StrategyVersionDetail:
        with db_session() as connection:
            row = connection.execute(
                """
                SELECT id, strategy_id, version_no, code_content, code_hash, remark, created_at
                FROM strategy_version WHERE id=?
                """,
                (version_id,),
            ).fetchone()
        if row is None:
            raise KeyError(str(version_id))
        return StrategyVersionDetail(**dict(row))

    def create_run(
        self,
        run_id: str,
        strategy_id: int,
        task_id: str,
        strategy_name: str = "",
        strategy_file_name: str = "",
        strategy_version: str = "",
        strategy_code_hash: str = "",
    ) -> StrategyRunRecord:
        current = now_text()
        with db_session() as connection:
            connection.execute(
                """
                INSERT INTO strategy_run_log(
                    run_id, strategy_id, strategy_name, strategy_file_name, strategy_version,
                    strategy_code_hash, task_id, status, signal_count, started_at, message
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, 'running', 0, ?, '策略运行中。')
                """,
                (run_id, strategy_id, strategy_name, strategy_file_name, strategy_version, strategy_code_hash, task_id, current),
            )
            row = connection.execute("SELECT * FROM strategy_run_log WHERE run_id=?", (run_id,)).fetchone()
        return StrategyRunRecord(**dict(row))

    def update_run(
        self,
        run_id: str,
        status: str,
        signal_count: int,
        message: str,
        technical_detail: str | None = None,
        finished: bool = False,
    ) -> None:
        with db_session() as connection:
            connection.execute(
                """
                UPDATE strategy_run_log
                SET status=?, signal_count=?, message=?, technical_detail=?, finished_at=COALESCE(?, finished_at)
                WHERE run_id=?
                """,
                (status, signal_count, message, technical_detail, now_text() if finished else None, run_id),
            )

    def cancel_run_by_task(self, task_id: str) -> None:
        with db_session() as connection:
            connection.execute(
                """
                UPDATE strategy_run_log
                SET status='cancelled', message='策略运行任务已取消。', finished_at=COALESCE(finished_at, ?)
                WHERE task_id=? AND status IN ('running', 'pending')
                """,
                (now_text(), task_id),
            )

    def fail_run_by_task(self, task_id: str, message: str, technical_detail: str | None = None) -> None:
        with db_session() as connection:
            connection.execute(
                """
                UPDATE strategy_run_log
                SET status='failed', message=?, technical_detail=?, finished_at=COALESCE(finished_at, ?)
                WHERE task_id=? AND status IN ('running', 'pending')
                """,
                (message, technical_detail, now_text(), task_id),
            )

    def mark_last_run(self, strategy_id: int) -> None:
        with db_session() as connection:
            connection.execute("UPDATE strategy_file SET last_run_at=? WHERE id=?", (now_text(), strategy_id))

    def list_runs(self, query: PageQuery) -> PageResult[StrategyRunRecord]:
        clauses: list[str] = []
        params: list[object] = []
        append_status_filter(clauses, params, "status", query)
        append_date_filter(clauses, params, "COALESCE(started_at, finished_at)", query)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        offset = (query.page - 1) * query.page_size
        order_by = build_sort_clause(
            query,
            {"created_at": "started_at", "started_at": "started_at", "finished_at": "finished_at", "status": "status", "signal_count": "signal_count"},
            "created_at",
        )
        with db_session() as connection:
            total = connection.execute(f"SELECT COUNT(*) AS total FROM strategy_run_log {where}", params).fetchone()["total"]
            rows = connection.execute(
                f"SELECT * FROM strategy_run_log {where} ORDER BY {order_by}, id DESC LIMIT ? OFFSET ?",
                [*params, query.page_size, offset],
            ).fetchall()
        return PageResult(
            items=[StrategyRunRecord(**dict(row)) for row in rows],
            page=query.page,
            page_size=query.page_size,
            total=total,
            has_more=offset + query.page_size < total,
        )

    def get_run(self, run_id: str) -> StrategyRunRecord:
        with db_session() as connection:
            row = connection.execute("SELECT * FROM strategy_run_log WHERE run_id=?", (run_id,)).fetchone()
        if row is None:
            raise KeyError(run_id)
        return StrategyRunRecord(**dict(row))

    def add_signals(self, strategy_id: int, run_id: str, signals: list[dict[str, Any]]) -> int:
        current = now_text()
        with db_session() as connection:
            connection.executemany(
                """
                INSERT INTO strategy_signal(
                    strategy_id, run_id, symbol, name, action, price, amount, reason, status,
                    signal_time, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '未处理', ?, ?)
                """,
                [
                    (
                        strategy_id, run_id, item["symbol"], item.get("name") or "", item["action"],
                        float(item["price"]), item.get("amount"), item["reason"],
                        item.get("signal_time") or current, current,
                    )
                    for item in signals
                ],
            )
        return len(signals)

    def list_signals(self, query: PageQuery) -> PageResult[StrategySignalRecord]:
        clauses: list[str] = []
        params: list[object] = []
        if query.keyword:
            clauses.append("(ss.symbol LIKE ? OR ss.name LIKE ? OR ss.reason LIKE ? OR sf.strategy_name LIKE ?)")
            keyword = f"%{query.keyword}%"
            params.extend([keyword, keyword, keyword, keyword])
        append_status_filter(clauses, params, "ss.status", query)
        append_date_filter(clauses, params, "ss.signal_time", query)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        offset = (query.page - 1) * query.page_size
        order_by = build_sort_clause(
            query,
            {"created_at": "ss.created_at", "signal_time": "ss.signal_time", "symbol": "ss.symbol", "action": "ss.action", "status": "ss.status", "strategy_name": "sf.strategy_name"},
            "signal_time",
        )
        with db_session() as connection:
            total = connection.execute(
                f"SELECT COUNT(*) AS total FROM strategy_signal ss JOIN strategy_file sf ON sf.id=ss.strategy_id {where}",
                params,
            ).fetchone()["total"]
            rows = connection.execute(
                f"""
                SELECT ss.*, sf.strategy_name
                FROM strategy_signal ss JOIN strategy_file sf ON sf.id=ss.strategy_id
                {where}
                ORDER BY {order_by}, ss.id DESC LIMIT ? OFFSET ?
                """,
                [*params, query.page_size, offset],
            ).fetchall()
        return PageResult(
            items=[StrategySignalRecord(**dict(row)) for row in rows],
            page=query.page,
            page_size=query.page_size,
            total=total,
            has_more=offset + query.page_size < total,
        )

    def get_signal(self, signal_id: int) -> StrategySignalRecord:
        with db_session() as connection:
            row = connection.execute(
                """
                SELECT ss.*, sf.strategy_name
                FROM strategy_signal ss JOIN strategy_file sf ON sf.id=ss.strategy_id
                WHERE ss.id=?
                """,
                (signal_id,),
            ).fetchone()
        if row is None:
            raise KeyError(str(signal_id))
        return StrategySignalRecord(**dict(row))

    def update_signal_status(self, signal_id: int, status: str) -> StrategySignalRecord:
        with db_session() as connection:
            connection.execute("UPDATE strategy_signal SET status=? WHERE id=?", (status, signal_id))
        return self.get_signal(signal_id)

    def add_error(self, strategy_id: int, run_id: str, message: str, technical_detail: str) -> None:
        with db_session() as connection:
            connection.execute(
                """
                INSERT INTO strategy_error_log(strategy_id, run_id, message, technical_detail, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (strategy_id, run_id, message, technical_detail, now_text()),
            )
