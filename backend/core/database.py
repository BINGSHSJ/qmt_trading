import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager

from backend.core.config import settings


def get_connection() -> sqlite3.Connection:
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(settings.database_path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA synchronous = NORMAL")
    connection.execute("PRAGMA busy_timeout = 5000")
    connection.execute("PRAGMA foreign_keys = ON")
    # 大库读性能调优：在 37GB / 千万级 minute_kline 上，mmap I/O 与更大的页缓存能把宽扫描类查询从约 1.9s 降到 0.2s 级别；
    # temp_store=MEMORY 让排序/分组的临时 B 树走内存。这些都是按连接生效的只读优化，不改变数据语义。
    connection.execute("PRAGMA cache_size = -8000")
    connection.execute("PRAGMA temp_store = MEMORY")
    connection.execute("PRAGMA mmap_size = 268435456")
    return connection


@contextmanager
def db_session() -> Iterator[sqlite3.Connection]:
    connection = get_connection()
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_database() -> None:
    with db_session() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS app_config (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                config_key TEXT NOT NULL UNIQUE,
                config_value TEXT NOT NULL,
                value_type TEXT NOT NULL DEFAULT 'string',
                description TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS runtime_task (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL UNIQUE,
                task_type TEXT NOT NULL,
                status TEXT NOT NULL,
                progress INTEGER NOT NULL DEFAULT 0,
                message TEXT NOT NULL DEFAULT '',
                technical_detail TEXT,
                started_at TEXT,
                finished_at TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_runtime_task_type_status_created
                ON runtime_task(task_type, status, created_at);

            CREATE TABLE IF NOT EXISTS operation_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                module TEXT NOT NULL,
                action TEXT NOT NULL,
                target_type TEXT NOT NULL,
                target_id TEXT,
                result TEXT NOT NULL,
                message TEXT NOT NULL,
                technical_detail TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_operation_log_module_created
                ON operation_log(module, created_at);

            CREATE TABLE IF NOT EXISTS backup_record (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                backup_name TEXT NOT NULL,
                backup_path TEXT NOT NULL,
                backup_size INTEGER NOT NULL DEFAULT 0,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS environment_check (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL,
                check_item TEXT NOT NULL,
                status TEXT NOT NULL,
                message TEXT NOT NULL,
                suggestion TEXT,
                technical_detail TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_environment_check_task_created
                ON environment_check(task_id, created_at);

            CREATE TABLE IF NOT EXISTS system_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                module TEXT NOT NULL,
                level TEXT NOT NULL,
                message TEXT NOT NULL,
                technical_detail TEXT,
                related_id TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_system_log_module_created
                ON system_log(module, created_at);
            CREATE INDEX IF NOT EXISTS idx_system_log_level_created
                ON system_log(level, created_at);

            CREATE TABLE IF NOT EXISTS data_source (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_code TEXT NOT NULL UNIQUE,
                source_name TEXT NOT NULL,
                status TEXT NOT NULL,
                config_json TEXT NOT NULL DEFAULT '{}',
                last_connected_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS stock_basic (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                market TEXT NOT NULL,
                security_type TEXT NOT NULL,
                list_status TEXT NOT NULL,
                is_st INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS instrument_detail (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT NOT NULL UNIQUE,
                exchange_id TEXT NOT NULL DEFAULT '',
                instrument_id TEXT NOT NULL DEFAULT '',
                instrument_name TEXT NOT NULL DEFAULT '',
                exchange_code TEXT NOT NULL DEFAULT '',
                open_date TEXT,
                expire_date TEXT,
                pre_close REAL NOT NULL DEFAULT 0,
                up_stop_price REAL NOT NULL DEFAULT 0,
                down_stop_price REAL NOT NULL DEFAULT 0,
                is_trading INTEGER NOT NULL DEFAULT 1,
                instrument_status TEXT NOT NULL DEFAULT '',
                total_volume REAL NOT NULL DEFAULT 0,
                float_volume REAL NOT NULL DEFAULT 0,
                trading_day TEXT,
                raw_json TEXT NOT NULL DEFAULT '{}',
                sync_time TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_instrument_detail_symbol
                ON instrument_detail(symbol);
            CREATE INDEX IF NOT EXISTS idx_instrument_detail_trading_day
                ON instrument_detail(trading_day);

            CREATE TABLE IF NOT EXISTS trading_calendar (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                market TEXT NOT NULL,
                trade_date TEXT NOT NULL,
                is_trading_day INTEGER NOT NULL DEFAULT 1,
                source TEXT NOT NULL DEFAULT 'qmt',
                sync_time TEXT NOT NULL,
                UNIQUE(market, trade_date)
            );
            CREATE INDEX IF NOT EXISTS idx_trading_calendar_market_date
                ON trading_calendar(market, trade_date);
            CREATE INDEX IF NOT EXISTS idx_trading_calendar_date
                ON trading_calendar(trade_date);

            CREATE TABLE IF NOT EXISTS daily_kline (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT NOT NULL,
                trade_date TEXT NOT NULL,
                open REAL NOT NULL,
                high REAL NOT NULL,
                low REAL NOT NULL,
                close REAL NOT NULL,
                pre_close REAL NOT NULL DEFAULT 0,
                volume REAL NOT NULL,
                amount REAL NOT NULL,
                suspend_flag INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                UNIQUE(symbol, trade_date)
            );
            CREATE INDEX IF NOT EXISTS idx_daily_kline_symbol_date ON daily_kline(symbol, trade_date);

            CREATE TABLE IF NOT EXISTS minute_kline (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT NOT NULL,
                datetime TEXT NOT NULL,
                period TEXT NOT NULL,
                open REAL NOT NULL,
                high REAL NOT NULL,
                low REAL NOT NULL,
                close REAL NOT NULL,
                pre_close REAL NOT NULL DEFAULT 0,
                volume REAL NOT NULL,
                amount REAL NOT NULL,
                suspend_flag INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                UNIQUE(symbol, period, datetime)
            );
            CREATE INDEX IF NOT EXISTS idx_minute_kline_symbol_datetime ON minute_kline(symbol, datetime);
            CREATE INDEX IF NOT EXISTS idx_minute_kline_symbol_period_datetime
                ON minute_kline(symbol, period, datetime);
            CREATE INDEX IF NOT EXISTS idx_minute_kline_period_datetime
                ON minute_kline(period, datetime);
            CREATE INDEX IF NOT EXISTS idx_minute_kline_period_trade_date_expr
                ON minute_kline(period, substr(datetime, 1, 10));
            CREATE INDEX IF NOT EXISTS idx_minute_kline_symbol_period_trade_date_expr
                ON minute_kline(symbol, period, substr(datetime, 1, 10));

            CREATE TABLE IF NOT EXISTS account_snapshot (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id TEXT NOT NULL,
                total_asset REAL NOT NULL,
                available_cash REAL NOT NULL,
                frozen_cash REAL NOT NULL,
                market_value REAL NOT NULL,
                today_pnl REAL NOT NULL,
                snapshot_time TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_account_snapshot_account_time
                ON account_snapshot(account_id, snapshot_time);

            CREATE TABLE IF NOT EXISTS position_snapshot (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id TEXT NOT NULL,
                symbol TEXT NOT NULL,
                name TEXT NOT NULL,
                quantity INTEGER NOT NULL,
                available_quantity INTEGER NOT NULL,
                cost_price REAL NOT NULL,
                last_price REAL NOT NULL,
                market_value REAL NOT NULL,
                pnl REAL NOT NULL,
                pnl_ratio REAL NOT NULL,
                snapshot_time TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_position_snapshot_account_symbol_time
                ON position_snapshot(account_id, symbol, snapshot_time);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_position_snapshot_unique_account_symbol_time
                ON position_snapshot(account_id, symbol, snapshot_time);

            CREATE TABLE IF NOT EXISTS order_record (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                local_order_id TEXT NOT NULL UNIQUE,
                qmt_order_id TEXT,
                account_id TEXT NOT NULL,
                symbol TEXT NOT NULL,
                name TEXT NOT NULL,
                side TEXT NOT NULL,
                price REAL NOT NULL,
                quantity INTEGER NOT NULL,
                filled_quantity INTEGER NOT NULL,
                status TEXT NOT NULL,
                qmt_status TEXT,
                source TEXT NOT NULL,
                strategy_id TEXT,
                signal_id TEXT,
                idempotency_key TEXT,
                order_time TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_order_record_order_time ON order_record(order_time);
            CREATE INDEX IF NOT EXISTS idx_order_record_status ON order_record(status);
            CREATE INDEX IF NOT EXISTS idx_order_record_symbol_time
                ON order_record(symbol, order_time);
            CREATE INDEX IF NOT EXISTS idx_order_record_account_time
                ON order_record(account_id, order_time);
            CREATE INDEX IF NOT EXISTS idx_order_record_status_time
                ON order_record(status, order_time);
            CREATE INDEX IF NOT EXISTS idx_order_record_source_time
                ON order_record(source, order_time);
            CREATE INDEX IF NOT EXISTS idx_order_record_qmt_order
                ON order_record(qmt_order_id);
            DROP INDEX IF EXISTS idx_order_record_idempotency;
            CREATE INDEX IF NOT EXISTS idx_order_record_idempotency
                ON order_record(idempotency_key);
            DROP INDEX IF EXISTS idx_order_record_active_idempotency;
            CREATE UNIQUE INDEX IF NOT EXISTS idx_order_record_active_idempotency
                ON order_record(idempotency_key)
                WHERE idempotency_key IS NOT NULL AND status IN ('待提交', '已提交', '已报', '部分成交');

            CREATE TABLE IF NOT EXISTS trade_record (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trade_id TEXT NOT NULL UNIQUE,
                local_order_id TEXT,
                qmt_order_id TEXT,
                account_id TEXT NOT NULL,
                symbol TEXT NOT NULL,
                name TEXT NOT NULL,
                side TEXT NOT NULL,
                price REAL NOT NULL,
                quantity INTEGER NOT NULL,
                amount REAL NOT NULL,
                fee REAL NOT NULL,
                source TEXT NOT NULL,
                trade_time TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_trade_record_time ON trade_record(trade_time);
            CREATE INDEX IF NOT EXISTS idx_trade_record_symbol ON trade_record(symbol);
            CREATE INDEX IF NOT EXISTS idx_trade_record_account_time
                ON trade_record(account_id, trade_time);
            CREATE INDEX IF NOT EXISTS idx_trade_record_local_order ON trade_record(local_order_id);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_trade_record_trade_id
                ON trade_record(trade_id);

            CREATE TABLE IF NOT EXISTS signal_order (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                signal_id INTEGER NOT NULL UNIQUE,
                local_order_id TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS execution_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                local_order_id TEXT,
                level TEXT NOT NULL,
                message TEXT NOT NULL,
                technical_detail TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_execution_log_order_created
                ON execution_log(local_order_id, created_at);

            CREATE TABLE IF NOT EXISTS sync_cursor (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_code TEXT NOT NULL,
                data_type TEXT NOT NULL,
                symbol TEXT NOT NULL DEFAULT '',
                period TEXT NOT NULL DEFAULT '',
                last_sync_time TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(source_code, data_type, symbol, period)
            );
            CREATE INDEX IF NOT EXISTS idx_sync_cursor_type_symbol_period
                ON sync_cursor(data_type, symbol, period);

            CREATE TABLE IF NOT EXISTS sync_task (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL UNIQUE,
                sync_type TEXT NOT NULL,
                status TEXT NOT NULL,
                total_count INTEGER NOT NULL DEFAULT 0,
                success_count INTEGER NOT NULL DEFAULT 0,
                failed_count INTEGER NOT NULL DEFAULT 0,
                started_at TEXT,
                finished_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_sync_task_type_status_started
                ON sync_task(sync_type, status, started_at);
            CREATE INDEX IF NOT EXISTS idx_sync_task_started_id
                ON sync_task(started_at, id);

            CREATE TABLE IF NOT EXISTS sync_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL,
                sync_type TEXT NOT NULL,
                level TEXT NOT NULL,
                message TEXT NOT NULL,
                technical_detail TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_sync_log_type_created ON sync_log(sync_type, created_at);
            CREATE INDEX IF NOT EXISTS idx_sync_log_type_level_created
                ON sync_log(sync_type, level, created_at);
            CREATE INDEX IF NOT EXISTS idx_sync_log_task_id_id
                ON sync_log(task_id, id);

            CREATE TABLE IF NOT EXISTS data_quality_check (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                check_type TEXT NOT NULL,
                target_table TEXT NOT NULL,
                status TEXT NOT NULL,
                message TEXT NOT NULL,
                suggestion TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS data_dictionary (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                table_name TEXT NOT NULL,
                field_name TEXT NOT NULL,
                field_type TEXT NOT NULL,
                description TEXT NOT NULL,
                example_value TEXT,
                unit TEXT,
                strategy_usage TEXT,
                is_indexed INTEGER NOT NULL DEFAULT 0,
                UNIQUE(table_name, field_name)
            );

            CREATE TABLE IF NOT EXISTS data_coverage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                data_type TEXT NOT NULL,
                symbol TEXT NOT NULL DEFAULT 'ALL',
                period TEXT NOT NULL DEFAULT '',
                start_date TEXT NOT NULL,
                end_date TEXT NOT NULL,
                expected_trading_days INTEGER NOT NULL DEFAULT 0,
                actual_trading_days INTEGER NOT NULL DEFAULT 0,
                expected_rows INTEGER,
                actual_rows INTEGER NOT NULL DEFAULT 0,
                missing_days TEXT NOT NULL DEFAULT '[]',
                duplicate_rows INTEGER NOT NULL DEFAULT 0,
                coverage_rate REAL NOT NULL DEFAULT 0,
                status TEXT NOT NULL,
                checked_at TEXT NOT NULL,
                UNIQUE(data_type, symbol, period, start_date, end_date)
            );
            CREATE INDEX IF NOT EXISTS idx_coverage_type_period
                ON data_coverage(data_type, period, start_date, end_date);
            CREATE INDEX IF NOT EXISTS idx_coverage_range_checked
                ON data_coverage(start_date, end_date, checked_at);
            CREATE INDEX IF NOT EXISTS idx_coverage_range_status
                ON data_coverage(start_date, end_date, status, checked_at);
            CREATE INDEX IF NOT EXISTS idx_coverage_incomplete_latest
                ON data_coverage(data_type, period, checked_at)
                WHERE status != 'complete';

            CREATE TABLE IF NOT EXISTS strategy_file (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_name TEXT NOT NULL UNIQUE,
                file_path TEXT NOT NULL UNIQUE,
                strategy_name TEXT NOT NULL,
                version TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'enabled',
                last_modified_at TEXT,
                last_run_at TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS strategy_version (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                strategy_id INTEGER NOT NULL,
                version_no TEXT NOT NULL,
                code_content TEXT NOT NULL,
                code_hash TEXT NOT NULL,
                remark TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS strategy_run_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id TEXT NOT NULL UNIQUE,
                strategy_id INTEGER NOT NULL,
                strategy_name TEXT NOT NULL DEFAULT '',
                strategy_file_name TEXT NOT NULL DEFAULT '',
                strategy_version TEXT NOT NULL DEFAULT '',
                strategy_code_hash TEXT NOT NULL DEFAULT '',
                task_id TEXT NOT NULL,
                status TEXT NOT NULL,
                signal_count INTEGER NOT NULL DEFAULT 0,
                started_at TEXT,
                finished_at TEXT,
                message TEXT NOT NULL,
                technical_detail TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_strategy_run_log_strategy_status
                ON strategy_run_log(strategy_id, status);
            CREATE INDEX IF NOT EXISTS idx_strategy_run_log_status_started
                ON strategy_run_log(status, started_at);

            CREATE TABLE IF NOT EXISTS strategy_signal (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                strategy_id INTEGER NOT NULL,
                run_id TEXT NOT NULL,
                symbol TEXT NOT NULL,
                name TEXT NOT NULL DEFAULT '',
                action TEXT NOT NULL,
                price REAL NOT NULL,
                amount REAL,
                reason TEXT NOT NULL,
                status TEXT NOT NULL,
                signal_time TEXT NOT NULL,
                order_id TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_strategy_signal_strategy_time
                ON strategy_signal(strategy_id, signal_time);
            CREATE INDEX IF NOT EXISTS idx_strategy_signal_status_time
                ON strategy_signal(status, signal_time);
            CREATE INDEX IF NOT EXISTS idx_strategy_signal_symbol_time
                ON strategy_signal(symbol, signal_time);

            CREATE TABLE IF NOT EXISTS strategy_error_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                strategy_id INTEGER NOT NULL,
                run_id TEXT NOT NULL,
                message TEXT NOT NULL,
                technical_detail TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS backtest_task (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL UNIQUE,
                backtest_name TEXT NOT NULL,
                strategy_id INTEGER NOT NULL,
                start_date TEXT NOT NULL,
                end_date TEXT NOT NULL,
                initial_cash REAL NOT NULL,
                single_order_amount REAL NOT NULL,
                data_frequency TEXT NOT NULL,
                fill_mode TEXT NOT NULL,
                fee_rate REAL NOT NULL,
                stamp_tax_rate REAL NOT NULL,
                slippage REAL NOT NULL,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_backtest_task_status_created
                ON backtest_task(status, created_at);
            CREATE INDEX IF NOT EXISTS idx_backtest_task_strategy_created
                ON backtest_task(strategy_id, created_at);

            CREATE TABLE IF NOT EXISTS backtest_result (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                backtest_id INTEGER NOT NULL UNIQUE,
                total_return REAL NOT NULL,
                annual_return REAL NOT NULL,
                max_drawdown REAL NOT NULL,
                win_rate REAL NOT NULL,
                trade_count INTEGER NOT NULL,
                buy_count INTEGER NOT NULL DEFAULT 0,
                sell_count INTEGER NOT NULL DEFAULT 0,
                profit_loss_ratio REAL NOT NULL,
                average_holding_days REAL NOT NULL,
                ending_cash REAL NOT NULL DEFAULT 0,
                open_position_count INTEGER NOT NULL DEFAULT 0,
                open_market_value REAL NOT NULL DEFAULT 0,
                total_fee REAL NOT NULL DEFAULT 0,
                realized_pnl REAL NOT NULL DEFAULT 0,
                final_cash REAL NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS backtest_manifest (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                backtest_id INTEGER NOT NULL UNIQUE,
                strategy_file_name TEXT NOT NULL,
                strategy_code_hash TEXT NOT NULL,
                strategy_name TEXT NOT NULL,
                strategy_version TEXT NOT NULL DEFAULT '',
                data_frequency TEXT NOT NULL,
                fill_mode TEXT NOT NULL,
                qmt_mode TEXT NOT NULL,
                qmt_path TEXT NOT NULL DEFAULT '',
                account_id TEXT NOT NULL DEFAULT '',
                data_coverage_snapshot TEXT NOT NULL DEFAULT '[]',
                universe_summary TEXT NOT NULL DEFAULT '{}',
                rule_snapshot TEXT NOT NULL DEFAULT '{}',
                engine_version TEXT NOT NULL DEFAULT '1.0.0',
                trust_level TEXT NOT NULL DEFAULT 'technical',
                trust_message TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_backtest_manifest_trust
                ON backtest_manifest(trust_level, created_at);

            CREATE TABLE IF NOT EXISTS backtest_trade (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                backtest_id INTEGER NOT NULL,
                symbol TEXT NOT NULL,
                name TEXT NOT NULL,
                side TEXT NOT NULL,
                price REAL NOT NULL,
                quantity INTEGER NOT NULL,
                amount REAL NOT NULL,
                fee REAL NOT NULL,
                trade_time TEXT NOT NULL,
                reason TEXT NOT NULL,
                pnl REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_backtest_trade_task_time
                ON backtest_trade(backtest_id, trade_time);
            CREATE INDEX IF NOT EXISTS idx_backtest_trade_task_symbol
                ON backtest_trade(backtest_id, symbol);

            CREATE TABLE IF NOT EXISTS backtest_signal (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                backtest_id INTEGER NOT NULL,
                signal_time TEXT NOT NULL,
                symbol TEXT NOT NULL,
                name TEXT NOT NULL DEFAULT '',
                action TEXT NOT NULL,
                price REAL NOT NULL DEFAULT 0,
                amount REAL,
                reason TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL,
                execution_time TEXT,
                execution_price REAL,
                quantity INTEGER NOT NULL DEFAULT 0,
                skip_reason TEXT,
                is_auto_exit INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_backtest_signal_task_time
                ON backtest_signal(backtest_id, signal_time);
            CREATE INDEX IF NOT EXISTS idx_backtest_signal_task_status
                ON backtest_signal(backtest_id, status);
            CREATE INDEX IF NOT EXISTS idx_backtest_signal_task_symbol
                ON backtest_signal(backtest_id, symbol);

            CREATE TABLE IF NOT EXISTS backtest_equity (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                backtest_id INTEGER NOT NULL,
                trade_date TEXT NOT NULL,
                equity REAL NOT NULL,
                cash REAL NOT NULL,
                market_value REAL NOT NULL,
                drawdown REAL NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_backtest_equity_task_date
                ON backtest_equity(backtest_id, trade_date);

            CREATE TABLE IF NOT EXISTS backtest_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                backtest_id INTEGER NOT NULL,
                level TEXT NOT NULL,
                message TEXT NOT NULL,
                technical_detail TEXT,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_backtest_log_task_created
                ON backtest_log(backtest_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_backtest_log_task_level
                ON backtest_log(backtest_id, level);
            """
        )
        _ensure_column(connection, "data_dictionary", "unit", "TEXT")
        _ensure_column(connection, "data_dictionary", "strategy_usage", "TEXT")
        _ensure_column(connection, "daily_kline", "pre_close", "REAL NOT NULL DEFAULT 0")
        _ensure_column(connection, "daily_kline", "suspend_flag", "INTEGER NOT NULL DEFAULT 0")
        _ensure_column(connection, "minute_kline", "pre_close", "REAL NOT NULL DEFAULT 0")
        _ensure_column(connection, "minute_kline", "suspend_flag", "INTEGER NOT NULL DEFAULT 0")
        _ensure_column(connection, "backtest_result", "buy_count", "INTEGER NOT NULL DEFAULT 0")
        _ensure_column(connection, "backtest_result", "sell_count", "INTEGER NOT NULL DEFAULT 0")
        _ensure_column(connection, "backtest_result", "ending_cash", "REAL NOT NULL DEFAULT 0")
        _ensure_column(connection, "backtest_result", "open_position_count", "INTEGER NOT NULL DEFAULT 0")
        _ensure_column(connection, "backtest_result", "open_market_value", "REAL NOT NULL DEFAULT 0")
        _ensure_column(connection, "backtest_result", "total_fee", "REAL NOT NULL DEFAULT 0")
        _ensure_column(connection, "backtest_result", "realized_pnl", "REAL NOT NULL DEFAULT 0")
        _ensure_column(connection, "strategy_run_log", "strategy_name", "TEXT NOT NULL DEFAULT ''")
        _ensure_column(connection, "strategy_run_log", "strategy_file_name", "TEXT NOT NULL DEFAULT ''")
        _ensure_column(connection, "strategy_run_log", "strategy_version", "TEXT NOT NULL DEFAULT ''")
        _ensure_column(connection, "strategy_run_log", "strategy_code_hash", "TEXT NOT NULL DEFAULT ''")
        _backfill_backtest_result_audit_columns(connection)
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_strategy_run_log_strategy_hash ON strategy_run_log(strategy_id, strategy_code_hash)"
        )
        connection.execute("CREATE INDEX IF NOT EXISTS idx_daily_kline_suspend_date ON daily_kline(suspend_flag, trade_date)")
        _refresh_query_planner_statistics(connection)


def _refresh_query_planner_statistics(connection: sqlite3.Connection) -> None:
    # 让查询规划器拥有最新的索引选择性统计；否则在千万级 minute_kline 等大表上只能靠默认猜测选索引。
    # analysis_limit 限制每个索引的采样行数，即使 37GB 主库也只需毫秒级，启动时刷新足够准确又不拖慢启动。
    connection.execute("PRAGMA analysis_limit = 400")
    connection.execute("ANALYZE")


def _ensure_column(connection: sqlite3.Connection, table_name: str, column_name: str, definition: str) -> None:
    columns = {row["name"] for row in connection.execute(f"PRAGMA table_info({table_name})").fetchall()}
    if column_name not in columns:
        connection.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {definition}")


def _backfill_backtest_result_audit_columns(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        UPDATE backtest_result
        SET
            buy_count = COALESCE((
                SELECT COUNT(*) FROM backtest_trade
                WHERE backtest_trade.backtest_id = backtest_result.backtest_id
                  AND side = 'BUY'
            ), 0),
            sell_count = COALESCE((
                SELECT COUNT(*) FROM backtest_trade
                WHERE backtest_trade.backtest_id = backtest_result.backtest_id
                  AND side = 'SELL'
            ), 0),
            total_fee = COALESCE((
                SELECT ROUND(SUM(fee), 2) FROM backtest_trade
                WHERE backtest_trade.backtest_id = backtest_result.backtest_id
            ), 0),
            realized_pnl = COALESCE((
                SELECT ROUND(SUM(pnl), 2) FROM backtest_trade
                WHERE backtest_trade.backtest_id = backtest_result.backtest_id
                  AND side = 'SELL'
            ), 0),
            ending_cash = COALESCE((
                SELECT cash FROM backtest_equity
                WHERE backtest_equity.backtest_id = backtest_result.backtest_id
                ORDER BY trade_date DESC, id DESC
                LIMIT 1
            ), final_cash),
            open_market_value = COALESCE((
                SELECT market_value FROM backtest_equity
                WHERE backtest_equity.backtest_id = backtest_result.backtest_id
                ORDER BY trade_date DESC, id DESC
                LIMIT 1
            ), 0),
            open_position_count = COALESCE((
                SELECT COUNT(*) FROM (
                    SELECT symbol,
                           SUM(CASE WHEN side = 'BUY' THEN quantity ELSE -quantity END) AS remaining_quantity
                    FROM backtest_trade
                    WHERE backtest_trade.backtest_id = backtest_result.backtest_id
                    GROUP BY symbol
                    HAVING remaining_quantity > 0
                )
            ), 0)
        WHERE backtest_id IN (SELECT DISTINCT backtest_id FROM backtest_trade)
        """
    )
