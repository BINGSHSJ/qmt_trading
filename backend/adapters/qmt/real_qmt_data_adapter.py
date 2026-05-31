from datetime import datetime, timedelta
import math
from random import randint
from typing import Callable

from backend.adapters.qmt.order_status_mapper import map_order_status
from backend.adapters.qmt.qmt_import_path import ensure_xtquant_import_path, find_xtquant_spec
from backend.core.exceptions import QmtConnectionError
from backend.repositories.system.system_repository import now_text


class RealQmtReadOnlyDataAdapter:
    """Real QMT read-only adapter.

    This adapter only queries account, position, order, trade and basic quote
    data. It never submits or cancels an order.
    """

    def __init__(self, qmt_path: str, account_id: str) -> None:
        self.qmt_path = qmt_path
        self.account_id = account_id.strip()
        ensure_xtquant_import_path(qmt_path)

    def check_environment(self) -> dict[str, object]:
        spec = find_xtquant_spec(self.qmt_path)
        return {
            "mode": "real",
            "connected": spec is not None and bool(self.account_id),
            "message": "真实 QMT 只读适配器可用。" if spec else "未检测到 xtquant，无法使用真实 QMT。",
        }

    def get_account(self) -> dict[str, object]:
        def query(trader: object, account: object) -> dict[str, object]:
            asset = trader.query_stock_asset(account)
            if asset is None:
                raise RuntimeError("query_stock_asset returned None")
            return {
                "account_id": self._row_account_id(asset),
                "total_asset": getattr(asset, "total_asset", 0),
                "available_cash": getattr(asset, "cash", 0),
                "frozen_cash": getattr(asset, "frozen_cash", 0),
                "market_value": getattr(asset, "market_value", 0),
                "today_pnl": 0,
            }

        return self._with_trader(query)

    def get_positions(self) -> list[dict[str, object]]:
        def query(trader: object, account: object) -> list[dict[str, object]]:
            rows = trader.query_stock_positions(account) or []
            result: list[dict[str, object]] = []
            for row in rows:
                symbol = getattr(row, "stock_code", "")
                quantity = self._to_int(getattr(row, "volume", 0))
                market_value = self._to_float(getattr(row, "market_value", 0), 2)
                tick_price = self._last_price(symbol)
                inferred_price = round(market_value / quantity, 4) if quantity and market_value and not tick_price else tick_price
                result.append({
                    "account_id": self._row_account_id(row),
                    "symbol": symbol,
                    "name": self._stock_name(symbol),
                    "quantity": quantity,
                    "available_quantity": getattr(row, "can_use_volume", 0),
                    "cost_price": getattr(row, "open_price", 0),
                    "last_price": inferred_price,
                })
            return result

        return self._with_trader(query)

    def get_orders(self) -> list[dict[str, object]]:
        def query(trader: object, account: object) -> list[dict[str, object]]:
            rows = trader.query_stock_orders(account, False) or []
            return [self._order_row(row, index) for index, row in enumerate(rows)]

        return self._with_trader(query)

    def get_trades(self) -> list[dict[str, object]]:
        def query(trader: object, account: object) -> list[dict[str, object]]:
            rows = trader.query_stock_trades(account) or []
            return [self._trade_row(row, index) for index, row in enumerate(rows)]

        return self._with_trader(query)

    def get_stock_basic(self) -> list[dict[str, object]]:
        from xtquant import xtdata

        symbols = xtdata.get_stock_list_in_sector("沪深A股") or []
        result: list[dict[str, object]] = []
        for symbol in symbols:
            result.append(
                {
                    "symbol": symbol,
                    "name": symbol,
                    "market": symbol.split(".")[-1] if "." in symbol else "",
                    "security_type": "股票",
                    "list_status": "上市",
                    "is_st": 0,
                }
            )
        return result

    def get_instrument_details(self, symbols: list[str]) -> list[dict[str, object]]:
        result: list[dict[str, object]] = []
        for symbol in symbols:
            detail = self._instrument_detail(symbol, complete=True)
            result.append({
                "symbol": symbol,
                "exchange_id": detail.get("ExchangeID") or detail.get("exchange_id") or symbol.split(".")[-1],
                "instrument_id": detail.get("InstrumentID") or detail.get("instrument_id") or symbol.split(".")[0],
                "instrument_name": detail.get("InstrumentName") or detail.get("instrument_name") or symbol,
                "exchange_code": detail.get("ExchangeCode") or detail.get("exchange_code") or symbol.split(".")[-1],
                "open_date": detail.get("OpenDate") or detail.get("open_date") or "",
                "expire_date": detail.get("ExpireDate") or detail.get("expire_date") or "",
                "pre_close": detail.get("PreClose") or detail.get("PreClosePrice") or detail.get("pre_close") or 0,
                "up_stop_price": detail.get("UpStopPrice") or detail.get("UpperLimitPrice") or detail.get("up_stop_price") or 0,
                "down_stop_price": detail.get("DownStopPrice") or detail.get("LowerLimitPrice") or detail.get("down_stop_price") or 0,
                "is_trading": detail.get("IsTrading", detail.get("is_trading", True)),
                "instrument_status": detail.get("InstrumentStatus") or detail.get("instrument_status") or "",
                "total_volume": detail.get("TotalVolume") or detail.get("total_volume") or 0,
                "float_volume": detail.get("FloatVolume") or detail.get("float_volume") or 0,
                "trading_day": detail.get("TradingDay") or detail.get("trading_day") or "",
                "raw": detail,
            })
        return result

    def get_trading_calendar(self, market: str, start_date: str, end_date: str) -> list[dict[str, object]]:
        try:
            from xtquant import xtdata

            start = self._compact_date(start_date)
            end = self._compact_date(end_date)
            try:
                dates = xtdata.get_trading_calendar(market, start, end)
            except TypeError:
                dates = xtdata.get_trading_dates(market, start, end, -1)
            rows = []
            for value in dates or []:
                rows.append({
                    "market": market,
                    "trade_date": self._calendar_date(value),
                    "is_trading_day": True,
                    "source": "qmt",
                })
            return rows
        except Exception as exc:
            raise QmtConnectionError(
                message="真实 QMT 交易日历只读同步失败。",
                code="REAL_QMT_CALENDAR_READONLY_FAILED",
                detail=repr(exc),
                suggestion="请确认 MiniQMT 已登录、xtdata 可用，并先用较短日期范围重试。",
            ) from exc

    def get_daily_kline(self, symbols: list[str], start_date: str, end_date: str) -> list[dict[str, object]]:
        period = "1d"
        start = self._compact_date(start_date)
        end = self._compact_date(end_date)
        warmup_start = self._warmup_start(start)
        data = self._market_data(
            symbols,
            period,
            warmup_start,
            end,
            fields=["time", "open", "high", "low", "close", "volume", "amount", "preClose", "suspendFlag"],
        )
        rows = self._daily_rows_with_suspend_fill(data, start)
        self._append_latest_suspended_ticks(rows, symbols, start, end)
        return rows

    def get_minute_kline(self, symbols: list[str], start_time: str, end_time: str, period: str = "1m") -> list[dict[str, object]]:
        qmt_period = period or "1m"
        start = self._compact_datetime(start_time)
        end = self._compact_datetime(end_time)
        data = self._market_data(symbols, qmt_period, start, end)
        return [
            {
                "symbol": symbol,
                "datetime": self._minute_datetime(index_value, row.get("time")),
                "period": qmt_period,
                "open": self._to_float(row.get("open")),
                "high": self._to_float(row.get("high")),
                "low": self._to_float(row.get("low")),
                "close": self._to_float(row.get("close")),
                "pre_close": self._to_float(row.get("preClose") or row.get("pre_close")),
                "volume": self._to_float(row.get("volume"), 2),
                "amount": self._to_float(row.get("amount"), 2),
                "suspend_flag": self._to_int(row.get("suspendFlag") or row.get("suspend_flag")),
            }
            for symbol, index_value, row in self._iter_market_rows(data)
        ]

    def _market_data(self, symbols: list[str], period: str, start: str, end: str, fields: list[str] | None = None) -> dict[str, object]:
        try:
            from xtquant import xtdata

            field_list = fields or ["time", "open", "high", "low", "close", "volume", "amount"]
            download_batch = getattr(xtdata, "download_history_data2", None)
            if callable(download_batch):
                download_batch(symbols, period, start, end)
            else:
                for symbol in symbols:
                    xtdata.download_history_data(symbol, period, start, end)
            data = xtdata.get_market_data_ex(field_list, symbols, period=period, start_time=start, end_time=end, count=-1, dividend_type="none", fill_data=True)
            return data if isinstance(data, dict) else {}
        except Exception as exc:
            raise QmtConnectionError(
                message="真实 QMT 行情 K 线只读同步失败。",
                code="REAL_QMT_KLINE_READONLY_FAILED",
                detail=repr(exc),
                suggestion="请确认 MiniQMT 已登录、行情数据权限正常，并保持小范围股票和时间区间同步。",
            ) from exc

    def _daily_rows_with_suspend_fill(self, data: dict[str, object], requested_start: str) -> list[dict[str, object]]:
        rows: list[dict[str, object]] = []
        for symbol, frame in data.items():
            iterrows = getattr(frame, "iterrows", None)
            if not callable(iterrows):
                continue
            last_close: float | None = None
            symbol_rows = sorted(iterrows(), key=lambda item: str(item[0]))
            for index_value, row in symbol_rows:
                trade_date = self._daily_date(index_value, row.get("time"))
                compact_trade_date = self._compact_date(trade_date)
                open_price = self._finite_float(row.get("open"))
                high_price = self._finite_float(row.get("high"))
                low_price = self._finite_float(row.get("low"))
                close_price = self._finite_float(row.get("close"))
                pre_close = self._finite_float(row.get("preClose") or row.get("pre_close"))
                suspend_flag = self._to_int(row.get("suspendFlag") or row.get("suspend_flag"))
                valid_ohlc = all(value is not None and value > 0 for value in (open_price, high_price, low_price, close_price))
                if valid_ohlc:
                    resolved_open = float(open_price)
                    resolved_high = float(high_price)
                    resolved_low = float(low_price)
                    resolved_close = float(close_price)
                    last_close = resolved_close
                else:
                    fallback = pre_close if pre_close and pre_close > 0 else last_close
                    if suspend_flag and fallback and fallback > 0:
                        resolved_open = resolved_high = resolved_low = resolved_close = round(float(fallback), 4)
                    else:
                        continue
                if compact_trade_date < requested_start:
                    continue
                rows.append(
                    {
                        "symbol": symbol,
                        "trade_date": trade_date,
                        "open": resolved_open,
                        "high": resolved_high,
                        "low": resolved_low,
                        "close": resolved_close,
                        "pre_close": round(float(pre_close or last_close or resolved_close), 4),
                        "volume": self._to_float(row.get("volume"), 2) if not suspend_flag else 0.0,
                        "amount": self._to_float(row.get("amount"), 2) if not suspend_flag else 0.0,
                        "suspend_flag": suspend_flag,
                    }
                )
        return rows

    def _append_latest_suspended_ticks(self, rows: list[dict[str, object]], symbols: list[str], start: str, end: str) -> None:
        existing = {(str(row.get("symbol")), self._compact_date(str(row.get("trade_date")))) for row in rows}
        try:
            from xtquant import xtdata

            ticks = xtdata.get_full_tick(symbols) or {}
        except Exception:
            return
        for symbol in symbols:
            tick = ticks.get(symbol, {}) if isinstance(ticks, dict) else {}
            if not isinstance(tick, dict):
                continue
            tick_date = self._tick_date(tick)
            if tick_date != end or tick_date < start or (symbol, tick_date) in existing:
                continue
            price = self._finite_float(tick.get("lastPrice") or tick.get("last_price") or tick.get("price"))
            last_close = self._finite_float(tick.get("lastClose") or tick.get("last_close") or tick.get("preClose"))
            volume = self._to_float(tick.get("volume"), 2)
            open_price = self._finite_float(tick.get("open"))
            fallback = price if price and price > 0 else last_close
            if not fallback or fallback <= 0:
                continue
            if volume > 0 or (open_price and open_price > 0):
                continue
            rows.append(
                {
                    "symbol": symbol,
                    "trade_date": self._daily_date(tick_date, tick.get("time")),
                    "open": round(float(fallback), 4),
                    "high": round(float(fallback), 4),
                    "low": round(float(fallback), 4),
                    "close": round(float(fallback), 4),
                    "pre_close": round(float(last_close or fallback), 4),
                    "volume": 0.0,
                    "amount": 0.0,
                    "suspend_flag": 1,
                }
            )
            existing.add((symbol, tick_date))

    def _iter_market_rows(self, data: dict[str, object]):
        for symbol, frame in data.items():
            iterrows = getattr(frame, "iterrows", None)
            if not callable(iterrows):
                continue
            for index_value, row in iterrows():
                yield symbol, index_value, row

    def _compact_date(self, value: str) -> str:
        raw = str(value or "").strip()
        for fmt in ("%Y-%m-%d", "%Y%m%d", "%Y/%m/%d"):
            try:
                return datetime.strptime(raw, fmt).strftime("%Y%m%d")
            except ValueError:
                continue
        return raw.replace("-", "").replace("/", "")[:8]

    def _compact_datetime(self, value: str) -> str:
        raw = str(value or "").strip()
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y%m%d%H%M%S"):
            try:
                return datetime.strptime(raw, fmt).strftime("%Y%m%d%H%M%S")
            except ValueError:
                continue
        return raw.replace("-", "").replace(":", "").replace(" ", "")[:14]

    def _warmup_start(self, start: str) -> str:
        try:
            return (datetime.strptime(start[:8], "%Y%m%d") - timedelta(days=45)).strftime("%Y%m%d")
        except ValueError:
            return start

    def _tick_date(self, tick: dict[str, object]) -> str:
        timetag = str(tick.get("timetag") or tick.get("timeTag") or "").strip()
        compact = self._compact_datetime(timetag)
        if len(compact) >= 8:
            return compact[:8]
        return self._compact_date(self._format_market_time("", tick.get("time"), "%Y-%m-%d"))

    def _daily_date(self, index_value: object, time_value: object) -> str:
        return self._format_market_time(index_value, time_value, "%Y-%m-%d")

    def _minute_datetime(self, index_value: object, time_value: object) -> str:
        return self._format_market_time(index_value, time_value, "%Y-%m-%d %H:%M:%S")

    def _format_market_time(self, index_value: object, time_value: object, output_format: str) -> str:
        if hasattr(index_value, "strftime"):
            return index_value.strftime(output_format)
        raw = str(index_value or "").strip()
        digits = "".join(ch for ch in raw if ch.isdigit())
        if len(digits) >= 14:
            return datetime.strptime(digits[:14], "%Y%m%d%H%M%S").strftime(output_format)
        if len(digits) >= 8:
            date_part = datetime.strptime(digits[:8], "%Y%m%d")
            if output_format == "%Y-%m-%d":
                return date_part.strftime(output_format)
            return date_part.strftime("%Y-%m-%d 00:00:00")
        try:
            timestamp = int(float(time_value or 0))
            if timestamp > 10_000_000_000:
                timestamp = timestamp // 1000
            return datetime.fromtimestamp(timestamp).strftime(output_format)
        except (TypeError, ValueError, OSError):
            return raw

    def _calendar_date(self, value: object) -> str:
        if hasattr(value, "strftime"):
            return value.strftime("%Y-%m-%d")
        raw = str(value or "").strip()
        digits = "".join(ch for ch in raw if ch.isdigit())
        if len(digits) >= 8:
            return datetime.strptime(digits[:8], "%Y%m%d").strftime("%Y-%m-%d")
        return raw[:10]

    def _with_trader(self, query: Callable[[object, object], object]):
        from xtquant.xttrader import XtQuantTrader
        from xtquant.xttype import StockAccount

        if not self.account_id:
            raise QmtConnectionError(
                message="真实 QMT 账户 ID 未配置。",
                code="REAL_QMT_ACCOUNT_REQUIRED",
                detail="account_id is empty",
                suggestion="请在系统管理填写真实 QMT 账户 ID。",
            )
        trader = XtQuantTrader(self._userdata_path(), randint(100000, 999999))
        try:
            trader.start()
            connect_result = trader.connect()
            if connect_result != 0:
                raise RuntimeError(f"connect_result={connect_result}")
            account = StockAccount(self.account_id)
            subscribe_result = trader.subscribe(account)
            if subscribe_result != 0:
                raise RuntimeError(f"subscribe_result={subscribe_result}")
            return query(trader, account)
        except Exception as exc:
            if isinstance(exc, QmtConnectionError):
                raise
            raise QmtConnectionError(
                message="真实 QMT 只读查询失败。",
                code="REAL_QMT_READONLY_FAILED",
                detail=repr(exc),
                suggestion="请确认 MiniQMT 已启动、账户已登录，并检查 QMT 路径和账户 ID。",
            ) from exc
        finally:
            stop = getattr(trader, "stop", None)
            if callable(stop):
                try:
                    stop()
                except Exception:
                    pass

    def _userdata_path(self) -> str:
        from pathlib import Path

        root = Path(self.qmt_path).expanduser()
        for name in ("userdata_mini", "userdata"):
            candidate = root / name
            if candidate.exists():
                return str(candidate)
        return str(root)

    def _row_account_id(self, row: object) -> str:
        return str(getattr(row, "account_id", "") or self.account_id).strip()

    def _instrument_detail(self, symbol: str, complete: bool = False) -> dict[str, object]:
        try:
            from xtquant import xtdata

            try:
                return xtdata.get_instrument_detail(symbol, iscomplete=complete) or {}
            except TypeError:
                return xtdata.get_instrument_detail(symbol) or {}
        except Exception:
            return {}

    def _stock_name(self, symbol: str) -> str:
        return str(self._instrument_detail(symbol).get("InstrumentName") or symbol)

    def _last_price(self, symbol: str) -> float:
        try:
            from xtquant import xtdata

            tick = xtdata.get_full_tick([symbol])
            row = tick.get(symbol, {}) if isinstance(tick, dict) else {}
            return float(row.get("lastPrice") or row.get("last_price") or row.get("price") or 0)
        except Exception:
            return 0.0

    def _order_row(self, row: object, index: int) -> dict[str, object]:
        qmt_order_id = str(self._first_attr(row, ["order_id", "order_sysid", "entrust_no", "m_strOrderID"], f"real_order_{index}"))
        symbol = str(self._first_attr(row, ["stock_code", "m_strStockCode"], ""))
        qmt_status = str(self._first_attr(row, ["order_status", "status", "m_nOrderStatus"], "unknown"))
        price = self._to_float(self._first_attr(row, ["order_price", "price", "m_dOrderPrice"], 0))
        quantity = self._to_int(self._first_attr(row, ["order_volume", "volume", "m_nOrderVolume"], 0))
        filled = self._to_int(self._first_attr(row, ["traded_volume", "filled_volume", "m_nTradedVolume"], 0))
        return {
            "local_order_id": f"qmt_{qmt_order_id}",
            "qmt_order_id": qmt_order_id,
            "account_id": self.account_id,
            "symbol": symbol,
            "name": self._stock_name(symbol),
            "side": self._side(self._first_attr(row, ["order_type", "direction", "m_nOrderType"], "")),
            "price": price,
            "quantity": quantity,
            "filled_quantity": filled,
            "status": map_order_status(qmt_status),
            "qmt_status": qmt_status,
            "source": "real_sync",
        }

    def _trade_row(self, row: object, index: int) -> dict[str, object]:
        trade_id = str(self._first_attr(row, ["traded_id", "trade_id", "m_strTradedID"], f"real_trade_{index}"))
        qmt_order_id = str(self._first_attr(row, ["order_id", "order_sysid", "entrust_no", "m_strOrderID"], ""))
        symbol = str(self._first_attr(row, ["stock_code", "m_strStockCode"], ""))
        price = self._to_float(self._first_attr(row, ["traded_price", "price", "m_dTradedPrice"], 0))
        quantity = self._to_int(self._first_attr(row, ["traded_volume", "volume", "m_nTradedVolume"], 0))
        return {
            "trade_id": trade_id,
            "local_order_id": f"qmt_{qmt_order_id}" if qmt_order_id else f"qmt_trade_{trade_id}",
            "qmt_order_id": qmt_order_id or None,
            "account_id": self.account_id,
            "symbol": symbol,
            "name": self._stock_name(symbol),
            "side": self._side(self._first_attr(row, ["order_type", "direction", "m_nOrderType"], "")),
            "price": price,
            "quantity": quantity,
            "amount": round(price * quantity, 2),
            "fee": self._to_float(self._first_attr(row, ["fee", "m_dFee"], 0), 2),
            "source": "real_sync",
            "trade_time": now_text(),
        }

    def _side(self, value: object) -> str:
        raw = str(value).strip().upper()
        if raw in {"BUY", "23", "48", "1"}:
            return "BUY"
        if raw in {"SELL", "24", "49", "2"}:
            return "SELL"
        return "BUY" if "BUY" in raw or "买" in raw else "SELL" if "SELL" in raw or "卖" in raw else raw

    def _first_attr(self, row: object, names: list[str], default: object = None) -> object:
        for name in names:
            if hasattr(row, name):
                value = getattr(row, name)
                if value not in {None, ""}:
                    return value
        return default

    def _to_float(self, value: object, digits: int = 4) -> float:
        try:
            number = float(value or 0)
            if not math.isfinite(number):
                return 0.0
            return round(number, digits)
        except (TypeError, ValueError):
            return 0.0

    def _finite_float(self, value: object, digits: int = 4) -> float | None:
        try:
            number = float(value)
            if not math.isfinite(number):
                return None
            return round(number, digits)
        except (TypeError, ValueError):
            return None

    def _to_int(self, value: object) -> int:
        try:
            return int(float(value or 0))
        except (TypeError, ValueError):
            return 0
