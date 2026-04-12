"""验证策略中心最小闭环"""
import httpx, json, time, os, sys

BASE = "http://127.0.0.1:8001"
H = {"X-API-Key": "dev-api-key-change-me", "Content-Type": "application/json"}
results = []

def check(name, ok, detail=""):
    tag = "PASS" if ok else "FAIL"
    results.append(ok)
    print(f"[{len(results):02d}] {name}: {tag}  {detail}")

# ── 1. 注册策略 ───────────────────────────────────────
r = httpx.post(f"{BASE}/api/v1/strategies", headers=H, json={
    "strategy_id": "bb_v35_test",
    "name": "布林带V35测试策略",
    "description": "Mock 测试用",
    "start_script": "python run_bb.py",
    "stop_script": "python stop_bb.py",
    "working_dir": "/strategies/bb_v35",
})
d = r.json()
check("注册策略 201", r.status_code == 200 and d["code"] == 0)
check("返回 strategy_id", d["data"]["strategy_id"] == "bb_v35_test")
check("初始状态 registered", d["data"]["status"] == "registered")
check("start_script 已保存", d["data"]["start_script"] == "python run_bb.py")

# ── 2. 重复注册应报错 ────────────────────────────────
r2 = httpx.post(f"{BASE}/api/v1/strategies", headers=H, json={
    "strategy_id": "bb_v35_test",
    "name": "重复策略",
})
check("重复注册 code=2004", r2.json()["code"] == 2004)

# ── 3. 查询策略列表 ──────────────────────────────────
r3 = httpx.get(f"{BASE}/api/v1/strategies", headers=H)
d3 = r3.json()
check("策略列表 200", r3.status_code == 200 and d3["code"] == 0)
check("列表包含 bb_v35_test", any(s["strategy_id"] == "bb_v35_test" for s in d3["data"]))
check("列表有 runtime 字段", "runtime" in d3["data"][0])

# ── 4. 查询策略详情 ──────────────────────────────────
r4 = httpx.get(f"{BASE}/api/v1/strategies/bb_v35_test", headers=H)
d4 = r4.json()
check("策略详情 200", r4.status_code == 200 and d4["code"] == 0)
check("详情 strategy_id 正确", d4["data"]["strategy_id"] == "bb_v35_test")
check("详情 working_dir 正确", d4["data"]["working_dir"] == "/strategies/bb_v35")

# ── 5. 查询不存在的策略 ──────────────────────────────
r5 = httpx.get(f"{BASE}/api/v1/strategies/nonexistent", headers=H)
check("不存在策略 code=2003", r5.json()["code"] == 2003)

# ── 6. 启动策略 ──────────────────────────────────────
r6 = httpx.post(f"{BASE}/api/v1/strategies/bb_v35_test/start", headers=H)
d6 = r6.json()
check("启动策略 200", r6.status_code == 200 and d6["code"] == 0)
check("状态变为 running", d6["data"]["status"] == "running")
check("pid > 0 (mock)", d6["data"]["pid"] > 0)

# ── 7. 心跳文件已创建 ────────────────────────────────
hb_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "runtime", "heartbeat", "bb_v35_test.json")
check("心跳文件存在", os.path.exists(hb_path))
if os.path.exists(hb_path):
    with open(hb_path, "r", encoding="utf-8") as f:
        hb = json.load(f)
    check("心跳 status=running", hb.get("status") == "running")
    check("心跳 pid=99999", hb.get("pid") == 99999)
else:
    check("心跳 status=running", False, "文件不存在")
    check("心跳 pid=99999", False, "文件不存在")

# ── 8. 再次启动应该成功（running → 不可启动）────────
r8 = httpx.post(f"{BASE}/api/v1/strategies/bb_v35_test/start", headers=H)
check("重复启动 code=2004", r8.json()["code"] == 2004)

# ── 9. 查询详情含 heartbeat ──────────────────────────
r9 = httpx.get(f"{BASE}/api/v1/strategies/bb_v35_test", headers=H)
d9 = r9.json()
check("详情含 heartbeat 字段", "heartbeat" in d9["data"])
check("详情 runtime.status=running", d9["data"]["runtime"]["status"] == "running")

# ── 10. 心跳扫描（正常心跳） ─────────────────────────
r10 = httpx.post(f"{BASE}/api/v1/strategies/scan-heartbeats", headers=H)
d10 = r10.json()
check("心跳扫描 200", r10.status_code == 200 and d10["code"] == 0)
check("正常心跳无变化", d10["data"]["count"] == 0)

# ── 11. 模拟心跳超时 ─────────────────────────────────
# 修改心跳文件时间为 3 分钟前
if os.path.exists(hb_path):
    with open(hb_path, "r", encoding="utf-8") as f:
        hb = json.load(f)
    from datetime import datetime, timedelta
    old_time = (datetime.now() - timedelta(minutes=5)).isoformat(timespec="seconds")
    hb["last_heartbeat_time"] = old_time
    with open(hb_path, "w", encoding="utf-8") as f:
        json.dump(hb, f, ensure_ascii=False, indent=2)

    r11 = httpx.post(f"{BASE}/api/v1/strategies/scan-heartbeats", headers=H)
    d11 = r11.json()
    check("心跳超时检测到变化", d11["data"]["count"] > 0)
    check("超时事件类型", d11["data"]["changed"][0]["event"] == "heartbeat_timeout")

    # 验证状态变为 error
    r11b = httpx.get(f"{BASE}/api/v1/strategies/bb_v35_test", headers=H)
    d11b = r11b.json()
    check("超时后状态=error", d11b["data"]["status"] == "error")
    check("runtime error_message 含心跳", "心跳" in d11b["data"]["runtime"]["error_message"])
else:
    for _ in range(4): check("心跳超时测试", False, "心跳文件不存在")

# ── 12. error 状态可重新启动 ─────────────────────────
r12 = httpx.post(f"{BASE}/api/v1/strategies/bb_v35_test/start", headers=H)
d12 = r12.json()
check("error 后可重启", d12["code"] == 0 and d12["data"]["status"] == "running")

# ── 13. 停止策略 ─────────────────────────────────────
r13 = httpx.post(f"{BASE}/api/v1/strategies/bb_v35_test/stop", headers=H)
d13 = r13.json()
check("停止策略 200", r13.status_code == 200 and d13["code"] == 0)
check("状态变为 stopped", d13["data"]["status"] == "stopped")

# ── 14. 心跳文件已删除 ───────────────────────────────
check("心跳文件已删除", not os.path.exists(hb_path))

# ── 15. 再次停止应报状态冲突 ─────────────────────────
r15 = httpx.post(f"{BASE}/api/v1/strategies/bb_v35_test/stop", headers=H)
check("重复停止 code=2004", r15.json()["code"] == 2004)

# ── 16. stopped 可重新启动 ───────────────────────────
r16 = httpx.post(f"{BASE}/api/v1/strategies/bb_v35_test/start", headers=H)
check("stopped 后可重启", r16.json()["code"] == 0 and r16.json()["data"]["status"] == "running")

# 清理：停掉
httpx.post(f"{BASE}/api/v1/strategies/bb_v35_test/stop", headers=H)

# ── Summary ──────────────────────────────────────────
print()
passed = sum(results)
total = len(results)
print(f"=== {passed}/{total} PASS ===" if all(results) else f"=== {passed}/{total} — SOME FAILED ===")
