from fastapi import APIRouter, BackgroundTasks, Depends, Query

from backend.core.response import ApiResponse, success_response
from backend.schemas.common import PageQuery, PageResult
from backend.schemas.system import TaskCreated
from backend.schemas.trading import (
    ExecutionLogRecord,
    ManualOrderRequest,
    OrderSubmitResult,
    SignalOrderRequest,
    TradingOrderRecord,
    TradingPosition,
    TradingSignalRecord,
    TradingTradeRecord,
)
from backend.services.trading_center.trading_service import TradingService

router = APIRouter(prefix="/trading", tags=["trading-execution"])


def service() -> TradingService:
    return TradingService()


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


@router.post("/orders/manual", response_model=ApiResponse[OrderSubmitResult])
async def submit_manual_order(request: ManualOrderRequest) -> ApiResponse[OrderSubmitResult]:
    return success_response(service().submit_manual_order(request), "手动委托处理完成")


@router.post("/orders/from-signal/{signal_id}", response_model=ApiResponse[OrderSubmitResult])
async def submit_signal_order(signal_id: int, request: SignalOrderRequest | None = None) -> ApiResponse[OrderSubmitResult]:
    return success_response(service().submit_signal_order(signal_id, request or SignalOrderRequest()), "信号委托处理完成")


@router.post("/signals/{signal_id}/ignore", response_model=ApiResponse[TradingSignalRecord])
async def ignore_signal(signal_id: int) -> ApiResponse[TradingSignalRecord]:
    return success_response(service().ignore_signal(signal_id), "忽略信号成功")


@router.post("/orders/{order_id}/cancel", response_model=ApiResponse[TradingOrderRecord])
async def cancel_order(order_id: str) -> ApiResponse[TradingOrderRecord]:
    return success_response(service().cancel_order(order_id), "撤单处理完成")


@router.get("/positions", response_model=ApiResponse[PageResult[TradingPosition]])
async def positions(query: PageQuery = Depends(page_query)) -> ApiResponse[PageResult[TradingPosition]]:
    return success_response(service().list_positions(query), "获取当前持仓成功")


@router.get("/orders", response_model=ApiResponse[PageResult[TradingOrderRecord]])
async def orders(query: PageQuery = Depends(page_query)) -> ApiResponse[PageResult[TradingOrderRecord]]:
    return success_response(service().list_orders(query), "获取委托记录成功")


@router.get("/trades", response_model=ApiResponse[PageResult[TradingTradeRecord]])
async def trades(query: PageQuery = Depends(page_query)) -> ApiResponse[PageResult[TradingTradeRecord]]:
    return success_response(service().list_trades(query), "获取成交记录成功")


@router.get("/signals", response_model=ApiResponse[PageResult[TradingSignalRecord]])
async def signals(query: PageQuery = Depends(page_query)) -> ApiResponse[PageResult[TradingSignalRecord]]:
    return success_response(service().list_signals(query), "获取待下单信号成功")


@router.get("/logs", response_model=ApiResponse[PageResult[ExecutionLogRecord]])
async def logs(query: PageQuery = Depends(page_query)) -> ApiResponse[PageResult[ExecutionLogRecord]]:
    return success_response(service().list_logs(query), "获取执行日志成功")


@router.post("/orders/sync", response_model=ApiResponse[TaskCreated])
async def sync_orders(background_tasks: BackgroundTasks) -> ApiResponse[TaskCreated]:
    trading_service = service()
    task = trading_service.create_order_sync_task()
    background_tasks.add_task(trading_service.run_order_sync_task, task.task_id)
    return success_response(task, "委托同步任务已创建")


@router.post("/trades/sync", response_model=ApiResponse[TaskCreated])
async def sync_trades(background_tasks: BackgroundTasks) -> ApiResponse[TaskCreated]:
    trading_service = service()
    task = trading_service.create_trade_sync_task()
    background_tasks.add_task(trading_service.run_trade_sync_task, task.task_id)
    return success_response(task, "成交同步任务已创建")
