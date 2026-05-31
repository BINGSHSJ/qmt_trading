from fastapi import APIRouter, BackgroundTasks, Depends, Query

from backend.core.response import ApiResponse, success_response
from backend.schemas.common import PageQuery, PageResult
from backend.schemas.strategy_dev import (
    SignalStatusUpdate,
    StrategyContent,
    StrategyContentUpdate,
    StrategyFileCreate,
    StrategyFileRecord,
    StrategyImportRequest,
    StrategyRunRecord,
    StrategySignalRecord,
    StrategyStatusUpdate,
    StrategyValidationResult,
    StrategyVersionCompare,
    StrategyVersionDetail,
    StrategyVersionRecord,
)
from backend.schemas.system import TaskCreated
from backend.services.strategy_dev.strategy_service import StrategyService

router = APIRouter(prefix="/strategies", tags=["strategy-dev"])


def service() -> StrategyService:
    return StrategyService()


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


@router.get("/files", response_model=ApiResponse[PageResult[StrategyFileRecord]])
async def list_files(query: PageQuery = Depends(page_query)) -> ApiResponse[PageResult[StrategyFileRecord]]:
    return success_response(service().list_files(query), "获取策略文件成功")


@router.post("/files", response_model=ApiResponse[StrategyFileRecord])
async def create_file(request: StrategyFileCreate) -> ApiResponse[StrategyFileRecord]:
    return success_response(service().create_file(request), "新建策略成功")


@router.post("/import", response_model=ApiResponse[StrategyFileRecord])
async def import_file(request: StrategyImportRequest) -> ApiResponse[StrategyFileRecord]:
    return success_response(service().import_file(request), "导入策略成功")


@router.post("/copy-example", response_model=ApiResponse[StrategyFileRecord])
async def copy_example() -> ApiResponse[StrategyFileRecord]:
    return success_response(service().copy_example(), "复制示例策略成功")


@router.delete("/files/{strategy_id}", response_model=ApiResponse[None])
async def delete_file(strategy_id: int) -> ApiResponse[None]:
    service().delete_file(strategy_id)
    return success_response(None, "删除策略成功")


@router.patch("/files/{strategy_id}/status", response_model=ApiResponse[StrategyFileRecord])
async def update_status(strategy_id: int, request: StrategyStatusUpdate) -> ApiResponse[StrategyFileRecord]:
    return success_response(service().update_status(strategy_id, request), "更新策略状态成功")


@router.get("/files/{strategy_id}/content", response_model=ApiResponse[StrategyContent])
async def get_content(strategy_id: int) -> ApiResponse[StrategyContent]:
    return success_response(service().get_content(strategy_id), "获取策略代码成功")


@router.put("/files/{strategy_id}/content", response_model=ApiResponse[StrategyContent])
async def save_content(strategy_id: int, request: StrategyContentUpdate) -> ApiResponse[StrategyContent]:
    return success_response(service().save_content(strategy_id, request), "保存策略代码成功")


@router.post("/files/{strategy_id}/validate", response_model=ApiResponse[StrategyValidationResult])
async def validate_strategy(strategy_id: int) -> ApiResponse[StrategyValidationResult]:
    return success_response(service().validate_strategy(strategy_id), "策略接口检查完成")


@router.post("/{strategy_id}/run", response_model=ApiResponse[TaskCreated])
async def run_strategy(strategy_id: int, background_tasks: BackgroundTasks) -> ApiResponse[TaskCreated]:
    strategy_service = service()
    task = strategy_service.create_run_task(strategy_id)
    background_tasks.add_task(strategy_service.run_strategy_task, strategy_id, task.task_id)
    return success_response(task, "策略运行任务已创建")


@router.post("/runs/{run_id}/stop", response_model=ApiResponse[StrategyRunRecord])
async def stop_run(run_id: str) -> ApiResponse[StrategyRunRecord]:
    return success_response(service().stop_run(run_id), "策略停止请求已提交")


@router.get("/runs", response_model=ApiResponse[PageResult[StrategyRunRecord]])
async def list_runs(query: PageQuery = Depends(page_query)) -> ApiResponse[PageResult[StrategyRunRecord]]:
    return success_response(service().list_runs(query), "获取运行记录成功")


@router.get("/runs/{run_id}", response_model=ApiResponse[StrategyRunRecord])
async def get_run(run_id: str) -> ApiResponse[StrategyRunRecord]:
    return success_response(service().get_run(run_id), "获取运行详情成功")


@router.get("/runs/{run_id}/logs", response_model=ApiResponse[list[str]])
async def run_logs(run_id: str) -> ApiResponse[list[str]]:
    return success_response(service().run_logs(run_id), "获取运行日志成功")


@router.get("/signals", response_model=ApiResponse[PageResult[StrategySignalRecord]])
async def list_signals(query: PageQuery = Depends(page_query)) -> ApiResponse[PageResult[StrategySignalRecord]]:
    return success_response(service().list_signals(query), "获取策略信号成功")


@router.get("/signals/{signal_id}", response_model=ApiResponse[StrategySignalRecord])
async def get_signal(signal_id: int) -> ApiResponse[StrategySignalRecord]:
    return success_response(service().get_signal(signal_id), "获取信号详情成功")


@router.patch("/signals/{signal_id}/ignore", response_model=ApiResponse[StrategySignalRecord])
async def ignore_signal(signal_id: int) -> ApiResponse[StrategySignalRecord]:
    return success_response(service().ignore_signal(signal_id), "忽略信号成功")


@router.patch("/signals/{signal_id}/status", response_model=ApiResponse[StrategySignalRecord])
async def update_signal_status(signal_id: int, request: SignalStatusUpdate) -> ApiResponse[StrategySignalRecord]:
    return success_response(service().update_signal_status(signal_id, request), "更新信号状态成功")


@router.get("/{strategy_id}/versions", response_model=ApiResponse[PageResult[StrategyVersionRecord]])
async def list_versions(strategy_id: int, query: PageQuery = Depends(page_query)) -> ApiResponse[PageResult[StrategyVersionRecord]]:
    return success_response(service().list_versions(strategy_id, query), "获取版本记录成功")


@router.get("/versions/compare", response_model=ApiResponse[StrategyVersionCompare])
async def compare_versions(
    left_version_id: int = Query(),
    right_version_id: int = Query(),
) -> ApiResponse[StrategyVersionCompare]:
    return success_response(service().compare_versions(left_version_id, right_version_id), "版本对比成功")


@router.get("/versions/{version_id}", response_model=ApiResponse[StrategyVersionDetail])
async def get_version(version_id: int) -> ApiResponse[StrategyVersionDetail]:
    return success_response(service().get_version(version_id), "获取版本详情成功")


@router.post("/versions/{version_id}/restore", response_model=ApiResponse[StrategyContent])
async def restore_version(version_id: int) -> ApiResponse[StrategyContent]:
    return success_response(service().restore_version(version_id), "恢复版本成功")
