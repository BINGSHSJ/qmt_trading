"""
xtdata 行情适配器 — 抽象接口 + Mock 实现

职责：行情获取、标的信息查询
对外统一接口，mock_mode=true 时返回固定演示数据。
"""

from __future__ import annotations

import abc
from datetime import datetime, timedelta
from typing import Any


class XtdataAdapter(abc.ABC):
    """xtdata 抽象接口"""

    @abc.abstractmethod
    async def get_market_snapshot(self, symbol: str) -> dict[str, Any]:
        """获取单只标的最新行情快照"""

    @abc.abstractmethod
    async def get_market_snapshots(self, symbols: list[str]) -> list[dict[str, Any]]:
        """批量获取行情快照"""

    @abc.abstractmethod
    async def get_instrument_info(self, symbol: str) -> dict[str, Any]:
        """获取标的基本信息（名称、板块、状态等）"""

    @abc.abstractmethod
    async def check_health(self) -> dict[str, Any]:
        """检查 xtdata 连接健康状态"""


class MockXtdataAdapter(XtdataAdapter):
    """Mock 模式行情适配器 — 固定演示数据"""

    # 固定 mock 标的池
    _MOCK_STOCKS: dict[str, dict[str, Any]] = {
        "000001.SZ": {
            "symbol": "000001.SZ", "name": "平安银行",
            "last_price": 12.35, "open": 12.20, "high": 12.58, "low": 12.10,
            "pre_close": 12.18, "volume": 8523400, "amount": 105234567.80,
            "change": 0.17, "change_pct": 1.40, "suspended": False,
        },
        "600519.SH": {
            "symbol": "600519.SH", "name": "贵州茅台",
            "last_price": 1688.00, "open": 1675.00, "high": 1695.50, "low": 1670.00,
            "pre_close": 1680.00, "volume": 1234500, "amount": 2084561230.00,
            "change": 8.00, "change_pct": 0.48, "suspended": False,
        },
        "300750.SZ": {
            "symbol": "300750.SZ", "name": "宁德时代",
            "last_price": 215.60, "open": 213.00, "high": 218.80, "low": 212.50,
            "pre_close": 214.00, "volume": 3456700, "amount": 748923456.00,
            "change": 1.60, "change_pct": 0.75, "suspended": False,
        },
        "601318.SH": {
            "symbol": "601318.SH", "name": "中国平安",
            "last_price": 48.50, "open": 48.00, "high": 49.20, "low": 47.80,
            "pre_close": 48.20, "volume": 5678900, "amount": 275432100.00,
            "change": 0.30, "change_pct": 0.62, "suspended": False,
        },
    }

    _MOCK_INSTRUMENTS: dict[str, dict[str, Any]] = {
        "000001.SZ": {"symbol": "000001.SZ", "name": "平安银行", "exchange": "SZ", "board": "主板", "listed": True, "suspended": False},
        "600519.SH": {"symbol": "600519.SH", "name": "贵州茅台", "exchange": "SH", "board": "主板", "listed": True, "suspended": False},
        "300750.SZ": {"symbol": "300750.SZ", "name": "宁德时代", "exchange": "SZ", "board": "创业板", "listed": True, "suspended": False},
        "601318.SH": {"symbol": "601318.SH", "name": "中国平安", "exchange": "SH", "board": "主板", "listed": True, "suspended": False},
    }

    async def get_market_snapshot(self, symbol: str) -> dict[str, Any]:
        base = self._MOCK_STOCKS.get(symbol)
        if base is None:
            return {"symbol": symbol, "name": "未知标的", "last_price": 0.0, "error": "标的不存在"}
        snapshot = {**base, "update_time": datetime.now().isoformat(timespec="seconds")}
        return snapshot

    async def get_market_snapshots(self, symbols: list[str]) -> list[dict[str, Any]]:
        return [await self.get_market_snapshot(s) for s in symbols]

    async def get_instrument_info(self, symbol: str) -> dict[str, Any]:
        info = self._MOCK_INSTRUMENTS.get(symbol)
        if info is None:
            return {"symbol": symbol, "name": "未知标的", "listed": False}
        return {**info}

    async def check_health(self) -> dict[str, Any]:
        return {
            "connected": True,
            "error": "",
            "detail": {
                "mode": "mock",
                "last_update": datetime.now().isoformat(timespec="seconds"),
                "latency_ms": 0,
            },
        }


class RealXtdataAdapter(XtdataAdapter):
    """真实 xtdata 适配器 — 最小可用实现

    尝试导入 xtquant.xtdata，导入失败时 check_health 返回 connected=False。
    业务方法调用失败统一抛 XtdataError(5002)。
    """

    def __init__(self):
        self._mod = None
        self._init_error = ""
        try:
            from xtquant import xtdata  # type: ignore
            self._mod = xtdata
        except Exception as e:
            self._init_error = f"xtquant.xtdata 不可用: {e}"

    def _require(self):
        if self._mod is None:
            from app.core.exceptions import XtdataError
            raise XtdataError(self._init_error)

    async def check_health(self) -> dict[str, Any]:
        connected = self._mod is not None
        error = "" if connected else self._init_error
        detail: dict[str, Any] = {
            "module": "xtquant.xtdata",
            "installed": connected,
            "timestamp": datetime.now().isoformat(timespec="seconds"),
        }
        if connected:
            try:
                # 轻量级探测：获取 instrument_count 作为连通性检测
                instruments = self._mod.get_stock_list_in_sector("沪深A股")
                detail["instrument_count"] = len(instruments) if instruments else 0
            except Exception as e:
                connected = False
                error = f"探测失败: {e}"
        return {"connected": connected, "error": error, "detail": detail}

    async def get_market_snapshot(self, symbol: str) -> dict[str, Any]:
        self._require()
        try:
            data = self._mod.get_full_tick([symbol])
            if symbol in data:
                tick = data[symbol]
                return {
                    "symbol": symbol,
                    "last_price": float(tick.get("lastPrice", 0)),
                    "open": float(tick.get("open", 0)),
                    "high": float(tick.get("high", 0)),
                    "low": float(tick.get("low", 0)),
                    "volume": int(tick.get("volume", 0)),
                    "amount": float(tick.get("amount", 0)),
                    "update_time": datetime.now().isoformat(timespec="seconds"),
                }
            return {"symbol": symbol, "error": "无数据"}
        except Exception as e:
            from app.core.exceptions import XtdataError
            raise XtdataError(f"获取 {symbol} 行情失败: {e}")

    async def get_market_snapshots(self, symbols: list[str]) -> list[dict[str, Any]]:
        return [await self.get_market_snapshot(s) for s in symbols]

    async def get_instrument_info(self, symbol: str) -> dict[str, Any]:
        self._require()
        try:
            detail = self._mod.get_instrument_detail(symbol)
            if detail:
                return {
                    "symbol": symbol,
                    "name": detail.get("InstrumentName", ""),
                    "exchange": detail.get("ExchangeID", ""),
                    "listed": True,
                }
            return {"symbol": symbol, "name": "未知标的", "listed": False}
        except Exception as e:
            from app.core.exceptions import XtdataError
            raise XtdataError(f"获取 {symbol} 标的信息失败: {e}")
