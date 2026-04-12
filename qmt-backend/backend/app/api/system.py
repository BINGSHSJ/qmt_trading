"""
System API — /api/v1/system-health, /api/v1/system-preflight, /api/v1/audit-logs
"""

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_env_settings, yaml_get
from app.core.dependencies import verify_api_key, get_request_id
from app.core.enums import SystemHealthStatus, SystemMode
from app.core.response import ApiResponse
from app.adapters.factory import get_xtdata_adapter, get_xttrader_adapter, clear_adapter_cache
from app.db.database import get_db, get_engine
from app.services.audit_service import AuditLogRepository

router = APIRouter(prefix="/api/v1", tags=["system"])


@router.get("/health")
async def health_check():
    """轻量健康检查（不需鉴权，适合负载均衡 / 监控探针）"""
    return ApiResponse.success(data={"status": "ok"})


@router.get("/system-health", dependencies=[Depends(verify_api_key)])
async def system_health(
    request: Request,
    request_id: str = Depends(get_request_id),
    db: AsyncSession = Depends(get_db),
):
    settings = get_env_settings()
    mode = SystemMode.SIMULATED.value if settings.mock_mode else SystemMode.LIVE.value

    # Adapter 健康检查
    xtdata_health: dict = {"connected": False, "error": "adapter not available", "detail": {}}
    xttrader_health: dict = {"connected": False, "error": "adapter not available", "detail": {}}
    try:
        xtdata = get_xtdata_adapter()
        xtdata_health = await xtdata.check_health()
    except Exception as e:
        xtdata_health = {"connected": False, "error": str(e), "detail": {}}
    try:
        xttrader = get_xttrader_adapter()
        xttrader_health = await xttrader.check_health()
    except Exception as e:
        xttrader_health = {"connected": False, "error": str(e), "detail": {}}

    # 综合健康状态
    all_connected = xtdata_health.get("connected") and xttrader_health.get("connected")
    overall = SystemHealthStatus.NORMAL.value if all_connected else SystemHealthStatus.DEGRADED.value

    # 策略运行统计
    from app.repositories.strategy_repo import StrategyRepository
    strat_repo = StrategyRepository(db)
    strategies = await strat_repo.list_all(limit=1000)
    running_count = sum(1 for s in strategies if s.status == "running")

    # 今日统计（信号/委托/成交/风控事件）
    from app.repositories.trading_repo import SignalRecordRepository, OrderRecordRepository, FillRecordRepository
    from app.repositories.risk_repo import RiskEventRepository
    signal_repo = SignalRecordRepository(db)
    order_repo = OrderRecordRepository(db)
    fill_repo = FillRecordRepository(db)
    risk_repo = RiskEventRepository(db)

    today_signal_count = await signal_repo.count_today()
    today_order_count = await order_repo.count_today()
    today_fill_count = await fill_repo.count_today()
    today_risk_count = await risk_repo.count_today()

    # 最近风控事件（三级区数据源）
    recent_risk_events = await risk_repo.list_all(offset=0, limit=5)
    recent_risk = [
        {
            "rule_name": e.rule_name,
            "risk_level": e.risk_level,
            "description": e.description,
            "created_at": e.created_at.isoformat(timespec="seconds") if e.created_at else "",
        }
        for e in recent_risk_events
    ]

    # preflight 汇总
    preflight_data = getattr(request.app.state, "preflight_results", [])
    from app.core.preflight import get_critical_failures
    critical_failures = get_critical_failures(preflight_data)

    return ApiResponse.success(
        data={
            "status": overall,
            "mode": mode,
            "mock_mode": settings.mock_mode,
            "env": settings.env,
            "timestamp": datetime.now().isoformat(timespec="seconds"),
            "components": {
                "xtdata": xtdata_health,
                "xttrader": xttrader_health,
            },
            "strategies": {
                "total": len(strategies),
                "running": running_count,
            },
            "today": {
                "signal_count": today_signal_count,
                "order_count": today_order_count,
                "fill_count": today_fill_count,
                "risk_event_count": today_risk_count,
            },
            "recent_risk_events": recent_risk,
            "preflight": {
                "critical_ok": len(critical_failures) == 0,
                "critical_failures": critical_failures,
                "checks": preflight_data,
            },
        },
        request_id=request_id,
    )


