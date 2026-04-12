"""
verify_architecture_audit.py — v2.8 架构差距修复 验证脚本

验证内容:
  1. max_daily_loss_pct 风控规则已实现
  2. 交易日历包含 A 股节假日
  3. /api/v1/health 轻量端点存在
  4. system-health 返回今日统计 + 最近风控
  5. Dashboard 前端包含今日统计
  6. config.example.yaml 存在且完整
  7. 心跳超时可从配置读取
  8. 日志清理脚本存在
  9. 前端 actionBusy useRef (残余修复)
  10. WS 重连 refreshCurrentPage (残余修复)

运行: cd backend && $env:PYTHONPATH="$PWD"; .venv\Scripts\python.exe verify_architecture_audit.py
"""

import asyncio
import sys
from datetime import datetime, date
from pathlib import Path

backend_dir = Path(__file__).resolve().parent
sys.path.insert(0, str(backend_dir))

BASE = "http://127.0.0.1:8001"
API_KEY = "dev-api-key-change-me"
HEADERS = {"X-API-Key": API_KEY}

passed = 0
failed = 0


def check(name: str, condition: bool, detail: str = ""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  ✅ {name}" + (f" — {detail}" if detail else ""))
    else:
        failed += 1
        print(f"  ❌ {name}" + (f" — {detail}" if detail else ""))


async def main():
    global passed, failed
    import httpx

    print("\n=== v2.8 架构差距修复 验证 ===\n")

    # ── 1. max_daily_loss_pct 风控规则 ────────────────
    print("[1] max_daily_loss_pct 风控规则")
    from app.services.risk_service import RiskService
    import inspect
    source = inspect.getsource(RiskService.pre_order_check)
    check("pre_order_check 包含 max_daily_loss_pct", "max_daily_loss_pct" in source)
    check("pre_order_check 包含 query_account", "query_account" in source)
    check("包含 MAX_DAILY_LOSS 拒绝原因", "MAX_DAILY_LOSS" in source)

    # ── 2. 交易日历节假日 ────────────────────────────
    print("\n[2] 交易日历 A 股节假日")
    from app.core.trading_calendar import is_trading_day, _CN_HOLIDAYS

    # 2026 春节不是交易日
    check("2026春节非交易日", not is_trading_day(datetime(2026, 2, 17)))
    # 2026 国庆非交易日
    check("2026国庆非交易日", not is_trading_day(datetime(2026, 10, 1)))
    # 正常工作日是交易日 (2026-04-13 是周一)
    check("2026-04-13 是交易日", is_trading_day(datetime(2026, 4, 13)))
    # 周末不是交易日
    check("周末非交易日", not is_trading_day(datetime(2026, 4, 11)))
    # 节假日集合数量
    check(f"节假日表包含 {len(_CN_HOLIDAYS)} 天", len(_CN_HOLIDAYS) >= 30,
          f"共 {len(_CN_HOLIDAYS)} 天")

    # ── 3. /api/v1/health 轻量端点 ──────────────────
    print("\n[3] /api/v1/health 轻量端点")
    async with httpx.AsyncClient(base_url=BASE, timeout=10) as c:
        r = await c.get("/api/v1/health")
        check("/health 状态码 200", r.status_code == 200)
        data = r.json()
        check("/health 不需鉴权", data.get("code") == 0)
        check("/health 返回 ok", data.get("data", {}).get("status") == "ok")

    # ── 4. system-health 今日统计 ────────────────────
    print("\n[4] system-health 今日统计")
    async with httpx.AsyncClient(base_url=BASE, timeout=10) as c:
        r = await c.get("/api/v1/system-health", headers=HEADERS)
        check("system-health 200", r.status_code == 200)
        d = r.json().get("data", {})

        today = d.get("today", {})
        check("包含 today.signal_count", "signal_count" in today,
              f"signal_count={today.get('signal_count')}")
        check("包含 today.order_count", "order_count" in today)
        check("包含 today.fill_count", "fill_count" in today)
        check("包含 today.risk_event_count", "risk_event_count" in today)
        check("包含 recent_risk_events", "recent_risk_events" in d)

    # ── 5. Dashboard 前端今日统计 ────────────────────
    print("\n[5] Dashboard 前端今日统计")
    app_jsx = backend_dir / "frontend-admin" / "src" / "App.jsx"
    jsx = app_jsx.read_text(encoding="utf-8")
    check("包含 todayStats", "todayStats" in jsx)
    check("包含今日信号 Statistic", "今日信号" in jsx)
    check("包含今日委托 Statistic", "今日委托" in jsx)
    check("包含今日成交 Statistic", "今日成交" in jsx)
    check("包含今日风控 Statistic", "今日风控" in jsx)
    check("包含 recentRisk 最近风控", "recentRisk" in jsx)
    check("包含最近风控告警 Card", "最近风控告警" in jsx)

    # ── 6. config.example.yaml ───────────────────────
    print("\n[6] config.example.yaml")
    example_cfg = backend_dir / "config.example.yaml"
    check("config.example.yaml 存在", example_cfg.exists())
    if example_cfg.exists():
        cfg_content = example_cfg.read_text(encoding="utf-8")
        check("包含 rate_limit 段", "rate_limit:" in cfg_content)
        check("包含 strategy 段", "strategy:" in cfg_content)
        check("包含 trading 段", "trading:" in cfg_content)
        check("包含 heartbeat_timeout_sec", "heartbeat_timeout_sec" in cfg_content)

    # ── 7. 心跳超时可配置 ────────────────────────────
    print("\n[7] 心跳超时可配置")
    from app.services.strategy_service import _get_heartbeat_timeout
    timeout = _get_heartbeat_timeout()
    check("_get_heartbeat_timeout() 可调用", timeout > 0, f"当前值: {timeout}s")
    check("默认值为 120", timeout == 120)

    # 检查策略服务不再使用硬编码
    svc_src = (backend_dir / "app" / "services" / "strategy_service.py").read_text(encoding="utf-8")
    check("不再有 HEARTBEAT_TIMEOUT_SEC = 120", "HEARTBEAT_TIMEOUT_SEC = 120" not in svc_src)
    check("使用 _get_heartbeat_timeout()", "_get_heartbeat_timeout()" in svc_src)

    # ── 8. 日志清理脚本 ─────────────────────────────
    print("\n[8] 日志清理脚本")
    cleanup_script = backend_dir / "scripts" / "cleanup_logs.py"
    check("cleanup_logs.py 存在", cleanup_script.exists())
    if cleanup_script.exists():
        cs = cleanup_script.read_text(encoding="utf-8")
        check("包含 retention_days", "retention_days" in cs)
        check("包含 dry-run 参数", "dry-run" in cs or "dry_run" in cs)
        check("处理日志目录", "log_dir" in cs or "log" in cs)
        check("处理备份目录", "backup_dir" in cs or "backup" in cs)

    # ── 9. 前端残余修复 ─────────────────────────────
    print("\n[9] 前端残余修复 (batch 4-3)")
    check("actionBusy 用 useRef", "actionBusyRef = useRef" in jsx)
    check("WS 重连调 refreshCurrentPage", "refreshCurrentPage()" in jsx.split("ws.onopen")[1][:200] if "ws.onopen" in jsx else False)

    # ── 10. batch 4-4 保持兼容 ──────────────────────
    print("\n[10] batch 4-4 向后兼容")
    api_js = (backend_dir / "frontend-admin" / "src" / "api.js").read_text(encoding="utf-8")
    check("api.js X-API-Key header", "X-API-Key" in api_js)

    async with httpx.AsyncClient(base_url=BASE, timeout=10) as c:
        # /auth/session 需要 API Key
        r = await c.post("/api/v1/auth/session", json={})
        check("/auth/session 无 Key = 401", r.status_code == 401)

        r = await c.post("/api/v1/auth/session", json={}, headers=HEADERS)
        check("/auth/session 有 Key = 200", r.status_code == 200)

    # ── 汇总 ────────────────────────────────────────
    total = passed + failed
    print(f"\n{'='*50}")
    print(f"验证完成: {passed}/{total} 通过", end="")
    if failed:
        print(f", {failed} 失败 ❌")
    else:
        print(" ✅ 全部通过")
    print(f"{'='*50}\n")

    return failed == 0


if __name__ == "__main__":
    ok = asyncio.run(main())
    sys.exit(0 if ok else 1)
