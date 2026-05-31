from fastapi.testclient import TestClient

from backend.adapters.qmt.order_status_mapper import map_order_status
from backend.adapters.qmt.qmt_trade_adapter import DisabledRealTradingAdapter, TestIsolationTradeAdapter
from backend.core.database import db_session
from backend.main import app
from backend.services.trading_center.trading_service import TradingService


BUY_STRATEGY = '''class Strategy:
    name = "单测买入信号"
    version = "1.0.0"
    description = "用于阶段六信号下单测试。"
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
            "reason": "阶段六单测买入信号。",
        }]
'''


def test_manual_order_cancel_and_logs_flow():
    client = TestClient(app)

    client.post("/api/data/sync/all")
    response = client.post(
        "/api/trading/orders/manual",
        json={"symbol": "600000.SH", "name": "浦发银行", "side": "BUY", "price": 9.12, "quantity": 100},
    )

    assert response.status_code == 200
    order = response.json()["data"]["order"]
    assert order["local_order_id"].startswith("order_")
    assert order["qmt_order_id"].startswith("qmt_test_")
    assert order["status"] == "已报"

    cancel_response = client.post(f"/api/trading/orders/{order['local_order_id']}/cancel")
    assert cancel_response.status_code == 200
    assert cancel_response.json()["data"]["status"] == "已撤"

    orders = client.get("/api/trading/orders?page=1&page_size=20").json()["data"]
    logs = client.get("/api/trading/logs?page=1&page_size=20").json()["data"]
    positions = client.get("/api/trading/positions?page=1&page_size=20").json()["data"]

    assert orders["total"] >= 1
    assert logs["total"] >= 1
    assert positions["total"] >= 1


def test_manual_order_idempotency_blocks_fast_duplicate_but_not_terminal_order():
    client = TestClient(app)

    client.post("/api/data/sync/all")
    payload = {"symbol": "600000.SH", "name": "浦发银行", "side": "BUY", "price": 9.12, "quantity": 100}
    first = client.post("/api/trading/orders/manual", json=payload).json()["data"]
    second = client.post("/api/trading/orders/manual", json=payload).json()["data"]

    assert second["duplicate"] is True
    assert second["order"]["local_order_id"] == first["order"]["local_order_id"]

    order_sync = client.post("/api/trading/orders/sync").json()["data"]["task_id"]
    trade_sync = client.post("/api/trading/trades/sync").json()["data"]["task_id"]
    assert client.get(f"/api/tasks/{order_sync}").json()["data"]["status"] == "success"
    assert client.get(f"/api/tasks/{trade_sync}").json()["data"]["status"] == "success"

    third = client.post("/api/trading/orders/manual", json=payload).json()["data"]
    assert third["duplicate"] is False
    assert third["order"]["local_order_id"] != first["order"]["local_order_id"]


def test_manual_order_normalizes_symbol_and_side_before_submit():
    client = TestClient(app)

    client.post("/api/data/sync/all")
    response = client.post(
        "/api/trading/orders/manual",
        json={"symbol": "600000.sh", "name": "浦发银行", "side": "buy", "price": 9.12, "quantity": 100},
    )

    assert response.status_code == 200
    order = response.json()["data"]["order"]
    assert order["symbol"] == "600000.SH"
    assert order["side"] == "BUY"


def test_manual_order_rejects_non_standard_symbol_format():
    client = TestClient(app)

    client.post("/api/data/sync/all")
    response = client.post(
        "/api/trading/orders/manual",
        json={"symbol": "ABC.SH", "name": "非法代码", "side": "BUY", "price": 9.12, "quantity": 100},
    )

    assert response.status_code == 400
    assert response.json()["message"] == "股票代码格式不正确。"


