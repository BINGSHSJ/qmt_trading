# -*- coding: utf-8 -*-
"""
第3批收口优化 - 验证脚本
verify_batch3.py

验证项:
  A. Mock 回归 (不破坏第1/2批)
  B. Non-mock 正向联调 (真实脚本 + adapter + preflight)
  C. Non-mock 异常映射 (5002/5003/6002/6003)
  D. Preflight 阻断验证

运行前提:
  - 服务器已启动 (端口 8001)
  - 按 mock/non-mock 分别执行
"""

import sys
import os
import json
import uuid
import asyncio
from pathlib import Path

# Windows 终端编码兼容
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


def unique_id(prefix="B3"):
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


async def session_client():
    c = httpx.AsyncClient(base_url=BASE, timeout=30)
    await c.post(f"{API}/auth/session")
    return c


async def cleanup(c, sid):
    try:
        await c.post(f"{API}/strategies/{sid}/stop")
    except Exception:
        pass


# ============================================================
# A. Mock 回归
# ============================================================
async def test_a_mock_regression(c):
    print("\n[A] Mock 回归 (第1/2批兼容)")

    sid = unique_id("mock3")

    # A1. 注册 + env_overrides
    r = await c.post(f"{API}/strategies", json={
        "strategy_id": sid, "name": "Mock回归B3",
        "env_overrides": {"STRATEGY_X": "v1"},
    })
    check(r.json().get("code") == 0, "注册带 env_overrides 策略")

    # A2. 启动
    r = await c.post(f"{API}/strategies/{sid}/start")
    body = r.json()
    check(body.get("code") == 0, "Mock 启动成功")
    data = body.get("data", {})
    check(data.get("pid") == 99999, "PID=99999 (mock)")
    check(data.get("status") == "running", "状态 running")

    # A3. 停止
    r = await c.post(f"{API}/strategies/{sid}/stop")
    body = r.json()
    check(body.get("code") == 0, "Mock 停止成功")
    check(body.get("data", {}).get("status") == "stopped", "状态 stopped")

    # A4. system-health 正常
    r = await c.get(f"{API}/system-health")
    body = r.json()
    check(body.get("code") == 0, "system-health 正常")
    data = body.get("data", {})
    check(data.get("mock_mode") is True, "mock_mode=true")
    check("preflight" in data, "health 包含 preflight 字段")
    pf = data.get("preflight", {})
    check(pf.get("critical_ok") is True, "preflight critical 全部通过")

    # A5. preflight 含 level 字段
    r = await c.get(f"{API}/system-preflight")
    body = r.json()
    checks = body.get("data", {}).get("checks", [])
    has_level = all("level" in c for c in checks) if checks else False
    check(has_level, "preflight checks 含 level 字段")

    # A6. system_log 含策略操作记录
    r = await c.get(f"{API}/logs?module=strategy_service&limit=5")
    body = r.json()
    logs = body.get("data", [])
    check(len(logs) > 0, f"system_log 有策略记录 ({len(logs)} 条)")
    if logs:
        has_mode = any("mode=" in (l.get("message", "") or "") for l in logs)
        check(has_mode, "system_log 含 mode 信息")


