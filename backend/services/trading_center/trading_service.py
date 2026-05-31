import hashlib
import sqlite3
import time
import traceback
from uuid import uuid4

from backend.adapters.qmt.qmt_trade_adapter import DisabledRealTradingAdapter, TestIsolationTradeAdapter
from backend.core.exceptions import TaskCancelledError, TradingError
from backend.models.trading_models import CANCELABLE_ORDER_STATUSES
from backend.repositories.system.system_repository import SystemRepository
from backend.repositories.trading_center.trading_repository import TradingRepository
from backend.schemas.common import PageQuery, PageResult
from backend.schemas.system import TaskCreated
from backend.schemas.trading import (
    ExecutionLogRecord,
    ManualOrderRequest,
    OrderSubmitResult,
    SignalOrderRequest,
    TradingOrderRecord,
    TradingPosition,
    TradingSignalRecord,
    TradingTradeRecord,
)
from backend.services.system.system_service import SystemService


TEST_ISOLATION_TRADING_ACCOUNT_ID = "test_isolation_account"
TEST_ISOLATION_TRADING_DETAIL = "test_isolation=true; real_qmt_order=false"


class TradingService:
    def __init__(self) -> None:
        self.repository = TradingRepository()
        self.system_repository = SystemRepository()
        self.system_service = SystemService()
        config = self.system_service.get_config()
        self.adapter = TestIsolationTradeAdapter() if config.simulation_mode else DisabledRealTradingAdapter()

    def submit_manual_order(self, request: ManualOrderRequest) -> OrderSubmitResult:
        self._ensure_trading_mode_allows_submit()
        symbol = request.symbol.strip().upper()
        side = request.side.strip().upper()
        self._validate_order(symbol, side, request.price, request.quantity)
        account = self._require_account()
        stock_name = request.name or self._stock_name(symbol)
        self._validate_buy_sell_capacity(account.available_cash, symbol, side, request.price, request.quantity)
        idempotency_key = self._idempotency_key(account.account_id, symbol, side, request.price, request.quantity, "manual", None)
        duplicate = self.repository.find_order_by_idempotency(idempotency_key)
        if duplicate:
            return OrderSubmitResult(order=duplicate, message="检测到重复请求，已返回已有本地订单。", duplicate=True)
        order = self._create_and_submit_order(
            account_id=account.account_id,
            symbol=symbol,
            name=stock_name,
            side=side,
            price=request.price,
            quantity=request.quantity,
            source="manual",
            strategy_id=None,
            signal_id=None,
            idempotency_key=idempotency_key,
        )
        self.system_repository.add_operation_log("交易执行", "手动下单", "order_record", order.local_order_id, "成功", f"已提交手动委托：{order.symbol} {order.side} {order.quantity} 股。")
        return OrderSubmitResult(order=order, message="手动委托已提交到测试隔离交易适配器。")

    def submit_signal_order(self, signal_id: int, request: SignalOrderRequest) -> OrderSubmitResult:
        self._ensure_trading_mode_allows_submit()
        signal = self._get_signal_or_error(signal_id)
        if signal.status != "未处理":
            existing = self.repository.find_active_signal_order(signal_id)
            if existing:
                return OrderSubmitResult(order=existing, message="该信号已经下单，已返回已有订单。", duplicate=True)
            raise TradingError("该信号当前不可下单。", "ORDER_DUPLICATED", f"signal_id={signal_id}; status={signal.status}", "请刷新信号列表后再操作。")
        existing = self.repository.find_active_signal_order(signal_id)
        if existing:
            return OrderSubmitResult(order=existing, message="该信号已经下单，已返回已有订单。", duplicate=True)
        account = self._require_account()
        price = request.price or signal.price
        quantity = request.quantity or self._quantity_from_amount(signal.amount, price)
        self._validate_order(signal.symbol, signal.action, price, quantity)
        self._validate_buy_sell_capacity(account.available_cash, signal.symbol, signal.action, price, quantity)
        idempotency_key = self._idempotency_key(account.account_id, signal.symbol, signal.action, price, quantity, "signal", signal_id)
        duplicate = self.repository.find_order_by_idempotency(idempotency_key)
        if duplicate:
            self.repository.update_signal_ordered(signal_id, duplicate.local_order_id)
            return OrderSubmitResult(order=duplicate, message="检测到重复请求，已关联已有订单。", duplicate=True)
        order = self._create_and_submit_order(
            account_id=account.account_id,
            symbol=signal.symbol,
            name=signal.name or self._stock_name(signal.symbol),
            side=signal.action,
            price=price,
            quantity=quantity,
            source="signal",
            strategy_id=str(signal.strategy_id),
            signal_id=str(signal_id),
            idempotency_key=idempotency_key,
        )
        self.system_repository.add_operation_log("交易执行", "信号下单", "strategy_signal", str(signal_id), "成功", f"已从策略信号生成委托：{order.local_order_id}")
        return OrderSubmitResult(order=order, message="信号委托已提交到测试隔离交易适配器。")

    def ignore_signal(self, signal_id: int) -> TradingSignalRecord:
        self._get_signal_or_error(signal_id)
        signal = self.repository.ignore_signal(signal_id)
        self.repository.add_log(None, "info", f"已忽略策略信号：{signal.symbol} {signal.action}", f"signal_id={signal_id}")
        self.system_repository.add_operation_log("交易执行", "忽略信号", "strategy_signal", str(signal_id), "成功", f"已忽略策略信号：{signal.symbol}")
        return signal

    def cancel_order(self, local_order_id: str) -> TradingOrderRecord:
        self._ensure_trading_mode_allows_submit()
        order = self._get_order_or_error(local_order_id)
        if order.status not in CANCELABLE_ORDER_STATUSES:
            raise TradingError("当前委托状态不可撤单。", "ORDER_CANCEL_FAILED", f"{local_order_id}; status={order.status}", "只有待提交、已提交、已报、部分成交可以撤单。")
        try:
            result = self.adapter.cancel_order(order.qmt_order_id)
            updated = self.repository.update_order_status(local_order_id, str(result["status"]), str(result.get("qmt_status")))
            self.repository.add_log(local_order_id, "info", "撤单成功。", TEST_ISOLATION_TRADING_DETAIL)
            self.system_repository.add_operation_log("交易执行", "撤单", "order_record", local_order_id, "成功", "测试隔离交易撤单成功。")
            return updated
        except Exception as exc:
            detail = traceback.format_exc()
            updated = self.repository.update_order_status(local_order_id, "失败")
            self.repository.add_log(local_order_id, "error", "撤单失败。", detail)
            self.system_repository.add_operation_log("交易执行", "撤单", "order_record", local_order_id, "失败", "撤单失败。", detail)
            raise TradingError("撤单失败。", "ORDER_CANCEL_FAILED", repr(exc), "请稍后同步委托状态或复制错误给 AI 排查。") from exc

    def list_positions(self, query: PageQuery) -> PageResult[TradingPosition]:
        return self.repository.list_current_positions(query, self._trading_account_filter())

    def list_orders(self, query: PageQuery) -> PageResult[TradingOrderRecord]:
        return self.repository.list_orders(query, self._trading_account_filter())

    def list_trades(self, query: PageQuery) -> PageResult[TradingTradeRecord]:
        return self.repository.list_trades(query, self._trading_account_filter())

    def list_signals(self, query: PageQuery) -> PageResult[TradingSignalRecord]:
        return self.repository.list_signals(query)

    def list_logs(self, query: PageQuery) -> PageResult[ExecutionLogRecord]:
        return self.repository.list_logs(query, self._trading_account_filter())

    def create_order_sync_task(self) -> TaskCreated:
        self._ensure_trading_mode_allows_test_isolation_sync()
        task = self.system_repository.create_task("trading_order_sync", "正在同步委托状态。")
        self.system_repository.add_operation_log("交易执行", "同步委托", "runtime_task", task.task_id, "成功", "已创建委托状态同步任务。")
        return TaskCreated(task_id=task.task_id, task_type=task.task_type, status=task.status, progress=task.progress, message=task.message)

    def run_order_sync_task(self, task_id: str) -> None:
        try:
            self.system_service.ensure_not_cancelled(task_id)
            rows = self.repository.all_orders_for_sync(self._trading_account_filter())
            changed = 0
            for row in rows:
                self.system_service.ensure_not_cancelled(task_id)
                result = self.adapter.sync_order_status(row)
                before = row.get("status")
                updated = self.repository.update_order_status(
                    str(row["local_order_id"]),
                    str(result["status"]),
                    str(result.get("qmt_status")),
                    int(row["quantity"]) if result["status"] == "全部成交" else None,
                )
                if updated.status != before:
                    changed += 1
                    self.repository.add_log(updated.local_order_id, "info", f"委托状态同步为：{updated.status}", TEST_ISOLATION_TRADING_DETAIL)
            self.system_service.finish_task_if_active(task_id, "success", 100, f"委托同步完成，更新 {changed} 笔。", TEST_ISOLATION_TRADING_DETAIL, finished=True)
            self.system_repository.add_operation_log("交易执行", "同步委托完成", "runtime_task", task_id, "成功", f"委托同步完成，更新 {changed} 笔。", TEST_ISOLATION_TRADING_DETAIL)
        except TaskCancelledError:
            return
        except Exception as exc:
            if not self.system_repository.is_task_cancelled(task_id):
                self.system_service.finish_task_if_active(task_id, "failed", 100, "委托同步失败。", traceback.format_exc(), finished=True)
                raise exc

    def create_trade_sync_task(self) -> TaskCreated:
        self._ensure_trading_mode_allows_test_isolation_sync()
        task = self.system_repository.create_task("trading_trade_sync", "正在同步成交记录。")
        self.system_repository.add_operation_log("交易执行", "同步成交", "runtime_task", task.task_id, "成功", "已创建成交同步任务。")
        return TaskCreated(task_id=task.task_id, task_type=task.task_type, status=task.status, progress=task.progress, message=task.message)

    def run_trade_sync_task(self, task_id: str) -> None:
        try:
            self.system_service.ensure_not_cancelled(task_id)
            rows = self.repository.all_orders_for_sync(self._trading_account_filter())
            created = 0
            for row in rows:
                self.system_service.ensure_not_cancelled(task_id)
                trade = self.adapter.build_test_isolation_trade(row)
                if trade and not self.repository.has_trade_for_order(str(row["local_order_id"])):
                    self.repository.upsert_trade_and_apply_effect(trade)
                    self.repository.add_log(str(row["local_order_id"]), "info", "成交记录同步完成。", TEST_ISOLATION_TRADING_DETAIL)
                    created += 1
            self.system_service.finish_task_if_active(task_id, "success", 100, f"成交同步完成，处理 {created} 笔。", TEST_ISOLATION_TRADING_DETAIL, finished=True)
            self.system_repository.add_operation_log("交易执行", "同步成交完成", "runtime_task", task_id, "成功", f"成交同步完成，处理 {created} 笔。", TEST_ISOLATION_TRADING_DETAIL)
        except TaskCancelledError:
            return
        except Exception as exc:
            if not self.system_repository.is_task_cancelled(task_id):
                self.system_service.finish_task_if_active(task_id, "failed", 100, "成交同步失败。", traceback.format_exc(), finished=True)
                raise exc

    def _create_and_submit_order(
        self,
        account_id: str,
        symbol: str,
        name: str,
        side: str,
        price: float,
        quantity: int,
        source: str,
        strategy_id: str | None,
        signal_id: str | None,
        idempotency_key: str,
    ) -> TradingOrderRecord:
        local_order_id = f"order_{uuid4().hex[:12]}"
        order_row = {
            "local_order_id": local_order_id,
            "account_id": account_id,
            "symbol": symbol,
            "name": name,
            "side": side,
            "price": price,
            "quantity": quantity,
            "status": "待提交",
            "source": source,
            "strategy_id": strategy_id,
            "signal_id": signal_id,
            "idempotency_key": idempotency_key,
        }
        try:
            if signal_id is not None:
                order = self.repository.create_signal_order(order_row, int(signal_id))
            else:
                order = self.repository.create_order(order_row)
        except (sqlite3.IntegrityError, ValueError):
            duplicate = self.repository.find_order_by_idempotency(idempotency_key)
            if duplicate:
                return duplicate
            if signal_id is not None:
                existing = self.repository.find_active_signal_order(int(signal_id))
                if existing:
                    return existing
            raise TradingError("检测到重复下单请求。", "ORDER_DUPLICATED", f"source={source}; signal_id={signal_id}", "请刷新委托记录，系统已阻止重复提交。")
        self.repository.add_log(local_order_id, "info", "已创建本地订单，准备提交测试隔离交易适配器。")
        try:
            result = self.adapter.place_order(order.model_dump())
            updated = self.repository.update_order_submit(local_order_id, str(result.get("qmt_order_id")), str(result["status"]), str(result.get("qmt_status")))
            self.repository.add_log(local_order_id, "info", "委托已提交到测试隔离交易适配器。", TEST_ISOLATION_TRADING_DETAIL)
            return updated
        except Exception as exc:
            detail = traceback.format_exc()
            updated = self.repository.update_order_status(local_order_id, "失败")
            if signal_id is not None:
                self.repository.mark_signal_order_failed(int(signal_id), local_order_id)
            self.repository.add_log(local_order_id, "error", "委托提交失败。", detail)
            self.system_repository.add_operation_log("交易执行", "提交委托", "order_record", local_order_id, "失败", "委托提交失败。", detail)
            raise TradingError("委托提交失败。", "ORDER_SUBMIT_FAILED", repr(exc), "请检查 QMT 状态或复制错误给 AI 排查。") from exc

    def _validate_order(self, symbol: str, side: str, price: float, quantity: int) -> None:
        if len(symbol) != 9 or symbol[6] != "." or symbol[:6].isdigit() is False or symbol[7:] not in {"SH", "SZ", "BJ"}:
            raise TradingError("股票代码格式不正确。", "ORDER_SUBMIT_FAILED", symbol, "请使用 600000.SH / 000001.SZ / 430000.BJ 这样的标准代码。")
        if side not in {"BUY", "SELL"}:
            raise TradingError("买卖方向不正确。", "ORDER_SUBMIT_FAILED", side, "方向只能是 BUY 或 SELL。")
        if quantity % 100 != 0:
            raise TradingError("委托数量必须是 100 股的整数倍。", "ORDER_SUBMIT_FAILED", str(quantity), "A 股普通委托按一手 100 股检查。")
        amount = price * quantity
        max_order_amount = self.system_service.get_config().max_order_amount
        if amount > max_order_amount:
            raise TradingError("委托金额超过系统设置的最大单笔金额。", "ORDER_SUBMIT_FAILED", f"amount={amount}; max={max_order_amount}", "请到系统管理调整最大单笔金额，或降低数量。")

    def _ensure_trading_mode_allows_submit(self) -> None:
        config = self.system_service.get_config()
        if not config.simulation_mode:
            raise TradingError(
                "真实 QMT 下单暂未启用。",
                "REAL_TRADING_NOT_ENABLED",
                "simulation_mode=false; real_order_submitted=false",
                "当前阶段只做真实 QMT 只读验收。请先完成账户、持仓、委托、成交核对；真实小额下单需单独人工确认后再开启。",
            )

    def _ensure_trading_mode_allows_test_isolation_sync(self) -> None:
        config = self.system_service.get_config()
        if not config.simulation_mode:
            raise TradingError(
                "真实 QMT 交易中心同步暂未启用。",
                "REAL_TRADING_SYNC_DISABLED",
                "simulation_mode=false; real_order_submitted=false; use_data_center_readonly_sync=true",
                "真实 QMT 验收阶段请到数据中心执行账户、持仓、委托、成交只读同步；交易执行页只展示结果，不调用测试隔离同步器。",
            )

    def _trading_account_filter(self) -> str | None:
        config = self.system_service.get_config()
        if config.simulation_mode:
            return TEST_ISOLATION_TRADING_ACCOUNT_ID
        return config.account_id or None

    def _validate_buy_sell_capacity(self, available_cash: float, symbol: str, side: str, price: float, quantity: int) -> None:
        amount = price * quantity
        if side == "BUY" and amount > available_cash:
            raise TradingError("可用资金不足。", "ORDER_SUBMIT_FAILED", f"amount={amount}; available={available_cash}", "请降低下单金额或先同步账户资金。")
        if side == "SELL":
            position = self.repository.get_position(symbol, self._trading_account_filter())
            if not position or position.available_quantity < quantity:
                available = position.available_quantity if position else 0
                raise TradingError("可卖数量不足。", "ORDER_SUBMIT_FAILED", f"quantity={quantity}; available={available}", "请降低卖出数量或先同步持仓。")

    def _require_account(self):
        account = self.repository.latest_account(self._trading_account_filter())
        if not account:
            raise TradingError("暂无账户资金数据。", "ORDER_SUBMIT_FAILED", "account_snapshot empty", "请先到数据中心执行当前模式的数据同步。")
        return account

    def _stock_name(self, symbol: str) -> str:
        stock = self.repository.get_stock(symbol)
        quote = self.repository.latest_quote(symbol)
        return stock.name if stock else quote.name if quote else symbol

    def _quantity_from_amount(self, amount: float | None, price: float) -> int:
        configured = self.system_service.get_config().default_order_amount
        raw_amount = amount or configured
        quantity = int(raw_amount / price / 100) * 100
        return max(quantity, 100)

    def _idempotency_key(self, account_id: str, symbol: str, side: str, price: float, quantity: int, source: str, signal_id: int | None) -> str:
        window = "" if signal_id else str(int(time.time() // 60))
        raw = f"{account_id}|{symbol}|{side}|{price:.4f}|{quantity}|{source}|{signal_id or ''}|{window}"
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    def _get_signal_or_error(self, signal_id: int) -> TradingSignalRecord:
        try:
            return self.repository.get_signal(signal_id)
        except KeyError as exc:
            raise TradingError("交易信号不存在。", "TRADING_SIGNAL_NOT_FOUND", str(exc), "请刷新信号列表后重试。", status_code=404) from exc

    def _get_order_or_error(self, local_order_id: str) -> TradingOrderRecord:
        try:
            return self.repository.get_order(local_order_id)
        except KeyError as exc:
            raise TradingError("委托订单不存在。", "ORDER_NOT_FOUND", str(exc), "请刷新委托列表后重试。", status_code=404) from exc

