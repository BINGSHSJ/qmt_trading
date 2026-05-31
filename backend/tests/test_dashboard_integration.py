from fastapi.testclient import TestClient

from backend.core.database import get_connection
from backend.main import app
from backend.repositories.system.system_repository import now_text
from backend.services.data_center import data_center_service as data_service_module
from backend.tests.helpers import wait_for_task


BUY_STRATEGY = '''class Strategy:
    name = "联调买入信号"
    version = "1.0.0"
    description = "用于阶段七主链路联调。"
    params = {}

    def __init__(self, context):
        self.context = context

    def run(self):
        return [{
            "symbol": "600000.SH",
            "name": "浦发银行",
            "action": "BUY",
            "price": 9.12,
            "amount": 10000,
            "reason": "阶段七联调信号。",
        }]
'''


def test_full_test_isolation_chain_and_dashboard_summary():
    client = TestClient(app)

    env_task = client.post("/api/system/env/check").json()["data"]["task_id"]
    sync_task = client.post("/api/data/sync/all").json()["data"]["task_id"]
    assert client.get(f"/api/tasks/{env_task}").json()["data"]["status"] == "success"
    assert client.get(f"/api/tasks/{sync_task}").json()["data"]["status"] == "success"

    strategy_id = client.post("/api/strategies/import", json={"file_name": "phase7_buy_signal.py", "code_content": BUY_STRATEGY}).json()["data"]["id"]
    run_task = client.post(f"/api/strategies/{strategy_id}/run").json()["data"]["task_id"]
    assert client.get(f"/api/tasks/{run_task}").json()["data"]["status"] == "success"

    backtest_task = client.post(
        "/api/backtests",
        json={
            "strategy_id": strategy_id,
            "backtest_name": "阶段七联调回测",
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
    assert wait_for_task(client, backtest_task)["status"] == "success"

    signal = client.get("/api/trading/signals?page=1&page_size=20").json()["data"]["items"][0]
    first_order = client.post(f"/api/trading/orders/from-signal/{signal['id']}", json={}).json()["data"]
    second_order = client.post(f"/api/trading/orders/from-signal/{signal['id']}", json={}).json()["data"]
    assert first_order["order"]["local_order_id"] == second_order["order"]["local_order_id"]
    assert second_order["duplicate"] is True

    order_sync = client.post("/api/trading/orders/sync").json()["data"]["task_id"]
    trade_sync = client.post("/api/trading/trades/sync").json()["data"]["task_id"]
    assert client.get(f"/api/tasks/{order_sync}").json()["data"]["status"] == "success"
    assert client.get(f"/api/tasks/{trade_sync}").json()["data"]["status"] == "success"

    summary = client.get("/api/dashboard/summary").json()["data"]
    bundle = client.get("/api/dashboard/bundle").json()["data"]

    assert summary["asset"]["has_account"] is True
    assert summary["qmt_mode"] == "test_isolation"
    assert summary["trading_mode"] == "测试隔离"
    assert summary["today_signal_count"] >= 1
    assert summary["today_order_count"] >= 1
    assert bundle["today_trades"]["trade_count"] >= 1
    assert len(bundle["tasks"]) >= 1


def test_dashboard_trading_mode_label_does_not_treat_unknown_as_real_readonly():
    from backend.schemas.dashboard import AssetOverview, DashboardSummary
    from backend.services.dashboard_service import DashboardService

    service = DashboardService()

    assert service._trading_mode_label("real") == "真实只读"
    assert service._trading_mode_label("test_isolation") == "测试隔离"
    assert service._trading_mode_label("unexpected") == "未检测"
    assert service._trading_mode_label(None) == "未检测"

    fallback_summary = DashboardSummary(
        asset=AssetOverview(
            total_asset=0,
            available_cash=0,
            market_value=0,
            today_pnl=0,
            position_count=0,
            has_account=False,
        ),
        running_task_count=0,
        failed_task_count=0,
        today_signal_count=0,
        today_order_count=0,
        today_trade_amount=0,
    )
    assert fallback_summary.qmt_mode == "unknown"
    assert fallback_summary.trading_mode == "未检测"


def test_dashboard_and_health_reflect_real_qmt_readonly_mode(monkeypatch):
    client = TestClient(app)

    class FakeRealQmtReadOnlyDataAdapter:
        def __init__(self, qmt_path: str, account_id: str) -> None:
            self.qmt_path = qmt_path
            self.account_id = account_id

        def get_account(self) -> dict[str, object]:
            return {
                "account_id": self.account_id,
                "total_asset": 100000,
                "available_cash": 50000,
                "frozen_cash": 0,
                "market_value": 50000,
                "today_pnl": 0,
            }

    monkeypatch.setattr(data_service_module, "RealQmtReadOnlyDataAdapter", FakeRealQmtReadOnlyDataAdapter)

    config = client.get("/api/system/config").json()["data"]
    config["qmt_path"] = "C:/QMT"
    config["account_id"] = "real_account"
    config["simulation_mode"] = False
    assert client.put("/api/system/config", json=config).status_code == 200
    assert client.post("/api/data/sources/qmt/connect").status_code == 200

    summary = client.get("/api/dashboard/summary").json()["data"]
    health = client.get("/api/health").json()["data"]

    assert summary["qmt_mode"] == "real"
    assert summary["qmt_connected"] is True
    assert summary["trading_mode"] == "真实只读"
    assert health["qmt"]["mode"] == "real"
    assert health["qmt"]["connected"] is True


def test_dashboard_real_account_asset_uses_configured_account_id():
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
                ("real_account", "871169.BJ", "辰光医疗", 229, 229, 21.7479, 19.25, 4408.25, -572.02, -11.49, "2026-05-10 09:12:05"),
            ],
        )

    summary = client.get("/api/dashboard/summary").json()["data"]
    bundle = client.get("/api/dashboard/bundle").json()["data"]

    assert summary["asset"]["has_account"] is True
    assert summary["asset"]["total_asset"] == 4408.25
    assert summary["asset"]["position_count"] == 1
    assert bundle["summary"]["asset"]["total_asset"] == 4408.25


