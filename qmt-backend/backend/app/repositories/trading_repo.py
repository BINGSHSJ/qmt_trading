"""
交易 Repository — signal_record / order_record / fill_record / position_snapshot
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Sequence

from sqlalchemy import select, func

from app.models.tables import SignalRecord, OrderRecord, FillRecord, PositionSnapshot
from app.repositories.base_repo import BaseRepository


class SignalRecordRepository(BaseRepository[SignalRecord]):
    model = SignalRecord

    async def get_by_signal_id(self, signal_id: str) -> SignalRecord | None:
        stmt = select(SignalRecord).where(SignalRecord.signal_id == signal_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def exists(self, signal_id: str) -> bool:
        return (await self.get_by_signal_id(signal_id)) is not None

    async def list_by_strategy(
        self, strategy_id: str, offset: int = 0, limit: int = 100,
    ) -> Sequence[SignalRecord]:
        stmt = (
            select(SignalRecord)
            .where(SignalRecord.strategy_id == strategy_id)
            .order_by(SignalRecord.id.desc())
            .offset(offset).limit(limit)
        )
        result = await self.session.execute(stmt)
        return result.scalars().all()

    async def count_today(self, strategy_id: str | None = None) -> int:
        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        stmt = select(func.count()).select_from(SignalRecord).where(
            SignalRecord.created_at >= today
        )
        if strategy_id:
            stmt = stmt.where(SignalRecord.strategy_id == strategy_id)
        result = await self.session.execute(stmt)
        return result.scalar_one()


class OrderRecordRepository(BaseRepository[OrderRecord]):
    model = OrderRecord

    async def get_by_order_id(self, order_id: str) -> OrderRecord | None:
        stmt = select(OrderRecord).where(OrderRecord.order_id == order_id)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def count_today(self, strategy_id: str | None = None) -> int:
        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        stmt = select(func.count()).select_from(OrderRecord).where(
            OrderRecord.created_at >= today
        )
        if strategy_id:
            stmt = stmt.where(OrderRecord.strategy_id == strategy_id)
        result = await self.session.execute(stmt)
        return result.scalar_one()

    async def list_by_strategy(
        self, strategy_id: str, offset: int = 0, limit: int = 100,
    ) -> Sequence[OrderRecord]:
        stmt = (
            select(OrderRecord)
            .where(OrderRecord.strategy_id == strategy_id)
            .order_by(OrderRecord.id.desc())
            .offset(offset).limit(limit)
        )
        result = await self.session.execute(stmt)
        return result.scalars().all()


class FillRecordRepository(BaseRepository[FillRecord]):
    model = FillRecord

    async def list_by_order(self, order_id: str) -> Sequence[FillRecord]:
        stmt = (
            select(FillRecord)
            .where(FillRecord.order_id == order_id)
            .order_by(FillRecord.id.desc())
        )
        result = await self.session.execute(stmt)
        return result.scalars().all()

    async def count_today(self) -> int:
        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        stmt = select(func.count()).select_from(FillRecord).where(
            FillRecord.created_at >= today
        )
        result = await self.session.execute(stmt)
        return result.scalar_one()


class PositionSnapshotRepository(BaseRepository[PositionSnapshot]):
    model = PositionSnapshot
