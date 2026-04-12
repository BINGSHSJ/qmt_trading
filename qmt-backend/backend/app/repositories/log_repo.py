"""
日志仓库
"""

from __future__ import annotations

from typing import Sequence

from sqlalchemy import select

from app.models.tables import SystemLog
from app.repositories.base_repo import BaseRepository


class SystemLogRepository(BaseRepository[SystemLog]):
    model = SystemLog

    async def list_by_module(
        self, module: str, offset: int = 0, limit: int = 100,
    ) -> Sequence[SystemLog]:
        stmt = (
            select(SystemLog)
            .where(SystemLog.module == module)
            .order_by(SystemLog.id.desc())
            .offset(offset)
            .limit(limit)
        )
        result = await self.session.execute(stmt)
        return result.scalars().all()

    async def list_by_level(
        self, level: str, offset: int = 0, limit: int = 100,
    ) -> Sequence[SystemLog]:
        stmt = (
            select(SystemLog)
            .where(SystemLog.level == level)
            .order_by(SystemLog.id.desc())
            .offset(offset)
            .limit(limit)
        )
        result = await self.session.execute(stmt)
        return result.scalars().all()
