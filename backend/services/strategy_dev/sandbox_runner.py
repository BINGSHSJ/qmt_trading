import ast
import io
import builtins
import multiprocessing
import queue
import time
import traceback
from contextlib import redirect_stderr, redirect_stdout
from typing import Any, Callable


class StrategyExecutionTimeout(TimeoutError):
    pass


class StrategyExecutionCancelled(RuntimeError):
    pass


class StrategyExecutionFailed(RuntimeError):
    pass


BLOCKED_IMPORT_PREFIXES = (
    "xtquant",
    "sqlite3",
    "os",
    "pathlib",
    "shutil",
    "subprocess",
    "socket",
    "requests",
    "httpx",
    "urllib",
    "backend.adapters",
    "backend.core",
    "backend.repositories",
    "backend.services.trading_center",
    "backend.services.data_center",
    "backend.services.system",
    "backend.services.backtest_center",
)

BLOCKED_BUILTINS = {
    "open", "input", "eval", "exec", "compile", "breakpoint", "help", "quit", "exit",
    "setattr", "delattr", "dir", "vars", "locals", "globals"
}



def run_strategy_code(
    code: str,
    file_name: str,
    timeout_seconds: int,
    cancel_check: Callable[[], bool] | None = None,
) -> tuple[list[dict[str, Any]], list[str]]:
    context = multiprocessing.get_context("spawn")
    result_queue = context.Queue()
    process = context.Process(target=_strategy_worker, args=(code, file_name, result_queue))
    process.start()
    deadline = time.monotonic() + timeout_seconds
    while process.is_alive():
        if cancel_check and cancel_check():
            process.terminate()
            process.join(3)
            raise StrategyExecutionCancelled("strategy run cancelled")
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            process.terminate()
            process.join(3)
            raise StrategyExecutionTimeout(f"strategy timeout after {timeout_seconds} seconds")
        process.join(min(0.2, remaining))
    try:
        # 子进程退出与 multiprocessing feeder 线程刷盘之间存在时序窗口，
        # 结果对象较大时尤其明显；用带超时的 get 等待刷盘完成，避免把成功运行误判为失败。
        result = result_queue.get(timeout=5)
    except queue.Empty as exc:
        raise StrategyExecutionFailed(f"strategy process exited with code {process.exitcode}") from exc
    if result["status"] != "success":
        raise StrategyExecutionFailed(str(result["detail"]))
    return result["signals"], result["logs"]


class StrategySecurityError(ValueError):
    pass


class StrategyASTValidator(ast.NodeVisitor):
    ALLOWED_DUNDERS = {"__init__", "__dict__", "__module__", "__weakref__"}

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if node.attr.startswith("__") and node.attr not in self.ALLOWED_DUNDERS:
            raise StrategySecurityError(
                f"策略安全边界：禁止访问非标准的双下划线属性或方法 '{node.attr}'，以防止沙箱逃逸。"
            )
        self.generic_visit(node)

    def visit_Name(self, node: ast.Name) -> None:
        if node.id.startswith("__") and node.id not in self.ALLOWED_DUNDERS:
            raise StrategySecurityError(
                f"策略安全边界：禁止访问或声明非标准的双下划线变量 '{node.id}'。"
            )
        self.generic_visit(node)


def validate_code_safety(code: str) -> None:
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        raise StrategySecurityError(f"策略语法错误：无法解析源码。详情: {e}") from e
    StrategyASTValidator().visit(tree)


def _safe_import(name: str, globals=None, locals=None, fromlist=(), level: int = 0):
    if level != 0:
        raise ImportError("策略安全边界：不允许使用相对导入。")
    normalized = name.lower()
    for prefix in BLOCKED_IMPORT_PREFIXES:
        if normalized == prefix or normalized.startswith(f"{prefix}."):
            raise ImportError(f"策略安全边界：不允许直接导入 {name}，请只通过 StrategyContext 读取数据。")
    return builtins.__import__(name, globals, locals, fromlist, level)


def _safe_getattr(obj: object, name: str, *default: object) -> object:
    if len(default) > 1:
        raise TypeError("getattr expected at most 3 arguments")
    if not isinstance(name, str):
        raise TypeError("attribute name must be string")
    if name.startswith("__"):
        raise StrategySecurityError(f"策略安全边界：禁止通过 getattr 访问双下划线属性 '{name}'。")
    if default:
        return getattr(obj, name, default[0])
    return getattr(obj, name)


def _safe_hasattr(obj: object, name: str) -> bool:
    try:
        _safe_getattr(obj, name)
    except AttributeError:
        return False
    return True


def _safe_builtins() -> dict[str, object]:
    allowed = dict(builtins.__dict__)
    for name in BLOCKED_BUILTINS:
        allowed.pop(name, None)
    allowed["__import__"] = _safe_import
    allowed["getattr"] = _safe_getattr
    allowed["hasattr"] = _safe_hasattr
    return allowed


def _strategy_worker(code: str, file_name: str, result_queue) -> None:
    from backend.services.strategy_dev.strategy_context import StrategyContext

    stdout = io.StringIO()
    stderr = io.StringIO()
    try:
        validate_code_safety(code)
        context = StrategyContext()
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
        result_queue.put({
            "status": "failed",
            "detail": traceback.format_exc(),
        })
