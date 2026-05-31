import hashlib

from fastapi.testclient import TestClient

from backend.core.database import db_session
from backend.core.config import settings
from backend.main import app
from backend.repositories.system.system_repository import now_text
from backend.schemas.common import PageQuery
from backend.services.strategy_dev.strategy_context import StrategyContext
from backend.services.strategy_dev.strategy_service import StrategyService


def test_copy_example_validate_run_and_signal_flow():
    client = TestClient(app)

    client.post("/api/data/sync/all")
    copy_response = client.post("/api/strategies/copy-example")
    assert copy_response.status_code == 200
    strategy_id = copy_response.json()["data"]["id"]

    validate_response = client.post(f"/api/strategies/files/{strategy_id}/validate")
    assert validate_response.json()["data"]["valid"] is True

    run_response = client.post(f"/api/strategies/{strategy_id}/run")
    assert run_response.status_code == 200
    task_id = run_response.json()["data"]["task_id"]
    task = client.get(f"/api/tasks/{task_id}").json()["data"]
    assert task["status"] == "success"

    signals = client.get("/api/strategies/signals?page=1&page_size=20").json()["data"]["items"]
    assert len(signals) >= 1
    signal_id = signals[0]["id"]
    ignore_response = client.patch(f"/api/strategies/signals/{signal_id}/ignore")
    assert ignore_response.json()["data"]["status"] == "已忽略"


def test_create_save_and_version_snapshot():
    client = TestClient(app)

    create_response = client.post(
        "/api/strategies/files",
        json={"file_name": "unit_test_strategy.py", "strategy_name": "单测策略", "description": "用于测试保存版本"},
    )
    assert create_response.status_code == 200
    strategy_id = create_response.json()["data"]["id"]

    content_response = client.get(f"/api/strategies/files/{strategy_id}/content")
    content = content_response.json()["data"]["code_content"].replace("signals = []", "signals = []")
    save_response = client.put(
        f"/api/strategies/files/{strategy_id}/content",
        json={"code_content": content, "remark": "单测保存"},
    )
    versions_response = client.get(f"/api/strategies/{strategy_id}/versions?page=1&page_size=1")
    versions_page = versions_response.json()["data"]

    assert save_response.status_code == 200
    assert versions_page["page"] == 1
    assert versions_page["page_size"] == 1
    assert versions_page["total"] >= 1
    assert len(versions_page["items"]) == 1


def test_strategy_file_list_backfills_last_run_from_run_log():
    client = TestClient(app)

    create_response = client.post(
        "/api/strategies/files",
        json={
            "file_name": "last_run_backfill_strategy.py",
            "strategy_name": "最近运行回补策略",
            "description": "用于测试策略列表最近运行时间兜底",
        },
    )
    assert create_response.status_code == 200
    strategy_id = create_response.json()["data"]["id"]
    with db_session() as connection:
        connection.execute("UPDATE strategy_file SET last_run_at=NULL WHERE id=?", (strategy_id,))
        connection.execute(
            """
            INSERT INTO strategy_run_log(run_id, strategy_id, task_id, status, signal_count, started_at, finished_at, message)
            VALUES ('run_last_run_backfill_strategy', ?, 'task_last_run_backfill_strategy', 'success', 0,
                    '2026-05-18 09:30:00', '2026-05-18 09:31:00', '历史运行记录')
            ON CONFLICT(run_id) DO UPDATE SET
                strategy_id=excluded.strategy_id,
                task_id=excluded.task_id,
                status=excluded.status,
                started_at=excluded.started_at,
                finished_at=excluded.finished_at,
                message=excluded.message
            """,
            (strategy_id,),
        )

    response = client.get("/api/strategies/files?keyword=最近运行回补&page=1&page_size=20")
    items = response.json()["data"]["items"]

    assert response.status_code == 200
    assert items
    assert items[0]["last_run_at"] == "2026-05-18 09:31:00"


def test_strategy_run_record_keeps_strategy_snapshot():
    client = TestClient(app)
    code = '''class Strategy:
    name = "快照运行策略"
    version = "2.3.4"
    description = "用于测试运行记录保存策略快照。"

    def __init__(self, context):
        self.context = context

    def run(self):
        return []
'''
    strategy = client.post(
        "/api/strategies/import",
        json={"file_name": "snapshot_run_strategy.py", "code_content": code},
    ).json()["data"]

    response = client.post(f"/api/strategies/{strategy['id']}/run")
    assert response.status_code == 200
    task_id = response.json()["data"]["task_id"]
    task = client.get(f"/api/tasks/{task_id}").json()["data"]
    runs = client.get("/api/strategies/runs?page=1&page_size=200").json()["data"]["items"]
    run = next(item for item in runs if item["task_id"] == task_id)

    assert task["status"] == "success"
    assert run["strategy_name"] == "快照运行策略"
    assert run["strategy_file_name"] == "snapshot_run_strategy.py"
    assert run["strategy_version"] == "2.3.4"
    assert run["strategy_code_hash"] == hashlib.sha256(code.encode("utf-8")).hexdigest()


