from pydantic import BaseModel, Field, computed_field, field_validator


class DataSourceRecord(BaseModel):
    id: int
    source_code: str
    source_name: str
    status: str
    config_json: str
    last_connected_at: str | None = None
    created_at: str
    updated_at: str


class QmtStatus(BaseModel):
    source_code: str = "qmt"
    source_name: str = "QMT"
    mode: str
    connected: bool
    account_id: str
    qmt_path: str
    xtquant_installed: bool
    last_connected_at: str | None = None
    message: str


class AccountSnapshot(BaseModel):
    id: int
    account_id: str
    total_asset: float
    available_cash: float
    frozen_cash: float
    market_value: float
    today_pnl: float
    snapshot_time: str


class PositionSnapshot(BaseModel):
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


class OrderRecord(BaseModel):
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
    order_time: str
    updated_at: str

    @field_validator("status", mode="before")
    @classmethod
    def normalize_status(cls, value: object) -> str:
        status = str(value or "").strip()
        return "待同步" if status in {"", "未知", "unknown", "None"} else status


class TradeRecord(BaseModel):
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
    trade_time: str


class StockBasic(BaseModel):
    id: int
    symbol: str
    name: str
    market: str
    security_type: str
    list_status: str
    is_st: bool
    updated_at: str


class InstrumentDetail(BaseModel):
    id: int
    symbol: str
    exchange_id: str
    instrument_id: str
    instrument_name: str
    exchange_code: str
    open_date: str | None = None
    expire_date: str | None = None
    pre_close: float
    up_stop_price: float
    down_stop_price: float
    is_trading: bool
    instrument_status: str
    total_volume: float
    float_volume: float
    trading_day: str | None = None
    raw_json: str
    sync_time: str


class TradingCalendarRecord(BaseModel):
    id: int
    market: str
    trade_date: str
    is_trading_day: bool
    source: str
    sync_time: str


class DailyKline(BaseModel):
    id: int
    symbol: str
    trade_date: str
    open: float
    high: float
    low: float
    close: float
    pre_close: float = 0
    volume: float
    amount: float
    suspend_flag: int = 0
    created_at: str


class MinuteKline(BaseModel):
    id: int
    symbol: str
    datetime: str
    period: str
    open: float
    high: float
    low: float
    close: float
    pre_close: float = 0
    volume: float
    amount: float
    suspend_flag: int = 0
    created_at: str


class LatestQuote(BaseModel):
    symbol: str
    name: str
    last_price: float
    updated_at: str


class SyncRequest(BaseModel):
    symbols: list[str] = Field(default_factory=list)
    start_date: str | None = None
    end_date: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    period: str = "1m"


class OfficialDataCatalogItem(BaseModel):
    data_type: str
    name: str
    category: str
    source_module: str
    official_interface: str
    local_table: str
    enabled: bool
    required_for_backtest: bool = False
    priority: str
    account_boundary: str
    sync_frequency: str
    notes: str


class OfficialDataCatalog(BaseModel):
    source: str = "qmt"
    account_type: str = "stock_normal"
    account_type_label: str = "普通股票账户"
    has_l2: bool = False
    has_credit: bool = False
    limitation_note: str
    items: list[OfficialDataCatalogItem]
    unsupported_items: list[str]


class Prepare2026Request(BaseModel):
    start_date: str = "2026-01-01"
    end_date: str | None = None
    stock_scope: str = "all_a_share"
    symbols: list[str] = Field(default_factory=list)
    include_daily_kline: bool = True
    daily_batch_size: int = Field(default=200, ge=1, le=200)
    include_minute_kline: bool = False
    minute_batch_size: int = Field(default=50, ge=1, le=100)
    minute_window_days: int = Field(default=5, ge=1, le=7)
    include_full_market_minute: bool = False
    include_financial: bool = False
    period: str = "1m"
    overwrite_existing: bool = False
    retry_failed: bool = True


class LatestDataSyncRequest(BaseModel):
    start_date: str = "2026-01-01"
    end_date: str | None = None
    include_account: bool = True
    include_positions: bool = True
    include_orders: bool = True
    include_trades: bool = True
    include_daily_kline: bool = True
    daily_batch_size: int = Field(default=200, ge=1, le=200)
    include_minute_kline: bool = False
    include_full_market_minute: bool = False
    minute_batch_size: int = Field(default=50, ge=1, le=100)
    minute_window_days: int = Field(default=5, ge=1, le=7)
    period: str = "1m"
    symbols: list[str] = Field(default_factory=list)
    overwrite_existing: bool = False


