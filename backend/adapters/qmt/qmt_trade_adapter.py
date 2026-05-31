from uuid import uuid4

from backend.adapters.qmt.order_status_mapper import map_order_status
from backend.repositories.system.system_repository import now_text


class TestIsolationTradeAdapter:
    """Test-only trading adapter. It never connects to real QMT."""

    def place_order(self, order: dict[str, object]) -> dict[str, object]:
        qmt_status = "accepted"
        return {
            "qmt_order_id": f"qmt_test_{uuid4().hex[:10]}",
            "qmt_status": qmt_status,
            "status": map_order_status(qmt_status),
            "submitted_at": now_text(),
            "test_isolation": True,
        }

    def cancel_order(self, qmt_order_id: str | None) -> dict[str, object]:
        del qmt_order_id
        qmt_status = "cancelled"
        return {
            "qmt_status": qmt_status,
            "status": map_order_status(qmt_status),
            "cancelled_at": now_text(),
            "test_isolation": True,
        }

    def sync_order_status(self, order: dict[str, object]) -> dict[str, object]:
        status = str(order.get("status") or "待同步")
        if status in {"已提交", "已报", "待提交"}:
            qmt_status = "filled"
            return {"qmt_status": qmt_status, "status": map_order_status(qmt_status), "test_isolation": True}
        qmt_status = str(order.get("qmt_status") or status or "待同步")
        return {"qmt_status": qmt_status, "status": map_order_status(qmt_status), "test_isolation": True}

    def build_test_isolation_trade(self, order: dict[str, object]) -> dict[str, object] | None:
        if order.get("status") != "全部成交":
            return None
        price = float(order["price"])
        quantity = int(order["quantity"])
        local_order_id = str(order["local_order_id"])
        return {
            "trade_id": f"trade_test_{local_order_id}",
            "local_order_id": local_order_id,
            "qmt_order_id": order.get("qmt_order_id"),
            "account_id": order["account_id"],
            "symbol": order["symbol"],
            "name": order["name"],
            "side": order["side"],
            "price": price,
            "quantity": quantity,
            "amount": round(price * quantity, 2),
            "fee": round(price * quantity * 0.0003, 2),
            "source": order["source"],
            "trade_time": now_text(),
        }


class DisabledRealTradingAdapter:
    """Real QMT trading is deliberately disabled until a separate small-order acceptance phase."""

    def _blocked(self) -> None:
        raise RuntimeError("真实 QMT 下单适配器未启用；当前只允许真实 QMT 只读数据同步。")

    def place_order(self, order: dict[str, object]) -> dict[str, object]:
        del order
        self._blocked()

    def cancel_order(self, qmt_order_id: str | None) -> dict[str, object]:
        del qmt_order_id
        self._blocked()

    def sync_order_status(self, order: dict[str, object]) -> dict[str, object]:
        del order
        self._blocked()

    def build_test_isolation_trade(self, order: dict[str, object]) -> dict[str, object] | None:
        del order
        self._blocked()
