from __future__ import annotations

import json
import math
import re
from datetime import datetime
from typing import Any

from backend.core.asset_math import normalize_account_total


SYMBOL_PATTERN = re.compile(r"^\d{6}\.(SH|SZ|BJ)$")
MARKET_PREFIXES = {"SH": "SH", "SZ": "SZ", "BJ": "BJ"}
QMT_MARKETS = {"XSHG": "SH", "XSHE": "SZ", "XBJ": "BJ"}


def normalize_symbol(value: object) -> str:
    raw = str(value or "").strip().upper()
    if not raw:
        return ""
    if SYMBOL_PATTERN.match(raw):
        return raw
    if "." in raw:
        code, market = raw.split(".", 1)
        market = QMT_MARKETS.get(market, MARKET_PREFIXES.get(market, market))
        return f"{code.zfill(6)}.{market}"
    prefix = raw[:2]
    if prefix in MARKET_PREFIXES and raw[2:].isdigit():
        return f"{raw[2:].zfill(6)}.{MARKET_PREFIXES[prefix]}"
    if raw.isdigit() and len(raw) == 6:
        if raw.startswith(("6", "5", "9")):
            return f"{raw}.SH"
        if raw.startswith(("0", "1", "2", "3")):
            return f"{raw}.SZ"
        if raw.startswith(("4", "8")):
            return f"{raw}.BJ"
    return raw


def is_standard_symbol(value: object) -> bool:
    return bool(SYMBOL_PATTERN.match(str(value or "").strip().upper()))


