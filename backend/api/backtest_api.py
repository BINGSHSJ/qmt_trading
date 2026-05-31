import logging
import threading

from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse

from backend.core.response import ApiResponse, success_response
from backend.schemas.backtest import (
    BacktestCreateRequest,
    BacktestDataCheckRequest,
    BacktestDataCheckResult,
    BacktestEquityRecord,
    BacktestLogRecord,
    BacktestReport,
    BacktestResultRecord,
    BacktestSignalRecord,
    BacktestTaskRecord,
    BacktestTradeRecord,
)
from backend.schemas.common import PageQuery, PageResult
from backend.schemas.system import TaskCreated
from backend.services.backtest_center.backtest_service import BacktestService

router = APIRouter(prefix="/backtests", tags=["backtest-research"])
logger = logging.getLogger("backend.error")


def service() -> BacktestService:
    return BacktestService()


def page_query(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    keyword: str | None = None,
    sort_field: str = "created_at",
    sort_order: str = "desc",
    start_date: str | None = None,
    end_date: str | None = None,
    status: str | None = None,
) -> PageQuery:
    return PageQuery(
        page=page,
        page_size=page_size,
        keyword=keyword,
        sort_field=sort_field,
        sort_order=sort_order,
        start_date=start_date,
        end_date=end_date,
        status=status,
    )


def _run_backtest_detached(task_id: str) -> None:
    try:
        BacktestService().run_backtest_task(task_id)
    except Exception:  # pragma: no cover - run_backtest_task records handled failures.
        logger.exception("回测后台任务异常退出：task_id=%s", task_id)


def _start_backtest_worker(task_id: str) -> None:
    thread = threading.Thread(
        target=_run_backtest_detached,
        args=(task_id,),
        name=f"backtest-{task_id}",
        daemon=True,
    )
    thread.start()


def wait_for_backtest_workers_for_tests(timeout: float = 10.0) -> None:
    """Test helper: avoid deleting SQLite files while detached workers are alive."""
    for thread in list(threading.enumerate()):
        if thread.name.startswith("backtest-") and thread.is_alive():
            thread.join(timeout)


@router.post("", response_model=ApiResponse[TaskCreated])
async def create_backtest(request: BacktestCreateRequest) -> ApiResponse[TaskCreated]:
    backtest_service = service()
    task = backtest_service.create_backtest(request)
    _start_backtest_worker(task.task_id)
    return success_response(task, "回测任务已创建")


@router.post("/check-data", response_model=ApiResponse[BacktestDataCheckResult])
async def check_data(request: BacktestDataCheckRequest) -> ApiResponse[BacktestDataCheckResult]:
    return success_response(service().check_data(request), "回测数据检查完成")


@router.get("", response_model=ApiResponse[PageResult[BacktestTaskRecord]])
async def list_backtests(query: PageQuery = Depends(page_query)) -> ApiResponse[PageResult[BacktestTaskRecord]]:
    return success_response(service().list_tasks(query), "获取回测列表成功")


@router.get("/{task_id}", response_model=ApiResponse[BacktestTaskRecord])
async def get_backtest(task_id: str) -> ApiResponse[BacktestTaskRecord]:
    return success_response(service().get_task(task_id), "获取回测任务成功")


@router.delete("/{task_id}", response_model=ApiResponse[None])
async def delete_backtest(task_id: str) -> ApiResponse[None]:
    service().delete_task(task_id)
    return success_response(None, "删除回测成功")


@router.post("/{task_id}/cancel", response_model=ApiResponse[BacktestTaskRecord])
async def cancel_backtest(task_id: str) -> ApiResponse[BacktestTaskRecord]:
    return success_response(service().cancel_task(task_id), "回测取消请求已处理")


@router.post("/{task_id}/rerun", response_model=ApiResponse[TaskCreated])
async def rerun_backtest(task_id: str) -> ApiResponse[TaskCreated]:
    backtest_service = service()
    task = backtest_service.rerun(task_id)
    _start_backtest_worker(task.task_id)
    return success_response(task, "复跑任务已创建")


@router.get("/{task_id}/result", response_model=ApiResponse[BacktestResultRecord | None])
async def get_result(task_id: str) -> ApiResponse[BacktestResultRecord | None]:
    return success_response(service().result(task_id), "获取回测结果成功")


@router.get("/{task_id}/equity", response_model=ApiResponse[list[BacktestEquityRecord]])
async def get_equity(task_id: str, max_points: int = Query(default=2000, ge=100, le=5000)) -> ApiResponse[list[BacktestEquityRecord]]:
    return success_response(service().equity(task_id, max_points=max_points), "获取资金曲线成功")


@router.get("/{task_id}/drawdown", response_model=ApiResponse[list[BacktestEquityRecord]])
async def get_drawdown(task_id: str, max_points: int = Query(default=2000, ge=100, le=5000)) -> ApiResponse[list[BacktestEquityRecord]]:
    return success_response(service().drawdown(task_id, max_points=max_points), "获取回撤曲线成功")


@router.get("/{task_id}/trades", response_model=ApiResponse[PageResult[BacktestTradeRecord]])
async def get_trades(task_id: str, query: PageQuery = Depends(page_query)) -> ApiResponse[PageResult[BacktestTradeRecord]]:
    return success_response(service().trades(task_id, query), "获取成交明细成功")


@router.get("/{task_id}/signals", response_model=ApiResponse[PageResult[BacktestSignalRecord]])
async def get_signals(task_id: str, query: PageQuery = Depends(page_query)) -> ApiResponse[PageResult[BacktestSignalRecord]]:
    return success_response(service().signals(task_id, query), "获取回测信号审计成功")


@router.get("/{task_id}/logs", response_model=ApiResponse[PageResult[BacktestLogRecord]])
async def get_logs(task_id: str, query: PageQuery = Depends(page_query)) -> ApiResponse[PageResult[BacktestLogRecord]]:
    return success_response(service().logs(task_id, query), "获取回测日志成功")


@router.get("/{task_id}/report", response_model=ApiResponse[BacktestReport])
async def get_report(task_id: str) -> ApiResponse[BacktestReport]:
    return success_response(service().report(task_id), "获取回测报告成功")


@router.get("/{task_id}/export")
async def export_backtest(task_id: str) -> FileResponse:
    path = service().export_workbook(task_id)
    return FileResponse(
        path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=path.name,
    )
