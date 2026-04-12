"""
FastAPI 依赖注入

- verify_api_key: 校验 X-API-Key header **或** qmt_session Cookie
- get_request_id: 从中间件注入 request_id
"""

import hashlib
import hmac
import time

from fastapi import Request

from app.core.config import get_env_settings
from app.core.exceptions import AuthMissing

# ── 会话工具函数 ─────────────────────────────────────

SESSION_COOKIE_NAME = "qmt_session"
SESSION_MAX_AGE = 86400  # 24h


def _make_session_token(secret: str, issued_at: int) -> str:
    """生成 HMAC 会话令牌: hex(hmac) + '.' + issued_at"""
    payload = f"qmt_session:{issued_at}"
    sig = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{sig}.{issued_at}"


def _verify_session_token(token: str, secret: str) -> bool:
    """验证令牌签名和有效期"""
    parts = token.split(".", 1)
    if len(parts) != 2:
        return False
    sig, ts_str = parts
    try:
        issued_at = int(ts_str)
    except ValueError:
        return False
    if time.time() - issued_at > SESSION_MAX_AGE:
        return False
    expected = _make_session_token(secret, issued_at)
    return hmac.compare_digest(token, expected)


# ── 鉴权依赖 ─────────────────────────────────────────


async def verify_api_key(request: Request) -> None:
    """校验 X-API-Key header 或 qmt_session Cookie，二选一"""
    settings = get_env_settings()

    # 优先检查 X-API-Key（脚本/运维调用）
    key = request.headers.get("X-API-Key")
    if key and key == settings.api_key:
        return

    # 检查会话 Cookie（浏览器调用）
    session_token = request.cookies.get(SESSION_COOKIE_NAME)
    if session_token and _verify_session_token(session_token, settings.secret_key):
        return

    raise AuthMissing("API Key 无效或会话未建立")


def get_request_id(request: Request) -> str:
    """从 request.state 取中间件生成的 request_id"""
    return getattr(request.state, "request_id", "")
