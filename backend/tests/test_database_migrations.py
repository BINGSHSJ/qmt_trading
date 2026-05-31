import sqlite3

from backend.core import database as database_module
from backend.core.config import settings


def test_initialize_database_adds_strategy_run_hash_before_index(monkeypatch, tmp_path):
    database_path = tmp_path / "old_schema.db"
    with sqlite3.connect(database_path) as connection:
        connection.execute(
            """
            CREATE TABLE strategy_run_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT NOT NULL UNIQUE,
                strategy_id INTEGER NOT NULL,
                task_id TEXT NOT NULL,
                status TEXT NOT NULL,
                signal_count INTEGER NOT NULL DEFAULT 0,
                started_at TEXT,
                finished_at TEXT,
                message TEXT NOT NULL,
                technical_detail TEXT
            )
            """
        )
        connection.commit()

    monkeypatch.setattr(settings, "database_path", database_path)
    monkeypatch.setattr(settings, "data_dir", tmp_path)

    database_module.initialize_database()

    with sqlite3.connect(database_path) as connection:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(strategy_run_log)").fetchall()}
        indexes = {row[1] for row in connection.execute("PRAGMA index_list(strategy_run_log)").fetchall()}

    assert "strategy_code_hash" in columns
    assert "idx_strategy_run_log_strategy_hash" in indexes


def test_initialize_database_adds_minute_kline_trade_date_expression_indexes(monkeypatch, tmp_path):
    database_path = tmp_path / "minute_index.db"
    monkeypatch.setattr(settings, "database_path", database_path)
    monkeypatch.setattr(settings, "data_dir", tmp_path)

    database_module.initialize_database()

    with sqlite3.connect(database_path) as connection:
        indexes = {row[1] for row in connection.execute("PRAGMA index_list(minute_kline)").fetchall()}
        connection.execute(
            """
            INSERT INTO minute_kline(symbol, datetime, period, open, high, low, close, volume, amount, created_at)
            VALUES ('600000.SH', '2026-05-20 09:30:00', '1m', 10, 10, 10, 10, 100, 1000, '2026-05-20 16:00:00')
            """
        )
        plan = "\n".join(
            str(row)
            for row in connection.execute(
                """
                EXPLAIN QUERY PLAN
                SELECT COUNT(*) FROM minute_kline
                WHERE period = '1m' AND substr(datetime, 1, 10) BETWEEN '2026-05-20' AND '2026-05-20'
                """
            ).fetchall()
        )

    assert "idx_minute_kline_period_trade_date_expr" in indexes
    assert "idx_minute_kline_symbol_period_trade_date_expr" in indexes
    assert "idx_minute_kline_period_trade_date_expr" in plan


def test_initialize_database_adds_sync_task_list_indexes(monkeypatch, tmp_path):
    database_path = tmp_path / "sync_task_indexes.db"
    monkeypatch.setattr(settings, "database_path", database_path)
    monkeypatch.setattr(settings, "data_dir", tmp_path)

    database_module.initialize_database()

    with sqlite3.connect(database_path) as connection:
        sync_task_indexes = {row[1] for row in connection.execute("PRAGMA index_list(sync_task)").fetchall()}
        sync_log_indexes = {row[1] for row in connection.execute("PRAGMA index_list(sync_log)").fetchall()}
        connection.execute(
            """
            INSERT INTO sync_task(task_id, sync_type, status, started_at)
            VALUES ('task_perf_001', 'sync_latest_data', 'running', '2026-05-30 09:00:00')
            """
        )
        connection.execute(
            """
            INSERT INTO sync_log(task_id, sync_type, level, message, technical_detail, created_at)
            VALUES ('task_perf_001', 'sync_latest_data', 'info', '测试日志', '{}', '2026-05-30 09:00:01')
            """
        )
        plan = "\n".join(
            str(row)
            for row in connection.execute(
                """
                EXPLAIN QUERY PLAN
                SELECT latest_log.id
                FROM sync_task s
                LEFT JOIN sync_log latest_log ON latest_log.id = (
                    SELECT MAX(id)
                    FROM sync_log
                    WHERE task_id = s.task_id
                )
                ORDER BY s.started_at DESC, s.id DESC
                LIMIT 5
                """
            ).fetchall()
        )

    assert "idx_sync_task_started_id" in sync_task_indexes
    assert "idx_sync_log_task_id_id" in sync_log_indexes
    assert "idx_sync_log_task_id_id" in plan