def normalize_date(value: object) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    for fmt in ("%Y-%m-%d", "%Y%m%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(raw[:10] if fmt == "%Y-%m-%d" else raw, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return raw[:10]


def normalize_datetime(value: object) -> str:
    raw = str(value or "").strip().replace("T", " ")
    if not raw:
        return ""
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y%m%d %H:%M:%S", "%Y%m%d%H%M%S", "%Y/%m/%d %H:%M:%S"):
        try:
            return datetime.strptime(raw, fmt).strftime("%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue
    if len(raw) == 10:
        return f"{normalize_date(raw)} 00:00:00"
    return raw[:19]


def normalize_period(value: object) -> str:
    raw = str(value or "1m").strip().lower()
    aliases = {"1min": "1m", "5min": "5m", "1分钟": "1m", "5分钟": "5m"}
    return aliases.get(raw, raw)


def to_float(value: object, digits: int = 4) -> float:
    try:
        number = float(value or 0)
        if not math.isfinite(number):
            return 0.0
        return round(number, digits)
    except (TypeError, ValueError):
        return 0.0


def to_int(value: object) -> int:
    try:
        return int(float(value or 0))
    except (TypeError, ValueError):
        return 0


def _positive_or_zero(value: object, digits: int = 4) -> float:
    number = to_float(value, digits)
    return number if number > 0 else 0.0


def to_bool(value: object, default: bool = False) -> bool:
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        return value
    raw = str(value).strip().lower()
    if raw in {"1", "true", "yes", "y", "是", "正常", "trading"}:
        return True
    if raw in {"0", "false", "no", "n", "否", "停牌", "暂停"}:
        return False
    return bool(value)


def standardize_stock_basic(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for row in rows:
        symbol = normalize_symbol(row.get("symbol"))
        market = symbol.split(".")[-1] if is_standard_symbol(symbol) else str(row.get("market") or "").upper()
        result.append({
            "symbol": symbol,
            "name": str(row.get("name") or symbol),
            "market": market,
            "security_type": str(row.get("security_type") or "股票"),
            "list_status": str(row.get("list_status") or "上市"),
            "is_st": bool(row.get("is_st")),
        })
    return result


def standardize_instrument_details(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for row in rows:
        symbol = normalize_symbol(row.get("symbol"))
        if not symbol:
            continue
        raw = row.get("raw") if isinstance(row.get("raw"), dict) else row
        result.append({
            "symbol": symbol,
            "exchange_id": str(row.get("exchange_id") or row.get("ExchangeID") or symbol.split(".")[-1]),
            "instrument_id": str(row.get("instrument_id") or row.get("InstrumentID") or symbol.split(".")[0]),
            "instrument_name": str(row.get("instrument_name") or row.get("InstrumentName") or row.get("name") or symbol),
            "exchange_code": str(row.get("exchange_code") or row.get("ExchangeCode") or row.get("exchange_id") or symbol.split(".")[-1]),
            "open_date": normalize_date(row.get("open_date") or row.get("OpenDate")),
            "expire_date": normalize_date(row.get("expire_date") or row.get("ExpireDate")),
            "pre_close": to_float(row.get("pre_close") or row.get("PreClose") or row.get("PreClosePrice"), 4),
            "up_stop_price": to_float(row.get("up_stop_price") or row.get("UpStopPrice") or row.get("UpperLimitPrice"), 4),
            "down_stop_price": to_float(row.get("down_stop_price") or row.get("DownStopPrice") or row.get("LowerLimitPrice"), 4),
            "is_trading": to_bool(row.get("is_trading", row.get("IsTrading", True)), True),
            "instrument_status": str(row.get("instrument_status") or row.get("InstrumentStatus") or row.get("status") or ""),
            "total_volume": to_float(row.get("total_volume") or row.get("TotalVolume") or row.get("total_shares"), 2),
            "float_volume": to_float(row.get("float_volume") or row.get("FloatVolume") or row.get("float_shares"), 2),
            "trading_day": normalize_date(row.get("trading_day") or row.get("TradingDay")),
            "raw_json": json.dumps(raw, ensure_ascii=False, default=str),
        })
    return result


def standardize_trading_calendar(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for row in rows:
        market = str(row.get("market") or row.get("exchange") or "SH").upper()
        trade_date = normalize_date(row.get("trade_date") or row.get("date") or row.get("trading_date"))
        if not trade_date:
            continue
        result.append({
            "market": QMT_MARKETS.get(market, MARKET_PREFIXES.get(market, market)),
            "trade_date": trade_date,
            "is_trading_day": to_bool(row.get("is_trading_day", True), True),
            "source": str(row.get("source") or "qmt"),
        })
    return result


def _required_account_id(row: dict[str, Any]) -> str:
    account_id = str(
        row.get("account_id")
        or row.get("account")
        or row.get("accountId")
        or row.get("accountid")
        or row.get("fund_account")
        or row.get("fund_account_id")
        or ""
    ).strip()
    if not account_id:
        raise ValueError("账户 ID 缺失，已拒绝落库，避免真实数据混入测试隔离账户。")
    return account_id


def standardize_account(row: dict[str, Any]) -> dict[str, Any]:
    available_cash = to_float(row.get("available_cash"), 2)
    frozen_cash = to_float(row.get("frozen_cash"), 2)
    market_value = to_float(row.get("market_value"), 2)
    return {
        "account_id": _required_account_id(row),
        "total_asset": normalize_account_total(row.get("total_asset"), available_cash, frozen_cash, market_value),
        "available_cash": available_cash,
        "frozen_cash": frozen_cash,
        "market_value": market_value,
        "today_pnl": to_float(row.get("today_pnl"), 2),
    }


def standardize_positions(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for row in rows:
        result.append({
            "account_id": _required_account_id(row),
            "symbol": normalize_symbol(row.get("symbol")),
            "name": str(row.get("name") or row.get("symbol") or ""),
            "quantity": to_int(row.get("quantity")),
            "available_quantity": to_int(row.get("available_quantity")),
            "cost_price": to_float(row.get("cost_price"), 4),
            "last_price": to_float(row.get("last_price"), 4),
        })
    return result


def standardize_orders(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for row in rows:
        result.append({
            **row,
            "account_id": _required_account_id(row),
            "symbol": normalize_symbol(row.get("symbol")),
            "name": str(row.get("name") or row.get("symbol") or ""),
            "side": str(row.get("side") or "").upper(),
            "price": to_float(row.get("price"), 4),
            "quantity": to_int(row.get("quantity")),
            "filled_quantity": to_int(row.get("filled_quantity")),
        })
    return result


def standardize_trades(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for row in rows:
        price = to_float(row.get("price"), 4)
        quantity = to_int(row.get("quantity"))
        result.append({
            **row,
            "account_id": _required_account_id(row),
            "symbol": normalize_symbol(row.get("symbol")),
            "name": str(row.get("name") or row.get("symbol") or ""),
            "side": str(row.get("side") or "").upper(),
            "price": price,
            "quantity": quantity,
            "amount": to_float(row.get("amount") or price * quantity, 2),
            "fee": to_float(row.get("fee"), 2),
        })
    return result


def standardize_daily_kline(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for row in rows:
        symbol = normalize_symbol(row.get("symbol"))
        trade_date = normalize_date(row.get("trade_date"))
        open_price = to_float(row.get("open"), 4)
        high_price = to_float(row.get("high"), 4)
        low_price = to_float(row.get("low"), 4)
        close_price = to_float(row.get("close"), 4)
        pre_close = _positive_or_zero(row.get("pre_close") or row.get("preClose") or row.get("PreClose"), 4)
        suspend_flag = 1 if to_int(row.get("suspend_flag") or row.get("suspendFlag") or row.get("SuspendFlag")) else 0
        if not symbol or not trade_date or min(open_price, high_price, low_price, close_price) <= 0:
            continue
        result.append(
            {
                "symbol": symbol,
                "trade_date": trade_date,
                "open": open_price,
                "high": high_price,
                "low": low_price,
                "close": close_price,
                "pre_close": pre_close,
                "volume": to_float(row.get("volume"), 2),
                "amount": to_float(row.get("amount"), 2),
                "suspend_flag": suspend_flag,
            }
        )
    return result


def standardize_minute_kline(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for row in rows:
        symbol = normalize_symbol(row.get("symbol"))
        dt = normalize_datetime(row.get("datetime"))
        open_price = to_float(row.get("open"), 4)
        high_price = to_float(row.get("high"), 4)
        low_price = to_float(row.get("low"), 4)
        close_price = to_float(row.get("close"), 4)
        pre_close = _positive_or_zero(row.get("pre_close") or row.get("preClose") or row.get("PreClose"), 4)
        suspend_flag = 1 if to_int(row.get("suspend_flag") or row.get("suspendFlag") or row.get("SuspendFlag")) else 0
        if not symbol or not dt or min(open_price, high_price, low_price, close_price) <= 0:
            continue
        result.append(
            {
                "symbol": symbol,
                "datetime": dt,
                "period": normalize_period(row.get("period")),
                "open": open_price,
                "high": high_price,
                "low": low_price,
                "close": close_price,
                "pre_close": pre_close,
                "volume": to_float(row.get("volume"), 2),
                "amount": to_float(row.get("amount"), 2),
                "suspend_flag": suspend_flag,
            }
        )
    return result