def test_signal_order_is_idempotent_and_syncs_trades():
    client = TestClient(app)

    client.post("/api/data/sync/all")
    strategy = client.post("/api/strategies/import", json={"file_name": "phase6_buy_signal.py", "code_content": BUY_STRATEGY}).json()["data"]
    run_task = client.post(f"/api/strategies/{strategy['id']}/run").json()["data"]["task_id"]
    assert client.get(f"/api/tasks/{run_task}").json()["data"]["status"] == "success"

    signal = client.get("/api/trading/signals?page=1&page_size=20").json()["data"]["items"][0]
    first = client.post(f"/api/trading/orders/from-signal/{signal['id']}", json={})
    second = client.post(f"/api/trading/orders/from-signal/{signal['id']}", json={})

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["data"]["order"]["local_order_id"] == second.json()["data"]["order"]["local_order_id"]
    assert second.json()["data"]["duplicate"] is True

    order_sync = client.post("/api/trading/orders/sync").json()["data"]["task_id"]
    trade_sync = client.post("/api/trading/trades/sync").json()["data"]["task_id"]
    assert client.get(f"/api/tasks/{order_sync}").json()["data"]["status"] == "success"
    assert client.get(f"/api/tasks/{trade_sync}").json()["data"]["status"] == "success"
    first_trade_total = client.get("/api/trading/trades?page=1&page_size=20").json()["data"]["total"]
    second_trade_sync = client.post("/api/trading/trades/sync").json()["data"]["task_id"]
    assert client.get(f"/api/tasks/{second_trade_sync}").json()["data"]["status"] == "success"
    assert client.get("/api/trading/trades?page=1&page_size=20").json()["data"]["total"] == first_trade_total


def test_order_status_mapper_covers_trade_lifecycle_statuses():
    assert map_order_status(None) == "待同步"
    assert map_order_status("pending") == "待提交"
    assert map_order_status("submitted") == "已提交"
    assert map_order_status("accepted") == "已报"
    assert map_order_status("partial_filled") == "部分成交"
    assert map_order_status("filled") == "全部成交"
    assert map_order_status("cancelled") == "已撤"
    assert map_order_status("rejected") == "废单"
    assert map_order_status("failed") == "失败"
    assert map_order_status("unknown") == "待同步"
    assert map_order_status("not_a_qmt_status") == "待同步"


def test_test_isolation_trade_adapter_never_returns_unknown_order_status():
    adapter = TestIsolationTradeAdapter()

    unknown_result = adapter.sync_order_status({"status": "未知", "qmt_status": None})
    unexpected_result = adapter.sync_order_status({"status": "not_a_qmt_status", "qmt_status": None})
    terminal_result = adapter.sync_order_status({"status": "已撤", "qmt_status": None})
    empty_result = adapter.sync_order_status({"status": "", "qmt_status": None})

    assert unknown_result["status"] == "待同步"
    assert unexpected_result["status"] == "待同步"
    assert terminal_result["status"] == "已撤"
    assert empty_result["qmt_status"] == "待同步"
    assert empty_result["status"] == "待同步"


def test_signal_order_records_source_strategy_signal_and_status_consistently():
    client = TestClient(app)

    client.post("/api/data/sync/all")
    strategy = client.post("/api/strategies/import", json={"file_name": "phase13_signal_order.py", "code_content": BUY_STRATEGY}).json()["data"]
    run_task = client.post(f"/api/strategies/{strategy['id']}/run").json()["data"]["task_id"]
    assert client.get(f"/api/tasks/{run_task}").json()["data"]["status"] == "success"

    signal = client.get("/api/trading/signals?page=1&page_size=20").json()["data"]["items"][0]
    result = client.post(f"/api/trading/orders/from-signal/{signal['id']}", json={}).json()["data"]
    order = result["order"]

    assert order["local_order_id"].startswith("order_")
    assert order["qmt_order_id"].startswith("qmt_test_")
    assert order["source"] == "signal"
    assert order["signal_id"] == str(signal["id"])
    assert order["strategy_id"] == str(strategy["id"])
    assert order["strategy_name"] == strategy["strategy_name"]
    assert order["idempotency_key"]

    signal_after = client.get(f"/api/strategies/signals/{signal['id']}").json()["data"]
    assert signal_after["status"] == "已下单"
    assert signal_after["order_id"] == order["local_order_id"]
    with db_session() as connection:
        signal_order = connection.execute(
            "SELECT * FROM signal_order WHERE signal_id=?",
            (signal["id"],),
        ).fetchone()
    assert signal_order["local_order_id"] == order["local_order_id"]
    assert signal_order["status"] == "已下单"


