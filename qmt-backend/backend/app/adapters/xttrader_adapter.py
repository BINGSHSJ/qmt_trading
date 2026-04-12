"""
xttrader 交易适配器 — 抽象接口 + Mock 实现

职责：下单、撤单、查询委托/成交/持仓/账户
对外统一接口，mock_mode=true 时返回固定演示数据。
"""

from __future__ import annotations

import abc
import uuid
from datetime import datetime
from typing import Any


class XttraderAdapter(abc.ABC):
    """xttrader 抽象接口"""

    @abc.abstractmethod
    async def place_order(
        self, account_id: str, symbol: str, direction: str,
        price: float, volume: int, order_type: str = "LIMIT",
    ) -> dict[str, Any]:
        """下单，返回 order_id 等信息"""

    @abc.abstractmethod
    async def cancel_order(self, account_id: str, order_id: str) -> dict[str, Any]:
        """撤单"""

    @abc.abstractmethod
    async def query_orders(self, account_id: str) -> list[dict[str, Any]]:
        """查询当日委托列表"""

    @abc.abstractmethod
    async def query_fills(self, account_id: str) -> list[dict[str, Any]]:
        """查询当日成交列表"""

    @abc.abstractmethod
    async def query_positions(self, account_id: str) -> list[dict[str, Any]]:
        """查询当前持仓"""

    @abc.abstractmethod
    async def query_account(self, account_id: str) -> dict[str, Any]:
        """查询账户资产"""

    @abc.abstractmethod
    async def check_health(self) -> dict[str, Any]:
        """检查 xttrader 连接健康状态"""


class MockXttraderAdapter(XttraderAdapter):
    """Mock 模式交易适配器 — 固定演示数据"""

    # ── 固定 mock 持仓 ─────────────────────────────────
    _MOCK_POSITIONS: list[dict[str, Any]] = [
        {
            "account_id": "40235910", "symbol": "000001.SZ", "name": "平安银行",
            "volume": 2000, "available_volume": 2000,
            "cost_price": 12.10, "market_value": 24700.00,
            "profit": 500.00, "profit_pct": 2.07,
        },
        {
            "account_id": "40235910", "symbol": "600519.SH", "name": "贵州茅台",
            "volume": 100, "available_volume": 100,
            "cost_price": 1675.00, "market_value": 168800.00,
            "profit": 1300.00, "profit_pct": 0.78,
        },
        {
            "account_id": "40235910", "symbol": "300750.SZ", "name": "宁德时代",
            "volume": 500, "available_volume": 300,
            "cost_price": 210.00, "market_value": 107800.00,
            "profit": 2800.00, "profit_pct": 2.67,
        },
    ]

    # ── 固定 mock 委托 ─────────────────────────────────
    _MOCK_ORDERS: list[dict[str, Any]] = [
        {
            "order_id": "MOCK-ORD-001", "account_id": "40235910",
            "symbol": "000001.SZ", "order_type": "BUY",
            "price": 12.30, "volume": 1000,
            "filled_volume": 1000, "filled_amount": 12300.00,
            "status": "filled", "created_at": "2026-04-12 09:35:00",
        },
        {
            "order_id": "MOCK-ORD-002", "account_id": "40235910",
            "symbol": "601318.SH", "order_type": "BUY",
            "price": 48.00, "volume": 500,
            "filled_volume": 300, "filled_amount": 14400.00,
            "status": "partial_filled", "created_at": "2026-04-12 10:15:00",
        },
        {
            "order_id": "MOCK-ORD-003", "account_id": "40235910",
            "symbol": "300750.SZ", "order_type": "SELL",
            "price": 216.00, "volume": 200,
            "filled_volume": 0, "filled_amount": 0.00,
            "status": "submitted", "created_at": "2026-04-12 13:45:00",
        },
    ]

    # ── 固定 mock 成交 ─────────────────────────────────
    _MOCK_FILLS: list[dict[str, Any]] = [
        {
            "fill_id": "MOCK-FILL-001", "order_id": "MOCK-ORD-001",
            "account_id": "40235910", "symbol": "000001.SZ",
            "direction": "BUY", "fill_price": 12.30,
            "fill_volume": 1000, "fill_amount": 12300.00,
            "filled_at": "2026-04-12 09:35:02",
        },
        {
            "fill_id": "MOCK-FILL-002", "order_id": "MOCK-ORD-002",
            "account_id": "40235910", "symbol": "601318.SH",
            "direction": "BUY", "fill_price": 48.00,
            "fill_volume": 300, "fill_amount": 14400.00,
            "filled_at": "2026-04-12 10:15:05",
        },
    ]

    # ── 固定 mock 账户 ─────────────────────────────────
    _MOCK_ACCOUNT: dict[str, Any] = {
        "account_id": "40235910",
        "total_asset": 523456.78,
        "cash": 221856.78,
        "market_value": 301300.00,
        "frozen": 14400.00,
        "daily_profit": 4600.00,
        "daily_profit_pct": 0.89,
    }

    async def place_order(
        self, account_id: str, symbol: str, direction: str,
        price: float, volume: int, order_type: str = "LIMIT",
    ) -> dict[str, Any]:
        mock_order_id = f"MOCK-ORD-{uuid.uuid4().hex[:8].upper()}"
        return {
            "order_id": mock_order_id,
            "account_id": account_id,
            "symbol": symbol,
            "direction": direction,
            "price": price,
            "volume": volume,
            "order_type": order_type,
            "status": "submitted",
            "created_at": datetime.now().isoformat(timespec="seconds"),
            "message": "Mock 下单成功",
        }

    async def cancel_order(self, account_id: str, order_id: str) -> dict[str, Any]:
        return {
            "order_id": order_id,
            "status": "canceled",
            "message": "Mock 撤单成功",
        }

    async def query_orders(self, account_id: str) -> list[dict[str, Any]]:
        return [o for o in self._MOCK_ORDERS if o["account_id"] == account_id]

    async def query_fills(self, account_id: str) -> list[dict[str, Any]]:
        return [f for f in self._MOCK_FILLS if f["account_id"] == account_id]

    async def query_positions(self, account_id: str) -> list[dict[str, Any]]:
        return [p for p in self._MOCK_POSITIONS if p["account_id"] == account_id]

    async def query_account(self, account_id: str) -> dict[str, Any]:
        return {**self._MOCK_ACCOUNT, "update_time": datetime.now().isoformat(timespec="seconds")}

    async def check_health(self) -> dict[str, Any]:
        return {
            "connected": True,
            "error": "",
            "detail": {
                "mode": "mock",
                "last_callback": datetime.now().isoformat(timespec="seconds"),
                "latency_ms": 0,
            },
        }


