import json
import subprocess
import sys
from pathlib import Path

from fastapi.testclient import TestClient

from backend.core.database import db_session
from backend.main import app
from backend.tests.helpers import wait_for_task


def test_stage14_required_indexes_exist():
    with db_session() as connection:
        indexes = {
            row["name"]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='index'"
            ).fetchall()
        }

    required = {
        "idx_daily_kline_symbol_date",
        "idx_minute_kline_symbol_period_datetime",
        "idx_minute_kline_period_trade_date_expr",
        "idx_minute_kline_symbol_period_trade_date_expr",
        "idx_strategy_signal_status_time",
        "idx_order_record_status_time",
        "idx_trade_record_symbol",
        "idx_runtime_task_type_status_created",
        "idx_operation_log_module_created",
        "idx_backtest_log_task_created",
        "idx_backtest_equity_task_date",
    }
    assert required.issubset(indexes)


def test_backtest_logs_are_paginated_and_page_size_is_capped():
    client = TestClient(app)

    client.post("/api/data/sync/all")
    strategy = client.post("/api/strategies/copy-example").json()["data"]
    task_id = client.post(
        "/api/backtests",
        json={
            "strategy_id": strategy["id"],
            "backtest_name": "阶段14分页检查",
            "start_date": "2026-05-06",
            "end_date": "2026-05-08",
            "initial_cash": 1000000,
            "single_order_amount": 100000,
            "data_frequency": "日K",
            "fill_mode": "下一日开盘",
            "fee_rate": 0.0003,
            "stamp_tax_rate": 0.001,
            "slippage": 0,
        },
    ).json()["data"]["task_id"]
    assert wait_for_task(client, task_id)["status"] == "success"

    logs_response = client.get(f"/api/backtests/{task_id}/logs?page=1&page_size=2")
    assert logs_response.status_code == 200
    logs = logs_response.json()["data"]
    assert set(logs) == {"items", "page", "page_size", "total", "has_more"}
    assert logs["page_size"] == 2
    assert len(logs["items"]) <= 2

    oversized = client.get(f"/api/backtests/{task_id}/logs?page=1&page_size=1000")
    assert oversized.status_code == 422


def test_performance_capacity_script_smoke_profile_runs():
    repo_root = Path(__file__).resolve().parents[2]
    script_path = repo_root / "scripts" / "performance" / "perf_capacity_check.py"
    completed = subprocess.run(
        [sys.executable, str(script_path), "--profile", "smoke"],
        check=True,
        capture_output=True,
        text=True,
        cwd=repo_root,
    )
    report = json.loads(completed.stdout)

    assert report["profile"] == "smoke"
    assert report["journal_mode"] == "wal"
    assert report["row_counts"]["stock_basic"] == 800
    assert report["row_counts"]["strategy_signal"] == 10_000
    assert report["index_count"] >= 20
    assert report["slow_queries"] == []
