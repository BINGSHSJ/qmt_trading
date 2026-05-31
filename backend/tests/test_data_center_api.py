import json

import pytest
from fastapi.testclient import TestClient

from backend.core.exceptions import DataSyncError
from backend.core.database import get_connection
from backend.adapters.qmt.data_standardizer import (
    standardize_account,
    standardize_daily_kline,
    standardize_minute_kline,
    standardize_orders,
    standardize_positions,
    standardize_trades,
)
from backend.main import app
from backend.repositories.data_center import data_center_repository as data_repo_module
from backend.repositories.data_center.data_center_repository import DataCenterRepository
from backend.schemas.data_center import DataCoverageRecord, LatestDataSyncRequest, Prepare2026Request
from backend.services.data_center import data_center_service as data_service_module
from backend.services.data_center.data_center_service import DataCenterService


def test_sync_exception_formatter_keeps_chinese_diagnostic_detail():
    detail = json.loads(DataCenterService._format_sync_exception(RuntimeError("qmt timeout")))

    assert detail["code"] == "DATA_SYNC_TASK_ERROR"
    assert detail["message"] == "同步任务执行异常。"
    assert "qmt timeout" in detail["detail"]
    assert "请查看同步日志" in detail["suggestion"]


def test_sync_exception_formatter_preserves_app_error_code_and_suggestion():
    detail = json.loads(
        DataCenterService._format_sync_exception(
            DataSyncError(
                message="分钟K同步范围过大。",
                code="DATA_SYNC_RANGE_TOO_LARGE",
                detail="window_days=30",
                suggestion="请缩小同步窗口。",
            )
        )
    )

    assert detail["message"] == "分钟K同步范围过大。"
    assert detail["code"] == "DATA_SYNC_RANGE_TOO_LARGE"
    assert detail["detail"] == "window_days=30"
    assert detail["suggestion"] == "请缩小同步窗口。"


def test_test_isolation_sync_all_and_query_data_center_tables():
    client = TestClient(app)

    sync_response = client.post("/api/data/sync/all")
    assert sync_response.status_code == 200
    task_id = sync_response.json()["data"]["task_id"]

    task_response = client.get(f"/api/tasks/{task_id}")
    account_response = client.get("/api/data/account/latest")
    positions_response = client.get("/api/data/positions?page=1&page_size=20")
    stocks_response = client.get("/api/data/stocks?page=1&page_size=20")
    daily_response = client.get("/api/data/kline/daily?page=1&page_size=20&symbol=600000.SH")

    assert task_response.json()["data"]["status"] == "success"
    assert account_response.json()["data"]["account_id"] == "test_isolation_account"
    assert positions_response.json()["data"]["total"] >= 1
    assert stocks_response.json()["data"]["total"] >= 1
    assert daily_response.json()["data"]["total"] >= 1


def test_account_standardizers_reject_missing_account_id_instead_of_test_isolation_fallback():
    with pytest.raises(ValueError, match="账户 ID 缺失"):
        standardize_account({"total_asset": 100})
    with pytest.raises(ValueError, match="账户 ID 缺失"):
        standardize_positions([{"symbol": "600000.SH"}])
    with pytest.raises(ValueError, match="账户 ID 缺失"):
        standardize_orders([{"symbol": "600000.SH"}])
    with pytest.raises(ValueError, match="账户 ID 缺失"):
        standardize_trades([{"symbol": "600000.SH"}])


def test_sync_all_rejects_same_type_running_task():
    client = TestClient(app)

    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO runtime_task(task_id, task_type, status, progress, message, created_at)
            VALUES ('task_sync_all_running_guard', 'sync_all', 'running', 20, '正在同步全部数据', '2026-05-10 10:00:00')
            """
        )

    response = client.post("/api/data/sync/all")
    body = response.json()

    assert response.status_code == 400
    assert body["error"]["code"] == "TASK_ALREADY_RUNNING"
    assert body["message"] == "同类型任务正在执行，请等待完成后重试。"


def test_latest_sync_rejects_same_type_running_task():
    client = TestClient(app)

    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO runtime_task(task_id, task_type, status, progress, message, created_at)
            VALUES ('task_latest_sync_running_guard', 'sync_latest_data', 'running', 30, '正在同步到最新完成交易日', '2026-05-10 10:00:00')
            """
        )

    response = client.post("/api/data/sync/latest", json={})
    body = response.json()

    assert response.status_code == 400
    assert body["error"]["code"] == "TASK_ALREADY_RUNNING"
    assert body["message"] == "同类型任务正在执行，请等待完成后重试。"
    assert "sync_latest_data" in body["error"]["detail"]


def test_2026_sync_rejects_same_type_running_task():
    client = TestClient(app)

    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO runtime_task(task_id, task_type, status, progress, message, created_at)
            VALUES ('task_2026_sync_running_guard', 'sync_2026', 'running', 45, '正在补齐 2026 数据', '2026-05-10 10:00:00')
            """
        )

    response = client.post("/api/data/sync/run-2026", json={"start_date": "2026-05-06", "end_date": "2026-05-08"})
    body = response.json()

    assert response.status_code == 400
    assert body["error"]["code"] == "TASK_ALREADY_RUNNING"
    assert body["message"] == "同类型任务正在执行，请等待完成后重试。"
    assert "sync_2026" in body["error"]["detail"]


def test_kline_standardizer_filters_invalid_nan_rows():
    daily_rows = standardize_daily_kline(
        [
            {"symbol": "600000.SH", "trade_date": "2026-05-08", "open": 9.1, "high": 9.2, "low": 9.0, "close": 9.15, "volume": 1000, "amount": 9150},
            {"symbol": "000001.SZ", "trade_date": "2026-05-08", "open": float("nan"), "high": 1, "low": 1, "close": 1, "volume": 1, "amount": 1},
            {"symbol": "000002.SZ", "trade_date": "2026-05-08", "open": 0, "high": 1, "low": 1, "close": 1, "volume": 1, "amount": 1},
        ]
    )
    minute_rows = standardize_minute_kline(
        [
            {"symbol": "600000.SH", "datetime": "2026-05-08 09:30:00", "period": "1m", "open": 9.1, "high": 9.2, "low": 9.0, "close": 9.15, "volume": 1000, "amount": 9150},
            {"symbol": "000001.SZ", "datetime": "2026-05-08 09:30:00", "period": "1m", "open": float("inf"), "high": 1, "low": 1, "close": 1, "volume": 1, "amount": 1},
        ]
    )

    assert [row["symbol"] for row in daily_rows] == ["600000.SH"]
    assert [row["symbol"] for row in minute_rows] == ["600000.SH"]
    assert daily_rows[0]["pre_close"] == 0
    assert daily_rows[0]["suspend_flag"] == 0


def test_recent_completed_trading_day_uses_previous_day_before_close(monkeypatch):
    class MorningDate(data_service_module.date):
        @classmethod
        def today(cls):
            return cls(2026, 5, 11)

    class MorningDateTime(data_service_module.datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 5, 11, 10, 30, 0)

    monkeypatch.setattr(data_service_module, "date", MorningDate)
    monkeypatch.setattr(data_service_module, "datetime", MorningDateTime)

    assert DataCenterService()._recent_completed_trading_day() == "2026-05-08"


def test_recent_completed_trading_day_allows_today_after_close(monkeypatch):
    class AfternoonDate(data_service_module.date):
        @classmethod
        def today(cls):
            return cls(2026, 5, 11)

    class AfternoonDateTime(data_service_module.datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 5, 11, 16, 30, 0)

    monkeypatch.setattr(data_service_module, "date", AfternoonDate)
    monkeypatch.setattr(data_service_module, "datetime", AfternoonDateTime)

    assert DataCenterService()._recent_completed_trading_day() == "2026-05-11"


def test_recent_completed_trading_day_does_not_stop_at_stale_calendar(monkeypatch):
    class MorningDate(data_service_module.date):
        @classmethod
        def today(cls):
            return cls(2026, 5, 15)

    class MorningDateTime(data_service_module.datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 5, 15, 10, 30, 0)

    monkeypatch.setattr(data_service_module, "date", MorningDate)
    monkeypatch.setattr(data_service_module, "datetime", MorningDateTime)
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO trading_calendar(market, trade_date, is_trading_day, source, sync_time)
            VALUES ('SH', '2026-05-11', 1, 'qmt', '2026-05-11 16:00:00')
            """
        )
        connection.commit()

    assert DataCenterService()._recent_completed_trading_day() == "2026-05-14"


def test_data_freshness_summary_reports_current_target_and_stale_items(monkeypatch):
    class MorningDate(data_service_module.date):
        @classmethod
        def today(cls):
            return cls(2026, 5, 15)

    class MorningDateTime(data_service_module.datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 5, 15, 10, 30, 0)

    monkeypatch.setattr(data_service_module, "date", MorningDate)
    monkeypatch.setattr(data_service_module, "datetime", MorningDateTime)
    with get_connection() as connection:
        connection.executemany(
            """
            INSERT INTO trading_calendar(market, trade_date, is_trading_day, source, sync_time)
            VALUES (?, ?, 1, 'qmt', '2026-05-14 16:00:00')
            """,
            [("SH", "2026-05-14"), ("SZ", "2026-05-14")],
        )
        connection.execute(
            """
            INSERT INTO daily_kline(symbol, trade_date, open, high, low, close, volume, amount, created_at)
            VALUES ('600000.SH', '2026-05-14', 10, 11, 9, 10.5, 1000, 10500, '2026-05-14 16:00:00')
            """
        )
        connection.execute(
            """
            INSERT INTO minute_kline(symbol, datetime, period, open, high, low, close, volume, amount, created_at)
            VALUES ('600000.SH', '2026-05-11 09:30:00', '1m', 10, 11, 9, 10.5, 1000, 10500, '2026-05-11 16:00:00')
            """
        )
        connection.execute(
            """
            INSERT INTO account_snapshot(account_id, total_asset, available_cash, frozen_cash, market_value, today_pnl, snapshot_time)
            VALUES ('test_isolation_account', 100000, 50000, 0, 50000, 0, '2026-05-11 10:00:00')
            """
        )
        connection.execute(
            """
            INSERT INTO position_snapshot(account_id, symbol, name, quantity, available_quantity, cost_price, last_price, market_value, pnl, pnl_ratio, snapshot_time)
            VALUES ('test_isolation_account', '600000.SH', '浦发银行', 100, 100, 10, 10.5, 1050, 50, 5, '2026-05-11 10:00:00')
            """
        )
        connection.executemany(
            """
            INSERT INTO data_coverage(
                data_type, symbol, period, start_date, end_date, expected_trading_days,
                actual_trading_days, expected_rows, actual_rows, missing_days,
                duplicate_rows, coverage_rate, status, checked_at
            ) VALUES (?, 'ALL', ?, '2026-01-01', '2026-05-14', 1, ?, ?, ?, ?, 0, ?, ?, '2026-05-15 10:00:00')
            """,
            [
                ("daily_kline", "1d", 1, 1, 1, "[]", 100.0, "complete"),
                ("minute_kline", "1m", 1, 2, 1, '["2026-05-14"]', 50.0, "partial"),
            ],
        )
        connection.commit()

    response = TestClient(app).get("/api/data/freshness/summary")
    body = response.json()["data"]
    assert response.status_code == 200
    assert body["target_trade_date"] == "2026-05-14"
    assert body["overall_status"] == "failed"
    by_key = {item["key"]: item for item in body["items"]}
    assert by_key["daily_kline"]["status"] == "fresh"
    assert by_key["daily_kline"]["coverage_unit"] == "行"
    assert by_key["daily_kline"]["actual_coverage_units"] == 1
    assert "日K按实际落库K线行数统计" in by_key["daily_kline"]["coverage_unit_note"]
    assert by_key["minute_kline"]["status"] == "stale"
    assert by_key["minute_kline"]["coverage_unit"] == "覆盖单元"
    assert by_key["minute_kline"]["actual_coverage_units"] == 1
    assert "不等于1分钟bar原始行数" in by_key["minute_kline"]["coverage_unit_note"]
    assert by_key["account_snapshot"]["lag_days"] == 3
    assert by_key["order_record"]["status"] == "unknown"
    assert any("分钟 K" in action for action in body["next_actions"])


def test_data_freshness_summary_ignores_optional_stale_order_and_trade_records(monkeypatch):
    class MorningDate(data_service_module.date):
        @classmethod
        def today(cls):
            return cls(2026, 5, 21)

    class MorningDateTime(data_service_module.datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 5, 21, 10, 30, 0)

    monkeypatch.setattr(data_service_module, "date", MorningDate)
    monkeypatch.setattr(data_service_module, "datetime", MorningDateTime)
    with get_connection() as connection:
        connection.executemany(
            """
            INSERT INTO trading_calendar(market, trade_date, is_trading_day, source, sync_time)
            VALUES (?, ?, 1, 'qmt', '2026-05-20 16:00:00')
            """,
            [("SH", "2026-05-20"), ("SZ", "2026-05-20")],
        )
        connection.execute(
            """
            INSERT INTO daily_kline(symbol, trade_date, open, high, low, close, volume, amount, created_at)
            VALUES ('600000.SH', '2026-05-20', 10, 11, 9, 10.5, 1000, 10500, '2026-05-20 16:00:00')
            """
        )
        connection.execute(
            """
            INSERT INTO minute_kline(symbol, datetime, period, open, high, low, close, volume, amount, created_at)
            VALUES ('600000.SH', '2026-05-20 15:00:00', '1m', 10, 11, 9, 10.5, 1000, 10500, '2026-05-20 15:00:00')
            """
        )
        connection.execute(
            """
            INSERT INTO account_snapshot(account_id, total_asset, available_cash, frozen_cash, market_value, today_pnl, snapshot_time)
            VALUES ('test_isolation_account', 100000, 50000, 0, 50000, 0, '2026-05-20 15:10:00')
            """
        )
        connection.execute(
            """
            INSERT INTO position_snapshot(account_id, symbol, name, quantity, available_quantity, cost_price, last_price, market_value, pnl, pnl_ratio, snapshot_time)
            VALUES ('test_isolation_account', '600000.SH', '浦发银行', 100, 100, 10, 10.5, 1050, 50, 5, '2026-05-20 15:10:00')
            """
        )
        connection.execute(
            """
            INSERT INTO order_record(local_order_id, qmt_order_id, account_id, symbol, name, side, price, quantity, filled_quantity, status, source, order_time, updated_at)
            VALUES ('old_order_001', 'qmt_old_001', 'test_isolation_account', '600000.SH', '浦发银行', 'BUY', 10.0, 100, 100, '全部成交', 'real_sync', '2026-05-18 10:00:00', '2026-05-18 10:00:00')
            """
        )
        connection.execute(
            """
            INSERT INTO trade_record(trade_id, local_order_id, qmt_order_id, account_id, symbol, name, side, price, quantity, amount, fee, source, trade_time)
            VALUES ('old_trade_001', 'old_order_001', 'qmt_old_001', 'test_isolation_account', '600000.SH', '浦发银行', 'BUY', 10.0, 100, 1000, 1, 'real_sync', '2026-05-18 10:00:01')
            """
        )
        connection.executemany(
            """
            INSERT INTO data_coverage(
                data_type, symbol, period, start_date, end_date, expected_trading_days,
                actual_trading_days, expected_rows, actual_rows, missing_days,
                duplicate_rows, coverage_rate, status, checked_at
            ) VALUES (?, 'ALL', ?, '2026-01-01', '2026-05-20', 1, 1, 1, 1, '[]', 0, 100.0, 'complete', '2026-05-21 10:00:00')
            """,
            [("daily_kline", "1d"), ("minute_kline", "1m")],
        )
        connection.commit()

    response = TestClient(app).get("/api/data/freshness/summary")
    body = response.json()["data"]
    by_key = {item["key"]: item for item in body["items"]}
    assert response.status_code == 200
    assert body["target_trade_date"] == "2026-05-20"
    assert body["overall_status"] == "warning"
    assert body["stale_count"] == 0
    assert body["warning_count"] == 2
    assert by_key["daily_kline"]["coverage_status"] == "complete"
    assert by_key["daily_kline"]["coverage_rate"] == 100.0
    assert by_key["daily_kline"]["coverage_unit"] == "行"
    assert by_key["order_record"]["status"] == "unknown"
    assert by_key["trade_record"]["status"] == "unknown"
    assert "没有委托或成交" in by_key["order_record"]["message"]
    assert "缺失续跑" not in by_key["minute_kline"]["suggestion"]
    assert "覆盖率 complete" in by_key["minute_kline"]["suggestion"]
    assert "请执行" not in by_key["daily_kline"]["suggestion"]
    assert "数据新鲜度已满足当前目标交易日" in body["next_actions"][0]


def test_data_freshness_summary_uses_target_day_coverage_when_full_window_missing(monkeypatch):
    class FixedDate(data_service_module.date):
        @classmethod
        def today(cls):
            return cls(2026, 5, 22)

    class FixedDateTime(data_service_module.datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 5, 22, 10, 30, 0)

    monkeypatch.setattr(data_service_module, "date", FixedDate)
    monkeypatch.setattr(data_service_module, "datetime", FixedDateTime)
    with get_connection() as connection:
        connection.executemany(
            """
            INSERT INTO trading_calendar(market, trade_date, is_trading_day, source, sync_time)
            VALUES (?, '2026-05-21', 1, 'qmt', '2026-05-22 00:00:00')
            """,
            [("SH",), ("SZ",)],
        )
        connection.execute(
            """
            INSERT INTO daily_kline(symbol, trade_date, open, high, low, close, volume, amount, created_at)
            VALUES ('600000.SH', '2026-05-21', 10, 11, 9, 10.5, 1000, 10500, '2026-05-21 16:00:00')
            """
        )
        connection.execute(
            """
            INSERT INTO minute_kline(symbol, datetime, period, open, high, low, close, volume, amount, created_at)
            VALUES ('600000.SH', '2026-05-21 15:00:00', '1m', 10, 11, 9, 10.5, 1000, 10500, '2026-05-21 15:00:00')
            """
        )
        connection.executemany(
            """
            INSERT INTO data_coverage(
                data_type, symbol, period, start_date, end_date, expected_trading_days,
                actual_trading_days, expected_rows, actual_rows, missing_days,
                duplicate_rows, coverage_rate, status, checked_at
            ) VALUES (?, 'ALL', ?, '2026-05-21', '2026-05-21', 1, 1, ?, ?, ?, 0, ?, ?, '2026-05-22 00:40:00')
            """,
            [
                ("daily_kline", "1d", 1, 1, "[]", 100.0, "complete"),
                ("minute_kline", "1m", 2, 1, '["2026-05-21"]', 50.0, "partial"),
            ],
        )
        connection.commit()

    response = TestClient(app).get("/api/data/freshness/summary")
    body = response.json()["data"]
    by_key = {item["key"]: item for item in body["items"]}

    assert response.status_code == 200
    assert body["target_trade_date"] == "2026-05-21"
    assert body["overall_status"] == "failed"
    assert by_key["daily_kline"]["coverage_status"] == "complete"
    assert by_key["minute_kline"]["status"] == "partial"
    assert by_key["minute_kline"]["coverage_status"] == "partial"
    assert by_key["minute_kline"]["coverage_rate"] == 50.0
    assert any("分钟 K" in action for action in body["next_actions"])


def test_latest_data_sync_default_does_not_run_minute_kline(monkeypatch):
    calls: list[str] = []

    class FixedDate(data_service_module.date):
        @classmethod
        def today(cls):
            return cls(2026, 5, 15)

    class FixedDateTime(data_service_module.datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 5, 15, 16, 30, 0)

    def fake_run_sync(self, task_id, sync_type, request):
        calls.append(sync_type)
        return 1

    def fake_daily_batches(self, task_id, symbols, request):
        calls.append("daily_batches")
        return {"rows": 3, "success_symbols": len(symbols), "failed_symbols": 0}

    def fake_coverage(self, request=None):
        calls.append("coverage")
        return None

    def fake_symbols(self, request):
        return ["600000.SH", "000001.SZ"]

    def fake_freshness(self):
        return data_service_module.DataFreshnessSummary(
            target_trade_date="2026-05-15",
            generated_at="2026-05-15 16:30:00",
            overall_status="success",
            stale_count=0,
            warning_count=0,
            items=[
                data_service_module.DataFreshnessItem(
                    key="minute_kline",
                    name="1 分钟 K",
                    table_name="minute_kline",
                    latest_time="2026-05-15 15:00:00",
                    latest_date="2026-05-15",
                    target_date="2026-05-15",
                    lag_days=0,
                    status="fresh",
                    message="1 分钟 K：已到目标交易日 2026-05-15。",
                    suggestion="1 分钟 K 已到目标交易日且覆盖率 complete；正式分钟回测前请保留覆盖率检查和逐笔信号核对。",
                    coverage_status="complete",
                    coverage_rate=100.0,
                    coverage_checked_at="2026-05-15 16:30:00",
                    actual_rows=100,
                    coverage_unit="覆盖单元",
                    coverage_unit_note="分钟K覆盖单元=股票-交易日。",
                    actual_coverage_units=100,
                    technical_detail="coverage_status=complete",
                )
            ],
            next_actions=[],
        )

    def fake_coverage_record(self, data_type, symbol, period, start_date, end_date):
        return DataCoverageRecord(
            id=1,
            data_type=data_type,
            symbol=symbol,
            period=period,
            start_date=start_date,
            end_date=end_date,
            expected_trading_days=1,
            actual_trading_days=1,
            expected_rows=1,
            actual_rows=1,
            missing_days="[]",
            duplicate_rows=0,
            coverage_rate=100,
            status="complete",
            checked_at="2026-05-15 16:30:00",
        )

    monkeypatch.setattr(data_service_module, "date", FixedDate)
    monkeypatch.setattr(data_service_module, "datetime", FixedDateTime)
    monkeypatch.setattr(DataCenterService, "_run_sync", fake_run_sync)
    monkeypatch.setattr(DataCenterService, "_run_2026_daily_batches", fake_daily_batches)
    monkeypatch.setattr(DataCenterService, "refresh_2026_coverage", fake_coverage)
    monkeypatch.setattr(DataCenterService, "_resolve_2026_symbols", fake_symbols)
    monkeypatch.setattr(DataCenterService, "data_freshness_summary", fake_freshness)
    monkeypatch.setattr(DataCenterRepository, "get_coverage_record", fake_coverage_record)

    service = DataCenterService()
    task = service.create_latest_data_sync_task(LatestDataSyncRequest())
    service.run_latest_data_sync_task(task.task_id, LatestDataSyncRequest())

    with get_connection() as connection:
        runtime_task = connection.execute(
            "SELECT status, message, technical_detail FROM runtime_task WHERE task_id=?",
            (task.task_id,),
        ).fetchone()

    assert calls == [
        "stock_basic",
        "trading_calendar",
        "account",
        "positions",
        "orders",
        "trades",
        "instrument_detail",
        "daily_batches",
        "coverage",
    ]
    assert runtime_task["status"] == "success"
    assert "本任务未重复启动全市场分钟K" in runtime_task["message"]
    assert "请使用显式长任务" not in runtime_task["message"]
    detail = json.loads(runtime_task["technical_detail"])
    assert detail["minute_freshness_status"] == "fresh"
    assert detail["minute_coverage_status"] == "complete"


