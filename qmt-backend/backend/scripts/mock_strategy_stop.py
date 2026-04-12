"""模拟策略停止脚本 — 输出后正常退出"""
import os
import sys

sid = os.environ.get("QMT_STRATEGY_ID", "unknown")
print(f"[mock_stop] strategy={sid} stopping...", flush=True)
print(f"[mock_stop] PID={os.getpid()}", flush=True)
sys.exit(0)