def test_trade_sync_updates_order_position_and_account_snapshot():
    client = TestClient(app)

    client.post("/api/data/sync/all")
    before_account = client.get("/api/data/account/latest").json()["data"]
    before_position = client.get("/api/trading/positions?keyword=000001.SZ&page=1&page_size=20").json()["data"]["items"][0]
    order = client.post(
        "/api/trading/orders/manual",
        json={"symbol": "000001.SZ", "name": "平安银行", "side": "BUY", "price": 11.08, "quantity": 100},
    ).json()["data"]["order"]

    order_sync = client.post("/api/trading/orders/sync").json()["data"]["task_id"]
    assert client.get(f"/api/tasks/{order_sync}").json()["data"]["status"] == "success"
    trade_sync = client.post("/api/trading/trades/sync").json()["data"]["task_id"]
    assert client.get(f"/api/tasks/{trade_sync}").json()["data"]["status"] == "success"

    updated_order = client.get(f"/api/trading/orders?keyword={order['local_order_id']}&page=1&page_size=20").json()["data"]["items"][0]
    after_account = client.get("/api/data/account/latest").json()["data"]
    after_position = client.get("/api/trading/positions?keyword=000001.SZ&page=1&page_size=20").json()["data"]["items"][0]

    assert updated_order["status"] == "全部成交"
    assert updated_order["filled_quantity"] == 100
    assert after_position["quantity"] == before_position["quantity"] + 100
    assert after_account["available_cash"] < before_account["available_cash"]


def test_cancel_updates_signal_order_status_without_allowing_duplicate_signal_order():
    client = TestClient(app)

    client.post("/api/data/sync/all")
    strategy = client.post("/api/strategies/import", json={"file_name": "phase13_cancel_signal.py", "code_content": BUY_STRATEGY}).json()["data"]
    run_task = client.post(f"/api/strategies/{strategy['id']}/run").json()["data"]["task_id"]
    assert client.get(f"/api/tasks/{run_task}").json()["data"]["status"] == "success"
    signal = client.get("/api/trading/signals?page=1&page_size=20").json()["data"]["items"][0]
    order = client.post(f"/api/trading/orders/from-signal/{signal['id']}", json={}).json()["data"]["order"]

    cancel_response = client.post(f"/api/trading/orders/{order['local_order_id']}/cancel")
    assert cancel_response.status_code == 200
    retry_response = client.post(f"/api/trading/orders/from-signal/{signal['id']}", json={})

    assert retry_response.status_code == 400
    assert retry_response.json()["error"]["code"] == "ORDER_DUPLICATED"
    with db_session() as connection:
        signal_order_count = connection.execute(
            "SELECT COUNT(*) AS total FROM signal_order WHERE signal_id=?",
            (signal["id"],),
        ).fetchone()["total"]
        signal_order = connection.execute(
            "SELECT * FROM signal_order WHERE signal_id=?",
            (signal["id"],),
        ).fetchone()
    assert signal_order_count == 1
    assert signal_order["status"] == "已撤"


def test_missing_order_returns_chinese_business_error():
    client = TestClient(app)

    response = client.post("/api/trading/orders/no_such_order/cancel")

    assert response.status_code == 404
    body = response.json()
    assert body["message"] == "委托订单不存在。"
    assert body["error"]["code"] == "ORDER_NOT_FOUND"


