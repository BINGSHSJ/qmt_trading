from fastapi.testclient import TestClient

from backend.main import app


def test_query_validation_error_uses_unified_chinese_response():
    client = TestClient(app)

    response = client.get("/api/data/stocks?page=1&page_size=500")
    body = response.json()

    assert response.status_code == 422
    assert body["success"] is False
    assert body["message"] == "请求参数不符合要求，请检查页面输入后重试。"
    assert body["data"] is None
    assert body["error"]["code"] == "REQUEST_VALIDATION_ERROR"
    assert "page_size" in body["error"]["detail"]
    assert body["error"]["suggestion"]
    assert "detail" not in body


def test_body_validation_error_uses_unified_chinese_response():
    client = TestClient(app)

    response = client.post("/api/trading/orders/manual", json={})
    body = response.json()

    assert response.status_code == 422
    assert body["success"] is False
    assert body["message"] == "请求参数不符合要求，请检查页面输入后重试。"
    assert body["error"]["code"] == "REQUEST_VALIDATION_ERROR"
    assert "body.symbol" in body["error"]["detail"]
    assert "body.price" in body["error"]["detail"]
