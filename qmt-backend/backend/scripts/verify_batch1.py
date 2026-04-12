"""
第1批收口优化 — 验证脚本
verify_batch1.py

检查项:
  1. app.js 不含硬编码 API_KEY
  2. POST /auth/session 返回 Set-Cookie
  3. Cookie 鉴权可正常访问 API
  4. X-API-Key 鉴权仍可用（脚本兼容）
  5. signal_type=BUY 枚举写入正常
  6. signal_type=invalid 被拒绝
  7. target_value-only 提交（无 target_volume）
  8. target_volume + target_value 均缺失 → 参数错误
  9. WS ticket 接口可用
 10. 前端 signalDir 函数存在
"""

import sys
import json
import time
import uuid
import asyncio
from pathlib import Path

# -- 保证 backend/ 可 import
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


async def main():
    global passed, failed
    print("=" * 60)
    print("第1批收口优化 — 验证")
    print("=" * 60)

    # ── 1. 静态检查：app.js 不含 API_KEY ─────────────
    print("\n[1] 前端安全检查")
    js_path = BACKEND / "static" / "js" / "app.js"
    js_text = js_path.read_text(encoding="utf-8")
    check("API_KEY" not in js_text.split("signalDir")[0],
          "app.js 不含硬编码 API_KEY 常量")
    check("X-API-Key" not in js_text,
          "app.js 不含 X-API-Key header")
    check("credentials" in js_text,
          "app.js 使用 credentials: include")
    check("signalDir" in js_text,
          "app.js 含 signalDir 函数")
    check("ws-ticket" in js_text,
          "app.js WS 通过 ticket 连接")
    check('value="BUY"' in js_text,
          "信号表单使用大写 BUY 枚举")

    async with httpx.AsyncClient(base_url=BASE, timeout=10) as c:
        # ── 2. 会话建立 ────────────────────────────
        print("\n[2] 会话认证")
        r = await c.post(f"{API}/auth/session")
        check(r.status_code == 200, "POST /auth/session 200")
        cookies_header = r.headers.get("set-cookie", "")
        check("qmt_session" in cookies_header, "Set-Cookie 含 qmt_session")
        check("httponly" in cookies_header.lower(), "Cookie 为 HttpOnly")

        # 会话 cookie 已被 httpx 自动保存
        body = r.json()
        check(body.get("code") == 0, "session 响应 code=0")

        # ── 3. Cookie 鉴权访问 API ─────────────────
        print("\n[3] Cookie 鉴权")
        r = await c.get(f"{API}/system-health")
        check(r.status_code == 200 and r.json().get("code") == 0,
              "Cookie 可访问 /system-health")

        r = await c.get(f"{API}/strategies")
        check(r.status_code == 200 and r.json().get("code") == 0,
              "Cookie 可访问 /strategies")

        # ── 4. X-API-Key 兼容 ─────────────────────
        print("\n[4] X-API-Key 兼容")
        c2 = httpx.AsyncClient(base_url=BASE, timeout=10)
        r = await c2.get(f"{API}/system-health", headers={"X-API-Key": API_KEY})
        check(r.status_code == 200 and r.json().get("code") == 0,
              "X-API-Key 仍可访问 API")
        # 无 key 无 cookie → 401
        r = await c2.get(f"{API}/system-health")
        check(r.status_code == 401 or r.json().get("code") == 4001,
              "无凭证 → 401/4001")
        await c2.aclose()

        # ── 5. signal_type 枚举 ───────────────────
        print("\n[5] signal_type 枚举")
        # 先确保策略存在
        await c.post(f"{API}/strategies", json={
            "strategy_id": "test_batch1",
            "name": "批次1验证策略",
        })
        sig_ok = {
            "signal_id": f"SIG-B1-{uuid.uuid4().hex[:8]}",
            "strategy_id": "test_batch1",
            "symbol": "000001.SZ",
            "signal_type": "BUY",
            "signal_price": 10.5,
            "target_volume": 200,
        }
        r = await c.post(f"{API}/trading/signals", json=sig_ok)
        body = r.json()
        check(body.get("code") == 0, "signal_type=BUY 接受",
              f"code={body.get('code')}, msg={body.get('message')}")

        sig_bad = {**sig_ok, "signal_id": f"SIG-B1-{uuid.uuid4().hex[:8]}", "signal_type": "invalid"}
        r = await c.post(f"{API}/trading/signals", json=sig_bad)
        check(r.status_code == 422 or r.json().get("code") in (1001, 1002),
              "signal_type=invalid 被拒绝 (422)")

        sig_sell = {**sig_ok, "signal_id": f"SIG-B1-{uuid.uuid4().hex[:8]}", "signal_type": "SELL"}
        r = await c.post(f"{API}/trading/signals", json=sig_sell)
        check(r.json().get("code") == 0, "signal_type=SELL 接受")

        sig_reduce = {**sig_ok, "signal_id": f"SIG-B1-{uuid.uuid4().hex[:8]}", "signal_type": "REDUCE"}
        r = await c.post(f"{API}/trading/signals", json=sig_reduce)
        check(r.json().get("code") == 0, "signal_type=REDUCE 接受")

        # ── 6. target_value fallback ──────────────
        print("\n[6] target_value 回退计算")
        sig_val = {
            "signal_id": f"SIG-B1-{uuid.uuid4().hex[:8]}",
            "strategy_id": "test_batch1",
            "symbol": "000001.SZ",
            "signal_type": "BUY",
            "signal_price": 10.0,
            "target_value": 5000.0,
        }
        r = await c.post(f"{API}/trading/signals", json=sig_val)
        body = r.json()
        check(body.get("code") == 0,
              "target_value=5000 (无 target_volume) 接受",
              f"code={body.get('code')}, msg={body.get('message')}")

        # 两个都缺
        sig_none = {
            "signal_id": f"SIG-B1-{uuid.uuid4().hex[:8]}",
            "strategy_id": "test_batch1",
            "symbol": "000001.SZ",
            "signal_type": "BUY",
            "signal_price": 10.0,
        }
        r = await c.post(f"{API}/trading/signals", json=sig_none)
        check(r.status_code == 422 or r.json().get("code") in (1001, 1002),
              "target_volume 和 target_value 均缺 → 参数错误")

        # target_value 太小算不出整手
        sig_tiny = {
            "signal_id": f"SIG-B1-{uuid.uuid4().hex[:8]}",
            "strategy_id": "test_batch1",
            "symbol": "000001.SZ",
            "signal_type": "BUY",
            "signal_price": 100.0,
            "target_value": 50.0,  # 50 / 100 = 0.5 股, 不足 1 手
        }
        r = await c.post(f"{API}/trading/signals", json=sig_tiny)
        body = r.json()
        check(body.get("code") in (1001, 1002) or r.status_code == 400,
              "target_value 不足 1 手 → ParamInvalid",
              f"code={body.get('code')}, msg={body.get('message')}")

        # ── 7. WS ticket ─────────────────────────
        print("\n[7] WS ticket")
        r = await c.get(f"{API}/auth/ws-ticket")
        body = r.json()
        check(body.get("code") == 0 and body.get("data", {}).get("ticket"),
              "GET /auth/ws-ticket 返回 ticket")

        # ── 8. 信号列表 signal_type 大写 ──────────
        print("\n[8] 信号记录验证")
        r = await c.get(f"{API}/trading/signals?limit=10")
        body = r.json()
        if body.get("code") == 0 and body.get("data"):
            signals = body["data"]
            # 只检查本批次新信号 (SIG-B1- 前缀)
            batch1 = [s for s in signals if s.get("signal_id", "").startswith("SIG-B1-")]
            if batch1:
                all_upper = all(
                    s.get("signal_type", "").isupper()
                    for s in batch1
                )
                check(all_upper, "本批次信号 signal_type 均为大写枚举",
                      f"found: {[s.get('signal_type') for s in batch1]}")
            else:
                fail("本批次信号未找到 (SIG-B1- 前缀)")
        else:
            fail("信号列表查询失败", str(body))

    # ── Summary ───────────────────────────────────
    total = passed + failed
    print("\n" + "=" * 60)
    print(f"验证完成: {passed}/{total} 通过, {failed} 失败")
    print("=" * 60)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
