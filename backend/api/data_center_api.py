from fastapi import APIRouter, BackgroundTasks, Depends, Query
from fastapi.responses import FileResponse

from backend.core.response import ApiResponse, success_response
from backend.schemas.common import PageQuery, PageResult
from backend.schemas.data_center import (
    AccountSnapshot,
    AccountSnapshotDuplicateRecord,
    DailyKline,
    DataCoverageRecord,
    DataDictionaryRecord,
    DataFreshnessSummary,
    DataQualityRecord,
    DataQualitySummary,
    DataSourceRecord,
    InstrumentDetail,
    LatestQuote,
    LatestDataSyncRequest,
    LegacyCursorCleanupResult,
    MinuteKline,
    OrderRecord,
    OfficialDataCatalog,
    PositionSnapshot,
    Prepare2026Plan,
    Prepare2026Request,
    QmtStatus,
    StockBasic,
    SyncLogRecord,
    SyncRequest,
    SyncTaskSummary,
    TradingCalendarRecord,
    TradeRecord,
)
from backend.schemas.system import TaskCreated
from backend.services.data_center.data_center_service import DataCenterService

router = APIRouter(prefix="/data", tags=["data-center"])


def service() -> DataCenterService:
    return DataCenterService()


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


@router.get("/sources", response_model=ApiResponse[list[DataSourceRecord]])
async def list_sources() -> ApiResponse[list[DataSourceRecord]]:
    return success_response(service().list_sources(), "获取数据源成功")


@router.get("/catalog", response_model=ApiResponse[OfficialDataCatalog])
async def official_catalog_alias() -> ApiResponse[OfficialDataCatalog]:
    return success_response(service().official_catalog(), "获取 QMT 官方数据目录成功")


@router.get("/catalog/official", response_model=ApiResponse[OfficialDataCatalog])
async def official_catalog() -> ApiResponse[OfficialDataCatalog]:
    return success_response(service().official_catalog(), "获取 QMT 官方数据目录成功")


@router.get("/sources/qmt/status", response_model=ApiResponse[QmtStatus])
async def qmt_status() -> ApiResponse[QmtStatus]:
    return success_response(service().qmt_status(), "获取 QMT 状态成功")


@router.post("/sources/qmt/connect", response_model=ApiResponse[QmtStatus])
async def connect_qmt() -> ApiResponse[QmtStatus]:
    status = service().connect_qmt()
    return success_response(status, f"连接{status.source_name}成功")


@router.post("/sources/qmt/disconnect", response_model=ApiResponse[QmtStatus])
async def disconnect_qmt() -> ApiResponse[QmtStatus]:
    status = service().disconnect_qmt()
    return success_response(status, f"断开{status.source_name}成功")


@router.post("/sources/qmt/test", response_model=ApiResponse[QmtStatus])
async def test_qmt() -> ApiResponse[QmtStatus]:
    status = service().test_qmt()
    return success_response(status, f"测试{status.source_name}成功")


@router.get("/account/latest", response_model=ApiResponse[AccountSnapshot | None])
async def latest_account() -> ApiResponse[AccountSnapshot | None]:
    return success_response(service().latest_account(), "获取账户资金成功")


@router.get("/positions", response_model=ApiResponse[PageResult[PositionSnapshot]])
async def positions(
    query: PageQuery = Depends(page_query),
    scope: str = Query(default="current", pattern="^(current|account_history|all_history)$"),
) -> ApiResponse[PageResult[PositionSnapshot]]:
    return success_response(service().list_positions(query, scope), "获取持仓成功")


@router.get("/orders", response_model=ApiResponse[PageResult[OrderRecord]])
async def orders(
    query: PageQuery = Depends(page_query),
    scope: str = Query(default="current", pattern="^(current|account_history|all_history)$"),
) -> ApiResponse[PageResult[OrderRecord]]:
    return success_response(service().list_orders(query, scope), "获取委托成功")


@router.get("/trades", response_model=ApiResponse[PageResult[TradeRecord]])
async def trades(
    query: PageQuery = Depends(page_query),
    scope: str = Query(default="current", pattern="^(current|account_history|all_history)$"),
) -> ApiResponse[PageResult[TradeRecord]]:
    return success_response(service().list_trades(query, scope), "获取成交成功")


@router.get("/stocks", response_model=ApiResponse[PageResult[StockBasic]])
async def stocks(query: PageQuery = Depends(page_query)) -> ApiResponse[PageResult[StockBasic]]:
    return success_response(service().list_stocks(query), "获取股票基础成功")


@router.get("/basic/instruments", response_model=ApiResponse[PageResult[InstrumentDetail]])
async def instruments(query: PageQuery = Depends(page_query)) -> ApiResponse[PageResult[InstrumentDetail]]:
    return success_response(service().list_instrument_details(query), "获取合约基础信息成功")


@router.get("/basic/trading-calendar", response_model=ApiResponse[PageResult[TradingCalendarRecord]])
async def trading_calendar(query: PageQuery = Depends(page_query)) -> ApiResponse[PageResult[TradingCalendarRecord]]:
    return success_response(service().list_trading_calendar(query), "获取交易日历成功")


