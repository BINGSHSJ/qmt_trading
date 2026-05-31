from fastapi import APIRouter

from backend.core.response import ApiResponse, success_response
from backend.schemas.health import HealthStatus
from backend.services.health_service import HealthService

router = APIRouter(tags=["health"])


@router.get("/health", response_model=ApiResponse[HealthStatus])
async def health_check() -> ApiResponse[HealthStatus]:
    service = HealthService()
    return success_response(data=service.get_status(), message="健康检查正常")
