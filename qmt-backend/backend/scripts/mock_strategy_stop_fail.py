"""模拟策略停止失败脚本 — 输出后退出 code=1"""
import os
import sys

sid = os.environ.get("QMT_STRATEGY_ID", "unknown")
print(f"[mock_stop_fail] strategy={sid} STOP FAILED!", flush=True, file=sys.stderr)
sys.exit(1)