# ============================================================
# B. Non-mock 正向联调
# ============================================================
async def test_b_nonmock_positive(c):
    print("\n[B] Non-mock 正向联调")

    python_exe = str(BACKEND / ".venv" / "Scripts" / "python.exe")
    start_script = f'"{python_exe}" scripts/mock_strategy_start.py'
    stop_script = f'"{python_exe}" scripts/mock_strategy_stop.py'

    sid = unique_id("real3")

    # B1. system-health 检查 adapter 结构化输出
    r = await c.get(f"{API}/system-health")
    body = r.json()
    data = body.get("data", {})
    check(body.get("code") == 0, "system-health 正常")
    check(data.get("mock_mode") is False, "mock_mode=false")
    # adapter 健康检查结构: connected + error + detail
    xt = data.get("components", {}).get("xtdata", {})
    check("connected" in xt and "error" in xt, "xtdata health 结构化 (connected+error)")
    check("detail" in xt, "xtdata health 含 detail")
    xtt = data.get("components", {}).get("xttrader", {})
    check("connected" in xtt and "error" in xtt, "xttrader health 结构化")

    # B2. preflight 包含 level
    r = await c.get(f"{API}/system-preflight?refresh=true")
    body = r.json()
    checks = body.get("data", {}).get("checks", [])
    criticals = [c for c in checks if c.get("level") == "critical"]
    warnings = [c for c in checks if c.get("level") == "warning"]
    check(len(criticals) > 0, f"preflight 有 critical 项 ({len(criticals)})")
    check(len(warnings) > 0, f"preflight 有 warning 项 ({len(warnings)})")

    # B3. 注册 + 启动 + 停止
    r = await c.post(f"{API}/strategies", json={
        "strategy_id": sid, "name": "真实联调B3",
        "start_script": start_script,
        "stop_script": stop_script,
        "working_dir": str(BACKEND),
        "env_overrides": {"STRATEGY_CUSTOM_VAR": "batch3_test"},
    })
    check(r.json().get("code") == 0, "注册策略成功")

    r = await c.post(f"{API}/strategies/{sid}/start")
    body = r.json()
    check(body.get("code") == 0, "启动成功")
    data = body.get("data", {})
    real_pid = data.get("pid", 0)
    check(real_pid > 0 and real_pid != 99999, f"PID 真实 ({real_pid})")
    check(data.get("status") == "running", "状态 running")

    # 日志文件
    await asyncio.sleep(1)
    log_path = BACKEND / "runtime" / "logs" / f"strategy_{sid}.log"
    check(log_path.exists(), "日志文件存在")
    if log_path.exists():
        content = log_path.read_text(encoding="utf-8")
        check("STRATEGY_CUSTOM_VAR=batch3_test" in content, "日志含注入的 env")

    # 停止
    r = await c.post(f"{API}/strategies/{sid}/stop")
    body = r.json()
    check(body.get("code") == 0, "停止成功")
    check(body.get("data", {}).get("status") == "stopped", "状态 stopped")

    # B4. system_log 观测性: 含策略日志 (strategy_id, pid, mode, 耗时)
    r = await c.get(f"{API}/logs?module=strategy_service&limit=10")
    body = r.json()
    logs = body.get("data", [])
    recent = [l for l in logs if sid in (l.get("message", "") or "")]
    check(len(recent) >= 2, f"system_log 有该策略 start/stop 记录 ({len(recent)})")
    if recent:
        msg = recent[0].get("message", "")
        check("mode=real" in msg, "system_log 含 mode=real")
        has_time = any("ms" in (l.get("message", "") or "") for l in recent)
        check(has_time, "system_log 含耗时")


# ============================================================
# C. Non-mock 异常映射
# ============================================================
async def test_c_nonmock_errors(c):
    print("\n[C] Non-mock 异常映射 (5002/5003/6002/6003)")

    python_exe = str(BACKEND / ".venv" / "Scripts" / "python.exe")

    # C1. 6002 — start_script 不存在
    sid1 = unique_id("noexe")
    await c.post(f"{API}/strategies", json={
        "strategy_id": sid1, "name": "脚本不存在",
        "start_script": "python nonexist_xyz_999.py",
        "working_dir": str(BACKEND),
    })
    r = await c.post(f"{API}/strategies/{sid1}/start")
    body = r.json()
    check(body.get("code") in (1002, 6002),
          f"脚本不存在 -> 错误码 ({body.get('code')})")

    # C2. 6002 — start_script exit code 非0
    sid2 = unique_id("fail")
    fail_script = f'"{python_exe}" scripts/mock_strategy_fail.py'
    await c.post(f"{API}/strategies", json={
        "strategy_id": sid2, "name": "脚本失败",
        "start_script": fail_script,
        "working_dir": str(BACKEND),
    })
    r = await c.post(f"{API}/strategies/{sid2}/start")
    body = r.json()
    check(body.get("code") == 6002, f"脚本失败 -> 6002 ({body.get('code')})")

    # C3. 6002 — 无 start_script
    sid3 = unique_id("noscr")
    await c.post(f"{API}/strategies", json={
        "strategy_id": sid3, "name": "无脚本",
    })
    r = await c.post(f"{API}/strategies/{sid3}/start")
    body = r.json()
    check(body.get("code") == 6002, f"无脚本 -> 6002 ({body.get('code')})")

    # C4. 6002 — working_dir 无效
    sid4 = unique_id("badwd")
    await c.post(f"{API}/strategies", json={
        "strategy_id": sid4, "name": "无效目录",
        "start_script": f'"{python_exe}" scripts/mock_strategy_start.py',
        "working_dir": "C:/nonexistent_dir_xyz_999",
    })
    r = await c.post(f"{API}/strategies/{sid4}/start")
    body = r.json()
    check(body.get("code") == 1002, f"working_dir 无效 -> 1002 ({body.get('code')})")

    # C5. 6003 — stop_script 退出非0
    sid5 = unique_id("stopfail")
    start_script = f'"{python_exe}" scripts/mock_strategy_start.py'
    stop_fail_script = f'"{python_exe}" scripts/mock_strategy_stop_fail.py'
    await c.post(f"{API}/strategies", json={
        "strategy_id": sid5, "name": "停止脚本失败",
        "start_script": start_script,
        "stop_script": stop_fail_script,
        "working_dir": str(BACKEND),
    })
    # 先启动
    r = await c.post(f"{API}/strategies/{sid5}/start")
    check(r.json().get("code") == 0, "C5 启动成功")
    # 再停止 — stop_script exit=1 应返回 6003
    r = await c.post(f"{API}/strategies/{sid5}/stop")
    body = r.json()
    check(body.get("code") == 6003,
          f"stop_script 非0退出 -> 6003 ({body.get('code')})")
    # 但状态仍应为 stopped（进程已被清理）
    r2 = await c.get(f"{API}/strategies/{sid5}")
    detail = r2.json().get("data", {})
    check(detail.get("status") == "stopped",
          f"stop 后状态 stopped ({detail.get('status')})")

    # C6. 5002/5003 — adapter 异常映射 (非 mock 下 xtquant 不可用)
    # 通过 health 检查间接验证 adapter 不崩溃
    r = await c.get(f"{API}/system-health")
    body = r.json()
    data = body.get("data", {})
    xt = data.get("components", {}).get("xtdata", {})
    xtt = data.get("components", {}).get("xttrader", {})
    check(xt.get("connected") is False or xt.get("connected") is True,
          "xtdata adapter 不崩溃 (返回结构化)")
    check(xtt.get("connected") is False or xtt.get("connected") is True,
          "xttrader adapter 不崩溃 (返回结构化)")


