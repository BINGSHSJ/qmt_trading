"""
交易路由 — /api/v1/trading

POST   /trading/signals            提交信号（主链路入口）
GET    /trading/signals             信号列表
GET    /trading/orders              委托列表
GET    /trading/fills               成交列表
GET    /trading/positions           持仓查询
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import verify_api_key, get_request_id
from app.core.enums import SignalType
from app.core.response import ApiResponse
from app.db.database import get_db
from app.adapters.factory import get_xtdata_adapter
from app.services.trading_service import TradingService

router = APIRouter(prefix="/api/v1/trading", tags=["trading"], dependencies=[Depends(verify_api_key)])


# ── 请求体模型 ────────────────────────────────────────

class SubmitSignalRequest(BaseModel):
    signal_id: str = Field(..., min_length=1, max_length=64, description="信号唯一 ID（幂等键）")
    strategy_id: str = Field(..., min_length=1, max_length=64)
    symbol: str = Field(..., min_length=1, max_length=32, description="证券代码，如 000001.SZ")
    signal_type: SignalType = Field(..., description="BUY / SELL / ADD / REDUCE / HOLD / CANCEL")
    signal_price: float = Field(..., gt=0)
    target_volume: Optional[int] = Field(None, gt=0, description="目标数量（股），与 target_value 至少填一个")
    target_value: float = Field(0.0, ge=0, description="目标金额，与 target_volume 至少填一个")
    confidence: float = Field(0.0, ge=0, le=1)
    reason: str = Field("", max_length=1024, description="信号触发原因")

    @model_validator(mode="after")
    def _require_volume_or_value(self):
        if not self.target_volume and self.target_value <= 0:
            raise ValueError("target_volume 和 target_value 至少提供一个（且 > 0）")
        return self


# ── 路由 ──────────────────────────────────────────────

@router.post("/signals")
async def submit_signal(
    body: SubmitSignalRequest,
    request_id: str = Depends(get_request_id),
    db: AsyncSession = Depends(get_db),
):
    svc = TradingService(db)
    data = await svc.submit_signal(
        signal_id=body.signal_id,
        strategy_id=body.strategy_id,
        symbol=body.symbol,
        signal_type=body.signal_type.value,
        signal_price=body.signal_price,
        target_volume=body.target_volume,
        target_value=body.target_value,
        confidence=body.confidence,
        reason=body.reason,
    )
    return ApiResponse.success(data=data, request_id=request_id)


@router.get("/signals")
async def list_signals(
    strategy_id: Optional[str] = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    request_id: str = Depends(get_request_id),
    db: AsyncSession = Depends(get_db),
):
    svc = TradingService(db)
    data = await svc.list_signals(strategy_id=strategy_id, offset=offset, limit=limit)
    return ApiResponse.success(data=data, request_id=request_id)


@router.get("/orders")
async def list_orders(
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    request_id: str = Depends(get_request_id),
    db: AsyncSession = Depends(get_db),
):
    svc = TradingService(db)
    data = await svc.list_orders(offset=offset, limit=limit)
    return ApiResponse.success(data=data, request_id=request_id)


@router.get("/fills")
async def list_fills(
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    request_id: str = Depends(get_request_id),
    db: AsyncSession = Depends(get_db),
):
    svc = TradingService(db)
    data = await svc.list_fills(offset=offset, limit=limit)
    return ApiResponse.success(data=data, request_id=request_id)


@router.get("/positions")
async def list_positions(
    request_id: str = Depends(get_request_id),
    db: AsyncSession = Depends(get_db),
):
    svc = TradingService(db)
    data = await svc.list_positions()
    return ApiResponse.success(data=data, request_id=request_id)


@router.get("/market-snapshot")
async def get_market_snapshot(
    symbol: str = Query(..., min_length=1, max_length=32, description="标的代码"),
    request_id: str = Depends(get_request_id),
):
    """获取单只标的最新行情快照（行情适配器调用）"""
    adapter = get_xtdata_adapter()
    data = await adapter.get_market_snapshot(symbol)
    return ApiResponse.success(data=data, request_id=request_id)
