from fastapi.testclient import TestClient

from backend.main import app


def test_health_check_returns_unified_response():
    client = TestClient(app)

    response = client.get("/api/health")

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["message"] == "健康检查正常"
    assert body["data"]["api_status"] == "ok"
    assert body["data"]["qmt"]["mode"] == "test_isolation"
    assert {item["name"] for item in body["data"]["directories"]} == {"data", "logs", "backups"}
