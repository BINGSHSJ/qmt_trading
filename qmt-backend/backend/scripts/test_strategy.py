"""
简单长运行策略脚本 — 用于验证非 mock 启动/停止

持续运行，每 2 秒输出心跳到 stdout，收到终止信号后优雅退出。
"""
import os
import sys
import time
import signal

running = True

def on_signal(signum, frame):
    global running
    print(f"[test_strategy] received signal {signum}, shutting down...", flush=True)
    running = False

# Windows: CTRL_BREAK_EVENT -> SIGBREAK
if sys.platform == "win32":
    signal.signal(signal.SIGBREAK, on_signal)
else:
    signal.signal(signal.SIGTERM, on_signal)

print(f"[test_strategy] started, PID={os.getpid()}", flush=True)
print(f"[test_strategy] QMT_STRATEGY_ID={os.environ.get('QMT_STRATEGY_ID', 'N/A')}", flush=True)
print(f"[test_strategy] STRATEGY_DATA_PATH={os.environ.get('STRATEGY_DATA_PATH', 'N/A')}", flush=True)

while running:
    time.sleep(2)
    print(f"[test_strategy] heartbeat {time.strftime('%H:%M:%S')}", flush=True)

print("[test_strategy] exited cleanly", flush=True)
