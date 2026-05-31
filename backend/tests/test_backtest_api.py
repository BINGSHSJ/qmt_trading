import json
import threading
import time
import zipfile
from datetime import date, datetime, timedelta
from io import BytesIO
from xml.etree import ElementTree

from fastapi.testclient import TestClient

from backend.api import backtest_api as backtest_api_module
from backend.main import app
from backend.core.database import get_connection
from backend.repositories.backtest_center.backtest_repository import BacktestRepository
from backend.schemas.backtest import BacktestCreateRequest, BacktestTaskRecord
from backend.services.backtest_center.backtest_engine import BacktestStrategyContext, DataLoader, MetricsService, run_backtest_strategy_code
from backend.services.backtest_center import backtest_service as backtest_service_module


def wait_for_task(client: TestClient, task_id: str, timeout: float = 10):
    deadline = time.perf_counter() + timeout
    last_task = None
    while time.perf_counter() < deadline:
        last_task = client.get(f"/api/tasks/{task_id}").json()["data"]
        if last_task["status"] in {"success", "failed", "cancelled"}:
            return last_task
        time.sleep(0.05)
    raise AssertionError(f"任务未在 {timeout} 秒内结束：{last_task}")


def _xlsx_sheet_rows(workbook: zipfile.ZipFile, sheet_index: int) -> list[list[object]]:
    root = ElementTree.fromstring(workbook.read(f"xl/worksheets/sheet{sheet_index}.xml"))
    namespace = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    rows: list[list[object]] = []
    for row in root.findall(".//s:sheetData/s:row", namespace):
        values: list[object] = []
        for cell in row.findall("s:c", namespace):
            ref = cell.attrib.get("r", "A1")
            column = "".join(char for char in ref if char.isalpha())
            column_index = _xlsx_column_index(column)
            while len(values) < column_index:
                values.append("")
            values[column_index - 1] = _xlsx_cell_value(cell, namespace)
        rows.append(values)
    return rows


def _xlsx_column_index(column: str) -> int:
    index = 0
    for char in column:
        index = index * 26 + ord(char.upper()) - ord("A") + 1
    return max(index, 1)


def _xlsx_cell_value(cell: ElementTree.Element, namespace: dict[str, str]) -> object:
    if cell.attrib.get("t") == "inlineStr":
        inline = cell.find("s:is", namespace)
        return "".join(inline.itertext()) if inline is not None else ""
    value = cell.find("s:v", namespace)
    text = value.text if value is not None else ""
    if text is None or text == "":
        return ""
    try:
        number = float(text)
    except ValueError:
        return text
    return int(number) if number.is_integer() else number


def _xlsx_rows_as_dicts(rows: list[list[object]]) -> list[dict[str, object]]:
    if not rows:
        return []
    headers = [str(value) for value in rows[0]]
    return [
        {header: row[index] if index < len(row) else "" for index, header in enumerate(headers)}
        for row in rows[1:]
    ]


def _number(value: object) -> float:
    return float(value)


