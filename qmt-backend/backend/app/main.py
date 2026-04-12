"""
QMT 轻量化交易后台 — FastAPI 应用入口

架构参考: docs/architecture_v2_8.md
第一阶段范围: docs/mvp_scope.md
"""

import time
import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.core.config import BASE_DIR, get_env_settings
from app.core.exceptions import BizError
from app.core.logging import setup_logging, get_logger
from app.core.response import ApiResponse, ERR_INTERNAL
from app.core.rate_limit import RateLimitMiddleware

from app.db.database import get_engine, init_db, close_db
from app.db.migration import run_migrations

from app.api.system import router as system_router
from app.api.strategies import router as strategies_router
from app.api.trading import router as trading_router
from app.api.risk import router as risk_router
from app.api.logs import router as logs_router
from app.api.ws import router as ws_router
from app.api.auth import router as auth_router


# ── 日志初始化（必须在 app 创建前） ──────────────────
setup_logging()
logger = get_logger("qmt_backend")


# ── 应用生命周期 ─────────────────────────────────────
from contextlib import asynccontextmanager  # noqa: E402


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_env_settings()
    logger.info("=== QMT 后台启动 | env=%s | mock=%s ===", settings.env, settings.mock_mode)

    # 数据库初始化 + 迁移
    await init_db()
    engine = get_engine()
    async with engine.begin() as conn:
        applied = await run_migrations(conn)
        if applied:
            logger.info("本次执行迁移 %d 个: %s", len(applied), applied)

    # 启动前检查（降级运行，不阻止启动）
    from app.core.preflight import run_preflight
    async with engine.connect() as conn:
        preflight_results = await run_preflight(conn)
        app.state.preflight_results = [r.to_dict() for r in preflight_results]

    yield

    await close_db()
    logger.info("=== QMT 后台关闭 ===")


app = FastAPI(
    title="QMT 轻量化交易后台",
    version="0.1.0",
    description="基于国金 QMT 的轻量级单体量化交易后台",
    lifespan=lifespan,
)


# ── 速率限制中间件（默认关闭） ───────────────────────
app.add_middleware(RateLimitMiddleware)


# ── 中间件：request_id 注入 + 访问日志 ──────────────
@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-Id") or uuid.uuid4().hex
    request.state.request_id = request_id

    start = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - start) * 1000

    logger.info(
        "%s %s → %d (%.1fms) [%s]",
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
        request_id,
    )
    response.headers["X-Request-Id"] = request_id
    return response


# ── 全局异常处理：BizError → 统一响应 ───────────────
@app.exception_handler(BizError)
async def biz_error_handler(request: Request, exc: BizError):
    rid = getattr(request.state, "request_id", "")
    logger.warning("BizError %d: %s [%s]", exc.code, exc.message, rid)
    resp = ApiResponse.error(exc.code, exc.message, data=exc.data, request_id=rid)
    status = 401 if exc.code in (4001, 4002) else 400
    return JSONResponse(status_code=status, content=resp.model_dump())


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    rid = getattr(request.state, "request_id", "")
    logger.exception("未捕获异常 [%s]: %s", rid, exc)

    # WS 广播 system_error
    try:
        from app.api.ws import ws_manager
        await ws_manager.broadcast("system_error", {
            "message": f"服务内部错误: {type(exc).__name__}",
            "path": str(request.url.path),
            "request_id": rid,
        })
    except Exception:
        pass  # WS 广播失败不影响响应

    resp = ApiResponse.error(ERR_INTERNAL, f"服务内部错误: {type(exc).__name__}", request_id=rid)
    return JSONResponse(status_code=500, content=resp.model_dump())


# ── 注册路由 ─────────────────────────────────────────
app.include_router(system_router)
app.include_router(auth_router)
app.include_router(strategies_router)
app.include_router(trading_router)
app.include_router(risk_router)
app.include_router(logs_router)
app.include_router(ws_router)

# ── 静态文件挂载（必须放在路由之后，作为 fallback） ──
static_dir = BASE_DIR / "static"
static_dir.mkdir(exist_ok=True)
app.mount("/static", StaticFiles(directory=str(static_dir), html=True), name="static")
