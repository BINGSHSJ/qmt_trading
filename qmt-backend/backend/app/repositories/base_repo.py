"""
Repository 基类 — 通用 CRUD 封装

所有具体 repo（strategy_repo、trading_repo 等）继承此类。
提供 get_by_id / list_all / insert / update / delete 基础操作。
"""

from __future__ import annotations

from typing import Any, Generic, Sequence, TypeVar

from sqlalchemy import select, func, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.base import Base

ModelT = TypeVar("ModelT", bound=Base)


class BaseRepository(Generic[ModelT]):
    """通用 CRUD 基类，子类设置 model 属性即可使用"""

    model: type[ModelT]

    def __init__(self, session: AsyncSession):
        self.session = session

    async def get_by_id(self, record_id: int) -> ModelT | None:
        return await self.session.get(self.model, record_id)

    async def list_all(
        self,
        *,
        offset: int = 0,
        limit: int = 100,
        order_desc: bool = True,
    ) -> Sequence[ModelT]:
        col = self.model.id
        stmt = (
            select(self.model)
            .order_by(col.desc() if order_desc else col.asc())
            .offset(offset)
            .limit(limit)
        )
        result = await self.session.execute(stmt)
        return result.scalars().all()

    async def count(self) -> int:
        stmt = select(func.count()).select_from(self.model)
        result = await self.session.execute(stmt)
        return result.scalar_one()

    async def insert(self, entity: ModelT) -> ModelT:
        self.session.add(entity)
        await self.session.flush()
        await self.session.refresh(entity)
        return entity

    async def insert_many(self, entities: list[ModelT]) -> list[ModelT]:
        self.session.add_all(entities)
        await self.session.flush()
        return entities

    async def update_by_id(self, record_id: int, **values: Any) -> int:
        stmt = (
            update(self.model)
            .where(self.model.id == record_id)
            .values(**values)
        )
        result = await self.session.execute(stmt)
        return result.rowcount  # type: ignore[return-value]

    async def delete_by_id(self, record_id: int) -> int:
        stmt = delete(self.model).where(self.model.id == record_id)
        result = await self.session.execute(stmt)
        return result.rowcount  # type: ignore[return-value]

    async def commit(self) -> None:
        await self.session.commit()
