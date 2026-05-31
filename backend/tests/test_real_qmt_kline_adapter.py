import sys
import types

from backend.adapters.qmt.real_qmt_data_adapter import RealQmtReadOnlyDataAdapter


class FakeFrame:
    def __init__(self, rows):
        self.rows = rows

    def iterrows(self):
        return iter(self.rows)


def install_fake_xtdata(monkeypatch, calls):
    xtquant = types.ModuleType("xtquant")

    def download_history_data(symbol, period, start, end):
        calls.append(("download", symbol, period, start, end))

    def download_history_data2(symbols, period, start, end):
        calls.append(("download2", tuple(symbols), period, start, end))

    def get_market_data_ex(fields, symbols, period, start_time, end_time, count, dividend_type, fill_data):
        calls.append(("market", tuple(fields), tuple(symbols), period, start_time, end_time, count, dividend_type, fill_data))
        if period == "1d":
            return {
                "600000.SH": FakeFrame([
                    ("20260506", {"time": 1777996800000, "open": 9.1, "high": 9.2, "low": 9.0, "close": 9.18, "volume": 1000, "amount": 9180}),
                ])
            }
        return {
            "600000.SH": FakeFrame([
                ("20260508093000", {"time": 1778203800000, "open": 9.08, "high": 9.1, "low": 9.08, "close": 9.09, "volume": 100, "amount": 909}),
            ])
        }

    xtdata = types.SimpleNamespace(download_history_data=download_history_data, download_history_data2=download_history_data2, get_market_data_ex=get_market_data_ex)
    xtquant.xtdata = xtdata
    monkeypatch.setitem(sys.modules, "xtquant", xtquant)


def test_real_qmt_daily_kline_is_readonly_and_normalized(monkeypatch):
    calls = []
    install_fake_xtdata(monkeypatch, calls)
    adapter = RealQmtReadOnlyDataAdapter("", "real_account")

    rows = adapter.get_daily_kline(["600000.SH"], "2026-05-06", "2026-05-08")

    assert rows == [
        {
            "symbol": "600000.SH",
            "trade_date": "2026-05-06",
            "open": 9.1,
            "high": 9.2,
            "low": 9.0,
            "close": 9.18,
            "pre_close": 9.18,
            "volume": 1000.0,
            "amount": 9180.0,
            "suspend_flag": 0,
        }
    ]
    assert ("download2", ("600000.SH",), "1d", "20260322", "20260508") in calls
    assert any(call[0] == "market" and call[3] == "1d" for call in calls)


def test_real_qmt_minute_kline_is_small_range_readonly(monkeypatch):
    calls = []
    install_fake_xtdata(monkeypatch, calls)
    adapter = RealQmtReadOnlyDataAdapter("", "real_account")

    rows = adapter.get_minute_kline(["600000.SH"], "2026-05-08 09:30:00", "2026-05-08 10:00:00", "1m")

    assert rows[0]["symbol"] == "600000.SH"
    assert rows[0]["datetime"] == "2026-05-08 09:30:00"
    assert rows[0]["period"] == "1m"
    assert rows[0]["close"] == 9.09
    assert ("download2", ("600000.SH",), "1m", "20260508093000", "20260508100000") in calls
    assert any(call[0] == "market" and call[3] == "1m" for call in calls)


def test_real_qmt_daily_kline_fills_suspended_day_from_warmup(monkeypatch):
    calls = []
    xtquant = types.ModuleType("xtquant")

    def download_history_data2(symbols, period, start, end):
        calls.append(("download2", tuple(symbols), period, start, end))

    def get_market_data_ex(fields, symbols, period, start_time, end_time, count, dividend_type, fill_data):
        del fields, symbols, period, start_time, end_time, count, dividend_type, fill_data
        return {
            "002049.SZ": FakeFrame([
                ("20251231", {"time": 1767110400000, "open": 70.1, "high": 71.0, "low": 69.8, "close": 70.5, "volume": 1000, "amount": 70500, "preClose": 70.0, "suspendFlag": 0}),
                ("20260105", {"time": 1767542400000, "open": float("nan"), "high": float("nan"), "low": float("nan"), "close": float("nan"), "volume": 0, "amount": 0, "preClose": float("nan"), "suspendFlag": 1}),
            ])
        }

    xtdata = types.SimpleNamespace(download_history_data2=download_history_data2, get_market_data_ex=get_market_data_ex)
    xtquant.xtdata = xtdata
    monkeypatch.setitem(sys.modules, "xtquant", xtquant)
    adapter = RealQmtReadOnlyDataAdapter("", "real_account")

    rows = adapter.get_daily_kline(["002049.SZ"], "2026-01-01", "2026-01-05")

    assert rows == [
        {
            "symbol": "002049.SZ",
            "trade_date": "2026-01-05",
            "open": 70.5,
            "high": 70.5,
            "low": 70.5,
            "close": 70.5,
            "pre_close": 70.5,
            "volume": 0.0,
            "amount": 0.0,
            "suspend_flag": 1,
        }
    ]
    assert calls[0] == ("download2", ("002049.SZ",), "1d", "20251117", "20260105")


def test_real_qmt_daily_kline_uses_latest_tick_for_end_day_suspension(monkeypatch):
    xtquant = types.ModuleType("xtquant")

    def download_history_data2(symbols, period, start, end):
        del symbols, period, start, end

    def get_market_data_ex(fields, symbols, period, start_time, end_time, count, dividend_type, fill_data):
        del fields, symbols, period, start_time, end_time, count, dividend_type, fill_data
        return {
            "601010.SH": FakeFrame([
                ("20260507", {"time": 1778083200000, "open": 2.0, "high": 2.0, "low": 2.0, "close": 2.0, "volume": 17516, "amount": 3503200, "preClose": 2.1, "suspendFlag": 0}),
            ])
        }

    def get_full_tick(symbols):
        assert symbols == ["601010.SH"]
        return {
            "601010.SH": {
                "time": 1778223605000,
                "timetag": "20260508 15:00:05",
                "lastPrice": 2.0,
                "lastClose": 2.0,
                "open": 0,
                "volume": 0,
                "stockStatus": 5,
            }
        }

    xtdata = types.SimpleNamespace(download_history_data2=download_history_data2, get_market_data_ex=get_market_data_ex, get_full_tick=get_full_tick)
    xtquant.xtdata = xtdata
    monkeypatch.setitem(sys.modules, "xtquant", xtquant)
    adapter = RealQmtReadOnlyDataAdapter("", "real_account")

    rows = adapter.get_daily_kline(["601010.SH"], "2026-05-07", "2026-05-08")

    assert rows[-1] == {
        "symbol": "601010.SH",
        "trade_date": "2026-05-08",
        "open": 2.0,
        "high": 2.0,
        "low": 2.0,
        "close": 2.0,
        "pre_close": 2.0,
        "volume": 0.0,
        "amount": 0.0,
        "suspend_flag": 1,
    }
