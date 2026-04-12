"""验证数据库初始化结果"""
import sqlite3

db = sqlite3.connect("app/db/app.db")
cur = db.cursor()

# 1) WAL
cur.execute("PRAGMA journal_mode;")
wal = cur.fetchone()[0]
ok1 = wal == "wal"
print(f"[1] journal_mode = {wal}", "PASS" if ok1 else "FAIL")

# 2) Tables
cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
tables = [r[0] for r in cur.fetchall()]
print(f"[2] tables = {tables}")
expected = [
    "_migration_history", "audit_log", "fill_record", "order_record",
    "position_snapshot", "risk_event", "signal_record",
    "strategy", "strategy_runtime_state", "system_log",
]
missing = set(expected) - set(tables)
ok2 = not missing
print(f"    missing = {missing}", "PASS" if ok2 else "FAIL")

# 3) Indexes
cur.execute("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'ix_%' ORDER BY name")
indexes = [r[0] for r in cur.fetchall()]
print(f"[3] indexes ({len(indexes)}):")
for idx in indexes:
    print(f"    {idx}")
expected_ix = [
    "ix_audit_log_created", "ix_audit_log_target",
    "ix_fill_record_order_id",
    "ix_order_record_strategy_created",
    "ix_position_snapshot_acct_sym_time",
    "ix_risk_event_risk_level", "ix_risk_event_strategy_created",
    "ix_signal_record_strategy_created",
    "ix_strategy_runtime_state_strategy_id", "ix_strategy_strategy_id",
    "ix_system_log_module_created",
]
missing_ix = set(expected_ix) - set(indexes)
ok3 = not missing_ix
print(f"    missing indexes = {missing_ix}", "PASS" if ok3 else "FAIL")

# 4) Migration history
cur.execute("SELECT filename FROM _migration_history")
history = [r[0] for r in cur.fetchall()]
ok4 = len(history) == 1
print(f"[4] migration_history = {history}", "PASS" if ok4 else "FAIL")

db.close()

# 5) API still works
import httpx
r = httpx.get("http://127.0.0.1:8001/api/v1/system-health", headers={"X-API-Key": "dev-api-key-change-me"})
ok5 = r.status_code == 200 and r.json()["code"] == 0
print(f"[5] system-health = {r.status_code}", "PASS" if ok5 else "FAIL")

all_pass = all([ok1, ok2, ok3, ok4, ok5])
print()
print("=== ALL PASS ===" if all_pass else "=== SOME FAILED ===")
