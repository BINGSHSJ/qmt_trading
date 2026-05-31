import json
import pytest
import zipfile
from fastapi.testclient import TestClient
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

from backend.adapters.qmt.qmt_import_path import candidate_site_packages, ensure_xtquant_import_path
from backend.adapters.qmt.real_qmt_guard import RealQmtReadOnlyGuard
from backend.core.config import settings
from backend.core.database import db_session
from backend.main import app


def test_system_config_can_be_read_and_saved():
    client = TestClient(app)

    response = client.get("/api/system/config")
    assert response.status_code == 200
    config = response.json()["data"]

    config["account_id"] = "test_isolation_account"
    config["auto_connect"] = True
    save_response = client.put("/api/system/config", json=config)

    assert save_response.status_code == 200
    body = save_response.json()
    assert body["success"] is True
    assert body["data"]["account_id"] == "test_isolation_account"
    assert body["data"]["auto_connect"] is True


def test_system_config_rejects_unsafe_values():
    client = TestClient(app)

    config = client.get("/api/system/config").json()["data"]
    config["default_order_amount"] = 100000
    config["max_order_amount"] = 50000
    response = client.put("/api/system/config", json=config)
    assert response.status_code == 400
    assert response.json()["message"] == "最大单笔金额不能小于默认单笔金额。"

    config = client.get("/api/system/config").json()["data"]
    config["default_order_amount"] = -1
    config["max_order_amount"] = 50000
    response = client.put("/api/system/config", json=config)
    assert response.status_code == 400
    assert response.json()["message"] == "默认单笔金额配置不合法。"

    config = client.get("/api/system/config").json()["data"]
    config["simulation_mode"] = False
    config["order_confirm_required"] = False
    response = client.put("/api/system/config", json=config)
    assert response.status_code == 400
    assert response.json()["message"] == "真实 QMT 模式必须开启下单前确认。"


def test_save_config_operation_log_deduplicates_recent_entries():
    from backend.repositories.system.system_repository import SystemRepository

    repository = SystemRepository()
    target_id = f"qa_save_config_{uuid4().hex}"

    repository.add_operation_log("系统管理", "保存设置", "app_config", target_id, "成功", "第一次保存", "detail-1")
    repository.add_operation_log("系统管理", "保存设置", "app_config", target_id, "成功", "第二次保存", "detail-2")

    with db_session() as connection:
        rows = connection.execute(
            """
            SELECT message, technical_detail
            FROM operation_log
            WHERE module = '系统管理'
              AND action = '保存设置'
              AND target_type = 'app_config'
              AND target_id = ?
            ORDER BY id DESC
            """,
            (target_id,),
        ).fetchall()
        system_log_rows = connection.execute(
            """
            SELECT message, technical_detail
            FROM system_log
            WHERE module = '系统管理'
              AND related_id = ?
              AND message IN ('第一次保存', '第二次保存')
            """,
            (target_id,),
        ).fetchall()

    assert len(rows) == 1
    assert rows[0]["message"] == "第二次保存"
    assert rows[0]["technical_detail"] == "detail-2"
    assert len(system_log_rows) == 1
    assert system_log_rows[0]["message"] == "第二次保存"
    assert system_log_rows[0]["technical_detail"] == "detail-2"


def test_environment_check_runs_in_test_isolation_mode():
    client = TestClient(app)

    create_response = client.post("/api/system/env/check")

    assert create_response.status_code == 200
    task_id = create_response.json()["data"]["task_id"]
    task_response = client.get(f"/api/tasks/{task_id}")
    result_response = client.get(f"/api/system/env/results?task_id={task_id}")

    assert task_response.json()["data"]["status"] in {"success", "failed"}
    results = result_response.json()["data"]
    assert len(results) >= 8
    assert any(item["check_item"] == "交易接口是否被保护" for item in results)
    order_check = next(item for item in results if item["check_item"] == "交易接口是否被保护")
    assert "不会提交真实下单" in order_check["message"]
    assert "real_order_submitted=false" in (order_check["technical_detail"] or "")


def test_runtime_task_returns_structured_source_route():
    client = TestClient(app)
    task_id = f"task_route_{uuid4().hex}"
    with db_session() as connection:
        connection.execute(
            """
            INSERT INTO runtime_task(task_id, task_type, status, progress, message, created_at)
            VALUES (?, 'sync_2026', 'running', 12, '正在补齐 2026 数据。', '2026-05-20 09:00:00')
            """,
            (task_id,),
        )

    response = client.get(f"/api/tasks/{task_id}")

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["task_id"] == task_id
    assert data["source_module"] == "数据中心"
    assert data["source_route"] == "/data-center?tab=数据同步"
    assert data["source_label"] == "数据中心 / 数据同步"


def test_real_qmt_guard_keeps_acceptance_readonly_when_xtquant_missing():
    guard = RealQmtReadOnlyGuard(
        qmt_path="",
        account_id="",
        simulation_mode=True,
        order_confirm_required=True,
        max_order_amount=50000,
    )

    items = {item.check_item: item for item in guard.build_environment_items()}

    assert items["交易接口是否被保护"].status == "warning"
    assert "real_order_submitted=false" in (items["交易接口是否被保护"].technical_detail or "")
    assert items["是否能查询资产"].technical_detail == "test_isolation=true; real_qmt_readonly_attempted=false"
    assert items["是否能查询委托"].technical_detail == "test_isolation=true; real_qmt_readonly_attempted=false"
    assert items["是否能查询成交"].technical_detail == "test_isolation=true; real_qmt_readonly_attempted=false"
    assert items["是否能读取交易日历"].technical_detail == "test_isolation=true; real_qmt_readonly_attempted=false"
    assert items["是否能读取日K小范围"].technical_detail == "test_isolation=true; real_qmt_readonly_attempted=false"


def test_real_qmt_guard_warns_for_placeholder_account(tmp_path):
    guard = RealQmtReadOnlyGuard(
        qmt_path="",
        account_id="mock_account",
        simulation_mode=False,
        order_confirm_required=True,
        max_order_amount=50000,
    )

    items = {item.check_item: item for item in guard.build_environment_items()}

    assert items["QMT账户ID是否配置"].status == "failed"
    assert "placeholder=True" in (items["QMT账户ID是否配置"].technical_detail or "")


def test_real_qmt_guard_warns_for_test_isolation_account(tmp_path):
    guard = RealQmtReadOnlyGuard(
        qmt_path="",
        account_id="test_isolation_account",
        simulation_mode=False,
        order_confirm_required=True,
        max_order_amount=50000,
    )

    items = {item.check_item: item for item in guard.build_environment_items()}

    assert items["QMT账户ID是否配置"].status == "failed"
    assert "placeholder=True" in (items["QMT账户ID是否配置"].technical_detail or "")
    assert "test_isolation_account" in (items["QMT账户ID是否配置"].suggestion or "")


def test_real_qmt_guard_detects_miniqmt_process(monkeypatch):
    def fake_run(*args, **kwargs):
        return SimpleNamespace(stdout='"Image Name","PID"\n"XtMiniQmt.exe","1234"\n"XtItClient.exe","5678"', returncode=0)

    monkeypatch.setattr("backend.adapters.qmt.real_qmt_guard.subprocess.run", fake_run)
    guard = RealQmtReadOnlyGuard(
        qmt_path="",
        account_id="demo_account",
        simulation_mode=False,
        order_confirm_required=True,
        max_order_amount=50000,
    )

    items = {item.check_item: item for item in guard.build_environment_items()}

    assert items["MiniQMT是否启动"].status == "success"
    assert "XtMiniQmt.exe" in (items["MiniQMT是否启动"].technical_detail or "")


def test_qmt_import_path_detects_bundled_site_packages(tmp_path):
    qmt_path = tmp_path / "QMT"
    site_packages = qmt_path / "bin.x64" / "Lib" / "site-packages"
    (site_packages / "xtquant").mkdir(parents=True)

    assert candidate_site_packages(str(qmt_path)) == [site_packages]
    assert ensure_xtquant_import_path(str(qmt_path)) == site_packages


