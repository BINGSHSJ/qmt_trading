"""Coverage calculation helpers for data center sync checks."""

import json
from datetime import datetime
from typing import Any


def parse_open_date(open_date: str | None) -> str | None:
    if not open_date:
        return None
    text = str(open_date).strip()
    if not text or text in {"0", "00000000", "1970-01-01"}:
        return None
    for fmt in ("%Y-%m-%d", "%Y%m%d"):
        try:
            return datetime.strptime(text, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def expected_trading_days_for_symbol(trading_days: list[str], open_date: str | None) -> list[str]:
    parsed_open_date = parse_open_date(open_date)
    if not parsed_open_date:
        return trading_days
    return [day for day in trading_days if day >= parsed_open_date]


def expected_trading_days_by_symbol(
    symbols: list[str],
    trading_days: list[str],
    open_dates: dict[str, str | None],
) -> dict[str, list[str]]:
    return {
        symbol: expected_trading_days_for_symbol(trading_days, open_dates.get(symbol))
        for symbol in symbols
    }


def build_coverage_row(
    data_type: str,
    symbol: str,
    period: str,
    start_date: str,
    end_date: str,
    expected_trading_days: int,
    actual_trading_days: int,
    expected_rows: int | None,
    actual_rows: int,
    missing_days: list[str],
    duplicate_rows: int,
    checked_at: str,
) -> dict[str, Any]:
    expected_base = expected_rows if expected_rows not in {None, 0} else expected_trading_days
    if expected_rows == 0:
        coverage_rate = 100.0
        complete = True
    elif expected_rows not in {None, 0}:
        coverage_rate = round(min(actual_rows / expected_base, 1) * 100, 2)
        complete = actual_rows >= int(expected_base)
    elif expected_trading_days:
        coverage_rate = round(min(actual_trading_days / expected_trading_days, 1) * 100, 2)
        complete = actual_trading_days >= expected_trading_days
    else:
        coverage_rate = 100.0 if actual_rows > 0 else 0.0
        complete = actual_rows > 0
    status = "complete" if complete and duplicate_rows == 0 else "partial" if actual_rows > 0 else "missing"
    if duplicate_rows > 0:
        status = "failed"
    return {
        "data_type": data_type,
        "symbol": symbol,
        "period": period,
        "start_date": start_date,
        "end_date": end_date,
        "expected_trading_days": expected_trading_days,
        "actual_trading_days": actual_trading_days,
        "expected_rows": expected_rows,
        "actual_rows": actual_rows,
        "missing_days": json.dumps(missing_days, ensure_ascii=False),
        "duplicate_rows": duplicate_rows,
        "coverage_rate": coverage_rate,
        "status": status,
        "checked_at": checked_at,
    }


def has_symbol_day_coverage(expected_days: list[str], symbol_stats: dict[str, object]) -> bool:
    if not expected_days:
        return True
    actual_days = symbol_stats.get("days", set())
    if not isinstance(actual_days, set):
        actual_days = set(actual_days or [])
    return set(expected_days).issubset(actual_days)


def merge_minute_rows_into_coverage(coverage: dict[str, dict[str, object]], rows: list[dict[str, object]]) -> None:
    for row in rows:
        symbol = str(row.get("symbol") or "")
        trade_datetime = str(row.get("datetime") or "")
        if symbol not in coverage or len(trade_datetime) < 10:
            continue
        coverage[symbol]["rows"] = int(coverage[symbol].get("rows") or 0) + 1
        days = coverage[symbol].get("days", set())
        if not isinstance(days, set):
            days = set(days or [])
        days.add(trade_datetime[:10])
        coverage[symbol]["days"] = days
