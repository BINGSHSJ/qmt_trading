"""
verify_batch4_4.py — 第4批-批次4 验证脚本

验证内容:
  1. /auth/session 安全约束（无 key 被拒、有 key 通过）
  2. X-API-Key 认证主路径
  3. 时间同步 preflight check 存在
  4. Rate limiter 中间件可加载
  5. 前端 api.js 包含 X-API-Key header
  6. README 已更新

运行: cd backend && $env:PYTHONPATH="$PWD"; .venv\Scripts\python.exe verify_batch4_4.py
"""

import asyncio
import importlib
import inspect
import sys
from pathlib import Path

# 设置 PYTHONPATH
backend_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(backend_dir))

BASE = "http://127.0.0.1:8001"
API_KEY = "dev-api-key-change-me"
HEADERS = {"X-API-Key": API_KEY}

passed = 0
failed = 0


def check(name: str, condition: bool, detail: str = ""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  ✅ {name}" + (f" — {detail}" if detail else ""))
    else:
        failed += 1
        print(f"  ❌ {name}" + (f" — {detail}" if detail else ""))


async def main():
    global passed, failed
    import httpx

    print("\n=== 第4批-批次4 验证 ===\n")

    # ── 1. /auth/session 安全约束 ─────────────────────
    print("[1] /auth/session 安全约束")
    async with httpx.AsyncClient(base_url=BASE, timeout=10) as c:
        # 无 API Key → 应被拒绝 (401)
        r1 = await c.post("/api/v1/auth/session", json={})
        check("无 Key 拒绝", r1.status_code == 401, f"status={r1.status_code}")

        # 错误 API Key → 被拒绝
        r2 = await c.post("/api/v1/auth/session", json={}, headers={"X-API-Key": "wrong-key"})
        check("错误 Key 拒绝", r2.status_code == 401, f"status={r2.status_code}")

        # 正确 API Key → 通过 + Set-Cookie
        r3 = await c.post("/api/v1/auth/session", json={}, headers=HEADERS)
        check("正确 Key 通过", r3.status_code == 200, f"status={r3.status_code}")
        has_cookie = "qmt_session" in r3.headers.get("set-cookie", "")
        check("返回 HttpOnly Cookie", has_cookie)

    # ── 2. X-API-Key 认证主路径 ──────────────────────
    print("\n[2] X-API-Key 认证主路径")
    async with httpx.AsyncClient(base_url=BASE, timeout=10) as c:
        # health 端点用 API Key
        r = await c.get("/api/v1/system-health", headers=HEADERS)
        check("system-health via Key", r.status_code == 200)

        # strategies 端点用 API Key
        r = await c.get("/api/v1/strategies", headers=HEADERS)
        check("strategies via Key", r.status_code == 200)

        # 无 Key → 401
        r = await c.get("/api/v1/strategies")
        check("无 Key 拒绝 strategies", r.status_code == 401)

    # ── 3. 时间同步 preflight ────────────────────────
    print("\n[3] 时间同步 preflight check")
    from app.core.preflight import _check_time_sync
    result = _check_time_sync()
    check("_check_time_sync 存在并可调用", result is not None, result.detail)
    check("级别为 warning", result.level == "warning")

    # 通过 health 接口验证 preflight 包含时间同步
    async with httpx.AsyncClient(base_url=BASE, timeout=10) as c:
        r = await c.get("/api/v1/system-health", headers=HEADERS)
        if r.status_code == 200:
            data = r.json().get("data", {})
            preflight = data.get("preflight", {})
            checks = preflight.get("checks", [])
            time_sync_found = any(ch.get("name") == "时间同步" for ch in checks)
            check("preflight 包含时间同步", time_sync_found, f"共 {len(checks)} 项检查")

    # ── 4. Rate limiter 模块 ─────────────────────────
    print("\n[4] Rate limiter 中间件")
    from app.core.rate_limit import RateLimitMiddleware, _SlidingWindowCounter
    check("RateLimitMiddleware 可导入", True)

    counter = _SlidingWindowCounter()
    # 测试限流逻辑
    for i in range(10):
        counter.is_allowed("test:path", 10, 1.0)
    allowed_11th = counter.is_allowed("test:path", 10, 1.0)
    check("10 req/s 后第 11 次被拒", not allowed_11th)

    # 不同 key 不互相影响
    allowed_other = counter.is_allowed("other:path", 10, 1.0)
    check("不同 key 不互相影响", allowed_other)

    # ── 5. 前端 api.js X-API-Key ─────────────────────
    print("\n[5] 前端 api.js X-API-Key header")
    api_js = backend_dir / "frontend-admin" / "src" / "api.js"
    content = api_js.read_text(encoding="utf-8")
    check("api.js 包含 X-API-Key", "X-API-Key" in content)
    check("api.js 包含 VITE_API_KEY", "VITE_API_KEY" in content)

    # 前端 .env 存在
    fe_env = backend_dir / "frontend-admin" / ".env"
    check("frontend-admin/.env 存在", fe_env.exists())
    if fe_env.exists():
        fe_env_content = fe_env.read_text(encoding="utf-8")
        check("VITE_API_KEY 配置正确", "VITE_API_KEY=dev-api-key-change-me" in fe_env_content)

    # ── 6. actionBusy 使用 useRef ────────────────────
    print("\n[6] 残余风险修复")
    app_jsx = backend_dir / "frontend-admin" / "src" / "App.jsx"
    jsx_content = app_jsx.read_text(encoding="utf-8")
    check("actionBusy 使用 useRef", "actionBusyRef = useRef" in jsx_content)
    check("不再使用 useState for actionBusy", "useState({})" not in jsx_content or "actionBusy" not in jsx_content.split("useState({})")[0][-50:])

    # WS 重连刷新
    check("WS onopen 调用 refreshCurrentPage", "refreshCurrentPage()" in jsx_content.split("ws.onopen")[1][:200] if "ws.onopen" in jsx_content else False)

    # ── 7. README 和配置 ────────────────────────────
    print("\n[7] README 和配置更新")
    readme = (backend_dir.parent / "README.md")
    if readme.exists():
        rm_content = readme.read_text(encoding="utf-8")
        check("README 包含 Non-Mock 指南", "Non-Mock" in rm_content)
        check("README 包含认证说明", "X-API-Key" in rm_content)
        check("README 包含速率限制", "rate_limit" in rm_content or "速率限制" in rm_content)
        check("README 包含时间同步", "时间同步" in rm_content)
        check("README 包含 API 端点表", "/api/v1/strategies" in rm_content)
    else:
        check("README.md 存在", False, "文件不存在")

    # config.dev.yaml rate_limit 段
    cfg_path = backend_dir / "config.dev.yaml"
    cfg_content = cfg_path.read_text(encoding="utf-8")
    check("config.dev.yaml 包含 rate_limit", "rate_limit:" in cfg_content)
    check("rate_limit 默认关闭", "enabled: false" in cfg_content)

    # ── 汇总 ────────────────────────────────────────
    total = passed + failed
    print(f"\n{'='*50}")
    print(f"验证完成: {passed}/{total} 通过", end="")
    if failed:
        print(f", {failed} 失败 ❌")
    else:
        print(" ✅ 全部通过")
    print(f"{'='*50}\n")

    return failed == 0


if __name__ == "__main__":
    ok = asyncio.run(main())
    sys.exit(0 if ok else 1)
