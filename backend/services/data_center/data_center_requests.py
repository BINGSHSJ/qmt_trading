"""Request normalization helpers for data center services."""

from backend.adapters.qmt.data_standardizer import normalize_datetime, normalize_period, normalize_symbol
from backend.core.exceptions import DataSyncError
from backend.schemas.data_center import LatestDataSyncRequest, Prepare2026Request, SyncRequest


def normalized_symbols(symbols: list[str]) -> list[str]:
    return [normalized for symbol in symbols if (normalized := normalize_symbol(symbol))]


def normalize_sync_request(request: SyncRequest) -> SyncRequest:
    return SyncRequest(
        symbols=normalized_symbols(request.symbols),
        start_date=request.start_date,
        end_date=request.end_date,
        start_time=normalize_datetime(request.start_time) if request.start_time else None,
        end_time=normalize_datetime(request.end_time) if request.end_time else None,
        period=normalize_period(request.period),
    )


def normalize_latest_data_sync_request(request: LatestDataSyncRequest, default_end_date: str) -> LatestDataSyncRequest:
    return LatestDataSyncRequest(
        start_date=request.start_date or "2026-01-01",
        end_date=request.end_date or default_end_date,
        include_account=request.include_account,
        include_positions=request.include_positions,
        include_orders=request.include_orders,
        include_trades=request.include_trades,
        include_daily_kline=request.include_daily_kline,
        daily_batch_size=max(1, min(request.daily_batch_size, 200)),
        include_minute_kline=request.include_minute_kline,
        include_full_market_minute=request.include_full_market_minute,
        minute_batch_size=max(1, min(request.minute_batch_size, 100)),
        minute_window_days=max(1, min(request.minute_window_days, 7)),
        period=normalize_period(request.period),
        symbols=normalized_symbols(request.symbols),
        overwrite_existing=request.overwrite_existing,
    )


def validate_latest_data_sync_request(request: LatestDataSyncRequest) -> None:
    if request.include_minute_kline and not request.include_full_market_minute and not request.symbols:
        raise DataSyncError(
            message="同步到最新完成交易日时，分钟 K 必须显式选择全市场或指定股票。",
            code="DATA_SYNC_MINUTE_SCOPE_REQUIRED",
            detail="include_minute_kline=true; include_full_market_minute=false; symbols=[]",
            suggestion="普通最新同步默认不跑分钟 K；如需分钟策略验收，请点击全市场分钟K补齐或指定股票范围。",
        )


def normalize_prepare_2026_request(request: Prepare2026Request, default_end_date: str) -> Prepare2026Request:
    return Prepare2026Request(
        start_date=request.start_date or "2026-01-01",
        end_date=request.end_date or default_end_date,
        stock_scope=request.stock_scope or "all_a_share",
        symbols=normalized_symbols(request.symbols),
        include_daily_kline=request.include_daily_kline,
        daily_batch_size=max(1, min(request.daily_batch_size, 200)),
        include_minute_kline=request.include_minute_kline,
        minute_batch_size=max(1, min(request.minute_batch_size, 100)),
        minute_window_days=max(1, min(request.minute_window_days, 7)),
        include_full_market_minute=request.include_full_market_minute,
        include_financial=request.include_financial,
        period=normalize_period(request.period),
        overwrite_existing=request.overwrite_existing,
        retry_failed=request.retry_failed,
    )
