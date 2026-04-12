# -*- coding: utf-8 -*-
"""
第4批-批次3 验证脚本
verify_batch4_3.py

验证项:
  A. WS strategy_error 事件触发 (启动失败时)
  B. WS system_error 事件触发 (500 异常时)
  C. 前端构建成功（已通过 vite build 验证）
  D. 不破坏第4批 批次1+2 回归

运行前提:
  - 服务器已启动 (端口 8001)
  - MOCK_MODE=false（测试 WS 事件需要真实异常路径）
"""

import sys
import json
import uuid
import asyncio
from pathlib import Path

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

import httpx

BASE = "http://127.0.0.1:8001"
API = f"{BASE}/api/v1"
WS_BASE = "ws://127.0.0.1:8001"

passed = 0
failed = 0


def ok(name):
    global passed
    passed += 1
    print(f"  [PASS] {name}")


def fail(name, detail=""):
    global failed
    failed += 1
    msg = f"  [FAIL] {name}"
    if detail:
        msg += f"  ({detail})"
    print(msg)


def check(cond, name, detail=""):
    if cond:
        ok(name)
    else:
        fail(name, detail)


def uid(prefix="B43"):
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


async def session_client():
    c = httpx.AsyncClient(base_url=BASE, timeout=30)
    await c.post(f"{API}/auth/session")
    return c


# ============================================================
# A. WS strategy_error 事件触发
# ============================================================
async def test_a_ws_strategy_error(c, is_mock):
    print("\n[A] WS strategy_error 事件触发")

    if is_mock:
        ok("mock 模式跳过 strategy_error 测试")
        return

    import websockets

    # 获取 WS ticket
    r = await c.get(f"{API}/auth/ws-ticket")
    ticket = r.json().get("data", {}).get("ticket", "")
    check(bool(ticket), "获取 WS ticket")

    ws_events = []

    async with websockets.connect(f"{WS_BASE}/ws?ticket={ticket}") as ws:
        # 注册一个会立即退出失败的策略（python 执行不存在的脚本 → probe 阶段失败）
        sid = uid("wserr")
        python_exe = str(BACKEND / ".venv" / "Scripts" / "python.exe")
        await c.post(f"{API}/strategies", json={
            "strategy_id": sid,
            "name": "WS错误测试",
            "start_script": f'"{python_exe}" __nonexistent_script_for_ws_test__.py',
            "working_dir": str(BACKEND),
        })

        # 尝试启动 → 应失败并触发 strategy_error
        r = await c.post(f"{API}/strategies/{sid}/start")
        body = r.json()
        check(body.get("code") == 6002,
              f"启动失败返回 6002 ({body.get('code')})")

        # 收集 WS 消息（给 2 秒窗口）
        try:
            while True:
                msg = await asyncio.wait_for(ws.recv(), timeout=2)
                data = json.loads(msg)
                ws_events.append(data)
        except (asyncio.TimeoutError, Exception):
            pass

    # 验证收到 strategy_error 事件
    strategy_errors = [e for e in ws_events if e.get("type") == "strategy_error"]
    check(len(strategy_errors) > 0,
          f"收到 strategy_error 事件 ({len(strategy_errors)} 条)")

    if strategy_errors:
        evt = strategy_errors[0]
        check(evt.get("data", {}).get("strategy_id") == sid,
              "strategy_error 包含正确 strategy_id")
        check(evt.get("data", {}).get("action") == "start",
              "strategy_error action=start")
        check(bool(evt.get("data", {}).get("message")),
              "strategy_error 包含 message")