def test_latest_data_sync_failure_detail_lists_stale_freshness_items(monkeypatch):
    calls: list[str] = []

    class FixedDate(data_service_module.date):
        @classmethod
        def today(cls):
            return cls(2026, 5, 15)

    class FixedDateTime(data_service_module.datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 5, 15, 16, 30, 0)

    def fake_run_sync(self, task_id, sync_type, request):
        calls.append(sync_type)
        return 1

    def fake_daily_batches(self, task_id, symbols, request):
        calls.append("daily_batches")
        return {"rows": 3, "success_symbols": len(symbols), "failed_symbols": 0}

    def fake_coverage(self, request=None):
        calls.append("coverage")
        return None

    def fake_symbols(self, request):
        return ["600000.SH", "000001.SZ"]

    def fake_freshness(self):
        return data_service_module.DataFreshnessSummary(
            target_trade_date="2026-05-15",
            generated_at="2026-05-15 16:30:00",
            overall_status="failed",
            stale_count=1,
            warning_count=0,
            items=[
                data_service_module.DataFreshnessItem(
                    key="daily_kline",
                    name="日 K",
                    table_name="daily_kline",
                    latest_time="2026-05-14 15:00:00",
                    latest_date="2026-05-14",
                    target_date="2026-05-15",
                    lag_days=1,
                    status="stale",
                    message="日 K：最新日期为 2026-05-14，落后目标交易日 2026-05-15。",
                    suggestion="请执行 2026 全市场日 K 补齐，并在完成后复查覆盖率。",
                    coverage_status="partial",
                    coverage_rate=98.5,
                    coverage_checked_at="2026-05-15 16:30:00",
                    actual_rows=100,
                    coverage_unit="行",
                    coverage_unit_note="日K按实际落库K线行数统计。",
                    actual_coverage_units=100,
                    technical_detail="coverage_status=partial",
                )
            ],
            next_actions=["执行全市场日 K 补齐到最新完成交易日，并复查 2026 日 K 覆盖率。"],
        )

    def fake_coverage_record(self, data_type, symbol, period, start_date, end_date):
        return DataCoverageRecord(
            id=1,
            data_type=data_type,
            symbol=symbol,
            period=period,
            start_date=start_date,
            end_date=end_date,
            expected_trading_days=1,
            actual_trading_days=1,
            expected_rows=1,
            actual_rows=1,
            missing_days="[]",
            duplicate_rows=0,
            coverage_rate=100,
            status="complete",
            checked_at="2026-05-15 16:30:00",
        )

    monkeypatch.setattr(data_service_module, "date", FixedDate)
    monkeypatch.setattr(data_service_module, "datetime", FixedDateTime)
    monkeypatch.setattr(DataCenterService, "_run_sync", fake_run_sync)
    monkeypatch.setattr(DataCenterService, "_run_2026_daily_batches", fake_daily_batches)
    monkeypatch.setattr(DataCenterService, "refresh_2026_coverage", fake_coverage)
    monkeypatch.setattr(DataCenterService, "_resolve_2026_symbols", fake_symbols)
    monkeypatch.setattr(DataCenterService, "data_freshness_summary", fake_freshness)
    monkeypatch.setattr(DataCenterRepository, "get_coverage_record", fake_coverage_record)

    service = DataCenterService()
    task = service.create_latest_data_sync_task(LatestDataSyncRequest())
    service.run_latest_data_sync_task(task.task_id, LatestDataSyncRequest())

    with get_connection() as connection:
        runtime_task = connection.execute(
            "SELECT status, message, technical_detail FROM runtime_task WHERE task_id=?",
            (task.task_id,),
        ).fetchone()
        sync_task = connection.execute(
            "SELECT status, failed_count FROM sync_task WHERE task_id=?",
            (task.task_id,),
        ).fetchone()

    detail = json.loads(runtime_task["technical_detail"])
    assert runtime_task["status"] == "failed"
    assert sync_task["status"] == "failed"
    assert sync_task["failed_count"] == 1
    assert "日 K" in runtime_task["message"]
    assert "2026-05-15" in runtime_task["message"]
    assert detail["freshness_overall_status"] == "failed"
    assert detail["required_stale"] == ["daily_kline"]
    assert detail["required_stale_items"][0]["name"] == "日 K"
    assert detail["required_stale_items"][0]["suggestion"] == "请执行 2026 全市场日 K 补齐，并在完成后复查覆盖率。"
    assert detail["next_actions"] == ["执行全市场日 K 补齐到最新完成交易日，并复查 2026 日 K 覆盖率。"]


def test_latest_data_sync_account_scope_skips_market_prerequisites(monkeypatch):
    calls: list[str] = []

    def fake_run_sync(self, task_id, sync_type, request):
        calls.append(sync_type)
        return 1

    def fail_market_symbols(self, request):
        raise AssertionError("account-only latest sync must not resolve market symbols")

    def fail_coverage(self, request=None):
        raise AssertionError("account-only latest sync must not refresh market coverage")

    def fake_freshness(self):
        return data_service_module.DataFreshnessSummary(
            target_trade_date="2026-05-15",
            generated_at="2026-05-15 16:30:00",
            overall_status="success",
            stale_count=0,
            warning_count=0,
            items=[],
            next_actions=[],
        )

    monkeypatch.setattr(DataCenterService, "_run_sync", fake_run_sync)
    monkeypatch.setattr(DataCenterService, "_resolve_2026_symbols", fail_market_symbols)
    monkeypatch.setattr(DataCenterService, "refresh_2026_coverage", fail_coverage)
    monkeypatch.setattr(DataCenterService, "data_freshness_summary", fake_freshness)

    service = DataCenterService()
    request = LatestDataSyncRequest(include_daily_kline=False, include_minute_kline=False)
    task = service.create_latest_data_sync_task(request)
    service.run_latest_data_sync_task(task.task_id, request)

    assert calls == ["account", "positions", "orders", "trades"]


def test_latest_data_sync_rejects_unbounded_minute_sync():
    client = TestClient(app)

    response = client.post("/api/data/sync/latest", json={"include_minute_kline": True})

    assert response.status_code == 400
    body = response.json()
    assert body["error"]["code"] == "DATA_SYNC_MINUTE_SCOPE_REQUIRED"
    assert "分钟 K 必须显式选择全市场或指定股票" in body["message"]


def test_kline_standardizer_keeps_qmt_suspended_daily_rows_when_price_is_filled():
    rows = standardize_daily_kline(
        [
            {
                "symbol": "002049.SZ",
                "trade_date": "2026-01-05",
                "open": 70.5,
                "high": 70.5,
                "low": 70.5,
                "close": 70.5,
                "preClose": 70.5,
                "volume": 0,
                "amount": 0,
                "suspendFlag": 1,
            }
        ]
    )

    assert rows == [
        {
            "symbol": "002049.SZ",
            "trade_date": "2026-01-05",
            "open": 70.5,
            "high": 70.5,
            "low": 70.5,
            "close": 70.5,
            "pre_close": 70.5,
            "volume": 0.0,
            "amount": 0.0,
            "suspend_flag": 1,
        }
    ]


def test_official_catalog_marks_qmt_ordinary_account_boundaries():
    client = TestClient(app)

    response = client.get("/api/data/catalog/official")
    body = response.json()

    assert response.status_code == 200
    assert body["success"] is True
    catalog = body["data"]
    assert catalog["source"] == "qmt"
    assert catalog["account_type"] == "stock_normal"
    assert catalog["has_l2"] is False
    assert catalog["has_credit"] is False
    assert "普通股票账户" in catalog["limitation_note"]
    assert any(item["data_type"] == "daily_kline" and item["enabled"] is True for item in catalog["items"])
    assert any(item["data_type"] == "minute_kline" and item["required_for_backtest"] is True for item in catalog["items"])
    assert any("Level2" in item for item in catalog["unsupported_items"])


def test_prepare_and_run_2026_test_isolation_backfill_updates_coverage():
    client = TestClient(app)

    prepare_response = client.post(
        "/api/data/sync/prepare-2026",
        json={
            "start_date": "2026-05-06",
            "end_date": "2026-05-08",
            "symbols": ["600000.SH", "000001.SZ"],
            "include_daily_kline": True,
            "daily_batch_size": 1,
            "include_minute_kline": False,
        },
    )
    prepare = prepare_response.json()["data"]

    assert prepare_response.status_code == 200
    assert prepare["test_isolation"] is True
    assert prepare["mock_safe"] is True
    assert prepare["start_date"] == "2026-05-06"
    assert any(step["data_type"] == "daily_kline" and step["default_enabled"] is True for step in prepare["steps"])
    assert any("不会默认同步全市场 Tick" in warning for warning in prepare["warnings"])
    assert any("sync_cursor" in warning for warning in prepare["warnings"])

    run_response = client.post(
        "/api/data/sync/run-2026",
        json={
            "start_date": "2026-05-06",
            "end_date": "2026-05-08",
            "symbols": ["600000.SH", "000001.SZ"],
            "include_daily_kline": True,
            "daily_batch_size": 1,
            "include_minute_kline": False,
        },
    )
    task_id = run_response.json()["data"]["task_id"]
    task = client.get(f"/api/tasks/{task_id}").json()["data"]
    coverage = client.get("/api/data/sync/coverage-2026?page=1&page_size=200&sort_field=data_type&sort_order=asc").json()["data"]
    symbol_coverage = client.get("/api/data/sync/coverage-2026?page=1&page_size=20&keyword=600000.SH").json()["data"]

    assert run_response.status_code == 200
    assert task["status"] == "success"
    assert task["task_type"] == "sync_2026"
    coverage_by_type = {item["data_type"]: item for item in coverage["items"]}
    assert coverage_by_type["stock_basic"]["actual_rows"] >= 1
    assert coverage_by_type["trading_calendar"]["actual_rows"] >= 1
    assert coverage_by_type["instrument_detail"]["actual_rows"] >= 1
    assert coverage_by_type["daily_kline"]["actual_rows"] >= 1
    assert coverage_by_type["daily_kline"]["duplicate_rows"] == 0
    assert coverage_by_type["minute_kline"]["status"] == "missing"
    assert any(item["data_type"] == "daily_kline" and item["symbol"] == "600000.SH" for item in symbol_coverage["items"])
    with get_connection() as connection:
        daily_logs = connection.execute(
            "SELECT message FROM sync_log WHERE task_id=? AND sync_type='daily_kline' ORDER BY id",
            (task_id,),
        ).fetchall()
        cursors = connection.execute(
            "SELECT symbol, last_sync_time FROM sync_cursor WHERE data_type='daily_kline' ORDER BY symbol",
        ).fetchall()

    assert any("分批补齐开始" in row["message"] for row in daily_logs)
    assert any("同步完成" in row["message"] for row in daily_logs)
    assert ("600000.SH", "2026-05-08") in {(row["symbol"], row["last_sync_time"]) for row in cursors}
    assert ("000001.SZ", "2026-05-08") in {(row["symbol"], row["last_sync_time"]) for row in cursors}


def test_2026_coverage_list_does_not_refresh_when_cache_is_current(monkeypatch):
    client = TestClient(app)
    default_request = DataCenterService()._normalize_2026_request(Prepare2026Request())
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO data_coverage(
                data_type, symbol, period, start_date, end_date, expected_trading_days,
                actual_trading_days, expected_rows, actual_rows, missing_days,
                duplicate_rows, coverage_rate, status, checked_at
            ) VALUES (
                'daily_kline', 'ALL', '1d', ?, ?, 10,
                10, 100, 100, '[]', 0, 100, 'complete', '2026-05-10 10:00:00'
            )
            """,
            (default_request.start_date, default_request.end_date),
        )
        connection.execute(
            """
            INSERT INTO sync_task(task_id, sync_type, status, total_count, success_count, failed_count, started_at, finished_at)
            VALUES ('sync_before_coverage', 'all', 'success', 1, 1, 0, '2026-05-10 08:00:00', '2026-05-10 09:00:00')
            """
        )

    def fail_refresh(*_args, **_kwargs):
        raise AssertionError("coverage list should read cached rows without refreshing")

    monkeypatch.setattr(DataCenterService, "refresh_2026_coverage", fail_refresh)

    response = client.get("/api/data/sync/coverage-2026?page=1&page_size=20&sort_field=checked_at&sort_order=desc")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["total"] == 1
    assert data["items"][0]["checked_at"] == "2026-05-10 10:00:00"


def test_2026_coverage_list_does_not_refresh_after_newer_sync(monkeypatch):
    client = TestClient(app)
    default_request = DataCenterService()._normalize_2026_request(Prepare2026Request())
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO data_coverage(
                data_type, symbol, period, start_date, end_date, expected_trading_days,
                actual_trading_days, expected_rows, actual_rows, missing_days,
                duplicate_rows, coverage_rate, status, checked_at
            ) VALUES (
                'daily_kline', 'ALL', '1d', ?, ?, 10,
                10, 100, 100, '[]', 0, 100, 'complete', '2026-05-10 10:00:00'
            )
            """,
            (default_request.start_date, default_request.end_date),
        )
        connection.execute(
            """
            INSERT INTO sync_task(task_id, sync_type, status, total_count, success_count, failed_count, started_at, finished_at)
            VALUES ('sync_after_coverage', 'sync_latest_data', 'success', 1, 1, 0, '2026-05-10 11:00:00', '2026-05-10 11:01:00')
            """
        )
        connection.commit()

    def fail_refresh(*_args, **_kwargs):
        raise AssertionError("coverage list must not recalculate large coverage on ordinary page load")

    monkeypatch.setattr(DataCenterService, "refresh_2026_coverage", fail_refresh)

    response = client.get("/api/data/sync/coverage-2026?page=1&page_size=20&sort_field=checked_at&sort_order=desc")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["total"] == 1
    assert data["items"][0]["checked_at"] == "2026-05-10 10:00:00"