def test_real_readonly_filters_test_isolation_trading_data_and_blocks_test_sync():
    client = TestClient(app)

    client.post("/api/data/sync/all")
    config = client.get("/api/system/config").json()["data"]
    config["account_id"] = "real_account"
    config["simulation_mode"] = False
    assert client.put("/api/system/config", json=config).status_code == 200

    with db_session() as connection:
        connection.execute(
            """
            INSERT INTO account_snapshot(account_id, total_asset, available_cash, frozen_cash, market_value, today_pnl, snapshot_time)
            VALUES ('real_account', 1000, 100, 0, 900, 0, '2026-05-09 10:00:00')
            """
        )
        connection.execute(
            """
            INSERT INTO position_snapshot(account_id, symbol, name, quantity, available_quantity, cost_price, last_price, market_value, pnl, pnl_ratio, snapshot_time)
            VALUES ('real_account', '688001.SH', '真实持仓', 100, 100, 9, 9, 900, 0, 0, '2026-05-09 10:00:00')
            """
        )
        connection.execute(
            """
            INSERT INTO order_record(local_order_id, qmt_order_id, account_id, symbol, name, side, price, quantity, filled_quantity, status, qmt_status, source, order_time, updated_at)
            VALUES ('real_order_001', 'real_qmt_001', 'real_account', '688001.SH', '真实持仓', 'BUY', 9, 100, 0, '已报', 'submitted', 'real_sync', '2026-05-09 10:00:00', '2026-05-09 10:00:00')
            """
        )
        connection.execute(
            """
            INSERT INTO trade_record(trade_id, local_order_id, qmt_order_id, account_id, symbol, name, side, price, quantity, amount, fee, source, trade_time)
            VALUES ('real_trade_001', 'real_order_001', 'real_qmt_001', 'real_account', '688001.SH', '真实持仓', 'BUY', 9, 100, 900, 0, 'real_sync', '2026-05-09 10:00:00')
            """
        )
        connection.execute(
            """
            INSERT INTO execution_log(local_order_id, level, message, technical_detail, created_at)
            VALUES ('real_order_001', 'info', '真实只读同步日志。', 'real_qmt_readonly=true', '2026-05-09 10:00:00')
            """
        )
        connection.execute(
            """
            INSERT INTO execution_log(local_order_id, level, message, technical_detail, created_at)
            VALUES ('test_isolation_order_001', 'info', '测试隔离日志。', 'test_isolation=true; real_qmt_order=false', '2026-05-09 10:00:00')
            """
        )

    positions = client.get("/api/trading/positions?page=1&page_size=20").json()["data"]
    orders = client.get("/api/trading/orders?page=1&page_size=20").json()["data"]
    trades = client.get("/api/trading/trades?page=1&page_size=20").json()["data"]
    logs = client.get("/api/trading/logs?page=1&page_size=20").json()["data"]

    assert positions["total"] == 1
    assert positions["items"][0]["account_id"] == "real_account"
    assert orders["total"] == 1
    assert orders["items"][0]["local_order_id"] == "real_order_001"
    assert trades["total"] == 1
    assert trades["items"][0]["trade_id"] == "real_trade_001"
    assert logs["total"] == 1
    assert logs["items"][0]["local_order_id"] == "real_order_001"

    order_sync = client.post("/api/trading/orders/sync")
    trade_sync = client.post("/api/trading/trades/sync")
    manual_order = client.post(
        "/api/trading/orders/manual",
        json={"symbol": "688001.SH", "name": "真实持仓", "side": "BUY", "price": 9, "quantity": 100},
    )

    assert order_sync.status_code == 400
    assert order_sync.json()["error"]["code"] == "REAL_TRADING_SYNC_DISABLED"
    assert trade_sync.status_code == 400
    assert trade_sync.json()["error"]["code"] == "REAL_TRADING_SYNC_DISABLED"
    assert manual_order.status_code == 400
    assert manual_order.json()["error"]["code"] == "REAL_TRADING_NOT_ENABLED"


def test_real_readonly_trading_service_uses_disabled_adapter_and_creates_no_order():
    client = TestClient(app)

    config = client.get("/api/system/config").json()["data"]
    config["account_id"] = "real_account_guard"
    config["simulation_mode"] = False
    assert client.put("/api/system/config", json=config).status_code == 200

    service = TradingService()
    assert isinstance(service.adapter, DisabledRealTradingAdapter)

    before = client.get("/api/trading/orders?page=1&page_size=20").json()["data"]["total"]
    response = client.post(
        "/api/trading/orders/manual",
        json={"symbol": "600000.SH", "name": "浦发银行", "side": "BUY", "price": 10, "quantity": 100},
    )
    after = client.get("/api/trading/orders?page=1&page_size=20").json()["data"]["total"]

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "REAL_TRADING_NOT_ENABLED"
    assert "real_order_submitted=false" in response.json()["error"]["detail"]
    assert after == before


