"""
风控路由 — /api/v1/risk

GET    /risk/rules              当前风控规则
GET    /risk/events             风控事件列表
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import verify_api_key, get_request_id
from app.core.config import yaml_get
from app.core.response import ApiResponse
from app.db.database import get_db
from app.services.risk_service import RiskService

router = APIRouter(prefix="/api/v1/risk", tags=["risk"], dependencies=[Depends(verify_api_key)])


@router.get("/rules")
async def get_risk_rules(
    request_id: str = Depends(get_request_id),
):
    """返回当前生效的风控规则参数"""
    rules = {
        "max_single_order_value": yaml_get("risk", "max_single_order_value") or 100000,
        "max_daily_order_count": yaml_get("risk", "max_daily_order_count") or 50,
        "max_daily_loss_pct": yaml_get("risk", "max_daily_loss_pct") or 5.0,
    }
    return ApiResponse.success(data=rules, request_id=request_id)


@router.get("/events")
async def list_risk_events(
    strategy_id: Optional[str] = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    request_id: str = Depends(get_request_id),
    db: AsyncSession = Depends(get_db),
):
    svc = RiskService(db)
    data = await svc.list_events(strategy_id=strategy_id, offset=offset, limit=limit)
    return ApiResponse.success(data=data, request_id=request_id)
