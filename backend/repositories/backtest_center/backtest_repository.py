import json
from typing import Any

from backend.core.database import db_session
from backend.repositories.query_utils import append_date_filter, append_status_filter, build_sort_clause
from backend.repositories.system.system_repository import now_text
from backend.schemas.backtest import (
    BacktestCreateRequest,
    BacktestEquityRecord,
    BacktestLogRecord,
    BacktestManifestRecord,
    BacktestResultRecord,
    BacktestSignalRecord,
    BacktestStrategySnapshotCheck,
    BacktestTaskRecord,
    BacktestTradeRecord,
)
from backend.schemas.common import PageQuery, PageResult


BACKTEST_STRATEGY_NAME_SQL = """
COALESCE(
    NULLIF(bm.strategy_name, ''),
    NULLIF(sf.strategy_name, ''),
    '策略ID ' || bt.strategy_id || '（当前文件记录缺失）'
)
"""


class BacktestRepository:
    def create_task(self, task_id: str, request: BacktestCreateRequest) -> BacktestTaskRecord:
        current = now_text()
        with db_session() as connection:
            connection.execute(
                """
                INSERT INTO backtest_task(
                    task_id, backtest_name, strategy_id, start_date, end_date, initial_cash,
                    single_order_amount, data_frequency, fill_mode, fee_rate, stamp_tax_rate,
                    slippage, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?)
                """,
                (
                    task_id, request.backtest_name, request.strategy_id, request.start_date,
                    request.end_date, request.initial_cash, request.single_order_amount,
                    request.data_frequency, request.fill_mode, request.fee_rate,
                    request.stamp_tax_rate, request.slippage, current,
                ),
            )
        return self.get_task(task_id)

    def update_status(self, task_id: str, status: str) -> None:
        with db_session() as connection:
            connection.execute("UPDATE backtest_task SET status=? WHERE task_id=?", (status, task_id))

    def get_task(self, task_id: str) -> BacktestTaskRecord:
        with db_session() as connection:
            row = connection.execute(
                f"""
                SELECT bt.*, {BACKTEST_STRATEGY_NAME_SQL} AS strategy_name
                FROM backtest_task bt
                LEFT JOIN strategy_file sf ON sf.id = bt.strategy_id
                LEFT JOIN backtest_manifest bm ON bm.backtest_id = bt.id
                WHERE bt.task_id = ?
                """,
                (task_id,),
            ).fetchone()
        if row is None:
            raise KeyError(task_id)
        return BacktestTaskRecord(**dict(row))

    def list_tasks(self, query: PageQuery) -> PageResult[BacktestTaskRecord]:
        clauses: list[str] = []
        params: list[object] = []
        if query.keyword:
            keyword = f"%{query.keyword}%"
            clauses.append(
                f"(bt.backtest_name LIKE ? OR {BACKTEST_STRATEGY_NAME_SQL} LIKE ? "
                "OR bm.strategy_file_name LIKE ? OR bm.strategy_code_hash LIKE ? OR bt.task_id LIKE ?)"
            )
            params.extend([keyword, keyword, keyword, keyword, keyword])
        append_status_filter(clauses, params, "bt.status", query)
        append_date_filter(clauses, params, "bt.created_at", query)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        offset = (query.page - 1) * query.page_size
        order_by = build_sort_clause(
            query,
            {
                "created_at": "bt.created_at",
                "backtest_name": "bt.backtest_name",
                "strategy_name": BACKTEST_STRATEGY_NAME_SQL,
                "status": "bt.status",
                "start_date": "bt.start_date",
                "end_date": "bt.end_date",
            },
            "created_at",
        )
        with db_session() as connection:
            total = connection.execute(
                f"""
                SELECT COUNT(*) AS total
                FROM backtest_task bt
                LEFT JOIN strategy_file sf ON sf.id = bt.strategy_id
                LEFT JOIN backtest_manifest bm ON bm.backtest_id = bt.id
                {where}
                """,
                params,
            ).fetchone()["total"]
            rows = connection.execute(
                f"""
                SELECT bt.*, {BACKTEST_STRATEGY_NAME_SQL} AS strategy_name
                FROM backtest_task bt
                LEFT JOIN strategy_file sf ON sf.id = bt.strategy_id
                LEFT JOIN backtest_manifest bm ON bm.backtest_id = bt.id
                {where}
                ORDER BY {order_by}, bt.id DESC LIMIT ? OFFSET ?
                """,
                [*params, query.page_size, offset],
            ).fetchall()
        return PageResult(
            items=[BacktestTaskRecord(**dict(row)) for row in rows],
            page=query.page,
            page_size=query.page_size,
            total=total,
            has_more=offset + query.page_size < total,
        )

    def delete_task(self, task_id: str) -> None:
        task = self.get_task(task_id)
        with db_session() as connection:
            connection.execute("DELETE FROM backtest_log WHERE backtest_id=?", (task.id,))
            connection.execute("DELETE FROM backtest_equity WHERE backtest_id=?", (task.id,))
            connection.execute("DELETE FROM backtest_trade WHERE backtest_id=?", (task.id,))
            connection.execute("DELETE FROM backtest_signal WHERE backtest_id=?", (task.id,))
            connection.execute("DELETE FROM backtest_manifest WHERE backtest_id=?", (task.id,))
            connection.execute("DELETE FROM backtest_result WHERE backtest_id=?", (task.id,))
            connection.execute("DELETE FROM backtest_task WHERE id=?", (task.id,))

    def save_result(self, backtest_id: int, metrics: dict[str, Any]) -> BacktestResultRecord:
        current = now_text()
        with db_session() as connection:
            connection.execute("DELETE FROM backtest_result WHERE backtest_id=?", (backtest_id,))
            cursor = connection.execute(
                """
                INSERT INTO backtest_result(
                    backtest_id, total_return, annual_return, max_drawdown, win_rate,
                    trade_count, buy_count, sell_count, profit_loss_ratio, average_holding_days,
                    ending_cash, open_position_count, open_market_value, total_fee, realized_pnl,
                    final_cash, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    backtest_id, metrics["total_return"], metrics["annual_return"],
                    metrics["max_drawdown"], metrics["win_rate"], metrics["trade_count"],
                    metrics["buy_count"], metrics["sell_count"],
                    metrics["profit_loss_ratio"], metrics["average_holding_days"],
                    metrics["ending_cash"], metrics["open_position_count"],
                    metrics["open_market_value"], metrics["total_fee"], metrics["realized_pnl"],
                    metrics["final_cash"], current,
                ),
            )
            row = connection.execute("SELECT * FROM backtest_result WHERE id=?", (cursor.lastrowid,)).fetchone()
        return BacktestResultRecord(**dict(row))

    def save_manifest(self, backtest_id: int, manifest: dict[str, Any]) -> BacktestManifestRecord:
        current = now_text()
        with db_session() as connection:
            connection.execute(
                """
                INSERT INTO backtest_manifest(
                    backtest_id, strategy_file_name, strategy_code_hash, strategy_name,
                    strategy_version, data_frequency, fill_mode, qmt_mode, qmt_path,
                    account_id, data_coverage_snapshot, universe_summary, rule_snapshot,
                    engine_version, trust_level, trust_message, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(backtest_id) DO UPDATE SET
                    strategy_file_name=excluded.strategy_file_name,
                    strategy_code_hash=excluded.strategy_code_hash,
                    strategy_name=excluded.strategy_name,
                    strategy_version=excluded.strategy_version,
                    data_frequency=excluded.data_frequency,
                    fill_mode=excluded.fill_mode,
                    qmt_mode=excluded.qmt_mode,
                    qmt_path=excluded.qmt_path,
                    account_id=excluded.account_id,
                    data_coverage_snapshot=excluded.data_coverage_snapshot,
                    universe_summary=excluded.universe_summary,
                    rule_snapshot=excluded.rule_snapshot,
                    engine_version=excluded.engine_version,
                    trust_level=excluded.trust_level,
                    trust_message=excluded.trust_message,
                    created_at=excluded.created_at
                """,
                (
                    backtest_id,
                    manifest["strategy_file_name"],
                    manifest["strategy_code_hash"],
                    manifest["strategy_name"],
                    manifest.get("strategy_version") or "",
                    manifest["data_frequency"],
                    manifest["fill_mode"],
                    manifest["qmt_mode"],
                    manifest.get("qmt_path") or "",
                    manifest.get("account_id") or "",
                    manifest["data_coverage_snapshot"],
                    manifest["universe_summary"],
                    manifest["rule_snapshot"],
                    manifest.get("engine_version") or "1.0.0",
                    manifest["trust_level"],
                    manifest["trust_message"],
                    current,
                ),
            )
            row = connection.execute("SELECT * FROM backtest_manifest WHERE backtest_id=?", (backtest_id,)).fetchone()
        return BacktestManifestRecord(**dict(row))

    def get_manifest(self, task_id: str) -> BacktestManifestRecord | None:
        task = self.get_task(task_id)
        with db_session() as connection:
            row = connection.execute("SELECT * FROM backtest_manifest WHERE backtest_id=?", (task.id,)).fetchone()
        return BacktestManifestRecord(**dict(row)) if row else None

    def get_strategy_snapshot_check(
        self,
        task: BacktestTaskRecord,
        manifest: BacktestManifestRecord | None,
    ) -> BacktestStrategySnapshotCheck:
        if manifest is None:
            return BacktestStrategySnapshotCheck(
                status="no_manifest",
                message="当前回测缺少 Manifest，无法核对策略运行快照。",
                technical_detail=f"task_id={task.task_id}; strategy_id={task.strategy_id}; manifest=false",
            )
        with db_session() as connection:
            matched = connection.execute(
                """
                SELECT *
                FROM strategy_run_log
                WHERE strategy_id=?
                  AND COALESCE(strategy_code_hash, '')=?
                ORDER BY id DESC
                LIMIT 1
                """,
                (task.strategy_id, manifest.strategy_code_hash),
            ).fetchone()
            latest = connection.execute(
                """
                SELECT *
                FROM strategy_run_log
                WHERE strategy_id=?
                  AND COALESCE(strategy_code_hash, '')<>''
                ORDER BY id DESC
                LIMIT 1
                """,
                (task.strategy_id,),
            ).fetchone()
        detail = {
            "task_id": task.task_id,
            "strategy_id": task.strategy_id,
            "manifest_hash": manifest.strategy_code_hash,
            "manifest_file_name": manifest.strategy_file_name,
            "manifest_version": manifest.strategy_version,
            "matched_run_id": matched["run_id"] if matched else None,
            "latest_run_id": latest["run_id"] if latest else None,
            "latest_hash": latest["strategy_code_hash"] if latest else None,
            "latest_file_name": latest["strategy_file_name"] if latest else None,
            "latest_version": latest["strategy_version"] if latest else None,
        }
        if matched:
            return BacktestStrategySnapshotCheck(
                status="matched",
                message="已找到与本次回测策略代码哈希一致的策略运行记录。",
                manifest_hash=manifest.strategy_code_hash,
                latest_code_hash=latest["strategy_code_hash"] if latest else None,
                matched_run_id=matched["run_id"],
                matched_task_id=matched["task_id"],
                matched_run_status=matched["status"],
                matched_started_at=matched["started_at"],
                matched_finished_at=matched["finished_at"],
                latest_run_id=latest["run_id"] if latest else None,
                latest_task_id=latest["task_id"] if latest else None,
                latest_run_status=latest["status"] if latest else None,
                latest_started_at=latest["started_at"] if latest else None,
                latest_finished_at=latest["finished_at"] if latest else None,
                latest_strategy_file_name=latest["strategy_file_name"] if latest else None,
                latest_strategy_version=latest["strategy_version"] if latest else None,
                technical_detail=json.dumps(detail, ensure_ascii=False),
            )
        if latest:
            return BacktestStrategySnapshotCheck(
                status="unmatched",
                message="未找到与本次回测代码哈希一致的策略运行记录；最新策略运行记录使用了另一份代码。",
                manifest_hash=manifest.strategy_code_hash,
                latest_code_hash=latest["strategy_code_hash"],
                latest_run_id=latest["run_id"],
                latest_task_id=latest["task_id"],
                latest_run_status=latest["status"],
                latest_started_at=latest["started_at"],
                latest_finished_at=latest["finished_at"],
                latest_strategy_file_name=latest["strategy_file_name"],
                latest_strategy_version=latest["strategy_version"],
                technical_detail=json.dumps(detail, ensure_ascii=False),
            )
        return BacktestStrategySnapshotCheck(
            status="no_run_snapshot",
            message="尚未找到该策略的运行快照；回测 Manifest 仍可核对，但无法从策略运行记录反查同一份代码。",
            manifest_hash=manifest.strategy_code_hash,
            technical_detail=json.dumps(detail, ensure_ascii=False),
        )

    def save_trades(self, backtest_id: int, rows: list[dict[str, Any]]) -> None:
        with db_session() as connection:
            connection.execute("DELETE FROM backtest_trade WHERE backtest_id=?", (backtest_id,))
            connection.executemany(
                """
                INSERT INTO backtest_trade(
                    backtest_id, symbol, name, side, price, quantity, amount, fee, trade_time, reason, pnl
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        backtest_id, row["symbol"], row["name"], row["side"], row["price"],
                        row["quantity"], row["amount"], row["fee"], row["trade_time"],
                        row["reason"], row["pnl"],
                    )
                    for row in rows
                ],
            )

    def save_signals(self, backtest_id: int, rows: list[dict[str, Any]]) -> None:
        with db_session() as connection:
            connection.execute("DELETE FROM backtest_signal WHERE backtest_id=?", (backtest_id,))
            connection.executemany(
                """
                INSERT INTO backtest_signal(
                    backtest_id, signal_time, symbol, name, action, price, amount, reason,
                    status, execution_time, execution_price, quantity, skip_reason, is_auto_exit, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        backtest_id,
                        row["signal_time"],
                        row["symbol"],
                        row.get("name") or row["symbol"],
                        row["action"],
                        row.get("price") or 0,
                        row.get("amount"),
                        row.get("reason") or "",
                        row["status"],
                        row.get("execution_time"),
                        row.get("execution_price"),
                        row.get("quantity") or 0,
                        row.get("skip_reason"),
                        1 if row.get("is_auto_exit") else 0,
                        now_text(),
                    )
                    for row in rows
                ],
            )

    def save_equity(self, backtest_id: int, rows: list[dict[str, Any]]) -> None:
        with db_session() as connection:
            connection.execute("DELETE FROM backtest_equity WHERE backtest_id=?", (backtest_id,))
            connection.executemany(
                """
                INSERT INTO backtest_equity(backtest_id, trade_date, equity, cash, market_value, drawdown)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        backtest_id, row["trade_date"], row["equity"], row["cash"],
                        row["market_value"], row["drawdown"],
                    )
                    for row in rows
                ],
            )

    def add_log(self, backtest_id: int, level: str, message: str, technical_detail: str | None = None) -> None:
        with db_session() as connection:
            connection.execute(
                """
                INSERT INTO backtest_log(backtest_id, level, message, technical_detail, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (backtest_id, level, message, technical_detail, now_text()),
            )

    def add_logs(self, backtest_id: int, rows: list[tuple[str, str, str | None]]) -> None:
        if not rows:
            return
        current = now_text()
        with db_session() as connection:
            connection.executemany(
                """
                INSERT INTO backtest_log(backtest_id, level, message, technical_detail, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                [(backtest_id, level, message, technical_detail, current) for level, message, technical_detail in rows],
            )

    def get_result(self, task_id: str) -> BacktestResultRecord | None:
        task = self.get_task(task_id)
        with db_session() as connection:
            row = connection.execute("SELECT * FROM backtest_result WHERE backtest_id=?", (task.id,)).fetchone()
        return BacktestResultRecord(**dict(row)) if row else None

    def list_trades(self, task_id: str, query: PageQuery) -> PageResult[BacktestTradeRecord]:
        task = self.get_task(task_id)
        clauses = ["backtest_id=?"]
        params: list[object] = [task.id]
        if query.keyword:
            keyword = f"%{query.keyword}%"
            clauses.append("(symbol LIKE ? OR name LIKE ? OR side LIKE ? OR reason LIKE ?)")
            params.extend([keyword, keyword, keyword, keyword])
        if query.status in {"BUY", "SELL"}:
            clauses.append("side=?")
            params.append(query.status)
        append_date_filter(clauses, params, "trade_time", query)
        where = f"WHERE {' AND '.join(clauses)}"
        offset = (query.page - 1) * query.page_size
        order_by = build_sort_clause(
            query,
            {"created_at": "trade_time", "trade_time": "trade_time", "symbol": "symbol", "side": "side", "amount": "amount", "pnl": "pnl"},
            "trade_time",
        )
        with db_session() as connection:
            total = connection.execute(f"SELECT COUNT(*) AS total FROM backtest_trade {where}", params).fetchone()["total"]
            rows = connection.execute(
                f"SELECT * FROM backtest_trade {where} ORDER BY {order_by}, id DESC LIMIT ? OFFSET ?",
                [*params, query.page_size, offset],
            ).fetchall()
        return PageResult(
            items=[BacktestTradeRecord(**dict(row)) for row in rows],
            page=query.page,
            page_size=query.page_size,
            total=total,
            has_more=offset + query.page_size < total,
        )

    def list_all_trades(self, task_id: str) -> list[BacktestTradeRecord]:
        task = self.get_task(task_id)
        with db_session() as connection:
            rows = connection.execute(
                "SELECT * FROM backtest_trade WHERE backtest_id=? ORDER BY trade_time, id",
                (task.id,),
            ).fetchall()
        return [BacktestTradeRecord(**dict(row)) for row in rows]

    def list_signals(self, task_id: str, query: PageQuery) -> PageResult[BacktestSignalRecord]:
        task = self.get_task(task_id)
        clauses = ["backtest_id=?"]
        params: list[object] = [task.id]
        if query.keyword:
            keyword = f"%{query.keyword}%"
            clauses.append("(symbol LIKE ? OR name LIKE ? OR action LIKE ? OR status LIKE ? OR reason LIKE ? OR skip_reason LIKE ?)")
            params.extend([keyword, keyword, keyword, keyword, keyword, keyword])
        append_status_filter(clauses, params, "status", query)
        append_date_filter(clauses, params, "signal_time", query)
        where = f"WHERE {' AND '.join(clauses)}"
        offset = (query.page - 1) * query.page_size
        order_by = build_sort_clause(
            query,
            {"created_at": "signal_time", "signal_time": "signal_time", "symbol": "symbol", "action": "action", "status": "status", "amount": "amount"},
            "signal_time",
        )
        with db_session() as connection:
            total = connection.execute(f"SELECT COUNT(*) AS total FROM backtest_signal {where}", params).fetchone()["total"]
            rows = connection.execute(
                f"SELECT * FROM backtest_signal {where} ORDER BY {order_by}, id ASC LIMIT ? OFFSET ?",
                [*params, query.page_size, offset],
            ).fetchall()
        return PageResult(
            items=[BacktestSignalRecord(**dict(row)) for row in rows],
            page=query.page,
            page_size=query.page_size,
            total=total,
            has_more=offset + query.page_size < total,
        )

    def list_all_signals(self, task_id: str) -> list[BacktestSignalRecord]:
        task = self.get_task(task_id)
        with db_session() as connection:
            rows = connection.execute(
                "SELECT * FROM backtest_signal WHERE backtest_id=? ORDER BY signal_time, id",
                (task.id,),
            ).fetchall()
        return [BacktestSignalRecord(**dict(row)) for row in rows]

    def list_equity(self, task_id: str, max_points: int = 2000) -> list[BacktestEquityRecord]:
        task = self.get_task(task_id)
        max_points = max(100, min(max_points, 5000))
        with db_session() as connection:
            total = connection.execute(
                "SELECT COUNT(*) AS total FROM backtest_equity WHERE backtest_id=?",
                (task.id,),
            ).fetchone()["total"]
            if total <= max_points:
                rows = connection.execute("SELECT * FROM backtest_equity WHERE backtest_id=? ORDER BY trade_date", (task.id,)).fetchall()
            else:
                step = max(total // max_points, 1)
                rows = connection.execute(
                    """
                    SELECT id, backtest_id, trade_date, equity, cash, market_value, drawdown
                    FROM (
                        SELECT be.*, ROW_NUMBER() OVER (ORDER BY trade_date, id) AS rn,
                               COUNT(*) OVER () AS total_count
                        FROM backtest_equity be
                        WHERE backtest_id=?
                    )
                    WHERE rn=1 OR rn=total_count OR ((rn - 1) % ?) = 0
                    ORDER BY trade_date, id
                    """,
                    (task.id, step),
                ).fetchall()
        return [BacktestEquityRecord(**dict(row)) for row in rows]

    def list_all_equity(self, task_id: str) -> list[BacktestEquityRecord]:
        task = self.get_task(task_id)
        with db_session() as connection:
            rows = connection.execute(
                "SELECT * FROM backtest_equity WHERE backtest_id=? ORDER BY trade_date, id",
                (task.id,),
            ).fetchall()
        return [BacktestEquityRecord(**dict(row)) for row in rows]

    def list_logs(self, task_id: str, query: PageQuery) -> PageResult[BacktestLogRecord]:
        task = self.get_task(task_id)
        clauses = ["backtest_id=?"]
        params: list[object] = [task.id]
        if query.keyword:
            keyword = f"%{query.keyword}%"
            clauses.append("(message LIKE ? OR technical_detail LIKE ? OR level LIKE ?)")
            params.extend([keyword, keyword, keyword])
        append_status_filter(clauses, params, "level", query)
        append_date_filter(clauses, params, "created_at", query)
        where = f"WHERE {' AND '.join(clauses)}"
        offset = (query.page - 1) * query.page_size
        order_by = build_sort_clause(
            query,
            {"created_at": "created_at", "level": "level"},
            "created_at",
        )
        with db_session() as connection:
            total = connection.execute(f"SELECT COUNT(*) AS total FROM backtest_log {where}", params).fetchone()["total"]
            id_order = "ASC" if query.sort_order.lower() == "asc" else "DESC"
            rows = connection.execute(
                f"SELECT * FROM backtest_log {where} ORDER BY {order_by}, id {id_order} LIMIT ? OFFSET ?",
                [*params, query.page_size, offset],
            ).fetchall()
        return PageResult(
            items=[BacktestLogRecord(**dict(row)) for row in rows],
            page=query.page,
            page_size=query.page_size,
            total=total,
            has_more=offset + query.page_size < total,
        )

    def list_all_logs(self, task_id: str) -> list[BacktestLogRecord]:
        task = self.get_task(task_id)
        with db_session() as connection:
            rows = connection.execute(
                "SELECT * FROM backtest_log WHERE backtest_id=? ORDER BY created_at, id",
                (task.id,),
            ).fetchall()
        return [BacktestLogRecord(**dict(row)) for row in rows]

    def count_market_rows(self, table: str, date_field: str, start_date: str, end_date: str) -> int:
        allowed = {
            "daily_kline": "trade_date",
            "minute_kline": "substr(datetime, 1, 10)",
        }
        if table not in allowed or allowed[table] != date_field:
            raise ValueError(f"unsupported market count query: {table}.{date_field}")
        if table == "minute_kline":
            return self.count_minute_rows(start_date, end_date)
        with db_session() as connection:
            row = connection.execute(
                f"SELECT COUNT(*) AS total FROM {table} WHERE {date_field} BETWEEN ? AND ?",
                (start_date, end_date),
            ).fetchone()
        return int(row["total"] if row else 0)

    def count_minute_rows(self, start_date: str, end_date: str, period: str = "1m") -> int:
        with db_session() as connection:
            row = connection.execute(
                """
                SELECT COUNT(*) AS total
                FROM minute_kline
                WHERE period = ?
                  AND datetime BETWEEN ? AND ?
                """,
                (period, f"{start_date} 00:00:00", f"{end_date} 23:59:59"),
            ).fetchone()
        return int(row["total"] if row else 0)

    def minute_window_coverage_stats(
        self,
        start_date: str,
        end_date: str,
        start_clock: str,
        end_clock: str,
        expected_bars_per_unit: int,
        period: str = "1m",
    ) -> dict[str, int]:
        return self.minute_windows_coverage_stats(
            start_date,
            end_date,
            [
                {
                    "key": "single",
                    "start": start_clock,
                    "end": end_clock,
                    "expected_bars_per_unit": expected_bars_per_unit,
                }
            ],
            period,
        )["single"]

    def minute_windows_coverage_stats(
        self,
        start_date: str,
        end_date: str,
        windows: list[dict[str, object]],
        period: str = "1m",
    ) -> dict[str, dict[str, int]]:
        normalized: list[dict[str, object]] = []
        for index, window in enumerate(windows):
            key = str(window.get("key") or f"w{index}")
            start_clock = str(window.get("start") or "")
            end_clock = str(window.get("end") or "")
            safe_expected = max(int(window.get("expected_bars_per_unit") or 1), 1)
            normalized.append(
                {
                    "key": key,
                    "start": start_clock,
                    "end": end_clock,
                    "expected_bars_per_unit": safe_expected,
                    "column": f"w{index}_count",
                }
            )
        if not normalized:
            return {}

        case_exprs: list[str] = []
        where_exprs: list[str] = []
        params: list[object] = []
        for window in normalized:
            column = str(window["column"])
            case_exprs.append(
                f"SUM(CASE WHEN substr(datetime, 12, 8) BETWEEN ? AND ? THEN 1 ELSE 0 END) AS {column}"
            )
            params.extend([window["start"], window["end"]])
            where_exprs.append("substr(datetime, 12, 8) BETWEEN ? AND ?")
        query_params: list[object] = [
            *params,
            period,
            start_date,
            end_date,
        ]
        for window in normalized:
            query_params.extend([window["start"], window["end"]])

        initial_stats: dict[str, dict[str, object]] = {}
        for window in normalized:
            key = str(window["key"])
            initial_stats[key] = {
                "minute_rows": 0,
                "symbols": set(),
                "trading_days": set(),
                "covered_units": 0,
                "complete_units": 0,
                "incomplete_units": 0,
                "min_bars_per_unit": None,
                "max_bars_per_unit": None,
                "expected_bars_per_unit": int(window["expected_bars_per_unit"]),
                "column": str(window["column"]),
            }

        with db_session() as connection:
            rows = connection.execute(
                f"""
                SELECT
                    symbol,
                    substr(datetime, 1, 10) AS trade_date,
                    {", ".join(case_exprs)}
                FROM minute_kline
                WHERE period = ?
                  AND substr(datetime, 1, 10) BETWEEN ? AND ?
                  AND ({" OR ".join(where_exprs)})
                GROUP BY symbol, substr(datetime, 1, 10)
                """,
                query_params,
            ).fetchall()

        for row in rows:
            symbol = str(row["symbol"])
            trade_date = str(row["trade_date"])
            for window in normalized:
                key = str(window["key"])
                stat = initial_stats[key]
                bar_count = int(row[str(window["column"])] or 0)
                if bar_count <= 0:
                    continue
                expected = int(stat["expected_bars_per_unit"])
                stat["minute_rows"] = int(stat["minute_rows"]) + bar_count
                stat["covered_units"] = int(stat["covered_units"]) + 1
                stat["symbols"].add(symbol)  # type: ignore[union-attr]
                stat["trading_days"].add(trade_date)  # type: ignore[union-attr]
                current_min = stat["min_bars_per_unit"]
                current_max = stat["max_bars_per_unit"]
                stat["min_bars_per_unit"] = bar_count if current_min is None else min(int(current_min), bar_count)
                stat["max_bars_per_unit"] = bar_count if current_max is None else max(int(current_max), bar_count)
                if bar_count >= expected:
                    stat["complete_units"] = int(stat["complete_units"]) + 1
                else:
                    stat["incomplete_units"] = int(stat["incomplete_units"]) + 1

        result: dict[str, dict[str, int]] = {}
        for window in normalized:
            key = str(window["key"])
            stat = initial_stats[key]
            result[key] = {
                "minute_rows": int(stat["minute_rows"]),
                "symbols": len(stat["symbols"]),  # type: ignore[arg-type]
                "trading_days": len(stat["trading_days"]),  # type: ignore[arg-type]
                "covered_units": int(stat["covered_units"]),
                "complete_units": int(stat["complete_units"]),
                "incomplete_units": int(stat["incomplete_units"]),
                "min_bars_per_unit": int(stat["min_bars_per_unit"] or 0),
                "max_bars_per_unit": int(stat["max_bars_per_unit"] or 0),
                "expected_bars_per_unit": int(stat["expected_bars_per_unit"]),
            }
        return result

    def expected_minute_symbol_days(self, start_date: str, end_date: str) -> int:
        with db_session() as connection:
            row = connection.execute(
                """
                SELECT COUNT(*) AS total
                FROM (
                    SELECT d.symbol, d.trade_date
                    FROM daily_kline d
                    INNER JOIN stock_basic s ON s.symbol = d.symbol
                    LEFT JOIN instrument_detail i ON i.symbol = d.symbol
                    WHERE d.trade_date BETWEEN ? AND ?
                      AND COALESCE(s.list_status, '上市') = '上市'
                      AND COALESCE(d.suspend_flag, 0) = 0
                      AND COALESCE(d.volume, 0) > 0
                      AND NOT (
                        i.symbol IS NOT NULL
                        AND COALESCE(i.is_trading, 0) = 0
                        AND COALESCE(i.total_volume, 0) <= 0
                        AND COALESCE(i.float_volume, 0) <= 0
                      )
                    GROUP BY d.symbol, d.trade_date
                )
                """,
                (start_date, end_date),
            ).fetchone()
        return int(row["total"] if row else 0)

    def minute_full_day_bar_baseline_stats(
        self,
        start_date: str,
        end_date: str,
        period: str = "1m",
        minimum_expected_bars_per_unit: int = 240,
    ) -> dict[str, int | str]:
        safe_expected = max(int(minimum_expected_bars_per_unit), 1)
        session_clause = """
            (
                substr(datetime, 12, 8) BETWEEN '09:30:00' AND '11:30:00'
                OR substr(datetime, 12, 8) BETWEEN '13:00:00' AND '15:00:00'
            )
        """
        with db_session() as connection:
            summary = connection.execute(
                f"""
                SELECT
                    COUNT(*) AS minute_rows,
                    COUNT(DISTINCT symbol) AS symbols,
                    COUNT(DISTINCT substr(datetime, 1, 10)) AS trading_days
                FROM minute_kline
                WHERE period = ?
                  AND substr(datetime, 1, 10) BETWEEN ? AND ?
                  AND {session_clause}
                """,
                (period, start_date, end_date),
            ).fetchone()
            units = connection.execute(
                f"""
                SELECT
                    COUNT(*) AS covered_units,
                    SUM(CASE WHEN bar_count >= ? THEN 1 ELSE 0 END) AS complete_units,
                    SUM(CASE WHEN bar_count < ? THEN 1 ELSE 0 END) AS incomplete_units,
                    MIN(bar_count) AS min_bars_per_unit,
                    MAX(bar_count) AS max_bars_per_unit
                FROM (
                    SELECT symbol, substr(datetime, 1, 10) AS trade_date, COUNT(*) AS bar_count
                    FROM minute_kline
                    WHERE period = ?
                      AND substr(datetime, 1, 10) BETWEEN ? AND ?
                      AND {session_clause}
                    GROUP BY symbol, substr(datetime, 1, 10)
                )
                """,
                (safe_expected, safe_expected, period, start_date, end_date),
            ).fetchone()
        return {
            "minute_rows": int(summary["minute_rows"] if summary else 0),
            "symbols": int(summary["symbols"] if summary else 0),
            "trading_days": int(summary["trading_days"] if summary else 0),
            "covered_units": int(units["covered_units"] if units and units["covered_units"] is not None else 0),
            "complete_units": int(units["complete_units"] if units and units["complete_units"] is not None else 0),
            "incomplete_units": int(units["incomplete_units"] if units and units["incomplete_units"] is not None else 0),
            "min_bars_per_unit": int(units["min_bars_per_unit"] if units and units["min_bars_per_unit"] is not None else 0),
            "max_bars_per_unit": int(units["max_bars_per_unit"] if units and units["max_bars_per_unit"] is not None else 0),
            "minimum_expected_bars_per_unit": safe_expected,
            "session_scope": "09:30:00-11:30:00,13:00:00-15:00:00",
        }

    def list_daily_bar_rows(
        self,
        symbols: list[str],
        start_date: str,
        end_date: str,
        include_previous: bool = False,
        warmup_bars: int = 0,
    ) -> list[dict[str, object]]:
        if not symbols:
            return []
        result: list[dict[str, object]] = []
        previous_limit = max(int(warmup_bars), 1 if include_previous else 0)
        with db_session() as connection:
            for index in range(0, len(symbols), 500):
                batch = symbols[index:index + 500]
                placeholders = ",".join("?" for _ in batch)
                previous_clause = ""
                previous_params: list[object] = []
                if previous_limit > 0:
                    previous_clause = f"""
                        OR d.trade_date IN (
                            SELECT prev.trade_date
                            FROM daily_kline prev
                            WHERE prev.symbol = d.symbol
                              AND prev.trade_date < ?
                            ORDER BY prev.trade_date DESC
                            LIMIT ?
                        )
                    """
                    previous_params.extend([start_date, previous_limit])
                rows = connection.execute(
                    f"""
                    SELECT d.symbol, d.trade_date, d.open, d.high, d.low, d.close,
                           COALESCE(d.pre_close, 0) AS pre_close, d.volume, d.amount,
                           COALESCE(d.suspend_flag, 0) AS suspend_flag,
                           COALESCE(s.name, d.symbol) AS name
                    FROM daily_kline d
                    LEFT JOIN stock_basic s ON s.symbol = d.symbol
                    WHERE d.symbol IN ({placeholders})
                      AND (d.trade_date BETWEEN ? AND ? {previous_clause})
                    ORDER BY d.symbol, d.trade_date
                    """,
                    [*batch, start_date, end_date, *previous_params],
                ).fetchall()
                result.extend(dict(row) for row in rows)
        return result

    def next_minute_bar_row(self, symbol: str, signal_time: str, end_date: str) -> dict[str, object] | None:
        end_time = f"{end_date} 23:59:59"
        with db_session() as connection:
            row = connection.execute(
                """
                SELECT symbol, datetime, open, high, low, close, COALESCE(pre_close, 0) AS pre_close,
                       volume, amount, COALESCE(suspend_flag, 0) AS suspend_flag
                FROM minute_kline
                WHERE symbol = ?
                  AND period = '1m'
                  AND datetime > ?
                  AND datetime <= ?
                ORDER BY datetime
                LIMIT 1
                """,
                (symbol, signal_time, end_time),
            ).fetchone()
        return dict(row) if row else None

    def list_minute_bar_rows_between(self, symbol: str, start_time: str, end_time: str) -> list[dict[str, object]]:
        with db_session() as connection:
            rows = connection.execute(
                """
                SELECT symbol, datetime, open, high, low, close, COALESCE(pre_close, 0) AS pre_close,
                       volume, amount, COALESCE(suspend_flag, 0) AS suspend_flag
                FROM minute_kline
                WHERE symbol = ?
                  AND period = '1m'
                  AND datetime >= ?
                  AND datetime <= ?
                ORDER BY datetime
                """,
                (symbol, start_time, end_time),
            ).fetchall()
        return [dict(row) for row in rows]

    def available_symbols(self, start_date: str, end_date: str, limit: int | None = None) -> list[str]:
        limit_clause = " LIMIT ?" if limit is not None else ""
        params: list[object] = [start_date, end_date]
        if limit is not None:
            params.append(limit)
        with db_session() as connection:
            rows = connection.execute(
                f"""
                SELECT DISTINCT symbol FROM daily_kline
                WHERE trade_date BETWEEN ? AND ?
                ORDER BY symbol{limit_clause}
                """,
                params,
            ).fetchall()
        return [str(row["symbol"]) for row in rows]
