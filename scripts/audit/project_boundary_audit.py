from __future__ import annotations

import ast
import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]

REQUIRED_MENUS = ["总览看板", "数据中心", "策略开发", "回测研究", "交易执行", "系统管理"]

PROHIBITED_FRONTEND_DEPS = {
    "tailwindcss",
    "@tailwindcss/vite",
    "@mui/material",
    "@mui/icons-material",
    "@chakra-ui/react",
    "@emotion/react",
    "@emotion/styled",
    "shadcn-ui",
    "@shadcn/ui",
}

SKIP_DIRS = {
    ".git",
    ".venv",
    "__pycache__",
    "node_modules",
    "dist",
    "build",
    "playwright-report",
    "test-results",
}


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def iter_files(base: Path, suffixes: tuple[str, ...]):
    if not base.exists():
        return
    for path in base.rglob("*"):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.is_file() and path.suffix in suffixes:
            yield path


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT)).replace("\\", "/")


def add_matches(
    failures: list[str],
    path: Path,
    text: str,
    patterns: list[tuple[str, str]],
    allowed: callable | None = None,
) -> None:
    if allowed and allowed(path):
        return
    for label, pattern in patterns:
        for match in re.finditer(pattern, text, flags=re.IGNORECASE | re.MULTILINE):
            line_no = text.count("\n", 0, match.start()) + 1
            snippet = text.splitlines()[line_no - 1].strip()
            failures.append(f"{label}: {rel(path)}:{line_no}: {snippet}")


def check_package_dependencies(failures: list[str]) -> None:
    package_path = ROOT / "frontend" / "package.json"
    data = json.loads(read_text(package_path))
    deps: set[str] = set()
    for key in ("dependencies", "devDependencies", "optionalDependencies"):
        deps.update((data.get(key) or {}).keys())
    prohibited = sorted(deps & PROHIBITED_FRONTEND_DEPS)
    if prohibited:
        failures.append(f"prohibited frontend dependency: {', '.join(prohibited)}")


def check_fixed_menus(failures: list[str]) -> None:
    menu_path = ROOT / "frontend" / "src" / "app" / "menu.tsx"
    text = read_text(menu_path)
    labels = re.findall(r"label:\s*['\"]([^'\"]+)['\"]", text)
    if labels != REQUIRED_MENUS:
        failures.append(f"fixed menu mismatch in {rel(menu_path)}: {labels!r}")


def check_frontend_density_boundaries(failures: list[str]) -> None:
    patterns = [
        ("browser zoom is forbidden", r"\bzoom\s*:"),
        ("transform scale is forbidden", r"transform\s*:\s*scale\s*\("),
    ]
    for path in iter_files(ROOT / "frontend" / "src", (".css", ".ts", ".tsx")):
        add_matches(failures, path, read_text(path), patterns)


def check_api_layer_boundaries(failures: list[str]) -> None:
    patterns = [
        ("api layer must not import sqlite3", r"^\s*(import|from)\s+sqlite3\b"),
        ("api layer must not call database execute", r"\.(execute|executemany)\s*\("),
        ("api layer must not open database connection", r"\b(get_connection|sqlite3\.connect|create_engine|sessionmaker)\s*\("),
    ]
    for path in iter_files(ROOT / "backend" / "api", (".py",)):
        add_matches(failures, path, read_text(path), patterns)


def _literal_first_arg(call: ast.Call) -> str:
    if call.args and isinstance(call.args[0], ast.Constant) and isinstance(call.args[0].value, str):
        return call.args[0].value
    return ""


def _keyword_expr(call: ast.Call, name: str) -> str | None:
    for keyword in call.keywords:
        if keyword.arg == name:
            return ast.unparse(keyword.value)
    return None


def _router_decorators(function: ast.AsyncFunctionDef | ast.FunctionDef) -> list[tuple[str, str, ast.Call]]:
    decorators: list[tuple[str, str, ast.Call]] = []
    for decorator in function.decorator_list:
        if not isinstance(decorator, ast.Call):
            continue
        func = decorator.func
        if not isinstance(func, ast.Attribute):
            continue
        if not isinstance(func.value, ast.Name) or func.value.id != "router":
            continue
        if func.attr not in {"get", "post", "put", "patch", "delete"}:
            continue
        decorators.append((func.attr.upper(), _literal_first_arg(decorator), decorator))
    return decorators


