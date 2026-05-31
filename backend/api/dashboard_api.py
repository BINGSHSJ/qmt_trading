from fastapi import APIRouter

from backend.core.response import ApiResponse, success_response
from backend.schemas.dashboard import DashboardBundle, DashboardSummary, TodayTradeSummary
from backend.schemas.system import RuntimeTaskRecord
from backend.schemas.trading import TradingSignalRecord
from backend.services.dashboard_service import DashboardService

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def service() -> DashboardService:
    return DashboardService()


@router.get("/summary", response_model=ApiResponse[DashboardSummary])
async def summary() -> ApiResponse[DashboardSummary]:
    return success_response(service().summary(), "获取看板摘要成功")


@router.get("/tasks", response_model=ApiResponse[list[RuntimeTaskRecord]])
async def tasks() -> ApiResponse[list[RuntimeTaskRecord]]:
    return success_response(service().tasks(), "获取任务状态成功")


@router.get("/today-signals", response_model=ApiResponse[list[TradingSignalRecord]])
async def today_signals() -> ApiResponse[list[TradingSignalRecord]]:
    return success_response(service().today_signals(), "获取今日信号成功")


@router.get("/today-trades", response_model=ApiResponse[TodayTradeSummary])
async def today_trades() -> ApiResponse[TodayTradeSummary]:
    return success_response(service().today_trades(), "获取今日交易成功")


@router.get("/bundle", response_model=ApiResponse[DashboardBundle])
async def bundle() -> ApiResponse[DashboardBundle]:
    return success_response(service().bundle(), "获取看板数据成功")
