from fastapi import APIRouter

from backend.core.response import ApiResponse, success_response
from backend.schemas.system import RuntimeTaskRecord
from backend.services.system.system_service import SystemService

router = APIRouter(prefix="/tasks", tags=["tasks"])


@router.get("/{task_id}", response_model=ApiResponse[RuntimeTaskRecord])
async def get_task(task_id: str) -> ApiResponse[RuntimeTaskRecord]:
    return success_response(SystemService().get_task(task_id), "获取任务状态成功")


@router.post("/{task_id}/cancel", response_model=ApiResponse[RuntimeTaskRecord])
async def cancel_task(task_id: str) -> ApiResponse[RuntimeTaskRecord]:
    return success_response(SystemService().cancel_task(task_id), "取消任务成功")