def test_dashboard_test_isolation_ignores_configured_real_account_id():
    client = TestClient(app)
    today = now_text()[:10]

    config = client.get("/api/system/config").json()["data"]
    config["account_id"] = "real_account"
    config["simulation_mode"] = True
    assert client.put("/api/system/config", json=config).status_code == 200

    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO account_snapshot(account_id, total_asset, available_cash, frozen_cash, market_value, today_pnl, snapshot_time)
            VALUES ('test_isolation_account', 1111, 100, 0, 1011, 11, '2026-05-10 09:12:05')
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
                ("test_isolation_account", "600000.SH", "浦发银行", 100, 100, 9.0, 10.11, 1011, 111, 12.3, "2026-05-10 09:12:05"),
                ("real_account", "871169.BJ", "辰光医疗", 229, 229, 21.7479, 19.25, 4408.25, -572.02, -11.49, "2026-05-11 09:12:05"),
            ],
        )
        connection.execute(
            """
            INSERT INTO order_record(local_order_id, qmt_order_id, account_id, symbol, name, side, price, quantity, filled_quantity, status, source, order_time, updated_at)
            VALUES ('dashboard_test_iso_order', 'dashboard_test_iso_qmt', 'test_isolation_account', '600000.SH', '浦发银行', 'BUY', 9.12, 100, 100, '全部成交', 'test_sync', ?, ?)
            """,
            (f"{today} 09:13:00", f"{today} 09:13:00"),
        )
        connection.execute(
            """
            INSERT INTO order_record(local_order_id, qmt_order_id, account_id, symbol, name, side, price, quantity, filled_quantity, status, source, order_time, updated_at)
            VALUES ('dashboard_real_order', 'dashboard_real_qmt', 'real_account', '871169.BJ', '辰光医疗', 'BUY', 19.25, 229, 229, '全部成交', 'real_sync', ?, ?)
            """,
            (f"{today} 09:14:00", f"{today} 09:14:00"),
        )
        connection.execute(
            """
            INSERT INTO trade_record(trade_id, local_order_id, qmt_order_id, account_id, symbol, name, side, price, quantity, amount, fee, source, trade_time)
            VALUES ('dashboard_test_iso_trade', 'dashboard_test_iso_order', 'dashboard_test_iso_qmt', 'test_isolation_account', '600000.SH', '浦发银行', 'BUY', 9.12, 100, 912, 1, 'test_sync', ?)
            """,
            (f"{today} 09:13:01",),
        )
        connection.execute(
            """
            INSERT INTO trade_record(trade_id, local_order_id, qmt_order_id, account_id, symbol, name, side, price, quantity, amount, fee, source, trade_time)
            VALUES ('dashboard_real_trade', 'dashboard_real_order', 'dashboard_real_qmt', 'real_account', '871169.BJ', '辰光医疗', 'BUY', 19.25, 229, 4408.25, 1, 'real_sync', ?)
            """,
            (f"{today} 09:14:01",),
        )
        connection.commit()

    summary = client.get("/api/dashboard/summary").json()["data"]
    bundle = client.get("/api/dashboard/bundle").json()["data"]

    assert summary["qmt_mode"] == "test_isolation"
    assert summary["trading_mode"] == "测试隔离"
    assert summary["asset"]["total_asset"] == 1111
    assert summary["asset"]["position_count"] == 1
    assert summary["today_order_count"] == 1
    assert bundle["latest_orders"][0]["account_id"] == "test_isolation_account"
    assert bundle["latest_trades"][0]["account_id"] == "test_isolation_account"
    assert bundle["today_trades"]["trade_count"] == 1
    assert bundle["today_trades"]["trade_amount"] == 912


