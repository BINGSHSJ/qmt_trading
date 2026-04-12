"""
SQLite 异步引擎与会话工厂

- 每次连接自动执行 PRAGMA journal_mode=WAL 和 busy_timeout
- 对外暴露 async_engine / AsyncSessionLocal / init_db()
"""

from __future__ import annotations

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_db_path, yaml_get

_engine = None
_session_factory = None


def _get_db_url() -> str:
    db_path = get_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite+aiosqlite:///{db_path}"


def get_engine():
    global _engine
    if _engine is None:
        _engine = create_async_engine(
            _get_db_url(),
            echo=False,
            pool_pre_ping=True,
        )

        # 每次从连接池取出连接时设置 PRAGMA
        @event.listens_for(_engine.sync_engine, "connect")
        def _set_sqlite_pragma(dbapi_conn, _connection_record):
            cursor = dbapi_conn.cursor()
            busy_timeout = yaml_get("database", "busy_timeout", default=5000)
            cursor.execute(f"PRAGMA busy_timeout = {int(busy_timeout)};")
            cursor.execute("PRAGMA journal_mode = WAL;")
            cursor.execute("PRAGMA foreign_keys = ON;")
            cursor.close()

    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            bind=get_engine(),
            class_=AsyncSession,
            expire_on_commit=False,
        )
    return _session_factory


async def get_db() -> AsyncSession:
    """FastAPI 依赖注入用：每个请求一个 session"""
    factory = get_session_factory()
    async with factory() as session:
        yield session


async def init_db() -> None:
    """首次启动时调用：确保数据库文件存在并验证 PRAGMA 生效"""
    engine = get_engine()
    async with engine.begin() as conn:
        # 验证 WAL 已生效
        result = await conn.execute(text("PRAGMA journal_mode;"))
        mode = result.scalar()
        if mode != "wal":
            await conn.execute(text("PRAGMA journal_mode = WAL;"))


async def close_db() -> None:
    """应用关闭时释放引擎"""
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
        _engine = None
        _session_factory = None