def test_backtest_create_result_report_and_delete_flow():
    client = TestClient(app)

    client.post("/api/data/sync/all")
    strategy_id = client.post("/api/strategies/copy-example").json()["data"]["id"]

    check_response = client.post(
        "/api/backtests/check-data",
        json={
            "strategy_id": strategy_id,
            "start_date": "2026-05-04",
            "end_date": "2026-05-08",
            "data_frequency": "日K",
        },
    )
    assert check_response.status_code == 200
    check_body = check_response.json()["data"]
    assert check_body["ok"] is True
    assert "覆盖率" in check_body["message"]
    assert "缺失清单" in check_body["suggestion"]

    create_response = client.post(
        "/api/backtests",
        json={
            "strategy_id": strategy_id,
            "backtest_name": "阶段五单测回测",
            "start_date": "2026-05-04",
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
    assert create_response.status_code == 200
    task_id = create_response.json()["data"]["task_id"]

    assert wait_for_task(client, task_id)["status"] == "success"
    task_body = client.get(f"/api/backtests/{task_id}").json()["data"]
    assert task_body["status"] == "success"
    assert task_body["start_date"] == "2026-05-04"
    assert task_body["end_date"] == "2026-05-08"
    assert client.get(f"/api/backtests/{task_id}/result").json()["data"]["trade_count"] >= 0
    assert len(client.get(f"/api/backtests/{task_id}/equity").json()["data"]) >= 1
    assert client.get(f"/api/backtests/{task_id}/trades?page=1&page_size=20").json()["data"]["total"] >= 0
    assert client.get(f"/api/backtests/{task_id}/logs").json()["data"]["total"] >= 1
    report = client.get(f"/api/backtests/{task_id}/report").json()["data"]
    assert report["task"]["task_id"] == task_id
    assert report["manifest"]["strategy_code_hash"]
    assert report["manifest"]["rule_snapshot"]
    universe = json.loads(report["manifest"]["universe_summary"])
    assert universe["symbols_total"] >= 1
    assert universe["daily_bar_count"] >= 1

    delete_response = client.delete(f"/api/backtests/{task_id}")
    assert delete_response.status_code == 200


def test_backtest_create_replaces_generic_default_name_with_readable_name():
    client = TestClient(app)

    client.post("/api/data/sync/all")
    strategy = client.post("/api/strategies/copy-example").json()["data"]
    created = backtest_service_module.BacktestService().create_backtest(
        BacktestCreateRequest(
            strategy_id=strategy["id"],
            backtest_name="单策略本地撮合回测",
            start_date="2026-05-04",
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

    task = backtest_service_module.BacktestService().get_task(created.task_id)

    assert task.backtest_name != "单策略本地撮合回测"
    assert task.backtest_name.startswith(strategy["strategy_name"].replace(" ", ""))
    assert task.backtest_name.endswith("_0504-0508_日K")


def test_backtest_report_cross_checks_matching_strategy_run_snapshot():
    client = TestClient(app)

    client.post("/api/data/sync/all")
    strategy_id = client.post("/api/strategies/copy-example").json()["data"]["id"]
    run_response = client.post(f"/api/strategies/{strategy_id}/run")
    assert run_response.status_code == 200
    run_task_id = run_response.json()["data"]["task_id"]
    assert wait_for_task(client, run_task_id)["status"] == "success"

    create_response = client.post(
        "/api/backtests",
        json={
            "strategy_id": strategy_id,
            "backtest_name": "策略快照交叉核对回测",
            "start_date": "2026-05-04",
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
    assert create_response.status_code == 200
    task_id = create_response.json()["data"]["task_id"]
    assert wait_for_task(client, task_id)["status"] == "success"

    report = client.get(f"/api/backtests/{task_id}/report").json()["data"]
    check = report["strategy_snapshot_check"]

    assert report["manifest"]["strategy_code_hash"]
    assert check["status"] == "matched"
    assert check["message"] == "已找到与本次回测策略代码哈希一致的策略运行记录。"
    assert check["manifest_hash"] == report["manifest"]["strategy_code_hash"]
    assert check["latest_code_hash"] == report["manifest"]["strategy_code_hash"]
    assert check["matched_task_id"] == run_task_id
    assert check["matched_run_id"]
    assert "manifest_file_name" in check["technical_detail"]

    export_response = client.get(f"/api/backtests/{task_id}/export")
    assert export_response.status_code == 200
    with zipfile.ZipFile(BytesIO(export_response.content)) as workbook:
        snapshot_rows = _xlsx_sheet_rows(workbook, 7)
        snapshot_by_field = {str(row[0]): row[1] for row in snapshot_rows[1:] if len(row) >= 2}
        assert snapshot_by_field["策略运行核对状态"] == "matched"
        assert snapshot_by_field["策略运行核对说明"] == check["message"]
        assert snapshot_by_field["匹配任务ID"] == run_task_id


def test_backtest_history_survives_missing_current_strategy_file_record():
    client = TestClient(app)

    client.post("/api/data/sync/all")
    strategy = client.post("/api/strategies/copy-example").json()["data"]
    strategy_id = strategy["id"]
    create_response = client.post(
        "/api/backtests",
        json={
            "strategy_id": strategy_id,
            "backtest_name": "策略文件缺失后的历史回测",
            "start_date": "2026-05-04",
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
    task_id = create_response.json()["data"]["task_id"]
    assert wait_for_task(client, task_id)["status"] == "success"
    before_report = client.get(f"/api/backtests/{task_id}/report").json()["data"]
    manifest_strategy_name = before_report["manifest"]["strategy_name"]
    manifest_strategy_file = before_report["manifest"]["strategy_file_name"]

    with get_connection() as connection:
        connection.execute("DELETE FROM strategy_file WHERE id=?", (strategy_id,))
        connection.commit()

    list_response = client.get(f"/api/backtests?keyword={manifest_strategy_name}&page=1&page_size=20")
    list_body = list_response.json()["data"]
    assert list_response.status_code == 200
    assert list_body["total"] >= 1
    listed_task = next(item for item in list_body["items"] if item["task_id"] == task_id)
    assert listed_task["strategy_name"] == manifest_strategy_name

    detail_response = client.get(f"/api/backtests/{task_id}")
    detail = detail_response.json()["data"]
    assert detail_response.status_code == 200
    assert detail["strategy_name"] == manifest_strategy_name

    report_response = client.get(f"/api/backtests/{task_id}/report")
    report = report_response.json()["data"]
    assert report_response.status_code == 200
    assert report["task"]["strategy_name"] == manifest_strategy_name
    assert report["manifest"]["strategy_file_name"] == manifest_strategy_file

    export_response = client.get(f"/api/backtests/{task_id}/export")
    assert export_response.status_code == 200
    with zipfile.ZipFile(BytesIO(export_response.content)) as workbook:
        summary_by_field = {str(row[1]): row[2] for row in _xlsx_sheet_rows(workbook, 1)[1:] if len(row) >= 3}
        snapshot_by_field = {str(row[0]): row[1] for row in _xlsx_sheet_rows(workbook, 7)[1:] if len(row) >= 2}
        assert summary_by_field["策略名称"] == manifest_strategy_name
        assert snapshot_by_field["策略文件"] == manifest_strategy_file


def test_backtest_check_data_accepts_covering_coverage_record():
    client = TestClient(app)
    client.post("/api/data/sync/all")
    strategy_id = client.post("/api/strategies/copy-example").json()["data"]["id"]
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO data_coverage(
                data_type, symbol, period, start_date, end_date, expected_trading_days,
                actual_trading_days, expected_rows, actual_rows, missing_days,
                duplicate_rows, coverage_rate, status, checked_at
            ) VALUES (
                'daily_kline', 'ALL', '1d', '2026-01-01', '2026-05-08', 80,
                80, 100, 100, '[]', 0, 100, 'complete', '2026-05-11 10:00:00'
            )
            ON CONFLICT(data_type, symbol, period, start_date, end_date) DO UPDATE SET
                coverage_rate=excluded.coverage_rate,
                status=excluded.status,
                checked_at=excluded.checked_at
            """
        )
        connection.commit()

    response = client.post(
        "/api/backtests/check-data",
        json={
            "strategy_id": strategy_id,
            "start_date": "2026-05-04",
            "end_date": "2026-05-08",
            "data_frequency": "日K",
        },
    )
    body = response.json()["data"]

    assert response.status_code == 200
    assert body["ok"] is True
    assert any("大区间记录" in step["message"] for step in body["steps"] if step["title"] == "日K覆盖率")


def test_backtest_create_returns_task_id_before_worker_finishes(monkeypatch):
    client = TestClient(app)
    client.post("/api/data/sync/all")
    strategy_id = client.post("/api/strategies/copy-example").json()["data"]["id"]
    started = threading.Event()
    finished = threading.Event()

    def slow_worker(self, task_id):
        del self, task_id
        started.set()
        time.sleep(0.8)
        finished.set()

    monkeypatch.setattr(backtest_api_module.BacktestService, "run_backtest_task", slow_worker)
    started_at = time.perf_counter()
    response = client.post(
        "/api/backtests",
        json={
            "strategy_id": strategy_id,
            "backtest_name": "回测异步返回检查",
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
    elapsed = time.perf_counter() - started_at

    assert response.status_code == 200
    assert response.json()["data"]["task_id"]
    assert elapsed < 0.5
    assert started.wait(1)
    assert finished.wait(2)


def test_backtest_rerun_endpoint_is_disabled_to_avoid_stale_date_reuse(monkeypatch):
    client = TestClient(app)
    client.post("/api/data/sync/all")
    strategy_id = client.post("/api/strategies/copy-example").json()["data"]["id"]

    def no_op_worker(self, task_id):
        del self, task_id

    monkeypatch.setattr(backtest_api_module.BacktestService, "run_backtest_task", no_op_worker)
    create_response = client.post(
        "/api/backtests",
        json={
            "strategy_id": strategy_id,
            "backtest_name": "历史复跑熔断检查",
            "start_date": "2026-03-04",
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
    task_id = create_response.json()["data"]["task_id"]

    response = client.post(f"/api/backtests/{task_id}/rerun")
    body = response.json()

    assert response.status_code == 400
    assert body["success"] is False
    assert body["error"]["code"] == "BACKTEST_RERUN_DISABLED"
    assert "历史任务直接复跑已停用" in body["message"]


def test_backtest_strategy_worker_returns_large_signal_result_without_queue_deadlock():
    code = '''
class Strategy:
    name = "大信号回传测试"
    version = "1.0.0"
    description = "用于验证沙箱回传大量信号不会阻塞。"
    params = {}

    def __init__(self, context):
        self.context = context

    def run(self):
        return [{
            "symbol": "600000.SH",
            "name": "浦发银行",
            "action": "WATCH",
            "price": 10.0,
            "amount": 10000,
            "reason": "大量信号回传测试，避免父子进程队列互等。" * 4,
            "signal_time": "2026-05-06 09:30:00",
        } for _ in range(500)]
'''

    signals, logs = run_backtest_strategy_code(code, "large_signal_strategy.py", 20, {}, "2026-05-06")

    assert len(signals) == 500
    assert isinstance(logs, list)


def test_backtest_rejects_missing_data():
    client = TestClient(app)

    strategy_id = client.post("/api/strategies/copy-example").json()["data"]["id"]
    response = client.post(
        "/api/backtests/check-data",
        json={
            "strategy_id": strategy_id,
            "start_date": "1990-01-01",
            "end_date": "1990-01-02",
            "data_frequency": "日K",
        },
    )

    assert response.status_code == 200
    assert response.json()["data"]["ok"] is False


def test_backtest_rejects_minute_strategy_with_daily_frequency():
    client = TestClient(app)

    strategy_id = client.post(
        "/api/strategies/import",
        json={
            "file_name": "minute_dependent_for_backtest.py",
            "code_content": '''
class Strategy:
    name = "分钟线依赖策略"
    version = "1.0.0"
    description = "用于检查分钟线策略不能用日K回测。"
    params = {}

    def __init__(self, context):
        self.context = context

    def run(self):
        self.context.get_minute_bars("600000.SH", "2026-05-06 09:30:00", "2026-05-06 10:30:00")
        return []
''',
        },
    ).json()["data"]["id"]

    check_response = client.post(
        "/api/backtests/check-data",
        json={
            "strategy_id": strategy_id,
            "start_date": "2026-05-06",
            "end_date": "2026-05-08",
            "data_frequency": "日K",
        },
    )
    assert check_response.status_code == 200
    check_body = check_response.json()["data"]
    assert check_body["ok"] is False
    assert "依赖分钟K" in check_body["message"]
    assert "不能使用日K回测" in check_body["message"]
    assert "strategy_requires_minute_bars=true" in check_body["technical_detail"]

    create_response = client.post(
        "/api/backtests",
        json={
            "strategy_id": strategy_id,
            "backtest_name": "分钟策略误选日K检查",
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
    assert create_response.status_code == 400
    assert "依赖分钟K" in create_response.json()["message"]


def test_backtest_uses_all_available_daily_symbols(monkeypatch):
    client = TestClient(app)
    strategy_id = client.post("/api/strategies/copy-example").json()["data"]["id"]
    symbols = [f"60{index:04d}.SH" for index in range(60)]
    with get_connection() as connection:
        connection.executemany(
            """
            INSERT INTO stock_basic(symbol, name, market, security_type, list_status, is_st, updated_at)
            VALUES (?, ?, 'SH', '股票', '上市', 0, '2026-05-10')
            """,
            [(symbol, f"全市场样本{index}") for index, symbol in enumerate(symbols)],
        )
        rows = []
        for symbol in symbols:
            for offset, trade_date in enumerate(["2026-05-06", "2026-05-07", "2026-05-08"]):
                rows.append((symbol, trade_date, 10 + offset, 11 + offset, 9 + offset, 10.5 + offset, 10000, 105000))
        connection.executemany(
            """
            INSERT INTO daily_kline(symbol, trade_date, open, high, low, close, volume, amount, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-05-10 10:00:00')
            """,
            rows,
        )
        connection.commit()

    captured: dict[str, int] = {}

    def fake_run(self, task, strategy_path, bars_by_symbol, cancel_check=None, progress_callback=None, minute_progress_callback=None):
        del self, task, strategy_path, cancel_check, minute_progress_callback
        captured["symbol_count"] = len(bars_by_symbol)
        if progress_callback:
            progress_callback(3, 3, "2026-05-08", 0)
        return [], ["全市场日 K 回测范围测试"]

    monkeypatch.setattr(backtest_service_module.StrategyRunner, "run", fake_run)
    response = client.post(
        "/api/backtests",
        json={
            "strategy_id": strategy_id,
            "backtest_name": "全市场日K范围测试",
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

    assert response.status_code == 200
    assert wait_for_task(client, task_id)["status"] == "success"
    logs = client.get(f"/api/backtests/{task_id}/logs?page=1&page_size=20").json()["data"]["items"]
    assert captured["symbol_count"] == 60
    assert any("共 60 只股票" in item["message"] for item in logs)


def test_backtest_daily_loader_includes_warmup_bars_before_start_date():
    symbol = "689998.SH"
    start = date(2026, 1, 20)
    rows = []
    current = start
    while current <= date(2026, 3, 6):
        if current.weekday() < 5:
            trade_date = current.isoformat()
            close = 10 + len(rows) * 0.01
            rows.append((symbol, trade_date, close, close + 0.5, close - 0.5, close, 10000 + len(rows), close * 10000))
        current += timedelta(days=1)
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO stock_basic(symbol, name, market, security_type, list_status, is_st, updated_at)
            VALUES (?, '日K预热样本', 'SH', '股票', '上市', 0, '2026-05-13')
            ON CONFLICT(symbol) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at
            """,
            (symbol,),
        )
        connection.executemany(
            """
            INSERT INTO daily_kline(symbol, trade_date, open, high, low, close, volume, amount, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2026-05-13 10:00:00')
            ON CONFLICT(symbol, trade_date) DO UPDATE SET
                open=excluded.open,
                high=excluded.high,
                low=excluded.low,
                close=excluded.close,
                volume=excluded.volume,
                amount=excluded.amount
            """,
            rows,
        )
        connection.commit()

    task = BacktestTaskRecord(
        id=1,
        task_id="task_daily_warmup",
        backtest_name="日K预热测试",
        strategy_id=1,
        strategy_name="日K预热测试策略",
        start_date="2026-03-04",
        end_date="2026-03-06",
        initial_cash=1000000,
        single_order_amount=100000,
        data_frequency="日K",
        fill_mode="下一日开盘",
        fee_rate=0.0003,
        stamp_tax_rate=0.001,
        slippage=0,
        status="pending",
        created_at="2026-05-13 10:00:00",
    )
    bars = DataLoader().load_daily_bars(task, [symbol])[symbol]
    pre_start = [bar for bar in bars if bar.trade_date < task.start_date]
    in_range = [bar for bar in bars if task.start_date <= bar.trade_date <= task.end_date]

    assert len(pre_start) >= 20
    assert [bar.trade_date for bar in in_range] == ["2026-03-04", "2026-03-05", "2026-03-06"]


def test_backtest_rejects_minute_frequency_for_daily_strategy():
    client = TestClient(app)

    client.post("/api/data/sync/all")
    strategy_id = client.post("/api/strategies/copy-example").json()["data"]["id"]

    check_response = client.post(
        "/api/backtests/check-data",
        json={
            "strategy_id": strategy_id,
            "start_date": "2026-05-04",
            "end_date": "2026-05-08",
            "data_frequency": "分钟K",
        },
    )
    assert check_response.status_code == 200
    check_body = check_response.json()["data"]
    assert check_body["ok"] is False
    assert "未使用分钟K接口" in check_body["message"]
    assert "日K策略使用日K回测" in check_body["suggestion"]

    create_response = client.post(
        "/api/backtests",
        json={
            "strategy_id": strategy_id,
            "backtest_name": "分钟K边界检查",
            "start_date": "2026-05-04",
            "end_date": "2026-05-08",
            "initial_cash": 1000000,
            "single_order_amount": 100000,
            "data_frequency": "分钟K",
            "fill_mode": "正式分钟回放",
            "fee_rate": 0.0003,
            "stamp_tax_rate": 0.001,
            "slippage": 0,
        },
    )
    assert create_response.status_code == 400
    assert "未使用分钟K接口" in create_response.json()["message"]


def test_minute_backtest_rejects_quick_scan_fill_mode():
    client = TestClient(app)
    strategy_id = client.post("/api/strategies/copy-example").json()["data"]["id"]

    check_response = client.post(
        "/api/backtests/check-data",
        json={
            "strategy_id": strategy_id,
            "start_date": "2026-05-04",
            "end_date": "2026-05-08",
            "data_frequency": "分钟K",
            "fill_mode": "下一分钟成交",
        },
    )
    assert check_response.status_code == 200
    check_body = check_response.json()["data"]
    assert check_body["ok"] is False
    assert "正式分钟回放" in check_body["message"]
    assert "quick_scan_disabled=true" in check_body["technical_detail"]

    create_response = client.post(
        "/api/backtests",
        json={
            "strategy_id": strategy_id,
            "backtest_name": "分钟K快速扫描拒绝检查",
            "start_date": "2026-05-04",
            "end_date": "2026-05-08",
            "initial_cash": 1000000,
            "single_order_amount": 100000,
            "data_frequency": "分钟K",
            "fill_mode": "下一分钟成交",
            "fee_rate": 0.0003,
            "stamp_tax_rate": 0.001,
            "slippage": 0,
        },
    )
    assert create_response.status_code == 400
    assert "正式分钟回放" in create_response.json()["message"]


def test_minute_backtest_rejects_partial_minute_coverage_record():
    client = TestClient(app)
    current = "2026-05-10 10:00:00"
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO stock_basic(symbol, name, market, security_type, list_status, is_st, updated_at)
            VALUES ('603770.SH', '覆盖率样本', 'SH', '股票', '上市', 0, ?)
            ON CONFLICT(symbol) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at
            """,
            (current,),
        )
        connection.execute(
            """
            INSERT INTO daily_kline(symbol, trade_date, open, high, low, close, volume, amount, created_at)
            VALUES ('603770.SH', '2026-05-06', 10, 10.2, 9.9, 10.1, 100000, 1000000, ?)
            ON CONFLICT(symbol, trade_date) DO UPDATE SET close=excluded.close
            """,
            (current,),
        )
        connection.execute(
            """
            INSERT INTO minute_kline(symbol, datetime, period, open, high, low, close, volume, amount, created_at)
            VALUES ('603770.SH', '2026-05-06 09:30:00', '1m', 10, 10.1, 9.9, 10, 10000, 30000000, ?)
            ON CONFLICT(symbol, period, datetime) DO UPDATE SET close=excluded.close
            """,
            (current,),
        )
        connection.execute(
            """
            INSERT INTO data_coverage(
                data_type, symbol, period, start_date, end_date, expected_trading_days,
                actual_trading_days, expected_rows, actual_rows, missing_days,
                duplicate_rows, coverage_rate, status, checked_at
            ) VALUES (
                'minute_kline', 'ALL', '1m', '2026-05-01', '2026-05-08', 5,
                4, 5000, 4500, '["2026-05-08"]', 0, 90, 'partial', ?
            )
            ON CONFLICT(data_type, symbol, period, start_date, end_date) DO UPDATE SET
                coverage_rate=excluded.coverage_rate,
                status=excluded.status,
                checked_at=excluded.checked_at
            """,
            (current,),
        )
        connection.commit()

    strategy_id = client.post(
        "/api/strategies/import",
        json={
            "file_name": "minute_partial_coverage_strategy.py",
            "code_content": '''
class Strategy:
    name = "分钟覆盖率检查策略"
    version = "1.0.0"
    description = "只用于触发分钟K接口依赖。"
    params = {}

    def __init__(self, context):
        self.context = context

    def run(self):
        self.context.get_minute_bars("603770.SH", "2026-05-06 09:30:00", "2026-05-06 09:31:00")
        return []
''',
        },
    ).json()["data"]["id"]

    check_response = client.post(
        "/api/backtests/check-data",
        json={
            "strategy_id": strategy_id,
            "start_date": "2026-05-06",
            "end_date": "2026-05-08",
            "data_frequency": "分钟K",
            "fill_mode": "正式分钟回放",
        },
    )
    check_body = check_response.json()["data"]
    assert check_response.status_code == 200
    assert check_body["ok"] is False
    assert "分钟K覆盖率未完成" in check_body["message"]

    create_response = client.post(
        "/api/backtests",
        json={
            "strategy_id": strategy_id,
            "backtest_name": "分钟覆盖率未完成拒绝",
            "start_date": "2026-05-06",
            "end_date": "2026-05-08",
            "initial_cash": 1000000,
            "single_order_amount": 100000,
            "data_frequency": "分钟K",
            "fill_mode": "正式分钟回放",
            "fee_rate": 0.0003,
            "stamp_tax_rate": 0.001,
            "slippage": 0,
        },
    )
    assert create_response.status_code == 400
    assert "分钟K覆盖率未完成" in create_response.json()["message"]


def test_minute_backtest_rejects_missing_declared_minute_window():
    client = TestClient(app)
    current = "2026-05-10 10:00:00"
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO stock_basic(symbol, name, market, security_type, list_status, is_st, updated_at)
            VALUES ('603771.SH', '窗口缺失样本', 'SH', '股票', '上市', 0, ?)
            ON CONFLICT(symbol) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at
            """,
            (current,),
        )
        connection.execute(
            """
            INSERT INTO daily_kline(symbol, trade_date, open, high, low, close, volume, amount, created_at)
            VALUES ('603771.SH', '2026-05-06', 10, 10.2, 9.9, 10.1, 100000, 1000000, ?)
            ON CONFLICT(symbol, trade_date) DO UPDATE SET close=excluded.close
            """,
            (current,),
        )
        connection.execute(
            """
            INSERT INTO minute_kline(symbol, datetime, period, open, high, low, close, volume, amount, created_at)
            VALUES ('603771.SH', '2026-05-06 09:50:00', '1m', 10, 10.1, 9.9, 10, 10000, 30000000, ?)
            ON CONFLICT(symbol, period, datetime) DO UPDATE SET close=excluded.close
            """,
            (current,),
        )
        connection.execute(
            """
            INSERT INTO data_coverage(
                data_type, symbol, period, start_date, end_date, expected_trading_days,
                actual_trading_days, expected_rows, actual_rows, missing_days,
                duplicate_rows, coverage_rate, status, checked_at
            ) VALUES (
                'minute_kline', 'ALL', '1m', '2026-05-06', '2026-05-06', 1,
                1, 1, 1, '[]', 0, 100, 'complete', ?
            )
            ON CONFLICT(data_type, symbol, period, start_date, end_date) DO UPDATE SET
                coverage_rate=excluded.coverage_rate,
                status=excluded.status,
                checked_at=excluded.checked_at
            """,
            (current,),
        )
        connection.commit()

    strategy_id = client.post(
        "/api/strategies/import",
        json={
            "file_name": "minute_missing_window_strategy.py",
            "code_content": '''
class Strategy:
    name = "分钟窗口缺失检查策略"
    version = "1.0.0"
    description = "声明买入和尾盘卖出窗口，验证回测前检查不能漏掉关键分钟。"
    params = {
        "start_time": "09:50:00",
        "end_time": "09:50:00",
        "fallback_exit_time": "14:50:00",
    }

    def __init__(self, context):
        self.context = context

    def run(self):
        self.context.get_minute_bars("603771.SH", "2026-05-06 09:50:00", "2026-05-06 09:50:00")
        return []
''',
        },
    ).json()["data"]["id"]

    check_response = client.post(
        "/api/backtests/check-data",
        json={
            "strategy_id": strategy_id,
            "start_date": "2026-05-06",
            "end_date": "2026-05-06",
            "data_frequency": "分钟K",
            "fill_mode": "正式分钟回放",
        },
    )
    check_body = check_response.json()["data"]

    assert check_response.status_code == 200
    assert check_body["ok"] is False
    assert "分钟K关键时间窗口数据不完整" in check_body["message"]
    assert any(step["title"] == "分钟窗口-兜底卖出窗口" and step["status"] == "failed" for step in check_body["steps"])


def test_minute_backtest_rejects_incomplete_declared_minute_window_bar_count():
    client = TestClient(app)
    current = "2026-05-10 10:00:00"
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO stock_basic(symbol, name, market, security_type, list_status, is_st, updated_at)
            VALUES ('603772.SH', '窗口不完整样本', 'SH', '股票', '上市', 0, ?)
            ON CONFLICT(symbol) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at
            """,
            (current,),
        )
        connection.execute(
            """
            INSERT INTO daily_kline(symbol, trade_date, open, high, low, close, volume, amount, created_at)
            VALUES ('603772.SH', '2026-05-06', 10, 10.2, 9.9, 10.1, 100000, 1000000, ?)
            ON CONFLICT(symbol, trade_date) DO UPDATE SET close=excluded.close
            """,
            (current,),
        )
        connection.executemany(
            """
            INSERT INTO minute_kline(symbol, datetime, period, open, high, low, close, volume, amount, created_at)
            VALUES ('603772.SH', ?, '1m', 10, 10.1, 9.9, 10, 10000, 30000000, ?)
            ON CONFLICT(symbol, period, datetime) DO UPDATE SET close=excluded.close
            """,
            [
                ("2026-05-06 09:50:00", current),
                ("2026-05-06 09:51:00", current),
            ],
        )
        connection.execute(
            """
            INSERT INTO data_coverage(
                data_type, symbol, period, start_date, end_date, expected_trading_days,
                actual_trading_days, expected_rows, actual_rows, missing_days,
                duplicate_rows, coverage_rate, status, checked_at
            ) VALUES (
                'minute_kline', 'ALL', '1m', '2026-05-06', '2026-05-06', 1,
                1, 1, 1, '[]', 0, 100, 'complete', ?
            )
            ON CONFLICT(data_type, symbol, period, start_date, end_date) DO UPDATE SET
                coverage_rate=excluded.coverage_rate,
                status=excluded.status,
                checked_at=excluded.checked_at
            """,
            (current,),
        )
        connection.commit()

    strategy_id = client.post(
        "/api/strategies/import",
        json={
            "file_name": "minute_incomplete_window_strategy.py",
            "code_content": '''
class Strategy:
    name = "分钟窗口Bar数不完整检查策略"
    version = "1.0.0"
    description = "声明三分钟窗口，但本地只落了两根1分钟K。"
    params = {
        "start_time": "09:50:00",
        "end_time": "09:52:00",
    }

    def __init__(self, context):
        self.context = context

    def run(self):
        self.context.get_minute_bars("603772.SH", "2026-05-06 09:50:00", "2026-05-06 09:52:00")
        return []
''',
        },
    ).json()["data"]["id"]

    check_response = client.post(
        "/api/backtests/check-data",
        json={
            "strategy_id": strategy_id,
            "start_date": "2026-05-06",
            "end_date": "2026-05-06",
            "data_frequency": "分钟K",
            "fill_mode": "正式分钟回放",
        },
    )
    check_body = check_response.json()["data"]
    buy_window_step = next(step for step in check_body["steps"] if step["title"] == "分钟窗口-策略买入扫描窗口")

    assert check_response.status_code == 200
    assert check_body["ok"] is False
    assert "分钟K关键时间窗口数据不完整" in check_body["message"]
    assert buy_window_step["status"] == "failed"
    assert '"expected_bars_per_symbol_day": 3' in buy_window_step["technical_detail"]
    assert '"complete_symbol_days": 0' in buy_window_step["technical_detail"]


def test_minute_backtest_precheck_uses_trigger_end_and_baseline_windows():
    client = TestClient(app)
    current = "2026-05-10 10:00:00"
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO stock_basic(symbol, name, market, security_type, list_status, is_st, updated_at)
            VALUES ('603774.SH', '基准窗口样本', 'SH', '股票', '上市', 0, ?)
            ON CONFLICT(symbol) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at
            """,
            (current,),
        )
        connection.execute(
            """
            INSERT INTO daily_kline(symbol, trade_date, open, high, low, close, volume, amount, created_at)
            VALUES ('603774.SH', '2026-05-06', 10, 10.2, 9.9, 10.1, 100000, 1000000, ?)
            ON CONFLICT(symbol, trade_date) DO UPDATE SET close=excluded.close
            """,
            (current,),
        )
        connection.executemany(
            """
            INSERT INTO minute_kline(symbol, datetime, period, open, high, low, close, volume, amount, created_at)
            VALUES ('603774.SH', ?, '1m', 10, 10.1, 9.9, 10, 10000, 30000000, ?)
            ON CONFLICT(symbol, period, datetime) DO UPDATE SET close=excluded.close
            """,
            [
                ("2026-05-06 09:50:00", current),
                ("2026-05-06 09:51:00", current),
                ("2026-05-06 09:52:00", current),
            ],
        )
        connection.execute(
            """
            INSERT INTO data_coverage(
                data_type, symbol, period, start_date, end_date, expected_trading_days,
                actual_trading_days, expected_rows, actual_rows, missing_days,
                duplicate_rows, coverage_rate, status, checked_at
            ) VALUES (
                'minute_kline', 'ALL', '1m', '2026-05-06', '2026-05-06', 1,
                1, 1, 1, '[]', 0, 100, 'complete', ?
            )
            ON CONFLICT(data_type, symbol, period, start_date, end_date) DO UPDATE SET
                coverage_rate=excluded.coverage_rate,
                status=excluded.status,
                checked_at=excluded.checked_at
            """,
            (current,),
        )
        connection.commit()

    strategy_id = client.post(
        "/api/strategies/import",
        json={
            "file_name": "minute_trigger_end_baseline_strategy.py",
            "code_content": '''
class Strategy:
    name = "分钟trigger_end基准窗口检查策略"
    version = "1.0.0"
    description = "使用 trigger_end_time 和 baseline_start_time，验证回测前检查不会漏掉买入前基准窗口。"
    params = {
        "baseline_start_time": "09:30:00",
        "start_time": "09:50:00",
        "trigger_end_time": "09:52:00",
        "fallback_exit_time": "14:50:00",
    }

    def __init__(self, context):
        self.context = context

    def run(self):
        self.context.get_minute_bars("603774.SH", "2026-05-06 09:30:00", "2026-05-06 09:52:00")
        return []
''',
        },
    ).json()["data"]["id"]

    check_response = client.post(
        "/api/backtests/check-data",
        json={
            "strategy_id": strategy_id,
            "start_date": "2026-05-06",
            "end_date": "2026-05-06",
            "data_frequency": "分钟K",
            "fill_mode": "正式分钟回放",
        },
    )
    check_body = check_response.json()["data"]
    steps = {step["title"]: step for step in check_body["steps"]}

    assert check_response.status_code == 200
    assert check_body["ok"] is False
    assert steps["分钟窗口-策略买入扫描窗口"]["status"] == "success"
    assert steps["分钟窗口-买入前基准窗口"]["status"] == "failed"
    assert '"expected_bars_per_symbol_day": 23' in steps["分钟窗口-买入前基准窗口"]["technical_detail"]
    assert steps["分钟窗口-兜底卖出窗口"]["status"] == "failed"


def test_minute_backtest_window_expected_units_use_requested_range_not_covering_record():
    client = TestClient(app)
    current = "2026-05-10 10:00:00"
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO stock_basic(symbol, name, market, security_type, list_status, is_st, updated_at)
            VALUES ('603775.SH', '覆盖大区间样本', 'SH', '股票', '上市', 0, ?)
            ON CONFLICT(symbol) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at
            """,
            (current,),
        )
        connection.execute(
            """
            INSERT INTO daily_kline(symbol, trade_date, open, high, low, close, volume, amount, created_at)
            VALUES ('603775.SH', '2026-05-06', 10, 10.2, 9.9, 10.1, 100000, 1000000, ?)
            ON CONFLICT(symbol, trade_date) DO UPDATE SET close=excluded.close
            """,
            (current,),
        )
        connection.executemany(
            """
            INSERT INTO minute_kline(symbol, datetime, period, open, high, low, close, volume, amount, created_at)
            VALUES ('603775.SH', ?, '1m', 10, 10.1, 9.9, 10, 10000, 30000000, ?)
            ON CONFLICT(symbol, period, datetime) DO UPDATE SET close=excluded.close
            """,
            [
                ("2026-05-06 09:50:00", current),
                ("2026-05-06 09:51:00", current),
                ("2026-05-06 09:52:00", current),
            ],
        )
        connection.execute(
            """
            INSERT INTO data_coverage(
                data_type, symbol, period, start_date, end_date, expected_trading_days,
                actual_trading_days, expected_rows, actual_rows, missing_days,
                duplicate_rows, coverage_rate, status, checked_at
            ) VALUES (
                'minute_kline', 'ALL', '1m', '2026-01-01', '2026-05-08', 100,
                100, 100, 100, '[]', 0, 100, 'complete', ?
            )
            ON CONFLICT(data_type, symbol, period, start_date, end_date) DO UPDATE SET
                coverage_rate=excluded.coverage_rate,
                status=excluded.status,
                checked_at=excluded.checked_at
            """,
            (current,),
        )
        connection.commit()

    strategy_id = client.post(
        "/api/strategies/import",
        json={
            "file_name": "minute_covering_record_expected_units_strategy.py",
            "code_content": '''
class Strategy:
    name = "分钟覆盖大区间预期单位检查策略"
    version = "1.0.0"
    description = "验证回测窗口预期单位使用本次请求区间，而不是覆盖率大区间 expected_rows。"
    params = {
        "start_time": "09:50:00",
        "trigger_end_time": "09:52:00",
    }

    def __init__(self, context):
        self.context = context

    def run(self):
        self.context.get_minute_bars("603775.SH", "2026-05-06 09:50:00", "2026-05-06 09:52:00")
        return []
''',
        },
    ).json()["data"]["id"]

    check_response = client.post(
        "/api/backtests/check-data",
        json={
            "strategy_id": strategy_id,
            "start_date": "2026-05-06",
            "end_date": "2026-05-06",
            "data_frequency": "分钟K",
            "fill_mode": "正式分钟回放",
        },
    )
    check_body = check_response.json()["data"]
    buy_window_step = next(step for step in check_body["steps"] if step["title"] == "分钟窗口-策略买入扫描窗口")

    assert check_response.status_code == 200
    assert check_body["ok"] is True
    assert buy_window_step["status"] == "success"
    assert '"expected_symbol_days": 1' in buy_window_step["technical_detail"]
    assert '"expected_symbol_days_source": "requested_range_daily_tradable_symbol_days"' in buy_window_step["technical_detail"]
    assert "1/1 个股票-交易日" in buy_window_step["message"]


def test_minute_backtest_check_warns_when_full_day_minute_baseline_is_thin():
    client = TestClient(app)
    current = "2026-05-10 10:00:00"
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO stock_basic(symbol, name, market, security_type, list_status, is_st, updated_at)
            VALUES ('603773.SH', '全日基线样本', 'SH', '股票', '上市', 0, ?)
            ON CONFLICT(symbol) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at
            """,
            (current,),
        )
        connection.execute(
            """
            INSERT INTO daily_kline(symbol, trade_date, open, high, low, close, volume, amount, created_at)
            VALUES ('603773.SH', '2026-05-06', 10, 10.2, 9.9, 10.1, 100000, 1000000, ?)
            ON CONFLICT(symbol, trade_date) DO UPDATE SET close=excluded.close
            """,
            (current,),
        )
        connection.executemany(
            """
            INSERT INTO minute_kline(symbol, datetime, period, open, high, low, close, volume, amount, created_at)
            VALUES ('603773.SH', ?, '1m', 10, 10.1, 9.9, 10, 10000, 30000000, ?)
            ON CONFLICT(symbol, period, datetime) DO UPDATE SET close=excluded.close
            """,
            [
                ("2026-05-06 09:50:00", current),
                ("2026-05-06 09:51:00", current),
                ("2026-05-06 09:52:00", current),
            ],
        )
        connection.commit()

    strategy_id = client.post(
        "/api/strategies/import",
        json={
            "file_name": "minute_full_day_baseline_warning_strategy.py",
            "code_content": '''
class Strategy:
    name = "全日分钟K基线提示策略"
    version = "1.0.0"
    description = "关键窗口完整，但全日分钟K不足，用于验证非阻断提示。"
    params = {
        "start_time": "09:50:00",
        "end_time": "09:52:00",
    }

    def __init__(self, context):
        self.context = context

    def run(self):
        self.context.get_minute_bars("603773.SH", "2026-05-06 09:50:00", "2026-05-06 09:52:00")
        return []
''',
        },
    ).json()["data"]["id"]

    check_response = client.post(
        "/api/backtests/check-data",
        json={
            "strategy_id": strategy_id,
            "start_date": "2026-05-06",
            "end_date": "2026-05-06",
            "data_frequency": "分钟K",
            "fill_mode": "正式分钟回放",
        },
    )
    check_body = check_response.json()["data"]
    full_day_step = next(step for step in check_body["steps"] if step["title"] == "全日分钟K基线")

    assert check_response.status_code == 200
    assert check_body["ok"] is True
    assert full_day_step["status"] == "warning"
    assert "全日分钟K基线需核对" in full_day_step["message"]
    assert '"minimum_expected_bars_per_symbol_day": 240' in full_day_step["technical_detail"]
    assert '"check_level": "warning_only"' in full_day_step["technical_detail"]


def test_minute_backtest_full_day_baseline_uses_complete_coverage_record_fast_path():
    client = TestClient(app)
    current = "2026-05-10 10:20:00"
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO stock_basic(symbol, name, market, security_type, list_status, is_st, updated_at)
            VALUES ('603775.SH', '全日快速验收样本', 'SH', '股票', '上市', 0, ?)
            ON CONFLICT(symbol) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at
            """,
            (current,),
        )
        connection.execute(
            """
            INSERT INTO daily_kline(symbol, trade_date, open, high, low, close, volume, amount, created_at)
            VALUES ('603775.SH', '2026-05-08', 10, 10.2, 9.9, 10.1, 100000, 1000000, ?)
            ON CONFLICT(symbol, trade_date) DO UPDATE SET close=excluded.close
            """,
            (current,),
        )
        connection.executemany(
            """
            INSERT INTO minute_kline(symbol, datetime, period, open, high, low, close, volume, amount, created_at)
            VALUES ('603775.SH', ?, '1m', 10, 10.1, 9.9, 10, 10000, 30000000, ?)
            ON CONFLICT(symbol, period, datetime) DO UPDATE SET close=excluded.close
            """,
            [
                ("2026-05-08 09:50:00", current),
                ("2026-05-08 09:51:00", current),
                ("2026-05-08 09:52:00", current),
            ],
        )
        connection.execute(
            """
            INSERT INTO data_coverage(
                data_type, symbol, period, start_date, end_date, expected_trading_days,
                actual_trading_days, expected_rows, actual_rows, missing_days,
                duplicate_rows, coverage_rate, status, checked_at
            ) VALUES (
                'minute_kline', 'ALL', '1m', '2026-01-01', '2026-05-08', 80,
                80, 100, 100, '[]', 0, 100, 'complete', ?
            )
            ON CONFLICT(data_type, symbol, period, start_date, end_date) DO UPDATE SET
                expected_rows=excluded.expected_rows,
                actual_rows=excluded.actual_rows,
                coverage_rate=excluded.coverage_rate,
                status=excluded.status,
                checked_at=excluded.checked_at
            """,
            (current,),
        )
        connection.commit()

    strategy_id = client.post(
        "/api/strategies/import",
        json={
            "file_name": "minute_full_day_baseline_fast_path_strategy.py",
            "code_content": '''
class Strategy:
    name = "全日分钟K基线快速验收策略"
    version = "1.0.0"
    description = "覆盖率记录 complete 时，全日基线不重复扫描大表。"
    params = {
        "start_time": "09:50:00",
        "end_time": "09:52:00",
    }

    def __init__(self, context):
        self.context = context

    def run(self):
        self.context.get_minute_bars("603775.SH", "2026-05-08 09:50:00", "2026-05-08 09:52:00")
        return []
''',
        },
    ).json()["data"]["id"]

    check_response = client.post(
        "/api/backtests/check-data",
        json={
            "strategy_id": strategy_id,
            "start_date": "2026-05-08",
            "end_date": "2026-05-08",
            "data_frequency": "分钟K",
            "fill_mode": "正式分钟回放",
        },
    )
    check_body = check_response.json()["data"]
    full_day_step = next(step for step in check_body["steps"] if step["title"] == "全日分钟K基线")

    assert check_response.status_code == 200
    assert check_body["ok"] is True
    assert full_day_step["status"] == "success"
    assert "覆盖率记录" in full_day_step["message"]
    assert '"check_level": "coverage_record_fast_path"' in full_day_step["technical_detail"]


def test_minute_full_day_bar_baseline_stats_counts_complete_symbol_days():
    symbol = "TBASE001.SH"
    trade_date = "2099-01-02"
    current = "2026-05-20 19:30:00"

    morning_start = datetime.strptime(f"{trade_date} 09:31:00", "%Y-%m-%d %H:%M:%S")
    afternoon_start = datetime.strptime(f"{trade_date} 13:01:00", "%Y-%m-%d %H:%M:%S")
    bar_times = [
        (morning_start + timedelta(minutes=index)).strftime("%Y-%m-%d %H:%M:%S")
        for index in range(120)
    ] + [
        (afternoon_start + timedelta(minutes=index)).strftime("%Y-%m-%d %H:%M:%S")
        for index in range(120)
    ]

    with get_connection() as connection:
        connection.execute("DELETE FROM minute_kline WHERE symbol = ?", (symbol,))
        connection.executemany(
            """
            INSERT INTO minute_kline(symbol, datetime, period, open, high, low, close, volume, amount, created_at)
            VALUES (?, ?, '1m', 10, 10.1, 9.9, 10, 10000, 1000000, ?)
            """,
            [(symbol, bar_time, current) for bar_time in bar_times],
        )
        connection.commit()

    stats = BacktestRepository().minute_full_day_bar_baseline_stats(trade_date, trade_date)

    assert stats["minute_rows"] == 240
    assert stats["symbols"] == 1
    assert stats["trading_days"] == 1
    assert stats["covered_units"] == 1
    assert stats["complete_units"] == 1
    assert stats["incomplete_units"] == 0
    assert stats["min_bars_per_unit"] == 240
    assert stats["max_bars_per_unit"] == 240
    assert stats["minimum_expected_bars_per_unit"] == 240
    assert stats["session_scope"] == "09:30:00-11:30:00,13:00:00-15:00:00"


def test_minute_strategy_backtest_can_simulate_buy_trades():
    client = TestClient(app)
    current = "2026-05-10 10:00:00"
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO stock_basic(symbol, name, market, security_type, list_status, is_st, updated_at)
            VALUES ('603777.SH', '分钟回测样本', 'SH', '股票', '上市', 0, ?)
            ON CONFLICT(symbol) DO UPDATE SET name=excluded.name, list_status=excluded.list_status, updated_at=excluded.updated_at
            """,
            (current,),
        )
        connection.execute(
            """
            INSERT INTO instrument_detail(
                symbol, exchange_id, instrument_id, instrument_name, exchange_code, open_date, expire_date,
                pre_close, up_stop_price, down_stop_price, is_trading, instrument_status,
                total_volume, float_volume, trading_day, raw_json, sync_time
            )
            VALUES ('603777.SH', 'SH', '603777', '分钟回测样本', 'SH', '2020-01-01', '99999999',
                10, 11, 9, 1, '正常', 5000000000, 4000000000, '2026-05-08', '{}', ?)
            ON CONFLICT(symbol) DO UPDATE SET total_volume=excluded.total_volume, instrument_name=excluded.instrument_name, sync_time=excluded.sync_time
            """,
            (current,),
        )
        connection.executemany(
            """
            INSERT INTO daily_kline(symbol, trade_date, open, high, low, close, volume, amount, created_at)
            VALUES ('603777.SH', ?, ?, ?, ?, ?, 100000, 1000000, ?)
            ON CONFLICT(symbol, trade_date) DO UPDATE SET open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close
            """,
            [
                ("2026-05-05", 10, 11, 9, 10, current),
                ("2026-05-06", 10, 11, 9, 10, current),
                ("2026-05-07", 10.2, 11, 10, 10.5, current),
                ("2026-05-08", 10.4, 11, 10, 10.6, current),
            ],
        )
        connection.executemany(
            """
            INSERT INTO minute_kline(symbol, datetime, period, open, high, low, close, volume, amount, created_at)
            VALUES ('603777.SH', ?, '1m', 10, 10.2, 9.9, ?, 10000, 60000000, ?)
            ON CONFLICT(symbol, period, datetime) DO UPDATE SET close=excluded.close, amount=excluded.amount
            """,
            [
                ("2026-05-06 09:30:00", 10.1, current),
                ("2026-05-06 09:31:00", 10.15, current),
                ("2026-05-06 09:32:00", 10.2, current),
                ("2026-05-06 09:33:00", 10.3, current),
            ],
        )
        connection.commit()

    strategy_id = client.post(
        "/api/strategies/import",
        json={
            "file_name": "minute_backtest_buy_strategy.py",
            "code_content": '''
class Strategy:
    name = "分钟回测买入策略"
    version = "1.0.0"
    description = "用于验证分钟K信号可在回测中本地撮合买入。"
    params = {}

    def __init__(self, context):
        self.context = context

    def run(self):
        universe = self.context.get_stock_universe(100, 1000, "2026-05-06", "2026-05-08", 20)
        symbols = [item["symbol"] for item in universe]
        names = {item["symbol"]: item["name"] for item in universe}
        triggers = self.context.find_minute_amount_triggers(symbols, "2026-05-06", "2026-05-08", "09:30:00", "10:30:00", 50000000, 3, 5)
        return [{
            "symbol": item["symbol"],
            "name": names.get(item["symbol"], item["symbol"]),
            "action": "BUY",
            "price": item["trigger_price"],
            "amount": 100000,
            "reason": "分钟K连续放量，回测本地撮合买入。",
            "signal_time": item["trigger_time"],
        } for item in triggers]
''',
        },
    ).json()["data"]["id"]

    check_response = client.post(
        "/api/backtests/check-data",
        json={
            "strategy_id": strategy_id,
            "start_date": "2026-05-06",
            "end_date": "2026-05-08",
            "data_frequency": "分钟K",
        },
    )
    assert check_response.status_code == 200
    assert check_response.json()["data"]["ok"] is True

    create_response = client.post(
        "/api/backtests",
        json={
            "strategy_id": strategy_id,
            "backtest_name": "分钟K本地撮合买入检查",
            "start_date": "2026-05-06",
            "end_date": "2026-05-08",
            "initial_cash": 1000000,
            "single_order_amount": 100000,
            "data_frequency": "分钟K",
            "fill_mode": "正式分钟回放",
            "fee_rate": 0.0003,
            "stamp_tax_rate": 0.001,
            "slippage": 0,
        },
    )
    assert create_response.status_code == 200
    task_id = create_response.json()["data"]["task_id"]

    assert wait_for_task(client, task_id, timeout=20)["status"] == "success"
    result = client.get(f"/api/backtests/{task_id}/result").json()["data"]
    trades_page = client.get(f"/api/backtests/{task_id}/trades?page=1&page_size=200").json()["data"]
    trades = trades_page["items"]

    assert result["trade_count"] >= 1
    sample_trade = next(trade for trade in trades if trade["symbol"] == "603777.SH" and trade["side"] == "BUY")
    assert sample_trade["trade_time"] == "2026-05-06 09:33:00"
    assert sample_trade["price"] == 10.0
    assert "信号时间 2026-05-06 09:32:00" in sample_trade["reason"]
    report = client.get(f"/api/backtests/{task_id}/report").json()["data"]
    universe = json.loads(report["manifest"]["universe_summary"])
    rules = json.loads(report["manifest"]["rule_snapshot"])

    assert universe["minute_bar_count"] >= 4
    assert universe["minute_scanned_trade_days"] >= 1
    assert universe["minute_possible_truncation"] is False
    assert rules["minute_market_cap_basis"] == "previous_visible_daily_bar"
    assert rules["minute_mode"] == "minute_replay"
    assert universe["minute_mode"] == "minute_replay"
    signals_page = client.get(f"/api/backtests/{task_id}/signals?page=1&page_size=200").json()["data"]
    logs_page = client.get(f"/api/backtests/{task_id}/logs?page=1&page_size=200").json()["data"]
    buy_trades_page = client.get(f"/api/backtests/{task_id}/trades?page=1&page_size=200&status=BUY").json()["data"]
    symbol_trades_page = client.get(f"/api/backtests/{task_id}/trades?page=1&page_size=200&keyword=603777.SH").json()["data"]
    day_trades_page = client.get(f"/api/backtests/{task_id}/trades?page=1&page_size=200&start_date=2026-05-06&end_date=2026-05-06&sort_field=trade_time&sort_order=asc").json()["data"]
    outside_day_trades_page = client.get(f"/api/backtests/{task_id}/trades?page=1&page_size=200&start_date=2026-05-01&end_date=2026-05-01").json()["data"]
    matched_signals_page = client.get(f"/api/backtests/{task_id}/signals?page=1&page_size=200&status=已成交").json()["data"]
    signal_keyword_page = client.get(f"/api/backtests/{task_id}/signals?page=1&page_size=200&keyword=分钟K连续放量").json()["data"]
    day_signals_page = client.get(f"/api/backtests/{task_id}/signals?page=1&page_size=200&start_date=2026-05-06&end_date=2026-05-06&sort_field=signal_time&sort_order=asc").json()["data"]
    outside_day_signals_page = client.get(f"/api/backtests/{task_id}/signals?page=1&page_size=200&start_date=2026-05-01&end_date=2026-05-01").json()["data"]
    info_logs_page = client.get(f"/api/backtests/{task_id}/logs?page=1&page_size=200&status=info").json()["data"]
    assert buy_trades_page["total"] >= 1
    assert all(trade["side"] == "BUY" for trade in buy_trades_page["items"])
    assert symbol_trades_page["total"] >= 1
    assert all("603777.SH" in trade["symbol"] for trade in symbol_trades_page["items"])
    assert day_trades_page["total"] >= 1
    assert all(trade["trade_time"].startswith("2026-05-06") for trade in day_trades_page["items"])
    assert outside_day_trades_page["total"] == 0
    assert matched_signals_page["total"] >= 1
    assert all(signal["status"] == "已成交" for signal in matched_signals_page["items"])
    assert signal_keyword_page["total"] >= 1
    assert all("分钟K连续放量" in signal["reason"] for signal in signal_keyword_page["items"])
    assert day_signals_page["total"] >= 1
    assert all(signal["signal_time"].startswith("2026-05-06") for signal in day_signals_page["items"])
    assert outside_day_signals_page["total"] == 0
    assert info_logs_page["total"] >= 1
    assert all(log["level"] == "info" for log in info_logs_page["items"])
    equity = client.get(f"/api/backtests/{task_id}/equity").json()["data"]
    export_response = client.get(f"/api/backtests/{task_id}/export")
    assert export_response.status_code == 200
    assert "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" in export_response.headers["content-type"]
    with zipfile.ZipFile(BytesIO(export_response.content)) as workbook:
        names = set(workbook.namelist())
        expected_sheet_names = [
            "回测汇总",
            "成交明细",
            "信号审计",
            "资金曲线",
            "回撤曲线",
            "回测日志",
            "可信快照",
            "运行参数",
            "数据覆盖快照",
            "股票池摘要",
            "规则快照",
        ]
        assert "xl/workbook.xml" in names
        for index in range(1, len(expected_sheet_names) + 1):
            assert f"xl/worksheets/sheet{index}.xml" in names
        workbook_xml = workbook.read("xl/workbook.xml").decode("utf-8")
        for sheet_name in expected_sheet_names:
            assert sheet_name in workbook_xml

        sheet_text = {
            index: workbook.read(f"xl/worksheets/sheet{index}.xml").decode("utf-8")
            for index in range(1, len(expected_sheet_names) + 1)
        }
        assert "任务ID" in sheet_text[1]
        assert task_id in sheet_text[1]
        assert "策略名称" in sheet_text[1]
        assert "成交时间" in sheet_text[2]
        assert "603777.SH" in sheet_text[2]
        assert "2026-05-06 09:33:00" in sheet_text[2]
        assert "信号时间" in sheet_text[3]
        assert "是否自动卖出" in sheet_text[3]
        assert "日期" in sheet_text[4]
        assert "权益" in sheet_text[4]
        assert "回撤" in sheet_text[5]
        assert "中文说明" in sheet_text[6]
        assert "技术详情" in sheet_text[6]
        assert "可信等级" in sheet_text[7]
        assert "规则快照" in sheet_text[7]
        assert "成交模式" in sheet_text[8]
        assert "分钟K" in sheet_text[8]
        assert "覆盖率" in sheet_text[9]
        assert "minute_bar_count" in sheet_text[10]
        assert "minute_replay" in sheet_text[11]

        summary_rows = _xlsx_sheet_rows(workbook, 1)
        summary_by_field = {str(row[1]): row[2] for row in summary_rows[1:] if len(row) >= 3}
        assert summary_by_field["任务ID"] == task_id
        assert summary_by_field["回测名称"] == "分钟K本地撮合买入检查"
        assert summary_by_field["数据频率"] == "分钟K"
        assert int(summary_by_field["成交明细条数"]) == trades_page["total"]
        assert int(summary_by_field["信号审计条数"]) == signals_page["total"]
        assert int(summary_by_field["日志条数"]) == logs_page["total"]
        assert int(summary_by_field["成交次数"]) == result["trade_count"]
        assert int(summary_by_field["买入次数"]) == result["buy_count"]
        assert int(summary_by_field["卖出次数"]) == result["sell_count"]
        assert abs(_number(summary_by_field["最终权益"]) - float(result["final_cash"])) < 1e-6
        assert abs(_number(summary_by_field["总费用"]) - float(result["total_fee"])) < 1e-6
        assert abs(_number(summary_by_field["已实现盈亏"]) - float(result["realized_pnl"])) < 1e-6

        trade_rows = _xlsx_rows_as_dicts(_xlsx_sheet_rows(workbook, 2))
        exported_sample_trade = next(row for row in trade_rows if row["股票代码"] == sample_trade["symbol"] and row["方向"] == "BUY")
        assert exported_sample_trade["成交时间"] == sample_trade["trade_time"]
        assert abs(_number(exported_sample_trade["价格"]) - float(sample_trade["price"])) < 1e-6
        assert int(exported_sample_trade["数量"]) == sample_trade["quantity"]
        assert abs(_number(exported_sample_trade["成交金额"]) - float(sample_trade["amount"])) < 1e-6

        signal_rows = _xlsx_rows_as_dicts(_xlsx_sheet_rows(workbook, 3))
        equity_rows = _xlsx_rows_as_dicts(_xlsx_sheet_rows(workbook, 4))
        drawdown_rows = _xlsx_rows_as_dicts(_xlsx_sheet_rows(workbook, 5))
        log_rows = _xlsx_rows_as_dicts(_xlsx_sheet_rows(workbook, 6))
        assert len(signal_rows) == signals_page["total"]
        assert len(equity_rows) == len(equity)
        assert len(drawdown_rows) == len(equity)
        assert len(log_rows) == logs_page["total"]
        assert len(equity_rows) >= 1
        last_equity_row = equity_rows[-1]
        last_drawdown_row = drawdown_rows[-1]
        assert abs(_number(last_equity_row["权益"]) - float(result["final_cash"])) < 1e-6
        assert abs(_number(last_equity_row["现金"]) - float(result["ending_cash"])) < 1e-6
        assert abs(_number(last_equity_row["持仓市值"]) - float(result["open_market_value"])) < 1e-6
        assert last_drawdown_row["日期"] == last_equity_row["日期"]
        assert abs(_number(last_drawdown_row["权益"]) - _number(last_equity_row["权益"])) < 1e-6
        assert abs(_number(last_drawdown_row["回撤"]) - _number(last_equity_row["回撤"])) < 1e-6

        runtime_rows = _xlsx_rows_as_dicts(_xlsx_sheet_rows(workbook, 8))
        runtime_by_field = {str(row["字段"]): row["值"] for row in runtime_rows}
        assert runtime_by_field["任务ID"] == task_id
        assert runtime_by_field["开始日期"] == "2026-05-06"
        assert runtime_by_field["结束日期"] == "2026-05-08"
        assert runtime_by_field["数据频率"] == "分钟K"
        assert runtime_by_field["成交模式"] == "正式分钟回放"
        assert runtime_by_field["可信等级"] == report["manifest"]["trust_level"]

        coverage_rows = _xlsx_rows_as_dicts(_xlsx_sheet_rows(workbook, 9))
        assert any(row["数据类型"] == "daily_kline" for row in coverage_rows)
        assert any(row["数据类型"] == "minute_kline" for row in coverage_rows)
        assert any(row["请求开始"] == "2026-05-06" and row["请求结束"] == "2026-05-08" for row in coverage_rows)

        universe_rows = _xlsx_rows_as_dicts(_xlsx_sheet_rows(workbook, 10))
        universe_by_field = {str(row["字段"]): row["值"] for row in universe_rows}
        assert int(universe_by_field["minute_bar_count"]) >= 4
        assert int(universe_by_field["minute_scanned_trade_days"]) >= 1
        assert universe_by_field["minute_mode"] == "minute_replay"

        rule_rows = _xlsx_rows_as_dicts(_xlsx_sheet_rows(workbook, 11))
        rule_by_field = {str(row["字段"]): row["值"] for row in rule_rows}
        assert rule_by_field["minute_market_cap_basis"] == "previous_visible_daily_bar"
        assert rule_by_field["minute_mode"] == "minute_replay"

    with get_connection() as connection:
        operation = connection.execute(
            """
            SELECT target_id, message, technical_detail
            FROM operation_log
            WHERE module = '回测研究' AND action = '导出回测记录'
            ORDER BY id DESC
            LIMIT 1
            """
        ).fetchone()
    assert operation is not None
    assert operation["target_id"].startswith(f"backtest_{task_id}_完整记录_")
    assert operation["target_id"].endswith(".xlsx")
    assert "分钟K本地撮合买入检查" in operation["message"]
    detail = json.loads(operation["technical_detail"])
    assert detail["task_id"] == task_id
    assert detail["backtest_name"] == "分钟K本地撮合买入检查"
    assert detail["strategy_name"] == report["task"]["strategy_name"]
    assert detail["data_frequency"] == "分钟K"
    assert detail["trade_count"] == trades_page["total"]
    assert detail["signal_count"] == signals_page["total"]
    assert detail["equity_count"] == len(equity)
    assert detail["log_count"] == logs_page["total"]
    assert detail["file_path"].endswith(operation["target_id"])
    assert "运行参数" in detail["workbook_sheets"]
    assert "数据覆盖快照" in detail["workbook_sheets"]
    assert "股票池摘要" in detail["workbook_sheets"]
    assert "规则快照" in detail["workbook_sheets"]


def test_minute_backtest_manifest_marks_possible_signal_truncation():
    client = TestClient(app)
    current = "2026-05-10 10:00:00"
    symbols = ["603780.SH", "603781.SH"]
    with get_connection() as connection:
        for symbol in symbols:
            connection.execute(
                """
                INSERT INTO stock_basic(symbol, name, market, security_type, list_status, is_st, updated_at)
                VALUES (?, ?, 'SH', '股票', '上市', 0, ?)
                ON CONFLICT(symbol) DO UPDATE SET name=excluded.name, list_status=excluded.list_status, updated_at=excluded.updated_at
                """,
                (symbol, f"截断样本{symbol[-5]}", current),
            )
            connection.execute(
                """
                INSERT INTO instrument_detail(
                    symbol, exchange_id, instrument_id, instrument_name, exchange_code, open_date, expire_date,
                    pre_close, up_stop_price, down_stop_price, is_trading, instrument_status,
                    total_volume, float_volume, trading_day, raw_json, sync_time
                )
                VALUES (?, 'SH', ?, ?, 'SH', '2020-01-01', '99999999',
                    10, 11, 9, 1, '正常', 5000000000, 4000000000, '2026-05-08', '{}', ?)
                ON CONFLICT(symbol) DO UPDATE SET total_volume=excluded.total_volume, instrument_name=excluded.instrument_name, sync_time=excluded.sync_time
                """,
                (symbol, symbol[:6], f"截断样本{symbol[-5]}", current),
            )
            connection.executemany(
                """
                INSERT INTO daily_kline(symbol, trade_date, open, high, low, close, volume, amount, created_at)
                VALUES (?, ?, 10, 11, 9, 10, 100000, 1000000, ?)
                ON CONFLICT(symbol, trade_date) DO UPDATE SET close=excluded.close
                """,
                [(symbol, "2026-05-05", current), (symbol, "2026-05-06", current), (symbol, "2026-05-07", current)],
            )
            connection.executemany(
                """
                INSERT INTO minute_kline(symbol, datetime, period, open, high, low, close, volume, amount, created_at)
                VALUES (?, ?, '1m', 10, 10.2, 9.9, 10.1, 10000, 60000000, ?)
                ON CONFLICT(symbol, period, datetime) DO UPDATE SET amount=excluded.amount
                """,
                [
                    (symbol, "2026-05-06 09:30:00", current),
                    (symbol, "2026-05-06 09:31:00", current),
                    (symbol, "2026-05-06 09:32:00", current),
                    (symbol, "2026-05-06 09:33:00", current),
                ],
            )
        connection.commit()

    strategy_id = client.post(
        "/api/strategies/import",
        json={
            "file_name": "minute_backtest_truncation_strategy.py",
            "code_content": '''
class Strategy:
    name = "分钟截断诊断策略"
    version = "1.0.0"
    description = "用于验证分钟信号返回上限诊断。"
    params = {"max_signals": 1}

    def __init__(self, context):
        self.context = context

    def run(self):
        triggers = self.context.find_minute_amount_triggers(["603780.SH", "603781.SH"], "2026-05-06", "2026-05-06", "09:30:00", "10:30:00", 50000000, 3, self.params["max_signals"])
        return [{
            "symbol": item["symbol"],
            "name": item["symbol"],
            "action": "BUY",
            "price": item["trigger_price"],
            "amount": 10000,
            "reason": "分钟K连续放量，验证返回上限。",
            "signal_time": item["trigger_time"],
        } for item in triggers]
''',
        },
    ).json()["data"]["id"]

    create_response = client.post(
        "/api/backtests",
        json={
            "strategy_id": strategy_id,
            "backtest_name": "分钟K截断诊断",
            "start_date": "2026-05-06",
            "end_date": "2026-05-07",
            "initial_cash": 1000000,
            "single_order_amount": 10000,
            "data_frequency": "分钟K",
            "fill_mode": "正式分钟回放",
            "fee_rate": 0.0003,
            "stamp_tax_rate": 0.001,
            "slippage": 0,
        },
    )
    task_id = create_response.json()["data"]["task_id"]

    assert create_response.status_code == 200
    assert wait_for_task(client, task_id, timeout=20)["status"] == "success"
    report = client.get(f"/api/backtests/{task_id}/report").json()["data"]
    universe = json.loads(report["manifest"]["universe_summary"])

    assert universe["minute_return_limit"] == 1
    assert universe["minute_possible_truncation"] is True
    assert universe["minute_limit_hit_days"] >= 1
    assert report["manifest"]["trust_level"] == "technical"


def test_minute_backtest_auto_exit_uses_stop_loss_take_profit_and_fallback_rule():
    client = TestClient(app)
    current = "2026-05-10 10:00:00"
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO stock_basic(symbol, name, market, security_type, list_status, is_st, updated_at)
            VALUES ('603786.SH', '止盈止损样本', 'SH', '股票', '上市', 0, ?)
            ON CONFLICT(symbol) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at
            """,
            (current,),
        )
        connection.execute(
            """
            INSERT INTO instrument_detail(
                symbol, exchange_id, instrument_id, instrument_name, exchange_code, open_date, expire_date,
                pre_close, up_stop_price, down_stop_price, is_trading, instrument_status,
                total_volume, float_volume, trading_day, raw_json, sync_time
            )
            VALUES ('603786.SH', 'SH', '603786', '止盈止损样本', 'SH', '2020-01-01', '99999999',
                10, 11, 9, 1, '正常', 5000000000, 4000000000, '2026-05-07', '{}', ?)
            ON CONFLICT(symbol) DO UPDATE SET total_volume=excluded.total_volume, instrument_name=excluded.instrument_name, sync_time=excluded.sync_time
            """,
            (current,),
        )
        connection.executemany(
            """
            INSERT INTO daily_kline(symbol, trade_date, open, high, low, close, volume, amount, created_at)
            VALUES ('603786.SH', ?, ?, ?, ?, ?, 100000, 1000000, ?)
            ON CONFLICT(symbol, trade_date) DO UPDATE SET open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close
            """,
            [
                ("2026-05-05", 10, 10.5, 9.8, 10, current),
                ("2026-05-06", 10, 10.5, 9.8, 10, current),
                ("2026-05-07", 10.1, 10.8, 10, 10.6, current),
            ],
        )
        connection.executemany(
            """
            INSERT INTO minute_kline(symbol, datetime, period, open, high, low, close, volume, amount, created_at)
            VALUES ('603786.SH', ?, '1m', ?, ?, ?, ?, 10000, 60000000, ?)
            ON CONFLICT(symbol, period, datetime) DO UPDATE SET open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close, amount=excluded.amount
            """,
            [
                ("2026-05-06 09:50:00", 10, 10.1, 9.9, 10.0, current),
                ("2026-05-06 09:51:00", 10, 10.1, 9.9, 10.0, current),
                ("2026-05-06 09:52:00", 10, 10.1, 9.9, 10.0, current),
                ("2026-05-06 09:53:00", 10, 10.1, 9.9, 10.0, current),
                ("2026-05-07 09:30:00", 10.1, 10.2, 10.0, 10.1, current),
                ("2026-05-07 10:00:00", 10.5, 10.6, 10.4, 10.55, current),
                ("2026-05-07 14:50:00", 10.4, 10.45, 10.35, 10.4, current),
            ],
        )
        connection.commit()

    strategy_id = client.post(
        "/api/strategies/import",
        json={
            "file_name": "minute_backtest_stop_take_strategy.py",
            "code_content": '''
class Strategy:
    name = "分钟止盈止损策略"
    version = "1.0.0"
    description = "验证次交易日止损止盈和尾盘卖出。"
    params = {}

    def __init__(self, context):
        self.context = context

    def run(self):
        if getattr(self.context, "current_date", "") != "2026-05-06":
            return []
        minute_bars = self.context.get_minute_bars("603786.SH", "2026-05-06 09:50:00", "2026-05-06 09:52:00")
        if len(minute_bars) < 3:
            return []
        return [{
            "symbol": "603786.SH",
            "name": "止盈止损样本",
            "action": "BUY",
            "price": 10,
            "amount": 100000,
            "reason": "9:50-10:30冷静期放量，验证次日止盈。",
            "signal_time": "2026-05-06 09:52:00",
            "stop_loss_pct": 3,
            "take_profit_pct": 6,
            "exit_after_trading_days": 1,
            "fallback_exit_time": "14:50:00",
        }]
''',
        },
    ).json()["data"]["id"]

    create_response = client.post(
        "/api/backtests",
        json={
            "strategy_id": strategy_id,
            "backtest_name": "分钟止盈止损检查",
            "start_date": "2026-05-06",
            "end_date": "2026-05-07",
            "initial_cash": 1000000,
            "single_order_amount": 100000,
            "data_frequency": "分钟K",
            "fill_mode": "正式分钟回放",
            "fee_rate": 0.0003,
            "stamp_tax_rate": 0.001,
            "slippage": 0,
        },
    )
    assert create_response.status_code == 200
    task_id = create_response.json()["data"]["task_id"]

    assert wait_for_task(client, task_id, timeout=20)["status"] == "success"
    trades = client.get(f"/api/backtests/{task_id}/trades?page=1&page_size=20").json()["data"]["items"]
    sell_trade = next(trade for trade in trades if trade["side"] == "SELL")

    assert len(trades) == 2
    assert sell_trade["trade_time"] == "2026-05-07 10:00:00"
    assert sell_trade["price"] == 10.6
    assert "触发止盈 6.00%" in sell_trade["reason"]


def test_minute_context_uses_previous_daily_bar_for_market_cap_universe():
    current = "2026-05-10 10:00:00"
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO stock_basic(symbol, name, market, security_type, list_status, is_st, updated_at)
            VALUES ('603782.SH', '前日市值样本', 'SH', '股票', '上市', 0, ?)
            ON CONFLICT(symbol) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at
            """,
            (current,),
        )
        connection.execute(
            """
            INSERT INTO instrument_detail(
                symbol, exchange_id, instrument_id, instrument_name, exchange_code, open_date, expire_date,
                pre_close, up_stop_price, down_stop_price, is_trading, instrument_status,
                total_volume, float_volume, trading_day, raw_json, sync_time
            )
            VALUES ('603782.SH', 'SH', '603782', '前日市值样本', 'SH', '2020-01-01', '99999999',
                10, 11, 9, 1, '正常', 2000000000, 1000000000, '2026-05-06', '{}', ?)
            ON CONFLICT(symbol) DO UPDATE SET total_volume=excluded.total_volume, instrument_name=excluded.instrument_name, sync_time=excluded.sync_time
            """,
            (current,),
        )
        connection.executemany(
            """
            INSERT INTO daily_kline(symbol, trade_date, open, high, low, close, volume, amount, created_at)
            VALUES ('603782.SH', ?, 10, 10, 10, ?, 100000, 1000000, ?)
            ON CONFLICT(symbol, trade_date) DO UPDATE SET close=excluded.close
            """,
            [("2026-05-05", 10, current), ("2026-05-06", 100, current)],
        )
        connection.commit()

    context = BacktestStrategyContext(
        {
            "603782.SH": [
                {"trade_date": "2026-05-05", "name": "前日市值样本"},
                {"trade_date": "2026-05-06", "name": "前日市值样本"},
            ]
        },
        "2026-05-06",
        "分钟K",
    )
    universe = context.get_stock_universe(100, 1000, "2026-01-01", "2026-12-31", 20)

    assert [item["symbol"] for item in universe] == ["603782.SH"]
    assert any("避免在 2026-05-06 开盘策略中使用当日收盘价" in line for line in context.logs)


def test_minute_backtest_loader_adds_previous_daily_bar_without_extending_equity():
    current = "2026-05-10 10:00:00"
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO stock_basic(symbol, name, market, security_type, list_status, is_st, updated_at)
            VALUES ('603785.SH', '首日市值样本', 'SH', '股票', '上市', 0, ?)
            ON CONFLICT(symbol) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at
            """,
            (current,),
        )
        connection.execute(
            """
            INSERT INTO instrument_detail(
                symbol, exchange_id, instrument_id, instrument_name, exchange_code, open_date, expire_date,
                pre_close, up_stop_price, down_stop_price, is_trading, instrument_status,
                total_volume, float_volume, trading_day, raw_json, sync_time
            )
            VALUES ('603785.SH', 'SH', '603785', '首日市值样本', 'SH', '2020-01-01', '99999999',
                10, 11, 9, 1, '正常', 2000000000, 1000000000, '2026-05-06', '{}', ?)
            ON CONFLICT(symbol) DO UPDATE SET total_volume=excluded.total_volume, instrument_name=excluded.instrument_name, sync_time=excluded.sync_time
            """,
            (current,),
        )
        connection.executemany(
            """
            INSERT INTO daily_kline(symbol, trade_date, open, high, low, close, volume, amount, created_at)
            VALUES ('603785.SH', ?, 10, 10, 10, ?, 100000, 1000000, ?)
            ON CONFLICT(symbol, trade_date) DO UPDATE SET close=excluded.close
            """,
            [("2026-05-05", 10, current), ("2026-05-06", 100, current)],
        )
        connection.commit()

    task = BacktestTaskRecord(
        id=1,
        task_id="task_loader_previous_daily",
        backtest_name="首日市值样本",
        strategy_id=1,
        strategy_name="首日市值样本",
        start_date="2026-05-06",
        end_date="2026-05-06",
        initial_cash=1000000,
        single_order_amount=10000,
        data_frequency="分钟K",
        fill_mode="正式分钟回放",
        fee_rate=0.0003,
        stamp_tax_rate=0.001,
        slippage=0,
        status="running",
        created_at=current,
    )
    bars_by_symbol = DataLoader().load_daily_bars(task, ["603785.SH"])

    assert [bar.trade_date for bar in bars_by_symbol["603785.SH"]] == ["2026-05-05", "2026-05-06"]
    context = BacktestStrategyContext(
        {"603785.SH": [bar.__dict__ for bar in bars_by_symbol["603785.SH"]]},
        "2026-05-06",
        "分钟K",
    )
    universe = context.get_stock_universe(100, 1000, "2026-01-01", "2026-12-31", 20)
    equity = MetricsService().build_equity(task, bars_by_symbol, [])

    assert [item["symbol"] for item in universe] == ["603785.SH"]
    assert [row["trade_date"] for row in equity] == ["2026-05-06"]


def test_minute_strategy_backtest_can_sell_next_trading_day():
    client = TestClient(app)
    current = "2026-05-10 10:00:00"
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO stock_basic(symbol, name, market, security_type, list_status, is_st, updated_at)
            VALUES ('603778.SH', '次日卖出样本', 'SH', '股票', '上市', 0, ?)
            ON CONFLICT(symbol) DO UPDATE SET name=excluded.name, list_status=excluded.list_status, updated_at=excluded.updated_at
            """,
            (current,),
        )
        connection.execute(
            """
            INSERT INTO instrument_detail(
                symbol, exchange_id, instrument_id, instrument_name, exchange_code, open_date, expire_date,
                pre_close, up_stop_price, down_stop_price, is_trading, instrument_status,
                total_volume, float_volume, trading_day, raw_json, sync_time
            )
            VALUES ('603778.SH', 'SH', '603778', '次日卖出样本', 'SH', '2020-01-01', '99999999',
                10, 11, 9, 1, '正常', 5000000000, 4000000000, '2026-05-08', '{}', ?)
            ON CONFLICT(symbol) DO UPDATE SET total_volume=excluded.total_volume, instrument_name=excluded.instrument_name, sync_time=excluded.sync_time
            """,
            (current,),
        )
        connection.executemany(
            """
            INSERT INTO daily_kline(symbol, trade_date, open, high, low, close, volume, amount, created_at)
            VALUES ('603778.SH', ?, ?, ?, ?, ?, 100000, 1000000, ?)
            ON CONFLICT(symbol, trade_date) DO UPDATE SET open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close
            """,
            [
                ("2026-05-05", 10, 10.5, 9.8, 10.0, current),
                ("2026-05-06", 10, 10.5, 9.8, 10.2, current),
                ("2026-05-07", 11, 11.5, 10.8, 11.2, current),
                ("2026-05-08", 12, 12.5, 11.8, 12.2, current),
            ],
        )
        connection.executemany(
            """
            INSERT INTO minute_kline(symbol, datetime, period, open, high, low, close, volume, amount, created_at)
            VALUES ('603778.SH', ?, '1m', 10, 10.2, 9.9, ?, 10000, 60000000, ?)
            ON CONFLICT(symbol, period, datetime) DO UPDATE SET close=excluded.close, amount=excluded.amount
            """,
            [
                ("2026-05-06 09:30:00", 10.1, current),
                ("2026-05-06 09:31:00", 10.15, current),
                ("2026-05-06 09:32:00", 10.2, current),
                ("2026-05-06 09:33:00", 10.3, current),
            ],
        )
        connection.commit()

    strategy_id = client.post(
        "/api/strategies/import",
        json={
            "file_name": "minute_backtest_next_day_sell_strategy.py",
            "code_content": '''
class Strategy:
    name = "分钟回测次日卖出策略"
    version = "1.0.0"
    description = "用于验证分钟K买入后按次日开盘卖出。"
    params = {}

    def __init__(self, context):
        self.context = context

    def run(self):
        triggers = self.context.find_minute_amount_triggers(["603778.SH"], "2026-05-06", "2026-05-08", "09:30:00", "10:30:00", 50000000, 3, 5)
        return [{
            "symbol": item["symbol"],
            "name": "次日卖出样本",
            "action": "BUY",
            "price": item["trigger_price"],
            "amount": 10000,
            "sell_after_trading_days": 1,
            "reason": "分钟K连续放量，回测买入后次日开盘卖出。",
            "signal_time": item["trigger_time"],
        } for item in triggers]
''',
        },
    ).json()["data"]["id"]

    create_response = client.post(
        "/api/backtests",
        json={
            "strategy_id": strategy_id,
            "backtest_name": "分钟K次日卖出检查",
            "start_date": "2026-05-06",
            "end_date": "2026-05-08",
            "initial_cash": 100000,
            "single_order_amount": 100000,
            "data_frequency": "分钟K",
            "fill_mode": "正式分钟回放",
            "fee_rate": 0.0003,
            "stamp_tax_rate": 0.001,
            "slippage": 0,
        },
    )
    assert create_response.status_code == 200
    task_id = create_response.json()["data"]["task_id"]

    assert wait_for_task(client, task_id, timeout=20)["status"] == "success"
    result = client.get(f"/api/backtests/{task_id}/result").json()["data"]
    trades = client.get(f"/api/backtests/{task_id}/trades?page=1&page_size=20&sort_field=trade_time&sort_order=asc").json()["data"]["items"]

    assert result["trade_count"] == 2
    assert result["average_holding_days"] == 1
    assert result["win_rate"] == 100
    assert result["buy_count"] == 1
    assert result["sell_count"] == 1
    assert result["open_position_count"] == 0
    assert result["open_market_value"] == 0
    assert result["total_fee"] > 0
    assert result["realized_pnl"] > 0
    assert abs((result["ending_cash"] + result["open_market_value"]) - result["final_cash"]) < 1
    assert [trade["side"] for trade in trades] == ["BUY", "SELL"]
    assert trades[0]["quantity"] == 1000
    assert trades[0]["amount"] == 10000
    assert trades[0]["trade_time"] == "2026-05-06 09:33:00"
    assert trades[1]["trade_time"] == "2026-05-07"
    assert trades[1]["price"] == 11
    signals = client.get(f"/api/backtests/{task_id}/signals?page=1&page_size=20&sort_order=asc").json()["data"]["items"]
    report = client.get(f"/api/backtests/{task_id}/report").json()["data"]

    assert len(signals) == 2
    assert [signal["status"] for signal in signals] == ["已成交", "已成交"]
    assert signals[0]["execution_time"] == "2026-05-06 09:33:00"
    assert signals[1]["is_auto_exit"] == 1
    assert report["signals"][0]["symbol"] == "603778.SH"
    universe = json.loads(report["manifest"]["universe_summary"])
    assert universe["matched_signal_count"] == 2


def test_backtest_context_can_read_full_day_minute_bars_without_page_truncation():
    current = "2026-05-10 10:00:00"
    rows = []
    for index in range(240):
        hour = 9 + (30 + index) // 60
        minute = (30 + index) % 60
        rows.append((f"2026-05-06 {hour:02d}:{minute:02d}:00", 10 + index / 1000, current))
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO stock_basic(symbol, name, market, security_type, list_status, is_st, updated_at)
            VALUES ('603779.SH', '全天分钟样本', 'SH', '股票', '上市', 0, ?)
            ON CONFLICT(symbol) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at
            """,
            (current,),
        )
        connection.executemany(
            """
            INSERT INTO minute_kline(symbol, datetime, period, open, high, low, close, volume, amount, created_at)
            VALUES ('603779.SH', ?, '1m', 10, 10.2, 9.9, ?, 10000, 1000000, ?)
            ON CONFLICT(symbol, period, datetime) DO UPDATE SET close=excluded.close, amount=excluded.amount
            """,
            rows,
        )
        connection.commit()

    context = BacktestStrategyContext({"603779.SH": [{"trade_date": "2026-05-06", "name": "全天分钟样本"}]}, "2026-05-06")
    bars = context.get_minute_bars("603779.SH", "2026-05-06 09:30:00", "2026-05-06 13:29:00")

    assert len(bars) == 240
    assert bars[0]["datetime"] == "2026-05-06 09:30:00"
    assert bars[-1]["datetime"] == "2026-05-06 13:29:00"


def test_minute_trigger_replay_reports_chunk_progress():
    current = "2026-05-10 10:00:00"
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO stock_basic(symbol, name, market, security_type, list_status, is_st, updated_at)
            VALUES ('603783.SH', '分钟进度样本', 'SH', '股票', '上市', 0, ?)
            ON CONFLICT(symbol) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at
            """,
            (current,),
        )
        connection.executemany(
            """
            INSERT INTO minute_kline(symbol, datetime, period, open, high, low, close, volume, amount, created_at)
            VALUES ('603783.SH', ?, '1m', 10, 10.2, 9.9, 10.1, 10000, 60000000, ?)
            ON CONFLICT(symbol, period, datetime) DO UPDATE SET amount=excluded.amount
            """,
            [
                ("2026-05-06 09:30:00", current),
                ("2026-05-06 09:31:00", current),
                ("2026-05-06 09:32:00", current),
            ],
        )
        connection.commit()

    events: list[dict[str, object]] = []
    context = BacktestStrategyContext(
        {"603783.SH": [{"trade_date": "2026-05-06", "name": "分钟进度样本"}]},
        "2026-05-06",
        "分钟K",
        progress_callback=events.append,
    )
    triggers = context.find_minute_amount_triggers(["603783.SH"], "2026-05-06", "2026-05-06", "09:30:00", "10:30:00", 50000000, 3, 5)

    assert len(triggers) == 1
    assert any(event["stage"] == "minute_replay_scan" for event in events)
    assert events[-1]["triggers_returned"] == 1


def test_minute_replay_trigger_scan_reports_replay_progress():
    current = "2026-05-10 10:00:00"
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO stock_basic(symbol, name, market, security_type, list_status, is_st, updated_at)
            VALUES ('603784.SH', '分钟回放样本', 'SH', '股票', '上市', 0, ?)
            ON CONFLICT(symbol) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at
            """,
            (current,),
        )
        connection.executemany(
            """
            INSERT INTO minute_kline(symbol, datetime, period, open, high, low, close, volume, amount, created_at)
            VALUES ('603784.SH', ?, '1m', 10, 10.2, 9.9, 10.1, 10000, ?, ?)
            ON CONFLICT(symbol, period, datetime) DO UPDATE SET amount=excluded.amount
            """,
            [
                ("2026-05-06 09:30:00", 60000000, current),
                ("2026-05-06 09:31:00", 10000000, current),
                ("2026-05-06 09:32:00", 60000000, current),
                ("2026-05-06 09:33:00", 60000000, current),
                ("2026-05-06 09:34:00", 60000000, current),
            ],
        )
        connection.commit()

    events: list[dict[str, object]] = []
    context = BacktestStrategyContext(
        {"603784.SH": [{"trade_date": "2026-05-06", "name": "分钟回放样本"}]},
        "2026-05-06",
        "分钟K",
        "minute_replay",
        progress_callback=events.append,
    )
    triggers = context.find_minute_amount_triggers(["603784.SH"], "2026-05-06", "2026-05-06", "09:30:00", "10:30:00", 50000000, 3, 5)

    assert len(triggers) == 1
    assert triggers[0]["trigger_time"] == "2026-05-06 09:34:00"
    assert any(event["stage"] == "minute_replay_scan" for event in events)
    assert any('"mode": "minute_replay"' in line for line in context.logs)


def test_missing_backtest_returns_chinese_business_error():
    client = TestClient(app)

    response = client.get("/api/backtests/no_such_task")

    assert response.status_code == 404
    body = response.json()
    assert body["message"] == "回测任务不存在。"
    assert body["error"]["code"] == "BACKTEST_NOT_FOUND"
