"""
简易速率限制中间件

基于滑动窗口计数器，按 (client_ip, path) 限流。
默认关闭 (RATE_LIMIT_ENABLED=false)，启用后默认 10 req/s。
"""

import time
from collections import defaultdict
from threading import Lock

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import get_env_settings, yaml_get
from app.core.response import ApiResponse


class _SlidingWindowCounter:
    """线程安全的滑动窗口计数器"""

    def __init__(self):
        self._windows: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()

    def is_allowed(self, key: str, max_requests: int, window_sec: float) -> bool:
        now = time.monotonic()
        cutoff = now - window_sec
        with self._lock:
            # 清理过期记录
            timestamps = self._windows[key]
            self._windows[key] = [t for t in timestamps if t > cutoff]

            if len(self._windows[key]) >= max_requests:
                return False
            self._windows[key].append(now)
            return True


_counter = _SlidingWindowCounter()


def _get_client_ip(request: Request) -> str:
    """获取客户端 IP，支持 X-Forwarded-For"""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class RateLimitMiddleware(BaseHTTPMiddleware):
    """速率限制中间件"""

    async def dispatch(self, request: Request, call_next):
        # 检查是否启用
        enabled = yaml_get("rate_limit", "enabled", default=False)
        if not enabled:
            return await call_next(request)

        # 跳过非 API 路径（静态资源、docs 等）
        path = request.url.path
        if not path.startswith("/api/") and path != "/ws":
            return await call_next(request)

        max_rps = yaml_get("rate_limit", "max_per_second", default=10)
        client_ip = _get_client_ip(request)
        key = f"{client_ip}:{path}"

        if not _counter.is_allowed(key, max_rps, 1.0):
            resp = ApiResponse.error(4290, "请求频率超限，请稍后重试")
            return JSONResponse(
                status_code=429,
                content=resp.model_dump(),
                headers={"Retry-After": "1"},
            )

        return await call_next(request)
