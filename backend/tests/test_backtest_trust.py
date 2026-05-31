from fastapi.testclient import TestClient
import pytest

from backend.main import app
from backend.tests.helpers import wait_for_task
from backend.schemas.backtest import BacktestTaskRecord
from backend.services.backtest_center.backtest_engine import BacktestBroker, MarketBar, MatchingEngine, StrategyRunner
from backend.services.strategy_dev.sandbox_runner import StrategyExecutionCancelled


NO_FUTURE_STRATEGY = '''class Strategy:
    name = "未来函数检查策略"
    version = "1.0.0"
    description = "验证回测上下文不会暴露未来K线。"
    params = {}

    def __init__(self, context):
        self.context = context

    def run(self):
        today = self.context.current_date
        bars = self.context.get_daily_bars("600000.SH", "2026-05-01", "2026-05-31")
        if any(bar["trade_date"] > today for bar in bars):
            raise RuntimeError("发现未来K线")
        if today == "2026-05-06" and bars:
            return [{
                "symbol": "600000.SH",
                "name": "浦发银行",
                "action": "BUY",
                "price": bars[-1]["close"],
                "amount": 100000,
                "reason": "未来函数检查买入",
            }]
        return []
'''


BUY_SELL_STRATEGY = '''class Strategy:
    name = "资金一致性策略"
    version = "1.0.0"
    description = "先买后卖，用于验证交易明细和权益曲线一致。"
    params = {}

    def __init__(self, context):
        self.context = context

    def run(self):
        today = self.context.current_date
        if today == "2026-05-06":
            return [{"symbol": "600000.SH", "name": "浦发银行", "action": "BUY", "price": 9.0, "amount": 100000, "reason": "买入测试"}]
        if today == "2026-05-07":
            return [{"symbol": "600000.SH", "name": "浦发银行", "action": "SELL", "price": 9.1, "amount": 100000, "reason": "卖出测试"}]
        return []
'''


DATABASE_IMPORT_STRATEGY = '''import sqlite3

class Strategy:
    name = "非法数据库访问策略"
    version = "1.0.0"
    description = "验证回测中不能直接访问 SQLite。"
    params = {}

    def __init__(self, context):
        self.context = context

    def run(self):
        return []
'''


DUNDER_GETATTR_STRATEGY = '''class Strategy:
    name = "非法反射访问策略"
    version = "1.0.0"
    description = "验证 getattr 不能访问沙箱对象的双下划线属性。"
    params = {}

    def __init__(self, context):
        self.context = context

    def run(self):
        getattr(self.context, "__class__")
        return []
'''


BAD_SIGNAL_STRATEGY = '''class Strategy:
    name = "非法信号策略"
    version = "1.0.0"
    description = "验证回测信号格式校验。"
    params = {}

    def __init__(self, context):
        self.context = context

    def run(self):
        if self.context.current_date == "2026-05-06":
            return [{"symbol": "600000", "action": "BUY", "price": -1, "amount": 100000, "reason": "非法信号"}]
        return []
'''


OUT_OF_RANGE_SIGNAL_STRATEGY = '''class Strategy:
    name = "区间外信号策略"
    version = "1.0.0"
    description = "验证策略不能返回回测区间外信号。"
    params = {}

    def __init__(self, context):
        self.context = context

    def run(self):
        if self.context.current_date == "2026-05-06":
            return [{
                "symbol": "600000.SH",
                "name": "浦发银行",
                "action": "BUY",
                "price": 10.0,
                "amount": 100000,
                "reason": "故意返回区间外信号",
                "signal_time": "2026-05-01 15:00:00",
            }]
        return []
'''


