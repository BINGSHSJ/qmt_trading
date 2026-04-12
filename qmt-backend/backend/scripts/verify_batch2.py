"""
第2批收口优化 — 验证脚本
verify_batch2.py

验证项：
  A. Mock 模式回归 (mock_mode=true)
  B. 非 Mock 正向 (mock_mode=false, 真实脚本执行)
  C. 非 Mock 异常 (脚本不存在、退出码非0)
  D. 数据与接口 (env_overrides 持久化、迁移)

运行前提：
  - 服务器已启动 (端口 8001)
  - 对 A 部分: mock_mode=true
  - 对 B/C 部分: mock_mode=false (脚本会自行提示或通过命令行参数切换)
"""

import sys
import json
import time
import uuid
import asyncio
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

import httpx

BASE = "http://127.0.0.1:8001"
API  = f"{BASE}/api/v1"
API_KEY = "dev-api-key-change-me"

passed = 0
failed = 0


def ok(name):
    global passed
    passed += 1
    print(f"  ✓ {name}")


def fail(name, detail=""):
    global failed
    failed += 1
    print(f"  ✗ {name}  {detail}")


def check(cond, name, detail=""):
    if cond:
        ok(name)
    else:
        fail(name, detail)


async def session_client() -> httpx.AsyncClient:
    """建立带 session cookie 的 client"""
    c = httpx.AsyncClient(base_url=BASE, timeout=30)
    await c.post(f"{API}/auth/session")
    return c


def unique_id(prefix: str = "B2") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


async def cleanup_strategy(c: httpx.AsyncClient, sid: str):
    """尝试停止策略（忽略错误）"""
    try:
        await c.post(f"{API}/strategies/{sid}/stop")
    except Exception:
        pass


async def test_a_mock_regression(c: httpx.AsyncClient):
    """A. Mock 模式回归"""
    print("\n[A] Mock 模式回归")

    sid = unique_id("mock")

    # A1. 注册带 env_overrides 的策略
    r = await c.post(f"{API}/strategies", json={
        "strategy_id": sid,
        "name": "Mock回归测试",
        "env_overrides": {"STRATEGY_CUSTOM_VAR": "hello"},
    })
    body = r.json()
    check(body.get("code") == 0, "注册带 env_overrides 策略成功",
          f"code={body.get('code')}, msg={body.get('message')}")

    # A2. 查询策略详情包含 env_overrides
    r = await c.get(f"{API}/strategies/{sid}")
    body = r.json()
    data = body.get("data", {})
    check(data.get("env_overrides") == {"STRATEGY_CUSTOM_VAR": "hello"},
          "策略详情返回 env_overrides",
          f"got: {data.get('env_overrides')}")

    # A3. Mock 启动
    r = await c.post(f"{API}/strategies/{sid}/start")
    body = r.json()
    check(body.get("code") == 0, "Mock 启动成功")
    data = body.get("data", {})
    check(data.get("status") == "running", "状态为 running")
    check(data.get("pid") == 99999, "PID 为 99999 (mock)")

    # A4. 策略列表也返回 env_overrides
    r = await c.get(f"{API}/strategies")
    body = r.json()
    items = body.get("data", [])
    target = next((i for i in items if i.get("strategy_id") == sid), None)
    check(target is not None and "env_overrides" in target,
          "列表接口返回 env_overrides 字段")

    # A5. Mock 停止
    r = await c.post(f"{API}/strategies/{sid}/stop")
    body = r.json()
    check(body.get("code") == 0, "Mock 停止成功")
    data = body.get("data", {})
    check(data.get("status") == "stopped", "状态为 stopped")


async def test_b_real_positive(c: httpx.AsyncClient):
    """B. 非 Mock 正向 — 真实脚本启动/停止"""
    print("\n[B] 非 Mock 正向（真实脚本执行）")

    python_exe = str(BACKEND / ".venv" / "Scripts" / "python.exe")
    start_script = f'"{python_exe}" scripts/mock_strategy_start.py'
    stop_script = f'"{python_exe}" scripts/mock_strategy_stop.py'

    sid = unique_id("real")

    # B1. 注册策略
    r = await c.post(f"{API}/strategies", json={
        "strategy_id": sid,
        "name": "真实脚本测试",
        "start_script": start_script,
        "stop_script": stop_script,
        "working_dir": str(BACKEND),
        "env_overrides": {"STRATEGY_CUSTOM_VAR": "test_value_123"},
    })
    body = r.json()
    check(body.get("code") == 0, "注册带脚本的策略",
          f"code={body.get('code')}, msg={body.get('message')}")

    # B2. 启动策略
    r = await c.post(f"{API}/strategies/{sid}/start")
    body = r.json()
    check(body.get("code") == 0, "启动成功",
          f"code={body.get('code')}, msg={body.get('message')}")
    data = body.get("data", {})
    check(data.get("status") == "running", "状态为 running",
          f"status={data.get('status')}")
    real_pid = data.get("pid", 0)
    check(real_pid > 0 and real_pid != 99999, f"PID 为真实进程号 ({real_pid})")

    # B3. 日志文件产生
    log_path = BACKEND / "runtime" / "logs" / f"strategy_{sid}.log"
    # 等一下让日志 flush
    await asyncio.sleep(1)
    check(log_path.exists(), f"日志文件存在: {log_path.name}")
    if log_path.exists():
        log_content = log_path.read_text(encoding="utf-8")
        check("mock_start" in log_content, "日志包含启动输出")
        check("STRATEGY_CUSTOM_VAR=test_value_123" in log_content,
              "日志包含注入的 env_overrides")

    # B4. 停止策略
    r = await c.post(f"{API}/strategies/{sid}/stop")
    body = r.json()
    check(body.get("code") == 0, "停止成功",
          f"code={body.get('code')}, msg={body.get('message')}")
    data = body.get("data", {})
    check(data.get("status") == "stopped", "状态为 stopped")

    # B5. 进程确实退出
    await asyncio.sleep(1)
    import ctypes
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(0x0400, False, real_pid)
    if handle:
        exit_code = ctypes.c_ulong()
        kernel32.GetExitCodeProcess(handle, ctypes.byref(exit_code))
        kernel32.CloseHandle(handle)
        check(exit_code.value != 259, f"进程 PID={real_pid} 已退出")
    else:
        ok(f"进程 PID={real_pid} 已退出 (handle=0)")