def test_2026_coverage_list_uses_cached_rows_when_current_window_not_checked(monkeypatch):
    class MorningDate(data_service_module.date):
        @classmethod
        def today(cls):
            return cls(2026, 5, 15)

    class MorningDateTime(data_service_module.datetime):
        @classmethod
        def now(cls, tz=None):
            return cls(2026, 5, 15, 10, 30, 0)

    monkeypatch.setattr(data_service_module, "date", MorningDate)
    monkeypatch.setattr(data_service_module, "datetime", MorningDateTime)
    client = TestClient(app)
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO data_coverage(
                data_type, symbol, period, start_date, end_date, expected_trading_days,
                actual_trading_days, expected_rows, actual_rows, missing_days,
                duplicate_rows, coverage_rate, status, checked_at
            ) VALUES (
                'daily_kline', 'ALL', '1d', '2026-01-01', '2026-05-11', 81,
                81, 420221, 420221, '[]', 0, 100, 'complete', '2026-05-12 16:45:29'
            )
            """
        )
        connection.commit()

    def fail_refresh(*_args, **_kwargs):
        raise AssertionError("coverage list should not recalculate large coverage on page load")

    monkeypatch.setattr(DataCenterService, "refresh_2026_coverage", fail_refresh)

    response = client.get("/api/data/sync/coverage-2026?page=1&page_size=20&sort_field=data_type&sort_order=asc")
    data = response.json()["data"]

    assert response.status_code == 200
    assert data["total"] == 1
    assert data["items"][0]["end_date"] == "2026-05-11"


def test_2026_coverage_list_puts_all_summary_before_symbol_rows():
    client = TestClient(app)
    default_request = DataCenterService()._normalize_2026_request(Prepare2026Request())
    with get_connection() as connection:
        connection.executemany(
            """
            INSERT INTO data_coverage(
                data_type, symbol, period, start_date, end_date, expected_trading_days,
                actual_trading_days, expected_rows, actual_rows, missing_days,
                duplicate_rows, coverage_rate, status, checked_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 0, ?, ?, '2026-05-10 10:00:00')
            """,
            [
                ("daily_kline", "600000.SH", "1d", default_request.start_date, default_request.end_date, 10, 10, 10, 10, 100, "complete"),
                ("daily_kline", "ALL", "1d", default_request.start_date, default_request.end_date, 10, 10, 100, 100, 100, "complete"),
                ("minute_kline", "000001.SZ", "1m", default_request.start_date, default_request.end_date, 10, 9, 10, 9, 90, "partial"),
                ("minute_kline", "ALL", "1m", default_request.start_date, default_request.end_date, 10, 9, 100, 90, 90, "partial"),
            ],
        )
        connection.commit()

    response = client.get("/api/data/sync/coverage-2026?page=1&page_size=4&sort_field=data_type&sort_order=asc")
    items = response.json()["data"]["items"]

    assert response.status_code == 200
    assert [item["symbol"] for item in items[:2]] == ["ALL", "ALL"]


def test_2026_coverage_response_exposes_unit_metadata():
    client = TestClient(app)
    default_request = DataCenterService()._normalize_2026_request(Prepare2026Request())
    with get_connection() as connection:
        connection.executemany(
            """
            INSERT INTO data_coverage(
                data_type, symbol, period, start_date, end_date, expected_trading_days,
                actual_trading_days, expected_rows, actual_rows, missing_days,
                duplicate_rows, coverage_rate, status, checked_at
            ) VALUES (?, 'ALL', ?, ?, ?, 10, 9, ?, ?, '[]', 0, ?, ?, '2026-05-10 10:00:00')
            """,
            [
                ("daily_kline", "1d", default_request.start_date, default_request.end_date, 100, 90, 90, "partial"),
                ("minute_kline", "1m", default_request.start_date, default_request.end_date, 100, 80, 80, "partial"),
            ],
        )
        connection.commit()

    response = client.get("/api/data/sync/coverage-2026?page=1&page_size=20&sort_field=data_type&sort_order=asc")
    items = response.json()["data"]["items"]
    daily = next(item for item in items if item["data_type"] == "daily_kline")
    minute = next(item for item in items if item["data_type"] == "minute_kline")

    assert response.status_code == 200
    assert daily["coverage_unit"] == "行"
    assert daily["actual_coverage_units"] == 90
    assert daily["expected_coverage_units"] == 100
    assert "日K按实际落库K线行数统计" in daily["coverage_unit_note"]
    assert minute["coverage_unit"] == "覆盖单元"
    assert minute["actual_coverage_units"] == 80
    assert minute["expected_coverage_units"] == 100
    assert "不等于1分钟bar原始行数" in minute["coverage_unit_note"]


def test_coverage_excludes_qmt_pending_unlisted_symbols_from_expected_days():
    repository = DataCenterRepository()
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO instrument_detail(
                symbol, exchange_id, instrument_id, instrument_name, exchange_code,
                open_date, expire_date, pre_close, up_stop_price, down_stop_price,
                is_trading, instrument_status, total_volume, float_volume, trading_day, raw_json, sync_time
            ) VALUES (
                '001365.SZ', 'SZ', '001365', '天海电子', 'SZ',
                '1970-01-01', '99999999', 27.19, 100000, 0,
                0, '', 0, 0, NULL, '{"CreateDate":"20260507"}', '2026-05-10 10:00:00'
            )
            """
        )

    open_dates = repository.instrument_open_dates(["001365.SZ"])
    service = DataCenterService()
    expected_days = service._expected_trading_days_by_symbol(
        ["001365.SZ"],
        ["2026-05-07", "2026-05-08"],
        open_dates,
    )
    coverage_row = service._coverage_row(
        "daily_kline",
        "001365.SZ",
        "1d",
        "2026-05-07",
        "2026-05-08",
        0,
        0,
        0,
        0,
        [],
        0,
        "2026-05-10 10:00:00",
    )

    assert open_dates["001365.SZ"] == "9999-12-31"
    assert expected_days["001365.SZ"] == []
    assert coverage_row["status"] == "complete"
    assert coverage_row["coverage_rate"] == 100.0


def test_coverage_status_requires_actual_rows_not_rounded_rate():
    row = DataCenterService()._coverage_row(
        "daily_kline",
        "ALL",
        "1d",
        "2026-01-01",
        "2026-05-08",
        80,
        80,
        415018,
        415017,
        [],
        0,
        "2026-05-10 10:00:00",
    )

    assert row["coverage_rate"] == 100.0
    assert row["status"] == "partial"


def test_sync_task_list_falls_back_to_latest_sync_log_when_runtime_detail_missing():
    client = TestClient(app)
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO sync_task(task_id, sync_type, status, total_count, success_count, failed_count, started_at, finished_at)
            VALUES ('sync_missing_runtime_detail', 'sync_latest_data', 'failed', 0, 0, 1, '2026-05-20 10:00:00', '2026-05-20 10:01:00')
            """
        )
        connection.execute(
            """
            INSERT INTO sync_log(task_id, sync_type, level, message, technical_detail, created_at)
            VALUES (
                'sync_missing_runtime_detail',
                'sync_latest_data',
                'error',
                '日 K 仍未达到目标交易日。',
                '{"required_stale":["daily_kline"],"next_actions":["执行全市场日 K 补齐"]}',
                '2026-05-20 10:01:00'
            )
            """
        )
        connection.commit()

    response = client.get("/api/data/sync/tasks?keyword=全市场日 K 补齐&page=1&page_size=20")
    body = response.json()["data"]
    item = body["items"][0]

    assert response.status_code == 200
    assert body["total"] == 1
    assert item["task_id"] == "sync_missing_runtime_detail"
    assert item["message"] == "日 K 仍未达到目标交易日。"
    assert "required_stale" in item["technical_detail"]


def test_2026_daily_kline_batches_resume_from_cursor_without_duplicates():
    client = TestClient(app)
    payload = {
        "start_date": "2026-05-06",
        "end_date": "2026-05-08",
        "symbols": ["600000.SH", "000001.SZ"],
        "include_daily_kline": True,
        "daily_batch_size": 1,
        "include_minute_kline": False,
    }

    first_task_id = client.post("/api/data/sync/run-2026", json=payload).json()["data"]["task_id"]
    with get_connection() as connection:
        first_daily_count = connection.execute("SELECT COUNT(*) AS total FROM daily_kline").fetchone()["total"]

    second_task_id = client.post("/api/data/sync/run-2026", json=payload).json()["data"]["task_id"]
    second_task = client.get(f"/api/tasks/{second_task_id}").json()["data"]
    with get_connection() as connection:
        second_daily_count = connection.execute("SELECT COUNT(*) AS total FROM daily_kline").fetchone()["total"]
        skipped_logs = connection.execute(
            "SELECT message FROM sync_log WHERE task_id=? AND sync_type='daily_kline' ORDER BY id",
            (second_task_id,),
        ).fetchall()

    assert client.get(f"/api/tasks/{first_task_id}").json()["data"]["status"] == "success"
    assert second_task["status"] == "success"
    assert first_daily_count == 6
    assert second_daily_count == first_daily_count
    assert any("已跳过" in row["message"] for row in skipped_logs)


def test_2026_daily_resume_rechecks_coverage_even_when_cursor_is_latest():
    client = TestClient(app)
    client.post("/api/data/sync/stock-basic")
    client.post(
        "/api/data/sync/trading-calendar",
        json={"start_date": "2026-05-06", "end_date": "2026-05-08"},
    )
    client.post("/api/data/sync/instrument-detail", json={"symbols": ["600000.SH"]})
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO daily_kline(symbol, trade_date, open, high, low, close, volume, amount, created_at)
            VALUES ('600000.SH', '2026-05-08', 9.1, 9.2, 9.0, 9.15, 1000, 9150, '2026-05-10 10:00:00')
            """
        )
        connection.execute(
            """
            INSERT INTO sync_cursor(source_code, data_type, symbol, period, last_sync_time, updated_at)
            VALUES ('qmt', 'daily_kline', '600000.SH', '', '2026-05-08', '2026-05-10 10:00:00')
            """
        )
        connection.commit()

    payload = {
        "start_date": "2026-05-06",
        "end_date": "2026-05-08",
        "symbols": ["600000.SH"],
        "include_daily_kline": True,
        "daily_batch_size": 1,
        "include_minute_kline": False,
    }
    task_id = client.post("/api/data/sync/run-2026", json=payload).json()["data"]["task_id"]

    with get_connection() as connection:
        daily_count = connection.execute("SELECT COUNT(*) AS total FROM daily_kline WHERE symbol='600000.SH'").fetchone()["total"]
        logs = connection.execute(
            "SELECT message, technical_detail FROM sync_log WHERE task_id=? AND sync_type='daily_kline' ORDER BY id",
            (task_id,),
        ).fetchall()

    assert client.get(f"/api/tasks/{task_id}").json()["data"]["status"] == "success"
    assert daily_count == 3
    assert any("同步完成" in row["message"] for row in logs)
    assert not any("已跳过" in row["message"] for row in logs)


def test_sync_task_list_includes_runtime_progress_and_detail():
    client = TestClient(app)
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO sync_task(task_id, sync_type, status, total_count, success_count, failed_count, started_at)
            VALUES ('task_running_sync_progress', 'sync_2026', 'running', 0, 0, 0, '2026-05-10 10:00:00')
            """
        )
        connection.execute(
            """
            INSERT INTO runtime_task(task_id, task_type, status, progress, message, technical_detail, started_at, created_at)
            VALUES (
                'task_running_sync_progress',
                'sync_2026',
                'running',
                56,
                '2026 日 K 分批补齐：26/53',
                '{"batch":26,"total_batches":53,"rows":200000,"success_symbols":2500,"failed_symbols":0,"skipped_symbols":0,"no_data_symbols":1,"resume_rule":"coverage_first"}',
                '2026-05-10 10:00:00',
                '2026-05-10 10:00:00'
            )
            """
        )
        connection.commit()

    response = client.get("/api/data/sync/tasks?page=1&page_size=5&keyword=task_running_sync_progress")

    assert response.status_code == 200
    item = response.json()["data"]["items"][0]
    assert item["task_id"] == "task_running_sync_progress"
    assert item["progress"] == 56
    assert item["message"] == "2026 日 K 分批补齐：26/53"
    assert "coverage_first" in item["technical_detail"]


def test_success_sync_task_progress_defaults_to_complete():
    client = TestClient(app)
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO sync_task(task_id, sync_type, status, total_count, success_count, failed_count, started_at, finished_at)
            VALUES ('task_success_sync_progress', 'daily_kline', 'success', 80, 80, 0, '2026-05-10 10:00:00', '2026-05-10 10:01:00')
            """
        )
        connection.execute(
            """
            INSERT INTO runtime_task(task_id, task_type, status, progress, message, started_at, finished_at, created_at)
            VALUES (
                'task_success_sync_progress',
                'daily_kline',
                'success',
                0,
                '',
                '2026-05-10 10:00:00',
                '2026-05-10 10:01:00',
                '2026-05-10 10:00:00'
            )
            """
        )
        connection.commit()

    response = client.get("/api/data/sync/tasks?page=1&page_size=5&keyword=task_success_sync_progress")

    assert response.status_code == 200
    item = response.json()["data"]["items"][0]
    assert item["status"] == "success"
    assert item["progress"] == 100
    assert item["message"] == "同步完成"


def test_2026_coverage_uses_qmt_trading_calendar_instead_of_plain_weekdays():
    client = TestClient(app)
    payload = {
        "start_date": "2026-05-06",
        "end_date": "2026-05-08",
        "symbols": ["600000.SH"],
        "include_daily_kline": True,
        "daily_batch_size": 1,
        "include_minute_kline": False,
    }

    task_id = client.post("/api/data/sync/run-2026", json=payload).json()["data"]["task_id"]
    assert client.get(f"/api/tasks/{task_id}").json()["data"]["status"] == "success"

    coverage = client.get("/api/data/sync/coverage-2026?page=1&page_size=20&keyword=600000.SH").json()["data"]["items"]
    daily_record = next(item for item in coverage if item["data_type"] == "daily_kline" and item["symbol"] == "600000.SH")

    assert daily_record["expected_trading_days"] == 3
    assert daily_record["actual_trading_days"] == 3
    assert daily_record["coverage_rate"] == 100.0
    assert daily_record["status"] == "complete"