def test_strategy_file_list_prunes_missing_user_file_records():
    client = TestClient(app)

    create_response = client.post(
        "/api/strategies/files",
        json={"file_name": "missing_prune_strategy.py", "strategy_name": "缺失清理策略", "description": "用于测试缺失文件清理"},
    )
    strategy = create_response.json()["data"]

    from pathlib import Path

    Path(strategy["file_path"]).unlink()
    files_response = client.get("/api/strategies/files?page=1&page_size=200")
    names = {item["file_name"] for item in files_response.json()["data"]["items"]}

    assert "missing_prune_strategy.py" not in names


def test_invalid_strategy_returns_chinese_error():
    client = TestClient(app)

    response = client.post(
        "/api/strategies/import",
        json={"file_name": "invalid_strategy.py", "code_content": "class Bad:\n    pass\n"},
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "STRATEGY_INTERFACE_INVALID"


def test_strategy_timeout_is_reported_in_chinese():
    client = TestClient(app)

    config = client.get("/api/system/config").json()["data"]
    config["strategy_timeout_seconds"] = 1
    client.put("/api/system/config", json=config)
    strategy = client.post(
        "/api/strategies/import",
        json={
            "file_name": "timeout_strategy.py",
            "code_content": '''class Strategy:
    name = "超时策略"
    version = "1.0.0"
    description = "用于测试超时。"

    def __init__(self, context):
        self.context = context

    def run(self):
        while True:
            pass
''',
        },
    ).json()["data"]

    task_id = client.post(f"/api/strategies/{strategy['id']}/run").json()["data"]["task_id"]
    task = client.get(f"/api/tasks/{task_id}").json()["data"]

    assert task["status"] == "failed"
    assert "超时" in task["message"]


def test_strategy_stop_run_marks_task_and_run_cancelled():
    client = TestClient(app)

    create_response = client.post(
        "/api/strategies/files",
        json={"file_name": "stop_me_strategy.py", "strategy_name": "停止测试策略", "description": "用于测试停止运行"},
    )
    strategy_id = create_response.json()["data"]["id"]
    service = StrategyService()
    task_id = service.create_run_task(strategy_id).task_id
    run = service.list_runs(PageQuery(page=1, page_size=1)).items[0]

    response = client.post(f"/api/strategies/runs/{run.run_id}/stop")

    assert response.status_code == 200
    assert response.json()["data"]["status"] == "cancelled"
    task = client.get(f"/api/tasks/{task_id}").json()["data"]
    assert task["status"] == "cancelled"


def test_strategy_blocks_direct_database_or_trading_imports():
    client = TestClient(app)

    strategy = client.post(
        "/api/strategies/import",
        json={
            "file_name": "blocked_import_strategy.py",
            "code_content": '''class Strategy:
    name = "违规导入策略"
    version = "1.0.0"
    description = "不允许直接导入数据库。"

    def __init__(self, context):
        self.context = context

    def run(self):
        import sqlite3
        return []
''',
        },
    ).json()["data"]

    task_id = client.post(f"/api/strategies/{strategy['id']}/run").json()["data"]["task_id"]
    task = client.get(f"/api/tasks/{task_id}").json()["data"]
    run = client.get("/api/strategies/runs?page=1&page_size=1").json()["data"]["items"][0]

    assert task["status"] == "failed"
    assert "策略运行失败" in task["message"]
    assert "策略安全边界" in (run["technical_detail"] or "")


def test_strategy_rejects_invalid_signal_before_persisting():
    client = TestClient(app)

    strategy = client.post(
        "/api/strategies/import",
        json={
            "file_name": "invalid_signal_strategy.py",
            "code_content": '''class Strategy:
    name = "脏信号策略"
    version = "1.0.0"
    description = "用于测试信号校验。"

    def __init__(self, context):
        self.context = context

    def run(self):
        return [{"symbol": "BAD", "action": "BUY", "price": "abc", "reason": "错误信号"}]
''',
        },
    ).json()["data"]

    task_id = client.post(f"/api/strategies/{strategy['id']}/run").json()["data"]["task_id"]
    task = client.get(f"/api/tasks/{task_id}").json()["data"]
    signal_page = client.get("/api/strategies/signals?keyword=脏信号策略&page=1&page_size=20").json()["data"]
    run = client.get("/api/strategies/runs?page=1&page_size=1").json()["data"]["items"][0]

    assert task["status"] == "failed"
    assert signal_page["total"] == 0
    assert "股票代码格式不正确" in (run["technical_detail"] or "") or "price 必须是数字" in (run["technical_detail"] or "")


def test_strategy_context_honors_date_ranges_and_reads_sqlite_first():
    current = now_text()
    with db_session() as connection:
        connection.executemany(
            """
            INSERT INTO daily_kline(symbol, trade_date, open, high, low, close, volume, amount, created_at)
            VALUES ('600000.SH', ?, 10, 11, 9, ?, 1000, 10000, ?)
            """,
            [
                ("2026-05-06", 10.1, current),
                ("2026-05-07", 10.2, current),
                ("2026-05-08", 10.3, current),
            ],
        )
        connection.executemany(
            """
            INSERT INTO trading_calendar(market, trade_date, is_trading_day, source, sync_time)
            VALUES ('SH', ?, 1, 'test', ?)
            """,
            [("2026-05-06", current), ("2026-05-07", current), ("2026-05-08", current)],
        )

    context = StrategyContext()

    daily = context.get_daily_bars("600000.SH", "2026-05-07", "2026-05-08")
    calendar = context.get_trading_calendar("2026-05-07", "2026-05-08")

    assert [row["trade_date"] for row in daily] == ["2026-05-07", "2026-05-08"]
    assert [row["trade_date"] for row in calendar] == ["2026-05-07", "2026-05-08"]


def test_strategy_context_reads_market_cap_universe_and_latest_minute_date():
    current = now_text()
    with db_session() as connection:
        connection.execute(
            """
            INSERT INTO stock_basic(symbol, name, market, security_type, list_status, is_st, updated_at)
            VALUES ('603001.SH', '市值样本A', 'SH', '股票', '上市', 0, ?)
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
            VALUES ('603001.SH', 'SH', '603001', '市值样本A', 'SH', '2020-01-01', '99999999',
                10, 11, 9, 1, '正常', 5000000000, 4000000000, '2026-05-08', '{}', ?)
            ON CONFLICT(symbol) DO UPDATE SET
                instrument_name=excluded.instrument_name,
                total_volume=excluded.total_volume,
                float_volume=excluded.float_volume,
                sync_time=excluded.sync_time
            """,
            (current,),
        )
        connection.execute(
            """
            INSERT INTO daily_kline(symbol, trade_date, open, high, low, close, volume, amount, created_at)
            VALUES ('603001.SH', '2026-05-08', 10, 11, 9, 10, 1000, 10000, ?)
            ON CONFLICT(symbol, trade_date) DO UPDATE SET close=excluded.close, created_at=excluded.created_at
            """,
            (current,),
        )
        connection.executemany(
            """
            INSERT INTO minute_kline(symbol, datetime, period, open, high, low, close, volume, amount, created_at)
            VALUES ('603001.SH', ?, '1m', 10, 10.2, 9.9, 10.1, 1000, 60000000, ?)
            ON CONFLICT(symbol, period, datetime) DO UPDATE SET amount=excluded.amount, created_at=excluded.created_at
            """,
            [
                ("2026-05-08 09:30:00", current),
                ("2026-05-08 09:31:00", current),
                ("2026-05-08 09:32:00", current),
            ],
        )

    context = StrategyContext()

    universe = context.get_stock_universe(100, 1000, "2026-05-01", "2026-05-08")
    symbols = {row["symbol"] for row in universe}

    assert "603001.SH" in symbols
    assert context.get_market_cap_yi("603001.SH", "2026-05-01", "2026-05-08") == 500
    assert context.get_latest_minute_trade_date("603001.SH", "2026-05-01", "2026-05-08") == "2026-05-08"
    triggers = context.find_minute_amount_triggers(
        ["603001.SH"],
        "2026-05-01",
        "2026-05-08",
        "09:30:00",
        "10:30:00",
        50_000_000,
        3,
        10,
    )
    assert triggers[0]["symbol"] == "603001.SH"
    assert triggers[0]["trigger_time"] == "2026-05-08 09:32:00"


def test_scanned_existing_user_strategy_gets_initial_version_snapshot():
    client = TestClient(app)
    strategy_path = settings.strategy_user_dir / "existing_scanned_strategy.py"
    strategy_path.write_text(
        '''class Strategy:
    name = "已有扫描策略"
    version = "1.0.0"
    description = "用于测试扫描补版本。"
    params = {}

    def __init__(self, context):
        self.context = context

    def run(self):
        return []
''',
        encoding="utf-8",
    )

    files = client.get("/api/strategies/files?keyword=已有扫描策略&page=1&page_size=20").json()["data"]["items"]
    strategy_id = files[0]["id"]
    versions = client.get(f"/api/strategies/{strategy_id}/versions?page=1&page_size=20").json()["data"]

    assert versions["total"] == 1
    assert versions["items"][0]["remark"] == "扫描现有策略"


def test_missing_strategy_returns_chinese_business_error():
    client = TestClient(app)

    response = client.get("/api/strategies/files/999999/content")

    assert response.status_code == 404
    body = response.json()
    assert body["message"] == "策略文件不存在。"
    assert body["error"]["code"] == "STRATEGY_FILE_NOT_FOUND"
