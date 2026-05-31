"""Data quality check definitions and presentation helpers."""

from typing import Any

QUALITY_TABLES: list[tuple[str, str]] = [
    ("stock_basic", "股票基础"),
    ("instrument_detail", "合约基础"),
    ("trading_calendar", "交易日历"),
    ("account_snapshot", "账户资金"),
    ("position_snapshot", "持仓快照"),
    ("order_record", "委托记录"),
    ("trade_record", "成交记录"),
    ("daily_kline", "日K数据"),
    ("minute_kline", "分钟K数据"),
    ("sync_cursor", "同步游标"),
]

OPTIONAL_FLOW_TABLES: dict[str, str] = {
    "order_record": "委托记录为空；若当前账户当天没有委托，这是正常状态。",
    "trade_record": "成交记录为空；若当前账户当天没有成交，这是正常状态。",
}

QUALITY_TIME_CHECKS: list[tuple[str, str, str, str]] = [
    ("instrument_detail", "sync_time", "合约基础", "请先同步合约基础信息。"),
    ("trading_calendar", "trade_date", "交易日历", "请先同步 2026 交易日历。"),
    ("account_snapshot", "snapshot_time", "账户资金", "请先同步账户资金。"),
    ("position_snapshot", "snapshot_time", "持仓快照", "请先同步持仓。"),
    ("order_record", "order_time", "委托记录", "请先同步委托。"),
    ("trade_record", "trade_time", "成交记录", "请先同步成交。"),
    ("daily_kline", "trade_date", "日K", "请先同步日K数据。"),
    ("minute_kline", "datetime", "分钟K", "请按股票和时间范围同步分钟K数据。"),
    ("sync_cursor", "updated_at", "同步游标", "请至少完成一次数据同步以生成增量游标。"),
]

QUALITY_DUPLICATE_CHECKS: list[tuple[str, str, list[str], str]] = [
    ("重复数据", "stock_basic", ["symbol"], "股票基础"),
    ("重复数据", "instrument_detail", ["symbol"], "合约基础"),
    ("重复数据", "trading_calendar", ["market", "trade_date"], "交易日历"),
    ("重复数据", "account_snapshot", ["account_id", "snapshot_time"], "账户资金"),
    ("重复数据", "position_snapshot", ["account_id", "symbol", "snapshot_time"], "持仓快照"),
    ("重复数据", "daily_kline", ["symbol", "trade_date"], "日K"),
    ("重复数据", "minute_kline", ["symbol", "period", "datetime"], "分钟K"),
    ("重复数据", "order_record", ["local_order_id"], "委托"),
    ("重复数据", "trade_record", ["trade_id"], "成交"),
    ("重复数据", "sync_cursor", ["source_code", "data_type", "symbol", "period"], "同步游标"),
]


def build_table_count_result(table: str, label: str, count: int) -> dict[str, Any]:
    if table in OPTIONAL_FLOW_TABLES and count == 0:
        return {
            "check_type": "数据为空",
            "target_table": table,
            "status": "success",
            "message": OPTIONAL_FLOW_TABLES[table],
            "suggestion": None,
        }
    return {
        "check_type": "数据为空",
        "target_table": table,
        "status": "success" if count > 0 else "warning",
        "message": f"{label} 当前共有 {count} 条记录。",
        "suggestion": None if count > 0 else f"请到数据同步中同步{label}。",
    }


def build_time_result(table: str, label: str, latest: str | None, suggestion: str) -> dict[str, Any]:
    if table in OPTIONAL_FLOW_TABLES and not latest:
        return {
            "check_type": "更新时间",
            "target_table": table,
            "status": "success",
            "message": f"{label}最近时间：暂无；若当前账户当天没有委托或成交，这是正常状态。",
            "suggestion": None,
        }
    return {
        "check_type": "更新时间",
        "target_table": table,
        "status": "success" if latest else "warning",
        "message": f"{label}最近时间：{latest or '暂无'}。",
        "suggestion": None if latest else suggestion,
    }


def build_duplicate_result(
    *,
    check_type: str,
    table: str,
    label: str,
    duplicate_count: int,
    account_scope: str | None,
) -> dict[str, Any]:
    label_text = f"{label}（当前账户 {account_scope}）" if account_scope else label
    return {
        "check_type": check_type,
        "target_table": table,
        "status": "success" if duplicate_count == 0 else "failed",
        "message": f"{label_text}重复键组数：{duplicate_count}。",
        "suggestion": None if duplicate_count == 0 else "请检查唯一索引和同步来源，避免重复写入。",
    }
