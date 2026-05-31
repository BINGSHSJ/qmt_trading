from fastapi import APIRouter, BackgroundTasks, Depends, Query
from fastapi.responses import FileResponse

from backend.core.response import ApiResponse, success_response
from backend.schemas.common import PageQuery, PageResult
from backend.schemas.system import (
    BackupRecord,
    EnvironmentCheckResult,
    OperationLogRecord,
    PathTestRequest,
    PathTestResult,
    RuntimeTaskRecord,
    StartupCheckResult,
    SystemConfig,
    SystemLogRecord,
    SystemMonitor,
    TaskCreated,
)
from backend.services.system.system_service import SystemService

router = APIRouter(prefix="/system", tags=["system"])


def service() -> SystemService:
    return SystemService()


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


@router.get("/config", response_model=ApiResponse[SystemConfig])
async def get_config() -> ApiResponse[SystemConfig]:
    return success_response(service().ensure_defaults(), "获取系统配置成功")


@router.put("/config", response_model=ApiResponse[SystemConfig])
async def save_config(config: SystemConfig) -> ApiResponse[SystemConfig]:
    return success_response(service().save_config(config), "保存系统配置成功")


@router.post("/config/test-path", response_model=ApiResponse[PathTestResult])
async def test_path(request: PathTestRequest) -> ApiResponse[PathTestResult]:
    return success_response(service().test_path(request), "路径检测完成")


@router.post("/env/check", response_model=ApiResponse[TaskCreated])
async def create_env_check(background_tasks: BackgroundTasks) -> ApiResponse[TaskCreated]:
    system_service = service()
    task = system_service.create_environment_check_task()
    background_tasks.add_task(system_service.run_environment_check, task.task_id)
    return success_response(task, "环境检测任务已创建")


@router.get("/env/results", response_model=ApiResponse[list[EnvironmentCheckResult]])
async def get_env_results(task_id: str | None = None) -> ApiResponse[list[EnvironmentCheckResult]]:
    return success_response(service().list_environment_results(task_id), "获取环境检测结果成功")


@router.get("/logs", response_model=ApiResponse[PageResult[SystemLogRecord]])
async def get_logs(
    query: PageQuery = Depends(page_query),
    module: str | None = None,
    level: str | None = None,
) -> ApiResponse[PageResult[SystemLogRecord]]:
    return success_response(service().list_logs(query, module=module, level=level), "获取日志成功")


@router.get("/monitor", response_model=ApiResponse[SystemMonitor])
async def get_monitor() -> ApiResponse[SystemMonitor]:
    return success_response(service().get_monitor(), "获取运行监控成功")


@router.get("/startup-check", response_model=ApiResponse[StartupCheckResult])
async def get_startup_check() -> ApiResponse[StartupCheckResult]:
    return success_response(service().get_startup_check(), "启动健康检查完成")


@router.post("/backups", response_model=ApiResponse[TaskCreated])
async def create_backup(background_tasks: BackgroundTasks) -> ApiResponse[TaskCreated]:
    system_service = service()
    task = system_service.create_backup_task()
    background_tasks.add_task(system_service.run_backup_task, task.task_id)
    return success_response(task, "备份任务已创建")


@router.get("/backups", response_model=ApiResponse[PageResult[BackupRecord]])
async def list_backups(query: PageQuery = Depends(page_query)) -> ApiResponse[PageResult[BackupRecord]]:
    return success_response(service().list_backups(query), "获取备份记录成功")


@router.post("/backups/{backup_id}/restore", response_model=ApiResponse[TaskCreated])
async def restore_backup(backup_id: int, background_tasks: BackgroundTasks) -> ApiResponse[TaskCreated]:
    system_service = service()
    task = system_service.restore_backup(backup_id)
    background_tasks.add_task(system_service.run_backup_restore_task, task.task_id, backup_id)
    return success_response(task, "备份恢复任务已创建")


@router.delete("/backups/{backup_id}", response_model=ApiResponse[None])
async def delete_backup(backup_id: int) -> ApiResponse[None]:
    service().delete_backup(backup_id)
    return success_response(None, "删除备份成功")


@router.get("/operations", response_model=ApiResponse[PageResult[OperationLogRecord]])
async def get_operations(
    query: PageQuery = Depends(page_query),
) -> ApiResponse[PageResult[OperationLogRecord]]:
    return success_response(
        service().list_operations(query),
        "获取操作记录成功",
    )


@router.get("/logs/export")
async def export_logs() -> FileResponse:
    path = service().export_logs_archive()
    return FileResponse(path, media_type="application/zip", filename=path.name)


@router.get("/config/export")
async def export_config() -> FileResponse:
    path = service().export_config_file()
    return FileResponse(path, media_type="application/json", filename=path.name)


@router.post("/maintenance/cleanup", response_model=ApiResponse[TaskCreated])
async def cleanup_maintenance(background_tasks: BackgroundTasks) -> ApiResponse[TaskCreated]:
    system_service = service()
    task = system_service.create_cleanup_task()
    background_tasks.add_task(system_service.run_cleanup_task, task.task_id)
    return success_response(task, "清理归档任务已创建")
