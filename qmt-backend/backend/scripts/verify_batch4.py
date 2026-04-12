# -*- coding: utf-8 -*-
"""
第4批-批次1 验证脚本
verify_batch4.py

验证项:
  A. preflight refresh 后 app.state 同步 + 启动阻断一致性
  B. XtdataError -> 5002 (显式 API 触发)
  C. XttraderError -> 5003 (显式 API 触发)
  D. 不破坏第2/3批回归

运行前提:
  - 服务器已启动 (端口 8001)
  - 按 mock / non-mock 分别执行
"""

import sys
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


def uid(prefix="B4"):
    return f"{prefix}_{uuid.uuid4().hex[:8]}"


async def session_client():
    c = httpx.AsyncClient(base_url=BASE, timeout=30)
    await c.post(f"{API}/auth/session")
    return c


# ============================================================
# A. preflight refresh -> app.state 同步 + 启动阻断一致性
# ============================================================
async def test_a_preflight_sync(c, is_mock):
    print("\n[A] preflight refresh -> 启动阻断一致性")

    # A1. 调用 refresh=true
    r = await c.get(f"{API}/system-preflight?refresh=true")
    body = r.json()
    check(body.get("code") == 0, "preflight refresh 成功")
    data = body.get("data", {})
    check(data.get("cached") is False, "refresh 返回 cached=false")
    refreshed_checks = data.get("checks", [])
    check(len(refreshed_checks) >= 4, f"refresh 返回 >= 4 项 ({len(refreshed_checks)})")

    # A2. system-health 读取的 preflight 应与 refresh 一致
    r = await c.get(f"{API}/system-health")
    health = r.json().get("data", {})
    health_pf = health.get("preflight", {})
    health_checks = health_pf.get("checks", [])
    # 比较检查项名称集合一致
    refresh_names = {c["name"] for c in refreshed_checks}
    health_names = {c["name"] for c in health_checks}
    check(refresh_names == health_names,
          "health preflight 与 refresh 结果名称一致",
          f"refresh={refresh_names} vs health={health_names}")

    # A3. 非 mock 下验证阻断逻辑读取最新状态
    if not is_mock:
        # 当前 critical 应全通过（DB/YAML/runtime 正常）
        critical_ok = health_pf.get("critical_ok", False)
        check(critical_ok, "当前 critical 全部通过")

        # 注册并启动一个策略，应不被阻断
        sid = uid("pfsync")
        python_exe = str(BACKEND / ".venv" / "Scripts" / "python.exe")
        await c.post(f"{API}/strategies", json={
            "strategy_id": sid, "name": "preflight同步测试",
            "start_script": f'"{python_exe}" scripts/mock_strategy_start.py',
            "working_dir": str(BACKEND),
        })
        r = await c.post(f"{API}/strategies/{sid}/start")
        body = r.json()
        check(body.get("code") == 0,
              "preflight ok 时启动不被阻断",
              f"code={body.get('code')}, msg={body.get('message')}")
        # 清理
        await c.post(f"{API}/strategies/{sid}/stop")
    else:
        ok("mock 模式跳过启动阻断测试")

    # A4. 不带 refresh 应返回 cached=true
    r = await c.get(f"{API}/system-preflight")
    body = r.json()
    data = body.get("data", {})
    check(data.get("cached") is True, "不带 refresh 返回 cached=true")

    # A5. 所有 checks 含 level 字段
    for chk in refreshed_checks:
        if "level" not in chk:
            fail("所有 check 含 level 字段", f"缺失: {chk.get('name')}")
            break
    else:
        ok("所有 check 含 level 字段")


# ============================================================
# B. XtdataError -> 5002
# ============================================================
async def test_b_xtdata_5002(c, is_mock):
    print("\n[B] XtdataError -> 5002")

    if is_mock:
        # mock 模式下 xtdata 不会报错，验证正常返回
        r = await c.get(f"{API}/trading/market-snapshot?symbol=000001.SZ")
        body = r.json()
        check(body.get("code") == 0, "mock 模式 market-snapshot 正常")
        data = body.get("data", {})
        check(data.get("symbol") == "000001.SZ", "返回正确标的")
        check("last_price" in data, "返回 last_price 字段")
        ok("mock 下 5002 不触发 (预期)")
    else:
        # 非 mock, xtquant 未安装 -> XtdataError -> 5002
        r = await c.get(f"{API}/trading/market-snapshot?symbol=000001.SZ")
        body = r.json()
        check(body.get("code") == 5002,
              f"market-snapshot -> 5002 ({body.get('code')})",
              f"msg={body.get('message')}")
        check(r.status_code == 400,
              f"HTTP 400 ({r.status_code})")


# ============================================================
# C. XttraderError -> 5003
# ============================================================
async def test_c_xttrader_5003(c, is_mock):
    print("\n[C] XttraderError -> 5003")

    if is_mock:
        # mock 模式下 positions 正常返回
        r = await c.get(f"{API}/trading/positions")
        body = r.json()
        check(body.get("code") == 0, "mock 模式 positions 正常")
        data = body.get("data", [])
        check(isinstance(data, list), "返回列表")
        ok("mock 下 5003 不触发 (预期)")
    else:
        # 非 mock, xtquant 未安装 -> XttraderError -> 5003
        r = await c.get(f"{API}/trading/positions")
        body = r.json()
        check(body.get("code") == 5003,
              f"positions -> 5003 ({body.get('code')})",
              f"msg={body.get('message')}")
        check(r.status_code == 400,
              f"HTTP 400 ({r.status_code})")