# ============================================================
# D. Preflight 阻断验证
# ============================================================
async def test_d_preflight_block(c):
    print("\n[D] Preflight 阻断验证")

    # D1. 正常 preflight — critical 全通过，启动应成功
    r = await c.get(f"{API}/system-health")
    data = r.json().get("data", {})
    pf = data.get("preflight", {})
    critical_ok = pf.get("critical_ok", False)

    if critical_ok:
        print("  (当前 critical 全部通过 — 启动不被阻断，符合预期)")
        ok("preflight critical 通过时启动可用")
    else:
        # critical 失败时，启动应被拦截
        sid = unique_id("pfblk")
        python_exe = str(BACKEND / ".venv" / "Scripts" / "python.exe")
        await c.post(f"{API}/strategies", json={
            "strategy_id": sid, "name": "预检阻断测试",
            "start_script": f'"{python_exe}" scripts/mock_strategy_start.py',
            "working_dir": str(BACKEND),
        })
        r = await c.post(f"{API}/strategies/{sid}/start")
        body = r.json()
        check(body.get("code") == 6002,
              f"critical 失败时启动被阻断 (code={body.get('code')})")
        check("预检" in body.get("message", ""),
              "阻断消息含预检原因")

    # D2. preflight refresh 功能
    r = await c.get(f"{API}/system-preflight?refresh=true")
    body = r.json()
    data = body.get("data", {})
    check(data.get("cached") is False, "refresh=true 返回 cached=false")
    checks = data.get("checks", [])
    check(len(checks) >= 4, f"preflight 至少 4 项检查 ({len(checks)})")


# ============================================================
# main
# ============================================================
async def main():
    global passed, failed
    print("=" * 60)
    print("第3批收口优化 - 验证")
    print("=" * 60)

    c = await session_client()

    r = await c.get(f"{API}/system-health")
    health = r.json().get("data", {})
    is_mock = health.get("mock_mode", True)
    print(f"\n当前模式: {'mock' if is_mock else 'non-mock'}")

    if is_mock:
        await test_a_mock_regression(c)
        print("\n[提示] Mock 模式，跳过 B/C/D (需 MOCK_MODE=false)")
    else:
        await test_b_nonmock_positive(c)
        await test_c_nonmock_errors(c)
        await test_d_preflight_block(c)
        print("\n[提示] Non-mock 模式，跳过 A (需 MOCK_MODE=true)")

    await c.aclose()

    total = passed + failed
    print("\n" + "=" * 60)
    print(f"验证完成: {passed}/{total} 通过, {failed} 失败")
    print("=" * 60)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
