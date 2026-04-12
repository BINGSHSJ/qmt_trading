"""
风控 Repository — risk_event 读写
"""

from __future__ import annotations

from datetime import datetime
from typing import Sequence

from sqlalchemy import select, func

from app.models.tables import RiskEvent
from app.repositories.base_repo import BaseRepository


class RiskEventRepository(BaseRepository[RiskEvent]):
    model = RiskEvent

    async def list_by_strategy(
        self, strategy_id: str, offset: int = 0, limit: int = 100,
    ) -> Sequence[RiskEvent]:
        stmt = (
            select(RiskEvent)
            .where(RiskEvent.strategy_id == strategy_id)
            .order_by(RiskEvent.id.desc())
            .offset(offset).limit(limit)
        )
        result = await self.session.execute(stmt)
        return result.scalars().all()

    async def count_today(self, strategy_id: str | None = None) -> int:
        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        stmt = select(func.count()).select_from(RiskEvent).where(
            RiskEvent.created_at >= today
        )
        if strategy_id:
            stmt = stmt.where(RiskEvent.strategy_id == strategy_id)
        result = await self.session.execute(stmt)
        return result.scalar_one()
