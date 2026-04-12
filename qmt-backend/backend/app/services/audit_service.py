"""
审计日志 Service

在关键业务操作时自动记录变更前后状态：
  - 策略生命周期（注册/启动/停止/暂停）
  - 订单操作（下单/撤单）
  - 风控触发
  - 管理操作（一键暂停等）
"""

from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tables import AuditLog
from app.repositories.base_repo import BaseRepository

logger = logging.getLogger("audit")


class AuditLogRepository(BaseRepository[AuditLog]):
    model = AuditLog


async def write_audit(
    session: AsyncSession,
    *,
    action: str,
    target_type: str,
    target_id: str,
    before: Any = None,
    after: Any = None,
    operator: str = "system",
    remark: str = "",
) -> None:
    """写入一条审计日志"""
    repo = AuditLogRepository(session)
    entry = AuditLog(
        action=action,
        target_type=target_type,
        target_id=target_id,
        before_json=json.dumps(before, ensure_ascii=False, default=str) if before else "{}",
        after_json=json.dumps(after, ensure_ascii=False, default=str) if after else "{}",
        operator=operator,
        remark=remark,
    )
    await repo.insert(entry)
    logger.info("审计: %s %s/%s by %s", action, target_type, target_id, operator)