@router.get("/kline/daily", response_model=ApiResponse[PageResult[DailyKline]])
async def daily_kline(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    keyword: str | None = None,
    symbol: str | None = None,
    sort_field: str = "trade_date",
    sort_order: str = "desc",
    start_date: str | None = None,
    end_date: str | None = None,
) -> ApiResponse[PageResult[DailyKline]]:
    return success_response(service().list_daily_kline(page_query(page, page_size, keyword, sort_field, sort_order, start_date, end_date), symbol), "获取日K成功")


@router.get("/kline/minute", response_model=ApiResponse[PageResult[MinuteKline]])
async def minute_kline(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    keyword: str | None = None,
    symbol: str | None = None,
    period: str | None = None,
    sort_field: str = "datetime",
    sort_order: str = "desc",
    start_date: str | None = None,
    end_date: str | None = None,
) -> ApiResponse[PageResult[MinuteKline]]:
    return success_response(service().list_minute_kline(page_query(page, page_size, keyword, sort_field, sort_order, start_date, end_date), symbol, period), "获取分钟K成功")


@router.get("/quotes/latest", response_model=ApiResponse[list[LatestQuote]])
async def latest_quotes(symbols: str | None = None) -> ApiResponse[list[LatestQuote]]:
    symbol_list = [item.strip() for item in symbols.split(",")] if symbols else None
    return success_response(service().latest_quotes(symbol_list), "获取最新行情成功")


def create_sync(sync_type: str, background_tasks: BackgroundTasks, request: SyncRequest | None = None) -> ApiResponse[TaskCreated]:
    data_service = service()
    task = data_service.create_sync_task(sync_type, request)
    background_tasks.add_task(data_service.run_sync_task, task.task_id, sync_type, request)
    return success_response(task, "同步任务已创建")


@router.post("/sync/stock-basic", response_model=ApiResponse[TaskCreated])
async def sync_stock_basic(background_tasks: BackgroundTasks) -> ApiResponse[TaskCreated]:
    return create_sync("stock_basic", background_tasks)


@router.post("/sync/instrument-detail", response_model=ApiResponse[TaskCreated])
async def sync_instrument_detail(background_tasks: BackgroundTasks, request: SyncRequest | None = None) -> ApiResponse[TaskCreated]:
    return create_sync("instrument_detail", background_tasks, request)


@router.post("/sync/trading-calendar", response_model=ApiResponse[TaskCreated])
async def sync_trading_calendar(background_tasks: BackgroundTasks, request: SyncRequest | None = None) -> ApiResponse[TaskCreated]:
    return create_sync("trading_calendar", background_tasks, request)


@router.post("/sync/account", response_model=ApiResponse[TaskCreated])
async def sync_account(background_tasks: BackgroundTasks) -> ApiResponse[TaskCreated]:
    return create_sync("account", background_tasks)


@router.post("/sync/positions", response_model=ApiResponse[TaskCreated])
async def sync_positions(background_tasks: BackgroundTasks) -> ApiResponse[TaskCreated]:
    return create_sync("positions", background_tasks)


@router.post("/sync/orders", response_model=ApiResponse[TaskCreated])
async def sync_orders(background_tasks: BackgroundTasks) -> ApiResponse[TaskCreated]:
    return create_sync("orders", background_tasks)


@router.post("/sync/trades", response_model=ApiResponse[TaskCreated])
async def sync_trades(background_tasks: BackgroundTasks) -> ApiResponse[TaskCreated]:
    return create_sync("trades", background_tasks)


@router.post("/sync/daily-kline", response_model=ApiResponse[TaskCreated])
async def sync_daily_kline(request: SyncRequest, background_tasks: BackgroundTasks) -> ApiResponse[TaskCreated]:
    return create_sync("daily_kline", background_tasks, request)


@router.post("/sync/minute-kline", response_model=ApiResponse[TaskCreated])
async def sync_minute_kline(request: SyncRequest, background_tasks: BackgroundTasks) -> ApiResponse[TaskCreated]:
    return create_sync("minute_kline", background_tasks, request)


@router.post("/sync/all", response_model=ApiResponse[TaskCreated])
async def sync_all(background_tasks: BackgroundTasks) -> ApiResponse[TaskCreated]:
    return create_sync("all", background_tasks, SyncRequest(symbols=["600000.SH", "000001.SZ"], start_date="2026-05-06", end_date="2026-05-08"))


@router.post("/sync/prepare-2026", response_model=ApiResponse[Prepare2026Plan])
async def prepare_2026_sync(request: Prepare2026Request | None = None) -> ApiResponse[Prepare2026Plan]:
    return success_response(service().prepare_2026_sync(request), "生成 2026 数据补齐计划成功")


