from backend.repositories.dashboard_repository import DashboardRepository
from backend.repositories.system.system_repository import now_text
from backend.schemas.dashboard import DashboardBundle, DashboardSummary, TodayTradeSummary
from backend.schemas.system import RuntimeTaskRecord
from backend.schemas.trading import TradingSignalRecord


class DashboardService:
    def __init__(self) -> None:
        self.repository = DashboardRepository()

    def _trading_mode_label(self, qmt_mode: str | None) -> str:
        normalized = str(qmt_mode or "").strip().lower()
        if normalized == "test_isolation":
            return "测试隔离"
        if normalized == "real":
            return "真实只读"
        return "未检测"

    def summary(self) -> DashboardSummary:
        asset = self.repository.asset_overview()
        today = now_text()[:10]
        tasks = self.repository.tasks(limit=1000)
        signal_count = self.repository.today_signal_count()
        trades = self.repository.today_trade_summary()
        qmt_mode, qmt_connected = self.repository.qmt_source()
        failed_today = sum(1 for task in tasks if task.status == "failed" and task.created_at.startswith(today))
        failed_history = sum(1 for task in tasks if task.status == "failed" and not task.created_at.startswith(today))
        return DashboardSummary(
            asset=asset,
            running_task_count=sum(1 for task in tasks if task.status in {"running", "pending"}),
            failed_task_count=failed_today,
            historical_failed_task_count=failed_history,
            today_signal_count=signal_count,
            today_order_count=trades.order_count,
            today_trade_amount=trades.trade_amount,
            qmt_mode=qmt_mode,
            qmt_connected=qmt_connected,
            trading_mode=self._trading_mode_label(qmt_mode),
        )

    def tasks(self) -> list[RuntimeTaskRecord]:
        return self.repository.tasks(limit=20)

    def today_signals(self) -> list[TradingSignalRecord]:
        return self.repository.today_signals(limit=10)

    def today_trades(self) -> TodayTradeSummary:
        return self.repository.today_trade_summary()

    def bundle(self) -> DashboardBundle:
        return DashboardBundle(
            summary=self.summary(),
            tasks=self.tasks(),
            today_signals=self.today_signals(),
            today_trades=self.today_trades(),
            latest_orders=self.repository.latest_orders(limit=10),
            latest_trades=self.repository.latest_trades(limit=10),
        )
