import traceback
import io
import json
import multiprocessing
import queue
import re
import time
from dataclasses import dataclass
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from backend.core.exceptions import BacktestError
from backend.repositories.backtest_center.backtest_repository import BacktestRepository
from backend.repositories.data_center.data_center_repository import DataCenterRepository
from backend.schemas.backtest import BacktestTaskRecord
from backend.services.strategy_dev.sandbox_runner import (
    StrategyExecutionCancelled,
    StrategyExecutionFailed,
    StrategyExecutionTimeout,
    _safe_builtins,
)
from backend.services.system.system_service import SystemService


MINUTE_SCAN_DIAGNOSTIC_PREFIX = "分钟K扫描诊断："


@dataclass
class MarketBar:
    symbol: str
    trade_date: str
    open: float
    high: float
    low: float
    close: float
    volume: int
    amount: float
    pre_close: float = 0
    suspend_flag: int = 0
    name: str = ""
    bar_time: str | None = None


class DataLoader:
    DAILY_WARMUP_BARS = 60

    def __init__(self) -> None:
        self.repository = BacktestRepository()

    def load_daily_bars(self, task: BacktestTaskRecord, symbols: list[str]) -> dict[str, list[MarketBar]]:
        if not symbols:
            symbols = ["600000.SH"]
        rows = self.repository.list_daily_bar_rows(
            symbols,
            task.start_date,
            task.end_date,
            include_previous=task.data_frequency == "分钟K",
            warmup_bars=self.DAILY_WARMUP_BARS,
        )
        grouped: dict[str, list[MarketBar]] = {}
        for row in rows:
            grouped.setdefault(row["symbol"], []).append(MarketBar(**dict(row)))
        return grouped

    def available_symbols(self, start_date: str, end_date: str) -> list[str]:
        return self.repository.available_symbols(start_date, end_date)