def test_backup_and_logs_are_available():
    client = TestClient(app)

    backup_response = client.post("/api/system/backups")
    backup_task_id = backup_response.json()["data"]["task_id"]
    logs_response = client.get("/api/system/logs?page=1&page_size=20")
    operations_response = client.get("/api/system/operations?page=1&page_size=20")
    backups_response = client.get("/api/system/backups")
    backups_page = backups_response.json()["data"]
    backup_id = backups_page["items"][0]["id"]
    verify_response = client.post(f"/api/system/backups/{backup_id}/restore")
    verify_task_id = verify_response.json()["data"]["task_id"]

    assert backup_response.status_code == 200
    assert client.get(f"/api/tasks/{backup_task_id}").json()["data"]["status"] == "success"
    assert verify_response.status_code == 200
    assert client.get(f"/api/tasks/{verify_task_id}").json()["data"]["status"] == "success"
    assert backups_page["total"] >= 1
    assert len(backups_page["items"]) >= 1
    assert logs_response.json()["data"]["total"] >= 1
    assert operations_response.json()["data"]["total"] >= 1
    assert client.get("/api/system/logs/export").status_code == 200
    assert client.get("/api/system/config/export").status_code == 200


def test_backup_uses_configured_backup_directory(tmp_path):
    client = TestClient(app)
    configured_backup_dir = tmp_path / "custom_backups"
    config = client.get("/api/system/config").json()["data"]
    config["backup_dir"] = str(configured_backup_dir)
    save_response = client.put("/api/system/config", json=config)
    assert save_response.status_code == 200

    backup_response = client.post("/api/system/backups")
    task_id = backup_response.json()["data"]["task_id"]
    assert client.get(f"/api/tasks/{task_id}").json()["data"]["status"] == "success"
    backup = client.get("/api/system/backups?page=1&page_size=1").json()["data"]["items"][0]

    assert Path(backup["backup_path"]).parent == configured_backup_dir
    assert Path(backup["backup_path"]).exists()

    config_export = client.get("/api/system/config/export")
    log_export = client.get("/api/system/logs/export")

    assert config_export.status_code == 200
    assert log_export.status_code == 200
    assert "application/json" in config_export.headers["content-type"]
    assert "application/zip" in log_export.headers["content-type"]
    assert "system_config_" in config_export.headers["content-disposition"]
    assert ".json" in config_export.headers["content-disposition"]
    assert "system_logs_" in log_export.headers["content-disposition"]
    assert ".zip" in log_export.headers["content-disposition"]
    config_payload = json.loads(config_export.content.decode("utf-8"))
    assert config_payload["app_name"]
    assert config_payload["version"]
    assert config_payload["exported_at"]
    assert config_payload["config"]["backup_dir"] == str(configured_backup_dir)
    with zipfile.ZipFile(BytesIO(log_export.content), "r") as archive:
        assert "system_log.json" in archive.namelist()

    exports_dir = configured_backup_dir / "exports"
    assert exports_dir.exists()
    assert any(path.name.startswith("system_config_") for path in exports_dir.iterdir())
    assert any(path.name.startswith("system_logs_") for path in exports_dir.iterdir())
    with db_session() as connection:
        operations = connection.execute(
            """
            SELECT action, target_id, message, technical_detail
            FROM operation_log
            WHERE module='系统管理' AND action IN ('导出配置', '导出日志')
            ORDER BY id DESC LIMIT 2
            """
        ).fetchall()
    operation_actions = {row["action"] for row in operations}
    assert {"导出配置", "导出日志"} <= operation_actions
    assert all(row["target_id"].startswith(("system_config_", "system_logs_")) for row in operations)
    assert all(str(exports_dir) in row["technical_detail"] for row in operations)


def test_missing_backup_returns_chinese_business_error():
    client = TestClient(app)

    restore_response = client.post("/api/system/backups/999999/restore")
    delete_response = client.delete("/api/system/backups/999999")

    assert restore_response.status_code == 404
    assert restore_response.json()["message"] == "备份记录不存在。"
    assert restore_response.json()["error"]["code"] == "BACKUP_NOT_FOUND"
    assert delete_response.status_code == 404
    assert delete_response.json()["message"] == "备份记录不存在。"


