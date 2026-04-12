"""
立即非 0 退出的脚本 — 验证 exit code 非0 场景
"""
import sys
print("[fail_strategy] about to fail with exit code 1", flush=True)
sys.exit(1)