@router.get("/system-preflight", dependencies=[Depends(verify_api_key)])
async def system_preflight(
    request: Request,
    request_id: str = Depends(get_request_id),
    refresh: bool = Query(False, description="是否重新执行检查"),
):
    """返回启动前检查结果（支持 refresh=true 重新执行）"""
    if not refresh:
        cached = getattr(request.app.state, "preflight_results", None)
        if cached:
            all_pass = all(c["passed"] for c in cached)
            return ApiResponse.success(
                data={"all_passed": all_pass, "checks": cached, "cached": True},
                request_id=request_id,
            )

    from app.core.preflight import run_preflight
    # 刷新时清除 adapter 缓存，以检测 xtquant 可用性变化
    clear_adapter_cache()
    engine = get_engine()
    async with engine.connect() as conn:
        items = await run_preflight(conn)
    data = [i.to_dict() for i in items]
    all_pass = all(i.passed for i in items)
    # 同步更新 app.state，确保后续 start 阻断读取最新结果
    request.app.state.preflight_results = data
    return ApiResponse.success(
        data={"all_passed": all_pass, "checks": data, "cached": False},
        request_id=request_id,
    )


@router.post("/internal/preflight-override", dependencies=[Depends(verify_api_key)])
async def test_preflight_override(
    request: Request,
    request_id: str = Depends(get_request_id),
):
    """[DEV-ONLY] 覆盖 preflight 结果，用于验证启动阻断逻辑。

    仅在 env=dev 时可用。
    Body: {"checks": [...]}  → 直接写入 app.state.preflight_results
    Body: {"restore": true}  → 恢复真实 preflight 结果
    """
    settings = get_env_settings()
    if settings.env != "dev":
        return ApiResponse.error(code=403, message="仅 dev 环境可用")

    import json
    body = await request.json()

    if body.get("restore"):
        # 重新执行真实 preflight
        from app.core.preflight import run_preflight
        clear_adapter_cache()
        engine = get_engine()
        async with engine.connect() as conn:
            items = await run_preflight(conn)
        data = [i.to_dict() for i in items]
        request.app.state.preflight_results = data
        return ApiResponse.success(
            data={"restored": True, "checks": data},
            request_id=request_id,
        )

    checks = body.get("checks")
    if checks and isinstance(checks, list):
        request.app.state.preflight_results = checks
        return ApiResponse.success(
            data={"overridden": True, "checks": checks},
            request_id=request_id,
        )

    return ApiResponse.error(code=400, message="需要 checks 列表或 restore=true")


@router.get("/audit-logs", dependencies=[Depends(verify_api_key)])
async def list_audit_logs(
    target_type: Optional[str] = Query(None),
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    request_id: str = Depends(get_request_id),
    db: AsyncSession = Depends(get_db),
):
    """查询审计日志"""
    repo = AuditLogRepository(db)
    if target_type:
        from sqlalchemy import select
        from app.models.tables import AuditLog
        stmt = (
            select(AuditLog)
            .where(AuditLog.target_type == target_type)
            .order_by(AuditLog.id.desc())
            .offset(offset).limit(limit)
        )
        result = await db.execute(stmt)
        records = result.scalars().all()
    else:
        records = await repo.list_all(offset=offset, limit=limit)
    data = [{
        "id": r.id,
        "action": r.action,
        "target_type": r.target_type,
        "target_id": r.target_id,
        "before_json": r.before_json,
        "after_json": r.after_json,
        "operator": r.operator,
        "remark": r.remark,
        "created_at": r.created_at.isoformat(timespec="seconds") if r.created_at else "",
    } for r in records]
    return ApiResponse.success(data=data, request_id=request_id)