class Prepare2026Step(BaseModel):
    step_no: int
    data_type: str
    name: str
    scope: str
    required: bool
    long_task: bool
    default_enabled: bool
    warning: str | None = None


class Prepare2026Plan(BaseModel):
    start_date: str
    end_date: str
    stock_scope: str
    period: str
    steps: list[Prepare2026Step]
    warnings: list[str]
    test_isolation: bool = Field(description="是否为测试隔离计划；业务页面应优先读取该字段。")
    mock_safe: bool = Field(description="兼容旧客户端的过渡字段；新代码必须读取 test_isolation。")


class DataCoverageRecord(BaseModel):
    id: int
    data_type: str
    symbol: str
    period: str
    start_date: str
    end_date: str
    expected_trading_days: int
    actual_trading_days: int
    expected_rows: int | None = None
    actual_rows: int
    missing_days: str
    duplicate_rows: int
    coverage_rate: float
    status: str
    checked_at: str

    @computed_field
    @property
    def coverage_unit(self) -> str:
        return "覆盖单元" if self.data_type == "minute_kline" else "行"

    @computed_field
    @property
    def coverage_unit_note(self) -> str:
        if self.data_type == "minute_kline":
            return "分钟K覆盖单元=股票-交易日，用来判断是否每只股票每天都有分钟数据，不等于1分钟bar原始行数。"
        if self.data_type == "daily_kline":
            return "日K按实际落库K线行数统计。"
        return "按本地 SQLite 表记录数或覆盖检查单位统计。"

    @computed_field
    @property
    def expected_coverage_units(self) -> int | None:
        return self.expected_rows

    @computed_field
    @property
    def actual_coverage_units(self) -> int:
        return self.actual_rows


class SyncTaskSummary(BaseModel):
    task_id: str
    sync_type: str
    status: str
    total_count: int
    success_count: int
    failed_count: int
    progress: int = 0
    message: str = ""
    technical_detail: str | None = None
    started_at: str | None = None
    finished_at: str | None = None


class SyncLogRecord(BaseModel):
    id: int
    task_id: str
    sync_type: str
    level: str
    message: str
    technical_detail: str | None = None
    created_at: str


class DataQualityRecord(BaseModel):
    id: int
    check_type: str
    target_table: str
    status: str
    message: str
    suggestion: str | None = None
    created_at: str


class DataQualitySummary(BaseModel):
    success_count: int
    warning_count: int
    failed_count: int
    latest_check_time: str | None = None
    is_stale: bool = False
    stale_reason: str | None = None


class DataFreshnessItem(BaseModel):
    key: str
    name: str
    table_name: str
    latest_time: str | None = None
    latest_date: str | None = None
    target_date: str | None = None
    lag_days: int | None = None
    status: str
    message: str
    suggestion: str
    coverage_status: str | None = None
    coverage_rate: float | None = None
    coverage_checked_at: str | None = None
    actual_rows: int | None = None
    coverage_unit: str | None = None
    coverage_unit_note: str | None = None
    actual_coverage_units: int | None = None
    technical_detail: str | None = None


class DataFreshnessSummary(BaseModel):
    target_trade_date: str
    generated_at: str
    overall_status: str
    stale_count: int
    warning_count: int
    items: list[DataFreshnessItem]
    next_actions: list[str]


class AccountSnapshotDuplicateRecord(BaseModel):
    account_id: str
    snapshot_time: str
    duplicate_count: int
    min_id: int
    max_id: int
    min_total_asset: float
    max_total_asset: float
    min_available_cash: float
    max_available_cash: float


class LegacyCursorCleanupResult(BaseModel):
    cleaned_count: int
    archived_count: int
    message: str
    technical_detail: str | None = None


class DataDictionaryRecord(BaseModel):
    id: int
    table_name: str
    field_name: str
    field_type: str
    description: str
    example_value: str | None = None
    unit: str | None = None
    strategy_usage: str | None = None
    is_indexed: bool