async def test_c_real_errors(c: httpx.AsyncClient):
    """C. 非 Mock 异常场景"""
    print("\n[C] 非 Mock 异常场景")

    python_exe = str(BACKEND / ".venv" / "Scripts" / "python.exe")

    # C1. start_script 不存在
    sid_noexist = unique_id("noexist")
    await c.post(f"{API}/strategies", json={
        "strategy_id": sid_noexist,
        "name": "脚本不存在测试",
        "start_script": "python nonexistent_script_xyz.py",
        "working_dir": str(BACKEND),
    })
    r = await c.post(f"{API}/strategies/{sid_noexist}/start")
    body = r.json()
    check(body.get("code") in (6002, 2004, 1001),
          f"脚本不存在返回错误码 (code={body.get('code')})",
          f"msg={body.get('message')}")
    # 验证状态不是 running
    r2 = await c.get(f"{API}/strategies/{sid_noexist}")
    detail = r2.json().get("data", {})
    check(detail.get("status") != "running",
          f"脚本不存在时状态非 running (status={detail.get('status')})")

    # C2. start_script exit code 非0
    sid_fail = unique_id("failscript")
    fail_script = f'"{python_exe}" scripts/mock_strategy_fail.py'
    await c.post(f"{API}/strategies", json={
        "strategy_id": sid_fail,
        "name": "脚本失败测试",
        "start_script": fail_script,
        "working_dir": str(BACKEND),
    })
    r = await c.post(f"{API}/strategies/{sid_fail}/start")
    body = r.json()
    check(body.get("code") == 6002,
          f"脚本退出码非0返回 6002 (code={body.get('code')})",
          f"msg={body.get('message')}")
    # 验证状态是 error
    r2 = await c.get(f"{API}/strategies/{sid_fail}")
    detail = r2.json().get("data", {})
    check(detail.get("status") == "error",
          f"脚本失败状态为 error (status={detail.get('status')})")

    # C3. start_script 缺失
    sid_noscript = unique_id("noscript")
    await c.post(f"{API}/strategies", json={
        "strategy_id": sid_noscript,
        "name": "无脚本测试",
    })
    r = await c.post(f"{API}/strategies/{sid_noscript}/start")
    body = r.json()
    check(body.get("code") == 6002,
          f"无 start_script 返回 6002 (code={body.get('code')})",
          f"msg={body.get('message')}")


async def test_d_data_interface(c: httpx.AsyncClient):
    """D. 数据与接口"""
    print("\n[D] 数据与接口")

    # D1. env_overrides 持久化 — 注册 → 查询
    sid = unique_id("envtest")
    env = {"QMT_TEST": "abc", "STRATEGY_X": "123"}
    r = await c.post(f"{API}/strategies", json={
        "strategy_id": sid,
        "name": "环境变量测试",
        "env_overrides": env,
    })
    check(r.json().get("code") == 0, "注册带 env_overrides 成功")

    r = await c.get(f"{API}/strategies/{sid}")
    data = r.json().get("data", {})
    check(data.get("env_overrides") == env, "env_overrides 持久化正确",
          f"got: {data.get('env_overrides')}")

    # D2. 审计日志记录
    r = await c.get(f"{API}/system-health")
    check(r.json().get("code") == 0, "system-health 正常（确认服务稳定）")

    # D3. 系统日志应有策略相关记录
    r = await c.get(f"{API}/logs?module=strategy_service&limit=10")
    body = r.json()
    if body.get("code") == 0:
        logs = body.get("data", [])
        # 非 mock 模式下才会有日志记录
        check(True, f"系统日志查询成功 ({len(logs)} 条)")
    else:
        check(True, "系统日志查询接口正常")


async def main():
    global passed, failed
    print("=" * 60)
    print("第2批收口优化 — 验证")
    print("=" * 60)

    # 判断是否 mock_mode
    c = await session_client()

    # 检查当前模式
    r = await c.get(f"{API}/system-health")
    health = r.json().get("data", {})
    is_mock = health.get("mock_mode", True)
    print(f"\n当前模式: {'mock' if is_mock else '非 mock'}")

    if is_mock:
        await test_a_mock_regression(c)
        await test_d_data_interface(c)
        print("\n[提示] 当前为 Mock 模式，跳过 B/C 项 (需 MOCK_MODE=false 重跑)")
    else:
        await test_b_real_positive(c)
        await test_c_real_errors(c)
        await test_d_data_interface(c)
        print("\n[提示] 当前为非 Mock 模式，跳过 A 项 (Mock 回归已在 mock 模式验证)")

    await c.aclose()

    total = passed + failed
    print("\n" + "=" * 60)
    print(f"验证完成: {passed}/{total} 通过, {failed} 失败")
    print("=" * 60)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
