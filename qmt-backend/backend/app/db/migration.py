"""
顺序 SQL 迁移执行器

约定：
  - 迁移脚本放在 backend/migrations/ 目录
  - 命名：YYYYMMDD_HHMM_description.sql（字典序）
  - 已执行的脚本记录在 _migration_history 表中
  - 可重复执行：已执行的脚本自动跳过
"""

from __future__ import annotations

import logging
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.config import BASE_DIR

logger = logging.getLogger("migration")

MIGRATION_DIR = BASE_DIR / "migrations"

# 迁移历史表 DDL
_HISTORY_DDL = """
CREATE TABLE IF NOT EXISTS _migration_history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    filename   TEXT    NOT NULL UNIQUE,
    applied_at DATETIME NOT NULL DEFAULT (datetime('now', 'localtime'))
);
"""


async def _ensure_history_table(conn: AsyncConnection) -> None:
    """确保迁移历史表存在"""
    await conn.execute(text(_HISTORY_DDL))


async def _get_applied(conn: AsyncConnection) -> set[str]:
    """获取已执行过的脚本文件名集合"""
    result = await conn.execute(text("SELECT filename FROM _migration_history"))
    return {row[0] for row in result.fetchall()}


async def _record_applied(conn: AsyncConnection, filename: str) -> None:
    """记录已执行的脚本"""
    await conn.execute(
        text("INSERT INTO _migration_history (filename) VALUES (:f)"),
        {"f": filename},
    )


async def run_migrations(conn: AsyncConnection) -> list[str]:
    """
    扫描 migrations/ 目录，按文件名排序执行未运行的 SQL 脚本。
    返回本次新执行的脚本列表。

    该函数应在一个已开启的事务连接中调用（engine.begin()）。
    """
    await _ensure_history_table(conn)

    if not MIGRATION_DIR.exists():
        logger.info("migrations/ 目录不存在，跳过迁移")
        return []

    applied = await _get_applied(conn)

    scripts = sorted(
        p for p in MIGRATION_DIR.iterdir()
        if p.suffix == ".sql" and p.name not in applied
    )

    newly_applied: list[str] = []

    for script in scripts:
        logger.info("执行迁移: %s", script.name)
        sql_text = script.read_text(encoding="utf-8").strip()
        if not sql_text:
            logger.warning("迁移脚本为空，跳过: %s", script.name)
            continue

        # 按分号拆分为多条语句逐条执行
        for statement in sql_text.split(";"):
            stmt = statement.strip()
            if stmt:
                await conn.execute(text(stmt))

        await _record_applied(conn, script.name)
        newly_applied.append(script.name)
        logger.info("迁移完成: %s", script.name)

    if not newly_applied:
        logger.info("无需执行新的迁移脚本")

    return newly_applied
