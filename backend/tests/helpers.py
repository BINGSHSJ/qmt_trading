import time

from fastapi.testclient import TestClient


def wait_for_task(client: TestClient, task_id: str, timeout: float = 10):
    deadline = time.perf_counter() + timeout
    last_task = None
    while time.perf_counter() < deadline:
        last_task = client.get(f"/api/tasks/{task_id}").json()["data"]
        if last_task["status"] in {"success", "failed", "cancelled"}:
            return last_task
        time.sleep(0.05)
    raise AssertionError(f"任务未在 {timeout} 秒内结束：{last_task}")
