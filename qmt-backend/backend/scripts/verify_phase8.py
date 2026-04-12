"""
Phase 8 验证脚本 — 第一阶段上线必须项验证

测试项:
  1. 启动预检 (preflight)
  2. 增强健康检查 (策略统计)
  3. 审计日志 (策略 + 交易操作记录)
  4. 一键暂停全部策略
  5. 备份/恢复脚本
  6. Phase 2 接口预留文件
  7. 部署文档
  8. 完整 Demo 流程 (注册→启动→信号→风控→委托→暂停→日志)
"""

import httpx
import json
import subprocess
import sys
import uuid
from pathlib import Path

BASE = "http://127.0.0.1:8001"
H = {"X-API-Key": "dev-api-key-change-me", "Content-Type": "application/json"}
results = []

BACKEND_DIR = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = BACKEND_DIR / "scripts"
VENV_PYTHON = str(BACKEND_DIR / ".venv" / "Scripts" / "python.exe")


def check(name, ok, detail=""):
    tag = "PASS" if ok else "FAIL"
    results.append(ok)
    print(f"[{len(results):02d}] {name}: {tag}  {detail}")


# ══════════════════════════════════════════════════════
# 1. 启动预检 (preflight)
# ══════════════════════════════════════════════════════
print("\n═══ 1. PREFLIGHT 预检 ═══")

r = httpx.get(f"{BASE}/api/v1/system-preflight", headers=H)
check("GET /system-preflight 200", r.status_code == 200)
d = r.json()
check("预检返回 checks 列表", isinstance(d.get("data", {}).get("checks"), list))
checks = d["data"]["checks"]
check("预检项 >= 5", len(checks) >= 5)
check("每项有 name/passed/detail", all("name" in c and "passed" in c for c in checks))
check("预检含 cached 字段", "cached" in d["data"])

# refresh 模式
r2 = httpx.get(f"{BASE}/api/v1/system-preflight?refresh=true", headers=H)
check("refresh=true 重新执行", r2.status_code == 200 and r2.json()["data"]["cached"] is False)


# ══════════════════════════════════════════════════════
# 2. 增强健康检查
# ══════════════════════════════════════════════════════
print("\n═══ 2. HEALTH 增强健康检查 ═══")

r = httpx.get(f"{BASE}/api/v1/system-health", headers=H)
check("GET /system-health 200", r.status_code == 200)
hd = r.json()["data"]
check("health 含 strategies 字段", "strategies" in hd)
check("strategies 含 total + running", "total" in hd["strategies"] and "running" in hd["strategies"])
check("health 含 components 字段", "components" in hd)
check("health 含 timestamp", "timestamp" in hd)


# ══════════════════════════════════════════════════════
# 3. DEMO 流程: 注册 → 启动 → 信号 → 委托 → 审计
# ══════════════════════════════════════════════════════
print("\n═══ 3. DEMO 完整流程 ═══")

# 注册策略
sid = f"phase8_test_{uuid.uuid4().hex[:6]}"
r = httpx.post(f"{BASE}/api/v1/strategies", headers=H, json={
    "strategy_id": sid,
    "name": sid,
    "source_type": "manual",
    "config_json": json.dumps({"symbols": ["000001.SZ"]}),
})
check("注册策略 200", r.status_code == 200)
strategy_id = r.json()["data"]["strategy_id"]

# 启动策略
r = httpx.post(f"{BASE}/api/v1/strategies/{strategy_id}/start", headers=H)
check("启动策略 200", r.status_code == 200)

# 提交信号
signal_id = f"sig_{uuid.uuid4().hex[:8]}"
r = httpx.post(f"{BASE}/api/v1/trading/signals", headers=H, json={
    "signal_id": signal_id,
    "strategy_id": strategy_id,
    "symbol": "000001.SZ",
    "signal_type": "buy",
    "signal_price": 11.50,
    "target_volume": 100,
    "reason": "Phase 8 demo test",
})
check("提交信号 200", r.status_code == 200)
sig_data = r.json()["data"]
check("信号返回 decision", "decision" in sig_data or "decision_status" in sig_data)

# 查询委托
r = httpx.get(f"{BASE}/api/v1/trading/orders", headers=H)
check("查询委托 200", r.status_code == 200)
orders = r.json()["data"]
# 非交易时段信号可能被跳过，委托列表可能为空
check("委托列表已查询", isinstance(orders, list))

# 查询成交
r = httpx.get(f"{BASE}/api/v1/trading/fills", headers=H)
check("查询成交 200", r.status_code == 200)

# 查询持仓
r = httpx.get(f"{BASE}/api/v1/trading/positions", headers=H)
check("查询持仓 200", r.status_code == 200)


# ══════════════════════════════════════════════════════
# 4. 审计日志验证
# ══════════════════════════════════════════════════════
print("\n═══ 4. AUDIT 审计日志 ═══")

r = httpx.get(f"{BASE}/api/v1/audit-logs", headers=H)
check("GET /audit-logs 200", r.status_code == 200)
audit_data = r.json()["data"]
check("审计日志有数据", len(audit_data) > 0)

# 检查审计日志字段
if audit_data:
    first = audit_data[0]
    expected_fields = {"id", "action", "target_type", "target_id", "operator", "created_at"}
    check("审计日志含必要字段", expected_fields.issubset(set(first.keys())))

# 按 target_type 过滤
r = httpx.get(f"{BASE}/api/v1/audit-logs?target_type=strategy", headers=H)
check("审计日志 target_type 过滤", r.status_code == 200)
strat_audits = r.json()["data"]
check("策略审计日志有 register/start", any("register" in a.get("action","") for a in strat_audits))


