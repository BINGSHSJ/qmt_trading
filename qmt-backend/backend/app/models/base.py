"""
SQLAlchemy 声明基类

所有 ORM 模型继承 Base，统一约定：
- id 主键自增
- created_at 默认当前时间
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Integer, DateTime, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """所有 ORM 表的公共基类"""

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )
