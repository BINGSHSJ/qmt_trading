"""
日志路由 — /api/v1/logs

GET    /logs              系统日志列表
POST   /logs              写入系统日志（内部调试用）
"""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import verify_api_key, get_request_id
from app.core.response import ApiResponse
from app.db.database import get_db
from app.models.tables import SystemLog
from app.repositories.log_repo import SystemLogRepository

router = APIRouter(prefix="/api/v1", tags=["logs"], dependencies=[Depends(verify_api_key)])


class WriteLogRequest(BaseModel):
    module: str = Field("system", max_length=64)
    level: str = Field("INFO", max_length=16)
    message: str = Field(..., max_length=4096)
    detail: str = Field("", max_length=65536)


@router.get("/logs")
async def list_logs(
    module: Optional[str] = Query(None),
    level: Optional[str] = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    request_id: str = Depends(get_request_id),
    db: AsyncSession = Depends(get_db),
):
    repo = SystemLogRepository(db)
    if module:
        records = await repo.list_by_module(module, offset, limit)
    elif level:
        records = await repo.list_by_level(level, offset, limit)
    else:
        records = await repo.list_all(offset=offset, limit=limit)
    data = [_log_to_dict(r) for r in records]
    return ApiResponse.success(data=data, request_id=request_id)


@router.post("/logs")
async def write_log(
    body: WriteLogRequest,
    request_id: str = Depends(get_request_id),
    db: AsyncSession = Depends(get_db),
):
    repo = SystemLogRepository(db)
    entry = SystemLog(
        module=body.module,
        level=body.level,
        message=body.message,
        detail=body.detail,
        request_id=request_id,
    )
    await repo.insert(entry)
    await db.commit()
    return ApiResponse.success(data=_log_to_dict(entry), message="日志已写入", request_id=request_id)


def _log_to_dict(r: SystemLog) -> dict[str, Any]:
    return {
        "id": r.id,
        "module": r.module,
        "level": r.level,
        "message": r.message,
        "detail": r.detail,
        "request_id": r.request_id,
        "created_at": r.created_at.isoformat(timespec="seconds") if r.created_at else "",
    }
