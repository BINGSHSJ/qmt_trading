"""
策略 Repository — strategy + strategy_runtime_state 读写
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Sequence

from sqlalchemy import select, update

from app.models.tables import Strategy, StrategyRuntimeState
from app.repositories.base_repo import BaseRepository


class StrategyRepository(BaseRepository[Strategy]):
    model = Strategy

    async def get_by_strategy_id(self, strategy_id: str) -> Strategy | None:
        stmt = select(Strategy).where(Strategy.strategy_id == strategy_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def exists(self, strategy_id: str) -> bool:
        return (await self.get_by_strategy_id(strategy_id)) is not None

    async def update_status(self, strategy_id: str, status: str) -> int:
        stmt = (
            update(Strategy)
            .where(Strategy.strategy_id == strategy_id)
            .values(status=status, updated_at=datetime.now())
        )
        result = await self.session.execute(stmt)
        return result.rowcount  # type: ignore[return-value]


class RuntimeStateRepository(BaseRepository[StrategyRuntimeState]):
    model = StrategyRuntimeState

    async def get_by_strategy_id(self, strategy_id: str) -> StrategyRuntimeState | None:
        stmt = select(StrategyRuntimeState).where(
            StrategyRuntimeState.strategy_id == strategy_id
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def upsert(self, strategy_id: str, **values: Any) -> StrategyRuntimeState:
        """存在则更新，不存在则插入"""
        existing = await self.get_by_strategy_id(strategy_id)
        now = datetime.now()
        if existing:
            for k, v in values.items():
                setattr(existing, k, v)
            existing.updated_at = now
            await self.session.flush()
            return existing
        else:
            entity = StrategyRuntimeState(
                strategy_id=strategy_id,
                updated_at=now,
                **values,
            )
            self.session.add(entity)
            await self.session.flush()
            await self.session.refresh(entity)
            return entity

    async def list_all_states(self) -> Sequence[StrategyRuntimeState]:
        stmt = select(StrategyRuntimeState).order_by(StrategyRuntimeState.id.desc())
        result = await self.session.execute(stmt)
        return result.scalars().all()