def test_test_isolation_mode_keeps_real_qmt_snapshots_out_of_trading_workspace():
    client = TestClient(app)

    client.post("/api/data/sync/all")
    with db_session() as connection:
        connection.execute(
            """
            INSERT INTO account_snapshot(account_id, total_asset, available_cash, frozen_cash, market_value, today_pnl, snapshot_time)
            VALUES ('real_account', 1000, 100, 0, 900, 0, '2026-05-09 23:00:00')
            """
        )
        connection.execute(
            """
            INSERT INTO position_snapshot(account_id, symbol, name, quantity, available_quantity, cost_price, last_price, market_value, pnl, pnl_ratio, snapshot_time)
            VALUES ('real_account', '871169.BJ', '真实持仓', 229, 229, 21.7479, 19.25, 4408.25, -572.02, -11.49, '2026-05-09 23:00:00')
            """
        )
        connection.execute(
            """
            INSERT INTO order_record(local_order_id, qmt_order_id, account_id, symbol, name, side, price, quantity, filled_quantity, status, qmt_status, source, order_time, updated_at)
            VALUES ('real_order_late', 'real_qmt_late', 'real_account', '871169.BJ', '真实持仓', 'BUY', 19.25, 100, 0, '已报', 'submitted', 'real_sync', '2026-05-09 23:00:00', '2026-05-09 23:00:00')
            """
        )
        connection.execute(
            """
            INSERT INTO trade_record(trade_id, local_order_id, qmt_order_id, account_id, symbol, name, side, price, quantity, amount, fee, source, trade_time)
            VALUES ('real_trade_late', 'real_order_late', 'real_qmt_late', 'real_account', '871169.BJ', '真实持仓', 'BUY', 19.25, 100, 1925, 0, 'real_sync', '2026-05-09 23:00:00')
            """
        )

    positions = client.get("/api/trading/positions?page=1&page_size=20").json()["data"]
    orders = client.get("/api/trading/orders?page=1&page_size=20").json()["data"]
    trades = client.get("/api/trading/trades?page=1&page_size=20").json()["data"]
    order = client.post(
        "/api/trading/orders/manual",
        json={"symbol": "600000.SH", "name": "浦发银行", "side": "BUY", "price": 9.12, "quantity": 100},
    ).json()["data"]["order"]

    assert positions["total"] >= 1
    assert {item["account_id"] for item in positions["items"]} == {"test_isolation_account"}
    assert orders["total"] >= 1
    assert {item["account_id"] for item in orders["items"]} == {"test_isolation_account"}
    assert trades["total"] >= 1
    assert {item["account_id"] for item in trades["items"]} == {"test_isolation_account"}
    assert order["account_id"] == "test_isolation_account"


def test_test_isolation_sync_does_not_touch_real_synced_orders_or_create_real_trades():
    client = TestClient(app)

    client.post("/api/data/sync/all")
    with db_session() as connection:
        connection.execute(
            """
            INSERT INTO order_record(local_order_id, qmt_order_id, account_id, symbol, name, side, price, quantity, filled_quantity, status, qmt_status, source, order_time, updated_at)
            VALUES ('real_sync_order_guard', 'real_qmt_guard', 'real_account', '871169.BJ', '真实持仓', 'BUY', 19.25, 100, 0, '已报', 'accepted', 'real_sync', '2026-05-09 23:10:00', '2026-05-09 23:10:00')
            """
        )

    test_isolation_order = client.post(
        "/api/trading/orders/manual",
        json={"symbol": "600000.SH", "name": "浦发银行", "side": "BUY", "price": 9.12, "quantity": 100},
    ).json()["data"]["order"]
    order_sync = client.post("/api/trading/orders/sync").json()["data"]["task_id"]
    trade_sync = client.post("/api/trading/trades/sync").json()["data"]["task_id"]
    assert client.get(f"/api/tasks/{order_sync}").json()["data"]["status"] == "success"
    assert client.get(f"/api/tasks/{trade_sync}").json()["data"]["status"] == "success"

    with db_session() as connection:
        real_order = connection.execute(
            "SELECT status, filled_quantity FROM order_record WHERE local_order_id='real_sync_order_guard'",
        ).fetchone()
        real_trade_count = connection.execute(
            "SELECT COUNT(*) AS total FROM trade_record WHERE local_order_id='real_sync_order_guard'",
        ).fetchone()["total"]
        test_isolation_trade_count = connection.execute(
            "SELECT COUNT(*) AS total FROM trade_record WHERE local_order_id=?",
            (test_isolation_order["local_order_id"],),
        ).fetchone()["total"]

    assert real_order["status"] == "已报"
    assert real_order["filled_quantity"] == 0
    assert real_trade_count == 0
    assert test_isolation_trade_count == 1