def test_dashboard_asset_total_is_derived_from_cash_and_position_snapshot():
    client = TestClient(app)

    config = client.get("/api/system/config").json()["data"]
    config["account_id"] = "real_account"
    config["simulation_mode"] = False
    assert client.put("/api/system/config", json=config).status_code == 200

    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO account_snapshot(account_id, total_asset, available_cash, frozen_cash, market_value, today_pnl, snapshot_time)
            VALUES ('real_account', 5267, 0, 0, 5381.5, 0, '2026-05-19 09:31:53')
            """
        )
        connection.execute(
            """
            INSERT INTO position_snapshot(account_id, symbol, name, quantity, available_quantity, cost_price, last_price, market_value, pnl, pnl_ratio, snapshot_time)
            VALUES ('real_account', '871169.BJ', '辰光医疗', 229, 229, 21.7479, 23.50, 5381.5, 0, 0, '2026-05-19 09:31:53')
            """
        )

    summary = client.get("/api/dashboard/summary").json()["data"]
    latest_account = client.get("/api/data/account/latest").json()["data"]

    assert summary["asset"]["total_asset"] == 5381.5
    assert summary["asset"]["market_value"] == 5381.5
    assert summary["asset"]["snapshot_time"] == "2026-05-19 09:31:53"
    assert latest_account["total_asset"] == 5381.5


def test_dashboard_asset_uses_nearby_position_snapshot_when_sync_seconds_differ():
    client = TestClient(app)

    config = client.get("/api/system/config").json()["data"]
    config["account_id"] = "real_account"
    config["simulation_mode"] = False
    assert client.put("/api/system/config", json=config).status_code == 200

    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO account_snapshot(account_id, total_asset, available_cash, frozen_cash, market_value, today_pnl, snapshot_time)
            VALUES ('real_account', 5267, 0, 0, 5381.5, 0, '2026-05-19 09:31:53')
            """
        )
        connection.execute(
            """
            INSERT INTO position_snapshot(account_id, symbol, name, quantity, available_quantity, cost_price, last_price, market_value, pnl, pnl_ratio, snapshot_time)
            VALUES ('real_account', '871169.BJ', '辰光医疗', 229, 229, 21.7479, 23.50, 5381.5, 0, 0, '2026-05-19 09:31:54')
            """
        )

    summary = client.get("/api/dashboard/summary").json()["data"]

    assert summary["asset"]["position_count"] == 1
    assert summary["asset"]["market_value"] == 5381.5
    assert summary["asset"]["total_asset"] == 5381.5
    assert summary["asset"]["snapshot_time"] == "2026-05-19 09:31:53"


def test_dashboard_and_monitor_use_today_and_historical_failed_task_counts():
    client = TestClient(app)
    today = now_text()[:10]
    with get_connection() as connection:
        connection.executemany(
            """
            INSERT INTO runtime_task(task_id, task_type, status, progress, message, started_at, finished_at, created_at)
            VALUES (?, 'sync_daily_kline', 'failed', 100, '测试失败', ?, ?, ?)
            """,
            [
                ("task_failed_today", f"{today} 09:00:00", f"{today} 09:01:00", f"{today} 09:00:00"),
                ("task_failed_history", "2026-05-01 09:00:00", "2026-05-01 09:01:00", "2026-05-01 09:00:00"),
            ],
        )
        connection.commit()

    summary = client.get("/api/dashboard/summary").json()["data"]
    monitor = client.get("/api/system/monitor").json()["data"]

    assert summary["failed_task_count"] == 1
    assert summary["historical_failed_task_count"] == 1
    assert monitor["failed_task_count"] == 1
    assert monitor["historical_failed_task_count"] == 1


def test_dashboard_signal_metric_counts_all_today_signals_not_only_preview_rows():
    client = TestClient(app)
    today = now_text()[:10]
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO strategy_file(file_name, file_path, strategy_name, version, description, status, created_at)
            VALUES ('dashboard_signal_count.py', 'strategies/user/dashboard_signal_count.py', '看板信号计数策略', '1.0.0', '测试总览计数', 'enabled', ?)
            """,
            (f"{today} 09:00:00",),
        )
        strategy_id = connection.execute("SELECT id FROM strategy_file WHERE file_name='dashboard_signal_count.py'").fetchone()["id"]
        rows = [
            (
                strategy_id,
                f"run_{index}",
                "600000.SH",
                "浦发银行",
                "BUY",
                9.1 + index * 0.01,
                10000,
                f"第 {index} 条信号",
                "未处理",
                f"{today} 09:{index:02d}:00",
                f"{today} 09:{index:02d}:01",
            )
            for index in range(12)
        ]
        connection.executemany(
            """
            INSERT INTO strategy_signal(
                strategy_id, run_id, symbol, name, action, price, amount, reason, status, signal_time, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
        connection.commit()

    summary = client.get("/api/dashboard/summary").json()["data"]
    bundle = client.get("/api/dashboard/bundle").json()["data"]

    assert summary["today_signal_count"] == 12
    assert bundle["summary"]["today_signal_count"] == 12
    assert len(bundle["today_signals"]) == 10

