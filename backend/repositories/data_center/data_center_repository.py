import json
from typing import Any, Callable

from backend.adapters.qmt.data_standardizer import is_standard_symbol
from backend.core.asset_math import normalize_account_total
from backend.core.database import db_session
from backend.repositories.query_utils import append_date_filter, append_status_filter, build_sort_clause
from backend.repositories.system.system_repository import now_text
from backend.schemas.common import PageQuery, PageResult
from backend.schemas.data_center import (
    AccountSnapshot,
    AccountSnapshotDuplicateRecord,
    DailyKline,
    DataDictionaryRecord,
    DataCoverageRecord,
    DataQualityRecord,
    DataQualitySummary,
    DataSourceRecord,
    InstrumentDetail,
    LatestQuote,
    MinuteKline,
    OrderRecord,
    PositionSnapshot,
    StockBasic,
    SyncLogRecord,
    SyncTaskSummary,
    TradingCalendarRecord,
    TradeRecord,
)


class DataCenterRepository:
    def ensure_qmt_source(self) -> DataSourceRecord:
        current = now_text()
        with db_session() as connection:
            connection.execute(
                """
                INSERT INTO data_source(source_code, source_name, status, config_json, created_at, updated_at)
                VALUES ('qmt', 'QMT', 'disabled', '{}', ?, ?)
                ON CONFLICT(source_code) DO NOTHING
                """,
                (current, current),
            )
            row = connection.execute(
                """
                SELECT id, source_code, source_name, status, config_json, last_connected_at, created_at, updated_at
                FROM data_source WHERE source_code = 'qmt'
                """
            ).fetchone()
        return DataSourceRecord(**dict(row))

    def set_qmt_status(self, status: str, connected_at: str | None = None) -> None:
        with db_session() as connection:
            connection.execute(
                """
                UPDATE data_source
                SET status = ?, last_connected_at = COALESCE(?, last_connected_at), updated_at = ?
                WHERE source_code = 'qmt'
                """,
                (status, connected_at, now_text()),
            )

    def list_sources(self) -> list[DataSourceRecord]:
        self.ensure_qmt_source()
        with db_session() as connection:
            rows = connection.execute(
                """
                SELECT id, source_code, source_name, status, config_json, last_connected_at, created_at, updated_at
                FROM data_source ORDER BY id
                """
            ).fetchall()
        return [DataSourceRecord(**dict(row)) for row in rows]

    def latest_account(self, account_id: str | None = None) -> AccountSnapshot | None:
        where = "WHERE account_id = ?" if account_id else ""
        params: list[object] = [account_id] if account_id else []
        with db_session() as connection:
            row = connection.execute(
                f"""
                SELECT id, account_id, total_asset, available_cash, frozen_cash, market_value, today_pnl, snapshot_time
                FROM account_snapshot {where}
                ORDER BY snapshot_time DESC, id DESC LIMIT 1
                """,
                params,
            ).fetchone()
        return AccountSnapshot(**self._normalized_account_row(row)) if row else None

    def _normalized_account_row(self, row: Any) -> dict[str, Any]:
        payload = dict(row)
        payload["total_asset"] = normalize_account_total(
            payload.get("total_asset"),
            payload.get("available_cash"),
            payload.get("frozen_cash"),
            payload.get("market_value"),
        )
        return payload

    def paged_query(
        self,
        table: str,
        schema: type,
        query: PageQuery,
        keyword_fields: list[str],
        sort_fields: dict[str, str],
        default_sort: str,
        date_field: str | None = None,
        status_field: str | None = None,
        extra_clauses: list[str] | None = None,
        extra_params: list[object] | None = None,
    ) -> PageResult[Any]:
        clauses: list[str] = list(extra_clauses or [])
        params: list[object] = list(extra_params or [])
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

    def list_positions(self, query: PageQuery, account_id: str | None = None, latest_only: bool = False) -> PageResult[PositionSnapshot]:
        extra_clauses: list[str] = []
        extra_params: list[object] = []
        if account_id:
            extra_clauses.append("account_id = ?")
            extra_params.append(account_id)
        if latest_only:
            if account_id:
                extra_clauses.append("snapshot_time = (SELECT MAX(snapshot_time) FROM position_snapshot WHERE account_id = ?)")
                extra_params.append(account_id)
            else:
                extra_clauses.append("snapshot_time = (SELECT MAX(snapshot_time) FROM position_snapshot)")
        return self.paged_query(
            "position_snapshot",
            PositionSnapshot,
            query,
            ["symbol", "name", "account_id"],
            {"created_at": "snapshot_time", "snapshot_time": "snapshot_time", "symbol": "symbol", "name": "name", "quantity": "quantity", "pnl": "pnl"},
            "snapshot_time",
            date_field="snapshot_time",
            extra_clauses=extra_clauses,
            extra_params=extra_params,
        )

    def list_orders(self, query: PageQuery, account_id: str | None = None) -> PageResult[OrderRecord]:
        extra_clauses = ["account_id = ?"] if account_id else []
        extra_params: list[object] = [account_id] if account_id else []
        return self.paged_query(
            "order_record",
            OrderRecord,
            query,
            ["symbol", "name", "status", "account_id", "local_order_id", "qmt_order_id"],
            {"created_at": "order_time", "order_time": "order_time", "updated_at": "updated_at", "symbol": "symbol", "status": "status"},
            "order_time",
            date_field="order_time",
            status_field="status",
            extra_clauses=extra_clauses,
            extra_params=extra_params,
        )

    def list_trades(self, query: PageQuery, account_id: str | None = None) -> PageResult[TradeRecord]:
        extra_clauses = ["account_id = ?"] if account_id else []
        extra_params: list[object] = [account_id] if account_id else []
        return self.paged_query(
            "trade_record",
            TradeRecord,
            query,
            ["symbol", "name", "account_id", "trade_id", "local_order_id"],
            {"created_at": "trade_time", "trade_time": "trade_time", "symbol": "symbol", "amount": "amount"},
            "trade_time",
            date_field="trade_time",
            extra_clauses=extra_clauses,
            extra_params=extra_params,
        )

    def list_stocks(self, query: PageQuery) -> PageResult[StockBasic]:
        return self.paged_query(
            "stock_basic",
            StockBasic,
            query,
            ["symbol", "name", "market", "security_type", "list_status"],
            {"created_at": "updated_at", "updated_at": "updated_at", "symbol": "symbol", "name": "name", "market": "market", "list_status": "list_status"},
            "symbol",
            date_field="updated_at",
            status_field="list_status",
        )

    def list_all_stock_symbols(self, page_size: int = 200) -> list[str]:
        symbols: list[str] = []
        offset = 0
        with db_session() as connection:
            while True:
                rows = connection.execute(
                    """
                    SELECT symbol
                    FROM stock_basic
                    WHERE list_status = '上市'
                    ORDER BY symbol
                    LIMIT ? OFFSET ?
                    """,
                    (page_size, offset),
                ).fetchall()
                if not rows:
                    break
                symbols.extend(str(row["symbol"]) for row in rows)
                if len(rows) < page_size:
                    break
                offset += page_size
        return symbols

    def list_market_cap_universe(
        self,
        min_market_cap_yi: float | None = None,
        max_market_cap_yi: float | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
        limit: int = 6000,
    ) -> list[dict[str, Any]]:
        cap_expr = "(latest.close * instrument_detail.total_volume / 100000000.0)"
        clauses = [
            "instrument_detail.total_volume > 0",
            "latest.close > 0",
            "COALESCE(stock_basic.list_status, '上市') = '上市'",
        ]
        params: list[object] = [start_date or "1900-01-01", end_date or "9999-12-31"]
        if min_market_cap_yi is not None:
            clauses.append(f"{cap_expr} >= ?")
            params.append(float(min_market_cap_yi))
        if max_market_cap_yi is not None:
            clauses.append(f"{cap_expr} <= ?")
            params.append(float(max_market_cap_yi))
        params.append(min(max(int(limit), 1), 6000))
        with db_session() as connection:
            rows = connection.execute(
                f"""
                WITH latest_date AS (
                    SELECT symbol, MAX(trade_date) AS trade_date
                    FROM daily_kline
                    WHERE trade_date BETWEEN ? AND ?
                    GROUP BY symbol
                ),
                latest AS (
                    SELECT daily_kline.symbol, daily_kline.trade_date, daily_kline.close
                    FROM daily_kline
                    INNER JOIN latest_date
                        ON latest_date.symbol = daily_kline.symbol
                       AND latest_date.trade_date = daily_kline.trade_date
                )
                SELECT
                    latest.symbol,
                    COALESCE(NULLIF(NULLIF(stock_basic.name, ''), latest.symbol), NULLIF(instrument_detail.instrument_name, ''), latest.symbol) AS name,
                    latest.trade_date,
                    latest.close,
                    instrument_detail.total_volume,
                    instrument_detail.float_volume,
                    {cap_expr} AS market_cap_yi
                FROM latest
                INNER JOIN instrument_detail ON instrument_detail.symbol = latest.symbol
                LEFT JOIN stock_basic ON stock_basic.symbol = latest.symbol
                WHERE {" AND ".join(clauses)}
                ORDER BY latest.symbol
                LIMIT ?
                """,
                params,
            ).fetchall()
        return [dict(row) for row in rows]

    def get_market_cap_yi(self, symbol: str, start_date: str | None = None, end_date: str | None = None) -> float | None:
        with db_session() as connection:
            row = connection.execute(
                """
                SELECT daily_kline.close * instrument_detail.total_volume / 100000000.0 AS market_cap_yi
                FROM daily_kline
                INNER JOIN instrument_detail ON instrument_detail.symbol = daily_kline.symbol
                WHERE daily_kline.symbol = ?
                  AND daily_kline.trade_date = (
                      SELECT MAX(trade_date)
                      FROM daily_kline
                      WHERE symbol = ?
                        AND trade_date BETWEEN ? AND ?
                  )
                  AND daily_kline.close > 0
                  AND instrument_detail.total_volume > 0
                LIMIT 1
                """,
                (symbol, symbol, start_date or "1900-01-01", end_date or "9999-12-31"),
            ).fetchone()
        return float(row["market_cap_yi"]) if row and row["market_cap_yi"] is not None else None

    def latest_minute_trade_date(self, symbol: str, start_date: str | None = None, end_date: str | None = None, period: str = "1m") -> str | None:
        start_time = f"{start_date or '1900-01-01'} 00:00:00"
        end_time = f"{end_date or '9999-12-31'} 23:59:59"
        with db_session() as connection:
            row = connection.execute(
                """
                SELECT MAX(substr(datetime, 1, 10)) AS trade_date
                FROM minute_kline
                WHERE symbol = ?
                  AND period = ?
                  AND datetime BETWEEN ? AND ?
                """,
                (symbol, period, start_time, end_time),
            ).fetchone()
        return str(row["trade_date"]) if row and row["trade_date"] else None

    def minute_scan_stats(
        self,
        symbols: list[str],
        start_date: str,
        end_date: str,
        start_time: str = "09:30:00",
        end_time: str = "10:30:00",
        period: str = "1m",
        progress_callback: Callable[[dict[str, Any]], None] | None = None,
    ) -> dict[str, Any]:
        clean_symbols = [symbol for symbol in symbols if is_standard_symbol(symbol)]
        if not clean_symbols:
            return {"candidate_symbols": 0, "symbols_with_minute_rows": 0, "minute_rows": 0, "first_minute": None, "last_minute": None}
        start_datetime = f"{start_date} 00:00:00"
        end_datetime = f"{end_date} 23:59:59"
        minute_rows = 0
        symbols_with_rows = 0
        first_minute: str | None = None
        last_minute: str | None = None
        total_chunks = max((len(clean_symbols) + 499) // 500, 1)
        with db_session() as connection:
            for index in range(0, len(clean_symbols), 500):
                chunk = clean_symbols[index : index + 500]
                chunk_index = index // 500 + 1
                placeholders = ",".join("?" for _ in chunk)
                row = connection.execute(
                    f"""
                    SELECT
                        COUNT(*) AS minute_rows,
                        COUNT(DISTINCT symbol) AS symbols_with_minute_rows,
                        MIN(datetime) AS first_minute,
                        MAX(datetime) AS last_minute
                    FROM minute_kline
                    WHERE period = ?
                      AND symbol IN ({placeholders})
                      AND datetime BETWEEN ? AND ?
                      AND substr(datetime, 12, 8) BETWEEN ? AND ?
                    """,
                    [period, *chunk, start_datetime, end_datetime, start_time, end_time],
                ).fetchone()
                if not row:
                    continue
                minute_rows += int(row["minute_rows"] or 0)
                symbols_with_rows += int(row["symbols_with_minute_rows"] or 0)
                if row["first_minute"] and (first_minute is None or str(row["first_minute"]) < first_minute):
                    first_minute = str(row["first_minute"])
                if row["last_minute"] and (last_minute is None or str(row["last_minute"]) > last_minute):
                    last_minute = str(row["last_minute"])
                if progress_callback:
                    progress_callback(
                        {
                            "stage": "minute_scan_stats",
                            "chunk_index": chunk_index,
                            "total_chunks": total_chunks,
                            "candidate_symbols": len(clean_symbols),
                            "scanned_symbols": min(index + len(chunk), len(clean_symbols)),
                            "minute_rows": minute_rows,
                            "symbols_with_minute_rows": symbols_with_rows,
                            "first_minute": first_minute,
                            "last_minute": last_minute,
                        }
                    )
        return {
            "candidate_symbols": len(clean_symbols),
            "symbols_with_minute_rows": symbols_with_rows,
            "minute_rows": minute_rows,
            "first_minute": first_minute,
            "last_minute": last_minute,
        }

    def find_minute_amount_triggers(
        self,
        symbols: list[str],
        start_date: str | None = None,
        end_date: str | None = None,
        start_time: str = "09:30:00",
        end_time: str = "10:30:00",
        min_amount: float = 50_000_000,
        consecutive_minutes: int = 3,
        limit: int = 20,
        progress_callback: Callable[[dict[str, Any]], None] | None = None,
    ) -> list[dict[str, Any]]:
        clean_symbols = [symbol for symbol in symbols if is_standard_symbol(symbol)]
        if not clean_symbols:
            return []
        start_datetime = f"{start_date or '1900-01-01'} 00:00:00"
        end_datetime = f"{end_date or '9999-12-31'} 23:59:59"
        safe_limit = min(max(int(limit), 1), 6000)
        safe_consecutive = min(max(int(consecutive_minutes), 1), 60)
        rows: list[dict[str, Any]] = []
        total_chunks = max((len(clean_symbols) + 499) // 500, 1)
        with db_session() as connection:
            for index in range(0, len(clean_symbols), 500):
                chunk = clean_symbols[index : index + 500]
                chunk_index = index // 500 + 1
                placeholders = ",".join("?" for _ in chunk)
                params: list[object] = [
                    *chunk,
                    start_datetime,
                    end_datetime,
                    *chunk,
                    float(min_amount),
                    start_time,
                    end_time,
                    safe_consecutive,
                    safe_consecutive,
                    safe_limit - len(rows),
                ]
                chunk_rows = connection.execute(
                    f"""
                    WITH latest_minute_date AS (
                        SELECT symbol, MAX(substr(datetime, 1, 10)) AS trade_date
                        FROM minute_kline
                        WHERE period = '1m'
                          AND symbol IN ({placeholders})
                          AND datetime BETWEEN ? AND ?
                        GROUP BY symbol
                    ),
                    filtered AS (
                        SELECT
                            minute_kline.symbol,
                            substr(minute_kline.datetime, 1, 10) AS trade_date,
                            minute_kline.datetime,
                            minute_kline.close,
                            minute_kline.amount,
                            CAST(substr(minute_kline.datetime, 12, 2) AS INTEGER) * 60
                              + CAST(substr(minute_kline.datetime, 15, 2) AS INTEGER) AS minute_index
                        FROM minute_kline
                        INNER JOIN latest_minute_date
                            ON latest_minute_date.symbol = minute_kline.symbol
                           AND latest_minute_date.trade_date = substr(minute_kline.datetime, 1, 10)
                        WHERE minute_kline.period = '1m'
                          AND minute_kline.symbol IN ({placeholders})
                          AND minute_kline.amount >= ?
                          AND substr(minute_kline.datetime, 12, 8) BETWEEN ? AND ?
                    ),
                    sequenced AS (
                        SELECT
                            filtered.*,
                            minute_index - ROW_NUMBER() OVER (
                                PARTITION BY symbol, trade_date
                                ORDER BY datetime
                            ) AS sequence_group
                        FROM filtered
                    ),
                    ranked AS (
                        SELECT
                            sequenced.*,
                            ROW_NUMBER() OVER (
                                PARTITION BY symbol, trade_date, sequence_group
                                ORDER BY datetime
                            ) AS hit_order,
                            COUNT(*) OVER (
                                PARTITION BY symbol, trade_date, sequence_group
                            ) AS hit_count
                        FROM sequenced
                    ),
                    first_hit AS (
                        SELECT symbol, trade_date, MIN(trigger_time) AS trigger_time
                        FROM (
                            SELECT symbol, trade_date, datetime AS trigger_time
                            FROM ranked
                            WHERE hit_count >= ?
                              AND hit_order = ?
                        )
                        GROUP BY symbol, trade_date
                    )
                    SELECT
                        first_hit.symbol,
                        first_hit.trade_date,
                        first_hit.trigger_time,
                        minute_kline.close AS trigger_price,
                        minute_kline.amount AS trigger_amount
                    FROM first_hit
                    INNER JOIN minute_kline
                        ON minute_kline.symbol = first_hit.symbol
                       AND minute_kline.datetime = first_hit.trigger_time
                       AND minute_kline.period = '1m'
                    ORDER BY first_hit.trigger_time, first_hit.symbol
                    LIMIT ?
                    """,
                    params,
                ).fetchall()
                rows.extend(dict(row) for row in chunk_rows)
                if progress_callback:
                    progress_callback(
                        {
                            "stage": "minute_trigger_scan",
                            "chunk_index": chunk_index,
                            "total_chunks": total_chunks,
                            "candidate_symbols": len(clean_symbols),
                            "scanned_symbols": min(index + len(chunk), len(clean_symbols)),
                            "triggers_returned": len(rows),
                            "chunk_triggers": len(chunk_rows),
                            "return_limit": safe_limit,
                            "limit_hit": len(rows) >= safe_limit,
                        }
                    )
                if len(rows) >= safe_limit:
                    break
        return rows[:safe_limit]

    def replay_minute_amount_triggers(
        self,
        symbols: list[str],
        start_date: str | None = None,
        end_date: str | None = None,
        start_time: str = "09:30:00",
        end_time: str = "10:30:00",
        min_amount: float = 50_000_000,
        consecutive_minutes: int = 3,
        limit: int = 20,
        progress_callback: Callable[[dict[str, Any]], None] | None = None,
    ) -> dict[str, Any]:
        clean_symbols = [symbol for symbol in symbols if is_standard_symbol(symbol)]
        if not clean_symbols:
            return {
                "triggers": [],
                "candidate_symbols": 0,
                "symbols_with_minute_rows": 0,
                "minute_rows": 0,
                "first_minute": None,
                "last_minute": None,
                "return_limit": 0,
                "limit_hit": False,
            }
        start_datetime = f"{start_date or '1900-01-01'} 00:00:00"
        end_datetime = f"{end_date or '9999-12-31'} 23:59:59"
        safe_limit = min(max(int(limit), 1), 6000)
        safe_consecutive = min(max(int(consecutive_minutes), 1), 60)
        triggers: list[dict[str, Any]] = []
        minute_rows = 0
        first_minute: str | None = None
        last_minute: str | None = None
        symbols_with_rows: set[str] = set()
        triggered_keys: set[tuple[str, str]] = set()
        total_chunks = max((len(clean_symbols) + 499) // 500, 1)

        def emit_progress(chunk_index: int, scanned_symbols: int, current_minute: str | None) -> None:
            if not progress_callback:
                return
            progress_callback(
                {
                    "stage": "minute_replay_scan",
                    "chunk_index": chunk_index,
                    "total_chunks": total_chunks,
                    "candidate_symbols": len(clean_symbols),
                    "scanned_symbols": scanned_symbols,
                    "minute_rows": minute_rows,
                    "symbols_with_minute_rows": len(symbols_with_rows),
                    "triggers_returned": len(triggers),
                    "return_limit": safe_limit,
                    "limit_hit": len(triggers) >= safe_limit,
                    "current_minute": current_minute,
                }
            )

        with db_session() as connection:
            for index in range(0, len(clean_symbols), 500):
                chunk = clean_symbols[index : index + 500]
                chunk_index = index // 500 + 1
                placeholders = ",".join("?" for _ in chunk)
                rows = connection.execute(
                    f"""
                    SELECT
                        symbol,
                        substr(datetime, 1, 10) AS trade_date,
                        datetime,
                        close,
                        amount,
                        CAST(substr(datetime, 12, 2) AS INTEGER) * 60
                          + CAST(substr(datetime, 15, 2) AS INTEGER) AS minute_index
                    FROM minute_kline
                    WHERE period = '1m'
                      AND symbol IN ({placeholders})
                      AND datetime BETWEEN ? AND ?
                      AND substr(datetime, 12, 8) BETWEEN ? AND ?
                    ORDER BY datetime, symbol
                    """,
                    [*chunk, start_datetime, end_datetime, start_time, end_time],
                ).fetchall()
                streak_by_symbol: dict[str, dict[str, Any]] = {}
                last_emitted_minute: str | None = None
                for row_index, row in enumerate(rows, start=1):
                    symbol = str(row["symbol"])
                    trade_date = str(row["trade_date"])
                    bar_time = str(row["datetime"])
                    minute_rows += 1
                    symbols_with_rows.add(symbol)
                    if first_minute is None or bar_time < first_minute:
                        first_minute = bar_time
                    if last_minute is None or bar_time > last_minute:
                        last_minute = bar_time
                    current_minute = bar_time[:16]
                    state = streak_by_symbol.get(symbol)
                    minute_index = int(row["minute_index"] or 0)
                    amount = float(row["amount"] or 0)
                    if amount >= float(min_amount):
                        if state and state["trade_date"] == trade_date and int(state["minute_index"]) == minute_index - 1:
                            hit_count = int(state["count"]) + 1
                        else:
                            hit_count = 1
                        streak_by_symbol[symbol] = {"trade_date": trade_date, "minute_index": minute_index, "count": hit_count}
                        trigger_key = (symbol, trade_date)
                        if hit_count >= safe_consecutive and trigger_key not in triggered_keys:
                            triggered_keys.add(trigger_key)
                            triggers.append(
                                {
                                    "symbol": symbol,
                                    "trade_date": trade_date,
                                    "trigger_time": bar_time,
                                    "trigger_price": float(row["close"] or 0),
                                    "trigger_amount": amount,
                                }
                            )
                    else:
                        streak_by_symbol[symbol] = {"trade_date": trade_date, "minute_index": minute_index, "count": 0}
                    if progress_callback and (row_index == 1 or row_index == len(rows) or row_index % 10000 == 0 or current_minute != last_emitted_minute):
                        emit_progress(chunk_index, min(index + len(chunk), len(clean_symbols)), current_minute)
                        last_emitted_minute = current_minute
                    if len(triggers) >= safe_limit:
                        break
                emit_progress(chunk_index, min(index + len(chunk), len(clean_symbols)), last_minute[:16] if last_minute else None)
                if len(triggers) >= safe_limit:
                    break
        triggers.sort(key=lambda item: (str(item["trigger_time"]), str(item["symbol"])))
        return {
            "triggers": triggers[:safe_limit],
            "candidate_symbols": len(clean_symbols),
            "symbols_with_minute_rows": len(symbols_with_rows),
            "minute_rows": minute_rows,
            "first_minute": first_minute,
            "last_minute": last_minute,
            "return_limit": safe_limit,
            "limit_hit": len(triggers) >= safe_limit,
        }

    def list_latest_position_symbols(self, limit: int = 50) -> list[str]:
        with db_session() as connection:
            rows = connection.execute(
                """
                SELECT DISTINCT symbol
                FROM position_snapshot
                WHERE quantity > 0
                  AND snapshot_time = (SELECT MAX(snapshot_time) FROM position_snapshot)
                ORDER BY symbol
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [str(row["symbol"]) for row in rows]

    def list_instrument_details(self, query: PageQuery) -> PageResult[InstrumentDetail]:
        return self.paged_query(
            "instrument_detail",
            InstrumentDetail,
            query,
            ["symbol", "instrument_name", "exchange_id", "instrument_status"],
            {
                "created_at": "sync_time",
                "sync_time": "sync_time",
                "symbol": "symbol",
                "instrument_name": "instrument_name",
                "trading_day": "trading_day",
            },
            "symbol",
            date_field="sync_time",
            status_field="instrument_status",
        )

    def list_trading_calendar(self, query: PageQuery) -> PageResult[TradingCalendarRecord]:
        return self.paged_query(
            "trading_calendar",
            TradingCalendarRecord,
            query,
            ["market", "trade_date", "source"],
            {
                "created_at": "trade_date",
                "trade_date": "trade_date",
                "market": "market",
                "sync_time": "sync_time",
            },
            "trade_date",
            date_field="trade_date",
        )

    def list_daily_kline(self, query: PageQuery, symbol: str | None = None) -> PageResult[DailyKline]:
        return self._kline_query("daily_kline", DailyKline, query, symbol, "trade_date")

    def list_minute_kline(self, query: PageQuery, symbol: str | None = None, period: str | None = None) -> PageResult[MinuteKline]:
        clauses: list[str] = []
        params: list[object] = []
        if symbol:
            clauses.append("symbol = ?")
            params.append(symbol)
        if period:
            clauses.append("period = ?")
            params.append(period)
        return self._kline_query("minute_kline", MinuteKline, query, None, "datetime", clauses, params)

    def list_minute_kline_rows(
        self,
        symbol: str,
        start_time: str,
        end_time: str,
        period: str = "1m",
        limit: int = 2000,
    ) -> list[dict[str, Any]]:
        safe_limit = max(1, min(int(limit), 5000))
        with db_session() as connection:
            rows = connection.execute(
                """
                SELECT id, symbol, datetime, period, open, high, low, close,
                       COALESCE(pre_close, 0) AS pre_close, volume, amount,
                       COALESCE(suspend_flag, 0) AS suspend_flag, created_at
                FROM minute_kline
                WHERE symbol = ?
                  AND period = ?
                  AND datetime BETWEEN ? AND ?
                ORDER BY datetime
                LIMIT ?
                """,
                (symbol, period, start_time, end_time, safe_limit),
            ).fetchall()
        return [dict(row) for row in rows]

    def _kline_query(
        self,
        table: str,
        schema: type,
        query: PageQuery,
        symbol: str | None,
        time_field: str,
        clauses: list[str] | None = None,
        params: list[object] | None = None,
    ) -> PageResult[Any]:
        clauses = clauses or []
        params = params or []
        if symbol:
            clauses.append("symbol = ?")
            params.append(symbol)
        self._append_kline_date_filter(clauses, params, time_field, query)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        offset = (query.page - 1) * query.page_size
        sort_fields = {"created_at": time_field, time_field: time_field, "symbol": "symbol", "close": "close", "volume": "volume", "amount": "amount"}
        order_by = build_sort_clause(query, sort_fields, time_field)
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

    def _append_kline_date_filter(self, clauses: list[str], params: list[object], time_field: str, query: PageQuery) -> None:
        if time_field == "datetime":
            if query.start_date:
                clauses.append("datetime >= ?")
                params.append(f"{query.start_date} 00:00:00")
            if query.end_date:
                clauses.append("datetime <= ?")
                params.append(f"{query.end_date} 23:59:59")
            return
        if query.start_date:
            clauses.append(f"{time_field} >= ?")
            params.append(query.start_date)
        if query.end_date:
            clauses.append(f"{time_field} <= ?")
            params.append(query.end_date)

    def latest_quotes(self, symbols: list[str] | None = None) -> list[LatestQuote]:
        params: list[object] = []
        symbol_filter = ""
        if symbols:
            symbol_filter = "WHERE d.symbol IN (" + ",".join("?" for _ in symbols) + ")"
            params.extend(symbols)
        with db_session() as connection:
            rows = connection.execute(
                f"""
                SELECT d.symbol, COALESCE(s.name, d.symbol) AS name, d.close AS last_price, d.trade_date AS updated_at
                FROM daily_kline d
                LEFT JOIN stock_basic s ON s.symbol = d.symbol
                INNER JOIN (
                    SELECT symbol, MAX(trade_date) AS max_date FROM daily_kline GROUP BY symbol
                ) latest ON latest.symbol = d.symbol AND latest.max_date = d.trade_date
                {symbol_filter}
                ORDER BY d.symbol
                """,
                params,
            ).fetchall()
        return [LatestQuote(**dict(row)) for row in rows]

    def upsert_stock_basic(self, rows: list[dict[str, Any]]) -> int:
        current = now_text()
        with db_session() as connection:
            connection.executemany(
                """
                INSERT INTO stock_basic(symbol, name, market, security_type, list_status, is_st, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(symbol) DO UPDATE SET
                    name=excluded.name, market=excluded.market, security_type=excluded.security_type,
                    list_status=excluded.list_status, is_st=excluded.is_st, updated_at=excluded.updated_at
                """,
                [(r["symbol"], r["name"], r["market"], r["security_type"], r["list_status"], int(r["is_st"]), current) for r in rows],
            )
        return len(rows)

    def upsert_instrument_details(self, rows: list[dict[str, Any]]) -> int:
        current = now_text()
        with db_session() as connection:
            connection.executemany(
                """
                INSERT INTO instrument_detail(
                    symbol, exchange_id, instrument_id, instrument_name, exchange_code,
                    open_date, expire_date, pre_close, up_stop_price, down_stop_price,
                    is_trading, instrument_status, total_volume, float_volume, trading_day,
                    raw_json, sync_time
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(symbol) DO UPDATE SET
                    exchange_id=excluded.exchange_id,
                    instrument_id=excluded.instrument_id,
                    instrument_name=excluded.instrument_name,
                    exchange_code=excluded.exchange_code,
                    open_date=excluded.open_date,
                    expire_date=excluded.expire_date,
                    pre_close=excluded.pre_close,
                    up_stop_price=excluded.up_stop_price,
                    down_stop_price=excluded.down_stop_price,
                    is_trading=excluded.is_trading,
                    instrument_status=excluded.instrument_status,
                    total_volume=excluded.total_volume,
                    float_volume=excluded.float_volume,
                    trading_day=excluded.trading_day,
                    raw_json=excluded.raw_json,
                    sync_time=excluded.sync_time
                """,
                [
                    (
                        r["symbol"], r["exchange_id"], r["instrument_id"], r["instrument_name"],
                        r["exchange_code"], r.get("open_date") or None, r.get("expire_date") or None,
                        r["pre_close"], r["up_stop_price"], r["down_stop_price"],
                        int(r["is_trading"]), r["instrument_status"], r["total_volume"], r["float_volume"],
                        r.get("trading_day") or None, r["raw_json"], current,
                    )
                    for r in rows
                ],
            )
        return len(rows)

    def upsert_trading_calendar(self, rows: list[dict[str, Any]]) -> int:
        current = now_text()
        with db_session() as connection:
            connection.executemany(
                """
                INSERT INTO trading_calendar(market, trade_date, is_trading_day, source, sync_time)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(market, trade_date) DO UPDATE SET
                    is_trading_day=excluded.is_trading_day,
                    source=excluded.source,
                    sync_time=excluded.sync_time
                """,
                [
                    (r["market"], r["trade_date"], int(r["is_trading_day"]), r.get("source") or "qmt", current)
                    for r in rows
                ],
            )
        return len(rows)

    def insert_account(self, row: dict[str, Any]) -> int:
        current = now_text()
        with db_session() as connection:
            existing = connection.execute(
                """
                SELECT id
                FROM account_snapshot
                WHERE account_id = ? AND snapshot_time = ?
                ORDER BY id DESC
                LIMIT 1
                """,
                (row["account_id"], current),
            ).fetchone()
            if existing:
                connection.execute(
                    """
                    UPDATE account_snapshot
                    SET total_asset = ?, available_cash = ?, frozen_cash = ?, market_value = ?, today_pnl = ?
                    WHERE id = ?
                    """,
                    (
                        row["total_asset"], row["available_cash"], row["frozen_cash"],
                        row["market_value"], row["today_pnl"], existing["id"],
                    ),
                )
            else:
                connection.execute(
                    """
                    INSERT INTO account_snapshot(account_id, total_asset, available_cash, frozen_cash, market_value, today_pnl, snapshot_time)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        row["account_id"], row["total_asset"], row["available_cash"], row["frozen_cash"],
                        row["market_value"], row["today_pnl"], current,
                    ),
                )
        return 1

    def upsert_positions(self, rows: list[dict[str, Any]]) -> int:
        current = now_text()
        unique_rows = {(r["account_id"], r["symbol"]): r for r in rows}
        with db_session() as connection:
            connection.executemany(
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
                [
                    (
                        r["account_id"], r["symbol"], r["name"], r["quantity"], r["available_quantity"],
                        r["cost_price"], r["last_price"], r["quantity"] * r["last_price"],
                        (r["last_price"] - r["cost_price"]) * r["quantity"],
                        ((r["last_price"] - r["cost_price"]) / r["cost_price"] * 100) if r["cost_price"] else 0,
                        current,
                    )
                    for r in unique_rows.values()
                ],
            )
        return len(unique_rows)

    def upsert_orders(self, rows: list[dict[str, Any]]) -> int:
        current = now_text()
        with db_session() as connection:
            connection.executemany(
                """
                INSERT INTO order_record(
                    local_order_id, qmt_order_id, account_id, symbol, name, side, price, quantity,
                    filled_quantity, status, qmt_status, source, order_time, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(local_order_id) DO UPDATE SET
                    qmt_order_id=excluded.qmt_order_id, status=excluded.status, qmt_status=excluded.qmt_status,
                    filled_quantity=excluded.filled_quantity, updated_at=excluded.updated_at
                """,
                [
                    (
                        r["local_order_id"], r.get("qmt_order_id"), r["account_id"], r["symbol"], r["name"],
                        r["side"], r["price"], r["quantity"], r["filled_quantity"], r["status"],
                        r.get("qmt_status"), r["source"], current, current,
                    )
                    for r in rows
                ],
            )
        return len(rows)

    def upsert_trades(self, rows: list[dict[str, Any]]) -> int:
        current = now_text()
        with db_session() as connection:
            connection.executemany(
                """
                INSERT INTO trade_record(
                    trade_id, local_order_id, qmt_order_id, account_id, symbol, name, side,
                    price, quantity, amount, fee, source, trade_time
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(trade_id) DO NOTHING
                """,
                [
                    (
                        r["trade_id"], r.get("local_order_id"), r.get("qmt_order_id"), r["account_id"],
                        r["symbol"], r["name"], r["side"], r["price"], r["quantity"], r["amount"],
                        r["fee"], r["source"], current,
                    )
                    for r in rows
                ],
            )
        return len(rows)

    def upsert_daily_kline(self, rows: list[dict[str, Any]]) -> int:
        current = now_text()
        with db_session() as connection:
            connection.executemany(
                """
                INSERT INTO daily_kline(symbol, trade_date, open, high, low, close, pre_close, volume, amount, suspend_flag, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(symbol, trade_date) DO UPDATE SET
                    open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close,
                    pre_close=excluded.pre_close, volume=excluded.volume, amount=excluded.amount,
                    suspend_flag=excluded.suspend_flag
                """,
                [
                    (
                        r["symbol"], r["trade_date"], r["open"], r["high"], r["low"], r["close"],
                        r.get("pre_close", 0), r["volume"], r["amount"], r.get("suspend_flag", 0), current,
                    )
                    for r in rows
                ],
            )
        return len(rows)

    def upsert_minute_kline(self, rows: list[dict[str, Any]]) -> int:
        current = now_text()
        with db_session() as connection:
            connection.executemany(
                """
                INSERT INTO minute_kline(symbol, datetime, period, open, high, low, close, pre_close, volume, amount, suspend_flag, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(symbol, period, datetime) DO UPDATE SET
                    open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close,
                    pre_close=excluded.pre_close, volume=excluded.volume, amount=excluded.amount,
                    suspend_flag=excluded.suspend_flag
                """,
                [
                    (
                        r["symbol"], r["datetime"], r["period"], r["open"], r["high"], r["low"], r["close"],
                        r.get("pre_close", 0), r["volume"], r["amount"], r.get("suspend_flag", 0), current,
                    )
                    for r in rows
                ],
            )
        return len(rows)

    def create_sync_task(self, task_id: str, sync_type: str) -> None:
        current = now_text()
        with db_session() as connection:
            connection.execute(
                """
                INSERT INTO sync_task(task_id, sync_type, status, started_at)
                VALUES (?, ?, 'running', ?)
                ON CONFLICT(task_id) DO NOTHING
                """,
                (task_id, sync_type, current),
            )

    def finish_sync_task(self, task_id: str, status: str, total: int, success: int, failed: int) -> None:
        with db_session() as connection:
            connection.execute(
                """
                UPDATE sync_task
                SET status=?, total_count=?, success_count=?, failed_count=?, finished_at=?
                WHERE task_id=?
                """,
                (status, total, success, failed, now_text(), task_id),
            )

    def add_sync_log(self, task_id: str, sync_type: str, level: str, message: str, technical_detail: str | None = None) -> None:
        with db_session() as connection:
            connection.execute(
                """
                INSERT INTO sync_log(task_id, sync_type, level, message, technical_detail, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (task_id, sync_type, level, message, technical_detail, now_text()),
            )

    def update_cursor(self, data_type: str, symbol: str = "", period: str = "", last_sync_time: str | None = None) -> None:
        current = now_text()
        with db_session() as connection:
            connection.execute(
                """
                INSERT INTO sync_cursor(source_code, data_type, symbol, period, last_sync_time, updated_at)
                VALUES ('qmt', ?, ?, ?, ?, ?)
                ON CONFLICT(source_code, data_type, symbol, period) DO UPDATE SET
                    last_sync_time=excluded.last_sync_time, updated_at=excluded.updated_at
                """,
                (data_type, symbol or "", period or "", last_sync_time or current, current),
            )

    def get_cursor_last_sync_time(self, data_type: str, symbol: str = "", period: str = "") -> str | None:
        with db_session() as connection:
            row = connection.execute(
                """
                SELECT last_sync_time
                FROM sync_cursor
                WHERE source_code='qmt' AND data_type=? AND symbol=? AND period=?
                """,
                (data_type, symbol or "", period or ""),
            ).fetchone()
        return row["last_sync_time"] if row else None

    def list_sync_tasks(self, query: PageQuery) -> PageResult[SyncTaskSummary]:
        clauses: list[str] = []
        params: list[object] = []
        if query.keyword:
            keyword = f"%{query.keyword}%"
            clauses.append(
                "("
                "s.task_id LIKE ? OR s.sync_type LIKE ? OR s.status LIKE ? "
                "OR r.message LIKE ? OR r.technical_detail LIKE ? "
                "OR latest_log.message LIKE ? OR latest_log.technical_detail LIKE ?"
                ")"
            )
            params.extend([keyword] * 7)
        append_date_filter(clauses, params, "s.started_at", query)
        append_status_filter(clauses, params, "s.status", query)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        offset = (query.page - 1) * query.page_size
        order_by = build_sort_clause(
            query,
            {
                "created_at": "s.started_at",
                "started_at": "s.started_at",
                "finished_at": "s.finished_at",
                "sync_type": "s.sync_type",
                "status": "s.status",
                "progress": "CASE WHEN s.status = 'success' THEN 100 ELSE COALESCE(r.progress, 0) END",
            },
            "started_at",
        )
        with db_session() as connection:
            total = connection.execute(
                f"""
                SELECT COUNT(*) AS total
                FROM sync_task s
                LEFT JOIN runtime_task r ON r.task_id = s.task_id
                LEFT JOIN sync_log latest_log ON latest_log.id = (
                    SELECT MAX(id)
                    FROM sync_log
                    WHERE task_id = s.task_id
                )
                {where}
                """,
                params,
            ).fetchone()["total"]
            rows = connection.execute(
                f"""
                SELECT
                    s.task_id,
                    s.sync_type,
                    s.status,
                    s.total_count,
                    s.success_count,
                    s.failed_count,
                    CASE
                        WHEN s.status = 'success' THEN 100
                        ELSE COALESCE(r.progress, 0)
                    END AS progress,
                    CASE
                        WHEN COALESCE(r.message, '') != '' THEN r.message
                        WHEN COALESCE(latest_log.message, '') != '' THEN latest_log.message
                        WHEN s.status = 'success' THEN '同步完成'
                        WHEN s.status = 'failed' THEN '同步失败'
                        ELSE ''
                    END AS message,
                    CASE
                        WHEN COALESCE(r.technical_detail, '') != '' THEN r.technical_detail
                        ELSE latest_log.technical_detail
                    END AS technical_detail,
                    s.started_at,
                    s.finished_at
                FROM sync_task s
                LEFT JOIN runtime_task r ON r.task_id = s.task_id
                LEFT JOIN sync_log latest_log ON latest_log.id = (
                    SELECT MAX(id)
                    FROM sync_log
                    WHERE task_id = s.task_id
                )
                {where}
                ORDER BY {order_by}, s.id DESC
                LIMIT ? OFFSET ?
                """,
                [*params, query.page_size, offset],
            ).fetchall()
        return PageResult(
            items=[SyncTaskSummary(**dict(row)) for row in rows],
            page=query.page,
            page_size=query.page_size,
            total=total,
            has_more=offset + query.page_size < total,
        )

    def list_sync_logs(self, query: PageQuery) -> PageResult[SyncLogRecord]:
        return self.paged_query(
            "sync_log",
            SyncLogRecord,
            query,
            ["task_id", "sync_type", "message", "technical_detail"],
            {"created_at": "created_at", "sync_type": "sync_type", "level": "level"},
            "created_at",
            date_field="created_at",
            status_field="level",
        )

    def upsert_coverage(self, rows: list[dict[str, Any]]) -> int:
        with db_session() as connection:
            connection.executemany(
                """
                INSERT INTO data_coverage(
                    data_type, symbol, period, start_date, end_date, expected_trading_days,
                    actual_trading_days, expected_rows, actual_rows, missing_days,
                    duplicate_rows, coverage_rate, status, checked_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(data_type, symbol, period, start_date, end_date) DO UPDATE SET
                    expected_trading_days=excluded.expected_trading_days,
                    actual_trading_days=excluded.actual_trading_days,
                    expected_rows=excluded.expected_rows,
                    actual_rows=excluded.actual_rows,
                    missing_days=excluded.missing_days,
                    duplicate_rows=excluded.duplicate_rows,
                    coverage_rate=excluded.coverage_rate,
                    status=excluded.status,
                    checked_at=excluded.checked_at
                """,
                [
                    (
                        row["data_type"], row.get("symbol", "ALL") or "ALL", row.get("period", "") or "",
                        row["start_date"], row["end_date"], row["expected_trading_days"],
                        row["actual_trading_days"], row.get("expected_rows"), row["actual_rows"],
                        row.get("missing_days", "[]"), row.get("duplicate_rows", 0),
                        row["coverage_rate"], row["status"], row["checked_at"],
                    )
                    for row in rows
                ],
            )
        return len(rows)

    def list_coverage(self, query: PageQuery, start_date: str | None = None, end_date: str | None = None) -> PageResult[DataCoverageRecord]:
        extra_clauses: list[str] = []
        extra_params: list[object] = []
        if start_date:
            extra_clauses.append("start_date >= ?")
            extra_params.append(start_date)
        if end_date:
            extra_clauses.append("end_date <= ?")
            extra_params.append(end_date)
        clauses: list[str] = list(extra_clauses)
        params: list[object] = list(extra_params)
        if query.keyword:
            keyword = f"%{query.keyword}%"
            clauses.append("(data_type LIKE ? OR symbol LIKE ? OR period LIKE ? OR status LIKE ? OR missing_days LIKE ?)")
            params.extend([keyword] * 5)
        append_date_filter(clauses, params, "checked_at", query)
        append_status_filter(clauses, params, "status", query)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        offset = (query.page - 1) * query.page_size
        order_by = build_sort_clause(
            query,
            {
                "created_at": "checked_at",
                "checked_at": "checked_at",
                "data_type": "data_type",
                "status": "status",
                "coverage_rate": "coverage_rate",
                "actual_rows": "actual_rows",
            },
            "checked_at",
        )
        with db_session() as connection:
            total = connection.execute(f"SELECT COUNT(*) AS total FROM data_coverage {where}", params).fetchone()["total"]
            rows = connection.execute(
                f"""
                SELECT *
                FROM data_coverage
                {where}
                ORDER BY CASE WHEN symbol = 'ALL' THEN 0 ELSE 1 END, {order_by}, id DESC
                LIMIT ? OFFSET ?
                """,
                [*params, query.page_size, offset],
            ).fetchall()
        return PageResult(
            items=[DataCoverageRecord(**dict(row)) for row in rows],
            page=query.page,
            page_size=query.page_size,
            total=total,
            has_more=offset + query.page_size < total,
        )

    def latest_coverage_checked_at(self, start_date: str, end_date: str) -> str | None:
        with db_session() as connection:
            row = connection.execute(
                """
                SELECT MAX(checked_at) AS latest
                FROM data_coverage
                WHERE start_date = ? AND end_date = ?
                """,
                (start_date, end_date),
            ).fetchone()
        return row["latest"] if row else None

    def latest_successful_sync_time(self) -> str | None:
        with db_session() as connection:
            row = connection.execute(
                """
                SELECT MAX(COALESCE(finished_at, started_at)) AS latest
                FROM sync_task
                WHERE status = 'success'
                """
            ).fetchone()
        return row["latest"] if row else None

    def latest_data_times(self, account_id: str | None = None) -> dict[str, str | None]:
        account_clause = "WHERE account_id = ?" if account_id else ""
        account_params: list[object] = [account_id] if account_id else []
        with db_session() as connection:
            daily = connection.execute("SELECT MAX(trade_date) AS latest FROM daily_kline").fetchone()["latest"]
            minute = connection.execute("SELECT MAX(datetime) AS latest FROM minute_kline WHERE period = '1m'").fetchone()["latest"]
            calendar = connection.execute(
                "SELECT MAX(trade_date) AS latest FROM trading_calendar WHERE is_trading_day = 1"
            ).fetchone()["latest"]
            account = connection.execute(
                f"SELECT MAX(snapshot_time) AS latest FROM account_snapshot {account_clause}",
                account_params,
            ).fetchone()["latest"]
            position = connection.execute(
                f"SELECT MAX(snapshot_time) AS latest FROM position_snapshot {account_clause}",
                account_params,
            ).fetchone()["latest"]
            order = connection.execute(
                f"SELECT MAX(order_time) AS latest FROM order_record {account_clause}",
                account_params,
            ).fetchone()["latest"]
            trade = connection.execute(
                f"SELECT MAX(trade_time) AS latest FROM trade_record {account_clause}",
                account_params,
            ).fetchone()["latest"]
        return {
            "daily_kline": daily,
            "minute_kline": minute,
            "trading_calendar": calendar,
            "account_snapshot": account,
            "position_snapshot": position,
            "order_record": order,
            "trade_record": trade,
        }

    def get_coverage_record(self, data_type: str, symbol: str, period: str, start_date: str, end_date: str) -> DataCoverageRecord | None:
        with db_session() as connection:
            row = connection.execute(
                """
                SELECT *
                FROM data_coverage
                WHERE data_type = ? AND symbol = ? AND period = ? AND start_date = ? AND end_date = ?
                ORDER BY checked_at DESC, id DESC
                LIMIT 1
                """,
                (data_type, symbol, period, start_date, end_date),
            ).fetchone()
        return DataCoverageRecord(**dict(row)) if row else None

    def get_coverage_record_covering(self, data_type: str, symbol: str, period: str, start_date: str, end_date: str) -> DataCoverageRecord | None:
        with db_session() as connection:
            row = connection.execute(
                """
                SELECT *
                FROM data_coverage
                WHERE data_type = ?
                  AND symbol = ?
                  AND period = ?
                  AND start_date <= ?
                  AND end_date >= ?
                ORDER BY
                  CASE WHEN start_date = ? AND end_date = ? THEN 0 ELSE 1 END,
                  CASE status WHEN 'complete' THEN 0 WHEN 'partial' THEN 1 ELSE 2 END,
                  checked_at DESC,
                  id DESC
                LIMIT 1
                """,
                (data_type, symbol, period, start_date, end_date, start_date, end_date),
            ).fetchone()
        return DataCoverageRecord(**dict(row)) if row else None

    def list_incomplete_coverage_rows(
        self,
        start_date: str,
        end_date: str,
        data_type: str | None = None,
        period: str | None = None,
        limit: int = 20000,
    ) -> list[dict[str, Any]]:
        clauses = ["start_date = ?", "end_date = ?", "status != 'complete'"]
        params: list[object] = [start_date, end_date]
        if data_type:
            clauses.append("data_type = ?")
            params.append(data_type)
        if period:
            clauses.append("period = ?")
            params.append(period)
        sql = f"""
            SELECT data_type, symbol, period, start_date, end_date, expected_trading_days,
                   actual_trading_days, expected_rows, actual_rows, missing_days,
                   duplicate_rows, coverage_rate, status, checked_at
            FROM data_coverage
            WHERE {" AND ".join(clauses)}
            ORDER BY data_type ASC, symbol ASC, checked_at DESC
            LIMIT ?
        """
        with db_session() as connection:
            rows = connection.execute(sql, [*params, limit]).fetchall()
        return [dict(row) for row in rows]

    def list_latest_incomplete_coverage_rows(
        self,
        data_type: str | None = None,
        period: str | None = None,
        limit: int = 20000,
    ) -> list[dict[str, Any]]:
        clauses = ["status != 'complete'"]
        params: list[object] = []
        if data_type:
            clauses.append("data_type = ?")
            params.append(data_type)
        if period:
            clauses.append("period = ?")
            params.append(period)
        where = " AND ".join(clauses)
        with db_session() as connection:
            latest = connection.execute(
                f"SELECT MAX(checked_at) AS latest FROM data_coverage WHERE {where}",
                params,
            ).fetchone()["latest"]
            if not latest:
                return []
            rows = connection.execute(
                f"""
                SELECT data_type, symbol, period, start_date, end_date, expected_trading_days,
                       actual_trading_days, expected_rows, actual_rows, missing_days,
                       duplicate_rows, coverage_rate, status, checked_at
                FROM data_coverage
                WHERE {where} AND checked_at = ?
                ORDER BY data_type ASC, symbol ASC, checked_at DESC
                LIMIT ?
                """,
                [*params, latest, limit],
            ).fetchall()
        return [dict(row) for row in rows]

    def coverage_source_stats(self, start_date: str, end_date: str, period: str = "1m") -> dict[str, Any]:
        with db_session() as connection:
            stock_count = int(connection.execute("SELECT COUNT(*) AS total FROM stock_basic WHERE list_status = '上市'").fetchone()["total"])
            instrument_count = int(connection.execute("SELECT COUNT(*) AS total FROM instrument_detail").fetchone()["total"])
            calendar = connection.execute(
                """
                SELECT COUNT(*) AS rows_count, COUNT(DISTINCT trade_date) AS trading_days
                FROM trading_calendar
                WHERE trade_date BETWEEN ? AND ? AND is_trading_day = 1
                """,
                (start_date, end_date),
            ).fetchone()
            daily = connection.execute(
                """
                SELECT COUNT(*) AS rows_count, COUNT(DISTINCT trading_date) AS trading_days
                FROM (
                    SELECT symbol, trade_date AS trading_date FROM daily_kline
                    WHERE trade_date BETWEEN ? AND ?
                )
                """,
                (start_date, end_date),
            ).fetchone()
            minute = connection.execute(
                """
                SELECT COUNT(*) AS rows_count, COUNT(DISTINCT substr(datetime, 1, 10)) AS trading_days
                FROM minute_kline
                WHERE period = ? AND substr(datetime, 1, 10) BETWEEN ? AND ?
                """,
                (period, start_date, end_date),
            ).fetchone()
            daily_days = {
                row["trade_date"]
                for row in connection.execute(
                    "SELECT DISTINCT trade_date FROM daily_kline WHERE trade_date BETWEEN ? AND ?",
                    (start_date, end_date),
                ).fetchall()
            }
            calendar_days = {
                row["trade_date"]
                for row in connection.execute(
                    "SELECT DISTINCT trade_date FROM trading_calendar WHERE trade_date BETWEEN ? AND ? AND is_trading_day = 1",
                    (start_date, end_date),
                ).fetchall()
            }
            minute_days = {
                row["trade_date"]
                for row in connection.execute(
                    "SELECT DISTINCT substr(datetime, 1, 10) AS trade_date FROM minute_kline WHERE period = ? AND substr(datetime, 1, 10) BETWEEN ? AND ?",
                    (period, start_date, end_date),
                ).fetchall()
            }
        return {
            "stock_count": stock_count,
            "instrument_count": instrument_count,
            "calendar_rows": int(calendar["rows_count"] or 0),
            "calendar_trading_days": int(calendar["trading_days"] or 0),
            "calendar_days": calendar_days,
            "daily_rows": int(daily["rows_count"] or 0),
            "daily_trading_days": int(daily["trading_days"] or 0),
            "daily_days": daily_days,
            "minute_rows": int(minute["rows_count"] or 0),
            "minute_trading_days": int(minute["trading_days"] or 0),
            "minute_days": minute_days,
        }

    def trading_days_between(self, start_date: str, end_date: str) -> list[str]:
        with db_session() as connection:
            rows = connection.execute(
                """
                SELECT DISTINCT trade_date
                FROM trading_calendar
                WHERE trade_date BETWEEN ? AND ?
                  AND is_trading_day = 1
                ORDER BY trade_date ASC
                """,
                (start_date, end_date),
            ).fetchall()
        return [str(row["trade_date"]) for row in rows]

    def instrument_open_dates(self, symbols: list[str]) -> dict[str, str | None]:
        if not symbols:
            return {}
        result: dict[str, str | None] = {symbol: None for symbol in symbols}
        with db_session() as connection:
            for index in range(0, len(symbols), 200):
                batch = symbols[index:index + 200]
                placeholders = ",".join("?" for _ in batch)
                rows = connection.execute(
                    f"""
                    SELECT symbol, open_date, is_trading, total_volume, float_volume, raw_json
                    FROM instrument_detail
                    WHERE symbol IN ({placeholders})
                    """,
                    batch,
                ).fetchall()
                for row in rows:
                    result[str(row["symbol"])] = self._effective_open_date(dict(row))
        return result

    def _effective_open_date(self, row: dict[str, Any]) -> str | None:
        open_date = str(row.get("open_date") or "").strip()
        if open_date and open_date not in {"0", "00000000", "1970-01-01"}:
            return open_date
        try:
            total_volume = float(row.get("total_volume") or 0)
            float_volume = float(row.get("float_volume") or 0)
        except (TypeError, ValueError):
            total_volume = 0
            float_volume = 0
        is_trading = int(row.get("is_trading") or 0)
        if is_trading == 0 and total_volume <= 0 and float_volume <= 0:
            return "9999-12-31"
        raw_text = str(row.get("raw_json") or "{}")
        try:
            raw = json.loads(raw_text)
        except json.JSONDecodeError:
            raw = {}
        create_date = str(raw.get("CreateDate") or raw.get("create_date") or "").strip()
        if create_date and create_date not in {"0", "00000000"}:
            return create_date
        return None

    def daily_symbol_coverage_stats(self, start_date: str, end_date: str, symbols: list[str]) -> dict[str, dict[str, Any]]:
        if not symbols:
            return {}
        stats = {symbol: {"rows": 0, "days": set()} for symbol in symbols}
        with db_session() as connection:
            for index in range(0, len(symbols), 200):
                batch = symbols[index:index + 200]
                placeholders = ",".join("?" for _ in batch)
                rows = connection.execute(
                    f"""
                    SELECT symbol, trade_date
                    FROM daily_kline
                    WHERE symbol IN ({placeholders}) AND trade_date BETWEEN ? AND ?
                    """,
                    [*batch, start_date, end_date],
                ).fetchall()
                for row in rows:
                    symbol = row["symbol"]
                    if symbol not in stats:
                        continue
                    stats[symbol]["rows"] += 1
                    stats[symbol]["days"].add(row["trade_date"])
        return stats

    def daily_kline_days_by_symbol(self, start_date: str, end_date: str, symbols: list[str]) -> dict[str, set[str]]:
        if not symbols:
            return {}
        result: dict[str, set[str]] = {symbol: set() for symbol in symbols}
        with db_session() as connection:
            for index in range(0, len(symbols), 200):
                batch = symbols[index:index + 200]
                placeholders = ",".join("?" for _ in batch)
                rows = connection.execute(
                    f"""
                    SELECT symbol, trade_date
                    FROM daily_kline
                    WHERE symbol IN ({placeholders})
                      AND trade_date BETWEEN ? AND ?
                    """,
                    [*batch, start_date, end_date],
                ).fetchall()
                for row in rows:
                    symbol = str(row["symbol"])
                    if symbol in result:
                        result[symbol].add(str(row["trade_date"]))
        return result

    def minute_symbol_coverage_stats(self, start_date: str, end_date: str, period: str, symbols: list[str]) -> dict[str, dict[str, Any]]:
        if not symbols:
            return {}
        stats = {symbol: {"rows": 0, "days": set()} for symbol in symbols}
        with db_session() as connection:
            for index in range(0, len(symbols), 200):
                batch = symbols[index:index + 200]
                placeholders = ",".join("?" for _ in batch)
                rows = connection.execute(
                    f"""
                    SELECT symbol, substr(datetime, 1, 10) AS trade_date, COUNT(*) AS rows_count
                    FROM minute_kline
                    WHERE symbol IN ({placeholders})
                      AND period = ?
                      AND substr(datetime, 1, 10) BETWEEN ? AND ?
                    GROUP BY symbol, substr(datetime, 1, 10)
                    """,
                    [*batch, period, start_date, end_date],
                ).fetchall()
                for row in rows:
                    symbol = row["symbol"]
                    if symbol not in stats:
                        continue
                    stats[symbol]["rows"] += int(row["rows_count"] or 0)
                    stats[symbol]["days"].add(row["trade_date"])
        return stats

    def daily_tradable_days_by_symbol(self, start_date: str, end_date: str, symbols: list[str]) -> dict[str, set[str]]:
        if not symbols:
            return {}
        result: dict[str, set[str]] = {symbol: set() for symbol in symbols}
        with db_session() as connection:
            for index in range(0, len(symbols), 200):
                batch = symbols[index:index + 200]
                placeholders = ",".join("?" for _ in batch)
                rows = connection.execute(
                    f"""
                    SELECT symbol, trade_date
                    FROM daily_kline
                    WHERE symbol IN ({placeholders})
                      AND trade_date BETWEEN ? AND ?
                      AND COALESCE(suspend_flag, 0) = 0
                      AND volume > 0
                    """,
                    [*batch, start_date, end_date],
                ).fetchall()
                for row in rows:
                    symbol = str(row["symbol"])
                    if symbol in result:
                        result[symbol].add(str(row["trade_date"]))
        return result

    def replace_quality_results(self, rows: list[dict[str, Any]]) -> None:
        current = now_text()
        with db_session() as connection:
            connection.execute("DELETE FROM data_quality_check")
            connection.executemany(
                """
                INSERT INTO data_quality_check(check_type, target_table, status, message, suggestion, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                [(r["check_type"], r["target_table"], r["status"], r["message"], r.get("suggestion"), current) for r in rows],
            )

    def list_quality_results(self, query: PageQuery) -> PageResult[DataQualityRecord]:
        return self.paged_query(
            "data_quality_check",
            DataQualityRecord,
            query,
            ["check_type", "target_table", "status", "message", "suggestion"],
            {"created_at": "created_at", "target_table": "target_table", "status": "status", "check_type": "check_type"},
            "created_at",
            date_field="created_at",
            status_field="status",
        )

    def quality_summary(self, expected_min_checks: int = 0) -> DataQualitySummary:
        with db_session() as connection:
            rows = connection.execute("SELECT status, created_at FROM data_quality_check").fetchall()
            latest_sync = connection.execute(
                "SELECT MAX(COALESCE(finished_at, started_at)) AS latest FROM sync_task"
            ).fetchone()["latest"]
        latest_check_time = max((row["created_at"] for row in rows), default=None)
        is_stale = False
        stale_reason = None
        if not rows:
            is_stale = True
            stale_reason = "尚未执行数据质量检查。"
        elif expected_min_checks and len(rows) < expected_min_checks:
            is_stale = True
            stale_reason = "质量检查项数量不足，建议重新执行检查以覆盖最新规则。"
        elif latest_sync and latest_check_time and latest_check_time < latest_sync:
            is_stale = True
            stale_reason = "质量检查结果早于最近一次数据同步，建议重新执行检查。"
        return DataQualitySummary(
            success_count=sum(1 for row in rows if row["status"] == "success"),
            warning_count=sum(1 for row in rows if row["status"] == "warning"),
            failed_count=sum(1 for row in rows if row["status"] == "failed"),
            latest_check_time=latest_check_time,
            is_stale=is_stale,
            stale_reason=stale_reason,
        )

    def list_account_snapshot_duplicates(self, query: PageQuery) -> PageResult[AccountSnapshotDuplicateRecord]:
        clauses: list[str] = []
        params: list[object] = []
        if query.keyword:
            keyword = f"%{query.keyword}%"
            clauses.append("(account_id LIKE ? OR snapshot_time LIKE ?)")
            params.extend([keyword, keyword])
        append_date_filter(clauses, params, "snapshot_time", query)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        offset = (query.page - 1) * query.page_size
        sort_fields = {
            "created_at": "snapshot_time",
            "snapshot_time": "snapshot_time",
            "account_id": "account_id",
            "duplicate_count": "duplicate_count",
            "min_id": "min_id",
            "max_id": "max_id",
        }
        order_by = build_sort_clause(query, sort_fields, "snapshot_time")
        grouped_sql = f"""
            SELECT account_id, snapshot_time,
                   COUNT(*) AS duplicate_count,
                   MIN(id) AS min_id,
                   MAX(id) AS max_id,
                   MIN(total_asset) AS min_total_asset,
                   MAX(total_asset) AS max_total_asset,
                   MIN(available_cash) AS min_available_cash,
                   MAX(available_cash) AS max_available_cash
            FROM account_snapshot
            {where}
            GROUP BY account_id, snapshot_time
            HAVING COUNT(*) > 1
        """
        with db_session() as connection:
            total = connection.execute(f"SELECT COUNT(*) AS total FROM ({grouped_sql}) duplicated", params).fetchone()["total"]
            rows = connection.execute(
                f"{grouped_sql} ORDER BY {order_by} LIMIT ? OFFSET ?",
                [*params, query.page_size, offset],
            ).fetchall()
        return PageResult(
            items=[AccountSnapshotDuplicateRecord(**dict(row)) for row in rows],
            page=query.page,
            page_size=query.page_size,
            total=total,
            has_more=offset + query.page_size < total,
        )

    def count_table(self, table: str) -> int:
        with db_session() as connection:
            return int(connection.execute(f"SELECT COUNT(*) AS total FROM {table}").fetchone()["total"])

    def latest_table_time(self, table: str, field: str) -> str | None:
        with db_session() as connection:
            row = connection.execute(f"SELECT MAX({field}) AS latest FROM {table}").fetchone()
        return row["latest"] if row else None

    def _quote_identifier(self, value: str) -> str:
        return '"' + value.replace('"', '""') + '"'

    def has_unique_index_for_fields(self, table: str, fields: list[str]) -> bool:
        allowed_tables = {
            "stock_basic",
            "instrument_detail",
            "trading_calendar",
            "account_snapshot",
            "daily_kline",
            "minute_kline",
            "order_record",
            "trade_record",
            "position_snapshot",
            "sync_cursor",
        }
        if table not in allowed_tables:
            raise ValueError("unsupported unique index check")
        expected = list(fields)
        with db_session() as connection:
            indexes = connection.execute(f"PRAGMA index_list({self._quote_identifier(table)})").fetchall()
            for index in indexes:
                if int(index["unique"] or 0) != 1:
                    continue
                index_name = str(index["name"])
                columns = [
                    str(row["name"])
                    for row in connection.execute(f"PRAGMA index_info({self._quote_identifier(index_name)})").fetchall()
                ]
                if columns == expected:
                    return True
        return False

    def duplicate_group_count(self, table: str, fields: list[str], account_id: str | None = None) -> int:
        allowed: dict[str, set[str]] = {
            "stock_basic": {"symbol"},
            "instrument_detail": {"symbol"},
            "trading_calendar": {"market", "trade_date"},
            "account_snapshot": {"account_id", "snapshot_time"},
            "daily_kline": {"symbol", "trade_date"},
            "minute_kline": {"symbol", "period", "datetime"},
            "order_record": {"local_order_id", "qmt_order_id"},
            "trade_record": {"trade_id"},
            "position_snapshot": {"account_id", "symbol", "snapshot_time"},
            "sync_cursor": {"source_code", "data_type", "symbol", "period"},
        }
        if table not in allowed or not set(fields) <= allowed[table]:
            raise ValueError("unsupported duplicate check")
        if self.has_unique_index_for_fields(table, fields):
            return 0
        columns = ", ".join(fields)
        clauses = [f"{field} IS NOT NULL AND {field} != ?" for field in fields]
        params: list[object] = [""] * len(fields)
        if account_id and table in {"account_snapshot", "position_snapshot", "order_record", "trade_record"}:
            clauses.append("account_id = ?")
            params.append(account_id)
        with db_session() as connection:
            row = connection.execute(
                f"""
                SELECT COUNT(*) AS total
                FROM (
                    SELECT {columns}
                    FROM {table}
                    WHERE {' AND '.join(clauses)}
                    GROUP BY {columns}
                    HAVING COUNT(*) > 1
                )
                """,
                params,
            ).fetchone()
        return int(row["total"])

    def invalid_symbol_count(self) -> int:
        checks = [
            ("stock_basic", "symbol"),
            ("instrument_detail", "symbol"),
            ("daily_kline", "symbol"),
            ("minute_kline", "symbol"),
            ("position_snapshot", "symbol"),
            ("order_record", "symbol"),
            ("trade_record", "symbol"),
        ]
        invalid = 0
        with db_session() as connection:
            for table, field in checks:
                rows = connection.execute(f"SELECT DISTINCT {field} AS symbol FROM {table}").fetchall()
                invalid += sum(1 for row in rows if not is_standard_symbol(row["symbol"]))
        return invalid

    def daily_kline_missing_symbol_count(self) -> int:
        with db_session() as connection:
            row = connection.execute(
                """
                SELECT COUNT(*) AS total
                FROM stock_basic s
                LEFT JOIN instrument_detail i ON i.symbol = s.symbol
                WHERE s.list_status = '上市'
                  AND NOT (
                    i.symbol IS NOT NULL
                    AND COALESCE(i.is_trading, 0) = 0
                    AND COALESCE(i.total_volume, 0) <= 0
                    AND COALESCE(i.float_volume, 0) <= 0
                  )
                  AND NOT EXISTS (
                    SELECT 1 FROM daily_kline d WHERE d.symbol = s.symbol
                  )
                """
            ).fetchone()
        return int(row["total"])

    def failed_sync_count(self) -> int:
        with db_session() as connection:
            row = connection.execute(
                """
                SELECT COUNT(*) AS total
                FROM sync_task failed
                WHERE failed.status = 'failed'
                  AND NOT EXISTS (
                    SELECT 1
                    FROM sync_task success
                    WHERE success.sync_type = failed.sync_type
                      AND success.status = 'success'
                      AND COALESCE(success.finished_at, success.started_at) >
                          COALESCE(failed.finished_at, failed.started_at)
                  )
                """
            ).fetchone()
        return int(row["total"])

    def cursor_count(self, data_type: str | None = None) -> int:
        params: list[object] = []
        where = ""
        if data_type:
            where = "WHERE data_type = ?"
            params.append(data_type)
        with db_session() as connection:
            row = connection.execute(f"SELECT COUNT(*) AS total FROM sync_cursor {where}", params).fetchone()
        return int(row["total"])

    def legacy_cursor_symbol_count(self) -> int:
        with db_session() as connection:
            row = connection.execute("SELECT COUNT(*) AS total FROM sync_cursor WHERE symbol LIKE '%,%'").fetchone()
        return int(row["total"])

    def cleanup_legacy_cursor_symbols(self) -> list[dict[str, Any]]:
        with db_session() as connection:
            rows = connection.execute(
                """
                SELECT id, source_code, data_type, symbol, period, last_sync_time, updated_at
                FROM sync_cursor
                WHERE symbol LIKE '%,%'
                ORDER BY id ASC
                """
            ).fetchall()
            if rows:
                connection.executemany(
                    "DELETE FROM sync_cursor WHERE id = ?",
                    [(row["id"],) for row in rows],
                )
        return [dict(row) for row in rows]

    def trade_without_order_count(self) -> int:
        with db_session() as connection:
            row = connection.execute(
                """
                SELECT COUNT(*) AS total
                FROM trade_record t
                WHERE t.local_order_id IS NOT NULL
                  AND t.local_order_id != ''
                  AND NOT EXISTS (
                    SELECT 1 FROM order_record o WHERE o.local_order_id = t.local_order_id
                  )
                """
            ).fetchone()
        return int(row["total"])

    def seed_dictionary(self, records: list[dict[str, Any]]) -> None:
        with db_session() as connection:
            connection.executemany(
                """
                INSERT INTO data_dictionary(table_name, field_name, field_type, description, example_value, unit, strategy_usage, is_indexed)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(table_name, field_name) DO UPDATE SET
                    field_type=excluded.field_type, description=excluded.description,
                    example_value=excluded.example_value, unit=excluded.unit,
                    strategy_usage=excluded.strategy_usage, is_indexed=excluded.is_indexed
                """,
                [
                    (
                        r["table_name"], r["field_name"], r["field_type"], r["description"],
                        r.get("example_value"), r.get("unit"), r.get("strategy_usage"), int(r["is_indexed"]),
                    )
                    for r in records
                ],
            )

    def list_dictionary(self, query: PageQuery, table_name: str | None = None) -> PageResult[DataDictionaryRecord]:
        clauses: list[str] = []
        params: list[object] = []
        if table_name:
            clauses.append("table_name = ?")
            params.append(table_name)
        if query.keyword:
            clauses.append("(table_name LIKE ? OR field_name LIKE ? OR description LIKE ? OR unit LIKE ? OR strategy_usage LIKE ?)")
            keyword = f"%{query.keyword}%"
            params.extend([keyword, keyword, keyword, keyword, keyword])
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        offset = (query.page - 1) * query.page_size
        order_by = build_sort_clause(
            query,
            {"created_at": "table_name", "table_name": "table_name", "field_name": "field_name", "is_indexed": "is_indexed"},
            "table_name",
            default_order="asc",
        )
        with db_session() as connection:
            total = connection.execute(f"SELECT COUNT(*) AS total FROM data_dictionary {where}", params).fetchone()["total"]
            rows = connection.execute(
                f"""
                SELECT id, table_name, field_name, field_type, description, example_value, unit, strategy_usage, is_indexed
                FROM data_dictionary {where}
                ORDER BY {order_by}, id ASC
                LIMIT ? OFFSET ?
                """,
                [*params, query.page_size, offset],
            ).fetchall()
        return PageResult(
            items=[DataDictionaryRecord(**dict(row)) for row in rows],
            page=query.page,
            page_size=query.page_size,
            total=total,
            has_more=offset + query.page_size < total,
        )