def test_backup_restore_rejects_invalid_config_before_database_replace(tmp_path):
    client = TestClient(app)
    config = client.get("/api/system/config").json()["data"]
    config["default_order_amount"] = 10000
    config["max_order_amount"] = 50000
    config["order_confirm_required"] = True
    assert client.put("/api/system/config", json=config).status_code == 200

    invalid_config = {**config, "default_order_amount": -1}
    backup_path = tmp_path / "invalid_config_backup.zip"
    with zipfile.ZipFile(backup_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.write(settings.database_path, arcname="data/local_quant_console.db")
        archive.writestr("config/app_config.json", json.dumps(invalid_config, ensure_ascii=False))

    with db_session() as connection:
        cursor = connection.execute(
            """
            INSERT INTO backup_record(backup_name, backup_path, backup_size, status, created_at)
            VALUES ('invalid_config_backup', ?, ?, 'success', '2026-05-10 10:00:00')
            """,
            (str(backup_path), backup_path.stat().st_size),
        )
        backup_id = cursor.lastrowid

    restore_response = client.post(f"/api/system/backups/{backup_id}/restore")
    task_id = restore_response.json()["data"]["task_id"]
    task = client.get(f"/api/tasks/{task_id}").json()["data"]
    current_config = client.get("/api/system/config").json()["data"]

    assert restore_response.status_code == 200
    assert task["status"] == "failed"
    assert task["message"] == "备份中的系统配置不合法，已停止恢复。"
    assert "默认单笔金额" in (task["technical_detail"] or "")
    assert current_config["default_order_amount"] == 10000


def test_backup_restore_is_blocked_while_tasks_are_running():
    from backend.core.database import get_connection

    with TestClient(app) as client:
        backup_response = client.post("/api/system/backups")
        backup_task_id = backup_response.json()["data"]["task_id"]
        assert client.get(f"/api/tasks/{backup_task_id}").json()["data"]["status"] == "success"
        backup_id = client.get("/api/system/backups").json()["data"]["items"][0]["id"]

        with get_connection() as connection:
            connection.execute(
                """
                INSERT INTO runtime_task(task_id, task_type, status, progress, message, created_at)
                VALUES ('task_running_restore_guard', 'sync_daily_kline', 'running', 30, '正在同步测试数据', '2026-05-10 10:00:00')
                """
            )
            connection.commit()

        response = client.post(f"/api/system/backups/{backup_id}/restore")
        body = response.json()

        assert response.status_code == 400
        assert body["success"] is False
        assert body["error"]["code"] == "BACKUP_RESTORE_BUSY"
        assert "运行中的任务" in body["message"]


def test_backup_create_rejects_same_type_running_task():
    client = TestClient(app)

    with db_session() as connection:
        connection.execute(
            """
            INSERT INTO runtime_task(task_id, task_type, status, progress, message, created_at)
            VALUES ('task_backup_running_guard', 'backup_create', 'running', 20, '正在创建备份', '2026-05-10 10:00:00')
            """
        )

    response = client.post("/api/system/backups")
    body = response.json()

    assert response.status_code == 400
    assert body["error"]["code"] == "TASK_ALREADY_RUNNING"
    assert body["message"] == "同类型任务正在执行，请等待完成后重试。"


def test_backup_list_is_paged_searchable_and_sortable():
    client = TestClient(app)

    with db_session() as connection:
        rows = [
            (
                f"backup_page_{index:02d}",
                f"C:/tmp/backup_page_{index:02d}.zip",
                1000 + index,
                "success" if index % 2 == 0 else "failed",
                f"2026-05-{index + 1:02d} 10:00:00",
            )
            for index in range(25)
        ]
        connection.executemany(
            """
            INSERT INTO backup_record(backup_name, backup_path, backup_size, status, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            rows,
        )

    page_one = client.get("/api/system/backups?page=1&page_size=10").json()["data"]
    page_three = client.get("/api/system/backups?page=3&page_size=10").json()["data"]
    failed = client.get("/api/system/backups?page=1&page_size=20&status=failed").json()["data"]
    keyword = client.get("/api/system/backups?page=1&page_size=10&keyword=page_24").json()["data"]

    assert page_one["total"] == 25
    assert len(page_one["items"]) == 10
    assert page_one["has_more"] is True
    assert len(page_three["items"]) == 5
    assert page_three["has_more"] is False
    assert failed["total"] == 12
    assert all(item["status"] == "failed" for item in failed["items"])
    assert keyword["total"] == 1
    assert keyword["items"][0]["backup_name"] == "backup_page_24"


def test_startup_recovery_marks_interrupted_tasks_failed_and_logs():
    from backend.services.system.system_service import SystemService

    created_at = "2026-05-10 09:30:00"
    with db_session() as connection:
        connection.executemany(
            """
            INSERT INTO runtime_task(task_id, task_type, status, progress, message, started_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            [
                ("task_interrupted_sync", "sync_daily_kline", "running", 35, "正在同步日K", created_at, created_at),
                ("task_interrupted_strategy", "strategy_run", "pending", 0, "等待运行策略", created_at, created_at),
                ("task_interrupted_backtest", "backtest_run", "running", 60, "正在回测", created_at, created_at),
                ("task_interrupted_backup", "backup_create", "running", 10, "正在备份", created_at, created_at),
            ],
        )
        connection.execute(
            """
            INSERT INTO sync_task(task_id, sync_type, status, total_count, success_count, failed_count, started_at)
            VALUES ('task_interrupted_sync', 'sync_daily_kline', 'running', 100, 35, 0, ?)
            """,
            (created_at,),
        )
        connection.execute(
            """
            INSERT INTO strategy_file(file_name, file_path, strategy_name, version, description, status, created_at)
            VALUES ('restart_guard.py', 'strategies/user/restart_guard.py', '重启扫尾策略', '1.0.0', '测试用', 'enabled', ?)
            """,
            (created_at,),
        )
        strategy_id = connection.execute("SELECT id FROM strategy_file WHERE file_name='restart_guard.py'").fetchone()["id"]
        connection.execute(
            """
            INSERT INTO strategy_run_log(run_id, strategy_id, task_id, status, signal_count, started_at, message)
            VALUES ('run_interrupted_strategy', ?, 'task_interrupted_strategy', 'running', 0, ?, '策略运行中。')
            """,
            (strategy_id, created_at),
        )
        connection.execute(
            """
            INSERT INTO backtest_task(
                task_id, backtest_name, strategy_id, start_date, end_date, initial_cash,
                single_order_amount, data_frequency, fill_mode, fee_rate, stamp_tax_rate,
                slippage, status, created_at
            ) VALUES (
                'task_interrupted_backtest', '重启扫尾回测', ?, '2026-05-01', '2026-05-10', 100000,
                10000, 'daily', 'next_bar', 0.0003, 0.001, 0.01, 'running', ?
            )
            """,
            (strategy_id, created_at),
        )

    interrupted = SystemService().recover_interrupted_tasks_on_startup()
    interrupted_ids = {task.task_id for task in interrupted}

    assert interrupted_ids == {
        "task_interrupted_sync",
        "task_interrupted_strategy",
        "task_interrupted_backtest",
        "task_interrupted_backup",
    }

    with db_session() as connection:
        rows = connection.execute(
            """
            SELECT task_id, status, progress, message, technical_detail, finished_at
            FROM runtime_task
            WHERE task_id LIKE 'task_interrupted_%'
            """
        ).fetchall()
        sync_task = connection.execute("SELECT status, failed_count FROM sync_task WHERE task_id='task_interrupted_sync'").fetchone()
        sync_log = connection.execute("SELECT message FROM sync_log WHERE task_id='task_interrupted_sync'").fetchone()
        strategy_run = connection.execute("SELECT status, message FROM strategy_run_log WHERE task_id='task_interrupted_strategy'").fetchone()
        backtest_task = connection.execute("SELECT status FROM backtest_task WHERE task_id='task_interrupted_backtest'").fetchone()
        backtest_log = connection.execute(
            """
            SELECT bl.level, bl.message, bl.technical_detail
            FROM backtest_log bl
            JOIN backtest_task bt ON bt.id = bl.backtest_id
            WHERE bt.task_id='task_interrupted_backtest'
            """
        ).fetchone()

    assert len(rows) == 4
    assert all(row["status"] == "failed" for row in rows)
    assert all(row["progress"] == 100 for row in rows)
    assert all("服务重启导致任务中断" in row["message"] for row in rows)
    assert all("process_restart" in (row["technical_detail"] or "") for row in rows)
    assert all(row["finished_at"] for row in rows)
    assert sync_task["status"] == "failed"
    assert sync_task["failed_count"] == 1
    assert "服务重启导致任务中断" in sync_log["message"]
    assert strategy_run["status"] == "failed"
    assert "服务重启导致任务中断" in strategy_run["message"]
    assert backtest_task["status"] == "failed"
    assert backtest_log["level"] == "error"
    assert "服务重启导致任务中断" in backtest_log["message"]
    assert "process_restart" in backtest_log["technical_detail"]

    monitor = SystemService().get_monitor()
    assert monitor.running_task_count == 0
    assert any("服务重启导致" in item.message for item in monitor.recent_errors)


def test_startup_check_reports_version_and_core_items():
    client = TestClient(app)

    response = client.get("/api/system/startup-check")
    body = response.json()
    items = body["data"]["items"]

    assert response.status_code == 200
    assert body["data"]["version"]
    assert body["data"]["overall_status"] in {"success", "warning", "failed"}
    assert any(item["check_item"] == "后端服务" for item in items)
    assert any(item["check_item"] == "SQLite 数据库" for item in items)
    assert any(item["check_item"] == "xtquant 导入" for item in items)


def test_maintenance_cleanup_archives_old_logs_and_tasks():
    from backend.core.database import db_session
    from backend.repositories.system.system_repository import SystemRepository

    client = TestClient(app)
    config = client.get("/api/system/config").json()["data"]
    config["log_retention_days"] = 1
    config["task_retention_days"] = 1
    client.put("/api/system/config", json=config)

    with db_session() as connection:
        connection.execute(
            """
            INSERT INTO system_log(module, level, message, technical_detail, related_id, created_at)
            VALUES ('系统管理', 'info', '旧系统日志', NULL, NULL, '2000-01-01 00:00:00')
            """
        )
        connection.execute(
            """
            INSERT INTO operation_log(module, action, target_type, target_id, result, message, technical_detail, created_at)
            VALUES ('系统管理', '旧操作', 'test', NULL, '成功', '旧操作日志', NULL, '2000-01-01 00:00:00')
            """
        )
        connection.execute(
            """
            INSERT INTO runtime_task(task_id, task_type, status, progress, message, created_at)
            VALUES ('task_old_cleanup', 'old', 'success', 100, '旧任务', '2000-01-01 00:00:00')
            """
        )

    response = client.post("/api/system/maintenance/cleanup")
    task_id = response.json()["data"]["task_id"]
    task = client.get(f"/api/tasks/{task_id}").json()["data"]

    assert response.status_code == 200
    assert task["status"] == "success"
    assert "system_log_deleted" in (task["technical_detail"] or "")
    with pytest.raises(KeyError):
        SystemRepository().get_task("task_old_cleanup")


def test_maintenance_cleanup_archives_development_log_files(monkeypatch, tmp_path):
    client = TestClient(app)
    monkeypatch.setattr(settings, "logs_dir", tmp_path)

    unique = uuid4().hex
    development_logs = [
        tmp_path / f"manual_backend_stdout_{unique}.log",
        tmp_path / f"codex_backend_batch_{unique}.log",
    ]
    protected_logs = [
        tmp_path / "app.log",
        tmp_path / "error.log",
    ]
    for path in development_logs:
        path.write_text(f"qa development log: {path.name}", encoding="utf-8")
    for path in protected_logs:
        path.write_text(f"official runtime log: {path.name}", encoding="utf-8")

    response = client.post("/api/system/maintenance/cleanup")
    task_id = response.json()["data"]["task_id"]
    task = client.get(f"/api/tasks/{task_id}").json()["data"]
    detail = json.loads(task["technical_detail"] or "{}")
    archive_path = Path(detail["development_log_archive_path"])

    assert response.status_code == 200
    assert task["status"] == "success"
    assert detail["development_log_files_archived"] == len(development_logs)
    assert archive_path.exists()
    with zipfile.ZipFile(archive_path, "r") as archive:
        names = set(archive.namelist())
    assert {path.name for path in development_logs} <= names
    assert all(not path.exists() for path in development_logs)
    assert all(path.exists() for path in protected_logs)
