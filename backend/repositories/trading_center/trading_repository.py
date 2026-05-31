import sqlite3
from typing import Any

from backend.core.asset_math import normalize_account_total
from backend.core.database import db_session
from backend.repositories.query_utils import append_date_filter, append_status_filter, build_sort_clause
from backend.repositories.system.system_repository import now_text
from backend.schemas.common import PageQuery, PageResult
from backend.schemas.data_center import AccountSnapshot, LatestQuote, StockBasic
from backend.schemas.trading import (
    ExecutionLogRecord,
    TradingOrderRecord,
    TradingPosition,
    TradingSignalRecord,
    TradingTradeRecord,
)
from backend.models.trading_models import ACTIVE_ORDER_STATUSES


class TradingRepository:
    def latest_account(self, account_id: str | None = None) -> AccountSnapshot | None:
        where = "WHERE account_id=?" if account_id else ""
        params: tuple[object, ...] = (account_id,) if account_id else ()
        with db_session() as connection:
            row = connection.execute(
                f"SELECT * FROM account_snapshot {where} ORDER BY snapshot_time DESC, id DESC LIMIT 1",
                params,
            ).fetchone()
        if not row:
            return None
        payload = dict(row)
        payload["total_asset"] = normalize_account_total(
            payload.get("total_asset"),
            payload.get("available_cash"),
            payload.get("frozen_cash"),
            payload.get("market_value"),
        )
        return AccountSnapshot(**payload)

    def get_stock(self, symbol: str) -> StockBasic | None:
        with db_session() as connection:
            row = connection.execute("SELECT * FROM stock_basic WHERE symbol=?", (symbol,)).fetchone()
        return StockBasic(**dict(row)) if row else None

    def latest_quote(self, symbol: str) -> LatestQuote | None:
        with db_session() as connection:
            row = connection.execute(
                """
                SELECT d.symbol, COALESCE(s.name, d.symbol) AS name, d.close AS last_price, d.trade_date AS updated_at
                FROM daily_kline d
                LEFT JOIN stock_basic s ON s.symbol = d.symbol
                WHERE d.symbol=?
                ORDER BY d.trade_date DESC, d.id DESC LIMIT 1
                """,
                (symbol,),
            ).fetchone()
        return LatestQuote(**dict(row)) if row else None

    def get_position(self, symbol: str, account_id: str | None = None) -> TradingPosition | None:
        account_clause = "AND account_id=?" if account_id else ""
        params: tuple[object, ...] = (symbol, account_id) if account_id else (symbol,)
        with db_session() as connection:
            row = connection.execute(
                f"""
                SELECT * FROM position_snapshot
                WHERE symbol=? {account_clause}
                ORDER BY snapshot_time DESC, id DESC LIMIT 1
                """,
                params,
            ).fetchone()
        return TradingPosition(**dict(row)) if row else None

    def list_positions(self, query: PageQuery) -> PageResult[TradingPosition]:
        return self.list_current_positions(query)

    def list_current_positions(self, query: PageQuery, account_id: str | None = None) -> PageResult[TradingPosition]:
        clauses: list[str] = []
        params: list[object] = []
        latest_params: list[object] = []
        latest_where = ""
        if account_id:
            latest_where = "WHERE account_id = ?"
            latest_params.append(account_id)
        if query.keyword:
            keyword = f"%{query.keyword}%"
            clauses.append("(p.symbol LIKE ? OR p.name LIKE ? OR p.account_id LIKE ?)")
            params.extend([keyword, keyword, keyword])
        append_date_filter(clauses, params, "p.snapshot_time", query)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        offset = (query.page - 1) * query.page_size
        order_by = build_sort_clause(
            query,
            {"created_at": "p.snapshot_time", "snapshot_time": "p.snapshot_time", "symbol": "p.symbol", "name": "p.name", "quantity": "p.quantity", "pnl": "p.pnl"},
            "snapshot_time",
        )
        latest_subquery = f"""
            SELECT MAX(id) AS id
            FROM position_snapshot
            {latest_where}
            GROUP BY account_id, symbol
        """
        with db_session() as connection:
            total = connection.execute(
                f"""
                SELECT COUNT(*) AS total
                FROM position_snapshot p
                WHERE p.id IN ({latest_subquery}){" AND " + " AND ".join(clauses) if clauses else ""}
                """,
                [*latest_params, *params],
            ).fetchone()["total"]
            rows = connection.execute(
                f"""
                SELECT
                    p.id, p.account_id, p.symbol,
                    CASE
                        WHEN s.name IS NOT NULL AND s.name != '' THEN s.name
                        WHEN p.name IS NULL OR p.name = '' OR p.name = p.symbol THEN p.symbol || ' (名称待同步)'
                        ELSE p.name
                    END AS name,
                    p.quantity, p.available_quantity, p.cost_price, p.last_price,
                    p.market_value, p.pnl, p.pnl_ratio, p.snapshot_time
                FROM position_snapshot p
                LEFT JOIN stock_basic s ON s.symbol = p.symbol
                {where}
                {"AND" if where else "WHERE"} p.id IN ({latest_subquery})
                ORDER BY {order_by}, p.id DESC LIMIT ? OFFSET ?
                """,
                [*params, *latest_params, query.page_size, offset],
            ).fetchall()
        return PageResult(
            items=[TradingPosition(**dict(row)) for row in rows],
            page=query.page,
            page_size=query.page_size,
            total=total,
            has_more=offset + query.page_size < total,
        )

    def list_position_snapshots(self, query: PageQuery) -> PageResult[TradingPosition]:
        return self._paged_query(
            "position_snapshot",
            TradingPosition,
            query,
            ["symbol", "name", "account_id"],
            {"created_at": "snapshot_time", "snapshot_time": "snapshot_time", "symbol": "symbol", "name": "name", "quantity": "quantity", "pnl": "pnl"},
            "snapshot_time",
            date_field="snapshot_time",
        )

    def list_orders(self, query: PageQuery, account_id: str | None = None) -> PageResult[TradingOrderRecord]:
        clauses: list[str] = []
        params: list[object] = []
        if account_id:
            clauses.append("o.account_id = ?")
            params.append(account_id)
        if query.keyword:
            keyword = f"%{query.keyword}%"
            clauses.append("(o.local_order_id LIKE ? OR o.qmt_order_id LIKE ? OR o.symbol LIKE ? OR o.name LIKE ? OR o.status LIKE ?)")
            params.extend([keyword, keyword, keyword, keyword, keyword])
        append_status_filter(clauses, params, "o.status", query)
        append_date_filter(clauses, params, "o.order_time", query)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        offset = (query.page - 1) * query.page_size
        order_by = build_sort_clause(
            query,
            {"created_at": "o.order_time", "order_time": "o.order_time", "updated_at": "o.updated_at", "symbol": "o.symbol", "status": "o.status", "source": "o.source"},
            "order_time",
        )
        with db_session() as connection:
            total = connection.execute(f"SELECT COUNT(*) AS total FROM order_record o {where}", params).fetchone()["total"]
            rows = connection.execute(
                f"""
                SELECT o.*, sf.strategy_name
                FROM order_record o
                LEFT JOIN strategy_file sf ON sf.id = CAST(o.strategy_id AS INTEGER)
                {where}
                ORDER BY {order_by}, o.id DESC LIMIT ? OFFSET ?
                """,
                [*params, query.page_size, offset],
            ).fetchall()
        return PageResult(
            items=[TradingOrderRecord(**dict(row)) for row in rows],
            page=query.page,
            page_size=query.page_size,
            total=total,
            has_more=offset + query.page_size < total,
        )

    def list_trades(self, query: PageQuery, account_id: str | None = None) -> PageResult[TradingTradeRecord]:
        clauses: list[str] = []
        params: list[object] = []
        if account_id:
            clauses.append("t.account_id = ?")
            params.append(account_id)
        if query.keyword:
            keyword = f"%{query.keyword}%"
            clauses.append("(t.trade_id LIKE ? OR t.local_order_id LIKE ? OR t.symbol LIKE ? OR t.name LIKE ?)")
            params.extend([keyword, keyword, keyword, keyword])
        append_date_filter(clauses, params, "t.trade_time", query)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        offset = (query.page - 1) * query.page_size
        order_by = build_sort_clause(
            query,
            {"created_at": "t.trade_time", "trade_time": "t.trade_time", "symbol": "t.symbol", "amount": "t.amount", "source": "t.source"},
            "trade_time",
        )
        with db_session() as connection:
            total = connection.execute(f"SELECT COUNT(*) AS total FROM trade_record t {where}", params).fetchone()["total"]
            rows = connection.execute(
                f"""
                SELECT t.*, sf.strategy_name
                FROM trade_record t
                LEFT JOIN order_record o ON o.local_order_id = t.local_order_id
                LEFT JOIN strategy_file sf ON sf.id = CAST(o.strategy_id AS INTEGER)
                {where}
                ORDER BY {order_by}, t.id DESC LIMIT ? OFFSET ?
                """,
                [*params, query.page_size, offset],
            ).fetchall()
        return PageResult(
            items=[TradingTradeRecord(**dict(row)) for row in rows],
            page=query.page,
            page_size=query.page_size,
            total=total,
            has_more=offset + query.page_size < total,
        )

    def list_signals(self, query: PageQuery, status: str = "未处理") -> PageResult[TradingSignalRecord]:
        params: list[object] = [query.status or status]
        where = "WHERE ss.status = ? AND ss.action IN ('BUY', 'SELL')"
        if query.keyword:
            keyword = f"%{query.keyword}%"
            where += " AND (ss.symbol LIKE ? OR ss.name LIKE ? OR ss.reason LIKE ? OR sf.strategy_name LIKE ?)"
            params.extend([keyword, keyword, keyword, keyword])
        date_clauses: list[str] = []
        append_date_filter(date_clauses, params, "ss.signal_time", query)
        if date_clauses:
            where += " AND " + " AND ".join(date_clauses)
        offset = (query.page - 1) * query.page_size
        order_by = build_sort_clause(
            query,
            {"created_at": "ss.created_at", "signal_time": "ss.signal_time", "symbol": "ss.symbol", "action": "ss.action", "strategy_name": "sf.strategy_name"},
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
            items=[TradingSignalRecord(**dict(row)) for row in rows],
            page=query.page,
            page_size=query.page_size,
            total=total,
            has_more=offset + query.page_size < total,
        )

    def get_signal(self, signal_id: int) -> TradingSignalRecord:
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
        return TradingSignalRecord(**dict(row))

    def get_order(self, local_order_id: str) -> TradingOrderRecord:
        with db_session() as connection:
            row = connection.execute(
                """
                SELECT o.*, sf.strategy_name
                FROM order_record o
                LEFT JOIN strategy_file sf ON sf.id = CAST(o.strategy_id AS INTEGER)
                WHERE o.local_order_id=?
                """,
                (local_order_id,),
            ).fetchone()
        if row is None:
            raise KeyError(local_order_id)
        return TradingOrderRecord(**dict(row))

    def find_order_by_idempotency(self, idempotency_key: str) -> TradingOrderRecord | None:
        placeholders = ",".join("?" for _ in ACTIVE_ORDER_STATUSES)
        with db_session() as connection:
            row = connection.execute(
                f"""
                SELECT local_order_id FROM order_record
                WHERE idempotency_key=? AND status IN ({placeholders})
                ORDER BY id DESC LIMIT 1
                """,
                (idempotency_key, *ACTIVE_ORDER_STATUSES),
            ).fetchone()
        return self.get_order(row["local_order_id"]) if row else None

    def find_active_signal_order(self, signal_id: int) -> TradingOrderRecord | None:
        with db_session() as connection:
            row = connection.execute(
                """
                SELECT o.local_order_id
                FROM order_record o
                WHERE o.signal_id = ? AND o.status NOT IN ('失败', '废单', '已撤')
                ORDER BY o.id DESC LIMIT 1
                """,
                (str(signal_id),),
            ).fetchone()
        return self.get_order(row["local_order_id"]) if row else None

    def create_order(self, row: dict[str, Any]) -> TradingOrderRecord:
        current = now_text()
        with db_session() as connection:
            self._insert_order(connection, row, current)
        return self.get_order(row["local_order_id"])

    def create_signal_order(self, row: dict[str, Any], signal_id: int) -> TradingOrderRecord:
        current = now_text()
        with db_session() as connection:
            signal = connection.execute("SELECT status FROM strategy_signal WHERE id=?", (signal_id,)).fetchone()
            if signal is None:
                raise KeyError(str(signal_id))
            if signal["status"] != "未处理":
                raise ValueError(f"signal_id={signal_id}; status={signal['status']}")
            self._insert_order(connection, row, current)
            connection.execute(
                """
                INSERT INTO signal_order(signal_id, local_order_id, status, created_at)
                VALUES (?, ?, '已下单', ?)
                """,
                (signal_id, row["local_order_id"], current),
            )
            connection.execute(
                "UPDATE strategy_signal SET status='已下单', order_id=? WHERE id=? AND status='未处理'",
                (row["local_order_id"], signal_id),
            )
        return self.get_order(row["local_order_id"])

    def update_order_submit(self, local_order_id: str, qmt_order_id: str | None, status: str, qmt_status: str | None) -> TradingOrderRecord:
        with db_session() as connection:
            connection.execute(
                """
                UPDATE order_record
                SET qmt_order_id=?, status=?, qmt_status=?, updated_at=?
                WHERE local_order_id=?
                """,
                (qmt_order_id, status, qmt_status, now_text(), local_order_id),
            )
        return self.get_order(local_order_id)

    def update_order_status(self, local_order_id: str, status: str, qmt_status: str | None = None, filled_quantity: int | None = None) -> TradingOrderRecord:
        with db_session() as connection:
            connection.execute(
                """
                UPDATE order_record
                SET status=?, qmt_status=COALESCE(?, qmt_status), filled_quantity=COALESCE(?, filled_quantity), updated_at=?
                WHERE local_order_id=?
                """,
                (status, qmt_status, filled_quantity, now_text(), local_order_id),
            )
            connection.execute(
                "UPDATE signal_order SET status=? WHERE local_order_id=?",
                (status, local_order_id),
            )
        return self.get_order(local_order_id)

    def update_signal_ordered(self, signal_id: int, local_order_id: str) -> None:
        current = now_text()
        with db_session() as connection:
            connection.execute("UPDATE strategy_signal SET status='已下单', order_id=? WHERE id=?", (local_order_id, signal_id))
            connection.execute(
                """
                INSERT INTO signal_order(signal_id, local_order_id, status, created_at)
                VALUES (?, ?, '已下单', ?)
                ON CONFLICT(signal_id) DO UPDATE SET local_order_id=excluded.local_order_id, status=excluded.status
                """,
                (signal_id, local_order_id, current),
            )

    def mark_signal_order_failed(self, signal_id: int, local_order_id: str) -> None:
        with db_session() as connection:
            connection.execute(
                "UPDATE signal_order SET status='失败' WHERE signal_id=? AND local_order_id=?",
                (signal_id, local_order_id),
            )
            connection.execute(
                "UPDATE strategy_signal SET status='未处理' WHERE id=? AND order_id=?",
                (signal_id, local_order_id),
            )

    def ignore_signal(self, signal_id: int) -> TradingSignalRecord:
        with db_session() as connection:
            connection.execute("UPDATE strategy_signal SET status='已忽略' WHERE id=? AND status='未处理'", (signal_id,))
        return self.get_signal(signal_id)

    def upsert_trade(self, row: dict[str, Any]) -> None:
        with db_session() as connection:
            connection.execute(
                """
                INSERT INTO trade_record(
                    trade_id, local_order_id, qmt_order_id, account_id, symbol, name, side,
                    price, quantity, amount, fee, source, trade_time
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(trade_id) DO NOTHING
                """,
                (
                    row["trade_id"], row.get("local_order_id"), row.get("qmt_order_id"), row["account_id"],
                    row["symbol"], row["name"], row["side"], row["price"], row["quantity"],
                    row["amount"], row["fee"], row["source"], row["trade_time"],
                ),
            )

    def upsert_trade_and_apply_effect(self, row: dict[str, Any]) -> bool:
        current = now_text()
        with db_session() as connection:
            exists = connection.execute(
                "SELECT 1 FROM trade_record WHERE trade_id=? LIMIT 1",
                (row["trade_id"],),
            ).fetchone()
            if exists:
                return False
            connection.execute(
                """
                INSERT INTO trade_record(
                    trade_id, local_order_id, qmt_order_id, account_id, symbol, name, side,
                    price, quantity, amount, fee, source, trade_time
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    row["trade_id"], row.get("local_order_id"), row.get("qmt_order_id"), row["account_id"],
                    row["symbol"], row["name"], row["side"], row["price"], row["quantity"],
                    row["amount"], row["fee"], row["source"], row["trade_time"],
                ),
            )
            local_order_id = row.get("local_order_id")
            if local_order_id:
                connection.execute(
                    """
                    UPDATE order_record
                    SET status='全部成交', qmt_status=COALESCE(qmt_status, 'filled'),
                        filled_quantity=MAX(filled_quantity, ?), updated_at=?
                    WHERE local_order_id=?
                    """,
                    (row["quantity"], current, local_order_id),
                )
                connection.execute(
                    "UPDATE signal_order SET status='全部成交' WHERE local_order_id=?",
                    (local_order_id,),
                )
            self._apply_position_and_account_snapshot(connection, row, current)
        return True

    def has_trade_for_order(self, local_order_id: str) -> bool:
        with db_session() as connection:
            row = connection.execute(
                "SELECT 1 FROM trade_record WHERE local_order_id=? LIMIT 1",
                (local_order_id,),
            ).fetchone()
        return row is not None

    def add_log(self, local_order_id: str | None, level: str, message: str, technical_detail: str | None = None) -> None:
        with db_session() as connection:
            connection.execute(
                """
                INSERT INTO execution_log(local_order_id, level, message, technical_detail, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (local_order_id, level, message, technical_detail, now_text()),
            )

    def list_logs(self, query: PageQuery, account_id: str | None = None) -> PageResult[ExecutionLogRecord]:
        if account_id:
            return self._list_logs_for_account(query, account_id)
        return self._paged_query(
            "execution_log",
            ExecutionLogRecord,
            query,
            ["local_order_id", "message", "technical_detail"],
            {"created_at": "created_at", "level": "level", "local_order_id": "local_order_id"},
            "created_at",
            date_field="created_at",
            status_field="level",
        )

    def _list_logs_for_account(self, query: PageQuery, account_id: str) -> PageResult[ExecutionLogRecord]:
        clauses: list[str] = ["o.account_id = ?"]
        params: list[object] = [account_id]
        if query.keyword:
            keyword = f"%{query.keyword}%"
            clauses.append("(l.local_order_id LIKE ? OR l.message LIKE ? OR l.technical_detail LIKE ?)")
            params.extend([keyword, keyword, keyword])
        append_date_filter(clauses, params, "l.created_at", query)
        append_status_filter(clauses, params, "l.level", query)
        where = f"WHERE {' AND '.join(clauses)}"
        offset = (query.page - 1) * query.page_size
        order_by = build_sort_clause(
            query,
            {"created_at": "l.created_at", "level": "l.level", "local_order_id": "l.local_order_id"},
            "created_at",
        )
        with db_session() as connection:
            total = connection.execute(
                f"""
                SELECT COUNT(*) AS total
                FROM execution_log l
                JOIN order_record o ON o.local_order_id = l.local_order_id
                {where}
                """,
                params,
            ).fetchone()["total"]
            rows = connection.execute(
                f"""
                SELECT l.*
                FROM execution_log l
                JOIN order_record o ON o.local_order_id = l.local_order_id
                {where}
                ORDER BY {order_by}, l.id DESC LIMIT ? OFFSET ?
                """,
                [*params, query.page_size, offset],
            ).fetchall()
        return PageResult(
            items=[ExecutionLogRecord(**dict(row)) for row in rows],
            page=query.page,
            page_size=query.page_size,
            total=total,
            has_more=offset + query.page_size < total,
        )

    def all_orders_for_sync(self, account_id: str | None = None) -> list[dict[str, Any]]:
        clauses = []
        params: list[object] = []
        if account_id:
            clauses.append("account_id = ?")
            params.append(account_id)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        with db_session() as connection:
            rows = connection.execute(f"SELECT * FROM order_record {where} ORDER BY id DESC LIMIT 200", params).fetchall()
        return [dict(row) for row in rows]

    def _insert_order(self, connection: sqlite3.Connection, row: dict[str, Any], current: str) -> None:
        connection.execute(
            """
            INSERT INTO order_record(
                local_order_id, qmt_order_id, account_id, symbol, name, side, price, quantity,
                filled_quantity, status, qmt_status, source, strategy_id, signal_id,
                idempotency_key, order_time, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                row["local_order_id"], row.get("qmt_order_id"), row["account_id"], row["symbol"],
                row["name"], row["side"], row["price"], row["quantity"], row["status"],
                row.get("qmt_status"), row["source"], row.get("strategy_id"), row.get("signal_id"),
                row.get("idempotency_key"), current, current,
            ),
        )

    def _apply_position_and_account_snapshot(self, connection: sqlite3.Connection, trade: dict[str, Any], current: str) -> None:
        account = connection.execute(
            "SELECT * FROM account_snapshot WHERE account_id=? ORDER BY snapshot_time DESC, id DESC LIMIT 1",
            (trade["account_id"],),
        ).fetchone()
        position = connection.execute(
            """
            SELECT * FROM position_snapshot
            WHERE account_id=? AND symbol=?
            ORDER BY snapshot_time DESC, id DESC LIMIT 1
            """,
            (trade["account_id"], trade["symbol"]),
        ).fetchone()
        quantity = int(trade["quantity"])
        price = float(trade["price"])
        amount = float(trade["amount"])
        fee = float(trade["fee"])
        side = str(trade["side"])
        old_quantity = int(position["quantity"]) if position else 0
        old_available = int(position["available_quantity"]) if position else 0
        old_cost = float(position["cost_price"]) if position else price
        old_last = float(position["last_price"]) if position else price
        old_market = float(position["market_value"]) if position else 0.0
        if side == "BUY":
            new_quantity = old_quantity + quantity
            new_available = old_available
            new_cost = ((old_cost * old_quantity) + amount + fee) / new_quantity if new_quantity else price
        else:
            new_quantity = max(old_quantity - quantity, 0)
            new_available = max(old_available - quantity, 0)
            new_cost = old_cost if new_quantity else price
        new_last = price or old_last
        new_market = round(new_quantity * new_last, 2)
        pnl = round((new_last - new_cost) * new_quantity, 2)
        pnl_ratio = round(((new_last - new_cost) / new_cost * 100), 4) if new_cost else 0.0
        connection.execute(
            """
            INSERT INTO position_snapshot(
                account_id, symbol, name, quantity, available_quantity, cost_price, last_price,
                market_value, pnl, pnl_ratio, snapshot_time
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(account_id, symbol, snapshot_time) DO UPDATE SET
                name=excluded.name,
                quantity=excluded.quantity,
                available_quantity=excluded.available_quantity,
                cost_price=excluded.cost_price,
                last_price=excluded.last_price,
                market_value=excluded.market_value,
                pnl=excluded.pnl,
                pnl_ratio=excluded.pnl_ratio
            """,
            (
                trade["account_id"], trade["symbol"], trade["name"], new_quantity, new_available,
                round(new_cost, 4), new_last, new_market, pnl, pnl_ratio, current,
            ),
        )
        if account:
            cash_delta = -(amount + fee) if side == "BUY" else amount - fee
            available_cash = round(float(account["available_cash"]) + cash_delta, 2)
            market_value = round(float(account["market_value"]) - old_market + new_market, 2)
            total_asset = round(available_cash + float(account["frozen_cash"]) + market_value, 2)
            connection.execute(
                """
                INSERT INTO account_snapshot(
                    account_id, total_asset, available_cash, frozen_cash, market_value, today_pnl, snapshot_time
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    trade["account_id"], total_asset, available_cash, float(account["frozen_cash"]),
                    market_value, float(account["today_pnl"]), current,
                ),
            )

    def _paged_query(
        self,
        table: str,
        schema: type,
        query: PageQuery,
        keyword_fields: list[str],
        sort_fields: dict[str, str],
        default_sort: str,
        date_field: str | None = None,
        status_field: str | None = None,
    ) -> PageResult[Any]:
        clauses: list[str] = []
        params: list[object] = []
        if query.keyword:
            keyword = f"%{query.keyword}%"
            clauses.append("(" + " OR ".join(f"{field} LIKE ?" for field in keyword_fields) + ")")
            params.extend([keyword] * len(keyword_fields))
        if date_field:
            append_date_filter(clauses, params, date_field, query)
        if status_field:
            append_status_filter(clauses, params, status_field, query)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        offset = (query.page - 1) * query.page_size
        order_by = build_sort_clause(query, sort_fields, default_sort)
        with db_session() as connection:
            total = connection.execute(f"SELECT COUNT(*) AS total FROM {table} {where}", params).fetchone()["total"]
            rows = connection.execute(
                f"SELECT * FROM {table} {where} ORDER BY {order_by}, id DESC LIMIT ? OFFSET ?",
                [*params, query.page_size, offset],
            ).fetchall()
        return PageResult(
            items=[schema(**dict(row)) for row in rows],
            page=query.page,
            page_size=query.page_size,
            total=total,
            has_more=offset + query.page_size < total,
        )
