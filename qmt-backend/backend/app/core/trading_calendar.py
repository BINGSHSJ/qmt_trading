"""
交易日历 / 交易时段判断

使用 config.yaml trading_calendar 配置的时段。
包含 A 股法定节假日（2025-2026），周末及节假日视为非交易日。
"""

from __future__ import annotations

from datetime import datetime, date, time

from app.core.config import yaml_get


def _parse_time(s: str) -> time:
    parts = s.strip().split(":")
    return time(int(parts[0]), int(parts[1]))


# ── A 股法定节假日（非交易日，不含周末）─────────────
# 来源：中国证监会公布的休市安排
# 如需更新，追加/修改此集合即可
_CN_HOLIDAYS: set[date] = {
    # ── 2025 ──
    date(2025, 1, 1),                                           # 元旦
    date(2025, 1, 28), date(2025, 1, 29), date(2025, 1, 30),   # 春节
    date(2025, 1, 31), date(2025, 2, 1), date(2025, 2, 2),
    date(2025, 2, 3), date(2025, 2, 4),
    date(2025, 4, 4),                                           # 清明
    date(2025, 5, 1), date(2025, 5, 2), date(2025, 5, 5),      # 劳动节
    date(2025, 5, 31), date(2025, 6, 1), date(2025, 6, 2),     # 端午节
    date(2025, 10, 1), date(2025, 10, 2), date(2025, 10, 3),   # 国庆节
    date(2025, 10, 6), date(2025, 10, 7), date(2025, 10, 8),
    # ── 2026 ──
    date(2026, 1, 1), date(2026, 1, 2),                        # 元旦
    date(2026, 2, 16), date(2026, 2, 17), date(2026, 2, 18),   # 春节
    date(2026, 2, 19), date(2026, 2, 20), date(2026, 2, 23),
    date(2026, 2, 24),
    date(2026, 4, 5), date(2026, 4, 6),                        # 清明
    date(2026, 5, 1), date(2026, 5, 4), date(2026, 5, 5),      # 劳动节
    date(2026, 6, 19),                                          # 端午节
    date(2026, 10, 1), date(2026, 10, 2), date(2026, 10, 5),   # 国庆节
    date(2026, 10, 6), date(2026, 10, 7), date(2026, 10, 8),
    date(2026, 10, 9),
}


def is_trading_day(dt: datetime | None = None) -> bool:
    """判断是否为交易日（排除周末 + A 股法定节假日）"""
    dt = dt or datetime.now()
    if dt.weekday() >= 5:
        return False
    return dt.date() not in _CN_HOLIDAYS


def is_trading_time(dt: datetime | None = None) -> bool:
    """判断当前时间是否在交易时段内"""
    dt = dt or datetime.now()
    if not is_trading_day(dt):
        return False

    now_t = dt.time()
    ms = _parse_time(yaml_get("trading_calendar", "morning_start", default="09:30"))
    me = _parse_time(yaml_get("trading_calendar", "morning_end", default="11:30"))
    a_s = _parse_time(yaml_get("trading_calendar", "afternoon_start", default="13:00"))
    ae = _parse_time(yaml_get("trading_calendar", "afternoon_end", default="15:00"))

    return (ms <= now_t <= me) or (a_s <= now_t <= ae)


def get_trading_session_info(dt: datetime | None = None) -> dict:
    """返回当前交易日历状态摘要"""
    dt = dt or datetime.now()
    return {
        "is_trading_day": is_trading_day(dt),
        "is_trading_time": is_trading_time(dt),
        "current_time": dt.strftime("%H:%M:%S"),
        "weekday": dt.strftime("%A"),
    }
