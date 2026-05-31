from fastapi.testclient import TestClient

from backend.main import app
from backend.schemas.backtest import BacktestCreateRequest
from backend.schemas.common import PageQuery
from backend.services.backtest_center.backtest_service import BacktestService
from backend.services.data_center.data_center_service import DataCenterService
from backend.services.strategy_dev.strategy_service import StrategyService
from backend.services.system.system_service import SystemService


BUY_STRATEGY = '''class Strategy:
    name = "取消护栏买入信号"
    version = "1.0.0"
    description = "用于任务取消护栏。"
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
            "reason": "取消护栏测试信号。",
        }]
'''


def test_cancelled_data_sync_does_not_write_success_results():
    data_service = DataCenterService()
    system_service = SystemService()
    task = data_service.create_sync_task("all")

    cancelled = system_service.cancel_task(task.task_id)
    data_service.run_sync_task(task.task_id, "all")

    assert cancelled.status == "cancelled"
    assert system_service.get_task(task.task_id).status == "cancelled"
    assert data_service.latest_account() is None
    assert data_service.list_sync_tasks()[0].status == "cancelled"


def test_cancelled_strategy_run_does_not_create_signals():
    client = TestClient(app)
    client.post("/api/data/sync/all")
    strategy = client.post(
        "/api/strategies/import",
        json={"file_name": "cancelled_strategy.py", "code_content": BUY_STRATEGY},
    ).json()["data"]
    strategy_service = StrategyService()
    system_service = SystemService()
    task = strategy_service.create_run_task(strategy["id"])

    system_service.cancel_task(task.task_id)
    strategy_service.run_strategy_task(strategy["id"], task.task_id)

    assert system_service.get_task(task.task_id).status == "cancelled"
    runs = strategy_service.list_runs(PageQuery(page=1, page_size=20)).items
    run = next(item for item in runs if item.task_id == task.task_id)
    assert run.status == "cancelled"
    assert strategy_service.list_signals(PageQuery(page=1, page_size=20)).total == 0


def test_cancelled_backtest_does_not_write_result_tables():
    client = TestClient(app)
    client.post("/api/data/sync/all")
    strategy_id = client.post("/api/strategies/copy-example").json()["data"]["id"]
    backtest_service = BacktestService()
    system_service = SystemService()
    task = backtest_service.create_backtest(
        BacktestCreateRequest(
            strategy_id=strategy_id,
            backtest_name="取消护栏回测",
            start_date="2026-05-06",
            end_date="2026-05-08",
            initial_cash=1000000,
            single_order_amount=100000,
            data_frequency="日K",
            fill_mode="下一日开盘",
            fee_rate=0.0003,
            stamp_tax_rate=0.001,
            slippage=0,
        )
    )

    system_service.cancel_task(task.task_id)
    backtest_service.run_backtest_task(task.task_id)

    assert system_service.get_task(task.task_id).status == "cancelled"
    assert backtest_service.get_task(task.task_id).status == "cancelled"
    assert backtest_service.result(task.task_id) is None
    assert backtest_service.trades(task.task_id, PageQuery(page=1, page_size=20)).total == 0
