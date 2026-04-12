"""
WebSocket 管理器 + 端点

事件类型:
  - trade_fill    成交推送
  - risk_alert    风控拦截
  - system_error  系统异常
  - strategy_error 策略异常

客户端连接: ws://<host>:<port>/ws?api_key=<key>
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

from app.core.config import get_env_settings
from app.core.dependencies import SESSION_COOKIE_NAME, _verify_session_token

logger = logging.getLogger("websocket")

router = APIRouter()


class ConnectionManager:
    """WebSocket 连接管理器 — 简单广播模式"""

    def __init__(self):
        self.active: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active.append(ws)
        logger.info("WS 连接 +1, 当前 %d", len(self.active))

    def disconnect(self, ws: WebSocket):
        if ws in self.active:
            self.active.remove(ws)
        logger.info("WS 断开, 当前 %d", len(self.active))

    async def broadcast(self, event_type: str, data: dict[str, Any]):
        """广播事件到所有连接"""
        message = json.dumps({
            "type": event_type,
            "data": data,
            "timestamp": datetime.now().isoformat(timespec="seconds"),
        }, ensure_ascii=False)
        dead: list[WebSocket] = []
        for conn in self.active:
            try:
                await conn.send_text(message)
            except Exception:
                dead.append(conn)
        for d in dead:
            self.disconnect(d)

    @property
    def count(self) -> int:
        return len(self.active)


# 全局单例
ws_manager = ConnectionManager()


@router.websocket("/ws")
async def websocket_endpoint(
    ws: WebSocket,
    api_key: str = Query(default=""),
    ticket: str = Query(default=""),
):
    """
    WebSocket 端点 — 支持三种认证方式（任一通过即可）:
    1. api_key 查询参数（脚本调用）
    2. ticket  一次性票据（浏览器，30 秒有效）
    3. qmt_session Cookie（浏览器）
    """
    settings = get_env_settings()
    authed = False

    # 方式 1: api_key query param
    if api_key and api_key == settings.api_key:
        authed = True

    # 方式 2: 一次性 ticket
    if not authed and ticket:
        from app.api.auth import consume_ws_ticket
        if consume_ws_ticket(ticket):
            authed = True

    # 方式 3: Cookie
    if not authed:
        cookie_token = ws.cookies.get(SESSION_COOKIE_NAME, "")
        if cookie_token and _verify_session_token(cookie_token, settings.secret_key):
            authed = True

    if not authed:
        await ws.close(code=4001, reason="Unauthorized")
        return

    await ws_manager.connect(ws)
    try:
        while True:
            # 保持连接，接收客户端心跳/ping
            data = await ws.receive_text()
            if data == "ping":
                await ws.send_text(json.dumps({
                    "type": "pong",
                    "timestamp": datetime.now().isoformat(timespec="seconds"),
                }))
    except WebSocketDisconnect:
        ws_manager.disconnect(ws)
