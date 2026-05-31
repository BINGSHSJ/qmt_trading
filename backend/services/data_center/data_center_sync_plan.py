"""2026 sync plan presentation helpers."""

from dataclasses import dataclass

from backend.schemas.data_center import Prepare2026Plan, Prepare2026Request, Prepare2026Step


@dataclass(frozen=True)
class MinutePlanStats:
    scope_text: str
    symbol_count: int
    trading_day_count: int
    window_count: int
    total_batches: int


def build_prepare_2026_plan(
    *,
    request: Prepare2026Request,
    scope_label: str,
    test_isolation: bool,
    minute_stats: MinutePlanStats | None,
) -> Prepare2026Plan:
    steps = [
        Prepare2026Step(
            step_no=1,
            data_type="stock_basic",
            name="股票基础资料",
            scope=scope_label,
            required=True,
            long_task=True,
            default_enabled=True,
        ),
        Prepare2026Step(
            step_no=2,
            data_type="trading_calendar",
            name="2026 交易日历",
            scope="SH / SZ，2026 已发生交易日",
            required=True,
            long_task=False,
            default_enabled=True,
            warning="业务运行使用真实 QMT 交易日历；测试隔离数据仅用于自动化回归，不作为正式验收依据。",
        ),
        Prepare2026Step(
            step_no=3,
            data_type="instrument_detail",
            name="合约基础信息",
            scope=scope_label,
            required=True,
            long_task=True,
            default_enabled=True,
        ),
        Prepare2026Step(
            step_no=4,
            data_type="daily_kline",
            name="2026 日 K",
            scope=scope_label,
            required=True,
            long_task=True,
            default_enabled=request.include_daily_kline,
        ),
        Prepare2026Step(
            step_no=5,
            data_type="minute_kline",
            name=f"2026 {request.period} 分钟 K",
            scope="持仓 / 策略池 / 手动股票" if not request.include_full_market_minute else "全市场手动长任务",
            required=True,
            long_task=True,
            default_enabled=request.include_minute_kline,
            warning="全市场 2026 分钟 K 默认不自动执行，必须用户手动勾选并分批运行。",
        ),
        Prepare2026Step(
            step_no=6,
            data_type="financial",
            name="2026 已披露财务数据",
            scope=scope_label,
            required=False,
            long_task=True,
            default_enabled=request.include_financial,
            warning="财务数据规划中；回测使用必须按披露日期过滤，避免未来函数。",
        ),
    ]
    warnings = build_prepare_2026_warnings(request, minute_stats)
    return Prepare2026Plan(
        start_date=request.start_date,
        end_date=request.end_date,
        stock_scope=request.stock_scope,
        period=request.period,
        steps=steps,
        warnings=warnings,
        test_isolation=test_isolation,
        mock_safe=test_isolation,
    )


def build_prepare_2026_warnings(request: Prepare2026Request, minute_stats: MinutePlanStats | None) -> list[str]:
    warnings = [
        "不会同步未来尚未发生的行情数据。",
        "不会默认同步全市场 Tick、Level2、信用账户或外部数据源。",
        "全市场 2026 分钟 K 属于手动长任务，默认关闭。",
        f"2026 日 K 一次点击会自动跑完整市场，内部按每批最多 {request.daily_batch_size} 只股票自动执行，并使用 sync_cursor 断点续跑。",
    ]
    if request.include_minute_kline and minute_stats:
        warnings.append(
            f"2026 分钟 K 将按{minute_stats.scope_text}执行：约 {minute_stats.symbol_count} 只股票、"
            f"{minute_stats.trading_day_count} 个交易日、{minute_stats.window_count} 个时间窗口、"
            f"{minute_stats.total_batches} 个批次；使用日 K 可交易日校验和 sync_cursor 断点续跑。"
        )
        if request.include_full_market_minute:
            warnings.append("全市场分钟 K 数据量很大，属于显式手动长任务；系统不会默认自动开启，也不会只截断首批 200 只。")
    if request.include_minute_kline and not request.include_full_market_minute and not request.symbols:
        warnings.append("分钟 K 未指定股票时，只使用当前持仓；没有持仓数据时仅取少量示例股票，避免误跑全市场。")
    if request.include_full_market_minute and not request.include_minute_kline:
        warnings.append("已选择全市场分钟 K 范围，但分钟 K 同步未启用；本次只生成计划不执行分钟 K。")
    return warnings
