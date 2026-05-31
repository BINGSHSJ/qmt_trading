from datetime import datetime, timedelta

from backend.core.database import get_connection
from backend.services.strategy_dev.strategy_context import StrategyContext


def test_strategy_context_minute_bars_returns_more_than_first_page():
    start = datetime(2026, 5, 8, 9, 30)
    rows = []
    for index in range(240):
        current = start + timedelta(minutes=index)
        rows.append(
            (
                "600000.SH",
                current.strftime("%Y-%m-%d %H:%M:%S"),
                "1m",
                10.0,
                10.1,
                9.9,
                10.0,
                0,
                1000 + index,
                10000 + index,
                0,
                "2026-05-08 16:00:00",
            )
        )
    with get_connection() as connection:
        connection.executemany(
            """
            INSERT INTO minute_kline(
                symbol, datetime, period, open, high, low, close,
                pre_close, volume, amount, suspend_flag, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
        connection.commit()

    bars = StrategyContext().get_minute_bars("600000.SH", "2026-05-08 09:30:00", "2026-05-08 13:29:00")

    assert len(bars) == 240
    assert bars[0]["datetime"] == "2026-05-08 09:30:00"
    assert bars[-1]["datetime"] == "2026-05-08 13:29:00"