def check_api_response_contracts(failures: list[str]) -> None:
    for path in iter_files(ROOT / "backend" / "api", (".py",)):
        tree = ast.parse(read_text(path))
        for node in ast.walk(tree):
            if not isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
                continue
            for method, route_path, call in _router_decorators(node):
                response_model = _keyword_expr(call, "response_model")
                returns = ast.unparse(node.returns) if node.returns else ""
                route_name = f"{method} {route_path or '/'} -> {node.name}"
                if "FileResponse" in returns:
                    if response_model is not None:
                        failures.append(f"file export route should not wrap FileResponse with ApiResponse: {rel(path)}:{node.lineno}: {route_name}")
                    continue
                if response_model is None or "ApiResponse" not in response_model:
                    failures.append(f"api route missing ApiResponse response_model: {rel(path)}:{node.lineno}: {route_name}")
                if "ApiResponse" not in returns:
                    failures.append(f"api route return annotation must be ApiResponse: {rel(path)}:{node.lineno}: {route_name}")


def check_long_task_contracts(failures: list[str]) -> None:
    task_routes = {
        "backend/api/data_center_api.py": {
            "sync_stock_basic",
            "sync_instrument_detail",
            "sync_trading_calendar",
            "sync_account",
            "sync_positions",
            "sync_orders",
            "sync_trades",
            "sync_daily_kline",
            "sync_minute_kline",
            "sync_all",
            "run_2026_sync",
            "sync_latest_data",
            "quality_check",
        },
        "backend/api/strategy_dev_api.py": {"run_strategy"},
        "backend/api/backtest_api.py": {"create_backtest", "rerun_backtest"},
        "backend/api/system_api.py": {"create_env_check", "create_backup", "restore_backup", "cleanup_maintenance"},
        "backend/api/trading_api.py": {"sync_orders", "sync_trades"},
    }
    for rel_path, functions in task_routes.items():
        path = ROOT / rel_path
        text = read_text(path)
        tree = ast.parse(text)
        found: set[str] = set()
        for node in ast.walk(tree):
            if not isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)) or node.name not in functions:
                continue
            found.add(node.name)
            returns = ast.unparse(node.returns) if node.returns else ""
            decorators = _router_decorators(node)
            response_models = [_keyword_expr(call, "response_model") or "" for _, _, call in decorators]
            body_text = ast.get_source_segment(text, node) or ""
            if "TaskCreated" not in returns or not any("TaskCreated" in item for item in response_models):
                failures.append(f"long task route must return ApiResponse[TaskCreated]: {rel_path}:{node.lineno}: {node.name}")
            schedules_background = "background_tasks.add_task" in body_text or "create_sync(" in body_text
            if not schedules_background and node.name not in {"create_backtest", "rerun_backtest"}:
                failures.append(f"long task route must schedule background task: {rel_path}:{node.lineno}: {node.name}")
            if node.name in {"create_backtest", "rerun_backtest"} and "_start_backtest_worker" not in body_text:
                failures.append(f"backtest long task route must start detached worker: {rel_path}:{node.lineno}: {node.name}")
        missing = sorted(functions - found)
        for name in missing:
            failures.append(f"long task route missing or renamed: {rel_path}: {name}")


def _function_arguments(function: ast.AsyncFunctionDef | ast.FunctionDef) -> list[tuple[ast.arg, ast.expr | None]]:
    positional_args = list(function.args.posonlyargs) + list(function.args.args)
    positional_defaults: list[ast.expr | None] = [None] * (len(positional_args) - len(function.args.defaults)) + list(function.args.defaults)
    items = list(zip(positional_args, positional_defaults))
    items.extend(zip(function.args.kwonlyargs, function.args.kw_defaults))
    return items


def _query_le_value(default: ast.expr | None) -> int | None:
    if not isinstance(default, ast.Call):
        return None
    func_name = ast.unparse(default.func)
    if func_name != "Query":
        return None
    for keyword in default.keywords:
        if keyword.arg == "le" and isinstance(keyword.value, ast.Constant) and isinstance(keyword.value.value, int):
            return keyword.value.value
    return None