# ============================================================
# D. 回归检查
# ============================================================
async def test_d_regression(c, is_mock):
    print("\n[D] 回归检查")

    # D1. system-health 基础结构
    r = await c.get(f"{API}/system-health")
    body = r.json()
    check(body.get("code") == 0, "system-health 正常")
    data = body.get("data", {})
    check("components" in data, "health 含 components")
    check("preflight" in data, "health 含 preflight")
    check("strategies" in data, "health 含 strategies")

    # D2. Mock 策略生命周期 (仅 mock 模式)
    if is_mock:
        sid = uid("regr")
        r = await c.post(f"{API}/strategies", json={
            "strategy_id": sid, "name": "回归测试",
            "env_overrides": {"STRATEGY_K": "v1"},
        })
        check(r.json().get("code") == 0, "注册成功")
        r = await c.post(f"{API}/strategies/{sid}/start")
        check(r.json().get("code") == 0, "mock 启动成功")
        check(r.json().get("data", {}).get("pid") == 99999, "PID=99999")
        r = await c.post(f"{API}/strategies/{sid}/stop")
        check(r.json().get("code") == 0, "mock 停止成功")

    # D3. audit-logs 正常
    r = await c.get(f"{API}/audit-logs?limit=5")
    check(r.json().get("code") == 0, "audit-logs 正常")


# ============================================================
# E. Preflight Critical 阻断负测试
# ============================================================
async def test_e_preflight_critical_block(c, is_mock):
    print("\n[E] preflight critical 阻断负测试")

    if is_mock:
        ok("mock 模式跳过 preflight 阻断测试 (mock 不检查 preflight)")
        return

    # E1. 注册一个测试策略
    sid = uid("pfblk")
    python_exe = str(BACKEND / ".venv" / "Scripts" / "python.exe")
    await c.post(f"{API}/strategies", json={
        "strategy_id": sid, "name": "preflight阻断测试",
        "start_script": f'"{python_exe}" scripts/mock_strategy_start.py',
        "working_dir": str(BACKEND),
    })

    # E2. 注入伪造的 critical 失败
    fake_checks = [
        {"name": "YAML 配置", "passed": False, "detail": "测试注入失败", "level": "critical"},
        {"name": "数据库", "passed": True, "detail": "正常", "level": "critical"},
        {"name": "运行时目录", "passed": True, "detail": "正常", "level": "critical"},
        {"name": "环境变量", "passed": True, "detail": "正常", "level": "warning"},
    ]
    r = await c.post(f"{API}/internal/preflight-override",
                     json={"checks": fake_checks})
    body = r.json()
    check(body.get("code") == 0, "注入 critical 失败成功")

    # E3. health 应反映 critical_ok=false
    r = await c.get(f"{API}/system-health")
    health = r.json().get("data", {})
    health_pf = health.get("preflight", {})
    check(health_pf.get("critical_ok") is False,
          "注入后 health critical_ok=false")
    check("YAML 配置" in (health_pf.get("critical_failures") or []),
          "critical_failures 包含 YAML 配置")

    # E4. 尝试启动 → 预期被阻断 (6002)
    r = await c.post(f"{API}/strategies/{sid}/start")
    body = r.json()
    check(body.get("code") == 6002,
          f"critical 失败时启动被阻断 ({body.get('code')})",
          f"msg={body.get('message')}")
    check(r.status_code == 400,
          f"HTTP 400 ({r.status_code})")

    # E5. 恢复真实 preflight
    r = await c.post(f"{API}/internal/preflight-override",
                     json={"restore": True})
    body = r.json()
    check(body.get("code") == 0, "恢复真实 preflight 成功")

    # E6. 恢复后 critical_ok 应为 true
    r = await c.get(f"{API}/system-health")
    health = r.json().get("data", {})
    health_pf = health.get("preflight", {})
    check(health_pf.get("critical_ok") is True,
          "恢复后 critical_ok=true")

    # E7. 恢复后启动应成功
    r = await c.post(f"{API}/strategies/{sid}/start")
    body = r.json()
    check(body.get("code") == 0,
          "恢复后启动成功",
          f"code={body.get('code')}, msg={body.get('message')}")
    # 清理
    await c.post(f"{API}/strategies/{sid}/stop")


# ============================================================
# main
# ============================================================
async def main():
    global passed, failed
    print("=" * 60)
    print("第4批 验证 (批次1 + 批次2)")
    print("=" * 60)

    c = await session_client()
    r = await c.get(f"{API}/system-health")
    health = r.json().get("data", {})
    is_mock = health.get("mock_mode", True)
    print(f"\n当前模式: {'mock' if is_mock else 'non-mock'}")

    await test_a_preflight_sync(c, is_mock)
    await test_b_xtdata_5002(c, is_mock)
    await test_c_xttrader_5003(c, is_mock)
    await test_d_regression(c, is_mock)
    await test_e_preflight_critical_block(c, is_mock)

    await c.aclose()

    total = passed + failed
    print("\n" + "=" * 60)
    print(f"验证完成: {passed}/{total} 通过, {failed} 失败")
    print("=" * 60)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
