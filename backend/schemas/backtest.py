from pydantic import BaseModel, Field


class BacktestCreateRequest(BaseModel):
    strategy_id: int
    backtest_name: str = Field(min_length=1)
    start_date: str
    end_date: str
    initial_cash: float = Field(default=1_000_000, gt=0)
    single_order_amount: float = Field(default=100_000, gt=0)
    data_frequency: str = "日K"
    fill_mode: str = "下一日开盘"
    fee_rate: float = Field(default=0.0003, ge=0)
    stamp_tax_rate: float = Field(default=0.001, ge=0)
    slippage: float = Field(default=0.0, ge=0)


class BacktestDataCheckRequest(BaseModel):
    strategy_id: int
    start_date: str
    end_date: str
    data_frequency: str = "日K"
    fill_mode: str | None = None


class BacktestValidationStep(BaseModel):
    title: str
    status: str
    message: str
    technical_detail: str | None = None


class BacktestDataCheckResult(BaseModel):
    ok: bool
    message: str
    suggestion: str | None = None
    technical_detail: str | None = None
    steps: list[BacktestValidationStep] = Field(default_factory=list)


class BacktestTaskRecord(BaseModel):
    id: int
    task_id: str
    backtest_name: str
    strategy_id: int
    strategy_name: str
    start_date: str
    end_date: str
    initial_cash: float
    single_order_amount: float
    data_frequency: str
    fill_mode: str
    fee_rate: float
    stamp_tax_rate: float
    slippage: float
    status: str
    created_at: str


class BacktestResultRecord(BaseModel):
    id: int
    backtest_id: int
    total_return: float
    annual_return: float
    max_drawdown: float
    win_rate: float
    trade_count: int
    buy_count: int = 0
    sell_count: int = 0
    profit_loss_ratio: float
    average_holding_days: float
    ending_cash: float = 0
    open_position_count: int = 0
    open_market_value: float = 0
    total_fee: float = 0
    realized_pnl: float = 0
    final_cash: float
    created_at: str


class BacktestManifestRecord(BaseModel):
    id: int
    backtest_id: int
    strategy_file_name: str
    strategy_code_hash: str
    strategy_name: str
    strategy_version: str
    data_frequency: str
    fill_mode: str
    qmt_mode: str
    qmt_path: str
    account_id: str
    data_coverage_snapshot: str
    universe_summary: str
    rule_snapshot: str
    engine_version: str
    trust_level: str
    trust_message: str
    created_at: str


class BacktestStrategySnapshotCheck(BaseModel):
    status: str
    message: str
    manifest_hash: str = ""
    latest_code_hash: str | None = None
    matched_run_id: str | None = None
    matched_task_id: str | None = None
    matched_run_status: str | None = None
    matched_started_at: str | None = None
    matched_finished_at: str | None = None
    latest_run_id: str | None = None
    latest_task_id: str | None = None
    latest_run_status: str | None = None
    latest_started_at: str | None = None
    latest_finished_at: str | None = None
    latest_strategy_file_name: str | None = None
    latest_strategy_version: str | None = None
    technical_detail: str | None = None


class BacktestTradeRecord(BaseModel):
    id: int
    backtest_id: int
    symbol: str
    name: str
    side: str
    price: float
    quantity: int
    amount: float
    fee: float
    trade_time: str
    reason: str
    pnl: float


class BacktestSignalRecord(BaseModel):
    id: int
    backtest_id: int
    signal_time: str
    symbol: str
    name: str
    action: str
    price: float
    amount: float | None = None
    reason: str
    status: str
    execution_time: str | None = None
    execution_price: float | None = None
    quantity: int = 0
    skip_reason: str | None = None
    is_auto_exit: int = 0
    created_at: str


class BacktestEquityRecord(BaseModel):
    id: int
    backtest_id: int
    trade_date: str
    equity: float
    cash: float
    market_value: float
    drawdown: float


class BacktestLogRecord(BaseModel):
    id: int
    backtest_id: int
    level: str
    message: str
    technical_detail: str | None = None
    created_at: str


class BacktestReport(BaseModel):
    task: BacktestTaskRecord
    result: BacktestResultRecord | None = None
    manifest: BacktestManifestRecord | None = None
    strategy_snapshot_check: BacktestStrategySnapshotCheck | None = None
    trades: list[BacktestTradeRecord]
    signals: list[BacktestSignalRecord] = []
    equity: list[BacktestEquityRecord]
    logs: list[BacktestLogRecord]