def test_daily_kline_sync_does_not_advance_cursor_when_qmt_returns_no_rows(monkeypatch):
    client = TestClient(app)

    monkeypatch.setattr(data_service_module.TestIsolationQmtDataAdapter, "get_daily_kline", lambda self, symbols, start_date, end_date: [])

    response = client.post(
        "/api/data/sync/daily-kline",
        json={"symbols": ["600000.SH", "000001.SZ"], "start_date": "2026-05-06", "end_date": "2026-05-08"},
    )
    task_id = response.json()["data"]["task_id"]

    assert response.status_code == 200
    task = client.get(f"/api/tasks/{task_id}").json()["data"]
    assert task["status"] == "failed"
    assert "未返回任何 K 线数据" in task["message"]
    with get_connection() as connection:
        cursor_count = connection.execute(
            "SELECT COUNT(*) AS total FROM sync_cursor WHERE data_type='daily_kline' AND symbol IN ('600000.SH','000001.SZ')",
        ).fetchone()["total"]
        warning_count = connection.execute(
            "SELECT COUNT(*) AS total FROM sync_log WHERE task_id=? AND level='warning' AND message LIKE '%未返回数据%'",
            (task_id,),
        ).fetchone()["total"]
        error_count = connection.execute(
            "SELECT COUNT(*) AS total FROM sync_log WHERE task_id=? AND level='error' AND message LIKE '%未返回任何 K 线数据%'",
            (task_id,),
        ).fetchone()["total"]
        sync_task = connection.execute("SELECT status, failed_count FROM sync_task WHERE task_id=?", (task_id,)).fetchone()

    assert cursor_count == 0
    assert warning_count == 1
    assert error_count == 1
    assert sync_task["status"] == "failed"
    assert sync_task["failed_count"] == 2


def test_2026_missing_coverage_export_returns_csv():
    client = TestClient(app)
    payload = {
        "start_date": "2026-05-06",
        "end_date": "2026-05-08",
        "symbols": ["600000.SH"],
        "include_daily_kline": True,
        "daily_batch_size": 1,
        "include_minute_kline": False,
    }

    task_id = client.post("/api/data/sync/run-2026", json=payload).json()["data"]["task_id"]
    assert client.get(f"/api/tasks/{task_id}").json()["data"]["status"] == "success"

    response = client.get("/api/data/sync/coverage-2026/missing-export")

    assert response.status_code == 200
    assert "text/csv" in response.headers["content-type"]
    assert "attachment;" in response.headers["content-disposition"]
    assert "data_coverage_missing_2026_" in response.headers["content-disposition"]
    assert ".csv" in response.headers["content-disposition"]
    csv_text = response.content.decode("utf-8-sig")
    assert "数据类型,股票代码/范围,周期" in csv_text
    assert "统计单位,统计口径说明" in csv_text

    with get_connection() as connection:
        operation = connection.execute(
            """
            SELECT target_id, message, technical_detail
            FROM operation_log
            WHERE module='数据中心' AND action='导出缺失清单'
            ORDER BY id DESC LIMIT 1
            """
        ).fetchone()

    assert operation is not None
    assert operation["target_id"].startswith("data_coverage_missing_2026_")
    assert operation["target_id"].endswith(".csv")
    assert "已导出 2026 覆盖率缺失清单" in operation["message"]
    assert operation["technical_detail"].endswith(operation["target_id"])


def test_2026_missing_coverage_export_uses_cached_rows_when_available(monkeypatch):
    client = TestClient(app)
    normalized = DataCenterService()._normalize_2026_request(Prepare2026Request())
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO data_coverage(
                data_type, symbol, period, start_date, end_date, expected_trading_days,
                actual_trading_days, expected_rows, actual_rows, missing_days,
                duplicate_rows, coverage_rate, status, checked_at
            )
            VALUES ('daily_kline', 'ALL', '1d', ?, ?, 10, 9, 10, 9, '["2026-05-08"]', 0, 90, 'partial', '2026-05-10 08:00:00')
            """,
            (normalized.start_date, normalized.end_date),
        )
        connection.execute(
            """
            INSERT INTO data_coverage(
                data_type, symbol, period, start_date, end_date, expected_trading_days,
                actual_trading_days, expected_rows, actual_rows, missing_days,
                duplicate_rows, coverage_rate, status, checked_at
            )
            VALUES ('minute_kline', 'ALL', '1m', ?, ?, 10, 8, 10, 8, '["2026-05-09"]', 0, 80, 'partial', '2026-05-10 08:00:00')
            """,
            (normalized.start_date, normalized.end_date),
        )
        connection.commit()

    def fail_refresh(*_args, **_kwargs):
        raise AssertionError("missing coverage export should use cached coverage rows when available")

    monkeypatch.setattr(DataCenterService, "refresh_2026_coverage", fail_refresh)

    response = client.get("/api/data/sync/coverage-2026/missing-export")

    assert response.status_code == 200
    csv_text = response.content.decode("utf-8-sig")
    assert "daily_kline" in csv_text
    assert "2026-05-08" in csv_text
    assert "覆盖单元" in csv_text
    assert "不等于1分钟bar原始行数" in csv_text


def test_2026_missing_coverage_export_does_not_recalculate_without_cache(monkeypatch):
    client = TestClient(app)

    def fail_refresh(*_args, **_kwargs):
        raise AssertionError("missing coverage export must not recalculate coverage inside the HTTP request")

    monkeypatch.setattr(DataCenterService, "refresh_2026_coverage", fail_refresh)

    response = client.get("/api/data/sync/coverage-2026/missing-export")

    assert response.status_code == 200
    csv_text = response.content.decode("utf-8-sig")
    assert "数据类型,股票代码/范围,周期" in csv_text


def test_2026_missing_coverage_export_accepts_checked_window():
    client = TestClient(app)
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO data_coverage(
                data_type, symbol, period, start_date, end_date, expected_trading_days,
                actual_trading_days, expected_rows, actual_rows, missing_days,
                duplicate_rows, coverage_rate, status, checked_at
            )
            VALUES ('minute_kline', 'ALL', '1m', '2026-05-21', '2026-05-21', 1, 1, 2, 1, '["2026-05-21"]', 0, 50, 'partial', '2026-05-22 00:40:00')
            """
        )
        connection.commit()

    response = client.get(
        "/api/data/sync/coverage-2026/missing-export"
        "?data_type=minute_kline&period=1m&start_date=2026-05-21&end_date=2026-05-21"
    )

    assert response.status_code == 200
    csv_text = response.content.decode("utf-8-sig")
    assert "minute_kline" in csv_text
    assert "2026-05-21" in csv_text
    assert "partial" in csv_text


