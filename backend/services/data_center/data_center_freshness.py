"""Data freshness presentation helpers for the data center service."""

from datetime import datetime

from backend.schemas.data_center import DataCoverageRecord, DataFreshnessItem


def coverage_unit(data_type: str) -> str:
    return "覆盖单元" if data_type == "minute_kline" else "行"


def coverage_unit_note(data_type: str) -> str:
    if data_type == "minute_kline":
        return "分钟K覆盖单元=股票-交易日，用来判断是否每只股票每天都有分钟数据，不等于1分钟bar原始行数。"
    if data_type == "daily_kline":
        return "日K按实际落库K线行数统计。"
    return "按本地 SQLite 表记录数或覆盖检查单位统计。"


def latest_date(value: str | None) -> str | None:
    return value[:10] if value else None


def freshness_lag_days(latest_time: str | None, target_date: str) -> int | None:
    day_text = latest_date(latest_time)
    if not day_text:
        return None
    try:
        return max((datetime.strptime(target_date, "%Y-%m-%d").date() - datetime.strptime(day_text, "%Y-%m-%d").date()).days, 0)
    except ValueError:
        return None


def build_freshness_item(
    *,
    key: str,
    name: str,
    table_name: str,
    latest_time: str | None,
    suggestion: str,
    target_date: str,
    account_id: str | None,
    required: bool = True,
    coverage: DataCoverageRecord | None = None,
    fresh_suggestion: str | None = None,
) -> DataFreshnessItem:
    day_text = latest_date(latest_time)
    item_lag = freshness_lag_days(latest_time, target_date)
    coverage_status = coverage.status if coverage else None
    coverage_rate = coverage.coverage_rate if coverage else None
    item_coverage_unit = coverage_unit(coverage.data_type) if coverage else None
    item_coverage_unit_note = coverage_unit_note(coverage.data_type) if coverage else None

    if not day_text:
        status = "missing" if required else "unknown"
        message = f"{name}暂无本地记录。"
    elif day_text < target_date:
        status = "stale"
        message = f"{name}：最新日期为 {day_text}，落后目标交易日 {target_date}。"
    elif coverage and coverage.status != "complete":
        status = "partial"
        message = f"{name}已到 {day_text}，但覆盖率为 {coverage.coverage_rate:.2f}%，状态 {coverage.status}。"
    else:
        status = "fresh"
        message = f"{name}：已到目标交易日 {target_date}。"

    if not required and status in {"missing", "stale", "unknown"}:
        status = "unknown"
        if day_text and day_text < target_date:
            message = f"{name}：最新记录为 {day_text}；若账户在 {target_date} 没有委托或成交，这是正常状态。"
        else:
            message = f"{name}暂无本地记录；若账户当天没有委托或成交，这是正常状态。"

    effective_suggestion = fresh_suggestion if status == "fresh" and fresh_suggestion else suggestion
    return DataFreshnessItem(
        key=key,
        name=name,
        table_name=table_name,
        latest_time=latest_time,
        latest_date=day_text,
        target_date=target_date,
        lag_days=item_lag,
        status=status,
        message=message,
        suggestion=effective_suggestion,
        coverage_status=coverage_status,
        coverage_rate=coverage_rate,
        coverage_checked_at=coverage.checked_at if coverage else None,
        actual_rows=coverage.actual_rows if coverage else None,
        coverage_unit=item_coverage_unit,
        coverage_unit_note=item_coverage_unit_note,
        actual_coverage_units=coverage.actual_rows if coverage else None,
        technical_detail=(
            f"account_id={account_id or ''}; coverage_status={coverage_status or ''}; "
            f"coverage_checked_at={coverage.checked_at if coverage else ''}; "
            f"coverage_unit={item_coverage_unit or ''}; coverage_unit_note={item_coverage_unit_note or ''}"
        ),
    )


def build_freshness_next_actions(items: list[DataFreshnessItem]) -> list[str]:
    next_actions: list[str] = []
    if any(item.key == "trading_calendar" and item.status != "fresh" for item in items):
        next_actions.append("先同步交易日历，避免同步截止日和回测交易日判断继续停留在旧日期。")
    if any(item.key == "daily_kline" and item.status != "fresh" for item in items):
        next_actions.append("执行全市场日 K 补齐到最新完成交易日，并复查 2026 日 K 覆盖率。")
    if any(item.key == "minute_kline" and item.status != "fresh" for item in items):
        next_actions.append("对分钟 K 执行缺失续跑；分钟策略回测必须等覆盖率 complete 后再正式验收。")
    if any(item.key in {"account_snapshot", "position_snapshot"} and item.status != "fresh" for item in items):
        next_actions.append("同步账户资金和持仓快照；真实交易判断不能依赖旧账户数据。")
    if not next_actions:
        next_actions.append("数据新鲜度已满足当前目标交易日，可继续做数据质量检查或正式回测验收。")
    return next_actions


def freshness_status_counts(items: list[DataFreshnessItem]) -> tuple[int, int, str]:
    stale_count = sum(1 for item in items if item.status in {"missing", "stale", "partial"})
    warning_count = sum(1 for item in items if item.status == "unknown")
    overall_status = "failed" if stale_count else "warning" if warning_count else "success"
    return stale_count, warning_count, overall_status