class BacktestStrategyContext:
    def __init__(
        self,
        bars_by_symbol: dict[str, list[dict[str, Any]]],
        current_date: str,
        data_frequency: str = "日K",
        minute_mode: str = "minute_replay",
        progress_callback: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        self._bars_by_symbol = bars_by_symbol
        self.current_date = current_date
        self.data_frequency = data_frequency
        self.minute_mode = minute_mode
        self._progress_callback = progress_callback
        self.repository = DataCenterRepository()
        self.logs: list[str] = []

    def get_daily_bars(self, symbol: str, start_date: str | None = None, end_date: str | None = None) -> list[dict[str, Any]]:
        visible_end = self._visible_daily_end_date()
        cutoff = min(end_date or visible_end, visible_end)
        return [
            bar
            for bar in self._bars_by_symbol.get(symbol, [])
            if (start_date is None or bar["trade_date"] >= start_date) and bar["trade_date"] <= cutoff
        ]

    def get_minute_bars(self, symbol: str, start_time: str | None = None, end_time: str | None = None) -> list[dict[str, Any]]:
        start_time = self._clamp_datetime(start_time, start_of_day=True)
        end_time = self._clamp_datetime(end_time, start_of_day=False)
        if start_time[:10] != self.current_date or end_time[:10] != self.current_date:
            return []
        return self.repository.list_minute_kline_rows(symbol, start_time, end_time, "1m", limit=2000)

    def get_latest_price(self, symbol: str) -> float:
        bars = self.get_daily_bars(symbol)
        return float(bars[-1]["close"]) if bars else 0.0

    def get_stock_list(self, keyword: str | None = None, limit: int = 200) -> list[dict[str, Any]]:
        del limit
        rows = []
        for symbol, bars in self._bars_by_symbol.items():
            name = bars[0].get("name") if bars else symbol
            if keyword and keyword not in symbol and keyword not in str(name):
                continue
            rows.append({"symbol": symbol, "name": name or symbol})
        return rows

    def get_stock_universe(
        self,
        min_market_cap_yi: float | None = None,
        max_market_cap_yi: float | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
        limit: int = 6000,
    ) -> list[dict[str, Any]]:
        requested_end = (end_date or self.current_date)[:10]
        safe_start = self._clamp_start_date(start_date)
        safe_end = self._clamp_end_date(end_date)
        if safe_start > safe_end:
            safe_start = safe_end
        visible_end = self._visible_daily_end_date()
        if self.data_frequency == "分钟K" and requested_end > visible_end:
            self.log(f"市值筛选可见性：分钟K回测按 {visible_end} 及以前日K计算股票池，避免在 {self.current_date} 开盘策略中使用当日收盘价。")
        return self.repository.list_market_cap_universe(
            min_market_cap_yi=min_market_cap_yi,
            max_market_cap_yi=max_market_cap_yi,
            start_date=safe_start,
            end_date=safe_end,
            limit=limit,
        )

    def get_market_cap_yi(self, symbol: str, start_date: str | None = None, end_date: str | None = None) -> float | None:
        safe_start = self._clamp_start_date(start_date)
        safe_end = self._clamp_end_date(end_date)
        if safe_start > safe_end:
            safe_start = safe_end
        if self.data_frequency == "分钟K":
            self.log(f"市值读取可见性：{symbol} 使用 {safe_end} 及以前日K计算市值，避免使用 {self.current_date} 当日收盘价。")
        return self.repository.get_market_cap_yi(symbol, safe_start, safe_end)

    def get_latest_minute_trade_date(self, symbol: str, start_date: str | None = None, end_date: str | None = None) -> str | None:
        del start_date, end_date
        return self.repository.latest_minute_trade_date(symbol, self.current_date, self.current_date, "1m")

    def find_minute_amount_triggers(
        self,
        symbols: list[str],
        start_date: str | None = None,
        end_date: str | None = None,
        start_time: str = "09:30:00",
        end_time: str = "10:30:00",
        min_amount: float = 50_000_000,
        consecutive_minutes: int = 3,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        del start_date, end_date
        def emit_progress(payload: dict[str, Any]) -> None:
            if self._progress_callback:
                self._progress_callback({"trade_date": self.current_date, **payload})

        if self.minute_mode != "minute_replay":
            self.log("分钟K快速扫描已禁用，本次自动按正式分钟回放逐行推演。")
        self.minute_mode = "minute_replay"
        replay_result = self.repository.replay_minute_amount_triggers(
            symbols=symbols,
            start_date=self.current_date,
            end_date=self.current_date,
            start_time=start_time,
            end_time=end_time,
            min_amount=min_amount,
            consecutive_minutes=consecutive_minutes,
            limit=limit,
            progress_callback=emit_progress,
        )
        triggers = list(replay_result.get("triggers") or [])
        stats = {
            "symbols_with_minute_rows": replay_result.get("symbols_with_minute_rows", 0),
            "minute_rows": replay_result.get("minute_rows", 0),
            "first_minute": replay_result.get("first_minute"),
            "last_minute": replay_result.get("last_minute"),
        }
        return_limit = min(max(int(limit), 1), 6000)
        payload = {
            "mode": self.minute_mode,
            "trade_date": self.current_date,
            "candidate_symbols": len([symbol for symbol in symbols if symbol]),
            "symbols_with_minute_rows": stats.get("symbols_with_minute_rows", 0),
            "minute_rows": stats.get("minute_rows", 0),
            "first_minute": stats.get("first_minute"),
            "last_minute": stats.get("last_minute"),
            "start_time": start_time,
            "end_time": end_time,
            "min_amount": min_amount,
            "consecutive_minutes": consecutive_minutes,
            "return_limit": return_limit,
            "triggers_returned": len(triggers),
            "limit_hit": len(triggers) >= return_limit,
        }
        self.log(f"{MINUTE_SCAN_DIAGNOSTIC_PREFIX}{json.dumps(payload, ensure_ascii=False)}")
        if payload["limit_hit"]:
            self.log(f"分钟K扫描提示：{self.current_date} 触发数量达到返回上限 {return_limit}，结果可能被策略 limit 截断。")
        return triggers

    def get_account_snapshot(self) -> None:
        return None

    def get_positions(self) -> list[dict[str, Any]]:
        return []

    def get_trading_calendar(self, start_date: str, end_date: str) -> list[dict[str, Any]]:
        dates = sorted({bar["trade_date"] for bars in self._bars_by_symbol.values() for bar in bars})
        return [{"trade_date": date, "is_trade_day": True} for date in dates if start_date <= date <= end_date]

    def log(self, message: str) -> None:
        self.logs.append(str(message))

    def _clamp_start_date(self, value: str | None) -> str:
        candidate = (value or self.current_date)[:10]
        return candidate if candidate <= self.current_date else self.current_date

    def _clamp_end_date(self, value: str | None) -> str:
        candidate = (value or self.current_date)[:10]
        visible_end = self._visible_daily_end_date()
        return candidate if candidate <= visible_end else visible_end

    def _visible_daily_end_date(self) -> str:
        if self.data_frequency != "分钟K":
            return self.current_date
        dates = sorted({bar["trade_date"] for bars in self._bars_by_symbol.values() for bar in bars if bar["trade_date"] < self.current_date})
        if dates:
            return dates[-1]
        self.log(f"市值筛选风险：{self.current_date} 前缺少可见日K，无法用前一交易日市值筛选；本日股票池可能不完整。")
        return "1900-01-01"

    def _clamp_datetime(self, value: str | None, start_of_day: bool) -> str:
        fallback = "00:00:00" if start_of_day else "23:59:59"
        if not value:
            return f"{self.current_date} {fallback}"
        value_text = str(value)
        if len(value_text) == 10:
            value_text = f"{value_text} {fallback}"
        if value_text[:10] != self.current_date:
            return f"{self.current_date} {fallback}"
        return value_text


class StrategyRunner:
    def run(
        self,
        task: BacktestTaskRecord,
        strategy_path: str,
        bars_by_symbol: dict[str, list[MarketBar]],
        cancel_check: Callable[[], bool] | None = None,
        progress_callback: Callable[[int, int, str, int], None] | None = None,
        minute_progress_callback: Callable[[int, int, str, dict[str, Any]], None] | None = None,
    ) -> tuple[list[dict[str, Any]], list[str]]:
        code = Path(strategy_path).read_text(encoding="utf-8")
        dates = sorted({bar.trade_date for bars in bars_by_symbol.values() for bar in bars if task.start_date <= bar.trade_date <= task.end_date})
        all_signals: list[dict[str, Any]] = []
        all_logs: list[str] = []
        timeout_seconds = SystemService().get_config().strategy_timeout_seconds
        if task.data_frequency == "分钟K":
            timeout_seconds = max(timeout_seconds, 180)
        progress_step = max(len(dates) // 20, 1)
        for date_index, current_date in enumerate(dates, start=1):
            if cancel_check and cancel_check():
                raise StrategyExecutionCancelled("backtest strategy run cancelled")
            serializable_bars = self._serializable_bars_until(bars_by_symbol, current_date)
            try:
                raw_signals, logs = run_backtest_strategy_code(
                    code,
                    Path(strategy_path).name,
                    timeout_seconds,
                    serializable_bars,
                    current_date,
                    task.data_frequency,
                    self._minute_mode(task),
                    cancel_check=cancel_check,
                    progress_event_callback=(
                        lambda event, day_index=date_index, total_days=len(dates), trade_date=current_date: minute_progress_callback(day_index, total_days, trade_date, event)
                    )
                    if minute_progress_callback
                    else None,
                )
            except StrategyExecutionTimeout as exc:
                raise BacktestError("策略在回测中运行超时，已终止。", "BACKTEST_STRATEGY_TIMEOUT", str(exc), "请检查策略中是否存在死循环或过慢查询。") from exc
            except StrategyExecutionFailed as exc:
                raise BacktestError("策略在回测中运行失败。", "BACKTEST_STRATEGY_FAILED", str(exc), "请确认策略没有读取未来数据，并先在策略开发中单独运行修复。") from exc
            signals = self._validate_signals(raw_signals, current_date, task.start_date, task.end_date)
            all_signals.extend(signals)
            all_logs.extend([line for line in logs if line])
            if progress_callback and (date_index == 1 or date_index == len(dates) or date_index % progress_step == 0):
                progress_callback(date_index, len(dates), current_date, len(all_signals))
        return all_signals, all_logs

    def _serializable_bars_until(self, bars_by_symbol: dict[str, list[MarketBar]], current_date: str) -> dict[str, list[dict[str, Any]]]:
        return {
            symbol: [bar.__dict__ for bar in bars if bar.trade_date <= current_date]
            for symbol, bars in bars_by_symbol.items()
        }

    def _validate_signals(self, raw_signals: object, current_date: str, task_start_date: str, task_end_date: str) -> list[dict[str, Any]]:
        if not isinstance(raw_signals, list):
            raise BacktestError("策略 run() 必须返回信号列表。", "BACKTEST_STRATEGY_FAILED", type(raw_signals).__name__, "请返回 list[dict]。")
        allowed = {"BUY", "SELL", "WATCH"}
        signals: list[dict[str, Any]] = []
        for index, item in enumerate(raw_signals):
            if not isinstance(item, dict):
                raise BacktestError("策略信号必须是字典。", "BACKTEST_STRATEGY_FAILED", f"index={index}", "请检查 signals 中的元素。")
            for field in ["symbol", "action", "price", "reason"]:
                if field not in item:
                    raise BacktestError("策略信号缺少必填字段。", "BACKTEST_STRATEGY_FAILED", f"missing={field}", "请补齐 symbol/action/price/reason。")
            action = str(item["action"]).strip().upper()
            if action not in allowed:
                raise BacktestError("策略信号 action 不合法。", "BACKTEST_STRATEGY_FAILED", str(item), "action 只能是 BUY / SELL / WATCH。")
            signal = dict(item)
            symbol = str(signal["symbol"]).strip().upper()
            if not re.match(r"^\d{6}\.(SH|SZ|BJ)$", symbol):
                raise BacktestError(
                    "策略信号股票代码格式不正确。",
                    "BACKTEST_STRATEGY_FAILED",
                    f"index={index}; symbol={signal['symbol']}",
                    "请使用 600000.SH / 000001.SZ / 430000.BJ 这类标准代码格式。",
                )
            try:
                price = float(signal["price"])
            except (TypeError, ValueError) as exc:
                raise BacktestError(
                    "策略信号 price 必须是数字。",
                    "BACKTEST_STRATEGY_FAILED",
                    f"index={index}; price={signal['price']}",
                    "请把参考价格改为数字，例如 10.25。",
                ) from exc
            if price <= 0:
                raise BacktestError(
                    "策略信号 price 必须大于 0。",
                    "BACKTEST_STRATEGY_FAILED",
                    f"index={index}; price={price}",
                    "请检查行情数据或策略价格计算逻辑。",
                )
            amount = signal.get("amount")
            if amount in ("", None):
                amount_value = None
            else:
                try:
                    amount_value = float(amount)
                except (TypeError, ValueError) as exc:
                    raise BacktestError(
                        "策略信号 amount 必须是数字。",
                        "BACKTEST_STRATEGY_FAILED",
                        f"index={index}; amount={amount}",
                        "请把建议金额改为数字，或不填写 amount。",
                    ) from exc
                if amount_value < 0:
                    raise BacktestError(
                        "策略信号 amount 不能小于 0。",
                        "BACKTEST_STRATEGY_FAILED",
                        f"index={index}; amount={amount_value}",
                        "请检查建议金额计算逻辑。",
                    )
            reason = str(signal["reason"]).strip()
            if not reason:
                raise BacktestError("策略信号 reason 不能为空。", "BACKTEST_STRATEGY_FAILED", f"index={index}", "请写明信号触发原因。")
            signal_time = self._normalize_signal_time(signal.get("signal_time"), current_date, index)
            if signal_time[:10] > current_date:
                raise BacktestError(
                    "策略返回了未来时间信号，回测已终止。",
                    "BACKTEST_FUTURE_SIGNAL",
                    f"signal_time={signal_time}; current_date={current_date}; signal={signal}",
                    "请确保策略只基于当前回测日期及以前的数据生成信号。",
                )
            if signal_time[:10] < task_start_date or signal_time[:10] > task_end_date:
                raise BacktestError(
                    "策略返回了回测区间外信号，回测已终止。",
                    "BACKTEST_SIGNAL_OUT_OF_RANGE",
                    f"signal_time={signal_time}; task_range={task_start_date}~{task_end_date}; current_date={current_date}; signal={signal}",
                    "请确认策略 signal_time 必须落在本次回测开始日期和结束日期之间。",
                )
            signal["symbol"] = symbol
            signal["action"] = action
            signal["price"] = price
            signal["amount"] = amount_value
            signal["reason"] = reason
            signal["signal_time"] = signal_time
            signals.append(signal)
        return signals

    def _minute_mode(self, task: BacktestTaskRecord) -> str:
        if task.data_frequency != "分钟K":
            return ""
        return "minute_replay"

    def _normalize_signal_time(self, raw_signal_time: object, current_date: str, index: int) -> str:
        signal_time = str(raw_signal_time or "").strip()
        if not signal_time:
            return current_date
        for fmt, output_fmt in (("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S"), ("%Y-%m-%d", "%Y-%m-%d")):
            try:
                return datetime.strptime(signal_time, fmt).strftime(output_fmt)
            except ValueError:
                continue
        raise BacktestError(
            "策略信号 signal_time 格式不正确。",
            "BACKTEST_STRATEGY_FAILED",
            f"index={index}; signal_time={signal_time}",
            "请使用 2026-05-08 或 2026-05-08 10:15:00 格式。",
        )


def run_backtest_strategy_code(
    code: str,
    file_name: str,
    timeout_seconds: int,
    bars_by_symbol: dict[str, list[dict[str, Any]]],
    current_date: str,
    data_frequency: str = "日K",
    minute_mode: str = "minute_replay",
    cancel_check: Callable[[], bool] | None = None,
    progress_event_callback: Callable[[dict[str, Any]], None] | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    context = multiprocessing.get_context("spawn")
    result_queue = context.Queue()
    process = context.Process(target=_backtest_strategy_worker, args=(code, file_name, bars_by_symbol, current_date, data_frequency, minute_mode, result_queue))
    process.start()
    deadline = time.monotonic() + timeout_seconds
    result: dict[str, Any] | None = None
    while process.is_alive():
        try:
            payload = result_queue.get_nowait()
            if payload.get("status") == "progress":
                if progress_event_callback:
                    progress_event_callback(dict(payload.get("event") or {}))
                continue
            result = payload
            break
        except queue.Empty:
            pass
        if cancel_check and cancel_check():
            process.terminate()
            process.join(3)
            raise StrategyExecutionCancelled("backtest strategy run cancelled")
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            process.terminate()
            process.join(3)
            raise StrategyExecutionTimeout(f"backtest strategy timeout after {timeout_seconds} seconds")
        process.join(min(0.2, remaining))
    if result is not None:
        process.join(3)
        if process.is_alive():
            process.terminate()
            process.join(3)
    else:
        while True:
            try:
                payload = result_queue.get_nowait()
            except queue.Empty:
                break
            if payload.get("status") == "progress":
                if progress_event_callback:
                    progress_event_callback(dict(payload.get("event") or {}))
                continue
            result = payload
            break
        if result is None:
            raise StrategyExecutionFailed(f"backtest strategy process exited with code {process.exitcode}")
    if result["status"] != "success":
        raise StrategyExecutionFailed(str(result["detail"]))
    return result["signals"], result["logs"]


def _backtest_strategy_worker(code: str, file_name: str, bars_by_symbol: dict[str, list[dict[str, Any]]], current_date: str, data_frequency: str, minute_mode: str, result_queue) -> None:
    stdout = io.StringIO()
    stderr = io.StringIO()
    try:
        context = BacktestStrategyContext(
            bars_by_symbol,
            current_date,
            data_frequency,
            minute_mode,
            progress_callback=lambda event: result_queue.put({"status": "progress", "event": event}),
        )
        namespace: dict[str, object] = {"__builtins__": _safe_builtins()}
        with redirect_stdout(stdout), redirect_stderr(stderr):
            exec(compile(code, file_name, "exec"), namespace)
            strategy_cls = namespace["Strategy"]
            strategy = strategy_cls(context)
            raw_signals = strategy.run()
        result_queue.put({
            "status": "success",
            "signals": raw_signals,
            "logs": [stdout.getvalue(), stderr.getvalue(), *context.logs],
        })
    except Exception:
        result_queue.put({"status": "failed", "detail": traceback.format_exc()})


class MatchingEngine:
    def next_bar(self, bars: list[MarketBar], signal_time: str | None, fill_mode: str) -> MarketBar | None:
        if not bars:
            return None
        signal_date = (signal_time or bars[0].trade_date)[:10]
        for bar in bars:
            if bar.trade_date > signal_date:
                return bar
        return None

    def executable_price(self, bar: MarketBar, side: str, fill_mode: str, slippage: float) -> float:
        base_price = bar.open if "开盘" in fill_mode or "下一分钟" in fill_mode or "正式分钟回放" in fill_mode else bar.close
        return round(base_price + slippage if side == "BUY" else max(base_price - slippage, 0.01), 4)

    def is_limit_blocked(self, bars: list[MarketBar], bar: MarketBar, side: str) -> bool:
        previous = None
        bar_date = bar.trade_date[:10]
        for candidate in bars:
            if candidate.trade_date < bar_date:
                previous = candidate
            elif candidate.trade_date == bar_date:
                break
        if previous is None or previous.close <= 0:
            return False
        if side == "BUY":
            return bar.high == bar.low == bar.close and bar.close >= previous.close * 1.095
        return bar.high == bar.low == bar.close and bar.close <= previous.close * 0.905


class Portfolio:
    def __init__(self, initial_cash: float) -> None:
        self.cash = initial_cash
        self.positions: dict[str, int] = {}
        self.position_cost: dict[str, float] = {}
        self.lots: dict[str, list[dict[str, Any]]] = {}

    def position(self, symbol: str) -> int:
        return self.positions.get(symbol, 0)

    def buy(self, symbol: str, trade_date: str, price: float, quantity: int, fee: float) -> None:
        total_cost = price * quantity + fee
        self.cash -= total_cost
        self.positions[symbol] = self.position(symbol) + quantity
        self.position_cost[symbol] = self.position_cost.get(symbol, 0.0) + total_cost
        self.lots.setdefault(symbol, []).append({"trade_date": trade_date, "quantity": quantity, "cost": total_cost})

    def available_position(self, symbol: str, trade_date: str) -> int:
        return sum(int(lot["quantity"]) for lot in self.lots.get(symbol, []) if lot["trade_date"] < trade_date)

    def sell(self, symbol: str, trade_date: str, price: float, quantity: int, fee: float, stamp_tax: float) -> float:
        consumed_cost = self._consume_lots(symbol, trade_date, quantity)
        self.cash += price * quantity - fee - stamp_tax
        self.positions[symbol] = max(self.position(symbol) - quantity, 0)
        self.position_cost[symbol] = max(self.position_cost.get(symbol, 0.0) - consumed_cost, 0.0)
        return round(price * quantity - consumed_cost - fee - stamp_tax, 2)

    def _consume_lots(self, symbol: str, trade_date: str, quantity: int) -> float:
        remaining = quantity
        consumed_cost = 0.0
        next_lots: list[dict[str, Any]] = []
        for lot in self.lots.get(symbol, []):
            lot_quantity = int(lot["quantity"])
            if remaining > 0 and lot["trade_date"] < trade_date:
                used = min(lot_quantity, remaining)
                cost_per_share = float(lot["cost"]) / lot_quantity if lot_quantity else 0.0
                consumed_cost += cost_per_share * used
                lot_quantity -= used
                remaining -= used
            if lot_quantity > 0:
                next_lots.append({**lot, "quantity": lot_quantity, "cost": float(lot["cost"]) * lot_quantity / int(lot["quantity"])})
        self.lots[symbol] = next_lots
        return consumed_cost


class BacktestBroker:
    def __init__(self, matcher: MatchingEngine) -> None:
        self.matcher = matcher
        self.repository = BacktestRepository()

    def execute(
        self,
        task: BacktestTaskRecord,
        signals: list[dict[str, Any]],
        bars_by_symbol: dict[str, list[MarketBar]],
    ) -> tuple[list[dict[str, Any]], Portfolio, list[str]]:
        trades, portfolio, logs, _audits = self.execute_with_audit(task, signals, bars_by_symbol)
        return trades, portfolio, logs

    def execute_with_audit(
        self,
        task: BacktestTaskRecord,
        signals: list[dict[str, Any]],
        bars_by_symbol: dict[str, list[MarketBar]],
        cancel_check: Callable[[], bool] | None = None,
        progress_callback: Callable[[int, int, int, int, str], None] | None = None,
    ) -> tuple[list[dict[str, Any]], Portfolio, list[str], list[dict[str, Any]]]:
        portfolio = Portfolio(task.initial_cash)
        trades: list[dict[str, Any]] = []
        logs: list[str] = []
        audits: list[dict[str, Any]] = []
        pending_events = [
            {
                "signal": signal,
                "bar": None,
                "sort_time": self._signal_event_time(signal),
                "sequence": index,
            }
            for index, signal in enumerate(signals)
        ]
        pending_events.sort(key=self._event_sort_key)
        progress_step = max(len(pending_events) // 20, 100)
        next_sequence = len(pending_events)
        event_index = 0

        def report_progress(current_symbol: str) -> None:
            if progress_callback and (event_index == 1 or event_index == len(pending_events) or event_index % progress_step == 0):
                skipped = sum(1 for row in audits if row.get("status") in {"跳过", "未成交"})
                progress_callback(event_index, len(pending_events), len(trades), skipped, current_symbol)

        while event_index < len(pending_events):
            if cancel_check and cancel_check():
                raise StrategyExecutionCancelled("backtest broker run cancelled")
            event = pending_events[event_index]
            event_index += 1
            signal = event["signal"]
            action = str(signal["action"])
            symbol = str(signal["symbol"])
            if action == "WATCH":
                skip_reason = f"观察信号已记录但不成交：{signal['symbol']} {signal.get('reason', '')}"
                logs.append(skip_reason)
                audits.append(self._signal_audit_row(signal, "观察", skip_reason=skip_reason))
                report_progress(symbol)
                continue
            bars = bars_by_symbol.get(symbol, [])
            bar = event.get("bar") or self._execution_bar(task, bars, signal)
            if bar is None:
                skip_reason = f"没有可用于成交的行情：{symbol}"
                logs.append(skip_reason)
                audits.append(self._signal_audit_row(signal, "未成交", skip_reason=skip_reason))
                report_progress(symbol)
                continue
            if not self._bar_in_task_range(bar, task):
                skip_reason = f"成交行情超出回测区间，已跳过：{symbol} {bar.bar_time or bar.trade_date}，区间 {task.start_date}~{task.end_date}"
                logs.append(skip_reason)
                audits.append(self._signal_audit_row(signal, "跳过", execution_bar=bar, skip_reason=skip_reason))
                report_progress(symbol)
                continue
            if bar.suspend_flag or bar.volume <= 0:
                skip_reason = f"停牌或无成交量，跳过信号：{symbol} {bar.trade_date}"
                logs.append(skip_reason)
                audits.append(self._signal_audit_row(signal, "跳过", execution_bar=bar, skip_reason=skip_reason))
                report_progress(symbol)
                continue
            if self.matcher.is_limit_blocked(bars, bar, action):
                skip_reason = f"涨跌停限制，无法成交：{symbol} {bar.trade_date} {action}"
                logs.append(skip_reason)
                audits.append(self._signal_audit_row(signal, "跳过", execution_bar=bar, skip_reason=skip_reason))
                report_progress(symbol)
                continue
            price = self._event_execution_price(event, bar, action, task)
            if action == "BUY":
                quantity = int(self._buy_budget(task, signal, portfolio.cash) / price / 100) * 100
                if quantity < 100:
                    skip_reason = f"现金不足或不足一手，买入跳过：{symbol}"
                    logs.append(skip_reason)
                    audits.append(self._signal_audit_row(signal, "跳过", execution_bar=bar, skip_reason=skip_reason))
                    report_progress(symbol)
                    continue
                fee = round(price * quantity * task.fee_rate, 2)
                portfolio.buy(symbol, bar.trade_date, price, quantity, fee)
                trade = self._trade_row(bar, "BUY", price, quantity, fee, 0, signal)
                trades.append(trade)
                audits.append(self._signal_audit_row(signal, "已成交", execution_bar=bar, trade=trade))
                exit_event, exit_log = self._auto_exit_event(task, bars, bar, price, quantity, signal, next_sequence)
                if exit_log:
                    logs.append(exit_log)
                if exit_event:
                    pending_events.append(exit_event)
                    next_sequence += 1
                    pending_events[event_index:] = sorted(pending_events[event_index:], key=self._event_sort_key)
            elif action == "SELL":
                holding = portfolio.position(symbol)
                if holding < 100:
                    skip_reason = f"无可卖持仓，卖出跳过：{symbol}"
                    logs.append(skip_reason)
                    audits.append(self._signal_audit_row(signal, "跳过", execution_bar=bar, skip_reason=skip_reason))
                    report_progress(symbol)
                    continue
                available = portfolio.available_position(symbol, bar.trade_date)
                if available < 100:
                    skip_reason = f"T+1 规则限制，当日买入不可卖出：{symbol} {bar.trade_date}"
                    logs.append(skip_reason)
                    audits.append(self._signal_audit_row(signal, "跳过", execution_bar=bar, skip_reason=skip_reason))
                    report_progress(symbol)
                    continue
                requested_quantity = self._requested_quantity(signal)
                sellable_quantity = min(holding, available, requested_quantity or available)
                quantity = int(sellable_quantity / 100) * 100
                if quantity < 100:
                    skip_reason = f"可卖数量不足一手，卖出跳过：{symbol}"
                    logs.append(skip_reason)
                    audits.append(self._signal_audit_row(signal, "跳过", execution_bar=bar, skip_reason=skip_reason))
                    report_progress(symbol)
                    continue
                fee = round(price * quantity * task.fee_rate, 2)
                stamp_tax = round(price * quantity * task.stamp_tax_rate, 2)
                pnl = portfolio.sell(symbol, bar.trade_date, price, quantity, fee, stamp_tax)
                trade = self._trade_row(bar, "SELL", price, quantity, fee + stamp_tax, pnl, signal)
                trades.append(trade)
                audits.append(self._signal_audit_row(signal, "已成交", execution_bar=bar, trade=trade))
            report_progress(symbol)
        return trades, portfolio, logs, audits

    def _event_sort_key(self, event: dict[str, Any]) -> tuple[str, int]:
        return str(event["sort_time"]), int(event["sequence"])

    def _signal_event_time(self, signal: dict[str, Any]) -> str:
        signal_time = str(signal.get("signal_time") or "")
        if not signal_time:
            return "9999-12-31 23:59:59"
        if len(signal_time) == 10:
            return f"{signal_time} 15:00:00"
        return signal_time

    def _bar_in_task_range(self, bar: MarketBar, task: BacktestTaskRecord) -> bool:
        return task.start_date <= bar.trade_date <= task.end_date

    def _buy_budget(self, task: BacktestTaskRecord, signal: dict[str, Any], cash: float) -> float:
        signal_amount = signal.get("amount")
        if signal_amount not in ("", None):
            try:
                amount = float(signal_amount)
            except (TypeError, ValueError):
                amount = task.single_order_amount
            if amount > 0:
                return min(amount, task.single_order_amount, cash)
        return min(task.single_order_amount, cash)

    def _requested_quantity(self, signal: dict[str, Any]) -> int | None:
        quantity = signal.get("quantity")
        if quantity in ("", None):
            return None
        try:
            value = int(float(quantity))
        except (TypeError, ValueError):
            return None
        return int(value / 100) * 100 if value >= 100 else None

    def _auto_exit_event(
        self,
        task: BacktestTaskRecord,
        bars: list[MarketBar],
        buy_bar: MarketBar,
        buy_price: float,
        quantity: int,
        signal: dict[str, Any],
        sequence: int,
    ) -> tuple[dict[str, Any] | None, str | None]:
        controlled_event, controlled_log = self._controlled_exit_event(task, bars, buy_bar, buy_price, quantity, signal, sequence)
        if controlled_event:
            return controlled_event, controlled_log
        if controlled_log and task.data_frequency == "分钟K":
            return None, controlled_log
        sell_after_days = self._sell_after_trading_days(signal)
        if sell_after_days <= 0:
            return None, controlled_log
        exit_bar = self._bar_after_trading_days(bars, buy_bar.trade_date, sell_after_days)
        if exit_bar is None:
            message = f"未找到次日卖出行情，无法安排自动卖出：{buy_bar.symbol} 买入日 {buy_bar.trade_date}"
            return None, f"{controlled_log} {message}".strip() if controlled_log else message
        auto_signal = {
            "symbol": str(signal["symbol"]),
            "name": str(signal.get("name") or exit_bar.name or signal["symbol"]),
            "action": "SELL",
            "price": exit_bar.open,
            "amount": round(exit_bar.open * quantity, 2),
            "quantity": quantity,
            "reason": f"买入信号设置持有 {sell_after_days} 个交易日，按次日开盘本地撮合卖出；原始原因：{signal.get('reason', '')}",
            "signal_time": f"{exit_bar.trade_date} 09:30:00",
            "_auto_exit": True,
        }
        return (
            {
                "signal": auto_signal,
                "bar": exit_bar,
                "sort_time": f"{exit_bar.trade_date} 09:30:00",
                "sequence": sequence,
            },
            (
                f"{controlled_log} 已退化为日K持有天数卖出：{buy_bar.symbol} 买入日 {buy_bar.trade_date}，"
                f"卖出日 {exit_bar.trade_date}，数量 {quantity}。"
            )
            if controlled_log
            else f"已按策略规则安排次日卖出：{buy_bar.symbol} 买入日 {buy_bar.trade_date}，卖出日 {exit_bar.trade_date}，数量 {quantity}。",
        )

    def _controlled_exit_event(
        self,
        task: BacktestTaskRecord,
        bars: list[MarketBar],
        buy_bar: MarketBar,
        buy_price: float,
        quantity: int,
        signal: dict[str, Any],
        sequence: int,
    ) -> tuple[dict[str, Any] | None, str | None]:
        stop_loss_pct = self._percent_value(signal.get("stop_loss_pct"))
        take_profit_pct = self._percent_value(signal.get("take_profit_pct"))
        fallback_exit_time = str(signal.get("fallback_exit_time") or "").strip()
        if stop_loss_pct <= 0 and take_profit_pct <= 0 and not fallback_exit_time:
            return None, None
        if task.data_frequency != "分钟K":
            return None, "止损止盈卖出规则需要分钟K回测，当前不是分钟K，已跳过自动卖出规则。"
        fallback_time = self._normalize_time_text(fallback_exit_time or "14:50:00")
        exit_after_days = self._exit_after_trading_days(signal)
        scan_dates = self._trading_dates_after(bars, buy_bar.trade_date, exit_after_days)
        if not scan_dates:
            return None, f"未找到止损止盈卖出日行情，无法安排自动卖出：{buy_bar.symbol} 买入日 {buy_bar.trade_date}"

        rows: list[dict[str, object]] = []
        final_exit_date = scan_dates[-1]
        for trade_date in scan_dates:
            end_clock = fallback_time if trade_date == final_exit_date else "23:59:59"
            rows.extend(self.repository.list_minute_bar_rows_between(buy_bar.symbol, f"{trade_date} 09:30:00", f"{trade_date} {end_clock}"))
        if not rows:
            return None, f"未找到 {buy_bar.symbol} 买入后第 1~{exit_after_days} 个交易日分钟K，无法执行止损止盈/尾盘卖出。"

        stop_price = round(buy_price * (1 - stop_loss_pct / 100), 4) if stop_loss_pct > 0 else None
        take_price = round(buy_price * (1 + take_profit_pct / 100), 4) if take_profit_pct > 0 else None
        selected_row: dict[str, object] | None = None
        selected_price = 0.0
        selected_reason = ""
        for row in rows:
            open_price = float(row["open"])
            high = float(row["high"])
            low = float(row["low"])
            stop_gap_hit = stop_price is not None and open_price <= stop_price
            take_gap_hit = take_price is not None and open_price >= take_price
            stop_hit = stop_price is not None and low <= stop_price
            take_hit = take_price is not None and high >= take_price
            if stop_gap_hit:
                selected_row, selected_price = row, open_price
                selected_reason = f"监控交易日开盘低于止损价，按开盘价止损卖出；买入价 {buy_price:.4f}，止损价 {stop_price:.4f}。"
                break
            if take_gap_hit:
                selected_row, selected_price = row, open_price
                selected_reason = f"监控交易日开盘高于止盈价，按开盘价止盈卖出；买入价 {buy_price:.4f}，止盈价 {take_price:.4f}。"
                break
            if stop_hit and take_hit:
                selected_row, selected_price = row, stop_price or open_price
                selected_reason = f"同一分钟同时触发止损和止盈，按保守规则优先止损；买入价 {buy_price:.4f}。"
                break
            if stop_hit:
                selected_row, selected_price = row, stop_price or open_price
                selected_reason = f"触发止损 {stop_loss_pct:.2f}%，按止损价卖出；买入价 {buy_price:.4f}，止损价 {stop_price:.4f}。"
                break
            if take_hit:
                selected_row, selected_price = row, take_price or open_price
                selected_reason = f"触发止盈 {take_profit_pct:.2f}%，按止盈价卖出；买入价 {buy_price:.4f}，止盈价 {take_price:.4f}。"
                break
        if selected_row is None:
            selected_row = rows[-1]
            selected_price = float(selected_row["open"])
            watched_rules = []
            if stop_price is not None:
                watched_rules.append("止损")
            if take_price is not None:
                watched_rules.append("止盈")
            watched_text = "/".join(watched_rules) if watched_rules else "退出条件"
            selected_reason = f"买入后第 {exit_after_days} 个交易日 {fallback_time} 前仍未触发{watched_text}，按最后一分钟开盘价卖出；买入价 {buy_price:.4f}。"

        exit_bar = self._minute_market_bar(selected_row, str(signal.get("name") or buy_bar.name or buy_bar.symbol))
        auto_signal = {
            "symbol": str(signal["symbol"]),
            "name": str(signal.get("name") or exit_bar.name or signal["symbol"]),
            "action": "SELL",
            "price": selected_price,
            "amount": round(selected_price * quantity, 2),
            "quantity": quantity,
            "reason": f"{selected_reason} 原始买入原因：{signal.get('reason', '')}",
            "signal_time": exit_bar.bar_time or f"{exit_bar.trade_date} {fallback_time}",
            "_auto_exit": True,
        }
        return (
            {
                "signal": auto_signal,
                "bar": exit_bar,
                "sort_time": auto_signal["signal_time"],
                "sequence": sequence,
                "execution_price": selected_price,
            },
            f"已按止损止盈规则安排卖出：{buy_bar.symbol} 买入 {buy_bar.bar_time or buy_bar.trade_date}，卖出 {auto_signal['signal_time']}，数量 {quantity}，原因：{selected_reason}",
        )

    def _event_execution_price(self, event: dict[str, Any], bar: MarketBar, action: str, task: BacktestTaskRecord) -> float:
        explicit_price = event.get("execution_price")
        if explicit_price not in ("", None):
            try:
                price = float(explicit_price)
            except (TypeError, ValueError):
                price = 0
            if price > 0:
                return round(price + task.slippage if action == "BUY" else max(price - task.slippage, 0.01), 4)
        return self.matcher.executable_price(bar, action, task.fill_mode, task.slippage)

    def _minute_market_bar(self, row: dict[str, object], name: str) -> MarketBar:
        bar_time = str(row["datetime"])
        return MarketBar(
            symbol=str(row["symbol"]),
            trade_date=bar_time[:10],
            open=float(row["open"]),
            high=float(row["high"]),
            low=float(row["low"]),
            close=float(row["close"]),
            volume=int(float(row["volume"])),
            amount=float(row["amount"]),
            pre_close=float(row.get("pre_close") or 0),
            suspend_flag=int(row.get("suspend_flag") or 0),
            name=name,
            bar_time=bar_time,
        )

    def _percent_value(self, value: object) -> float:
        if value in ("", None):
            return 0.0
        try:
            return max(float(value), 0.0)
        except (TypeError, ValueError):
            return 0.0

    def _exit_after_trading_days(self, signal: dict[str, Any]) -> int:
        raw_value = signal.get("exit_after_trading_days", signal.get("sell_after_trading_days", 1))
        try:
            return max(int(float(raw_value)), 1)
        except (TypeError, ValueError):
            return 1

    def _normalize_time_text(self, value: str) -> str:
        text = value.strip()
        if re.match(r"^\d{2}:\d{2}:\d{2}$", text):
            return text
        if re.match(r"^\d{2}:\d{2}$", text):
            return f"{text}:00"
        return "14:50:00"

    def _trading_date_after(self, bars: list[MarketBar], trade_date: str, days: int) -> str | None:
        future_dates = sorted({bar.trade_date for bar in bars if bar.trade_date > trade_date})
        if len(future_dates) < days:
            return None
        return future_dates[days - 1]

    def _trading_dates_after(self, bars: list[MarketBar], trade_date: str, days: int) -> list[str]:
        future_dates = sorted({bar.trade_date for bar in bars if bar.trade_date > trade_date})
        return future_dates[:days] if len(future_dates) >= days else []

    def _sell_after_trading_days(self, signal: dict[str, Any]) -> int:
        raw_value = signal.get("sell_after_trading_days", signal.get("sell_after_days", signal.get("exit_after_trading_days")))
        if raw_value in ("", None):
            return 0
        try:
            return max(int(float(raw_value)), 0)
        except (TypeError, ValueError):
            return 0

    def _bar_after_trading_days(self, bars: list[MarketBar], trade_date: str, days: int) -> MarketBar | None:
        future_bars = [bar for bar in bars if bar.trade_date > trade_date]
        if len(future_bars) < days:
            return None
        return future_bars[days - 1]

    def _execution_bar(self, task: BacktestTaskRecord, bars: list[MarketBar], signal: dict[str, Any]) -> MarketBar | None:
        if task.data_frequency == "分钟K":
            minute_bar = self.repository.next_minute_bar_row(str(signal["symbol"]), str(signal.get("signal_time") or ""), task.end_date)
            if minute_bar:
                bar_time = str(minute_bar["datetime"])
                return MarketBar(
                    symbol=str(minute_bar["symbol"]),
                    trade_date=bar_time[:10],
                    open=float(minute_bar["open"]),
                    high=float(minute_bar["high"]),
                    low=float(minute_bar["low"]),
                    close=float(minute_bar["close"]),
                    volume=int(float(minute_bar["volume"])),
                    amount=float(minute_bar["amount"]),
                    pre_close=float(minute_bar.get("pre_close") or 0),
                    suspend_flag=int(minute_bar.get("suspend_flag") or 0),
                    name=str(signal.get("name") or minute_bar["symbol"]),
                    bar_time=bar_time,
                )
        return self.matcher.next_bar(bars, signal.get("signal_time"), task.fill_mode)

    def _trade_row(
        self,
        bar: MarketBar,
        side: str,
        price: float,
        quantity: int,
        fee: float,
        pnl: float,
        signal: dict[str, Any],
    ) -> dict[str, Any]:
        raw_reason = str(signal.get("reason", ""))
        signal_time = str(signal.get("signal_time") or "")
        reason = f"信号时间 {signal_time}；{raw_reason}" if signal_time else raw_reason
        return {
            "symbol": bar.symbol,
            "name": str(signal.get("name") or bar.name or bar.symbol),
            "side": side,
            "price": price,
            "quantity": quantity,
            "amount": round(price * quantity, 2),
            "fee": fee,
            "trade_time": bar.bar_time or bar.trade_date,
            "reason": reason,
            "pnl": pnl,
        }

    def _signal_audit_row(
        self,
        signal: dict[str, Any],
        status: str,
        execution_bar: MarketBar | None = None,
        trade: dict[str, Any] | None = None,
        skip_reason: str | None = None,
    ) -> dict[str, Any]:
        return {
            "signal_time": str(signal.get("signal_time") or ""),
            "symbol": str(signal.get("symbol") or ""),
            "name": str(signal.get("name") or signal.get("symbol") or ""),
            "action": str(signal.get("action") or ""),
            "price": self._float_value(signal.get("price"), 0),
            "amount": self._float_value(signal.get("amount"), None),
            "reason": str(signal.get("reason") or ""),
            "status": status,
            "execution_time": str(trade.get("trade_time")) if trade else (execution_bar.bar_time or execution_bar.trade_date if execution_bar else None),
            "execution_price": float(trade["price"]) if trade else None,
            "quantity": int(trade["quantity"]) if trade else 0,
            "skip_reason": skip_reason,
            "is_auto_exit": bool(signal.get("_auto_exit")),
        }

    def _float_value(self, value: object, default: float | None) -> float | None:
        if value in ("", None):
            return default
        try:
            return float(value)
        except (TypeError, ValueError):
            return default


class MetricsService:
    def build_equity(
        self,
        task: BacktestTaskRecord,
        bars_by_symbol: dict[str, list[MarketBar]],
        trades: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        dates = sorted({bar.trade_date for bars in bars_by_symbol.values() for bar in bars if task.start_date <= bar.trade_date <= task.end_date})
        cash = task.initial_cash
        positions: dict[str, int] = {}
        trade_map: dict[str, list[dict[str, Any]]] = {}
        for trade in trades:
            trade_map.setdefault(str(trade["trade_time"])[:10], []).append(trade)
        equity_rows: list[dict[str, Any]] = []
        peak = task.initial_cash
        for trade_date in dates:
            for trade in trade_map.get(trade_date, []):
                signed_amount = trade["amount"] + trade["fee"]
                if trade["side"] == "BUY":
                    cash -= signed_amount
                    positions[trade["symbol"]] = positions.get(trade["symbol"], 0) + trade["quantity"]
                else:
                    cash += trade["amount"] - trade["fee"]
                    positions[trade["symbol"]] = max(positions.get(trade["symbol"], 0) - trade["quantity"], 0)
            market_value = 0.0
            for symbol, quantity in positions.items():
                if quantity <= 0:
                    continue
                close = self._close_price(symbol, trade_date, bars_by_symbol)
                market_value += close * quantity
            equity = cash + market_value
            peak = max(peak, equity)
            drawdown = 0 if peak == 0 else round((equity - peak) / peak * 100, 4)
            equity_rows.append(
                {
                    "trade_date": trade_date,
                    "equity": round(equity, 2),
                    "cash": round(cash, 2),
                    "market_value": round(market_value, 2),
                    "drawdown": drawdown,
                }
            )
        if not equity_rows:
            equity_rows.append({"trade_date": task.start_date, "equity": task.initial_cash, "cash": task.initial_cash, "market_value": 0, "drawdown": 0})
        return equity_rows

    def metrics(self, task: BacktestTaskRecord, equity_rows: list[dict[str, Any]], trades: list[dict[str, Any]]) -> dict[str, Any]:
        final_equity = equity_rows[-1]["equity"] if equity_rows else task.initial_cash
        ending_cash = equity_rows[-1]["cash"] if equity_rows else task.initial_cash
        open_market_value = equity_rows[-1]["market_value"] if equity_rows else 0
        total_return = (final_equity / task.initial_cash - 1) * 100
        days = max(len(equity_rows), 1)
        annual_return = ((final_equity / task.initial_cash) ** (252 / days) - 1) * 100 if final_equity > 0 else -100
        max_drawdown = min((row["drawdown"] for row in equity_rows), default=0)
        buy_count = sum(1 for trade in trades if trade.get("side") == "BUY")
        realized_trades = [trade for trade in trades if trade.get("side") == "SELL"]
        sell_count = len(realized_trades)
        win_rate_base = realized_trades or trades
        profitable = [trade for trade in win_rate_base if trade.get("pnl", 0) > 0]
        loss = abs(sum(trade.get("pnl", 0) for trade in realized_trades if trade.get("pnl", 0) < 0))
        profit = sum(trade.get("pnl", 0) for trade in profitable)
        total_fee = sum(float(trade.get("fee") or 0) for trade in trades)
        realized_pnl = sum(float(trade.get("pnl") or 0) for trade in realized_trades)
        return {
            "total_return": round(total_return, 4),
            "annual_return": round(annual_return, 4),
            "max_drawdown": round(max_drawdown, 4),
            "win_rate": round((len(profitable) / len(win_rate_base) * 100) if win_rate_base else 0, 4),
            "trade_count": len(trades),
            "buy_count": buy_count,
            "sell_count": sell_count,
            "profit_loss_ratio": round((profit / loss) if loss else 0, 4),
            "average_holding_days": self._average_holding_days(trades, [str(row["trade_date"]) for row in equity_rows]),
            "ending_cash": round(ending_cash, 2),
            "open_position_count": self._open_position_count(trades),
            "open_market_value": round(open_market_value, 2),
            "total_fee": round(total_fee, 2),
            "realized_pnl": round(realized_pnl, 2),
            "final_cash": round(final_equity, 2),
        }

    def _open_position_count(self, trades: list[dict[str, Any]]) -> int:
        positions: dict[str, int] = {}
        for trade in trades:
            symbol = str(trade["symbol"])
            quantity = int(trade["quantity"])
            if trade["side"] == "BUY":
                positions[symbol] = positions.get(symbol, 0) + quantity
            elif trade["side"] == "SELL":
                positions[symbol] = max(positions.get(symbol, 0) - quantity, 0)
        return sum(1 for quantity in positions.values() if quantity > 0)

    def _average_holding_days(self, trades: list[dict[str, Any]], trade_dates: list[str]) -> float:
        lots_by_symbol: dict[str, list[dict[str, Any]]] = {}
        date_rank = {trade_date: index for index, trade_date in enumerate(trade_dates)}
        weighted_days = 0.0
        weighted_quantity = 0
        for trade in trades:
            symbol = str(trade["symbol"])
            quantity = int(trade["quantity"])
            trade_date_text = str(trade["trade_time"])[:10]
            if trade["side"] == "BUY":
                lots_by_symbol.setdefault(symbol, []).append({"trade_date": trade_date_text, "quantity": quantity})
                continue
            remaining = quantity
            next_lots: list[dict[str, Any]] = []
            for lot in lots_by_symbol.get(symbol, []):
                lot_quantity = int(lot["quantity"])
                used = min(lot_quantity, remaining) if remaining > 0 else 0
                if used > 0:
                    holding_days = self._holding_trading_days(lot["trade_date"], trade_date_text, date_rank)
                    weighted_days += holding_days * used
                    weighted_quantity += used
                    lot_quantity -= used
                    remaining -= used
                if lot_quantity > 0:
                    next_lots.append({**lot, "quantity": lot_quantity})
            lots_by_symbol[symbol] = next_lots
        if weighted_quantity == 0:
            return 0.0
        return round(weighted_days / weighted_quantity, 4)

    def _holding_trading_days(self, buy_date: str, sell_date: str, date_rank: dict[str, int]) -> int:
        if buy_date in date_rank and sell_date in date_rank:
            return max(date_rank[sell_date] - date_rank[buy_date], 0)
        buy = datetime.strptime(buy_date, "%Y-%m-%d").date()
        sell = datetime.strptime(sell_date, "%Y-%m-%d").date()
        return max((sell - buy).days, 0)

    def _close_price(self, symbol: str, trade_date: str, bars_by_symbol: dict[str, list[MarketBar]]) -> float:
        latest = 0.0
        for bar in bars_by_symbol.get(symbol, []):
            if bar.trade_date <= trade_date:
                latest = bar.close
            else:
                break
        return latest


class ReportService:
    def summarize(self, metrics: dict[str, Any], trade_count: int, log_count: int) -> list[str]:
        lines = [
            f"回测完成，总收益率 {metrics['total_return']}%，最大回撤 {metrics['max_drawdown']}%。",
            f"成交 {trade_count} 笔，其中买入 {metrics.get('buy_count', 0)} 笔、卖出 {metrics.get('sell_count', 0)} 笔，生成日志 {log_count} 条。",
            f"期末现金 {metrics.get('ending_cash', 0)}，未平仓股票 {metrics.get('open_position_count', 0)} 只，未平仓市值 {metrics.get('open_market_value', 0)}。",
            "本阶段使用本地 SQLite 历史行情与本地撮合回测；行情如来自真实 QMT 同步，也不会调用真实 QMT 交易接口或产生真实委托。",
        ]
        if metrics.get("open_position_count", 0) > 0:
            lines.append("存在未平仓持仓，最终权益已按回测结束日收盘价计入持仓市值；请结合交易明细核对最后一日买入。")
        return lines