# ══════════════════════════════════════════════════════
# 5. 一键暂停全部策略
# ══════════════════════════════════════════════════════
print("\n═══ 5. PAUSE-ALL 一键暂停 ═══")

# 先注册并启动第二个策略
extra_sid = f"phase8_extra_{uuid.uuid4().hex[:4]}"
r = httpx.post(f"{BASE}/api/v1/strategies", headers=H, json={
    "strategy_id": extra_sid,
    "name": extra_sid,
    "source_type": "manual",
    "config_json": "{}",
})
extra_id = r.json()["data"]["strategy_id"]
httpx.post(f"{BASE}/api/v1/strategies/{extra_id}/start", headers=H)

# 一键暂停
r = httpx.post(f"{BASE}/api/v1/strategies/pause-all", headers=H)
check("POST /strategies/pause-all 200", r.status_code == 200)
pause_data = r.json()["data"]
check("pause-all 返回 stopped 列表", isinstance(pause_data.get("stopped"), list))
check("pause-all 停止 >= 1 个策略", pause_data.get("count", 0) >= 1)

# 验证策略确实已停止
r = httpx.get(f"{BASE}/api/v1/strategies", headers=H)
strats = r.json()["data"]
running = [s for s in strats if s.get("status") == "running"]
check("暂停后无运行中策略", len(running) == 0)

# 暂停后审计日志包含 pause_all 记录
r = httpx.get(f"{BASE}/api/v1/audit-logs?target_type=strategy", headers=H)
audits = r.json()["data"]
check("审计日志含 pause_all 记录", any("pause_all" in a.get("action","") or "一键暂停" in a.get("remark","") for a in audits))


# ══════════════════════════════════════════════════════
# 6. 备份脚本
# ══════════════════════════════════════════════════════
print("\n═══ 6. BACKUP 备份脚本 ═══")

backup_script = SCRIPTS_DIR / "backup_db.py"
check("backup_db.py 文件存在", backup_script.exists())

restore_script = SCRIPTS_DIR / "restore_db.py"
check("restore_db.py 文件存在", restore_script.exists())

# 执行备份
result = subprocess.run(
    [VENV_PYTHON, str(backup_script)],
    capture_output=True, text=True, cwd=str(BACKEND_DIR),
)
check("backup_db.py 执行成功", result.returncode == 0, result.stdout.strip()[-80:] if result.stdout else result.stderr[:80])

# 检查备份文件生成
backup_dir = BACKEND_DIR / "runtime" / "backups"
backups = list(backup_dir.glob("app_*.db")) if backup_dir.exists() else []
check("备份文件已生成", len(backups) > 0)

# 执行 restore --list
result2 = subprocess.run(
    [VENV_PYTHON, str(restore_script), "--list"],
    capture_output=True, text=True, cwd=str(BACKEND_DIR),
)
check("restore_db.py --list 执行成功", result2.returncode == 0)


# ══════════════════════════════════════════════════════
# 7. Phase 2 接口预留 + 文档
# ══════════════════════════════════════════════════════
print("\n═══ 7. PHASE2 接口 + 文档 ═══")

phase2_file = BACKEND_DIR / "app" / "core" / "phase2_stubs.py"
check("phase2_stubs.py 文件存在", phase2_file.exists())
content = phase2_file.read_text(encoding="utf-8")
check("Phase 2 含 RealXtdataAdapter", "RealXtdataAdapter" in content)
check("Phase 2 含 AuthService", "AuthService" in content)
check("Phase 2 含 AdvancedRiskEngine", "AdvancedRiskEngine" in content)
check("Phase 2 含 StrategyProcessManager", "StrategyProcessManager" in content)
check("Phase 2 含 MultiAccountManager", "MultiAccountManager" in content)
check("Phase 2 含 TradingCalendarService", "TradingCalendarService" in content)
check("Phase 2 含 RealtimePushService", "RealtimePushService" in content)

deploy_doc = BACKEND_DIR.parent / "docs" / "deployment.md"
check("deployment.md 文件存在", deploy_doc.exists())
doc_text = deploy_doc.read_text(encoding="utf-8")
check("文档含运维红线", "运维红线" in doc_text or "禁止" in doc_text)
check("文档含 Phase 1 已知限制", "已知限制" in doc_text)
check("文档含 Phase 2 扩展指南", "Phase 2" in doc_text)
check("文档含备份恢复说明", "备份" in doc_text and "恢复" in doc_text)


# ══════════════════════════════════════════════════════
# 8. Preflight 集成到启动
# ══════════════════════════════════════════════════════
print("\n═══ 8. 启动集成验证 ═══")

main_py = BACKEND_DIR / "app" / "main.py"
main_text = main_py.read_text(encoding="utf-8")
check("main.py 含 preflight 集成", "run_preflight" in main_text)
check("main.py 缓存 preflight 结果", "preflight_results" in main_text)


# ══════════════════════════════════════════════════════
#  汇总
# ══════════════════════════════════════════════════════
print("\n" + "═" * 50)
passed = sum(results)
total = len(results)
print(f"Phase 8 验证: {passed}/{total} 通过")
if passed == total:
    print("✅ Phase 8 全部通过 — 第一阶段上线前必须项验证完成")
else:
    failed = [i + 1 for i, ok in enumerate(results) if not ok]
    print(f"❌ 失败项: {failed}")
sys.exit(0 if passed == total else 1)