class RealXttraderAdapter(XttraderAdapter):
    """真实 xttrader 适配器 — 最小可用实现

    尝试导入 xtquant.xttrader，导入失败时 check_health 返回 connected=False。
    业务方法调用失败统一抛 XttraderError(5003)。
    """

    def __init__(self):
        self._mod = None
        self._trader = None
        self._init_error = ""
        try:
            from xtquant import xttrader  # type: ignore
            self._mod = xttrader
        except Exception as e:
            self._init_error = f"xtquant.xttrader 不可用: {e}"

    def _require(self):
        if self._mod is None:
            from app.core.exceptions import XttraderError
            raise XttraderError(self._init_error)

    async def check_health(self) -> dict[str, Any]:
        connected = self._mod is not None
        error = "" if connected else self._init_error
        detail: dict[str, Any] = {
            "module": "xtquant.xttrader",
            "installed": connected,
            "timestamp": datetime.now().isoformat(timespec="seconds"),
        }
        return {"connected": connected, "error": error, "detail": detail}

    async def place_order(
        self, account_id: str, symbol: str, direction: str,
        price: float, volume: int, order_type: str = "LIMIT",
    ) -> dict[str, Any]:
        self._require()
        try:
            # 真实下单逻辑 — 需要初始化好的 trader 实例
            from app.core.exceptions import XttraderError
            raise XttraderError("真实下单需要完整 trader 连接，当前为最小可用模式")
        except Exception as e:
            from app.core.exceptions import XttraderError
            if isinstance(e, XttraderError):
                raise
            raise XttraderError(f"下单失败: {e}")

    async def cancel_order(self, account_id: str, order_id: str) -> dict[str, Any]:
        self._require()
        from app.core.exceptions import XttraderError
        raise XttraderError("真实撤单需要完整 trader 连接，当前为最小可用模式")

    async def query_orders(self, account_id: str) -> list[dict[str, Any]]:
        self._require()
        from app.core.exceptions import XttraderError
        raise XttraderError("真实查询委托需要完整 trader 连接，当前为最小可用模式")

    async def query_fills(self, account_id: str) -> list[dict[str, Any]]:
        self._require()
        from app.core.exceptions import XttraderError
        raise XttraderError("真实查询成交需要完整 trader 连接，当前为最小可用模式")

    async def query_positions(self, account_id: str) -> list[dict[str, Any]]:
        self._require()
        from app.core.exceptions import XttraderError
        raise XttraderError("真实查询持仓需要完整 trader 连接，当前为最小可用模式")

    async def query_account(self, account_id: str) -> dict[str, Any]:
        self._require()
        from app.core.exceptions import XttraderError
        raise XttraderError("真实查询账户需要完整 trader 连接，当前为最小可用模式")
