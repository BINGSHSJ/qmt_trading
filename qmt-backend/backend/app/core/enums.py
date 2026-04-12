"""
状态枚举总表 — 对应架构文档 §十六，冻结于 mvp_scope.md §九
"""

from enum import Enum


class StrategyStatus(str, Enum):
    REGISTERED = "registered"
    LOADED = "loaded"
    RUNNING = "running"
    PAUSED = "paused"
    PENDING_RESTART = "pending_restart"
    ERROR = "error"
    STOPPED = "stopped"


class OrderStatus(str, Enum):
    PENDING = "pending"
    SUBMITTED = "submitted"
    PARTIAL_FILLED = "partial_filled"
    FILLED = "filled"
    CANCELED = "canceled"
    REJECTED = "rejected"


class SignalDecisionStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    SKIPPED = "skipped"


class SystemMode(str, Enum):
    READONLY = "readonly"
    SIMULATED = "simulated"
    LIVE = "live"


class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class SystemHealthStatus(str, Enum):
    NORMAL = "normal"
    WARNING = "warning"
    DEGRADED = "degraded"
    ERROR = "error"


class SourceType(str, Enum):
    MANUAL = "manual"
    STRATEGY = "strategy"
    MIXED = "mixed"
    UNATTRIBUTED = "unattributed"


class SignalType(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    ADD = "ADD"
    REDUCE = "REDUCE"
    HOLD = "HOLD"
    CANCEL = "CANCEL"


class RejectionReason(str, Enum):
    """非执行原因结构化枚举 — 对应架构文档 §十 增强点 1"""
    NOT_TRADING_DAY = "not_trading_day"
    NOT_TRADING_TIME = "not_trading_time"
    ACCOUNT_DISCONNECTED = "account_disconnected"
    MARKET_DATA_NOT_READY = "market_data_not_ready"
    INSUFFICIENT_POSITION = "insufficient_position"
    RISK_BLOCKED = "risk_blocked"
    SYMBOL_SUSPENDED = "symbol_suspended"
    PRICE_DEVIATION = "price_deviation"
    STRATEGY_PAUSED = "strategy_paused"
    DUPLICATE_SIGNAL = "duplicate_signal"
    MANUAL_PROTECTION = "manual_protection"
    PRE_CHECK_FAILED = "pre_check_failed"
    MAX_ORDER_VALUE = "max_order_value"
    MAX_DAILY_ORDERS = "max_daily_orders"
    MAX_DAILY_LOSS = "max_daily_loss"
