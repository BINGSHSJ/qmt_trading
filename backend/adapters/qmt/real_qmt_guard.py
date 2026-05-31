import importlib
import subprocess
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from backend.adapters.qmt.qmt_import_path import ensure_xtquant_import_path, find_xtquant_spec


PLACEHOLDER_ACCOUNT_IDS = {"", "mock", "mock_account", "test", "test_account", "test_isolation_account", "demo"}
MINI_QMT_PROCESS_NAMES = ("XtMiniQmt.exe", "XtItClient.exe")


@dataclass(frozen=True)
class QmtGuardItem:
    check_item: str
    status: str
    message: str
    suggestion: str | None = None
    technical_detail: str | None = None

    def as_environment_result(self) -> dict[str, str | None]:
        return {
            "check_item": self.check_item,
            "status": self.status,
            "message": self.message,
            "suggestion": self.suggestion,
            "technical_detail": self.technical_detail,
        }


class RealQmtReadOnlyGuard:
    """Real QMT acceptance guard.

    The guard only checks prerequisites and marks read-only steps for manual
    validation. It never submits a real order and keeps test adapters untouched.
    """

    def __init__(
        self,
        qmt_path: str,
        account_id: str,
        simulation_mode: bool,
        order_confirm_required: bool,
        max_order_amount: float,
        timeout_seconds: int = 5,
    ) -> None:
        self.qmt_path = qmt_path
        self.account_id = account_id
        self.simulation_mode = simulation_mode
        self.order_confirm_required = order_confirm_required
        self.max_order_amount = max_order_amount
        self.timeout_seconds = timeout_seconds

    def build_environment_items(self) -> list[QmtGuardItem]:
        bundled_site_packages = ensure_xtquant_import_path(self.qmt_path)
        path = Path(self.qmt_path).expanduser() if self.qmt_path else None
        qmt_path_ok = bool(path and path.exists())
        account_value = self.account_id.strip()
        account_ok = bool(account_value) and account_value.lower() not in PLACEHOLDER_ACCOUNT_IDS
        xtquant_spec = find_xtquant_spec(self.qmt_path)
        xtquant_ok = xtquant_spec is not None
        xtdata = self._check_module("xtquant.xtdata", xtquant_ok)
        xttrader = self._check_module("xtquant.xttrader", xtquant_ok)
        prereq_ok = qmt_path_ok and account_ok and xtquant_ok and xtdata.status == "success" and xttrader.status == "success"
        real_required = not self.simulation_mode

        return [
            QmtGuardItem(
                check_item="QMT路径是否存在",
                status="success" if qmt_path_ok else ("failed" if real_required else "warning"),
                message="QMT 路径存在。" if qmt_path_ok else "尚未配置有效 QMT 路径。",
                suggestion=None if qmt_path_ok else "请在基础设置中填写本机 QMT / MiniQMT 路径。",
                technical_detail=str(path) if path else "qmt_path is empty",
            ),
            QmtGuardItem(
                check_item="QMT账户ID是否配置",
                status="success" if account_ok else ("failed" if real_required else "warning"),
                message="QMT 账户 ID 已配置。" if account_ok else "尚未配置真实 QMT 账户 ID，或仍使用测试隔离占位账户。",
                suggestion=None if account_ok else "请在系统管理的基础设置中填写真实 QMT 账户 ID；不要使用测试隔离占位账号 test_isolation_account 或旧占位账号 mock_account。",
                technical_detail=f"account_id_configured={account_ok}; placeholder={account_value.lower() in PLACEHOLDER_ACCOUNT_IDS}",
            ),
            self._check_miniqmt_process(),
            QmtGuardItem(
                check_item="xtquant是否可导入",
                status="success" if xtquant_ok else ("failed" if real_required else "warning"),
                message="当前 Python 环境可导入 xtquant。" if xtquant_ok else "当前 Python 环境未检测到 xtquant。",
                suggestion=None if xtquant_ok else "接真实 QMT 前，请在后端 Python 环境安装 xtquant。",
                technical_detail=f"module=xtquant; found={xtquant_ok}; bundled_site_packages={bundled_site_packages}; spec={xtquant_spec}",
            ),
            xtdata,
            xttrader,
            self._readonly_item("是否能查询资产", prereq_ok, self._probe_asset),
            self._readonly_item("是否能查询持仓", prereq_ok, self._probe_positions),
            self._readonly_item("是否能查询委托", prereq_ok, self._probe_orders),
            self._readonly_item("是否能查询成交", prereq_ok, self._probe_trades),
            self._readonly_item("是否能获取行情", prereq_ok, self._probe_quote),
            self._readonly_item("是否能读取交易日历", prereq_ok, self._probe_trading_calendar),
            self._readonly_item("是否能读取日K小范围", prereq_ok, self._probe_daily_kline),
            QmtGuardItem(
                check_item="交易接口是否被保护",
                status="warning",
                message="真实 QMT 只读阶段交易接口处于保护状态，不会提交真实下单。",
                suggestion="如需真实下单验收，只允许人工确认、小额、明确记录，不允许自动批量交易。",
                technical_detail=(
                    "real_order_submitted=false; "
                    f"order_confirm_required={self.order_confirm_required}; "
                    f"max_order_amount={self.max_order_amount}; "
                    f"simulation_mode={self.simulation_mode}"
                ),
            ),
        ]

    def _check_module(self, module_name: str, xtquant_ok: bool) -> QmtGuardItem:
        if not xtquant_ok:
            return QmtGuardItem(
                check_item=f"{module_name} 模块",
                status="failed" if not self.simulation_mode else "warning",
                message=f"未检测到 {module_name}，真实 QMT 验收无法自动继续。",
                suggestion="请先安装并确认 xtquant 与当前 Python 环境一致。",
                technical_detail=f"module={module_name}; xtquant_found=false",
            )

        try:
            module = self._run_with_timeout(lambda: importlib.import_module(module_name))
            return QmtGuardItem(
                check_item=f"{module_name} 模块",
                status="success",
                message=f"{module_name} 可导入。",
                technical_detail=f"module={module_name}; file={getattr(module, '__file__', None)}",
            )
        except FutureTimeoutError:
            return QmtGuardItem(
                check_item=f"{module_name} 模块",
                status="failed" if not self.simulation_mode else "warning",
                message=f"导入 {module_name} 超时。",
                suggestion="请确认 xtquant 安装完整，必要时重启后端再检测。",
                technical_detail=f"module={module_name}; timeout_seconds={self.timeout_seconds}",
            )
        except Exception as exc:
            return QmtGuardItem(
                check_item=f"{module_name} 模块",
                status="failed" if not self.simulation_mode else "warning",
                message=f"导入 {module_name} 失败。",
                suggestion="请确认 xtquant 版本和 QMT 客户端安装状态。",
                technical_detail=repr(exc),
            )

    def _check_miniqmt_process(self) -> QmtGuardItem:
        try:
            completed = subprocess.run(
                ["tasklist", "/FO", "CSV"],
                capture_output=True,
                text=True,
                errors="ignore",
                timeout=3,
                check=False,
            )
            output = completed.stdout or ""
            matched = [name for name in MINI_QMT_PROCESS_NAMES if name.lower() in output.lower()]
            if matched:
                return QmtGuardItem(
                    check_item="MiniQMT是否启动",
                    status="success",
                    message="检测到 MiniQMT 客户端进程，请继续确认客户端内账户已登录。",
                    suggestion="如页面仍提示真实 QMT 异常，请在 MiniQMT 客户端确认券商连接状态后重试。",
                    technical_detail=f"process_detected={','.join(matched)}; simulation_mode={self.simulation_mode}; real_order_submitted=false",
                )
            return QmtGuardItem(
                check_item="MiniQMT是否启动",
                status="warning",
                message="未检测到 MiniQMT 客户端进程，或进程名称不在识别范围内。",
                suggestion="真实验收前请先打开 MiniQMT，并确认账户已登录；如果客户端已打开，可继续以只读查询结果为准。",
                technical_detail=f"process_detected=false; expected={','.join(MINI_QMT_PROCESS_NAMES)}; simulation_mode={self.simulation_mode}; real_order_submitted=false",
            )
        except Exception as exc:
            return QmtGuardItem(
                check_item="MiniQMT是否启动",
                status="warning",
                message="MiniQMT 进程检测未完成，但不会影响测试隔离回归和后续只读验收。",
                suggestion="请在客户端人工确认 MiniQMT 已启动并登录；如仍异常，请复制技术详情给 AI 排查。",
                technical_detail=f"{exc!r}; simulation_mode={self.simulation_mode}; real_order_submitted=false",
            )

    def _readonly_item(self, check_item: str, prereq_ok: bool, probe: Callable[[], str]) -> QmtGuardItem:
        if self.simulation_mode:
            return QmtGuardItem(
                check_item=check_item,
                status="warning",
                message=f"{check_item}：当前为测试隔离模式，未调用真实 QMT。",
                suggestion="真实验收时请先关闭测试隔离模式，再按只读验证顺序执行。",
                technical_detail="test_isolation=true; real_qmt_readonly_attempted=false",
            )
        if not prereq_ok:
            return QmtGuardItem(
                check_item=check_item,
                status="failed",
                message=f"{check_item}：真实 QMT 前置条件未通过，未执行只读查询。",
                suggestion="请先修复 QMT 路径、账户 ID、xtquant 导入和 MiniQMT 登录状态。",
                technical_detail="real_qmt_readonly_attempted=false; prerequisites_ok=false",
            )
        try:
            detail = self._run_with_timeout(probe)
            return QmtGuardItem(
                check_item=check_item,
                status="success",
                message=f"{check_item}：真实 QMT 只读查询成功，未提交任何委托。",
                suggestion="请与 MiniQMT 页面核对数值；核对通过后再继续小范围同步。",
                technical_detail=f"real_qmt_readonly_attempted=true; real_order_submitted=false; {detail}",
            )
        except FutureTimeoutError:
            return QmtGuardItem(
                check_item=check_item,
                status="failed",
                message=f"{check_item}：真实 QMT 只读查询超时。",
                suggestion="请确认 MiniQMT 已登录且交易/行情服务可用，稍后重试。",
                technical_detail=f"timeout_seconds={self.timeout_seconds}; real_order_submitted=false",
            )
        except Exception as exc:
            return QmtGuardItem(
                check_item=check_item,
                status="failed",
                message=f"{check_item}：真实 QMT 只读查询失败。",
                suggestion="请确认 QMT 路径、账户 ID、MiniQMT 登录状态和券商连接状态。",
                technical_detail=f"{exc!r}; real_order_submitted=false",
            )

    def _userdata_path(self) -> str:
        root = Path(self.qmt_path).expanduser()
        for name in ("userdata_mini", "userdata"):
            candidate = root / name
            if candidate.exists():
                return str(candidate)
        return str(root)

    def _with_trader(self, query: Callable[[object, object], str]) -> str:
        from random import randint

        from xtquant.xttrader import XtQuantTrader
        from xtquant.xttype import StockAccount

        trader = XtQuantTrader(self._userdata_path(), randint(100000, 999999))
        try:
            trader.start()
            connect_result = trader.connect()
            if connect_result != 0:
                raise RuntimeError(f"connect_result={connect_result}")
            account = StockAccount(self.account_id.strip())
            subscribe_result = trader.subscribe(account)
            if subscribe_result != 0:
                raise RuntimeError(f"subscribe_result={subscribe_result}")
            return query(trader, account)
        finally:
            stop = getattr(trader, "stop", None)
            if callable(stop):
                try:
                    stop()
                except Exception:
                    pass

    def _probe_asset(self) -> str:
        def query(trader: object, account: object) -> str:
            asset = trader.query_stock_asset(account)
            if asset is None:
                raise RuntimeError("asset is None")
            return (
                f"account_id={getattr(asset, 'account_id', self.account_id)}; "
                f"total_asset={getattr(asset, 'total_asset', None)}; "
                f"cash={getattr(asset, 'cash', None)}; "
                f"market_value={getattr(asset, 'market_value', None)}"
            )

        return self._with_trader(query)

    def _probe_positions(self) -> str:
        def query(trader: object, account: object) -> str:
            positions = trader.query_stock_positions(account)
            if positions is None:
                raise RuntimeError("positions is None")
            return f"position_count={len(positions)}"

        return self._with_trader(query)

    def _probe_orders(self) -> str:
        def query(trader: object, account: object) -> str:
            orders = trader.query_stock_orders(account, False)
            if orders is None:
                raise RuntimeError("orders is None")
            cancelable_orders = trader.query_stock_orders(account, True)
            cancelable_count = len(cancelable_orders or [])
            return f"order_count={len(orders)}; cancelable_order_count={cancelable_count}"

        return self._with_trader(query)

    def _probe_trades(self) -> str:
        def query(trader: object, account: object) -> str:
            trades = trader.query_stock_trades(account)
            if trades is None:
                raise RuntimeError("trades is None")
            return f"trade_count={len(trades)}"

        return self._with_trader(query)

    def _probe_quote(self) -> str:
        from xtquant import xtdata

        tick = xtdata.get_full_tick(["600000.SH"])
        if not isinstance(tick, dict):
            raise RuntimeError(f"unexpected_tick_type={type(tick)}")
        return f"symbol=600000.SH; quote_keys={list(tick.keys())[:3]}"

    def _probe_trading_calendar(self) -> str:
        from xtquant import xtdata

        try:
            dates = xtdata.get_trading_calendar("SH", "20260506", "20260508")
        except TypeError:
            dates = xtdata.get_trading_dates("SH", "20260506", "20260508", -1)
        if dates is None:
            raise RuntimeError("trading_calendar is None")
        return f"market=SH; start=20260506; end=20260508; trading_days={len(dates)}"

    def _probe_daily_kline(self) -> str:
        from xtquant import xtdata

        fields = ["time", "open", "high", "low", "close", "volume", "amount"]
        data = xtdata.get_market_data_ex(
            fields,
            ["600000.SH"],
            period="1d",
            start_time="20260506",
            end_time="20260508",
            count=-1,
            dividend_type="none",
            fill_data=True,
        )
        if not isinstance(data, dict):
            raise RuntimeError(f"unexpected_market_data_type={type(data)}")
        frame = data.get("600000.SH")
        row_count = 0
        iterrows = getattr(frame, "iterrows", None)
        if callable(iterrows):
            row_count = sum(1 for _ in iterrows())
        return f"symbol=600000.SH; period=1d; start=20260506; end=20260508; row_count={row_count}"

    def _run_with_timeout(self, func: Callable[[], object]) -> object:
        executor = ThreadPoolExecutor(max_workers=1)
        future = executor.submit(func)
        try:
            return future.result(timeout=self.timeout_seconds)
        except Exception:
            future.cancel()
            raise
        finally:
            executor.shutdown(wait=False, cancel_futures=True)