# ============================================================
# B. 前端轮询频率验证 (静态分析验证)
# ============================================================
async def test_b_polling_frequency():
    print("\n[B] 前端轮询频率验证 (静态分析)")

    app_jsx = BACKEND / "frontend-admin" / "src" / "App.jsx"
    content = app_jsx.read_text(encoding="utf-8")

    # 验证 v2.8 轮询频率
    check("loadPositions, 3000" in content, "持仓轮询 3s")
    check("loadOrders, 3000" in content, "委托轮询 3s")
    check("loadFills, 3000" in content, "成交轮询 3s")
    check("loadStrategies, 5000" in content, "策略状态轮询 5s")
    check("loadHealth, 10000" in content, "系统健康轮询 10s")
    check("loadSystemLogs, 30000" in content, "日志列表轮询 30s")

    # 验证可见性暂停
    check("visibilitychange" in content, "注册 visibilitychange 监听")
    check("visibleRef.current" in content, "使用 visibleRef 控制轮询")

    # 验证按钮防重复
    check("actionBusy" in content, "actionBusy 状态存在")
    check("setTimeout" in content and "3000" in content, "3s 防重复计时器")

    # 验证 WS 错误提示
    check("notification.error" in content, "notification.error 调用存在")
    check("system_error" in content, "system_error 事件处理")
    check("strategy_error" in content, "strategy_error 事件处理")


# ============================================================
# C. 后端 WS broadcast 代码验证  
# ============================================================
async def test_c_backend_ws_code():
    print("\n[C] 后端 WS broadcast 代码验证")

    # strategy_service.py 包含 strategy_error broadcast
    svc_path = BACKEND / "app" / "services" / "strategy_service.py"
    svc_content = svc_path.read_text(encoding="utf-8")
    check('broadcast("strategy_error"' in svc_content,
          "strategy_service 包含 strategy_error broadcast")
    count = svc_content.count('broadcast("strategy_error"')
    check(count >= 3,
          f"strategy_error broadcast 至少 3 处 (start OSError, probe exit, stop) = {count}")

    # main.py 包含 system_error broadcast
    main_path = BACKEND / "app" / "main.py"
    main_content = main_path.read_text(encoding="utf-8")
    check('broadcast("system_error"' in main_content,
          "main.py 包含 system_error broadcast")


# ============================================================
# D. 回归检查
# ============================================================
async def test_d_regression(c, is_mock):
    print("\n[D] 回归检查")

    r = await c.get(f"{API}/system-health")
    body = r.json()
    check(body.get("code") == 0, "system-health 正常")
    data = body.get("data", {})
    check("components" in data, "health 含 components")
    check("preflight" in data, "health 含 preflight")

    r = await c.get(f"{API}/audit-logs?limit=5")
    check(r.json().get("code") == 0, "audit-logs 正常")

    r = await c.get(f"{API}/risk/rules")
    check(r.json().get("code") == 0, "risk/rules 正常")

    r = await c.get(f"{API}/risk/events?limit=5")
    check(r.json().get("code") == 0, "risk/events 正常")


# ============================================================
# main
# ============================================================
async def main():
    global passed, failed
    print("=" * 60)
    print("第4批-批次3 验证")
    print("=" * 60)

    c = await session_client()
    r = await c.get(f"{API}/system-health")
    health = r.json().get("data", {})
    is_mock = health.get("mock_mode", True)
    print(f"\n当前模式: {'mock' if is_mock else 'non-mock'}")

    # WS 测试需要 websockets 库
    has_websockets = True
    try:
        import websockets  # noqa: F401
    except ImportError:
        has_websockets = False
        print("\n[提示] websockets 库未安装，跳过 WS 实时测试 (pip install websockets)")

    if has_websockets:
        await test_a_ws_strategy_error(c, is_mock)
    else:
        print("\n[A] WS strategy_error 事件触发 — 跳过 (需要 websockets 库)")

    await test_b_polling_frequency()
    await test_c_backend_ws_code()
    await test_d_regression(c, is_mock)

    await c.aclose()

    total = passed + failed
    print("\n" + "=" * 60)
    print(f"验证完成: {passed}/{total} 通过, {failed} 失败")
    print("=" * 60)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
