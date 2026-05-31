STATUS_MAP = {
    "pending": "待提交",
    "created": "待提交",
    "submitted": "已提交",
    "submit": "已提交",
    "accepted": "已报",
    "reported": "已报",
    "entrusted": "已报",
    "partial_filled": "部分成交",
    "part_filled": "部分成交",
    "partially_filled": "部分成交",
    "filled": "全部成交",
    "all_filled": "全部成交",
    "cancelled": "已撤",
    "canceled": "已撤",
    "rejected": "废单",
    "invalid": "废单",
    "failed": "失败",
    "error": "失败",
    "unknown": "待同步",
    "待提交": "待提交",
    "已提交": "已提交",
    "已报": "已报",
    "已成": "全部成交",
    "部成": "部分成交",
    "部分成交": "部分成交",
    "全部成交": "全部成交",
    "已撤": "已撤",
    "废单": "废单",
    "失败": "失败",
    "未知": "待同步",
    "待同步": "待同步",
}


def map_order_status(qmt_status: str | None) -> str:
    if not qmt_status:
        return "待同步"
    normalized = str(qmt_status).strip()
    return STATUS_MAP.get(normalized, STATUS_MAP.get(normalized.lower(), "待同步"))
