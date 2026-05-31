from datetime import datetime, timedelta


class TestIsolationQmtDataAdapter:
    """测试隔离数据替身，仅用于自动化测试、离线回归和开发排障。"""

    def check_environment(self) -> dict[str, object]:
        return {
            "mode": "test_isolation",
            "connected": True,
            "message": "当前为测试隔离数据源，仅用于自动化测试、离线回归和开发排障，不连接真实 QMT。",
        }

    def get_account(self) -> dict[str, object]:
        return {
            "account_id": "test_isolation_account",
            "total_asset": 1086500.25,
            "available_cash": 386500.25,
            "frozen_cash": 0,
            "market_value": 700000,
            "today_pnl": 3200.5,
        }

    def get_positions(self) -> list[dict[str, object]]:
        return [
            {
                "account_id": "test_isolation_account",
                "symbol": "600000.SH",
                "name": "浦发银行",
                "quantity": 10000,
                "available_quantity": 10000,
                "cost_price": 8.8,
                "last_price": 9.12,
            },
            {
                "account_id": "test_isolation_account",
                "symbol": "000001.SZ",
                "name": "平安银行",
                "quantity": 6000,
                "available_quantity": 6000,
                "cost_price": 11.2,
                "last_price": 11.08,
            },
        ]

    def get_orders(self) -> list[dict[str, object]]:
        return [
            {
                "local_order_id": "test_order_001",
                "qmt_order_id": "qmt_test_001",
                "account_id": "test_isolation_account",
                "symbol": "600000.SH",
                "name": "浦发银行",
                "side": "BUY",
                "price": 9.1,
                "quantity": 1000,
                "filled_quantity": 1000,
                "status": "全部成交",
                "qmt_status": "filled",
                "source": "test_sync",
            }
        ]

    def get_trades(self) -> list[dict[str, object]]:
        return [
            {
                "trade_id": "test_trade_001",
                "local_order_id": "test_order_001",
                "qmt_order_id": "qmt_test_001",
                "account_id": "test_isolation_account",
                "symbol": "600000.SH",
                "name": "浦发银行",
                "side": "BUY",
                "price": 9.1,
                "quantity": 1000,
                "amount": 9100,
                "fee": 5,
                "source": "test_sync",
            }
        ]

    def get_stock_basic(self) -> list[dict[str, object]]:
        return [
            {"symbol": "600000.SH", "name": "浦发银行", "market": "SH", "security_type": "股票", "list_status": "上市", "is_st": 0},
            {"symbol": "000001.SZ", "name": "平安银行", "market": "SZ", "security_type": "股票", "list_status": "上市", "is_st": 0},
            {"symbol": "510300.SH", "name": "沪深300ETF", "market": "SH", "security_type": "ETF", "list_status": "上市", "is_st": 0},
        ]

    def get_instrument_details(self, symbols: list[str]) -> list[dict[str, object]]:
        details = {
            "600000.SH": ("SH", "浦发银行", 9.12, 10.03, 8.21, 29352080000, 29352080000),
            "000001.SZ": ("SZ", "平安银行", 11.08, 12.19, 9.97, 19405918198, 19405754750),
            "510300.SH": ("SH", "沪深300ETF", 3.85, 4.24, 3.47, 24000000000, 24000000000),
        }
        rows: list[dict[str, object]] = []
        for symbol in symbols or [item["symbol"] for item in self.get_stock_basic()]:
            market, name, pre_close, up_stop, down_stop, total_volume, float_volume = details.get(
                str(symbol),
                (str(symbol).split(".")[-1] if "." in str(symbol) else "", str(symbol), 10.0, 11.0, 9.0, 0, 0),
            )
            rows.append({
                "symbol": symbol,
                "exchange_id": market,
                "instrument_id": str(symbol).split(".")[0],
                "instrument_name": name,
                "exchange_code": market,
                "open_date": "1999-11-10",
                "expire_date": "",
                "pre_close": pre_close,
                "up_stop_price": up_stop,
                "down_stop_price": down_stop,
                "is_trading": True,
                "instrument_status": "正常",
                "total_volume": total_volume,
                "float_volume": float_volume,
                "trading_day": "2026-05-08",
                "raw": {"test_isolation": True, "source": "TestIsolationDataAdapter"},
            })
        return rows

    def get_trading_calendar(self, market: str, start_date: str, end_date: str) -> list[dict[str, object]]:
        start = datetime.strptime(start_date, "%Y-%m-%d").date()
        end = datetime.strptime(end_date, "%Y-%m-%d").date()
        rows: list[dict[str, object]] = []
        cursor = start
        while cursor <= end:
            if cursor.weekday() < 5:
                rows.append({
                    "market": market,
                    "trade_date": cursor.strftime("%Y-%m-%d"),
                    "is_trading_day": True,
                    "source": "test_sync",
                })
            cursor += timedelta(days=1)
        return rows

    def get_daily_kline(self, symbols: list[str], start_date: str, end_date: str) -> list[dict[str, object]]:
        rows: list[dict[str, object]] = []
        for symbol in symbols:
            base = 9.0 if symbol == "600000.SH" else 11.0
            for index, trade_date in enumerate(["2026-05-06", "2026-05-07", "2026-05-08"]):
                rows.append({
                    "symbol": symbol,
                    "trade_date": trade_date,
                    "open": base + index * 0.05,
                    "high": base + index * 0.08 + 0.12,
                    "low": base + index * 0.04 - 0.08,
                    "close": base + index * 0.06 + 0.02,
                    "volume": 1000000 + index * 50000,
                    "amount": 9000000 + index * 600000,
                })
        return rows

    def get_minute_kline(self, symbols: list[str], start_time: str, end_time: str, period: str = "1m") -> list[dict[str, object]]:
        rows: list[dict[str, object]] = []
        for symbol in symbols:
            base = 9.1 if symbol == "600000.SH" else 11.1
            for index, clock in enumerate(["09:31:00", "09:32:00", "09:33:00", "09:34:00", "09:35:00"]):
                rows.append({
                    "symbol": symbol,
                    "datetime": f"2026-05-08 {clock}",
                    "period": period,
                    "open": base + index * 0.01,
                    "high": base + index * 0.01 + 0.03,
                    "low": base + index * 0.01 - 0.02,
                    "close": base + index * 0.01 + 0.01,
                    "volume": 10000 + index * 1000,
                    "amount": 91000 + index * 9500,
                })
        return rows

__all__ = ["TestIsolationQmtDataAdapter"]