def check_pagination_contracts(failures: list[str]) -> None:
    common_schema_path = ROOT / "backend" / "schemas" / "common.py"
    common_text = read_text(common_schema_path)
    if "page_size: int = Field(default=20, ge=1, le=200)" not in common_text:
        failures.append(f"PageQuery page_size must stay bounded to <= 200: {rel(common_schema_path)}")

    for path in iter_files(ROOT / "backend" / "api", (".py",)):
        tree = ast.parse(read_text(path))
        for node in ast.walk(tree):
            if not isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
                continue
            decorators = _router_decorators(node)
            if not decorators:
                continue
            for method, route_path, call in decorators:
                response_model = _keyword_expr(call, "response_model") or ""
                returns = ast.unparse(node.returns) if node.returns else ""
                if "PageResult" not in response_model and "PageResult" not in returns:
                    continue
                route_name = f"{method} {route_path or '/'} -> {node.name}"
                uses_bounded_page_query = False
                saw_explicit_page_size = False
                for argument, default in _function_arguments(node):
                    annotation = ast.unparse(argument.annotation) if argument.annotation else ""
                    default_expr = ast.unparse(default) if default is not None else ""
                    if "PageQuery" in annotation and "Depends(page_query)" in default_expr:
                        uses_bounded_page_query = True
                    if argument.arg == "page_size":
                        saw_explicit_page_size = True
                        le_value = _query_le_value(default)
                        if le_value is None or le_value > 200:
                            failures.append(f"paged route page_size must use Query(..., le<=200): {rel(path)}:{node.lineno}: {route_name}")
                        else:
                            uses_bounded_page_query = True
                if not uses_bounded_page_query:
                    detail = "missing PageQuery Depends(page_query) or explicit bounded page_size"
                    if saw_explicit_page_size:
                        detail = "explicit page_size is not bounded correctly"
                    failures.append(f"paged route must be bounded: {rel(path)}:{node.lineno}: {route_name}; {detail}")


def check_qmt_adapter_boundary(failures: list[str]) -> None:
    patterns = [
        ("real QMT import/call outside adapter", r"^\s*(from|import)\s+xtquant\b"),
        ("xtdata direct call outside adapter", r"\bxtdata\."),
        ("xttrader direct call outside adapter", r"\bxttrader\."),
        ("XtQuantTrader outside adapter", r"\bXtQuantTrader\b"),
        ("StockAccount outside adapter", r"\bStockAccount\b"),
    ]

    def allowed(path: Path) -> bool:
        rel_path = rel(path)
        return rel_path.startswith("backend/adapters/qmt/")

    for path in iter_files(ROOT / "backend", (".py",)):
        if "/tests/" in f"/{rel(path)}/":
            continue
        add_matches(failures, path, read_text(path), patterns, allowed=allowed)


def check_strategy_boundaries(failures: list[str]) -> None:
    patterns = [
        ("strategy must not import sqlite3/os/network/qmt/backend internals", r"^\s*(import|from)\s+(sqlite3|os|pathlib|shutil|subprocess|socket|requests|httpx|urllib|xtquant|backend\.)\b"),
        ("strategy must not open database connection", r"\b(sqlite3\.connect|get_connection)\s*\("),
        ("strategy must not call trading APIs", r"\b(order_stock|cancel_order_stock|submit_order|place_order|TradingService|QmtTrade)\b"),
    ]
    for path in iter_files(ROOT / "strategies", (".py",)):
        add_matches(failures, path, read_text(path), patterns)


def check_system_safety_defaults(failures: list[str]) -> None:
    path = ROOT / "backend" / "schemas" / "system.py"
    text = read_text(path)
    required = [
        ("real qmt must be default business mode", "simulation_mode: bool = False"),
        ("order confirm must be enabled by default", "order_confirm_required: bool = True"),
        ("intraday auto run must be disabled by default", "intraday_auto_run: bool = False"),
    ]
    for label, needle in required:
        if needle not in text:
            failures.append(f"{label}: missing `{needle}` in {rel(path)}")


