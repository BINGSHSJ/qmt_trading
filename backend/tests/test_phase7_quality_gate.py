import time

from fastapi.testclient import TestClient

from backend.core.database import get_connection
from backend.main import app


def test_key_apis_use_unified_response_shape_and_dashboard_is_fast():
    client = TestClient(app)
    client.post("/api/data/sync/all")

    endpoints = [
        "/api/health",
        "/api/dashboard/summary",
        "/api/dashboard/tasks",
        "/api/dashboard/today-signals",
        "/api/dashboard/today-trades",
        "/api/data/stocks?page=1&page_size=20",
        "/api/strategies/files?page=1&page_size=20",
        "/api/backtests?page=1&page_size=20",
        "/api/trading/orders?page=1&page_size=20",
        "/api/system/monitor",
    ]
    start = time.perf_counter()
    for endpoint in endpoints:
        response = client.get(endpoint)
        body = response.json()
        assert response.status_code == 200
        assert {"success", "message", "data", "error", "trace_id"} <= body.keys()
        assert body["success"] is True
    elapsed = time.perf_counter() - start
    assert elapsed < 2.0


def test_sqlite_wal_and_required_indexes_exist():
    with get_connection() as connection:
        journal_mode = connection.execute("PRAGMA journal_mode").fetchone()[0]
        busy_timeout = connection.execute("PRAGMA busy_timeout").fetchone()[0]
        foreign_keys = connection.execute("PRAGMA foreign_keys").fetchone()[0]
        indexes = {
            row[1]
            for table in ["daily_kline", "minute_kline", "strategy_signal", "order_record", "trade_record", "runtime_task", "operation_log"]
            for row in connection.execute(f"PRAGMA index_list({table})").fetchall()
        }

    assert journal_mode.lower() == "wal"
    assert busy_timeout >= 5000
    assert foreign_keys == 1
    assert "idx_strategy_signal_status_time" in indexes
    assert "idx_order_record_status" in indexes
    assert "idx_trade_record_time" in indexes
    assert "idx_runtime_task_type_status_created" in indexes
    assert "idx_operation_log_module_created" in indexes


def test_list_apis_support_page_filter_and_safe_sort_contract():
    client = TestClient(app)
    client.post("/api/data/sync/all")

    stocks = client.get(
        "/api/data/stocks?page=1&page_size=1&keyword=银行&sort_field=symbol&sort_order=asc"
    ).json()["data"]
    assert stocks["page"] == 1
    assert stocks["page_size"] == 1
    assert stocks["total"] >= 1
    assert len(stocks["items"]) <= 1
    assert "银行" in stocks["items"][0]["name"]

    orders = client.get(
        "/api/data/orders?page=1&page_size=20&status=全部成交&start_date=2000-01-01&end_date=2999-12-31&sort_field=order_time&sort_order=desc"
    ).json()["data"]
    assert orders["page"] == 1
    assert orders["page_size"] == 20
    assert orders["total"] >= 1
    assert all(item["status"] == "全部成交" for item in orders["items"])

    fallback_sort = client.get(
        "/api/data/stocks?page=1&page_size=20&sort_field=id desc; drop table stock_basic&sort_order=asc"
    )
    assert fallback_sort.status_code == 200
    assert fallback_sort.json()["data"]["total"] >= 1
