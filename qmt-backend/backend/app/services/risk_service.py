"""
风控校验 Service

核心职责：
  - 下单前风控规则校验
  - 命中记录写入 risk_event
  - 返回 pass / block + 原因列表
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import yaml_get
from app.core.enums import RejectionReason, RiskLevel
from app.models.tables import RiskEvent
from app.repositories.risk_repo import RiskEventRepository
from app.repositories.trading_repo import OrderRecordRepository
from app.adapters.factory import get_xttrader_adapter

logger = logging.getLogger("risk_service")


class RiskCheckResult:
    """风控校验结果"""

    def __init__(self):
        self.passed = True
        self.violations: list[dict[str, Any]] = []

    def add_violation(self, rule: str, reason: RejectionReason, level: RiskLevel, detail: str = ""):
        self.passed = False
        self.violations.append({
            "rule": rule,
            "reason": reason.value,
            "level": level.value,
            "detail": detail,
        })

    def to_dict(self) -> dict[str, Any]:
        return {
            "passed": self.passed,
            "violations": self.violations,
        }


class RiskService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.risk_repo = RiskEventRepository(session)
        self.order_repo = OrderRecordRepository(session)

    async def pre_order_check(
        self,
        strategy_id: str,
        signal_id: str,
        symbol: str,
        direction: str,
        price: float,
        volume: int,
    ) -> RiskCheckResult:
        """
        下单前风控校验，按规则列表逐条检查。
        每条命中都写入 risk_event 表。
        """
        result = RiskCheckResult()

        # 规则 1: 单笔委托金额上限
        max_value = yaml_get("risk", "max_single_order_value", default=100000)
        order_value = price * volume
        if order_value > max_value:
            result.add_violation(
                rule="max_single_order_value",
                reason=RejectionReason.MAX_ORDER_VALUE,
                level=RiskLevel.HIGH,
                detail=f"委托金额 {order_value:.2f} 超过上限 {max_value}",
            )

        # 规则 2: 当日委托笔数上限
        max_count = yaml_get("risk", "max_daily_order_count", default=50)
        today_count = await self.order_repo.count_today(strategy_id)
        if today_count >= max_count:
            result.add_violation(
                rule="max_daily_order_count",
                reason=RejectionReason.MAX_DAILY_ORDERS,
                level=RiskLevel.MEDIUM,
                detail=f"当日委托 {today_count} 笔 >= 上限 {max_count}",
            )

        # 规则 3: 当日亏损比例上限
        max_loss_pct = yaml_get("risk", "max_daily_loss_pct", default=5.0)
        if max_loss_pct and max_loss_pct > 0:
            try:
                from app.core.config import get_env_settings
                adapter = get_xttrader_adapter()
                account = await adapter.query_account(get_env_settings().qmt_account_id)
                daily_loss_pct = account.get("daily_profit_pct", 0.0)
                # daily_profit_pct 为负即亏损
                if daily_loss_pct < 0 and abs(daily_loss_pct) >= max_loss_pct:
                    result.add_violation(
                        rule="max_daily_loss_pct",
                        reason=RejectionReason.MAX_DAILY_LOSS,
                        level=RiskLevel.CRITICAL,
                        detail=f"当日亏损 {abs(daily_loss_pct):.2f}% >= 上限 {max_loss_pct}%",
                    )
            except Exception as e:
                logger.warning("日亏损比例检查失败（降级跳过）: %s", e)

        # 所有命中写入 risk_event
        if not result.passed:
            for v in result.violations:
                event = RiskEvent(
                    strategy_id=strategy_id,
                    signal_id=signal_id,
                    rule_name=v["rule"],
                    risk_level=v["level"],
                    description=v["detail"],
                    detail_json=json.dumps(v, ensure_ascii=False),
                )
                await self.risk_repo.insert(event)
            logger.warning(
                "风控拦截 strategy=%s signal=%s violations=%d",
                strategy_id, signal_id, len(result.violations),
            )

        return result

    async def list_events(
        self,
        strategy_id: str | None = None,
        offset: int = 0,
        limit: int = 100,
    ) -> list[dict[str, Any]]:
        if strategy_id:
            events = await self.risk_repo.list_by_strategy(strategy_id, offset, limit)
        else:
            events = await self.risk_repo.list_all(offset=offset, limit=limit)
        return [self._event_to_dict(e) for e in events]

    async def count_today(self, strategy_id: str | None = None) -> int:
        return await self.risk_repo.count_today(strategy_id)

    @staticmethod
    def _event_to_dict(e: RiskEvent) -> dict[str, Any]:
        return {
            "id": e.id,
            "strategy_id": e.strategy_id,
            "signal_id": e.signal_id,
            "rule_name": e.rule_name,
            "risk_level": e.risk_level,
            "description": e.description,
            "detail_json": e.detail_json,
            "created_at": e.created_at.isoformat(timespec="seconds") if e.created_at else "",
        }
