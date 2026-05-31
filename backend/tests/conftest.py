import os
import shutil
import tempfile
from pathlib import Path

import pytest


TEST_ROOT = Path(tempfile.mkdtemp(prefix="lqc_tests_"))

os.environ.setdefault("LQC_DATA_DIR", str(TEST_ROOT / "data"))
os.environ.setdefault("LQC_LOGS_DIR", str(TEST_ROOT / "logs"))
os.environ.setdefault("LQC_BACKUPS_DIR", str(TEST_ROOT / "backups"))
os.environ.setdefault("LQC_DATABASE_PATH", str(TEST_ROOT / "data" / "local_quant_console_test.db"))
os.environ.setdefault("LQC_STRATEGY_USER_DIR", str(TEST_ROOT / "strategies" / "user"))


@pytest.fixture(autouse=True)
def reset_local_state():
    import gc
    import time
    from backend.core.config import settings
    from backend.core.database import initialize_database

    for directory in [settings.data_dir, settings.logs_dir, settings.backups_dir, settings.strategy_user_dir]:
        directory.mkdir(parents=True, exist_ok=True)

    gc.collect()
    for suffix in ["", "-wal", "-shm"]:
        path = Path(f"{settings.database_path}{suffix}")
        if path.exists():
            for _ in range(5):
                try:
                    path.unlink()
                    break
                except PermissionError:
                    gc.collect()
                    time.sleep(0.05)
            else:
                try:
                    with open(path, "wb") as f:
                        f.truncate(0)
                except Exception:
                    pass

    if settings.strategy_user_dir.exists():
        for _ in range(5):
            try:
                shutil.rmtree(settings.strategy_user_dir)
                break
            except PermissionError:
                gc.collect()
                time.sleep(0.05)
        else:
            try:
                shutil.rmtree(settings.strategy_user_dir, ignore_errors=True)
            except Exception:
                pass
    settings.strategy_user_dir.mkdir(parents=True, exist_ok=True)

    initialize_database()
    from backend.repositories.system.system_repository import SystemRepository

    SystemRepository().upsert_config(
        {
            "simulation_mode": ("true", "bool", "是否启用测试隔离数据源"),
            "account_id": ("test_isolation_account", "string", "测试隔离账户 ID"),
        }
    )
    yield
    try:
        from backend.api.backtest_api import wait_for_backtest_workers_for_tests

        wait_for_backtest_workers_for_tests()
    except Exception:
        pass

