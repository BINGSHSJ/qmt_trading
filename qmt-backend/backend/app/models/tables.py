"""
ORM 表定义 — 对应 mvp_scope.md §四 + 架构文档 §十四

共 9 张表：
  strategy, strategy_runtime_state, signal_record, order_record,
  fill_record, position_snapshot, risk_event, system_log, audit_log

索引建议全部在此创建（架构文档 §十四 索引建议）。
字段约束遵循文档：时间默认当前、status 有默认、金额数量默认 0 不 NULL。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    String, Integer, Float, Text, DateTime, Index, func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 1. strategy — 策略元数据
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class Strategy(Base):
    __tablename__ = "strategy"

    strategy_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="registered")
    source_type: Mapped[str] = mapped_column(String(32), nullable=False, default="strategy")
    config_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    start_script: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    stop_script: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    working_dir: Mapped[str] = mapped_column(String(512), nullable=False, default="")
    env_overrides: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 2. strategy_runtime_state — 策略运行时状态
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class StrategyRuntimeState(Base):
    __tablename__ = "strategy_runtime_state"

    strategy_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    pid: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="stopped")
    last_heartbeat_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_signal_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    error_message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("ix_strategy_runtime_state_strategy_id", "strategy_id"),
    )


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 3. signal_record — 策略信号记录
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class SignalRecord(Base):
    __tablename__ = "signal_record"

    signal_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    strategy_id: Mapped[str] = mapped_column(String(64), nullable=False)
    symbol: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    signal_type: Mapped[str] = mapped_column(String(16), nullable=False, default="BUY")
    signal_price: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    target_volume: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    target_value: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    reason: Mapped[str] = mapped_column(Text, nullable=False, default="")
    decision_status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    decision_reason: Mapped[str] = mapped_column(Text, nullable=False, default="")

    __table_args__ = (
        Index("ix_signal_record_strategy_created", "strategy_id", "created_at"),
    )


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 4. order_record — 委托记录
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class OrderRecord(Base):
    __tablename__ = "order_record"

    order_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    signal_id: Mapped[str] = mapped_column(String(64), nullable=True)
    strategy_id: Mapped[str] = mapped_column(String(64), nullable=False)
    account_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    symbol: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    order_type: Mapped[str] = mapped_column(String(16), nullable=False, default="BUY")
    price: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    volume: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    filled_volume: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    filled_amount: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")
    source_type: Mapped[str] = mapped_column(String(16), nullable=False, default="strategy")
    remark: Mapped[str] = mapped_column(Text, nullable=False, default="")
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        Index("ix_order_record_strategy_created", "strategy_id", "created_at"),
    )


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 5. fill_record — 成交记录
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class FillRecord(Base):
    __tablename__ = "fill_record"

    fill_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    order_id: Mapped[str] = mapped_column(String(64), nullable=False)
    strategy_id: Mapped[str] = mapped_column(String(64), nullable=False)
    account_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    symbol: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    fill_price: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    fill_volume: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    fill_amount: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    direction: Mapped[str] = mapped_column(String(16), nullable=False, default="BUY")
    filled_at: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index("ix_fill_record_order_id", "order_id"),
    )


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 6. position_snapshot — 持仓快照
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class PositionSnapshot(Base):
    __tablename__ = "position_snapshot"

    account_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    symbol: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    volume: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    available_volume: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cost_price: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    market_value: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    profit: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    profit_pct: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    source_type: Mapped[str] = mapped_column(String(16), nullable=False, default="unattributed")
    snapshot_time: Mapped[datetime] = mapped_column(
        DateTime, nullable=False, server_default=func.now()
    )

    __table_args__ = (
        Index("ix_position_snapshot_acct_sym_time", "account_id", "symbol", "snapshot_time"),
    )


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 7. risk_event — 风控拦截事件
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class RiskEvent(Base):
    __tablename__ = "risk_event"

    strategy_id: Mapped[str] = mapped_column(String(64), nullable=False)
    signal_id: Mapped[str] = mapped_column(String(64), nullable=True)
    rule_name: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    risk_level: Mapped[str] = mapped_column(String(16), nullable=False, default="medium")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    detail_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")

    __table_args__ = (
        Index("ix_risk_event_strategy_created", "strategy_id", "created_at"),
        Index("ix_risk_event_risk_level", "risk_level"),
    )


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 8. system_log — 系统日志
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class SystemLog(Base):
    __tablename__ = "system_log"

    module: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    level: Mapped[str] = mapped_column(String(16), nullable=False, default="INFO")
    message: Mapped[str] = mapped_column(Text, nullable=False, default="")
    detail: Mapped[str] = mapped_column(Text, nullable=False, default="")
    request_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")

    __table_args__ = (
        Index("ix_system_log_module_created", "module", "created_at"),
    )


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 9. audit_log — 审计日志
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
class AuditLog(Base):
    __tablename__ = "audit_log"

    action: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    target_type: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    target_id: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    before_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    after_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    operator: Mapped[str] = mapped_column(String(64), nullable=False, default="system")
    remark: Mapped[str] = mapped_column(Text, nullable=False, default="")

    __table_args__ = (
        Index("ix_audit_log_target", "target_type", "target_id"),
        Index("ix_audit_log_created", "created_at"),
    )
