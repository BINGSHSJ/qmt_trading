"""Local SQLite capacity check for stage 14.

The script creates synthetic data in an isolated SQLite database, runs common
query patterns, and prints a JSON report. It intentionally uses only the local
single-process stack: no Redis, Celery, Docker, or external services.
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import tempfile
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


PROFILES: dict[str, dict[str, int]] = {
    "smoke": {
        "stocks": 800,
        "daily_symbols": 300,
        "daily_years": 1,
        "minute_symbols": 20,
        "minute_days": 5,
        "signals": 10_000,
        "orders": 5_000,
        "logs": 10_000,
    },
    "stage14": {
        "stocks": 5_000,
        "daily_symbols": 5_000,
        "daily_years": 3,
        "minute_symbols": 50,
        "minute_days": 20,
        "signals": 100_000,
        "orders": 50_000,
        "logs": 100_000,
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Local Quant Console performance capacity check.")
    parser.add_argument("--profile", choices=PROFILES.keys(), default="smoke")
    parser.add_argument("--database", default="", help="SQLite path. Defaults to a temp performance database.")
    parser.add_argument("--keep-database", action="store_true", help="Do not delete temp database after the run.")
    return parser.parse_args()


def chunks(rows: Iterable[tuple[Any, ...]], size: int = 5000) -> Iterable[list[tuple[Any, ...]]]:
    batch: list[tuple[Any, ...]] = []
    for row in rows:
        batch.append(row)
        if len(batch) >= size:
            yield batch
            batch = []
    if batch:
        yield batch


def trading_days(start: date, count: int) -> list[date]:
    days: list[date] = []
    current = start
    while len(days) < count:
        if current.weekday() < 5:
            days.append(current)
        current += timedelta(days=1)
    return days


def timed(label: str, metrics: list[dict[str, Any]], fn) -> Any:
    start = time.perf_counter()
    result = fn()
    elapsed_ms = round((time.perf_counter() - start) * 1000, 2)
    metrics.append({"name": label, "elapsed_ms": elapsed_ms})
    return result


def setup_database(database: Path):
    os.environ["LQC_DATABASE_PATH"] = str(database)
    os.environ.setdefault("LQC_DATA_DIR", str(database.parent))
    os.environ.setdefault("LQC_LOGS_DIR", str(database.parent / "logs"))
    os.environ.setdefault("LQC_BACKUPS_DIR", str(database.parent / "backups"))
    os.environ.setdefault("LQC_STRATEGY_USER_DIR", str(database.parent / "strategies" / "user"))

    from backend.core.database import get_connection, initialize_database

    initialize_database()
    return get_connection()


def seed_database(connection, profile: dict[str, int], metrics: list[dict[str, Any]]) -> dict[str, int]:
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    daily_days = trading_days(date(2023, 1, 2), profile["daily_years"] * 250)
    minute_days = trading_days(date(2026, 4, 1), profile["minute_days"])
    symbols = [f"{600000 + index:06d}.SH" for index in range(profile["stocks"])]
    daily_symbols = symbols[: profile["daily_symbols"]]
    minute_symbols = symbols[: profile["minute_symbols"]]

    connection.execute(
        """
        INSERT OR IGNORE INTO strategy_file(file_name, file_path, strategy_name, version, description, status, last_modified_at, last_run_at, created_at)
        VALUES ('perf_strategy.py', 'scripts/performance/perf_strategy.py', '性能压测策略', '1.0.0', '阶段14压测', 'enabled', ?, ?, ?)
        """,
        (now, now, now),
    )

    def insert_stock_basic() -> None:
        for batch in chunks(
            (
                (symbol, f"股票{index:04d}", "SH", "股票", "上市", 0, now)
                for index, symbol in enumerate(symbols)
            )
        ):
            connection.executemany(
                """
                INSERT OR REPLACE INTO stock_basic(symbol, name, market, security_type, list_status, is_st, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                batch,
            )
        connection.commit()

    def insert_daily() -> None:
        def rows():
            for symbol_index, symbol in enumerate(daily_symbols):
                base = 8.0 + (symbol_index % 120) * 0.05
                for day_index, day in enumerate(daily_days):
                    close = base + (day_index % 40) * 0.01
                    yield (
                        symbol,
                        day.isoformat(),
                        round(close - 0.03, 4),
                        round(close + 0.08, 4),
                        round(close - 0.08, 4),
                        round(close, 4),
                        100_000 + day_index * 10,
                        round((100_000 + day_index * 10) * close, 2),
                        now,
                    )

        for batch in chunks(rows()):
            connection.executemany(
                """
                INSERT OR REPLACE INTO daily_kline(symbol, trade_date, open, high, low, close, volume, amount, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                batch,
            )
        connection.commit()

    def insert_minute() -> None:
        minutes = [f"{hour:02d}:{minute:02d}:00" for hour in (9, 10, 11, 13, 14) for minute in range(0, 48)]

        def rows():
            for symbol_index, symbol in enumerate(minute_symbols):
                base = 8.5 + (symbol_index % 80) * 0.05
                for day in minute_days:
                    for minute_index, clock in enumerate(minutes):
                        price = base + (minute_index % 30) * 0.002
                        yield (
                            symbol,
                            f"{day.isoformat()} {clock}",
                            "1m",
                            round(price - 0.005, 4),
                            round(price + 0.008, 4),
                            round(price - 0.008, 4),
                            round(price, 4),
                            1000 + minute_index,
                            round((1000 + minute_index) * price, 2),
                            now,
                        )

        for batch in chunks(rows()):
            connection.executemany(
                """
                INSERT OR REPLACE INTO minute_kline(symbol, datetime, period, open, high, low, close, volume, amount, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                batch,
            )
        connection.commit()

    def insert_signals() -> None:
        signal_days = trading_days(date(2026, 1, 2), 250)

        def rows():
            for index in range(profile["signals"]):
                symbol = symbols[index % len(symbols)]
                signal_time = f"{signal_days[index % len(signal_days)].isoformat()} 15:00:00"
                yield (
                    1,
                    "perf_run",
                    symbol,
                    f"股票{index % len(symbols):04d}",
                    "BUY" if index % 3 else "SELL",
                    10.0 + index % 50,
                    10000.0,
                    "阶段14容量测试信号",
                    "未处理" if index % 4 else "已下单",
                    signal_time,
                    None,
                    now,
                )

        for batch in chunks(rows()):
            connection.executemany(
                """
                INSERT INTO strategy_signal(strategy_id, run_id, symbol, name, action, price, amount, reason, status, signal_time, order_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                batch,
            )
        connection.commit()

    def insert_orders_trades() -> None:
        order_days = trading_days(date(2026, 1, 2), 250)

        def order_rows():
            for index in range(profile["orders"]):
                symbol = symbols[index % len(symbols)]
                order_time = f"{order_days[index % len(order_days)].isoformat()} 10:00:00"
                status = "全部成交" if index % 5 else "已报"
                yield (
                    f"perf_order_{index:08d}",
                    f"perf_qmt_{index:08d}",
                    "test_isolation_account",
                    symbol,
                    f"股票{index % len(symbols):04d}",
                    "BUY" if index % 2 else "SELL",
                    10.0 + index % 50,
                    100 + (index % 20) * 100,
                    100 + (index % 20) * 100 if status == "全部成交" else 0,
                    status,
                    "filled" if status == "全部成交" else "accepted",
                    "test_sync",
                    None,
                    None,
                    f"perf_key_{index:08d}",
                    order_time,
                    now,
                )

        def trade_rows():
            for index in range(profile["orders"]):
                symbol = symbols[index % len(symbols)]
                price = 10.0 + index % 50
                quantity = 100 + (index % 20) * 100
                trade_time = f"{order_days[index % len(order_days)].isoformat()} 10:01:00"
                yield (
                    f"perf_trade_{index:08d}",
                    f"perf_order_{index:08d}",
                    f"perf_qmt_{index:08d}",
                    "test_isolation_account",
                    symbol,
                    f"股票{index % len(symbols):04d}",
                    "BUY" if index % 2 else "SELL",
                    price,
                    quantity,
                    round(price * quantity, 2),
                    round(price * quantity * 0.0003, 2),
                    "test_sync",
                    trade_time,
                )

        for batch in chunks(order_rows()):
            connection.executemany(
                """
                INSERT OR REPLACE INTO order_record(
                    local_order_id, qmt_order_id, account_id, symbol, name, side, price, quantity,
                    filled_quantity, status, qmt_status, source, strategy_id, signal_id, idempotency_key,
                    order_time, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                batch,
            )
        for batch in chunks(trade_rows()):
            connection.executemany(
                """
                INSERT OR REPLACE INTO trade_record(
                    trade_id, local_order_id, qmt_order_id, account_id, symbol, name, side,
                    price, quantity, amount, fee, source, trade_time
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                batch,
            )
        connection.commit()

    def insert_logs() -> None:
        def rows():
            for index in range(profile["logs"]):
                yield (
                    "性能压测",
                    "error" if index % 50 == 0 else "info",
                    "阶段14容量测试日志",
                    f"perf_detail={index}",
                    f"perf_{index:08d}",
                    now,
                )

        for batch in chunks(rows()):
            connection.executemany(
                """
                INSERT INTO system_log(module, level, message, technical_detail, related_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                batch,
            )
        connection.commit()

    timed("seed_stock_basic", metrics, insert_stock_basic)
    timed("seed_daily_kline", metrics, insert_daily)
    timed("seed_minute_kline", metrics, insert_minute)
    timed("seed_strategy_signal", metrics, insert_signals)
    timed("seed_orders_trades", metrics, insert_orders_trades)
    timed("seed_system_log", metrics, insert_logs)

    return {
        "stock_basic": profile["stocks"],
        "daily_kline": profile["daily_symbols"] * len(daily_days),
        "minute_kline": profile["minute_symbols"] * len(minute_days) * 240,
        "strategy_signal": profile["signals"],
        "order_record": profile["orders"],
        "trade_record": profile["orders"],
        "system_log": profile["logs"],
    }


def run_queries(connection, metrics: list[dict[str, Any]]) -> list[dict[str, Any]]:
    queries = [
        ("stocks_page", "SELECT * FROM stock_basic WHERE symbol LIKE ? ORDER BY updated_at DESC, id DESC LIMIT 50 OFFSET 0", ("%600%",)),
        ("daily_symbol_range", "SELECT * FROM daily_kline WHERE symbol=? AND trade_date BETWEEN ? AND ? ORDER BY trade_date DESC LIMIT 200", ("600001.SH", "2024-01-01", "2026-12-31")),
        ("minute_symbol_range", "SELECT * FROM minute_kline WHERE symbol=? AND period=? AND datetime BETWEEN ? AND ? ORDER BY datetime DESC LIMIT 200", ("600001.SH", "1m", "2026-04-01 00:00:00", "2026-05-30 23:59:59")),
        ("signals_unhandled_page", "SELECT * FROM strategy_signal WHERE status=? ORDER BY signal_time DESC, id DESC LIMIT 50", ("未处理",)),
        ("orders_status_page", "SELECT * FROM order_record WHERE status=? ORDER BY order_time DESC, id DESC LIMIT 50", ("全部成交",)),
        ("trades_symbol_page", "SELECT * FROM trade_record WHERE symbol=? ORDER BY trade_time DESC, id DESC LIMIT 50", ("600001.SH",)),
        ("system_errors_page", "SELECT * FROM system_log WHERE level=? ORDER BY created_at DESC, id DESC LIMIT 50", ("error",)),
    ]
    results: list[dict[str, Any]] = []
    for name, sql, params in queries:
        elapsed: list[float] = []
        rows_count = 0
        for _ in range(5):
            start = time.perf_counter()
            rows = connection.execute(sql, params).fetchall()
            elapsed.append((time.perf_counter() - start) * 1000)
            rows_count = len(rows)
        result = {
            "name": name,
            "rows": rows_count,
            "avg_ms": round(statistics.mean(elapsed), 2),
            "max_ms": round(max(elapsed), 2),
        }
        metrics.append({"name": f"query_{name}", "elapsed_ms": result["avg_ms"]})
        results.append(result)
    return results


def main() -> None:
    args = parse_args()
    profile = PROFILES[args.profile]
    temp_dir = Path(tempfile.mkdtemp(prefix="lqc_perf_"))
    database = Path(args.database) if args.database else temp_dir / f"stage14_{args.profile}.db"
    database.parent.mkdir(parents=True, exist_ok=True)
    if database.exists():
        database.unlink()

    metrics: list[dict[str, Any]] = []
    connection = setup_database(database)
    try:
        counts = seed_database(connection, profile, metrics)
        queries = run_queries(connection, metrics)
        journal_mode = connection.execute("PRAGMA journal_mode").fetchone()[0]
        indexes = connection.execute(
            """
            SELECT name FROM sqlite_master
            WHERE type='index'
            ORDER BY name
            """
        ).fetchall()
        report = {
            "profile": args.profile,
            "database": str(database),
            "database_size_mb": round(database.stat().st_size / 1024 / 1024, 2),
            "journal_mode": journal_mode,
            "row_counts": counts,
            "query_results": queries,
            "slow_queries": [item for item in queries if item["max_ms"] > 200],
            "slow_steps": [item for item in metrics if item["elapsed_ms"] > 5000],
            "index_count": len(indexes),
            "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }
        print(json.dumps(report, ensure_ascii=False, indent=2))
    finally:
        connection.close()
        if not args.keep_database and not args.database:
            for suffix in ("", "-wal", "-shm"):
                path = Path(f"{database}{suffix}")
                if path.exists():
                    path.unlink()
            try:
                temp_dir.rmdir()
            except OSError:
                pass


if __name__ == "__main__":
    main()