def test_2026_missing_coverage_export_falls_back_to_latest_incomplete_window():
    client = TestClient(app)
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO data_coverage(
                data_type, symbol, period, start_date, end_date, expected_trading_days,
                actual_trading_days, expected_rows, actual_rows, missing_days,
                duplicate_rows, coverage_rate, status, checked_at
            )
            VALUES ('minute_kline', 'ALL', '1m', '2026-05-21', '2026-05-21', 1, 1, 2, 1, '["2026-05-21"]', 0, 50, 'partial', '2026-05-22 00:40:00')
            """
        )
        connection.commit()

    response = client.get("/api/data/sync/coverage-2026/missing-export?data_type=minute_kline&period=1m")

    assert response.status_code == 200
    csv_text = response.content.decode("utf-8-sig")
    assert "minute_kline" in csv_text
    assert "2026-05-21" in csv_text
    assert "partial" in csv_text


def test_minute_expected_days_exclude_suspended_daily_kline_days():
    with get_connection() as connection:
        connection.executemany(
            """
            INSERT INTO daily_kline(symbol, trade_date, open, high, low, close, volume, amount, created_at, suspend_flag)
            VALUES (?, '2026-05-21', 1, 1, 1, 1, ?, ?, '2026-05-22 00:00:00', ?)
            """,
            [
                ("000004.SZ", 0, 0, 1),
                ("600000.SH", 100, 1000, 0),
            ],
        )
        connection.commit()

    result = DataCenterService()._expected_minute_days_by_symbol(
        "2026-05-21",
        "2026-05-21",
        ["000004.SZ", "600000.SH", "000001.SZ"],
        {
            "000004.SZ": ["2026-05-21"],
            "600000.SH": ["2026-05-21"],
            "000001.SZ": ["2026-05-21"],
        },
    )

    assert result["000004.SZ"] == []
    assert result["600000.SH"] == ["2026-05-21"]
    assert result["000001.SZ"] == ["2026-05-21"]


def test_2026_minute_kline_batches_write_cursor_logs_and_symbol_coverage():
    client = TestClient(app)
    payload = {
        "start_date": "2026-05-08",
        "end_date": "2026-05-08",
        "symbols": ["600000.SH", "000001.SZ"],
        "include_daily_kline": False,
        "include_minute_kline": True,
        "minute_batch_size": 1,
        "minute_window_days": 1,
        "include_full_market_minute": False,
        "period": "1m",
    }

    prepare = client.post("/api/data/sync/prepare-2026", json=payload).json()["data"]
    response = client.post("/api/data/sync/run-2026", json=payload)
    task_id = response.json()["data"]["task_id"]
    task = client.get(f"/api/tasks/{task_id}").json()["data"]
    logs = client.get(f"/api/data/sync/logs?page=1&page_size=20&keyword={task_id}&sort_field=created_at&sort_order=asc").json()["data"]
    coverage = client.get("/api/data/sync/coverage-2026?page=1&page_size=20&keyword=600000.SH").json()["data"]

    assert response.status_code == 200
    assert task["status"] == "success"
    assert any("2026 分钟 K 将按" in warning and "sync_cursor 断点续跑" in warning for warning in prepare["warnings"])
    assert any(item["sync_type"] == "minute_kline" and "分批补齐开始" in item["message"] for item in logs["items"])
    assert any(item["data_type"] == "minute_kline" and item["symbol"] == "600000.SH" for item in coverage["items"])
    with get_connection() as connection:
        minute_count = connection.execute("SELECT COUNT(*) AS total FROM minute_kline").fetchone()["total"]
        cursors = {
            (row["symbol"], row["period"], row["last_sync_time"])
            for row in connection.execute(
                "SELECT symbol, period, last_sync_time FROM sync_cursor WHERE data_type='minute_kline'"
            ).fetchall()
        }

    assert minute_count == 10
    assert ("600000.SH", "1m", "2026-05-08 15:00:00") in cursors
    assert ("000001.SZ", "1m", "2026-05-08 15:00:00") in cursors


def test_minute_symbol_coverage_stats_groups_by_symbol_day():
    repository = DataCenterRepository()
    symbol = "689999.SH"
    with get_connection() as connection:
        connection.executemany(
            """
            INSERT INTO minute_kline(
                symbol, datetime, period, open, high, low, close, pre_close,
                volume, amount, suspend_flag, created_at
            ) VALUES (?, ?, '1m', 10, 10.2, 9.9, 10.1, 10, 1000, 10000, 0, '2026-05-20 10:00:00')
            """,
            [
                (symbol, "2026-05-06 09:30:00"),
                (symbol, "2026-05-06 09:31:00"),
                (symbol, "2026-05-07 09:30:00"),
            ],
        )

    stats = repository.minute_symbol_coverage_stats("2026-05-06", "2026-05-07", "1m", [symbol])

    assert stats[symbol]["rows"] == 3
    assert stats[symbol]["days"] == {"2026-05-06", "2026-05-07"}


def test_2026_full_market_minute_kline_does_not_truncate_to_first_200_symbols():
    repository = DataCenterRepository()
    rows = [
        {
            "symbol": f"{600000 + index:06d}.SH",
            "name": f"测试股票{index}",
            "market": "SH",
            "security_type": "股票",
            "list_status": "上市",
            "is_st": False,
        }
        for index in range(205)
    ]
    repository.upsert_stock_basic(rows)
    client = TestClient(app)
    payload = {
        "start_date": "2026-05-08",
        "end_date": "2026-05-08",
        "include_daily_kline": False,
        "include_minute_kline": True,
        "include_full_market_minute": True,
        "minute_batch_size": 100,
        "minute_window_days": 1,
        "period": "1m",
    }

    prepare = client.post("/api/data/sync/prepare-2026", json=payload).json()["data"]
    task_id = client.post("/api/data/sync/run-2026", json=payload).json()["data"]["task_id"]
    task = client.get(f"/api/tasks/{task_id}").json()["data"]

    with get_connection() as connection:
        synced_symbols = connection.execute("SELECT COUNT(DISTINCT symbol) AS total FROM minute_kline").fetchone()["total"]
        logs = connection.execute(
            "SELECT message, technical_detail FROM sync_log WHERE task_id=? AND sync_type='minute_kline'",
            (task_id,),
        ).fetchall()

    assert task["status"] == "success"
    assert synced_symbols >= 205
    assert any("不会只截断首批 200 只" in warning for warning in prepare["warnings"])
    assert not any("首批 200" in row["message"] for row in logs)


def test_list_all_stock_symbols_paginates_beyond_first_page():
    repository = DataCenterRepository()
    rows = [
        {
            "symbol": f"{600000 + index:06d}.SH",
            "name": f"测试股票{index}",
            "market": "SH",
            "security_type": "股票",
            "list_status": "上市",
            "is_st": False,
        }
        for index in range(205)
    ]

    repository.upsert_stock_basic(rows)
    symbols = repository.list_all_stock_symbols(page_size=200)

    assert len(symbols) == 205
    assert symbols[0] == "600000.SH"
    assert symbols[-1] == "600204.SH"


def test_basic_reference_sync_writes_instruments_calendar_and_dictionary():
    client = TestClient(app)

    stock_task = client.post("/api/data/sync/stock-basic").json()["data"]["task_id"]
    instrument_response = client.post(
        "/api/data/sync/instrument-detail",
        json={"symbols": ["600000.SH", "000001.SZ"]},
    )
    calendar_response = client.post(
        "/api/data/sync/trading-calendar",
        json={"start_date": "2026-05-06", "end_date": "2026-05-08"},
    )
    instrument_task = instrument_response.json()["data"]["task_id"]
    calendar_task = calendar_response.json()["data"]["task_id"]

    instruments = client.get("/api/data/basic/instruments?page=1&page_size=20&sort_field=symbol&sort_order=asc").json()["data"]
    calendar = client.get("/api/data/basic/trading-calendar?page=1&page_size=20&start_date=2026-05-06&end_date=2026-05-08").json()["data"]
    instrument_dictionary = client.get("/api/data/dictionary/instrument_detail?page=1&page_size=100").json()["data"]
    calendar_dictionary = client.get("/api/data/dictionary/trading_calendar?page=1&page_size=100").json()["data"]

    assert client.get(f"/api/tasks/{stock_task}").json()["data"]["status"] == "success"
    assert instrument_response.status_code == 200
    assert calendar_response.status_code == 200
    assert client.get(f"/api/tasks/{instrument_task}").json()["data"]["status"] == "success"
    assert client.get(f"/api/tasks/{calendar_task}").json()["data"]["status"] == "success"
    assert instruments["total"] == 2
    first_instrument = instruments["items"][0]
    assert first_instrument["symbol"] in {"000001.SZ", "600000.SH"}
    assert first_instrument["up_stop_price"] > 0
    assert "TestIsolationDataAdapter" in first_instrument["raw_json"]
    assert calendar["total"] == 6
    assert {item["market"] for item in calendar["items"]} == {"SH", "SZ"}
    assert any(item["field_name"] == "up_stop_price" for item in instrument_dictionary["items"])
    assert any(item["field_name"] == "trade_date" for item in calendar_dictionary["items"])


def test_real_mode_account_data_defaults_to_current_account_latest_snapshot():
    client = TestClient(app)

    config = client.get("/api/system/config").json()["data"]
    config["account_id"] = "real_account"
    config["simulation_mode"] = False
    assert client.put("/api/system/config", json=config).status_code == 200

    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO account_snapshot(account_id, total_asset, available_cash, frozen_cash, market_value, today_pnl, snapshot_time)
            VALUES ('test_isolation_account', 1000000, 500000, 0, 500000, 0, '2026-05-09 09:00:00')
            """
        )
        connection.execute(
            """
            INSERT INTO account_snapshot(account_id, total_asset, available_cash, frozen_cash, market_value, today_pnl, snapshot_time)
            VALUES ('real_account', 4408.25, 0, 0, 4408.25, -572.02, '2026-05-10 09:12:05')
            """
        )
        connection.executemany(
            """
            INSERT INTO position_snapshot(account_id, symbol, name, quantity, available_quantity, cost_price, last_price, market_value, pnl, pnl_ratio, snapshot_time)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                ("test_isolation_account", "600000.SH", "浦发银行", 100, 100, 9.0, 9.1, 910, 10, 1.1, "2026-05-09 09:00:00"),
                ("real_account", "871169.BJ", "辰光医疗", 200, 200, 21.0, 19.0, 3800, -400, -9.5, "2026-05-10 09:10:00"),
                ("real_account", "871169.BJ", "辰光医疗", 229, 229, 21.7479, 19.25, 4408.25, -572.02, -11.49, "2026-05-10 09:12:05"),
            ],
        )
        connection.execute(
            """
            INSERT INTO order_record(local_order_id, qmt_order_id, account_id, symbol, name, side, price, quantity, filled_quantity, status, source, order_time, updated_at)
            VALUES ('test_order_scope', 'test_qmt_order_scope', 'test_isolation_account', '600000.SH', '浦发银行', 'BUY', 9.12, 100, 100, '全部成交', 'test_sync', '2026-05-09 09:00:00', '2026-05-09 09:00:00')
            """
        )
        connection.execute(
            """
            INSERT INTO trade_record(trade_id, local_order_id, qmt_order_id, account_id, symbol, name, side, price, quantity, amount, fee, source, trade_time)
            VALUES ('test_trade_scope', 'test_order_scope', 'test_qmt_order_scope', 'test_isolation_account', '600000.SH', '浦发银行', 'BUY', 9.12, 100, 912, 1, 'test_sync', '2026-05-09 09:00:00')
            """
        )
        connection.commit()

    account = client.get("/api/data/account/latest").json()["data"]
    positions = client.get("/api/data/positions?page=1&page_size=20").json()["data"]
    all_positions = client.get("/api/data/positions?page=1&page_size=20&scope=all_history").json()["data"]
    orders = client.get("/api/data/orders?page=1&page_size=20").json()["data"]
    trades = client.get("/api/data/trades?page=1&page_size=20").json()["data"]

    assert account["account_id"] == "real_account"
    assert positions["total"] == 1
    assert positions["items"][0]["account_id"] == "real_account"
    assert positions["items"][0]["quantity"] == 229
    assert all_positions["total"] == 3
    assert orders["total"] == 0
    assert trades["total"] == 0


def test_test_isolation_account_data_ignores_configured_real_account_id():
    client = TestClient(app)

    config = client.get("/api/system/config").json()["data"]
    config["account_id"] = "real_account"
    config["simulation_mode"] = True
    assert client.put("/api/system/config", json=config).status_code == 200

    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO account_snapshot(account_id, total_asset, available_cash, frozen_cash, market_value, today_pnl, snapshot_time)
            VALUES ('test_isolation_account', 1234.5, 234.5, 0, 1000, 12.3, '2026-05-10 09:12:05')
            """
        )
        connection.execute(
            """
            INSERT INTO account_snapshot(account_id, total_asset, available_cash, frozen_cash, market_value, today_pnl, snapshot_time)
            VALUES ('real_account', 999999, 999999, 0, 0, -1, '2026-05-11 09:12:05')
            """
        )
        connection.executemany(
            """
            INSERT INTO position_snapshot(account_id, symbol, name, quantity, available_quantity, cost_price, last_price, market_value, pnl, pnl_ratio, snapshot_time)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                ("test_isolation_account", "600000.SH", "浦发银行", 100, 100, 9.0, 10.0, 1000, 100, 11.1, "2026-05-10 09:12:05"),
                ("real_account", "871169.BJ", "辰光医疗", 229, 229, 21.7479, 19.25, 4408.25, -572.02, -11.49, "2026-05-11 09:12:05"),
            ],
        )
        connection.execute(
            """
            INSERT INTO order_record(local_order_id, qmt_order_id, account_id, symbol, name, side, price, quantity, filled_quantity, status, source, order_time, updated_at)
            VALUES ('test_iso_order_scope', 'test_iso_qmt_scope', 'test_isolation_account', '600000.SH', '浦发银行', 'BUY', 9.12, 100, 100, '全部成交', 'test_sync', '2026-05-10 09:13:00', '2026-05-10 09:13:00')
            """
        )
        connection.execute(
            """
            INSERT INTO order_record(local_order_id, qmt_order_id, account_id, symbol, name, side, price, quantity, filled_quantity, status, source, order_time, updated_at)
            VALUES ('real_order_scope', 'real_qmt_scope', 'real_account', '871169.BJ', '辰光医疗', 'BUY', 19.25, 229, 229, '全部成交', 'real_sync', '2026-05-11 09:13:00', '2026-05-11 09:13:00')
            """
        )
        connection.execute(
            """
            INSERT INTO trade_record(trade_id, local_order_id, qmt_order_id, account_id, symbol, name, side, price, quantity, amount, fee, source, trade_time)
            VALUES ('test_iso_trade_scope', 'test_iso_order_scope', 'test_iso_qmt_scope', 'test_isolation_account', '600000.SH', '浦发银行', 'BUY', 9.12, 100, 912, 1, 'test_sync', '2026-05-10 09:13:01')
            """
        )
        connection.execute(
            """
            INSERT INTO trade_record(trade_id, local_order_id, qmt_order_id, account_id, symbol, name, side, price, quantity, amount, fee, source, trade_time)
            VALUES ('real_trade_scope', 'real_order_scope', 'real_qmt_scope', 'real_account', '871169.BJ', '辰光医疗', 'BUY', 19.25, 229, 4408.25, 1, 'real_sync', '2026-05-11 09:13:01')
            """
        )
        connection.commit()

    account = client.get("/api/data/account/latest").json()["data"]
    positions = client.get("/api/data/positions?page=1&page_size=20").json()["data"]
    all_positions = client.get("/api/data/positions?page=1&page_size=20&scope=all_history").json()["data"]
    orders = client.get("/api/data/orders?page=1&page_size=20").json()["data"]
    trades = client.get("/api/data/trades?page=1&page_size=20").json()["data"]

    assert account["account_id"] == "test_isolation_account"
    assert account["total_asset"] == 1234.5
    assert positions["total"] == 1
    assert positions["items"][0]["account_id"] == "test_isolation_account"
    assert all_positions["total"] == 2
    assert orders["total"] == 1
    assert orders["items"][0]["account_id"] == "test_isolation_account"
    assert trades["total"] == 1
    assert trades["items"][0]["account_id"] == "test_isolation_account"


def test_real_qmt_connect_runs_readonly_probe_before_enabling(monkeypatch):
    client = TestClient(app)

    class FakeRealQmtReadOnlyDataAdapter:
        def __init__(self, qmt_path: str, account_id: str) -> None:
            self.qmt_path = qmt_path
            self.account_id = account_id

        def get_account(self) -> dict[str, object]:
            return {
                "account_id": self.account_id,
                "total_asset": 12345.67,
                "available_cash": 1000,
                "frozen_cash": 0,
                "market_value": 11345.67,
                "today_pnl": 0,
            }

    monkeypatch.setattr(data_service_module, "RealQmtReadOnlyDataAdapter", FakeRealQmtReadOnlyDataAdapter)
    config = client.get("/api/system/config").json()["data"]
    config["qmt_path"] = "C:/QMT"
    config["account_id"] = "real_account"
    config["simulation_mode"] = False
    assert client.put("/api/system/config", json=config).status_code == 200

    response = client.post("/api/data/sources/qmt/connect")
    status = client.get("/api/data/sources/qmt/status").json()["data"]

    assert response.status_code == 200
    assert response.json()["data"]["connected"] is True
    assert status["connected"] is True
    with get_connection() as connection:
        operation = connection.execute(
            """
            SELECT message, technical_detail
            FROM operation_log
            WHERE module='数据中心' AND action='连接数据'
            ORDER BY id DESC
            LIMIT 1
            """
        ).fetchone()
    assert "已连接真实 QMT 只读数据源" in operation["message"]
    assert "real_qmt_readonly_probe=true" in operation["technical_detail"]
    assert "real_order_submitted=false" in operation["technical_detail"]


def test_real_qmt_connect_failure_keeps_source_disabled(monkeypatch):
    client = TestClient(app)

    class BrokenRealQmtReadOnlyDataAdapter:
        def __init__(self, qmt_path: str, account_id: str) -> None:
            self.qmt_path = qmt_path
            self.account_id = account_id

        def get_account(self) -> dict[str, object]:
            raise RuntimeError("qmt offline")

    monkeypatch.setattr(data_service_module, "RealQmtReadOnlyDataAdapter", BrokenRealQmtReadOnlyDataAdapter)
    config = client.get("/api/system/config").json()["data"]
    config["qmt_path"] = "C:/QMT"
    config["account_id"] = "real_account"
    config["simulation_mode"] = False
    assert client.put("/api/system/config", json=config).status_code == 200

    response = client.post("/api/data/sources/qmt/connect")
    status = client.get("/api/data/sources/qmt/status").json()["data"]

    assert response.status_code == 400
    assert response.json()["message"] == "真实 QMT 只读资产查询失败。"
    assert response.json()["error"]["code"] == "REAL_QMT_READONLY_FAILED"
    assert status["connected"] is False


def test_repeated_test_isolation_sync_does_not_duplicate_unique_market_records():
    client = TestClient(app)

    first = client.post("/api/data/sync/all").json()["data"]["task_id"]
    second = client.post("/api/data/sync/all").json()["data"]["task_id"]

    assert client.get(f"/api/tasks/{first}").json()["data"]["status"] == "success"
    assert client.get(f"/api/tasks/{second}").json()["data"]["status"] == "success"
    with get_connection() as connection:
        stock_count = connection.execute("SELECT COUNT(*) FROM stock_basic").fetchone()[0]
        daily_count = connection.execute("SELECT COUNT(*) FROM daily_kline").fetchone()[0]
        order_count = connection.execute("SELECT COUNT(*) FROM order_record WHERE local_order_id='test_order_001'").fetchone()[0]
        trade_count = connection.execute("SELECT COUNT(*) FROM trade_record WHERE trade_id='test_trade_001'").fetchone()[0]
        duplicate_daily = connection.execute(
            """
            SELECT COUNT(*)
            FROM (
                SELECT symbol, trade_date FROM daily_kline
                GROUP BY symbol, trade_date
                HAVING COUNT(*) > 1
            )
            """
        ).fetchone()[0]

    assert stock_count == 3
    assert daily_count == 6
    assert order_count == 1
    assert trade_count == 1
    assert duplicate_daily == 0


def test_position_snapshot_upsert_prevents_same_time_duplicates(monkeypatch):
    monkeypatch.setattr(data_repo_module, "now_text", lambda: "2026-05-10 10:00:00")
    repository = DataCenterRepository()
    first_rows = [
        {
            "account_id": "test_isolation_account",
            "symbol": "600000.SH",
            "name": "浦发银行",
            "quantity": 100,
            "available_quantity": 100,
            "cost_price": 9.0,
            "last_price": 9.1,
        }
    ]
    second_rows = [{**first_rows[0], "quantity": 200, "available_quantity": 150, "last_price": 9.2}]

    assert repository.upsert_positions(first_rows) == 1
    assert repository.upsert_positions(second_rows) == 1

    with get_connection() as connection:
        count = connection.execute("SELECT COUNT(*) FROM position_snapshot").fetchone()[0]
        row = connection.execute("SELECT quantity, available_quantity, last_price FROM position_snapshot").fetchone()
        duplicate_count = connection.execute(
            """
            SELECT COUNT(*)
            FROM (
                SELECT account_id, symbol, snapshot_time
                FROM position_snapshot
                GROUP BY account_id, symbol, snapshot_time
                HAVING COUNT(*) > 1
            )
            """
        ).fetchone()[0]

    assert count == 1
    assert row["quantity"] == 200
    assert row["available_quantity"] == 150
    assert row["last_price"] == 9.2
    assert duplicate_count == 0


def test_account_snapshot_same_second_updates_instead_of_duplicate(monkeypatch):
    monkeypatch.setattr(data_repo_module, "now_text", lambda: "2026-05-10 10:00:00")
    repository = DataCenterRepository()

    repository.insert_account(
        {
            "account_id": "real_account",
            "total_asset": 100000,
            "available_cash": 50000,
            "frozen_cash": 0,
            "market_value": 50000,
            "today_pnl": 100,
        }
    )
    repository.insert_account(
        {
            "account_id": "real_account",
            "total_asset": 110000,
            "available_cash": 60000,
            "frozen_cash": 0,
            "market_value": 50000,
            "today_pnl": 200,
        }
    )

    with get_connection() as connection:
        count = connection.execute("SELECT COUNT(*) FROM account_snapshot").fetchone()[0]
        row = connection.execute("SELECT total_asset, available_cash, today_pnl FROM account_snapshot").fetchone()
        duplicate_count = connection.execute(
            """
            SELECT COUNT(*)
            FROM (
                SELECT account_id, snapshot_time
                FROM account_snapshot
                GROUP BY account_id, snapshot_time
                HAVING COUNT(*) > 1
            )
            """
        ).fetchone()[0]

    assert count == 1
    assert row["total_asset"] == 110000
    assert row["available_cash"] == 60000
    assert row["today_pnl"] == 200
    assert duplicate_count == 0


def test_account_snapshot_duplicate_report_is_readonly():
    client = TestClient(app)
    snapshot_time = "2026-05-10 10:00:00"
    with get_connection() as connection:
        connection.executemany(
            """
            INSERT INTO account_snapshot(account_id, total_asset, available_cash, frozen_cash, market_value, today_pnl, snapshot_time)
            VALUES(?, ?, ?, ?, ?, ?, ?)
            """,
            [
                ("real_account", 100000, 50000, 0, 50000, 100, snapshot_time),
                ("real_account", 110000, 60000, 0, 50000, 200, snapshot_time),
                ("real_account", 120000, 70000, 0, 50000, 300, "2026-05-10 10:01:00"),
            ],
        )
        connection.commit()

    response = client.get("/api/data/quality/account-snapshot-duplicates?page=1&page_size=20")

    with get_connection() as connection:
        row_count = connection.execute("SELECT COUNT(*) FROM account_snapshot").fetchone()[0]

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    data = body["data"]
    assert data["total"] == 1
    item = data["items"][0]
    assert item["account_id"] == "real_account"
    assert item["snapshot_time"] == snapshot_time
    assert item["duplicate_count"] == 2
    assert item["min_total_asset"] == 100000
    assert item["max_total_asset"] == 110000
    assert row_count == 3


def test_minute_kline_sync_requires_symbol_and_time_range():
    client = TestClient(app)

    response = client.post("/api/data/sync/minute-kline", json={"symbols": []})

    assert response.status_code == 400
    body = response.json()
    assert body["success"] is False
    assert body["error"]["code"] == "DATA_SYNC_RANGE_REQUIRED"


def test_minute_kline_sync_with_range_succeeds():
    client = TestClient(app)

    response = client.post(
        "/api/data/sync/minute-kline",
        json={
            "symbols": ["600000.SH"],
            "start_time": "2026-05-08 09:30:00",
            "end_time": "2026-05-08 10:00:00",
            "period": "1m",
        },
    )
    task_id = response.json()["data"]["task_id"]
    minute_response = client.get("/api/data/kline/minute?page=1&page_size=20&symbol=600000.SH&period=1m")

    assert response.status_code == 200
    assert client.get(f"/api/tasks/{task_id}").json()["data"]["status"] == "success"
    assert minute_response.json()["data"]["total"] >= 1


def test_minute_kline_list_filters_by_date_range_without_cross_day_rows():
    client = TestClient(app)
    with get_connection() as connection:
        connection.executemany(
            """
            INSERT INTO minute_kline(symbol, datetime, period, open, high, low, close, volume, amount, created_at)
            VALUES (?, ?, '1m', 10, 10.1, 9.9, 10, 100, 1000, '2026-05-20 10:00:00')
            """,
            [
                ("600000.SH", "2026-05-07 09:31:00"),
                ("600000.SH", "2026-05-08 09:31:00"),
            ],
        )

    response = client.get(
        "/api/data/kline/minute?page=1&page_size=20&symbol=600000.SH&period=1m&start_date=2026-05-08&end_date=2026-05-08"
    )
    items = response.json()["data"]["items"]

    assert response.status_code == 200
    assert items
    assert {item["datetime"][:10] for item in items} == {"2026-05-08"}


def test_minute_kline_sync_standardizes_symbol_and_writes_symbol_cursor():
    client = TestClient(app)

    response = client.post(
        "/api/data/sync/minute-kline",
        json={
            "symbols": ["SH600000", "000001"],
            "start_time": "2026-05-08 09:30",
            "end_time": "2026-05-08 10:00",
            "period": "1min",
        },
    )
    assert response.status_code == 200

    with get_connection() as connection:
        symbols = {
            row[0]
            for row in connection.execute("SELECT DISTINCT symbol FROM minute_kline").fetchall()
        }
        cursors = {
            (row[0], row[1], row[2])
            for row in connection.execute(
                "SELECT symbol, period, last_sync_time FROM sync_cursor WHERE data_type='minute_kline'"
            ).fetchall()
        }

    assert symbols == {"600000.SH", "000001.SZ"}
    assert ("600000.SH", "1m", "2026-05-08 10:00:00") in cursors
    assert ("000001.SZ", "1m", "2026-05-08 10:00:00") in cursors


def test_minute_kline_sync_rejects_overlarge_range():
    client = TestClient(app)

    response = client.post(
        "/api/data/sync/minute-kline",
        json={
            "symbols": ["600000.SH"],
            "start_time": "2026-05-01 09:30:00",
            "end_time": "2026-05-20 15:00:00",
            "period": "1m",
        },
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "DATA_SYNC_RANGE_TOO_LARGE"


def test_2026_minute_resume_rechecks_coverage_even_when_cursor_is_latest(monkeypatch):
    client = TestClient(app)
    calls: list[tuple[tuple[str, ...], str, str, str]] = []

    def fake_get_minute_kline(self, symbols, start_time, end_time, period="1m"):
        calls.append((tuple(symbols), start_time, end_time, period))
        return [
            {
                "symbol": symbol,
                "datetime": "2026-05-08 09:31:00",
                "period": period,
                "open": 9.1,
                "high": 9.2,
                "low": 9.0,
                "close": 9.15,
                "volume": 10000,
                "amount": 91500,
            }
            for symbol in symbols
        ]

    monkeypatch.setattr(data_service_module.TestIsolationQmtDataAdapter, "get_minute_kline", fake_get_minute_kline)
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO sync_cursor(source_code, data_type, symbol, period, last_sync_time, updated_at)
            VALUES ('qmt', 'minute_kline', '600000.SH', '1m', '2026-05-08 15:00:00', '2026-05-10 10:00:00')
            """
        )
        connection.commit()

    response = client.post(
        "/api/data/sync/run-2026",
        json={
            "start_date": "2026-05-08",
            "end_date": "2026-05-08",
            "symbols": ["600000.SH"],
            "include_daily_kline": False,
            "include_minute_kline": True,
            "minute_batch_size": 1,
            "minute_window_days": 5,
            "period": "1m",
        },
    )
    task_id = response.json()["data"]["task_id"]
    task = client.get(f"/api/tasks/{task_id}").json()["data"]
    logs = client.get("/api/data/sync/logs?page=1&page_size=20&keyword=minute_coverage_first").json()["data"]["items"]

    with get_connection() as connection:
        minute_count = connection.execute("SELECT COUNT(*) FROM minute_kline WHERE symbol='600000.SH'").fetchone()[0]

    assert response.status_code == 200
    assert task["status"] == "success"
    assert calls
    assert minute_count >= 1
    assert any("minute_coverage_first" in str(item["technical_detail"]) for item in logs)