def check_strategy_sandbox_contract(failures: list[str]) -> None:
    path = ROOT / "backend" / "services" / "strategy_dev" / "sandbox_runner.py"
    text = read_text(path)
    required_import_blocks = [
        "xtquant",
        "sqlite3",
        "os",
        "pathlib",
        "subprocess",
        "socket",
        "requests",
        "httpx",
        "backend.adapters",
        "backend.repositories",
        "backend.services.trading_center",
    ]
    required_builtin_blocks = [
        "open",
        "input",
        "eval",
        "exec",
        "compile",
        "globals",
    ]
    for item in required_import_blocks:
        if f'"{item}"' not in text:
            failures.append(f"strategy sandbox missing blocked import `{item}` in {rel(path)}")
    for item in required_builtin_blocks:
        if f'"{item}"' not in text:
            failures.append(f"strategy sandbox missing blocked builtin `{item}` in {rel(path)}")
    if "validate_code_safety(code)" not in text:
        failures.append(f"strategy sandbox must validate AST before exec: {rel(path)}")
    if 'namespace: dict[str, object] = {"__builtins__": _safe_builtins()}' not in text:
        failures.append(f"strategy sandbox must use safe builtins namespace: {rel(path)}")


def check_real_trading_guard(failures: list[str]) -> None:
    path = ROOT / "backend" / "services" / "trading_center" / "trading_service.py"
    text = read_text(path)
    required = [
        "DisabledRealTradingAdapter",
        "self.adapter = TestIsolationTradeAdapter() if config.simulation_mode else DisabledRealTradingAdapter()",
        "REAL_TRADING_NOT_ENABLED",
        "REAL_TRADING_SYNC_DISABLED",
        "simulation_mode=false; real_order_submitted=false",
        "use_data_center_readonly_sync=true",
        "_ensure_trading_mode_allows_submit()",
    ]
    for needle in required:
        if needle not in text:
            failures.append(f"real trading guard missing `{needle}` in {rel(path)}")


def check_real_data_adapter_guard(failures: list[str]) -> None:
    path = ROOT / "backend" / "services" / "data_center" / "data_center_service.py"
    text = read_text(path)
    required = [
        "RealQmtReadOnlyDataAdapter",
        "real_qmt_readonly=true; real_order_submitted=false",
        "if config.simulation_mode:",
        "TestIsolationQmtDataAdapter()",
    ]
    for needle in required:
        if needle not in text:
            failures.append(f"data center qmt mode guard missing `{needle}` in {rel(path)}")


def main() -> int:
    failures: list[str] = []

    check_package_dependencies(failures)
    check_fixed_menus(failures)
    check_frontend_density_boundaries(failures)
    check_api_layer_boundaries(failures)
    check_api_response_contracts(failures)
    check_long_task_contracts(failures)
    check_pagination_contracts(failures)
    check_qmt_adapter_boundary(failures)
    check_strategy_boundaries(failures)
    check_system_safety_defaults(failures)
    check_strategy_sandbox_contract(failures)
    check_real_trading_guard(failures)
    check_real_data_adapter_guard(failures)

    if failures:
        print("project boundary audit failed")
        for item in failures:
            print(f"- {item}")
        return 1

    print("project boundary audit passed")
    print("- fixed menus unchanged")
    print("- no prohibited frontend framework dependencies")
    print("- no browser zoom or transform scale density hacks")
    print("- api layer has no direct database access")
    print("- api routes keep ApiResponse/FileResponse contracts")
    print("- long task routes return TaskCreated and schedule async work")
    print("- paged API routes keep PageResult with page_size <= 200")
    print("- real QMT calls remain in backend/adapters/qmt")
    print("- strategies do not directly access QMT, DB, network, or trading APIs")
    print("- real mode, order confirmation, and auto-run defaults remain protected")
    print("- strategy sandbox blocks direct imports, unsafe builtins, and AST escape paths")
    print("- real trading remains disabled unless separately authorized")
    print("- data center keeps real QMT read-only data adapter separate from test isolation")
    return 0


if __name__ == "__main__":
    sys.exit(main())
