"""
交易主链路 Service

核心链路: 信号入库 → 前置校验 → 风控校验 → 下单编排
包含：订单幂等、交易时段校验、策略状态校验、重复信号防护
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_env_settings, yaml_get
from app.core.enums import (
    SignalDecisionStatus, OrderStatus, StrategyStatus,
    RejectionReason, RiskLevel,
)
from app.core.exceptions import NotFound, ParamInvalid
from app.core.trading_calendar import is_trading_day, is_trading_time
from app.adapters.factory import get_xttrader_adapter
from app.models.tables import SignalRecord, OrderRecord, FillRecord
from app.repositories.strategy_repo import StrategyRepository
from app.repositories.trading_repo import (
    SignalRecordRepository, OrderRecordRepository,
    FillRecordRepository, PositionSnapshotRepository,
)
from app.services.risk_service import RiskService
from app.services.audit_service import write_audit
from app.api.ws import ws_manager

logger = logging.getLogger("trading_service")


class TradingService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.signal_repo = SignalRecordRepository(session)
        self.order_repo = OrderRecordRepository(session)
        self.fill_repo = FillRecordRepository(session)
        self.position_repo = PositionSnapshotRepository(session)
        self.strategy_repo = StrategyRepository(session)
        self.risk_svc = RiskService(session)

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # 提交信号（主链路入口）
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    async def submit_signal(
        self,
        signal_id: str,
        strategy_id: str,
        symbol: str,
        signal_type: str,
        signal_price: float,
        target_volume: int | None,
        target_value: float = 0.0,
        confidence: float = 0.0,
        reason: str = "",
    ) -> dict[str, Any]:
        """
        信号 → 风控 → 下单 完整链路。
        返回 { signal, decision, order?, rejection_reasons? }

        target_volume 为空时，使用 target_value / signal_price 回退计算，
        按 lot_size 向下取整。
        """
        # ── 0. target_volume 回退计算 ────────────────
        lot_size: int = yaml_get("trading", "lot_size", default=100)
        if not target_volume:
            if target_value > 0 and signal_price > 0:
                raw = target_value / signal_price
                target_volume = int(raw // lot_size) * lot_size
            if not target_volume or target_volume <= 0:
                raise ParamInvalid("无法计算有效 target_volume（请检查 target_value 和 signal_price）")
        # ── 1. 幂等：重复 signal_id 直接跳过 ─────────
        if await self.signal_repo.exists(signal_id):
            existing = await self.signal_repo.get_by_signal_id(signal_id)
            return {
                "signal_id": signal_id,
                "decision": SignalDecisionStatus.SKIPPED.value,
                "rejection_reasons": [RejectionReason.DUPLICATE_SIGNAL.value],
                "message": "重复信号，已跳过",
                "existing_status": existing.decision_status if existing else None,
            }

        # ── 2. 信号入库（初始 pending） ──────────────
        signal = SignalRecord(
            signal_id=signal_id,
            strategy_id=strategy_id,
            symbol=symbol,
            signal_type=signal_type,
            signal_price=signal_price,
            target_volume=target_volume,
            target_value=target_value,
            confidence=confidence,
            reason=reason,
            decision_status=SignalDecisionStatus.PENDING.value,
            decision_reason="",
        )
        await self.signal_repo.insert(signal)

        rejection_reasons: list[str] = []

        # ── 3. 前置校验：交易日历 ────────────────────
        settings = get_env_settings()

        if not is_trading_day():
            rejection_reasons.append(RejectionReason.NOT_TRADING_DAY.value)

        if not is_trading_time():
            rejection_reasons.append(RejectionReason.NOT_TRADING_TIME.value)

        # ── 4. 前置校验：策略状态 ────────────────────
        strategy = await self.strategy_repo.get_by_strategy_id(strategy_id)
        if strategy is None:
            rejection_reasons.append(RejectionReason.PRE_CHECK_FAILED.value)
        elif strategy.status != StrategyStatus.RUNNING.value:
            rejection_reasons.append(RejectionReason.STRATEGY_PAUSED.value)

        # ── 5. 如有前置拒绝 → skipped ───────────────
        if rejection_reasons:
            decision = SignalDecisionStatus.SKIPPED.value
            signal.decision_status = decision
            signal.decision_reason = ", ".join(rejection_reasons)
            await self.session.commit()
            logger.info(
                "信号跳过 signal=%s reasons=%s", signal_id, rejection_reasons,
            )
            return {
                "signal_id": signal_id,
                "decision": decision,
                "rejection_reasons": rejection_reasons,
                "message": f"信号被跳过: {signal.decision_reason}",
            }

        # ── 6. 风控校验 ─────────────────────────────
        risk_result = await self.risk_svc.pre_order_check(
            strategy_id=strategy_id,
            signal_id=signal_id,
            symbol=symbol,
            direction=signal_type,
            price=signal_price,
            volume=target_volume,
        )

        if not risk_result.passed:
            decision = SignalDecisionStatus.REJECTED.value
            reasons = [v["reason"] for v in risk_result.violations]
            signal.decision_status = decision
            signal.decision_reason = json.dumps(risk_result.violations, ensure_ascii=False)
            await self.session.commit()
            logger.info(
                "信号被风控拦截 signal=%s violations=%d", signal_id, len(risk_result.violations),
            )
            # WS 推送风控事件
            await ws_manager.broadcast("risk_alert", {
                "signal_id": signal_id,
                "strategy_id": strategy_id,
                "symbol": symbol,
                "reasons": reasons,
            })
            return {
                "signal_id": signal_id,
                "decision": decision,
                "rejection_reasons": reasons,
                "risk_detail": risk_result.violations,
                "message": "风控拦截",
            }

        # ── 7. 下单编排 ─────────────────────────────
        adapter = get_xttrader_adapter()
        order_result = await adapter.place_order(
            account_id=settings.qmt_account_id,
            symbol=symbol,
            direction=signal_type,
            price=signal_price,
            volume=target_volume,
        )

        adapter_order_id = order_result.get("order_id", f"ORD-{uuid.uuid4().hex[:8]}")

        order = OrderRecord(
            order_id=adapter_order_id,
            signal_id=signal_id,
            strategy_id=strategy_id,
            account_id=settings.qmt_account_id,
            symbol=symbol,
            order_type=signal_type,
            price=signal_price,
            volume=target_volume,
            status=OrderStatus.SUBMITTED.value,
            source_type="strategy",
        )
        await self.order_repo.insert(order)

        # Mock 模式下模拟即时全成交
        if settings.mock_mode:
            order.status = OrderStatus.FILLED.value
            order.filled_volume = target_volume
            order.filled_amount = signal_price * target_volume

            fill = FillRecord(
                fill_id=f"FILL-{uuid.uuid4().hex[:8]}",
                order_id=adapter_order_id,
                strategy_id=strategy_id,
                account_id=settings.qmt_account_id,
                symbol=symbol,
                fill_price=signal_price,
                fill_volume=target_volume,
                fill_amount=signal_price * target_volume,
                direction=signal_type,
            )
            await self.fill_repo.insert(fill)

        # 信号标记 approved
        signal.decision_status = SignalDecisionStatus.APPROVED.value
        signal.decision_reason = "风控通过, 下单成功"

        await write_audit(
            self.session, action="place_order", target_type="order",
            target_id=adapter_order_id,
            after={"signal_id": signal_id, "symbol": symbol, "direction": signal_type,
                   "price": signal_price, "volume": target_volume, "status": order.status},
        )
        await self.session.commit()

        logger.info(
            "信号执行成功 signal=%s order=%s", signal_id, adapter_order_id,
        )
        # WS 推送成交事件
        await ws_manager.broadcast("trade_fill", {
            "signal_id": signal_id,
            "order_id": adapter_order_id,
            "strategy_id": strategy_id,
            "symbol": symbol,
            "price": signal_price,
            "volume": target_volume,
            "direction": signal_type,
        })
        return {
            "signal_id": signal_id,
            "decision": SignalDecisionStatus.APPROVED.value,
            "order_id": adapter_order_id,
            "order_status": order.status,
            "message": "信号已执行",
        }

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # 查询接口
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    async def list_signals(
        self, strategy_id: str | None = None, offset: int = 0, limit: int = 100,
    ) -> list[dict[str, Any]]:
        if strategy_id:
            records = await self.signal_repo.list_by_strategy(strategy_id, offset, limit)
        else:
            records = await self.signal_repo.list_all(offset=offset, limit=limit)
        return [self._signal_to_dict(r) for r in records]

    async def list_orders(self, offset: int = 0, limit: int = 100) -> list[dict[str, Any]]:
        records = await self.order_repo.list_all(offset=offset, limit=limit)
        return [self._order_to_dict(r) for r in records]

    async def list_fills(self, offset: int = 0, limit: int = 100) -> list[dict[str, Any]]:
        records = await self.fill_repo.list_all(offset=offset, limit=limit)
        return [self._fill_to_dict(r) for r in records]

    async def list_positions(self) -> list[dict[str, Any]]:
        """持仓直接从 adapter 查询（实时性优先）"""
        settings = get_env_settings()
        adapter = get_xttrader_adapter()
        return await adapter.query_positions(settings.qmt_account_id)

    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    # 序列化
    # ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    @staticmethod
    def _signal_to_dict(r: SignalRecord) -> dict[str, Any]:
        return {
            "id": r.id,
            "signal_id": r.signal_id,
            "strategy_id": r.strategy_id,
            "symbol": r.symbol,
            "signal_type": r.signal_type,
            "signal_price": r.signal_price,
            "target_volume": r.target_volume,
            "target_value": r.target_value,
            "confidence": r.confidence,
            "reason": r.reason,
            "decision_status": r.decision_status,
            "decision_reason": r.decision_reason,
            "created_at": r.created_at.isoformat(timespec="seconds") if r.created_at else "",
        }

    @staticmethod
    def _order_to_dict(r: OrderRecord) -> dict[str, Any]:
        return {
            "id": r.id,
            "order_id": r.order_id,
            "signal_id": r.signal_id,
            "strategy_id": r.strategy_id,
            "account_id": r.account_id,
            "symbol": r.symbol,
            "order_type": r.order_type,
            "price": r.price,
            "volume": r.volume,
            "filled_volume": r.filled_volume,
            "filled_amount": r.filled_amount,
            "status": r.status,
            "source_type": r.source_type,
            "remark": r.remark,
            "created_at": r.created_at.isoformat(timespec="seconds") if r.created_at else "",
        }

    @staticmethod
    def _fill_to_dict(r: FillRecord) -> dict[str, Any]:
        return {
            "id": r.id,
            "fill_id": r.fill_id,
            "order_id": r.order_id,
            "strategy_id": r.strategy_id,
            "account_id": r.account_id,
            "symbol": r.symbol,
            "fill_price": r.fill_price,
            "fill_volume": r.fill_volume,
            "fill_amount": r.fill_amount,
            "direction": r.direction,
            "filled_at": r.filled_at.isoformat(timespec="seconds") if r.filled_at else "",
            "created_at": r.created_at.isoformat(timespec="seconds") if r.created_at else "",
        }
