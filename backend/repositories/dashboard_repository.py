import json

from backend.core.asset_math import normalize_account_total
from backend.core.database import db_session
from backend.repositories.system.system_repository import build_runtime_task_record, now_text
from backend.schemas.dashboard import AssetOverview, TodayTradeSummary
from backend.schemas.system import RuntimeTaskRecord
from backend.schemas.trading import TradingOrderRecord, TradingSignalRecord, TradingTradeRecord


TEST_ISOLATION_DASHBOARD_ACCOUNT_ID = "test_isolation_account"


class DashboardRepository:
    POSITION_SNAPSHOT_MATCH_SECONDS = 300

    def _decode_config_value(self, value: object, default: object = None) -> object:
        if value is None:
            return default
        if not isinstance(value, str):
            return value
        text = value.strip()
        if not text:
            return default
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return text

    def _config_bool(self, value: object, default: bool = False) -> bool:
        parsed = self._decode_config_value(value, default)
        if isinstance(parsed, bool):
            return parsed
        if isinstance(parsed, (int, float)):
            return bool(parsed)
        return str(parsed).strip().lower() in {"1", "true", "yes", "on"}

    def _config_text(self, value: object) -> str | None:
        parsed = self._decode_config_value(value)
        if parsed is None:
            return None
        text = str(parsed).strip()
        return text or None

    def _runtime_mode(self) -> tuple[bool, str | None]:
        with db_session() as connection:
            config_rows = connection.execute(
                "SELECT config_key, config_value FROM app_config WHERE config_key IN ('simulation_mode', 'account_id')"
            ).fetchall()
        config = {row["config_key"]: row["config_value"] for row in config_rows}
        simulation_mode = self._config_bool(config.get("simulation_mode"), default=False)
        configured_account_id = self._config_text(config.get("account_id"))
        account_id = TEST_ISOLATION_DASHBOARD_ACCOUNT_ID if simulation_mode else configured_account_id
        return simulation_mode, account_id

    def asset_overview(self) -> AssetOverview:
        _, account_id = self._runtime_mode()
        account_where = "WHERE account_id = ?" if account_id else ""
        account_params: list[object] = [account_id] if account_id else []
        with db_session() as connection:
            account = connection.execute(
                f"SELECT * FROM account_snapshot {account_where} ORDER BY snapshot_time DESC, id DESC LIMIT 1",
                account_params,
            ).fetchone()
        if not account:
            return AssetOverview(total_asset=0, available_cash=0, frozen_cash=0, market_value=0, today_pnl=0, position_count=0, updated_at=None, snapshot_time=None, has_account=False)
        position_filters: list[str] = []
        position_params: list[object] = []
        if account_id:
            position_filters.append("account_id = ?")
            position_params.append(account_id)
        position_filters.append("ABS(strftime('%s', snapshot_time) - strftime('%s', ?)) <= ?")
        position_params.extend([account["snapshot_time"], self.POSITION_SNAPSHOT_MATCH_SECONDS])
        position_where = f"WHERE {' AND '.join(position_filters)}"
        with db_session() as connection:
            snapshot_row = connection.execute(
                f"""
                SELECT snapshot_time
                FROM position_snapshot
                {position_where}
                ORDER BY ABS(strftime('%s', snapshot_time) - strftime('%s', ?)) ASC,
                         snapshot_time DESC,
                         id DESC
                LIMIT 1
                """,
                [*position_params, account["snapshot_time"]],
            ).fetchone()
            position_clause = "account_id = ? AND " if account_id else ""
            position_params = [account_id] if account_id else []
            position_row = connection.execute(
                f"""
                SELECT COUNT(*) AS total, COALESCE(SUM(market_value), 0) AS market_value
                FROM position_snapshot
                WHERE {position_clause}snapshot_time = ?
                """,
                [*position_params, snapshot_row["snapshot_time"] if snapshot_row else ""],
            ).fetchone()
        position_count = int(position_row["total"] or 0)
        market_value = float(position_row["market_value"] or 0) if position_count else float(account["market_value"])
        available_cash = float(account["available_cash"])
        frozen_cash = float(account["frozen_cash"])
        total_asset = normalize_account_total(account["total_asset"], available_cash, frozen_cash, market_value)
        return AssetOverview(
            total_asset=total_asset,
            available_cash=available_cash,
            frozen_cash=frozen_cash,
            market_value=market_value,
            today_pnl=float(account["today_pnl"]),
            position_count=position_count,
            updated_at=account["snapshot_time"],
            snapshot_time=account["snapshot_time"],
            has_account=True,
        )

    def tasks(self, limit: int = 20) -> list[RuntimeTaskRecord]:
        with db_session() as connection:
            rows = connection.execute(
                """
                SELECT task_id, task_type, status, progress, message, technical_detail,
                       started_at, finished_at, created_at
                FROM runtime_task
                ORDER BY created_at DESC LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [build_runtime_task_record(row) for row in rows]

    def today_signals(self, limit: int = 10) -> list[TradingSignalRecord]:
        today = now_text()[:10]
        with db_session() as connection:
            rows = connection.execute(
                """
                SELECT ss.*, sf.strategy_name
                FROM strategy_signal ss JOIN strategy_file sf ON sf.id=ss.strategy_id
                WHERE substr(ss.signal_time, 1, 10) = ?
                ORDER BY ss.signal_time DESC, ss.id DESC LIMIT ?
                """,
                (today, limit),
            ).fetchall()
        return [TradingSignalRecord(**dict(row)) for row in rows]

    def today_signal_count(self) -> int:
        today = now_text()[:10]
        with db_session() as connection:
            row = connection.execute(
                """
                SELECT COUNT(*) AS total
                FROM strategy_signal
                WHERE substr(signal_time, 1, 10) = ?
                """,
                (today,),
            ).fetchone()
        return int(row["total"] if row else 0)

    def latest_orders(self, limit: int = 10) -> list[TradingOrderRecord]:
        _, account_id = self._runtime_mode()
        where = "WHERE o.account_id = ?" if account_id else ""
        params: list[object] = [account_id] if account_id else []
        with db_session() as connection:
            rows = connection.execute(
                f"""
                SELECT o.*, sf.strategy_name
                FROM order_record o
                LEFT JOIN strategy_file sf ON sf.id = CAST(o.strategy_id AS INTEGER)
                {where}
                ORDER BY o.order_time DESC, o.id DESC LIMIT ?
                """,
                [*params, limit],
            ).fetchall()
        return [TradingOrderRecord(**dict(row)) for row in rows]

    def latest_trades(self, limit: int = 10) -> list[TradingTradeRecord]:
        _, account_id = self._runtime_mode()
        where = "WHERE t.account_id = ?" if account_id else ""
        params: list[object] = [account_id] if account_id else []
        with db_session() as connection:
            rows = connection.execute(
                f"""
                SELECT t.*, sf.strategy_name
                FROM trade_record t
                LEFT JOIN order_record o ON o.local_order_id = t.local_order_id
                LEFT JOIN strategy_file sf ON sf.id = CAST(o.strategy_id AS INTEGER)
                {where}
                ORDER BY t.trade_time DESC, t.id DESC LIMIT ?
                """,
                [*params, limit],
            ).fetchall()
        return [TradingTradeRecord(**dict(row)) for row in rows]

    def today_trade_summary(self) -> TodayTradeSummary:
        today = now_text()[:10]
        _, account_id = self._runtime_mode()
        account_clause = " AND account_id = ?" if account_id else ""
        params: list[object] = [today]
        if account_id:
            params.append(account_id)
        with db_session() as connection:
            order_row = connection.execute(
                f"""
                SELECT
                    COUNT(*) AS order_count,
                    SUM(CASE WHEN status IN ('已提交','已报','部分成交') THEN 1 ELSE 0 END) AS submitted_count,
                    SUM(CASE WHEN status = '全部成交' THEN 1 ELSE 0 END) AS filled_count,
                    SUM(CASE WHEN status = '已撤' THEN 1 ELSE 0 END) AS cancelled_count,
                    SUM(CASE WHEN status IN ('失败','废单') THEN 1 ELSE 0 END) AS failed_count
                FROM order_record
                WHERE substr(order_time, 1, 10) = ?{account_clause}
                """,
                params,
            ).fetchone()
            trade_params: list[object] = [today]
            if account_id:
                trade_params.append(account_id)
            trade_row = connection.execute(
                f"""
                SELECT COUNT(*) AS trade_count, COALESCE(SUM(amount), 0) AS trade_amount
                FROM trade_record
                WHERE substr(trade_time, 1, 10) = ?{account_clause}
                """,
                trade_params,
            ).fetchone()
        return TodayTradeSummary(
            submitted_count=int(order_row["submitted_count"] or 0),
            filled_count=int(order_row["filled_count"] or 0),
            cancelled_count=int(order_row["cancelled_count"] or 0),
            failed_count=int(order_row["failed_count"] or 0),
            order_count=int(order_row["order_count"] or 0),
            trade_count=int(trade_row["trade_count"] or 0),
            trade_amount=float(trade_row["trade_amount"] or 0),
        )

    def qmt_source(self) -> tuple[str, bool]:
        with db_session() as connection:
            row = connection.execute("SELECT status FROM data_source WHERE source_code='qmt'").fetchone()
            config_row = connection.execute("SELECT config_value FROM app_config WHERE config_key='simulation_mode'").fetchone()
        simulation_mode = self._config_bool(config_row["config_value"] if config_row is not None else None, default=False)
        return ("test_isolation" if simulation_mode else "real", bool(row and row["status"] == "enabled"))
