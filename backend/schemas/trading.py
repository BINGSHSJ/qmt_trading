from pydantic import BaseModel, Field, field_validator

from backend.schemas.common import PageResult


class ManualOrderRequest(BaseModel):
    symbol: str = Field(min_length=1)
    name: str | None = None
    side: str
    price: float = Field(gt=0)
    quantity: int = Field(gt=0)
    order_type: str = "限价委托"


class SignalOrderRequest(BaseModel):
    price: float | None = Field(default=None, gt=0)
    quantity: int | None = Field(default=None, gt=0)


class TradingPosition(BaseModel):
    id: int
    account_id: str
    symbol: str
    name: str
    quantity: int
    available_quantity: int
    cost_price: float
    last_price: float
    market_value: float
    pnl: float
    pnl_ratio: float
    snapshot_time: str


class TradingOrderRecord(BaseModel):
    id: int
    local_order_id: str
    qmt_order_id: str | None = None
    account_id: str
    symbol: str
    name: str
    side: str
    price: float
    quantity: int
    filled_quantity: int
    status: str
    qmt_status: str | None = None
    source: str
    strategy_id: str | None = None
    strategy_name: str | None = None
    signal_id: str | None = None
    idempotency_key: str | None = None
    order_time: str
    updated_at: str

    @field_validator("status", mode="before")
    @classmethod
    def normalize_status(cls, value: object) -> str:
        status = str(value or "").strip()
        return "待同步" if status in {"", "未知", "unknown", "None"} else status


class TradingTradeRecord(BaseModel):
    id: int
    trade_id: str
    local_order_id: str | None = None
    qmt_order_id: str | None = None
    account_id: str
    symbol: str
    name: str
    side: str
    price: float
    quantity: int
    amount: float
    fee: float
    source: str
    strategy_name: str | None = None
    trade_time: str


class TradingSignalRecord(BaseModel):
    id: int
    strategy_id: int
    strategy_name: str
    run_id: str
    symbol: str
    name: str
    action: str
    price: float
    amount: float | None = None
    reason: str
    status: str
    signal_time: str
    order_id: str | None = None
    created_at: str


class ExecutionLogRecord(BaseModel):
    id: int
    local_order_id: str | None = None
    level: str
    message: str
    technical_detail: str | None = None
    created_at: str


class OrderSubmitResult(BaseModel):
    order: TradingOrderRecord
    message: str
    duplicate: bool = False


TradingOrderPage = PageResult[TradingOrderRecord]
TradingTradePage = PageResult[TradingTradeRecord]
TradingPositionPage = PageResult[TradingPosition]
TradingSignalPage = PageResult[TradingSignalRecord]
ExecutionLogPage = PageResult[ExecutionLogRecord]
