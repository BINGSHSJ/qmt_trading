from pydantic import BaseModel, Field


class StrategyFileCreate(BaseModel):
    file_name: str = Field(min_length=1)
    strategy_name: str = "新建策略"
    description: str = "请填写策略说明"


class StrategyImportRequest(BaseModel):
    file_name: str = Field(min_length=1)
    code_content: str = Field(min_length=1)


class StrategyStatusUpdate(BaseModel):
    status: str = Field(pattern="^(enabled|disabled)$")


class StrategyFileRecord(BaseModel):
    id: int
    file_name: str
    file_path: str
    strategy_name: str
    version: str
    description: str
    status: str
    last_modified_at: str | None = None
    last_run_at: str | None = None
    created_at: str
    today_signal_count: int = 0


class StrategyContent(BaseModel):
    strategy_id: int
    file_name: str
    code_content: str


class StrategyContentUpdate(BaseModel):
    code_content: str = Field(min_length=1)
    remark: str | None = None


class StrategyValidationResult(BaseModel):
    valid: bool
    message: str
    technical_detail: str | None = None
    strategy_name: str | None = None
    version: str | None = None
    description: str | None = None


class StrategyRunRecord(BaseModel):
    id: int
    run_id: str
    strategy_id: int
    strategy_name: str = ""
    strategy_file_name: str = ""
    strategy_version: str = ""
    strategy_code_hash: str = ""
    task_id: str
    status: str
    signal_count: int
    started_at: str | None = None
    finished_at: str | None = None
    message: str
    technical_detail: str | None = None


class StrategySignalRecord(BaseModel):
    id: int
    strategy_id: int
    run_id: str
    strategy_name: str
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


class SignalStatusUpdate(BaseModel):
    status: str = Field(pattern="^(未处理|已下单|已忽略|已过期)$")


class StrategyVersionRecord(BaseModel):
    id: int
    strategy_id: int
    version_no: str
    code_hash: str
    remark: str | None = None
    created_at: str


class StrategyVersionDetail(StrategyVersionRecord):
    code_content: str


class StrategyVersionCompare(BaseModel):
    left_version_id: int
    right_version_id: int
    left_content: str
    right_content: str
