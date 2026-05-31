from pydantic import BaseModel, Field


class SystemConfig(BaseModel):
    qmt_path: str = ""
    account_id: str = ""
    database_path: str = ""
    strategy_dir: str = ""
    backup_dir: str = ""
    auto_connect: bool = False
    auto_sync: bool = False
    default_order_amount: float = 10000
    max_order_amount: float = 50000
    order_confirm_required: bool = True
    default_order_type: str = "限价委托"
    price_offset: float = 0
    simulation_mode: bool = False
    strategy_timeout_seconds: int = 30
    strategy_run_interval_seconds: int = 60
    intraday_auto_run: bool = False
    strategy_log_level: str = "info"
    strategy_max_log_mb: int = 20
    log_retention_days: int = 30
    task_retention_days: int = 30


class PathTestRequest(BaseModel):
    path: str = Field(min_length=1)
    expect_directory: bool = True


class PathTestResult(BaseModel):
    path: str
    exists: bool
    is_directory: bool
    message: str
    suggestion: str | None = None


class TaskCreated(BaseModel):
    task_id: str
    task_type: str
    status: str
    progress: int
    message: str
    source_module: str | None = None
    source_route: str | None = None
    source_label: str | None = None


class RuntimeTaskRecord(BaseModel):
    task_id: str
    task_type: str
    status: str
    progress: int
    message: str
    technical_detail: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    created_at: str
    source_module: str | None = None
    source_route: str | None = None
    source_label: str | None = None


class EnvironmentCheckResult(BaseModel):
    id: int
    task_id: str
    check_item: str
    status: str
    message: str
    suggestion: str | None = None
    technical_detail: str | None = None
    created_at: str


class SystemLogRecord(BaseModel):
    id: int
    module: str
    level: str
    message: str
    technical_detail: str | None = None
    related_id: str | None = None
    created_at: str


class BackupRecord(BaseModel):
    id: int
    backup_name: str
    backup_path: str
    backup_size: int
    status: str
    created_at: str


class MaintenanceCleanupResult(BaseModel):
    archive_path: str | None = None
    system_log_deleted: int = 0
    operation_log_deleted: int = 0
    sync_log_deleted: int = 0
    execution_log_deleted: int = 0
    runtime_task_deleted: int = 0
    development_log_archive_path: str | None = None
    development_log_files_archived: int = 0


class StartupCheckItem(BaseModel):
    check_item: str
    status: str
    message: str
    suggestion: str | None = None
    technical_detail: str | None = None


class StartupCheckResult(BaseModel):
    app_name: str
    version: str
    checked_at: str
    overall_status: str
    items: list[StartupCheckItem]


class OperationLogRecord(BaseModel):
    id: int
    module: str
    action: str
    target_type: str
    target_id: str | None = None
    result: str
    message: str
    technical_detail: str | None = None
    created_at: str


class SystemMonitor(BaseModel):
    running_task_count: int
    failed_task_count: int
    historical_failed_task_count: int = 0
    database_size_bytes: int
    log_size_bytes: int
    backup_count: int
    recent_errors: list[SystemLogRecord]
    slow_tasks: list[RuntimeTaskRecord]
