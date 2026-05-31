import json
import logging
import time

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from backend.api.health import router as health_router
from backend.api.backtest_api import router as backtest_router
from backend.api.dashboard_api import router as dashboard_router
from backend.api.data_center_api import router as data_center_router
from backend.api.strategy_dev_api import router as strategy_dev_router
from backend.api.system_api import router as system_router
from backend.api.task_api import router as task_router
from backend.api.trading_api import router as trading_router
from backend.core.config import settings
from backend.core.database import initialize_database
from backend.core.exceptions import AppError
from backend.core.logging import configure_logging
from backend.core.response import error_response


configure_logging()
initialize_database()
try:
    from backend.services.system.system_service import SystemService

    SystemService().recover_interrupted_tasks_on_startup()
except Exception:  # pragma: no cover - startup guard must not block API import.
    logging.getLogger("backend.error").exception("启动任务扫尾失败。")

app = FastAPI(title=settings.app_name, version=settings.app_version)
request_logger = logging.getLogger("backend.request")
error_logger = logging.getLogger("backend.error")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router, prefix="/api")
app.include_router(dashboard_router, prefix="/api")
app.include_router(data_center_router, prefix="/api")
app.include_router(strategy_dev_router, prefix="/api")
app.include_router(backtest_router, prefix="/api")
app.include_router(system_router, prefix="/api")
app.include_router(task_router, prefix="/api")
app.include_router(trading_router, prefix="/api")


@app.middleware("http")
async def request_log_middleware(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    duration_ms = (time.perf_counter() - start) * 1000
    request_logger.info(
        "接口请求完成：method=%s path=%s status=%s duration_ms=%.2f",
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )
    return response


def _validation_error_detail(exc: RequestValidationError) -> str:
    details: list[dict[str, object]] = []
    for error in exc.errors():
        loc = ".".join(str(part) for part in error.get("loc", []))
        details.append(
            {
                "field": loc,
                "type": error.get("type"),
                "message": error.get("msg"),
                "input": error.get("input"),
                "ctx": error.get("ctx"),
            }
        )
    return json.dumps(details, ensure_ascii=False, default=str)


@app.exception_handler(AppError)
async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=error_response(
            message=exc.message,
            code=exc.code,
            detail=exc.detail,
            suggestion=exc.suggestion,
            trace_id=getattr(request.state, "trace_id", None),
        ).model_dump(),
    )


@app.exception_handler(RequestValidationError)
async def request_validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content=error_response(
            message="请求参数不符合要求，请检查页面输入后重试。",
            code="REQUEST_VALIDATION_ERROR",
            detail=_validation_error_detail(exc),
            suggestion="请检查分页参数、表单必填项和字段格式；如果从页面操作触发，请复制技术详情给 AI 排查。",
            trace_id=getattr(request.state, "trace_id", None),
        ).model_dump(),
    )


@app.exception_handler(Exception)
async def unexpected_error_handler(request: Request, exc: Exception) -> JSONResponse:
    error_logger.exception(
        "系统发生未知错误：method=%s path=%s detail=%r",
        request.method,
        request.url.path,
        exc,
    )
    return JSONResponse(
        status_code=500,
        content=error_response(
            message="系统发生未知错误，请复制技术详情给 AI 排查。",
            code="INTERNAL_ERROR",
            detail=repr(exc),
            suggestion="请稍后重试，或查看 logs/error.log",
            trace_id=getattr(request.state, "trace_id", None),
        ).model_dump(),
    )


@app.get("/")
async def root():
    return {"message": "Local Quant Console API", "docs": "/docs"}
