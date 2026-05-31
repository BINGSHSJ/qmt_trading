from pydantic import BaseModel

from backend.schemas.system import RuntimeTaskRecord
from backend.schemas.trading import TradingOrderRecord, TradingSignalRecord, TradingTradeRecord


class AssetOverview(BaseModel):
    total_asset: float
    available_cash: float
    frozen_cash: float = 0
    market_value: float
    today_pnl: float
    position_count: int
    updated_at: str | None = None
    snapshot_time: str | None = None
    has_account: bool


class TodayTradeSummary(BaseModel):
    submitted_count: int
    filled_count: int
    cancelled_count: int
    failed_count: int
    trade_amount: float
    order_count: int
    trade_count: int


class DashboardSummary(BaseModel):
    asset: AssetOverview
    running_task_count: int
    failed_task_count: int
    historical_failed_task_count: int = 0
    today_signal_count: int
    today_order_count: int
    today_trade_amount: float
    qmt_mode: str = "unknown"
    qmt_connected: bool = False
    trading_mode: str = "未检测"


class DashboardBundle(BaseModel):
    summary: DashboardSummary
    tasks: list[RuntimeTaskRecord]
    today_signals: list[TradingSignalRecord]
    today_trades: TodayTradeSummary
    latest_orders: list[TradingOrderRecord]
    latest_trades: list[TradingTradeRecord]
