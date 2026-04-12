"""模拟策略启动失败脚本 — 立即退出 code=1"""
import os
import sys

sid = os.environ.get("QMT_STRATEGY_ID", "unknown")
print(f"[mock_fail] strategy={sid} FAILED to start!", flush=True, file=sys.stderr)
sys.exit(1)
