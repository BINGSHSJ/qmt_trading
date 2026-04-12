"""模拟策略启动脚本 — 立即输出并持续运行"""
import os
import sys
import time

sid = os.environ.get("QMT_STRATEGY_ID", "unknown")
custom_val = os.environ.get("STRATEGY_CUSTOM_VAR", "not_set")

print(f"[mock_start] strategy={sid} starting...", flush=True)
print(f"[mock_start] STRATEGY_CUSTOM_VAR={custom_val}", flush=True)
print(f"[mock_start] PID={os.getpid()}", flush=True)

# 持续运行，直到被终止
while True:
    time.sleep(1)
