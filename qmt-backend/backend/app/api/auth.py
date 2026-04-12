"""
认证路由 — Dev 会话建立

POST /api/v1/auth/session  → 用 API_KEY 换取 HttpOnly Cookie
GET  /api/v1/auth/ws-ticket → 返回一次性 WebSocket 连接票据
"""

import secrets
import time

from fastapi import APIRouter, Depends, Request, Response

from app.core.config import get_env_settings
from app.core.dependencies import (
    SESSION_COOKIE_NAME,
    _make_session_token,
    verify_api_key,
)
from app.core.response import ApiResponse

router = APIRouter(prefix="/api/v1/auth", tags=["认证"])

# ── 一次性 WS 票据存储（进程内，单 worker 足够） ───────
_ws_tickets: dict[str, float] = {}
WS_TICKET_TTL = 30  # 秒


def consume_ws_ticket(ticket: str) -> bool:
    """验证并消耗一次性票据，返回是否有效"""
    ts = _ws_tickets.pop(ticket, None)
    if ts is None:
        return False
    return (time.time() - ts) < WS_TICKET_TTL


# ── 路由 ────────────────────────────────────────────


@router.post("/session")
async def create_session(request: Request, response: Response):
    """
    浏览器初始化会话：
    - 需要 X-API-Key header 验证身份
    - 设置 HttpOnly + SameSite=Strict cookie
    """
    settings = get_env_settings()

    # 安全约束：必须提供有效 API Key
    api_key = request.headers.get("X-API-Key", "")
    if not api_key or api_key != settings.api_key:
        from app.core.exceptions import AuthMissing
        raise AuthMissing("创建会话需提供有效的 X-API-Key")

    token = _make_session_token(settings.secret_key, int(time.time()))
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="strict",
        max_age=86400,
        path="/",
    )
    return ApiResponse.success(data={"session": "created"})


@router.get("/ws-ticket", dependencies=[Depends(verify_api_key)])
async def get_ws_ticket():
    """
    已认证用户获取一次性 WS 票据（30 秒有效）
    """
    # 清理过期票据
    now = time.time()
    expired = [k for k, v in _ws_tickets.items() if now - v > WS_TICKET_TTL]
    for k in expired:
        del _ws_tickets[k]

    ticket = secrets.token_urlsafe(32)
    _ws_tickets[ticket] = now
    return ApiResponse.success(data={"ticket": ticket})
