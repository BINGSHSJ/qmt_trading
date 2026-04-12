"""
策略路由 — /api/v1/strategies

GET    /strategies                     策略列表
POST   /strategies                     注册策略
GET    /strategies/{strategy_id}       策略详情
POST   /strategies/{strategy_id}/start 启动策略
POST   /strategies/{strategy_id}/stop  停止策略
POST   /strategies/scan-heartbeats     心跳扫描（内部调试用）
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_env_settings
from app.core.dependencies import verify_api_key, get_request_id
from app.core.exceptions import StrategyStartError
from app.core.response import ApiResponse
from app.db.database import get_db
from app.services.strategy_service import StrategyService

router = APIRouter(prefix="/api/v1", tags=["strategies"], dependencies=[Depends(verify_api_key)])


# ── 请求体模型 ────────────────────────────────────────

class RegisterStrategyRequest(BaseModel):
    strategy_id: str = Field(..., min_length=1, max_length=64, description="策略唯一 ID")
    name: str = Field(..., min_length=1, max_length=128, description="策略名称")
    description: str = Field("", max_length=1024)
    source_type: str = Field("strategy", description="manual / strategy / mixed / unattributed")
    config_json: str = Field("{}", description="策略配置 JSON 字符串")
    start_script: str = Field("", max_length=512, description="启动脚本路径")
    stop_script: str = Field("", max_length=512, description="停止脚本路径")
    working_dir: str = Field("", max_length=512, description="工作目录")
    env_overrides: dict = Field(default_factory=dict, description="环境变量覆盖 {key: value}")


# ── 路由 ──────────────────────────────────────────────

@router.get("/strategies")
async def list_strategies(
    offset: int = 0,
    limit: int = 100,
    request_id: str = Depends(get_request_id),
    db: AsyncSession = Depends(get_db),
):
    svc = StrategyService(db)
    data = await svc.list_strategies(offset=offset, limit=limit)
    return ApiResponse.success(data=data, request_id=request_id)


@router.post("/strategies")
async def register_strategy(
    body: RegisterStrategyRequest,
    request_id: str = Depends(get_request_id),
    db: AsyncSession = Depends(get_db),
):
    svc = StrategyService(db)
    data = await svc.register(
        strategy_id=body.strategy_id,
        name=body.name,
        description=body.description,
        source_type=body.source_type,
        config_json=body.config_json,
        start_script=body.start_script,
        stop_script=body.stop_script,
        working_dir=body.working_dir,
        env_overrides=body.env_overrides,
    )
    return ApiResponse.success(data=data, message="策略注册成功", request_id=request_id)


@router.get("/strategies/{strategy_id}")
async def get_strategy(
    strategy_id: str,
    request_id: str = Depends(get_request_id),
    db: AsyncSession = Depends(get_db),
):
    svc = StrategyService(db)
    data = await svc.get_detail(strategy_id)
    return ApiResponse.success(data=data, request_id=request_id)


@router.post("/strategies/{strategy_id}/start")
async def start_strategy(
    strategy_id: str,
    request: Request,
    request_id: str = Depends(get_request_id),
    db: AsyncSession = Depends(get_db),
):
    # 非 mock 模式下，检查 preflight critical 项
    settings = get_env_settings()
    if not settings.mock_mode:
        from app.core.preflight import get_critical_failures
        preflight_data = getattr(request.app.state, "preflight_results", [])
        critical_failures = get_critical_failures(preflight_data)
        if critical_failures:
            names = ", ".join(critical_failures)
            raise StrategyStartError(f"预检关键项未通过，禁止启动: {names}")

    svc = StrategyService(db)
    data = await svc.start(strategy_id)
    return ApiResponse.success(data=data, message="策略启动成功", request_id=request_id)


@router.post("/strategies/{strategy_id}/stop")
async def stop_strategy(
    strategy_id: str,
    request_id: str = Depends(get_request_id),
    db: AsyncSession = Depends(get_db),
):
    svc = StrategyService(db)
    data = await svc.stop(strategy_id)
    return ApiResponse.success(data=data, message="策略停止成功", request_id=request_id)


@router.post("/strategies/scan-heartbeats")
async def scan_heartbeats(
    request_id: str = Depends(get_request_id),
    db: AsyncSession = Depends(get_db),
):
    svc = StrategyService(db)
    changed = await svc.scan_heartbeats()
    return ApiResponse.success(
        data={"changed": changed, "count": len(changed)},
        request_id=request_id,
    )


@router.post("/strategies/pause-all")
async def pause_all_strategies(
    request_id: str = Depends(get_request_id),
    db: AsyncSession = Depends(get_db),
):
    """一键暂停全部运行中的策略"""
    svc = StrategyService(db)
    stopped = await svc.pause_all(operator="api")
    return ApiResponse.success(
        data={"stopped": stopped, "count": len(stopped)},
        message=f"已停止 {len(stopped)} 个策略",
        request_id=request_id,
    )