def test_minute_date_windows_use_trading_calendar_not_calendar_days():
    service = DataCenterService()
    with get_connection() as connection:
        connection.executemany(
            """
            INSERT INTO trading_calendar(market, trade_date, is_trading_day, source, sync_time)
            VALUES ('SH', ?, 1, 'test_sync', '2026-05-10 10:00:00')
            """,
            [("2026-05-04",), ("2026-05-05",), ("2026-05-06",), ("2026-05-07",), ("2026-05-08",)],
        )
        connection.commit()

    windows = service._minute_date_windows("2026-05-01", "2026-05-10", 2)

    assert windows == [
        ("2026-05-04", "2026-05-05"),
        ("2026-05-06", "2026-05-07"),
        ("2026-05-08", "2026-05-08"),
    ]


def test_quality_check_and_dictionary():
    client = TestClient(app)

    client.post("/api/data/sync/all")
    quality_task = client.post("/api/data/quality/check").json()["data"]["task_id"]
    quality_response = client.get("/api/data/quality/results?page=1&page_size=50")
    summary_response = client.get("/api/data/quality/summary")
    dictionary_response = client.get("/api/data/dictionary/stock_basic?page=1&page_size=100")
    full_dictionary_response = client.get("/api/data/dictionary?page=1&page_size=200")

    assert client.get(f"/api/tasks/{quality_task}").json()["data"]["status"] == "success"
    assert quality_response.json()["data"]["total"] >= 1
    assert summary_response.json()["data"]["success_count"] >= 1
    assert any(item["field_name"] == "symbol" for item in dictionary_response.json()["data"]["items"])
    dictionary = full_dictionary_response.json()["data"]
    tables = {item["table_name"] for item in dictionary["items"]}
    assert dictionary["total"] >= 100
    assert {
        "stock_basic",
        "instrument_detail",
        "trading_calendar",
        "daily_kline",
        "minute_kline",
        "account_snapshot",
        "position_snapshot",
        "order_record",
        "trade_record",
        "strategy_signal",
        "backtest_task",
        "backtest_result",
        "backtest_trade",
        "backtest_equity",
        "sync_cursor",
    } <= tables
    close_field = next(item for item in dictionary["items"] if item["table_name"] == "daily_kline" and item["field_name"] == "close")
    signal_field = next(item for item in dictionary["items"] if item["table_name"] == "strategy_signal" and item["field_name"] == "action")
    order_source_field = next(item for item in dictionary["items"] if item["table_name"] == "order_record" and item["field_name"] == "source")
    trade_source_field = next(item for item in dictionary["items"] if item["table_name"] == "trade_record" and item["field_name"] == "source")
    assert close_field["unit"] == "元"
    assert "StrategyContext" in close_field["strategy_usage"]
    assert "不会自动实盘下单" in signal_field["strategy_usage"]
    assert "real_sync" in order_source_field["description"]
    assert "test_sync 仅用于测试隔离" in order_source_field["description"]
    assert "real_sync" in trade_source_field["description"]
    assert "test_sync 仅用于测试隔离" in trade_source_field["description"]