def test_backtest_strategy_context_does_not_expose_future_bars():
    client = TestClient(app)
    client.post("/api/data/sync/all")
    strategy_id = client.post(
        "/api/strategies/import",
        json={"file_name": "stage12_no_future.py", "code_content": NO_FUTURE_STRATEGY},
    ).json()["data"]["id"]

    response = client.post(
        "/api/backtests",
        json={
            "strategy_id": strategy_id,
            "backtest_name": "未来函数专项回测",
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
    task_id = response.json()["data"]["task_id"]
    assert wait_for_task(client, task_id)["status"] == "success"
    trades = client.get(f"/api/backtests/{task_id}/trades?page=1&page_size=20").json()["data"]["items"]

    assert response.status_code == 200
    assert trades[0]["trade_time"] == "2026-05-07"


def test_backtest_equity_result_and_trade_detail_are_consistent():
    client = TestClient(app)
    client.post("/api/data/sync/all")
    strategy_id = client.post(
        "/api/strategies/import",
        json={"file_name": "stage12_consistency.py", "code_content": BUY_SELL_STRATEGY},
    ).json()["data"]["id"]

    response = client.post(
        "/api/backtests",
        json={
            "strategy_id": strategy_id,
            "backtest_name": "资金一致性回测",
            "start_date": "2026-05-06",
            "end_date": "2026-05-08",
            "initial_cash": 1000000,
            "single_order_amount": 100000,
            "data_frequency": "日K",
            "fill_mode": "下一日开盘",
            "fee_rate": 0.0003,
            "stamp_tax_rate": 0.001,
            "slippage": 0.01,
        },
    )
    task_id = response.json()["data"]["task_id"]
    assert wait_for_task(client, task_id)["status"] == "success"
    result = client.get(f"/api/backtests/{task_id}/result").json()["data"]
    equity = client.get(f"/api/backtests/{task_id}/equity").json()["data"]
    trades = client.get(f"/api/backtests/{task_id}/trades?page=1&page_size=20&sort_order=asc").json()["data"]["items"]

    assert len(trades) == 2
    assert trades[0]["side"] == "BUY"
    assert trades[1]["side"] == "SELL"
    assert trades[1]["pnl"] != 0
    assert result["final_cash"] == equity[-1]["equity"]
    assert equity[-1]["equity"] == round(equity[-1]["cash"] + equity[-1]["market_value"], 2)


def test_backtest_strategy_sandbox_blocks_direct_database_imports():
    client = TestClient(app)
    client.post("/api/data/sync/all")
    strategy_id = client.post(
        "/api/strategies/import",
        json={"file_name": "stage12_block_sqlite.py", "code_content": DATABASE_IMPORT_STRATEGY},
    ).json()["data"]["id"]

    response = client.post(
        "/api/backtests",
        json={
            "strategy_id": strategy_id,
            "backtest_name": "回测沙箱边界",
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
    task_id = response.json()["data"]["task_id"]
    assert wait_for_task(client, task_id)["status"] == "failed"
    logs = client.get(f"/api/backtests/{task_id}/logs?page=1&page_size=20").json()["data"]["items"]
    technical_details = "\n".join(str(log.get("technical_detail") or "") for log in logs)

    assert response.status_code == 200
    assert client.get(f"/api/backtests/{task_id}").json()["data"]["status"] == "failed"
    assert "策略安全边界" in technical_details
    assert "sqlite3" in technical_details
    assert client.get(f"/api/backtests/{task_id}/result").json()["data"] is None


def test_backtest_strategy_sandbox_blocks_dunder_getattr():
    client = TestClient(app)
    client.post("/api/data/sync/all")
    strategy_id = client.post(
        "/api/strategies/import",
        json={"file_name": "stage12_block_dunder_getattr.py", "code_content": DUNDER_GETATTR_STRATEGY},
    ).json()["data"]["id"]

    response = client.post(
        "/api/backtests",
        json={
            "strategy_id": strategy_id,
            "backtest_name": "回测沙箱反射边界",
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
    task_id = response.json()["data"]["task_id"]
    assert wait_for_task(client, task_id)["status"] == "failed"
    logs = client.get(f"/api/backtests/{task_id}/logs?page=1&page_size=20").json()["data"]["items"]
    technical_details = "\n".join(str(log.get("technical_detail") or "") for log in logs)

    assert response.status_code == 200
    assert "策略安全边界" in technical_details
    assert "__class__" in technical_details


def test_backtest_rejects_invalid_strategy_signal_before_trading():
    client = TestClient(app)
    client.post("/api/data/sync/all")
    strategy_id = client.post(
        "/api/strategies/import",
        json={"file_name": "stage12_bad_signal.py", "code_content": BAD_SIGNAL_STRATEGY},
    ).json()["data"]["id"]

    response = client.post(
        "/api/backtests",
        json={
            "strategy_id": strategy_id,
            "backtest_name": "非法信号回测",
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
    task_id = response.json()["data"]["task_id"]
    assert wait_for_task(client, task_id)["status"] == "failed"
    logs = client.get(f"/api/backtests/{task_id}/logs?page=1&page_size=20").json()["data"]["items"]
    technical_details = "\n".join(str(log.get("technical_detail") or "") for log in logs)

    assert response.status_code == 200
    assert client.get(f"/api/backtests/{task_id}").json()["data"]["status"] == "failed"
    assert "策略信号股票代码格式不正确" in technical_details
    assert client.get(f"/api/backtests/{task_id}/trades?page=1&page_size=20").json()["data"]["total"] == 0
    assert client.get(f"/api/backtests/{task_id}/result").json()["data"] is None


def test_backtest_rejects_signal_before_requested_start_date():
    client = TestClient(app)
    client.post("/api/data/sync/all")
    strategy_id = client.post(
        "/api/strategies/import",
        json={"file_name": "stage12_out_of_range_signal.py", "code_content": OUT_OF_RANGE_SIGNAL_STRATEGY},
    ).json()["data"]["id"]

    response = client.post(
        "/api/backtests",
        json={
            "strategy_id": strategy_id,
            "backtest_name": "区间外信号回测",
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
    task_id = response.json()["data"]["task_id"]
    assert wait_for_task(client, task_id)["status"] == "failed"
    logs = client.get(f"/api/backtests/{task_id}/logs?page=1&page_size=20").json()["data"]["items"]
    technical_details = "\n".join(str(log.get("technical_detail") or "") for log in logs)

    assert response.status_code == 200
    assert "BACKTEST_SIGNAL_OUT_OF_RANGE" in technical_details
    assert "2026-05-01 15:00:00" in technical_details
    assert client.get(f"/api/backtests/{task_id}/trades?page=1&page_size=20").json()["data"]["total"] == 0


def test_backtest_strategy_runner_honors_cancel_before_subprocess(tmp_path):
    strategy_path = tmp_path / "cancel_strategy.py"
    strategy_path.write_text(
        '''class Strategy:
    name = "取消测试策略"
    version = "1.0.0"
    description = "不会真正运行。"
    params = {}

    def __init__(self, context):
        self.context = context

    def run(self):
        return []
''',
        encoding="utf-8",
    )
    task = BacktestTaskRecord(
        id=1,
        task_id="task_cancel",
        backtest_name="取消测试",
        strategy_id=1,
        strategy_name="取消测试",
        start_date="2026-05-06",
        end_date="2026-05-08",
        initial_cash=100000,
        single_order_amount=50000,
        data_frequency="日K",
        fill_mode="下一日开盘",
        fee_rate=0,
        stamp_tax_rate=0,
        slippage=0,
        status="running",
        created_at="2026-05-09 10:00:00",
    )
    bars = {"600000.SH": [MarketBar("600000.SH", "2026-05-06", 10, 10.2, 9.8, 10, 100000, 1000000, "浦发银行")]}

    with pytest.raises(StrategyExecutionCancelled):
        StrategyRunner().run(task, str(strategy_path), bars, cancel_check=lambda: True)


def test_backtest_strategy_runner_reports_day_progress(tmp_path):
    strategy_path = tmp_path / "progress_strategy.py"
    strategy_path.write_text(
        '''class Strategy:
    name = "进度测试策略"
    version = "1.0.0"
    description = "用于验证逐日进度。"
    params = {}

    def __init__(self, context):
        self.context = context

    def run(self):
        return []
''',
        encoding="utf-8",
    )
    task = BacktestTaskRecord(
        id=1,
        task_id="task_progress",
        backtest_name="进度测试",
        strategy_id=1,
        strategy_name="进度测试",
        start_date="2026-05-06",
        end_date="2026-05-07",
        initial_cash=100000,
        single_order_amount=50000,
        data_frequency="日K",
        fill_mode="下一日开盘",
        fee_rate=0,
        stamp_tax_rate=0,
        slippage=0,
        status="running",
        created_at="2026-05-09 10:00:00",
    )
    bars = {
        "600000.SH": [
            MarketBar("600000.SH", "2026-05-06", 10, 10.2, 9.8, 10, 100000, 1000000, "浦发银行"),
            MarketBar("600000.SH", "2026-05-07", 10.1, 10.3, 10.0, 10.2, 100000, 1000000, "浦发银行"),
        ]
    }
    progress: list[tuple[int, int, str, int]] = []

    StrategyRunner().run(task, str(strategy_path), bars, progress_callback=lambda processed, total, current_date, signal_count: progress.append((processed, total, current_date, signal_count)))

    assert progress[0] == (1, 2, "2026-05-06", 0)
    assert progress[-1] == (2, 2, "2026-05-07", 0)


def test_broker_reports_progress_for_unfilled_signals():
    task = BacktestTaskRecord(
        id=1,
        task_id="task_broker_progress",
        backtest_name="撮合进度测试",
        strategy_id=1,
        strategy_name="撮合进度测试",
        start_date="2026-05-06",
        end_date="2026-05-08",
        initial_cash=100000,
        single_order_amount=50000,
        data_frequency="日K",
        fill_mode="下一日开盘",
        fee_rate=0,
        stamp_tax_rate=0,
        slippage=0,
        status="running",
        created_at="2026-05-09 10:00:00",
    )
    progress: list[tuple[int, int, int, int, str]] = []

    trades, _portfolio, _logs, audits = BacktestBroker(MatchingEngine()).execute_with_audit(
        task,
        [{"symbol": "000001.SZ", "action": "BUY", "price": 10, "reason": "无行情测试", "signal_time": "2026-05-06"}],
        {"600000.SH": []},
        progress_callback=lambda processed, total, trade_count, skipped_count, current_symbol: progress.append((processed, total, trade_count, skipped_count, current_symbol)),
    )

    assert trades == []
    assert audits[0]["status"] == "未成交"
    assert progress[-1] == (1, 1, 0, 1, "000001.SZ")


def test_broker_enforces_t_plus_one_and_limit_up_blocking():
    task = BacktestTaskRecord(
        id=1,
        task_id="task_stage12",
        backtest_name="规则测试",
        strategy_id=1,
        strategy_name="规则测试",
        start_date="2026-05-06",
        end_date="2026-05-08",
        initial_cash=100000,
        single_order_amount=50000,
        data_frequency="日K",
        fill_mode="下一日开盘",
        fee_rate=0,
        stamp_tax_rate=0,
        slippage=0,
        status="running",
        created_at="2026-05-09 10:00:00",
    )
    bars = [
        MarketBar("600000.SH", "2026-05-06", 10, 10.2, 9.8, 10, 100000, 1000000, "浦发银行"),
        MarketBar("600000.SH", "2026-05-07", 10.1, 10.3, 10.0, 10.2, 100000, 1000000, "浦发银行"),
        MarketBar("600000.SH", "2026-05-08", 10.3, 10.5, 10.1, 10.4, 100000, 1000000, "浦发银行"),
    ]
    broker = BacktestBroker(MatchingEngine())
    trades, _portfolio, logs = broker.execute(
        task,
        [
            {"symbol": "600000.SH", "action": "BUY", "price": 10, "reason": "买入", "signal_time": "2026-05-06"},
            {"symbol": "600000.SH", "action": "SELL", "price": 10, "reason": "同日卖出", "signal_time": "2026-05-06"},
        ],
        {"600000.SH": bars},
    )
    assert len(trades) == 1
    assert any("T+1" in log for log in logs)

    limit_bars = [
        MarketBar("600000.SH", "2026-05-06", 10, 10, 10, 10, 100000, 1000000, "浦发银行"),
        MarketBar("600000.SH", "2026-05-07", 10.95, 10.95, 10.95, 10.95, 100000, 1000000, "浦发银行"),
    ]
    limit_trades, _portfolio, limit_logs = broker.execute(
        task,
        [{"symbol": "600000.SH", "action": "BUY", "price": 10, "reason": "涨停买入", "signal_time": "2026-05-06"}],
        {"600000.SH": limit_bars},
    )
    assert limit_trades == []
    assert any("涨跌停限制" in log for log in limit_logs)


def test_daily_backtest_falls_back_to_holding_days_when_stop_take_needs_minute():
    task = BacktestTaskRecord(
        id=1,
        task_id="task_daily_exit_after",
        backtest_name="日K自动卖出测试",
        strategy_id=1,
        strategy_name="日K自动卖出测试",
        start_date="2026-05-06",
        end_date="2026-05-13",
        initial_cash=100000,
        single_order_amount=50000,
        data_frequency="日K",
        fill_mode="下一日开盘",
        fee_rate=0,
        stamp_tax_rate=0,
        slippage=0,
        status="running",
        created_at="2026-05-13 10:00:00",
    )
    bars = [
        MarketBar("600000.SH", "2026-05-06", 10.0, 10.2, 9.8, 10.0, 100000, 1000000, name="浦发银行"),
        MarketBar("600000.SH", "2026-05-07", 10.1, 10.3, 10.0, 10.2, 100000, 1000000, name="浦发银行"),
        MarketBar("600000.SH", "2026-05-08", 10.2, 10.4, 10.1, 10.3, 100000, 1000000, name="浦发银行"),
        MarketBar("600000.SH", "2026-05-11", 10.4, 10.5, 10.2, 10.3, 100000, 1000000, name="浦发银行"),
    ]

    trades, _portfolio, logs, audits = BacktestBroker(MatchingEngine()).execute_with_audit(
        task,
        [{
            "symbol": "600000.SH",
            "name": "浦发银行",
            "action": "BUY",
            "price": 10.0,
            "reason": "日K策略带止盈止损也必须按持有天数退出",
            "signal_time": "2026-05-06 15:00:00",
            "stop_loss_pct": 5.0,
            "take_profit_pct": 5.0,
            "exit_after_trading_days": 2,
            "fallback_exit_time": "14:50:00",
        }],
        {"600000.SH": bars},
    )

    assert [trade["side"] for trade in trades] == ["BUY", "SELL"]
    assert trades[0]["trade_time"] == "2026-05-07"
    assert trades[1]["trade_time"] == "2026-05-11"
    assert any("已退化为日K持有天数卖出" in log for log in logs)
    assert any(row["action"] == "SELL" and row["is_auto_exit"] for row in audits)


def test_minute_controlled_exit_scans_until_day5_before_fallback(monkeypatch):
    task = BacktestTaskRecord(
        id=1,
        task_id="task_minute_exit_scan",
        backtest_name="分钟连续止盈扫描",
        strategy_id=1,
        strategy_name="分钟连续止盈扫描",
        start_date="2026-05-06",
        end_date="2026-05-13",
        initial_cash=100000,
        single_order_amount=50000,
        data_frequency="分钟K",
        fill_mode="正式分钟回放",
        fee_rate=0,
        stamp_tax_rate=0,
        slippage=0,
        status="running",
        created_at="2026-05-09 10:00:00",
    )
    bars = [
        MarketBar("600000.SH", "2026-05-06", 10, 10.2, 9.8, 10, 100000, 1000000, name="浦发银行"),
        MarketBar("600000.SH", "2026-05-07", 10.1, 10.3, 10.0, 10.2, 100000, 1000000, name="浦发银行"),
        MarketBar("600000.SH", "2026-05-08", 10.3, 10.9, 10.2, 10.8, 100000, 1000000, name="浦发银行"),
        MarketBar("600000.SH", "2026-05-11", 10.5, 10.6, 10.1, 10.2, 100000, 1000000, name="浦发银行"),
        MarketBar("600000.SH", "2026-05-12", 10.2, 10.4, 10.0, 10.1, 100000, 1000000, name="浦发银行"),
        MarketBar("600000.SH", "2026-05-13", 10.1, 10.3, 10.0, 10.2, 100000, 1000000, name="浦发银行"),
    ]
    minute_rows = [
        {"symbol": "600000.SH", "datetime": "2026-05-07 10:00:00", "open": 10.1, "high": 10.3, "low": 10.0, "close": 10.2, "volume": 1000, "amount": 10000, "pre_close": 10, "suspend_flag": 0},
        {"symbol": "600000.SH", "datetime": "2026-05-08 10:00:00", "open": 10.4, "high": 10.9, "low": 10.3, "close": 10.8, "volume": 1000, "amount": 10000, "pre_close": 10.2, "suspend_flag": 0},
        {"symbol": "600000.SH", "datetime": "2026-05-13 14:50:00", "open": 10.2, "high": 10.3, "low": 10.0, "close": 10.2, "volume": 1000, "amount": 10000, "pre_close": 10.1, "suspend_flag": 0},
    ]
    broker = BacktestBroker(MatchingEngine())

    def fake_minute_rows_between(symbol: str, start_time: str, end_time: str):
        return [row for row in minute_rows if row["symbol"] == symbol and start_time <= row["datetime"] <= end_time]

    monkeypatch.setattr(broker.repository, "list_minute_bar_rows_between", fake_minute_rows_between)
    event, log = broker._controlled_exit_event(
        task,
        bars,
        MarketBar("600000.SH", "2026-05-06", 10, 10.2, 9.8, 10, 100000, 1000000, name="浦发银行", bar_time="2026-05-06 10:02:00"),
        10.0,
        1000,
        {
            "symbol": "600000.SH",
            "name": "浦发银行",
            "action": "BUY",
            "price": 10.0,
            "reason": "验证买入后连续扫描止盈",
            "signal_time": "2026-05-06 10:01:00",
            "stop_loss_pct": 0.0,
            "take_profit_pct": 8.0,
            "exit_after_trading_days": 5,
            "fallback_exit_time": "14:50:00",
        },
        1,
    )

    assert event is not None
    assert event["signal"]["signal_time"] == "2026-05-08 10:00:00"
    assert event["execution_price"] == 10.8
    assert "触发止盈 8.00%" in event["signal"]["reason"]
    assert log and "卖出 2026-05-08 10:00:00" in log