@router.post("/sync/run-2026", response_model=ApiResponse[TaskCreated])
async def run_2026_sync(background_tasks: BackgroundTasks, request: Prepare2026Request | None = None) -> ApiResponse[TaskCreated]:
    data_service = service()
    task = data_service.create_2026_sync_task(request)
    background_tasks.add_task(data_service.run_2026_sync_task, task.task_id, request)
    return success_response(task, "2026 数据补齐任务已创建")


@router.post("/sync/latest", response_model=ApiResponse[TaskCreated])
async def sync_latest_data(background_tasks: BackgroundTasks, request: LatestDataSyncRequest | None = None) -> ApiResponse[TaskCreated]:
    data_service = service()
    task = data_service.create_latest_data_sync_task(request)
    background_tasks.add_task(data_service.run_latest_data_sync_task, task.task_id, request)
    return success_response(task, "同步到最新完成交易日任务已创建")


@router.get("/sync/coverage-2026", response_model=ApiResponse[PageResult[DataCoverageRecord]])
async def coverage_2026(query: PageQuery = Depends(page_query)) -> ApiResponse[PageResult[DataCoverageRecord]]:
    return success_response(service().list_2026_coverage(query), "获取 2026 数据覆盖率成功")


@router.get("/freshness/summary", response_model=ApiResponse[DataFreshnessSummary])
async def freshness_summary() -> ApiResponse[DataFreshnessSummary]:
    return success_response(service().data_freshness_summary(), "获取数据新鲜度摘要成功")


@router.get("/sync/coverage-2026/missing-export")
async def export_coverage_2026_missing(
    data_type: str | None = Query(default=None, pattern="^(stock_basic|trading_calendar|instrument_detail|daily_kline|minute_kline)$"),
    period: str = Query(default="1m", pattern="^(1m|5m|15m|30m|60m)$"),
    start_date: str | None = Query(default=None, pattern="^\\d{4}-\\d{2}-\\d{2}$"),
    end_date: str | None = Query(default=None, pattern="^\\d{4}-\\d{2}-\\d{2}$"),
) -> FileResponse:
    path = service().export_2026_missing_coverage(data_type=data_type, period=period, start_date=start_date, end_date=end_date)
    return FileResponse(path, media_type="text/csv; charset=utf-8", filename=path.name)


@router.get("/sync/tasks", response_model=ApiResponse[PageResult[SyncTaskSummary]])
async def sync_tasks(query: PageQuery = Depends(page_query)) -> ApiResponse[PageResult[SyncTaskSummary]]:
    return success_response(service().list_sync_tasks(query), "获取同步任务成功")


@router.get("/sync/logs", response_model=ApiResponse[PageResult[SyncLogRecord]])
async def sync_logs(query: PageQuery = Depends(page_query)) -> ApiResponse[PageResult[SyncLogRecord]]:
    return success_response(service().list_sync_logs(query), "获取同步日志成功")


@router.post("/quality/check", response_model=ApiResponse[TaskCreated])
async def quality_check(background_tasks: BackgroundTasks) -> ApiResponse[TaskCreated]:
    data_service = service()
    task = data_service.create_quality_task()
    background_tasks.add_task(data_service.run_quality_check, task.task_id)
    return success_response(task, "数据质量检查任务已创建")


@router.get("/quality/results", response_model=ApiResponse[PageResult[DataQualityRecord]])
async def quality_results(query: PageQuery = Depends(page_query)) -> ApiResponse[PageResult[DataQualityRecord]]:
    return success_response(service().list_quality_results(query), "获取质量检查结果成功")


@router.get("/quality/summary", response_model=ApiResponse[DataQualitySummary])
async def quality_summary() -> ApiResponse[DataQualitySummary]:
    return success_response(service().quality_summary(), "获取质量摘要成功")


@router.get("/quality/account-snapshot-duplicates", response_model=ApiResponse[PageResult[AccountSnapshotDuplicateRecord]])
async def account_snapshot_duplicates(query: PageQuery = Depends(page_query)) -> ApiResponse[PageResult[AccountSnapshotDuplicateRecord]]:
    return success_response(service().list_account_snapshot_duplicates(query), "获取账户快照重复排查报告成功")


@router.post("/sync/cursors/legacy/cleanup", response_model=ApiResponse[LegacyCursorCleanupResult])
async def cleanup_legacy_sync_cursors() -> ApiResponse[LegacyCursorCleanupResult]:
    return success_response(service().cleanup_legacy_sync_cursors(), "清理旧同步游标完成")


@router.get("/dictionary", response_model=ApiResponse[PageResult[DataDictionaryRecord]])
async def dictionary(query: PageQuery = Depends(page_query)) -> ApiResponse[PageResult[DataDictionaryRecord]]:
    return success_response(service().list_dictionary(query), "获取数据字典成功")


@router.get("/dictionary/{table_name}", response_model=ApiResponse[PageResult[DataDictionaryRecord]])
async def dictionary_table(table_name: str, query: PageQuery = Depends(page_query)) -> ApiResponse[PageResult[DataDictionaryRecord]]:
    return success_response(service().list_dictionary(query, table_name), "获取数据字典成功")