def test_dictionary_endpoint_self_heals_empty_dictionary_table():
    client = TestClient(app)

    with get_connection() as connection:
        connection.execute("DELETE FROM data_dictionary")
        connection.commit()

    response = client.get("/api/data/dictionary?page=1&page_size=200&sort_field=table_name&sort_order=asc")
    data = response.json()["data"]

    assert response.status_code == 200
    assert data["total"] >= 100
    assert any(item["table_name"] == "daily_kline" and item["field_name"] == "close" for item in data["items"])


def test_quality_check_reports_duplicates_symbol_format_cursor_and_sync_failures():
    client = TestClient(app)
    client.post("/api/data/sync/all")
    with get_connection() as connection:
        connection.execute("DROP INDEX IF EXISTS idx_position_snapshot_unique_account_symbol_time")
        connection.execute(
            """
            INSERT INTO stock_basic(symbol, name, market, security_type, list_status, is_st, updated_at)
            VALUES ('BAD_CODE', '坏代码', 'SH', '股票', '上市', 0, '2026-05-09')
            """
        )
        connection.execute(
            """
            INSERT INTO sync_task(task_id, sync_type, status, total_count, success_count, failed_count, started_at, finished_at)
            VALUES ('task_failed_sync_test', 'daily_kline', 'failed', 0, 0, 1, '2026-05-09 10:00:00', '2026-05-09 10:01:00')
            """
        )
        connection.execute(
            """
            INSERT INTO position_snapshot(account_id, symbol, name, quantity, available_quantity, cost_price, last_price, market_value, pnl, pnl_ratio, snapshot_time)
            VALUES ('test_isolation_account', '600000.SH', '浦发银行', 100, 100, 9, 9.1, 910, 10, 1.1, '2026-05-10 10:00:00')
            """
        )
        connection.execute(
            """
            INSERT INTO position_snapshot(account_id, symbol, name, quantity, available_quantity, cost_price, last_price, market_value, pnl, pnl_ratio, snapshot_time)
            VALUES ('test_isolation_account', '600000.SH', '浦发银行', 200, 200, 9, 9.2, 1840, 40, 2.2, '2026-05-10 10:00:00')
            """
        )
        connection.execute(
            """
            INSERT INTO sync_cursor(source_code, data_type, symbol, period, last_sync_time, updated_at)
            VALUES ('qmt', 'stock_basic', '600000.SH,000001.SZ', '', '2026-05-09 10:00:00', '2026-05-09 10:00:00')
            """
        )
        connection.commit()

    quality_task = client.post("/api/data/quality/check").json()["data"]["task_id"]
    quality = client.get("/api/data/quality/results?page=1&page_size=100").json()["data"]["items"]

    assert client.get(f"/api/tasks/{quality_task}").json()["data"]["status"] == "success"
    assert any(item["check_type"] == "代码格式" and item["status"] == "failed" for item in quality)
    assert any(item["check_type"] == "同步失败" and item["status"] == "failed" for item in quality)
    assert any(item["check_type"] == "重复数据" and item["target_table"] == "daily_kline" and item["status"] == "success" for item in quality)
    assert any(item["check_type"] == "重复数据" and item["target_table"] == "position_snapshot" and item["status"] == "failed" for item in quality)
    assert any(item["check_type"] == "同步游标格式" and item["target_table"] == "sync_cursor" and item["status"] == "warning" for item in quality)


def test_quality_check_treats_empty_order_and_trade_records_as_optional_flows():
    client = TestClient(app)

    quality_task = client.post("/api/data/quality/check").json()["data"]["task_id"]
    quality = client.get("/api/data/quality/results?page=1&page_size=100").json()["data"]["items"]

    order_empty = next(item for item in quality if item["check_type"] == "数据为空" and item["target_table"] == "order_record")
    trade_empty = next(item for item in quality if item["check_type"] == "数据为空" and item["target_table"] == "trade_record")
    order_time = next(item for item in quality if item["check_type"] == "更新时间" and item["target_table"] == "order_record")
    trade_time = next(item for item in quality if item["check_type"] == "更新时间" and item["target_table"] == "trade_record")

    assert client.get(f"/api/tasks/{quality_task}").json()["data"]["status"] == "success"
    assert order_empty["status"] == "success"
    assert trade_empty["status"] == "success"
    assert order_time["status"] == "success"
    assert trade_time["status"] == "success"
    assert "正常状态" in order_empty["message"]
    assert "正常状态" in trade_time["message"]
    assert order_empty["suggestion"] is None
    assert trade_time["suggestion"] is None


def test_quality_duplicate_check_uses_unique_index_contract_for_kline_tables():
    repository = DataCenterRepository()

    assert repository.has_unique_index_for_fields("daily_kline", ["symbol", "trade_date"]) is True
    assert repository.has_unique_index_for_fields("minute_kline", ["symbol", "period", "datetime"]) is True
    assert repository.duplicate_group_count("daily_kline", ["symbol", "trade_date"]) == 0
    assert repository.duplicate_group_count("minute_kline", ["symbol", "period", "datetime"]) == 0


def test_daily_kline_missing_symbol_count_ignores_non_trading_zero_volume_instruments():
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO stock_basic(symbol, name, market, security_type, list_status, is_st, updated_at)
            VALUES ('001237.SZ', '惠康科技', 'SZ', '股票', '上市', 0, '2026-05-21 01:15:27')
            """
        )
        connection.execute(
            """
            INSERT INTO instrument_detail(symbol, instrument_name, is_trading, total_volume, float_volume, sync_time)
            VALUES ('001237.SZ', '惠康科技', 0, 0, 0, '2026-05-21 01:15:27')
            """
        )
        connection.commit()

    assert DataCenterRepository().daily_kline_missing_symbol_count() == 0


def test_quality_check_ignores_resolved_sync_failures_and_non_current_account_duplicates():
    client = TestClient(app)
    config = client.get("/api/system/config").json()["data"]
    config["account_id"] = "real_account_quality"
    config["simulation_mode"] = False
    assert client.put("/api/system/config", json=config).status_code == 200

    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO account_snapshot(account_id, total_asset, available_cash, frozen_cash, market_value, today_pnl, snapshot_time)
            VALUES ('test_isolation_account', 100, 100, 0, 0, 0, '2026-05-10 10:00:00')
            """
        )
        connection.execute(
            """
            INSERT INTO account_snapshot(account_id, total_asset, available_cash, frozen_cash, market_value, today_pnl, snapshot_time)
            VALUES ('test_isolation_account', 100, 100, 0, 0, 0, '2026-05-10 10:00:00')
            """
        )
        connection.execute(
            """
            INSERT INTO account_snapshot(account_id, total_asset, available_cash, frozen_cash, market_value, today_pnl, snapshot_time)
            VALUES ('real_account_quality', 100, 100, 0, 0, 0, '2026-05-10 10:00:00')
            """
        )
        connection.execute(
            """
            INSERT INTO sync_task(task_id, sync_type, status, total_count, success_count, failed_count, started_at, finished_at)
            VALUES ('task_resolved_failed_quality', 'daily_kline', 'failed', 0, 0, 1, '2026-05-10 09:00:00', '2026-05-10 09:01:00')
            """
        )
        connection.execute(
            """
            INSERT INTO sync_task(task_id, sync_type, status, total_count, success_count, failed_count, started_at, finished_at)
            VALUES ('task_resolved_success_quality', 'daily_kline', 'success', 1, 1, 0, '2026-05-10 09:05:00', '2026-05-10 09:06:00')
            """
        )
        connection.commit()

    quality_task = client.post("/api/data/quality/check").json()["data"]["task_id"]
    quality = client.get("/api/data/quality/results?page=1&page_size=100").json()["data"]["items"]
    account_duplicate = next(item for item in quality if item["check_type"] == "重复数据" and item["target_table"] == "account_snapshot")
    sync_failure = next(item for item in quality if item["check_type"] == "同步失败")

    assert client.get(f"/api/tasks/{quality_task}").json()["data"]["status"] == "success"
    assert account_duplicate["status"] == "success"
    assert "当前账户 real_account_quality" in account_duplicate["message"]
    assert sync_failure["status"] == "success"
    assert "未被后续成功同步覆盖" in sync_failure["message"]


def test_cleanup_legacy_sync_cursors_archives_rows_and_restores_quality_check():
    client = TestClient(app)

    with get_connection() as connection:
        connection.executemany(
            """
            INSERT INTO sync_cursor(source_code, data_type, symbol, period, last_sync_time, updated_at)
            VALUES ('qmt', ?, ?, ?, ?, ?)
            """,
            [
                ("daily_kline", "600000.SH,000001.SZ", "", "2026-05-09", "2026-05-09 10:00:00"),
                ("minute_kline", "600000.SH,000001.SZ", "1m", "2026-05-09 10:00:00", "2026-05-09 10:00:00"),
                ("daily_kline", "600000.SH", "", "2026-05-09", "2026-05-09 10:00:00"),
            ],
        )
        connection.commit()

    response = client.post("/api/data/sync/cursors/legacy/cleanup")
    body = response.json()

    assert response.status_code == 200
    assert body["success"] is True
    assert body["data"]["cleaned_count"] == 2
    assert body["data"]["archived_count"] == 2
    assert "旧格式逗号拼接同步游标" in body["data"]["message"]
    assert "600000.SH,000001.SZ" in body["data"]["technical_detail"]

    with get_connection() as connection:
        legacy_count = connection.execute("SELECT COUNT(*) AS total FROM sync_cursor WHERE symbol LIKE '%,%'").fetchone()["total"]
        standard_count = connection.execute("SELECT COUNT(*) AS total FROM sync_cursor WHERE symbol='600000.SH'").fetchone()["total"]
        operation = connection.execute(
            """
            SELECT message, technical_detail
            FROM operation_log
            WHERE module='数据中心' AND action='清理旧同步游标'
            ORDER BY id DESC LIMIT 1
            """
        ).fetchone()

    assert legacy_count == 0
    assert standard_count == 1
    assert operation is not None
    assert "已清理 2 条" in operation["message"]
    assert "legacy_comma_joined_symbol_cursor_cleanup" in operation["technical_detail"]

    quality_task = client.post("/api/data/quality/check").json()["data"]["task_id"]
    quality = client.get("/api/data/quality/results?page=1&page_size=100").json()["data"]["items"]

    assert client.get(f"/api/tasks/{quality_task}").json()["data"]["status"] == "success"
    assert any(item["check_type"] == "同步游标格式" and item["target_table"] == "sync_cursor" and item["status"] == "success" for item in quality)


def test_quality_summary_marks_old_results_as_stale():
    client = TestClient(app)
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO data_quality_check(check_type, target_table, status, message, suggestion, created_at)
            VALUES ('数据为空', 'stock_basic', 'success', '旧检查结果', NULL, '2026-05-09 09:00:00')
            """
        )
        connection.execute(
            """
            INSERT INTO sync_task(task_id, sync_type, status, total_count, success_count, failed_count, started_at, finished_at)
            VALUES ('task_newer_than_quality', 'stock_basic', 'success', 1, 1, 0, '2026-05-10 09:00:00', '2026-05-10 09:01:00')
            """
        )
        connection.commit()

    summary = client.get("/api/data/quality/summary").json()["data"]

    assert summary["latest_check_time"] == "2026-05-09 09:00:00"
    assert summary["is_stale"] is True
    assert summary["stale_reason"]
