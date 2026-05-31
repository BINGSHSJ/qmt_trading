from fastapi.testclient import TestClient

from backend.adapters.mock_qmt_adapter import TestIsolationQmtDataAdapter
from backend.adapters.qmt.qmt_trade_adapter import TestIsolationTradeAdapter
from backend.main import app
from backend.tests.helpers import wait_for_task


BUY_STRATEGY = '''class Strategy:
    name = "阶段九护栏买入信号"
    version = "1.0.0"
    description = "用于阶段九测试护栏。"
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
            "reason": "阶段九测试护栏信号。",
        }]
'''


def assert_unified_response(body: dict[str, object]) -> None:
    assert {"success", "message", "data", "error", "trace_id"} <= body.keys()
    assert isinstance(body["success"], bool)
    assert isinstance(body["message"], str)
    assert body["trace_id"]


def assert_task_record(task: dict[str, object], task_id: str) -> None:
    assert task["task_id"] == task_id
    assert task["status"] in {"pending", "running", "success", "failed", "cancelled"}
    assert "progress" in task
    assert "message" in task


def test_stage9_health_and_unified_response_contract():
    client = TestClient(app)

    for endpoint in [
        "/api/health",
        "/api/dashboard/summary",
        "/api/data/stocks?page=1&page_size=20",
        "/api/strategies/files?page=1&page_size=20",
        "/api/system/logs?page=1&page_size=20",
    ]:
        response = client.get(endpoint)
        assert response.status_code == 200
        body = response.json()
        assert_unified_response(body)
        assert body["success"] is True

    health = client.get("/api/health").json()["data"]
    assert health["api_status"] == "ok"
    assert health["qmt"]["mode"] == "test_isolation"


def test_stage9_task_id_and_status_contract_for_long_tasks():
    client = TestClient(app)

    sync_response = client.post("/api/data/sync/all")
    env_response = client.post("/api/system/env/check")
    quality_response = client.post("/api/data/quality/check")

    for response in [sync_response, env_response, quality_response]:
        assert response.status_code == 200
        body = response.json()
        assert_unified_response(body)
        task_id = body["data"]["task_id"]
        assert str(task_id).startswith("task_")
        task_body = client.get(f"/api/tasks/{task_id}").json()
        assert_unified_response(task_body)
        assert_task_record(task_body["data"], task_id)


def test_stage9_test_isolation_adapters_never_require_real_qmt():
    data_adapter = TestIsolationQmtDataAdapter()
    trade_adapter = TestIsolationTradeAdapter()

    environment = data_adapter.check_environment()
    assert environment["mode"] == "test_isolation"
    assert environment["connected"] is True
    assert "不连接真实 QMT" in str(environment["message"])
    assert "测试隔离数据源" in str(environment["message"])
    assert "自动化测试、离线回归和开发排障" in str(environment["message"])
    assert "可演示数据与交易流程" not in str(environment["message"])
    assert data_adapter.get_account()["account_id"] == "test_isolation_account"
    assert len(data_adapter.get_stock_basic()) >= 1
    assert len(data_adapter.get_daily_kline(["600000.SH"], "2026-05-06", "2026-05-08")) >= 1

    submitted = trade_adapter.place_order(
        {
            "local_order_id": "order_stage9",
            "account_id": "test_isolation_account",
            "symbol": "600000.SH",
            "name": "浦发银行",
            "side": "BUY",
            "price": 9.12,
            "quantity": 100,
            "source": "test",
        }
    )
    assert submitted["test_isolation"] is True
    assert str(submitted["qmt_order_id"]).startswith("qmt_test_")


def test_stage9_strategy_validation_guardrail():
    client = TestClient(app)

    invalid_response = client.post(
        "/api/strategies/import",
        json={"file_name": "stage9_invalid_strategy.py", "code_content": "class Bad:\n    pass\n"},
    )
    assert invalid_response.status_code == 400
    invalid_body = invalid_response.json()
    assert_unified_response(invalid_body)
    assert invalid_body["success"] is False
    assert invalid_body["error"]["code"] == "STRATEGY_INTERFACE_INVALID"

    strategy = client.post(
        "/api/strategies/import",
        json={"file_name": "stage9_valid_strategy.py", "code_content": BUY_STRATEGY},
    ).json()["data"]
    validate_response = client.post(f"/api/strategies/files/{strategy['id']}/validate")
    assert validate_response.status_code == 200
    assert validate_response.json()["data"]["valid"] is True


def test_stage9_backtest_task_creation_guardrail():
    client = TestClient(app)

    client.post("/api/data/sync/all")
    strategy_id = client.post("/api/strategies/copy-example").json()["data"]["id"]
    response = client.post(
        "/api/backtests",
        json={
            "strategy_id": strategy_id,
            "backtest_name": "阶段九护栏回测",
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
    )

    assert response.status_code == 200
    body = response.json()
    assert_unified_response(body)
    task_id = body["data"]["task_id"]
    task = wait_for_task(client, task_id)
    assert_task_record(task, task_id)
    assert task["status"] == "success"


def test_stage9_trading_signal_order_is_idempotent():
    client = TestClient(app)

    client.post("/api/data/sync/all")
    strategy = client.post(
        "/api/strategies/import",
        json={"file_name": "stage9_buy_signal.py", "code_content": BUY_STRATEGY},
    ).json()["data"]
    run_task = client.post(f"/api/strategies/{strategy['id']}/run").json()["data"]["task_id"]
    assert client.get(f"/api/tasks/{run_task}").json()["data"]["status"] == "success"

    signal = client.get("/api/trading/signals?page=1&page_size=20").json()["data"]["items"][0]
    first = client.post(f"/api/trading/orders/from-signal/{signal['id']}", json={}).json()["data"]
    second = client.post(f"/api/trading/orders/from-signal/{signal['id']}", json={}).json()["data"]

    assert first["order"]["local_order_id"] == second["order"]["local_order_id"]
    assert second["duplicate"] is True

