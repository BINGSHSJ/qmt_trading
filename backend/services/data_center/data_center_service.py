import csv
import json
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Callable

from backend.adapters.mock_qmt_adapter import TestIsolationQmtDataAdapter
from backend.adapters.qmt.data_standardizer import (
    normalize_symbol,
    standardize_instrument_details,
    standardize_account,
    standardize_daily_kline,
    standardize_minute_kline,
    standardize_orders,
    standardize_positions,
    standardize_stock_basic,
    standardize_trading_calendar,
    standardize_trades,
)
from backend.adapters.qmt.qmt_import_path import candidate_site_packages, find_xtquant_spec
from backend.adapters.qmt.real_qmt_data_adapter import RealQmtReadOnlyDataAdapter
from backend.core.config import settings
from backend.core.exceptions import AppError, DataSyncError, QmtConnectionError, TaskCancelledError
from backend.repositories.data_center.data_center_repository import DataCenterRepository
from backend.repositories.system.system_repository import SystemRepository, now_text
from backend.schemas.common import PageQuery, PageResult
from backend.schemas.data_center import (
    AccountSnapshot,
    AccountSnapshotDuplicateRecord,
    DailyKline,
    DataCoverageRecord,
    DataDictionaryRecord,
    DataFreshnessItem,
    DataFreshnessSummary,
    OfficialDataCatalog,
    OfficialDataCatalogItem,
    Prepare2026Plan,
    Prepare2026Request,
    DataQualityRecord,
    DataQualitySummary,
    DataSourceRecord,
    InstrumentDetail,
    LatestQuote,
    LatestDataSyncRequest,
    LegacyCursorCleanupResult,
    MinuteKline,
    OrderRecord,
    PositionSnapshot,
    QmtStatus,
    StockBasic,
    SyncLogRecord,
    SyncRequest,
    SyncTaskSummary,
    TradingCalendarRecord,
    TradeRecord,
)
from backend.schemas.system import TaskCreated
from backend.services.data_center.data_center_catalog import (
    DICTIONARY_RECORDS,
    OFFICIAL_CATALOG_ITEMS,
    OFFICIAL_UNSUPPORTED_ITEMS,
    QUALITY_EXPECTED_MIN_CHECKS,
    TEST_ISOLATION_DATA_ACCOUNT_ID,
)
from backend.services.data_center.data_center_coverage import (
    build_coverage_row,
    expected_trading_days_by_symbol,
    has_symbol_day_coverage,
    merge_minute_rows_into_coverage,
)
from backend.services.data_center.data_center_freshness import (
    build_freshness_item,
    build_freshness_next_actions,
    coverage_unit,
    coverage_unit_note,
    freshness_status_counts,
)
from backend.services.data_center.data_center_quality import (
    QUALITY_DUPLICATE_CHECKS,
    QUALITY_TABLES,
    QUALITY_TIME_CHECKS,
    build_duplicate_result,
    build_table_count_result,
    build_time_result,
)
from backend.services.data_center.data_center_requests import (
    normalize_latest_data_sync_request,
    normalize_prepare_2026_request,
    normalize_sync_request,
    validate_latest_data_sync_request,
)
from backend.services.data_center.data_center_sync_plan import MinutePlanStats, build_prepare_2026_plan
from backend.services.system.system_service import SystemService


class DataCenterService:
    def __init__(self) -> None:
        self.repository = DataCenterRepository()
        self.system_repository = SystemRepository()
        self.system_service = SystemService()

    def _adapter(self):
        config = self.system_service.get_config()
        if config.simulation_mode:
            return TestIsolationQmtDataAdapter(), "test_isolation=true; real_qmt_readonly=false"
        return RealQmtReadOnlyDataAdapter(config.qmt_path, config.account_id), "real_qmt_readonly=true; real_order_submitted=false"

    def list_sources(self) -> list[DataSourceRecord]:
        self.repository.ensure_qmt_source()
        return self.repository.list_sources()

    def official_catalog(self) -> OfficialDataCatalog:
        return OfficialDataCatalog(
            limitation_note="当前按 QMT / MiniQMT 普通股票账户设计：无 Level2、非信用账户、不接外部数据源。",
            items=[OfficialDataCatalogItem(**item) for item in OFFICIAL_CATALOG_ITEMS],
            unsupported_items=OFFICIAL_UNSUPPORTED_ITEMS,
        )

    def prepare_2026_sync(self, request: Prepare2026Request | None = None) -> Prepare2026Plan:
        request = self._normalize_2026_request(request or Prepare2026Request())
        minute_stats: MinutePlanStats | None = None
        if request.include_minute_kline:
            scope_text = "全市场" if request.include_full_market_minute else "指定股票池"
            symbol_count = len(self._resolve_2026_symbols(request)) if request.include_full_market_minute else len(self._resolve_2026_minute_symbols(request))
            trading_days = self.repository.trading_days_between(request.start_date, request.end_date or self._recent_completed_trading_day()) or self._business_days(request.start_date, request.end_date)
            windows = self._minute_date_windows(request.start_date, request.end_date or self._recent_completed_trading_day(), request.minute_window_days)
            total_batches = max(len(windows) * max((symbol_count + request.minute_batch_size - 1) // request.minute_batch_size, 1), 1)
            minute_stats = MinutePlanStats(scope_text, symbol_count, len(trading_days), len(windows), total_batches)
        test_isolation = self.system_service.get_config().simulation_mode
        return build_prepare_2026_plan(
            request=request,
            scope_label=self._scope_label(request),
            test_isolation=test_isolation,
            minute_stats=minute_stats,
        )

    def create_2026_sync_task(self, request: Prepare2026Request | None = None) -> TaskCreated:
        request = self._normalize_2026_request(request or Prepare2026Request())
        self._ensure_no_active_sync_task("sync_2026", "2026 数据补齐")
        task = self.system_repository.create_task("sync_2026", "正在补齐 2026 数据。")
        self.repository.create_sync_task(task.task_id, "sync_2026")
        self.repository.add_sync_log(
            task.task_id,
            "sync_2026",
            "info",
            "2026 数据补齐任务已创建。",
            json.dumps(self.prepare_2026_sync(request).model_dump(), ensure_ascii=False),
        )
        self.system_repository.add_operation_log("数据中心", "创建2026补齐", "runtime_task", task.task_id, "成功", "已创建 2026 数据补齐任务。")
        return TaskCreated(task_id=task.task_id, task_type=task.task_type, status=task.status, progress=task.progress, message=task.message)

    def create_latest_data_sync_task(self, request: LatestDataSyncRequest | None = None) -> TaskCreated:
        request = self._normalize_latest_data_sync_request(request or LatestDataSyncRequest())
        self._validate_latest_data_sync_request(request)
        self._ensure_no_active_sync_task("sync_latest_data", "同步到最新完成交易日")
        task = self.system_repository.create_task("sync_latest_data", "正在同步到最新完成交易日。")
        self.repository.create_sync_task(task.task_id, "sync_latest_data")
        self.repository.add_sync_log(
            task.task_id,
            "sync_latest_data",
            "info",
            "同步到最新完成交易日任务已创建。",
            json.dumps(request.model_dump(), ensure_ascii=False),
        )
        self.system_repository.add_operation_log(
            "数据中心",
            "创建最新同步",
            "runtime_task",
            task.task_id,
            "成功",
            "已创建同步到最新完成交易日任务。",
            json.dumps(request.model_dump(), ensure_ascii=False),
        )
        return TaskCreated(task_id=task.task_id, task_type=task.task_type, status=task.status, progress=task.progress, message=task.message)

    def run_latest_data_sync_task(self, task_id: str, request: LatestDataSyncRequest | None = None) -> None:
        request = self._normalize_latest_data_sync_request(request or LatestDataSyncRequest())
        self._validate_latest_data_sync_request(request)
        total = 0
        failed = 0
        market_sync_requested = request.include_daily_kline or request.include_minute_kline
        try:
            self.system_service.ensure_not_cancelled(task_id)
            self.repository.add_sync_log(
                task_id,
                "sync_latest_data",
                "info",
                "开始同步到最新完成交易日。",
                json.dumps(request.model_dump(), ensure_ascii=False),
            )
            if market_sync_requested:
                self.system_service.finish_task_if_active(task_id, "running", 5, "正在同步股票基础和交易日历。", None, finished=False)
                total += self._run_sync(task_id, "stock_basic", SyncRequest())
                total += self._run_sync(task_id, "trading_calendar", SyncRequest(start_date=request.start_date, end_date=request.end_date))

            self.system_service.ensure_not_cancelled(task_id)
            self.system_service.finish_task_if_active(task_id, "running", 15, "正在同步账户、持仓、委托和成交。", None, finished=False)
            if request.include_account:
                total += self._run_sync(task_id, "account", SyncRequest())
            if request.include_positions:
                total += self._run_sync(task_id, "positions", SyncRequest())
            if request.include_orders:
                total += self._run_sync(task_id, "orders", SyncRequest())
            if request.include_trades:
                total += self._run_sync(task_id, "trades", SyncRequest())

            symbols: list[str] = []
            if market_sync_requested:
                symbols = self._resolve_2026_symbols(
                    Prepare2026Request(start_date=request.start_date, end_date=request.end_date, symbols=request.symbols)
                )
            if market_sync_requested and symbols:
                self.system_service.ensure_not_cancelled(task_id)
                self.system_service.finish_task_if_active(task_id, "running", 25, "正在同步合约基础。", None, finished=False)
                total += self._run_sync(task_id, "instrument_detail", SyncRequest(symbols=symbols))

            prepare_request = Prepare2026Request(
                start_date=request.start_date,
                end_date=request.end_date,
                symbols=request.symbols,
                include_daily_kline=request.include_daily_kline,
                daily_batch_size=request.daily_batch_size,
                include_minute_kline=request.include_minute_kline,
                minute_batch_size=request.minute_batch_size,
                minute_window_days=request.minute_window_days,
                include_full_market_minute=request.include_full_market_minute,
                period=request.period,
                overwrite_existing=request.overwrite_existing,
            )
            if request.include_daily_kline and symbols:
                self.system_service.ensure_not_cancelled(task_id)
                daily_result = self._run_2026_daily_batches(task_id, symbols, prepare_request)
                total += daily_result["rows"]
                failed += daily_result["failed_symbols"]
            if request.include_minute_kline:
                self.system_service.ensure_not_cancelled(task_id)
                minute_symbols = self._resolve_2026_minute_symbols(prepare_request)
                minute_result = self._run_2026_minute_batches(task_id, minute_symbols, prepare_request)
                total += minute_result["rows"]
                failed += minute_result["failed_symbols"]

            self.system_service.ensure_not_cancelled(task_id)
            if market_sync_requested:
                self.refresh_2026_coverage(prepare_request)
                daily_coverage = self.repository.get_coverage_record("daily_kline", "ALL", "1d", request.start_date, request.end_date)
                minute_coverage = self.repository.get_coverage_record("minute_kline", "ALL", request.period, request.start_date, request.end_date)
            else:
                daily_coverage = None
                minute_coverage = None
            freshness = self.data_freshness_summary()
            required_keys: set[str] = set()
            if request.include_account:
                required_keys.add("account_snapshot")
            if request.include_positions:
                required_keys.add("position_snapshot")
            if market_sync_requested:
                required_keys.add("trading_calendar")
                if request.include_daily_kline:
                    required_keys.add("daily_kline")
                if request.include_minute_kline:
                    required_keys.add("minute_kline")
            required_stale_items = [
                item
                for item in freshness.items
                if item.key in required_keys
                and item.status in {"missing", "stale", "partial"}
            ]
            required_stale = [item.key for item in required_stale_items]
            status = "success" if failed == 0 and not required_stale else "failed"
            if status == "success" and request.include_minute_kline:
                message = "最新数据同步完成，分钟K已按本次请求执行，请继续查看新鲜度摘要和覆盖率检查。"
            elif status == "success":
                minute_item = next((item for item in freshness.items if item.key == "minute_kline"), None)
                if minute_item and minute_item.status == "fresh" and minute_item.coverage_status == "complete":
                    message = "最新数据同步完成；1 分钟 K 当前已到目标交易日且覆盖率 complete，本任务未重复启动全市场分钟K。"
                else:
                    message = "最新数据同步完成；本任务未默认启动全市场分钟K，分钟K请使用显式长任务并以覆盖率检查为准。"
            else:
                target_text = freshness.target_trade_date or request.end_date
                if required_stale_items:
                    stale_names = "、".join(item.name for item in required_stale_items[:4])
                    more_text = f" 等 {len(required_stale_items)} 项" if len(required_stale_items) > 4 else ""
                    message = f"最新数据同步已结束，但 {stale_names}{more_text} 仍未达到目标交易日 {target_text}，请查看新鲜度摘要。"
                else:
                    message = f"最新数据同步已结束，但本次存在 {failed} 个失败标的，请查看同步日志和技术详情。"
            detail = json.dumps(
                {
                    "rows": total,
                    "failed_symbols": failed,
                    "target_trade_date": freshness.target_trade_date or request.end_date,
                    "freshness_overall_status": freshness.overall_status,
                    "freshness_stale_count": freshness.stale_count,
                    "freshness_warning_count": freshness.warning_count,
                    "required_stale": required_stale,
                    "required_stale_items": [
                        {
                            "key": item.key,
                            "name": item.name,
                            "status": item.status,
                            "latest_date": item.latest_date,
                            "target_date": item.target_date,
                            "message": item.message,
                            "suggestion": item.suggestion,
                            "coverage_status": item.coverage_status,
                            "coverage_rate": item.coverage_rate,
                            "coverage_unit": item.coverage_unit,
                            "coverage_unit_note": item.coverage_unit_note,
                        }
                        for item in required_stale_items
                    ],
                    "next_actions": freshness.next_actions,
                    "daily_coverage_rate": daily_coverage.coverage_rate if daily_coverage else None,
                    "daily_coverage_status": daily_coverage.status if daily_coverage else None,
                    "minute_coverage_rate": minute_coverage.coverage_rate if minute_coverage else None,
                    "minute_coverage_status": minute_coverage.status if minute_coverage else None,
                    "minute_freshness_status": next((item.status for item in freshness.items if item.key == "minute_kline"), None),
                    "minute_freshness_message": next((item.message for item in freshness.items if item.key == "minute_kline"), None),
                    "minute_sync_enabled": request.include_minute_kline,
                    "real_order_submitted": False,
                },
                ensure_ascii=False,
            )
            failed_count = failed + len(required_stale)
            self.repository.finish_sync_task(task_id, status, total, total, failed_count)
            self.repository.add_sync_log(task_id, "sync_latest_data", "info" if status == "success" else "error", message, detail)
            self.system_service.finish_task_if_active(task_id, status, 100, message, detail, finished=True)
            self.system_repository.add_operation_log(
                "数据中心",
                "最新同步完成" if status == "success" else "最新同步需复查",
                "runtime_task",
                task_id,
                "成功" if status == "success" else "失败",
                message,
                detail,
            )
        except TaskCancelledError:
            self.repository.finish_sync_task(task_id, "cancelled", total, total, 0)
            self.repository.add_sync_log(task_id, "sync_latest_data", "warning", "同步到最新完成交易日任务已取消。", "task_cancelled=true")
        except Exception as exc:
            if not self.system_repository.is_task_cancelled(task_id):
                detail = self._format_sync_exception(exc)
                self.repository.finish_sync_task(task_id, "failed", total, total, 1)
                self.repository.add_sync_log(task_id, "sync_latest_data", "error", "同步到最新完成交易日任务失败。", detail)
                self.system_service.finish_task_if_active(task_id, "failed", 100, "同步到最新完成交易日任务失败。", detail, finished=True)
                self.system_repository.add_operation_log("数据中心", "最新同步失败", "runtime_task", task_id, "失败", "同步到最新完成交易日任务失败。", detail)

    @staticmethod
    def _format_sync_exception(exc: Exception) -> str:
        if isinstance(exc, AppError):
            return json.dumps(
                {
                    "message": exc.message,
                    "code": exc.code,
                    "detail": exc.detail,
                    "suggestion": exc.suggestion,
                },
                ensure_ascii=False,
            )
        return json.dumps(
            {
                "message": "同步任务执行异常。",
                "code": "DATA_SYNC_TASK_ERROR",
                "detail": repr(exc),
                "suggestion": "请查看同步日志、QMT 连接状态和本地数据库状态；如果重复出现，请保留 task_id 和技术详情继续排查。",
            },
            ensure_ascii=False,
        )

    def run_2026_sync_task(self, task_id: str, request: Prepare2026Request | None = None) -> None:
        request = self._normalize_2026_request(request or Prepare2026Request())
        total = 0
        failed = 0
        try:
            self.system_service.ensure_not_cancelled(task_id)
            self.repository.add_sync_log(task_id, "sync_2026", "info", "开始 2026 数据补齐。", f"request={request.model_dump()}")
            total += self._run_sync(task_id, "stock_basic", SyncRequest())
            total += self._run_sync(task_id, "trading_calendar", SyncRequest(start_date=request.start_date, end_date=request.end_date))
            total += self._run_sync(task_id, "instrument_detail", SyncRequest(symbols=self._resolve_2026_symbols(request)))
            if request.include_daily_kline:
                symbols = self._resolve_2026_symbols(request)
                daily_result = self._run_2026_daily_batches(task_id, symbols, request)
                total += daily_result["rows"]
                failed += daily_result["failed_symbols"]
            self.system_service.ensure_not_cancelled(task_id)
            if request.include_minute_kline:
                minute_symbols = self._resolve_2026_minute_symbols(request)
                minute_result = self._run_2026_minute_batches(task_id, minute_symbols, request)
                total += minute_result["rows"]
                failed += minute_result["failed_symbols"]
            self.refresh_2026_coverage(request)
            daily_coverage = self.repository.get_coverage_record("daily_kline", "ALL", "1d", request.start_date, request.end_date)
            minute_coverage = self.repository.get_coverage_record("minute_kline", "ALL", request.period, request.start_date, request.end_date)
            incomplete_daily_rows = self.repository.list_incomplete_coverage_rows(request.start_date, request.end_date, "daily_kline", "1d")
            incomplete_minute_rows = self.repository.list_incomplete_coverage_rows(request.start_date, request.end_date, "minute_kline", request.period)
            incomplete_daily_symbols = [row for row in incomplete_daily_rows if row.get("symbol") != "ALL"]
            incomplete_minute_symbols = [row for row in incomplete_minute_rows if row.get("symbol") != "ALL"]
            enforce_full_market_daily = request.include_daily_kline and request.stock_scope == "all_a_share" and not request.symbols
            enforce_full_market_minute = request.include_minute_kline and request.include_full_market_minute and request.stock_scope == "all_a_share" and not request.symbols
            daily_complete = (not enforce_full_market_daily) or (daily_coverage is not None and daily_coverage.status == "complete")
            minute_complete = (not enforce_full_market_minute) or (minute_coverage is not None and minute_coverage.status == "complete")
            status = "success" if failed == 0 and daily_complete and minute_complete else "failed"
            message = (
                "2026 数据补齐任务完成。"
                if status == "success"
                else "2026 数据补齐已自动跑完指定范围，但覆盖率仍不完整，请查看缺失清单。"
            )
            detail = json.dumps(
                {
                    "rows": total,
                    "failed_symbols": failed,
                    "daily_batch_size": request.daily_batch_size,
                    "minute_batch_size": request.minute_batch_size,
                    "no_manual_batch_clicks": True,
                    "daily_coverage_rate": daily_coverage.coverage_rate if daily_coverage else None,
                    "daily_coverage_status": daily_coverage.status if daily_coverage else None,
                    "incomplete_daily_symbols": len(incomplete_daily_symbols),
                    "minute_coverage_rate": minute_coverage.coverage_rate if minute_coverage else None,
                    "minute_coverage_status": minute_coverage.status if minute_coverage else None,
                    "incomplete_minute_symbols": len(incomplete_minute_symbols),
                },
                ensure_ascii=False,
            )
            summary_failed = failed
            if summary_failed == 0:
                if enforce_full_market_daily:
                    summary_failed += len(incomplete_daily_symbols)
                if enforce_full_market_minute:
                    summary_failed += len(incomplete_minute_symbols)
            self.repository.finish_sync_task(task_id, status, total, total, summary_failed)
            self.repository.add_sync_log(task_id, "sync_2026", "info" if status == "success" else "error", message, detail)
            self.system_service.finish_task_if_active(task_id, status, 100, message, detail, finished=True)
            self.system_repository.add_operation_log(
                "数据中心",
                "2026补齐完成" if status == "success" else "2026补齐部分失败",
                "runtime_task",
                task_id,
                "成功" if status == "success" else "失败",
                message,
                detail,
            )
        except TaskCancelledError:
            self.repository.finish_sync_task(task_id, "cancelled", total, total, 0)
            self.repository.add_sync_log(task_id, "sync_2026", "warning", "2026 数据补齐任务已取消。", "task_cancelled=true")
        except Exception as exc:
            if not self.system_repository.is_task_cancelled(task_id):
                self.repository.finish_sync_task(task_id, "failed", total, total, 1)
                self.repository.add_sync_log(task_id, "sync_2026", "error", "2026 数据补齐任务失败。", repr(exc))
                self.system_service.finish_task_if_active(task_id, "failed", 100, "2026 数据补齐任务失败。", repr(exc), finished=True)
                self.system_repository.add_operation_log("数据中心", "2026补齐失败", "runtime_task", task_id, "失败", "2026 数据补齐任务失败。", repr(exc))

    def refresh_2026_coverage(self, request: Prepare2026Request | None = None) -> PageResult[DataCoverageRecord]:
        request = self._normalize_2026_request(request or Prepare2026Request())
        fallback_business_days = self._business_days(request.start_date, request.end_date)
        trading_days = self.repository.trading_days_between(request.start_date, request.end_date) or fallback_business_days
        expected_days = len(trading_days)
        stats = self.repository.coverage_source_stats(request.start_date, request.end_date, request.period)
        coverage_symbols = self.repository.list_all_stock_symbols()
        symbol_open_dates = self.repository.instrument_open_dates(coverage_symbols)
        daily_expected_days_by_symbol = expected_trading_days_by_symbol(coverage_symbols, trading_days, symbol_open_dates)
        daily_expected_rows = sum(len(days) for days in daily_expected_days_by_symbol.values()) if coverage_symbols else max(stats["stock_count"], 1) * expected_days
        checked_at = now_text()
        rows = [
            build_coverage_row("stock_basic", "ALL", "", request.start_date, request.end_date, 0, 1 if stats["stock_count"] else 0, None, stats["stock_count"], [], 0, checked_at),
            build_coverage_row(
                "trading_calendar",
                "ALL",
                "",
                request.start_date,
                request.end_date,
                expected_days,
                stats["calendar_trading_days"],
                expected_days,
                stats["calendar_rows"],
                [day for day in trading_days if day not in stats["calendar_days"]][:20],
                self.repository.duplicate_group_count("trading_calendar", ["market", "trade_date"]),
                checked_at,
            ),
            build_coverage_row(
                "instrument_detail",
                "ALL",
                "",
                request.start_date,
                request.end_date,
                0,
                1 if stats["instrument_count"] else 0,
                max(stats["stock_count"], 1),
                stats["instrument_count"],
                [],
                self.repository.duplicate_group_count("instrument_detail", ["symbol"]),
                checked_at,
            ),
            build_coverage_row(
                "daily_kline",
                "ALL",
                "1d",
                request.start_date,
                request.end_date,
                expected_days,
                stats["daily_trading_days"],
                daily_expected_rows,
                stats["daily_rows"],
                [day for day in trading_days if day not in stats["daily_days"]][:20],
                self.repository.duplicate_group_count("daily_kline", ["symbol", "trade_date"]),
                checked_at,
            ),
            build_coverage_row(
                "minute_kline",
                "ALL",
                request.period,
                request.start_date,
                request.end_date,
                expected_days,
                stats["minute_trading_days"],
                None,
                stats["minute_rows"],
                [day for day in trading_days if day not in stats["minute_days"]][:20],
                self.repository.duplicate_group_count("minute_kline", ["symbol", "period", "datetime"]),
                checked_at,
            ),
        ]
        if coverage_symbols:
            daily_by_symbol = self.repository.daily_symbol_coverage_stats(request.start_date, request.end_date, coverage_symbols)
            minute_by_symbol = self.repository.minute_symbol_coverage_stats(request.start_date, request.end_date, request.period, coverage_symbols)
            minute_expected_days_by_symbol = self._expected_minute_days_by_symbol(
                request.start_date,
                request.end_date,
                coverage_symbols,
                daily_expected_days_by_symbol,
            )
            minute_expected_units = sum(len(days) for days in minute_expected_days_by_symbol.values())
            minute_actual_units = sum(
                len(set(minute_by_symbol.get(symbol, {"days": set()})["days"]) & set(minute_expected_days_by_symbol.get(symbol, [])))
                for symbol in coverage_symbols
            )
            minute_missing_days = sorted({
                day
                for symbol in coverage_symbols
                for day in minute_expected_days_by_symbol.get(symbol, [])
                if day not in minute_by_symbol.get(symbol, {"days": set()})["days"]
            })[:20]
            rows[4] = build_coverage_row(
                "minute_kline",
                "ALL",
                request.period,
                request.start_date,
                request.end_date,
                expected_days,
                stats["minute_trading_days"],
                minute_expected_units,
                minute_actual_units,
                minute_missing_days,
                self.repository.duplicate_group_count("minute_kline", ["symbol", "period", "datetime"]),
                checked_at,
            )
            for symbol in coverage_symbols:
                symbol_stats = daily_by_symbol.get(symbol, {"rows": 0, "days": set()})
                symbol_days = symbol_stats["days"]
                expected_symbol_days = daily_expected_days_by_symbol.get(symbol, trading_days)
                rows.append(
                    build_coverage_row(
                        "daily_kline",
                        symbol,
                        "1d",
                        request.start_date,
                        request.end_date,
                        len(expected_symbol_days),
                        len(symbol_days),
                        len(expected_symbol_days),
                        int(symbol_stats["rows"]),
                        [day for day in expected_symbol_days if day not in symbol_days][:20],
                        0,
                        checked_at,
                    )
                )
                minute_stats = minute_by_symbol.get(symbol, {"rows": 0, "days": set()})
                minute_days = minute_stats["days"]
                expected_symbol_minute_days = minute_expected_days_by_symbol.get(symbol, daily_expected_days_by_symbol.get(symbol, trading_days))
                covered_minute_days = set(minute_days) & set(expected_symbol_minute_days)
                rows.append(
                    build_coverage_row(
                        "minute_kline",
                        symbol,
                        request.period,
                        request.start_date,
                        request.end_date,
                        len(expected_symbol_minute_days),
                        len(covered_minute_days),
                        len(expected_symbol_minute_days),
                        len(covered_minute_days),
                        [day for day in expected_symbol_minute_days if day not in minute_days][:20],
                        0,
                        checked_at,
                    )
                )
        self.repository.upsert_coverage(rows)
        return self.repository.list_coverage(PageQuery(page=1, page_size=50, sort_field="data_type", sort_order="asc"), request.start_date, request.end_date)

    def list_2026_coverage(self, query: PageQuery | None = None) -> PageResult[DataCoverageRecord]:
        default_request = self._normalize_2026_request(Prepare2026Request())
        return self.repository.list_coverage(query or PageQuery(page_size=50, sort_field="data_type", sort_order="asc"), default_request.start_date, default_request.end_date)

    def data_freshness_summary(self) -> DataFreshnessSummary:
        target_date = self._recent_completed_trading_day()
        account_id = self._current_account_id()
        latest_times = self.repository.latest_data_times(account_id)
        daily_coverage = self.repository.get_coverage_record_covering("daily_kline", "ALL", "1d", "2026-01-01", target_date)
        if daily_coverage is None:
            # 兼容早期覆盖率记录空周期；新同步统一写 1d。
            daily_coverage = self.repository.get_coverage_record_covering("daily_kline", "ALL", "", "2026-01-01", target_date)
        if daily_coverage is None:
            daily_coverage = self.repository.get_coverage_record("daily_kline", "ALL", "1d", target_date, target_date)
        minute_coverage = self.repository.get_coverage_record_covering("minute_kline", "ALL", "1m", "2026-01-01", target_date)
        if minute_coverage is None:
            minute_coverage = self.repository.get_coverage_record("minute_kline", "ALL", "1m", target_date, target_date)

        items = [
            build_freshness_item(
                key="trading_calendar",
                name="交易日历",
                table_name="trading_calendar",
                latest_time=latest_times.get("trading_calendar"),
                suggestion="请先同步交易日历；它会影响默认同步截止日和回测交易日判断。",
                target_date=target_date,
                account_id=account_id,
                fresh_suggestion="交易日历已到目标交易日；后续同步和回测会按当前交易日历判断。",
            ),
            build_freshness_item(
                key="daily_kline",
                name="日 K",
                table_name="daily_kline",
                latest_time=latest_times.get("daily_kline"),
                suggestion="请执行 2026 全市场日 K 补齐，并在完成后复查覆盖率。",
                target_date=target_date,
                account_id=account_id,
                coverage=daily_coverage,
                fresh_suggestion="日 K 已到目标交易日；正式回测前请继续查看覆盖率和数据质量。",
            ),
            build_freshness_item(
                key="minute_kline",
                name="1 分钟 K",
                table_name="minute_kline",
                latest_time=latest_times.get("minute_kline"),
                suggestion="分钟策略正式回测前，请执行全市场分钟 K 缺失续跑，并确认覆盖率 complete。",
                target_date=target_date,
                account_id=account_id,
                coverage=minute_coverage,
                fresh_suggestion="1 分钟 K 已到目标交易日且覆盖率 complete；正式分钟回测前请保留覆盖率检查和逐笔信号核对。",
            ),
            build_freshness_item(
                key="account_snapshot",
                name="账户资金快照",
                table_name="account_snapshot",
                latest_time=latest_times.get("account_snapshot"),
                suggestion="请同步账户资金；真实 QMT 已连接不代表账户快照已更新。",
                target_date=target_date,
                account_id=account_id,
                fresh_suggestion="账户资金快照已更新；交易前仍需在交易执行中心复核可用资金。",
            ),
            build_freshness_item(
                key="position_snapshot",
                name="持仓快照",
                table_name="position_snapshot",
                latest_time=latest_times.get("position_snapshot"),
                suggestion="请同步持仓；交易执行前必须确认本地持仓不是旧快照。",
                target_date=target_date,
                account_id=account_id,
                fresh_suggestion="持仓快照已更新；交易前仍需复核可用持仓和委托占用。",
            ),
            build_freshness_item(
                key="order_record",
                name="委托记录",
                table_name="order_record",
                latest_time=latest_times.get("order_record"),
                suggestion="如真实账户今天有委托，请同步委托；无委托时可忽略。",
                target_date=target_date,
                account_id=account_id,
                required=False,
            ),
            build_freshness_item(
                key="trade_record",
                name="成交记录",
                table_name="trade_record",
                latest_time=latest_times.get("trade_record"),
                suggestion="如真实账户今天有成交，请同步成交；无成交时可忽略。",
                target_date=target_date,
                account_id=account_id,
                required=False,
            ),
        ]
        next_actions = build_freshness_next_actions(items)
        stale_count, warning_count, overall_status = freshness_status_counts(items)
        return DataFreshnessSummary(
            target_trade_date=target_date,
            generated_at=now_text(),
            overall_status=overall_status,
            stale_count=stale_count,
            warning_count=warning_count,
            items=items,
            next_actions=next_actions,
        )

    def get_coverage_record(self, data_type: str, symbol: str, period: str, start_date: str, end_date: str) -> DataCoverageRecord | None:
        request = Prepare2026Request(
            start_date=start_date,
            end_date=end_date,
            include_daily_kline=data_type == "daily_kline",
            include_minute_kline=data_type == "minute_kline",
            period=period or "1m",
        )
        normalized = self._normalize_2026_request(request)
        self.refresh_2026_coverage(normalized)
        return self.repository.get_coverage_record(data_type, symbol, period, normalized.start_date, normalized.end_date)

    def export_2026_missing_coverage(
        self,
        data_type: str | None = None,
        period: str = "1m",
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> Path:
        request_payload: dict[str, object] = {"period": period}
        if start_date:
            request_payload["start_date"] = start_date
        if end_date:
            request_payload["end_date"] = end_date
        request = self._normalize_2026_request(Prepare2026Request(**request_payload))
        rows = self.repository.list_incomplete_coverage_rows(
            request.start_date,
            request.end_date,
            data_type=data_type,
            period=period if data_type == "minute_kline" else None,
        )
        if not rows and not start_date and not end_date:
            rows = self.repository.list_latest_incomplete_coverage_rows(
                data_type=data_type,
                period=period if data_type == "minute_kline" else None,
            )
        export_dir = settings.backups_dir / "exports"
        export_dir.mkdir(parents=True, exist_ok=True)
        export_path = export_dir / f"data_coverage_missing_2026_{now_text().replace(':', '').replace(' ', '_')}.csv"
        headers = [
            ("data_type", "数据类型"),
            ("symbol", "股票代码/范围"),
            ("period", "周期"),
            ("start_date", "开始日期"),
            ("end_date", "结束日期"),
            ("status", "状态"),
            ("coverage_rate", "覆盖率(%)"),
            ("expected_trading_days", "预期交易日"),
            ("actual_trading_days", "实际交易日"),
            ("expected_rows", "预期覆盖单位"),
            ("actual_rows", "实际覆盖单位"),
            ("coverage_unit", "统计单位"),
            ("coverage_unit_note", "统计口径说明"),
            ("missing_days", "缺失日期"),
            ("duplicate_rows", "重复唯一键分组"),
            ("checked_at", "检查时间"),
        ]
        with export_path.open("w", newline="", encoding="utf-8-sig") as file:
            writer = csv.writer(file)
            writer.writerow([title for _, title in headers])
            for row in rows:
                export_row = {
                    **row,
                    "coverage_unit": coverage_unit(row.get("data_type", "")),
                    "coverage_unit_note": coverage_unit_note(row.get("data_type", "")),
                }
                writer.writerow([export_row.get(field, "") for field, _ in headers])
        self.system_repository.add_operation_log(
            "数据中心",
            "导出缺失清单",
            "export_file",
            export_path.name,
            "成功",
            f"已导出 2026 覆盖率缺失清单，共 {len(rows)} 条。",
            str(export_path),
        )
        return export_path

    def qmt_status(self) -> QmtStatus:
        config = self.system_service.get_config()
        source = self.repository.ensure_qmt_source()
        xtquant_installed = bool(candidate_site_packages(config.qmt_path))
        if not xtquant_installed and not config.qmt_path:
            xtquant_installed = find_xtquant_spec("") is not None
        connected = source.status == "enabled"
        mode = "test_isolation" if config.simulation_mode else "real"
        source_name = "测试隔离数据源" if config.simulation_mode else "真实 QMT 只读数据源"
        return QmtStatus(
            mode=mode,
            source_name=source_name,
            connected=connected,
            account_id=config.account_id or "",
            qmt_path=config.qmt_path,
            xtquant_installed=xtquant_installed,
            last_connected_at=source.last_connected_at,
            message=(
                "测试隔离数据源已启用，仅用于自动化测试或排障，不作为业务数据。"
                if config.simulation_mode and connected
                else "真实 QMT 前置检测已启用；同步前请先完成只读验收。"
                if not config.simulation_mode and xtquant_installed
                else "真实 QMT 尚未通过前置检测，请先检查 QMT 路径、账户和 xtquant。"
                if not config.simulation_mode
                else "测试隔离数据源未启用；业务同步不会自动生成测试隔离数据。"
            ),
        )

    def connect_qmt(self) -> QmtStatus:
        config = self.system_service.get_config()
        source_name = "真实 QMT 只读数据源" if not config.simulation_mode else "测试隔离数据源"
        self.repository.ensure_qmt_source()
        detail = "test_isolation=true; real_readonly_probe_skipped=true"
        if not config.simulation_mode:
            detail = self._probe_real_qmt_readonly(config.qmt_path, config.account_id, action_name="连接数据")
        self.repository.set_qmt_status("enabled", now_text())
        self.system_repository.add_operation_log("数据中心", "连接数据", "data_source", "qmt", "成功", f"已连接{source_name}。", detail)
        return self.qmt_status()

    def disconnect_qmt(self) -> QmtStatus:
        config = self.system_service.get_config()
        source_name = "真实 QMT 只读数据源" if not config.simulation_mode else "测试隔离数据源"
        self.repository.ensure_qmt_source()
        self.repository.set_qmt_status("disabled")
        self.system_repository.add_operation_log("数据中心", "断开连接", "data_source", "qmt", "成功", f"已断开{source_name}。")
        return self.qmt_status()

    def test_qmt(self) -> QmtStatus:
        config = self.system_service.get_config()
        source_name = "真实 QMT 只读" if not config.simulation_mode else "测试隔离"
        detail = "test_isolation=true; real_readonly_probe_skipped=true"
        if not config.simulation_mode:
            detail = self._probe_real_qmt_readonly(config.qmt_path, config.account_id, action_name="测试连接")
        self.system_repository.add_operation_log("数据中心", "测试连接", "data_source", "qmt", "成功", f"{source_name} 连接测试完成。", detail)
        return self.qmt_status()

    def _probe_real_qmt_readonly(
        self,
        qmt_path: str,
        account_id: str,
        timeout_seconds: int = 8,
        action_name: str = "测试连接",
    ) -> str:
        adapter = RealQmtReadOnlyDataAdapter(qmt_path, account_id)
        executor = ThreadPoolExecutor(max_workers=1)
        future = executor.submit(adapter.get_account)
        try:
            account = future.result(timeout=timeout_seconds)
            return (
                "real_qmt_readonly_probe=true; real_order_submitted=false; "
                f"account_id={account.get('account_id')}; total_asset={account.get('total_asset')}; "
                f"market_value={account.get('market_value')}"
            )
        except FutureTimeoutError as exc:
            future.cancel()
            self.repository.set_qmt_status("disabled")
            self.system_repository.add_operation_log(
                "数据中心",
                action_name,
                "data_source",
                "qmt",
                "失败",
                "真实 QMT 只读资产查询超时。",
                f"timeout_seconds={timeout_seconds}; real_order_submitted=false",
            )
            raise QmtConnectionError(
                message="真实 QMT 只读资产查询超时。",
                code="REAL_QMT_READONLY_TIMEOUT",
                detail=f"timeout_seconds={timeout_seconds}; real_order_submitted=false",
                suggestion="请确认 MiniQMT 已启动并登录账户，稍后重新测试连接。",
            ) from exc
        except QmtConnectionError as exc:
            self.repository.set_qmt_status("disabled")
            self.system_repository.add_operation_log(
                "数据中心",
                action_name,
                "data_source",
                "qmt",
                "失败",
                exc.message,
                exc.detail or f"code={exc.code}; real_order_submitted=false",
            )
            raise
        except Exception as exc:
            self.repository.set_qmt_status("disabled")
            self.system_repository.add_operation_log(
                "数据中心",
                action_name,
                "data_source",
                "qmt",
                "失败",
                "真实 QMT 只读资产查询失败。",
                repr(exc),
            )
            raise QmtConnectionError(
                message="真实 QMT 只读资产查询失败。",
                code="REAL_QMT_READONLY_FAILED",
                detail=repr(exc),
                suggestion="请确认 MiniQMT 已启动、账户已登录，并检查 QMT 路径和账户 ID。",
            ) from exc
        finally:
            executor.shutdown(wait=False, cancel_futures=True)

    def _current_account_id(self) -> str | None:
        config = self.system_service.get_config()
        if config.simulation_mode:
            return TEST_ISOLATION_DATA_ACCOUNT_ID
        return config.account_id or None

    def _account_scope(self, scope: str) -> tuple[str | None, bool]:
        if scope not in {"current", "account_history", "all_history"}:
            scope = "current"
        if scope == "all_history":
            return None, False
        account_id = self._current_account_id()
        return account_id, scope == "current"

    def latest_account(self) -> AccountSnapshot | None:
        return self.repository.latest_account(self._current_account_id())

    def list_positions(self, query: PageQuery, scope: str = "current") -> PageResult[PositionSnapshot]:
        account_id, latest_only = self._account_scope(scope)
        return self.repository.list_positions(query, account_id=account_id, latest_only=latest_only)

    def list_orders(self, query: PageQuery, scope: str = "current") -> PageResult[OrderRecord]:
        account_id, _ = self._account_scope(scope)
        return self.repository.list_orders(query, account_id=account_id)

    def list_trades(self, query: PageQuery, scope: str = "current") -> PageResult[TradeRecord]:
        account_id, _ = self._account_scope(scope)
        return self.repository.list_trades(query, account_id=account_id)

    def list_stocks(self, query: PageQuery) -> PageResult[StockBasic]:
        return self.repository.list_stocks(query)

    def list_instrument_details(self, query: PageQuery) -> PageResult[InstrumentDetail]:
        return self.repository.list_instrument_details(query)

    def list_trading_calendar(self, query: PageQuery) -> PageResult[TradingCalendarRecord]:
        return self.repository.list_trading_calendar(query)

    def list_daily_kline(self, query: PageQuery, symbol: str | None = None) -> PageResult[DailyKline]:
        return self.repository.list_daily_kline(query, symbol)

    def list_minute_kline(self, query: PageQuery, symbol: str | None = None, period: str | None = None) -> PageResult[MinuteKline]:
        return self.repository.list_minute_kline(query, symbol, period)

    def latest_quotes(self, symbols: list[str] | None = None) -> list[LatestQuote]:
        return self.repository.latest_quotes(symbols)

    def _sync_instrument_details(self, adapter: object, request: SyncRequest) -> int:
        symbols = request.symbols or self._default_market_symbols(limit=200)
        rows = standardize_instrument_details(adapter.get_instrument_details(symbols))
        return self.repository.upsert_instrument_details(rows)

    def _sync_trading_calendar(self, adapter: object, request: SyncRequest) -> int:
        start_date = request.start_date or "2026-01-01"
        end_date = request.end_date or self._recent_completed_trading_day()
        rows: list[dict[str, object]] = []
        for market in ["SH", "SZ"]:
            rows.extend(adapter.get_trading_calendar(market, start_date, end_date))
        return self.repository.upsert_trading_calendar(standardize_trading_calendar(rows))

    def _run_2026_daily_batches(self, task_id: str, symbols: list[str], request: Prepare2026Request) -> dict[str, int]:
        adapter, adapter_detail = self._adapter()
        batch_size = max(1, min(request.daily_batch_size, 200))
        fallback_business_days = self._business_days(request.start_date, request.end_date)
        trading_days = self.repository.trading_days_between(request.start_date, request.end_date or self._recent_completed_trading_day()) or fallback_business_days
        open_dates = self.repository.instrument_open_dates(symbols)
        expected_days_by_symbol = expected_trading_days_by_symbol(symbols, trading_days, open_dates)
        existing_coverage = self.repository.daily_symbol_coverage_stats(request.start_date, request.end_date or self._recent_completed_trading_day(), symbols)
        rows_count = 0
        success_symbols = 0
        failed_symbols = 0
        skipped_symbols = 0
        no_data_symbols_count = 0
        coverage_retry_symbols = 0
        total_batches = max((len(symbols) + batch_size - 1) // batch_size, 1)
        self.repository.add_sync_log(
            task_id,
            "daily_kline",
            "info",
            "2026 日 K 分批补齐开始。",
            json.dumps(
                {
                    "symbols": len(symbols),
                    "batch_size": batch_size,
                    "start_date": request.start_date,
                    "end_date": request.end_date,
                    "overwrite_existing": request.overwrite_existing,
                    "resume_rule": "coverage_first",
                    "adapter": adapter_detail,
                },
                ensure_ascii=False,
            ),
        )
        for batch_index, start in enumerate(range(0, len(symbols), batch_size), start=1):
            self.system_service.ensure_not_cancelled(task_id)
            batch_symbols = symbols[start:start + batch_size]
            pending_symbols = [
                symbol for symbol in batch_symbols
                if request.overwrite_existing or not self._daily_symbol_coverage_complete(
                    symbol,
                    expected_days_by_symbol.get(symbol, []),
                    existing_coverage.get(symbol, {"rows": 0, "days": set()}),
                )
            ]
            skipped_symbols += len(batch_symbols) - len(pending_symbols)
            coverage_retry_symbols += len(pending_symbols)
            if not pending_symbols:
                self.repository.add_sync_log(
                    task_id,
                    "daily_kline",
                    "info",
                    f"第 {batch_index}/{total_batches} 批日 K 已跳过。",
                    json.dumps(
                        {
                            "symbols": batch_symbols,
                            "reason": "coverage_already_complete",
                            "resume_rule": "coverage_first",
                        },
                        ensure_ascii=False,
                    ),
                )
                continue
            try:
                rows = standardize_daily_kline(adapter.get_daily_kline(pending_symbols, request.start_date, request.end_date or self._recent_completed_trading_day()))
                written = self.repository.upsert_daily_kline(rows)
                row_symbols = self._symbols_with_rows(rows)
                no_data_symbols = sorted(set(pending_symbols) - row_symbols)
                rows_count += written
                success_symbols += len(row_symbols)
                no_data_symbols_count += len(no_data_symbols)
                for symbol in sorted(row_symbols):
                    self.repository.update_cursor("daily_kline", symbol, "", request.end_date)
                self.repository.add_sync_log(
                    task_id,
                    "daily_kline",
                    "info",
                    f"第 {batch_index}/{total_batches} 批日 K 同步完成。",
                    json.dumps({"symbols": pending_symbols, "rows": written, "returned_symbols": sorted(row_symbols)}, ensure_ascii=False),
                )
                self._log_no_data_symbols(task_id, "daily_kline", no_data_symbols, f"start_date={request.start_date}; end_date={request.end_date}")
            except Exception as batch_exc:
                self.repository.add_sync_log(
                    task_id,
                    "daily_kline",
                    "warning",
                    f"第 {batch_index}/{total_batches} 批日 K 批量同步失败，正在降级为单股票重试。",
                    repr(batch_exc),
                )
                for symbol in pending_symbols:
                    self.system_service.ensure_not_cancelled(task_id)
                    try:
                        rows = standardize_daily_kline(adapter.get_daily_kline([symbol], request.start_date, request.end_date or self._recent_completed_trading_day()))
                        written = self.repository.upsert_daily_kline(rows)
                        row_symbols = self._symbols_with_rows(rows)
                        rows_count += written
                        if symbol in row_symbols:
                            success_symbols += 1
                            self.repository.update_cursor("daily_kline", symbol, "", request.end_date)
                            self.repository.add_sync_log(task_id, "daily_kline", "info", f"{symbol} 2026 日 K 同步完成。", f"rows={written}")
                        else:
                            no_data_symbols_count += 1
                            self._log_no_data_symbols(task_id, "daily_kline", [symbol], f"start_date={request.start_date}; end_date={request.end_date}")
                    except Exception as symbol_exc:
                        failed_symbols += 1
                        self.repository.add_sync_log(
                            task_id,
                            "daily_kline",
                            "error",
                            f"{symbol} 2026 日 K 同步失败。",
                            repr(symbol_exc),
                        )
            progress = min(95, 30 + int(55 * batch_index / total_batches))
            detail = {
                "batch": batch_index,
                "total_batches": total_batches,
                "rows": rows_count,
                "success_symbols": success_symbols,
                "failed_symbols": failed_symbols,
                "skipped_symbols": skipped_symbols,
                "no_data_symbols": no_data_symbols_count,
                "coverage_retry_symbols": coverage_retry_symbols,
            }
            self.system_service.finish_task_if_active(
                task_id,
                "running",
                progress,
                f"2026 日 K 分批补齐：{batch_index}/{total_batches}",
                json.dumps(detail, ensure_ascii=False),
                finished=False,
            )
        self.repository.update_cursor("daily_kline", "", "", request.end_date)
        self.repository.add_sync_log(
            task_id,
            "daily_kline",
            "info" if failed_symbols == 0 else "error",
            "2026 日 K 分批补齐结束。" if failed_symbols == 0 else "2026 日 K 分批补齐存在失败股票。",
            json.dumps(
                {
                    "rows": rows_count,
                    "success_symbols": success_symbols,
                    "failed_symbols": failed_symbols,
                    "skipped_symbols": skipped_symbols,
                    "no_data_symbols": no_data_symbols_count,
                    "coverage_retry_symbols": coverage_retry_symbols,
                    "resume_rule": "coverage_first",
                },
                ensure_ascii=False,
            ),
        )
        return {
            "rows": rows_count,
            "success_symbols": success_symbols,
            "failed_symbols": failed_symbols,
            "skipped_symbols": skipped_symbols,
            "no_data_symbols": no_data_symbols_count,
        }

    def _run_2026_minute_batches(self, task_id: str, symbols: list[str], request: Prepare2026Request) -> dict[str, int]:
        adapter, adapter_detail = self._adapter()
        batch_size = max(1, min(request.minute_batch_size, 100))
        rows_count = 0
        success_symbols = 0
        failed_symbols = 0
        skipped_symbols = 0
        no_data_symbols_count = 0
        coverage_retry_symbols = 0
        end_date = request.end_date or self._recent_completed_trading_day()
        fallback_business_days = self._business_days(request.start_date, end_date)
        trading_days = self.repository.trading_days_between(request.start_date, end_date) or fallback_business_days
        open_dates = self.repository.instrument_open_dates(symbols)
        daily_expected_days_by_symbol = expected_trading_days_by_symbol(symbols, trading_days, open_dates)
        expected_days_by_symbol = self._expected_minute_days_by_symbol(
            request.start_date,
            end_date,
            symbols,
            daily_expected_days_by_symbol,
        )
        existing_coverage = self.repository.minute_symbol_coverage_stats(request.start_date, end_date, request.period, symbols)
        windows = self._minute_date_windows(request.start_date, end_date, request.minute_window_days)
        total_batches = max(len(windows) * max((len(symbols) + batch_size - 1) // batch_size, 1), 1)
        completed_batches = 0
        minute_progress_start = 45 if request.include_daily_kline else 10
        minute_progress_span = 50 if request.include_daily_kline else 85
        self.repository.add_sync_log(
            task_id,
            "minute_kline",
            "info",
            "2026 分钟 K 分批补齐开始。",
            json.dumps(
                {
                    "symbols": len(symbols),
                    "batch_size": batch_size,
                    "window_days": request.minute_window_days,
                    "period": request.period,
                    "start_date": request.start_date,
                    "end_date": end_date,
                    "trading_days": len(trading_days),
                    "expected_symbol_days": sum(len(days) for days in expected_days_by_symbol.values()),
                    "windows": len(windows),
                    "resume_rule": "minute_coverage_first",
                    "full_market": request.include_full_market_minute,
                    "no_symbol_truncation": True,
                    "adapter": adapter_detail,
                },
                ensure_ascii=False,
            ),
        )
        for window_index, (window_start, window_end) in enumerate(windows, start=1):
            start_time = f"{window_start} 09:30:00"
            end_time = f"{window_end} 15:00:00"
            for batch_start in range(0, len(symbols), batch_size):
                self.system_service.ensure_not_cancelled(task_id)
                completed_batches += 1
                batch_symbols = symbols[batch_start:batch_start + batch_size]
                window_expected_days = {
                    symbol: [
                        day for day in expected_days_by_symbol.get(symbol, [])
                        if window_start <= day <= window_end
                    ]
                    for symbol in batch_symbols
                }
                pending_symbols = [
                    symbol for symbol in batch_symbols
                    if request.overwrite_existing or not self._minute_symbol_coverage_complete(
                        symbol,
                        window_expected_days.get(symbol, []),
                        existing_coverage.get(symbol, {"rows": 0, "days": set()}),
                        request.period,
                        end_time,
                    )
                ]
                skipped_symbols += len(batch_symbols) - len(pending_symbols)
                coverage_retry_symbols += len(pending_symbols)
                if not pending_symbols:
                    self.repository.add_sync_log(
                        task_id,
                        "minute_kline",
                        "info",
                        f"第 {completed_batches}/{total_batches} 批分钟 K 已跳过。",
                        json.dumps(
                            {
                                "symbols": batch_symbols,
                                "period": request.period,
                                "window": f"{window_start}~{window_end}",
                                "reason": "minute_coverage_already_complete",
                                "resume_rule": "minute_coverage_first",
                            },
                            ensure_ascii=False,
                        ),
                    )
                    continue
                minute_request = SyncRequest(symbols=pending_symbols, start_time=start_time, end_time=end_time, period=request.period)
                self._validate_minute_range(minute_request)
                try:
                    rows = standardize_minute_kline(adapter.get_minute_kline(pending_symbols, start_time, end_time, request.period))
                    written = self.repository.upsert_minute_kline(rows)
                    merge_minute_rows_into_coverage(existing_coverage, rows)
                    row_symbols = self._symbols_with_rows(rows)
                    no_data_symbols = sorted(set(pending_symbols) - row_symbols)
                    rows_count += written
                    success_symbols += len(row_symbols)
                    no_data_symbols_count += len(no_data_symbols)
                    for symbol in sorted(row_symbols):
                        self.repository.update_cursor("minute_kline", symbol, request.period, end_time)
                    self.repository.add_sync_log(
                        task_id,
                        "minute_kline",
                        "info",
                        f"第 {completed_batches}/{total_batches} 批分钟 K 同步完成。",
                        json.dumps({"symbols": pending_symbols, "period": request.period, "start_time": start_time, "end_time": end_time, "rows": written, "returned_symbols": sorted(row_symbols)}, ensure_ascii=False),
                    )
                    self._log_no_data_symbols(task_id, "minute_kline", no_data_symbols, f"period={request.period}; start_time={start_time}; end_time={end_time}")
                except Exception as batch_exc:
                    self.repository.add_sync_log(
                        task_id,
                        "minute_kline",
                        "warning",
                        f"第 {completed_batches}/{total_batches} 批分钟 K 批量同步失败，正在降级为单股票重试。",
                        repr(batch_exc),
                    )
                    for symbol in pending_symbols:
                        self.system_service.ensure_not_cancelled(task_id)
                        try:
                            rows = standardize_minute_kline(adapter.get_minute_kline([symbol], start_time, end_time, request.period))
                            written = self.repository.upsert_minute_kline(rows)
                            merge_minute_rows_into_coverage(existing_coverage, rows)
                            row_symbols = self._symbols_with_rows(rows)
                            rows_count += written
                            if symbol in row_symbols:
                                success_symbols += 1
                                self.repository.update_cursor("minute_kline", symbol, request.period, end_time)
                                self.repository.add_sync_log(task_id, "minute_kline", "info", f"{symbol} 2026 分钟 K 同步完成。", f"period={request.period}; start_time={start_time}; end_time={end_time}; rows={written}")
                            else:
                                no_data_symbols_count += 1
                                self._log_no_data_symbols(task_id, "minute_kline", [symbol], f"period={request.period}; start_time={start_time}; end_time={end_time}")
                        except Exception as symbol_exc:
                            failed_symbols += 1
                            self.repository.add_sync_log(
                                task_id,
                                "minute_kline",
                                "error",
                                f"{symbol} 2026 分钟 K 同步失败。",
                                repr(symbol_exc),
                            )
                progress = min(95, minute_progress_start + int(minute_progress_span * completed_batches / total_batches))
                self.system_service.finish_task_if_active(
                    task_id,
                    "running",
                    progress,
                    f"2026 分钟 K 分批补齐：{completed_batches}/{total_batches}",
                    json.dumps(
                        {
                            "period": request.period,
                            "window": f"{window_start}~{window_end}",
                            "window_index": window_index,
                            "total_windows": len(windows),
                            "batch": completed_batches,
                            "total_batches": total_batches,
                            "start_date": request.start_date,
                            "target_end_date": end_date,
                            "full_range": f"{request.start_date}~{end_date}",
                            "rows": rows_count,
                            "success_symbols": success_symbols,
                            "failed_symbols": failed_symbols,
                            "skipped_symbols": skipped_symbols,
                            "no_data_symbols": no_data_symbols_count,
                            "coverage_retry_symbols": coverage_retry_symbols,
                            "resume_rule": "minute_coverage_first",
                        },
                        ensure_ascii=False,
                    ),
                    finished=False,
                )
        self.repository.update_cursor("minute_kline", "", request.period, f"{end_date} 15:00:00")
        self.repository.add_sync_log(
            task_id,
            "minute_kline",
            "info" if failed_symbols == 0 else "error",
            "2026 分钟 K 分批补齐结束。" if failed_symbols == 0 else "2026 分钟 K 分批补齐存在失败股票。",
            json.dumps(
                {
                    "period": request.period,
                    "rows": rows_count,
                    "success_symbols": success_symbols,
                    "failed_symbols": failed_symbols,
                    "skipped_symbols": skipped_symbols,
                    "no_data_symbols": no_data_symbols_count,
                    "coverage_retry_symbols": coverage_retry_symbols,
                    "batch": completed_batches,
                    "total_batches": total_batches,
                    "start_date": request.start_date,
                    "target_end_date": end_date,
                    "full_range": f"{request.start_date}~{end_date}",
                    "resume_rule": "minute_coverage_first",
                },
                ensure_ascii=False,
            ),
        )
        return {
            "rows": rows_count,
            "success_symbols": success_symbols,
            "failed_symbols": failed_symbols,
            "skipped_symbols": skipped_symbols,
            "no_data_symbols": no_data_symbols_count,
            "coverage_retry_symbols": coverage_retry_symbols,
        }

    def create_sync_task(self, sync_type: str, request: SyncRequest | None = None) -> TaskCreated:
        request = self._normalize_sync_request(request or SyncRequest())
        if sync_type == "all":
            self._ensure_no_active_sync_task("sync_all", "全量同步")
        if sync_type == "minute_kline":
            if not request.symbols or not request.start_time or not request.end_time:
                raise DataSyncError(
                    message="分钟K同步必须选择股票和时间范围。",
                    code="DATA_SYNC_RANGE_REQUIRED",
                    detail=str(request.model_dump()),
                    suggestion="请在数据同步中填写股票代码、开始时间和结束时间。",
                )
            self._validate_minute_range(request)
        task = self.system_repository.create_task(f"sync_{sync_type}", f"正在同步：{sync_type}")
        self.repository.create_sync_task(task.task_id, sync_type)
        self.system_repository.add_operation_log("数据中心", "创建同步", "runtime_task", task.task_id, "成功", f"已创建 {sync_type} 同步任务。")
        return TaskCreated(task_id=task.task_id, task_type=task.task_type, status=task.status, progress=task.progress, message=task.message)

    def _ensure_no_active_sync_task(self, task_type: str, label: str) -> None:
        active = self.system_repository.find_active_task_by_type(task_type)
        if active:
            raise DataSyncError(
                message="同类型任务正在执行，请等待完成后重试。",
                code="TASK_ALREADY_RUNNING",
                detail=f"task_type={task_type}; active_task_id={active.task_id}; status={active.status}",
                suggestion=f"请到数据中心同步任务或系统管理运行监控查看“{label}”进度，任务结束后再重新发起。",
            )

    def run_sync_task(self, task_id: str, sync_type: str, request: SyncRequest | None = None) -> None:
        request = self._normalize_sync_request(request or SyncRequest())
        try:
            self.system_service.ensure_not_cancelled(task_id)
            total = self._run_sync(task_id, sync_type, request)
            _, adapter_detail = self._adapter()
            self.system_service.ensure_not_cancelled(task_id)
            if self._is_empty_kline_sync(sync_type, request, total):
                symbol_text = ",".join(request.symbols)
                message = f"{sync_type} 未返回任何 K 线数据。"
                detail = (
                    f"symbols={symbol_text}; rows=0; {adapter_detail}; "
                    "请确认 QMT 是否支持该市场/标的的 K 线、是否有行情权限，或换一个日期范围重试。"
                )
                self.repository.finish_sync_task(task_id, "failed", 0, 0, len(request.symbols))
                self.repository.add_sync_log(task_id, sync_type, "error", message, detail)
                self.system_service.finish_task_if_active(task_id, "failed", 100, message, detail, finished=True)
                self.system_repository.add_operation_log("数据中心", "K线无数据", "runtime_task", task_id, "失败", message, detail)
                return
            self.repository.finish_sync_task(task_id, "success", total, total, 0)
            self.repository.add_sync_log(task_id, sync_type, "info", f"{sync_type} 同步完成。", f"rows={total}; {adapter_detail}")
            self.system_service.finish_task_if_active(task_id, "success", 100, f"{sync_type} 同步完成。", adapter_detail, finished=True)
            self.system_repository.add_operation_log("数据中心", "同步完成", "runtime_task", task_id, "成功", f"{sync_type} 同步完成，共 {total} 条。", adapter_detail)
        except TaskCancelledError:
            self.repository.finish_sync_task(task_id, "cancelled", 0, 0, 0)
            self.repository.add_sync_log(task_id, sync_type, "warning", f"{sync_type} 同步已取消。", "task_cancelled=true")
            self.system_repository.add_operation_log("数据中心", "同步取消", "runtime_task", task_id, "成功", f"{sync_type} 同步已取消。", "task_cancelled=true")
        except Exception as exc:
            if not self.system_repository.is_task_cancelled(task_id):
                detail = self._exception_detail(exc)
                self.repository.finish_sync_task(task_id, "failed", 0, 0, 1)
                self.repository.add_sync_log(task_id, sync_type, "error", f"{sync_type} 同步失败。", detail)
                self.system_service.finish_task_if_active(task_id, "failed", 100, f"{sync_type} 同步失败。", detail, finished=True)
                self.system_repository.add_operation_log("数据中心", "同步失败", "runtime_task", task_id, "失败", f"{sync_type} 同步失败。", detail)

    def _is_empty_kline_sync(self, sync_type: str, request: SyncRequest, total: int) -> bool:
        return sync_type in {"daily_kline", "minute_kline"} and bool(request.symbols) and total == 0

    def _exception_detail(self, exc: Exception) -> str:
        if isinstance(exc, AppError):
            parts = [f"code={exc.code}", f"message={exc.message}"]
            if exc.detail:
                parts.append(f"detail={exc.detail}")
            if exc.suggestion:
                parts.append(f"suggestion={exc.suggestion}")
            return "; ".join(parts)
        return repr(exc)

    def _run_sync(self, task_id: str, sync_type: str, request: SyncRequest) -> int:
        self.system_service.ensure_not_cancelled(task_id)
        adapter, _ = self._adapter()
        symbols = request.symbols or self._default_market_symbols()
        if sync_type == "daily_kline":
            start_date = request.start_date or "2026-05-06"
            end_date = request.end_date or "2026-05-08"
            rows = standardize_daily_kline(adapter.get_daily_kline(symbols, start_date, end_date))
            count = self.repository.upsert_daily_kline(rows)
            row_symbols = self._symbols_with_rows(rows)
            self._update_sync_cursors(sync_type, request, sorted(row_symbols))
            self._log_no_data_symbols(task_id, sync_type, sorted(set(symbols) - row_symbols), f"start_date={start_date}; end_date={end_date}")
            return count
        if sync_type == "minute_kline":
            start_time = request.start_time or ""
            end_time = request.end_time or ""
            rows = standardize_minute_kline(adapter.get_minute_kline(symbols, start_time, end_time, request.period))
            count = self.repository.upsert_minute_kline(rows)
            row_symbols = self._symbols_with_rows(rows)
            self._update_sync_cursors(sync_type, request, sorted(row_symbols))
            self._log_no_data_symbols(task_id, sync_type, sorted(set(symbols) - row_symbols), f"period={request.period}; start_time={start_time}; end_time={end_time}")
            return count
        handlers: dict[str, Callable[[], int]] = {
            "stock_basic": lambda: self.repository.upsert_stock_basic(standardize_stock_basic(adapter.get_stock_basic())),
            "instrument_detail": lambda: self._sync_instrument_details(adapter, request),
            "trading_calendar": lambda: self._sync_trading_calendar(adapter, request),
            "account": lambda: self.repository.insert_account(standardize_account(adapter.get_account())),
            "positions": lambda: self.repository.upsert_positions(standardize_positions(adapter.get_positions())),
            "orders": lambda: self.repository.upsert_orders(standardize_orders(adapter.get_orders())),
            "trades": lambda: self.repository.upsert_trades(standardize_trades(adapter.get_trades())),
        }
        if sync_type == "all":
            total = 0
            children = ["stock_basic", "account", "positions", "orders", "trades", "daily_kline"]
            if not self.system_service.get_config().simulation_mode:
                children = ["stock_basic", "account", "positions", "orders", "trades"]
            for child in children:
                self.system_service.ensure_not_cancelled(task_id)
                total += self._run_sync(task_id, child, request)
            return total
        if sync_type not in handlers:
            raise DataSyncError("未知同步类型。", "DATA_SYNC_FAILED", sync_type, "请刷新页面后重试。")
        count = handlers[sync_type]()
        self._update_sync_cursors(sync_type, request, symbols)
        return count

    def _symbols_with_rows(self, rows: list[dict[str, object]]) -> set[str]:
        return {
            symbol
            for row in rows
            if (symbol := normalize_symbol(str(row.get("symbol", ""))))
        }

    def _log_no_data_symbols(self, task_id: str, sync_type: str, symbols: list[str], detail: str) -> None:
        if not symbols:
            return
        self.repository.add_sync_log(
            task_id,
            sync_type,
            "warning",
            f"{sync_type} 部分标的未返回数据。",
            json.dumps({"symbols": symbols, "detail": detail, "cursor_updated": False}, ensure_ascii=False),
        )

    def _normalize_sync_request(self, request: SyncRequest) -> SyncRequest:
        return normalize_sync_request(request)

    def _normalize_latest_data_sync_request(self, request: LatestDataSyncRequest) -> LatestDataSyncRequest:
        return normalize_latest_data_sync_request(request, self._recent_completed_trading_day())

    def _validate_latest_data_sync_request(self, request: LatestDataSyncRequest) -> None:
        validate_latest_data_sync_request(request)

    def _normalize_2026_request(self, request: Prepare2026Request) -> Prepare2026Request:
        return normalize_prepare_2026_request(request, self._recent_completed_trading_day())

    def _recent_completed_trading_day(self) -> str:
        current = date.today()
        if datetime.now().time() < time(16, 0):
            current -= timedelta(days=1)
        if current.weekday() >= 5:
            current -= timedelta(days=current.weekday() - 4)
        candidate = current.strftime("%Y-%m-%d")
        calendar_start = current - timedelta(days=14)
        calendar_days = self.repository.trading_days_between(
            calendar_start.strftime("%Y-%m-%d"),
            current.strftime("%Y-%m-%d"),
        )
        if calendar_days and calendar_days[-1] >= candidate:
            return calendar_days[-1]
        return candidate

    def _business_days(self, start_date: str, end_date: str | None) -> list[str]:
        start = datetime.strptime(start_date, "%Y-%m-%d").date()
        end = datetime.strptime(end_date or self._recent_completed_trading_day(), "%Y-%m-%d").date()
        days: list[str] = []
        cursor = start
        while cursor <= end:
            if cursor.weekday() < 5:
                days.append(cursor.strftime("%Y-%m-%d"))
            cursor += timedelta(days=1)
        return days

    def _expected_trading_days_by_symbol(
        self,
        symbols: list[str],
        trading_days: list[str],
        open_dates: dict[str, str | None],
    ) -> dict[str, list[str]]:
        return expected_trading_days_by_symbol(symbols, trading_days, open_dates)

    def _expected_minute_days_by_symbol(
        self,
        start_date: str,
        end_date: str,
        symbols: list[str],
        fallback_expected_days: dict[str, list[str]],
    ) -> dict[str, list[str]]:
        tradable_days = self.repository.daily_tradable_days_by_symbol(start_date, end_date, symbols)
        daily_days = self.repository.daily_kline_days_by_symbol(start_date, end_date, symbols)
        result: dict[str, list[str]] = {}
        for symbol in symbols:
            days = sorted(tradable_days.get(symbol, set()))
            if daily_days.get(symbol):
                result[symbol] = days
            else:
                result[symbol] = fallback_expected_days.get(symbol, [])
        return result

    def _coverage_row(
        self,
        data_type: str,
        symbol: str,
        period: str,
        start_date: str,
        end_date: str,
        expected_trading_days: int,
        actual_trading_days: int,
        expected_rows: int | None,
        actual_rows: int,
        missing_days: list[str],
        duplicate_rows: int,
        checked_at: str,
    ) -> dict[str, object]:
        return build_coverage_row(
            data_type,
            symbol,
            period,
            start_date,
            end_date,
            expected_trading_days,
            actual_trading_days,
            expected_rows,
            actual_rows,
            missing_days,
            duplicate_rows,
            checked_at,
        )

    def _daily_cursor_covers(self, symbol: str, end_date: str) -> bool:
        cursor = self.repository.get_cursor_last_sync_time("daily_kline", symbol, "")
        if not cursor or not end_date:
            return False
        return cursor[:10] >= end_date[:10]

    def _daily_symbol_coverage_complete(self, symbol: str, expected_days: list[str], symbol_stats: dict[str, object]) -> bool:
        if not has_symbol_day_coverage(expected_days, symbol_stats):
            return False
        if not expected_days:
            return True
        end_date = expected_days[-1]
        cursor = self.repository.get_cursor_last_sync_time("daily_kline", symbol, "")
        if not cursor or cursor[:10] < end_date[:10]:
            self.repository.update_cursor("daily_kline", symbol, "", end_date)
        return True

    def _minute_cursor_covers(self, symbol: str, period: str, end_time: str) -> bool:
        cursor = self.repository.get_cursor_last_sync_time("minute_kline", symbol, period)
        if not cursor or not end_time:
            return False
        return cursor[:19] >= end_time[:19]

    def _minute_symbol_coverage_complete(
        self,
        symbol: str,
        expected_days: list[str],
        symbol_stats: dict[str, object],
        period: str,
        end_time: str,
    ) -> bool:
        if not has_symbol_day_coverage(expected_days, symbol_stats):
            return False
        if not expected_days:
            return True
        cursor = self.repository.get_cursor_last_sync_time("minute_kline", symbol, period)
        if not cursor or cursor[:19] < end_time[:19]:
            self.repository.update_cursor("minute_kline", symbol, period, end_time)
        return True

    def _minute_date_windows(self, start_date: str, end_date: str, window_days: int) -> list[tuple[str, str]]:
        trading_days = self.repository.trading_days_between(start_date, end_date) or self._business_days(start_date, end_date)
        window_size = max(1, min(window_days, 7))
        windows: list[tuple[str, str]] = []
        current_window: list[str] = []
        for trading_day in trading_days:
            if not current_window:
                current_window = [trading_day]
                continue
            span_days = (
                datetime.strptime(trading_day, "%Y-%m-%d").date()
                - datetime.strptime(current_window[0], "%Y-%m-%d").date()
            ).days
            if len(current_window) >= window_size or span_days > 7:
                windows.append((current_window[0], current_window[-1]))
                current_window = [trading_day]
            else:
                current_window.append(trading_day)
        if current_window:
            windows.append((current_window[0], current_window[-1]))
        return windows

    def _resolve_2026_symbols(self, request: Prepare2026Request) -> list[str]:
        if request.symbols:
            return request.symbols
        stored_symbols = self.repository.list_all_stock_symbols()
        if stored_symbols:
            return stored_symbols
        adapter, _ = self._adapter()
        rows = standardize_stock_basic(adapter.get_stock_basic())
        self.repository.upsert_stock_basic(rows)
        return [str(row["symbol"]) for row in rows]

    def _resolve_2026_minute_symbols(self, request: Prepare2026Request) -> list[str]:
        if request.symbols:
            return request.symbols
        if request.include_full_market_minute:
            return self._resolve_2026_symbols(request)
        holding_symbols = self.repository.list_latest_position_symbols(limit=request.minute_batch_size)
        if holding_symbols:
            return holding_symbols
        return self._default_market_symbols(limit=min(request.minute_batch_size, 2))

    def _default_market_symbols(self, limit: int = 200) -> list[str]:
        symbols = self.repository.list_all_stock_symbols(page_size=min(limit, 200))
        if symbols:
            return symbols[:limit]
        return ["600000.SH", "000001.SZ"]

    def _scope_label(self, request: Prepare2026Request) -> str:
        labels = {
            "all_a_share": "全部 A 股",
            "watchlist": "自选池",
            "strategy_pool": "策略池",
            "holdings": "持仓",
            "manual": "手动选择",
        }
        return labels.get(request.stock_scope, request.stock_scope)

    def _validate_minute_range(self, request: SyncRequest) -> None:
        try:
            start_time = datetime.strptime(request.start_time or "", "%Y-%m-%d %H:%M:%S")
            end_time = datetime.strptime(request.end_time or "", "%Y-%m-%d %H:%M:%S")
        except ValueError as exc:
            raise DataSyncError(
                message="分钟K时间格式不正确。",
                code="DATA_SYNC_TIME_INVALID",
                detail=repr(exc),
                suggestion="请使用 YYYY-MM-DD HH:mm:ss 格式，例如 2026-05-08 09:30:00。",
            ) from exc
        if end_time <= start_time:
            raise DataSyncError(
                message="分钟K结束时间必须晚于开始时间。",
                code="DATA_SYNC_TIME_INVALID",
                detail=f"start_time={request.start_time}; end_time={request.end_time}",
                suggestion="请重新选择分钟K同步时间范围。",
            )
        if (end_time - start_time).days > 7:
            raise DataSyncError(
                message="分钟K同步范围过大。",
                code="DATA_SYNC_RANGE_TOO_LARGE",
                detail=f"start_time={request.start_time}; end_time={request.end_time}",
                suggestion="第一版分钟K请按股票和不超过 7 天的区间同步，避免全市场多年同步。",
            )

    def _update_sync_cursors(self, sync_type: str, request: SyncRequest, symbols: list[str]) -> None:
        current = now_text()
        if sync_type == "daily_kline":
            last_sync_time = request.end_date or current[:10]
            for symbol in symbols:
                self.repository.update_cursor(sync_type, symbol, "", last_sync_time)
            return
        if sync_type == "minute_kline":
            for symbol in symbols:
                self.repository.update_cursor(sync_type, symbol, request.period, request.end_time or current)
            return
        if sync_type == "instrument_detail":
            for symbol in symbols:
                self.repository.update_cursor(sync_type, symbol, "", current)
            return
        if sync_type == "trading_calendar":
            for market in ["SH", "SZ"]:
                self.repository.update_cursor(sync_type, market, "", request.end_date or current[:10])
            return
        self.repository.update_cursor(sync_type, "", "", current)

    def list_sync_tasks(self, query: PageQuery | None = None) -> PageResult[SyncTaskSummary] | list[SyncTaskSummary]:
        result = self.repository.list_sync_tasks(query or PageQuery())
        return result if query else result.items

    def list_sync_logs(self, query: PageQuery | None = None) -> PageResult[SyncLogRecord]:
        return self.repository.list_sync_logs(query or PageQuery())

    def create_quality_task(self) -> TaskCreated:
        task = self.system_repository.create_task("data_quality_check", "正在执行数据质量检查。")
        self.system_repository.add_operation_log("数据中心", "质量检查", "runtime_task", task.task_id, "成功", "已创建数据质量检查任务。")
        return TaskCreated(task_id=task.task_id, task_type=task.task_type, status=task.status, progress=task.progress, message=task.message)

    def run_quality_check(self, task_id: str) -> None:
        try:
            self.system_service.ensure_not_cancelled(task_id)
            self.system_service.finish_task_if_active(task_id, "running", 5, "正在检查数据表记录数量。", None, finished=False)
            results: list[dict[str, object]] = []
            for table, label in QUALITY_TABLES:
                count = self.repository.count_table(table)
                results.append(build_table_count_result(table, label, count))
            self.system_service.ensure_not_cancelled(task_id)
            self.system_service.finish_task_if_active(task_id, "running", 20, "正在检查关键数据更新时间。", None, finished=False)
            for table, field, label, suggestion in QUALITY_TIME_CHECKS:
                latest = self.repository.latest_table_time(table, field)
                results.append(build_time_result(table, label, latest, suggestion))
            self.system_service.ensure_not_cancelled(task_id)
            self.system_service.finish_task_if_active(task_id, "running", 40, "正在检查重复数据和唯一约束。", None, finished=False)
            current_account_id = self._current_account_id()
            for check_type, table, fields, label in QUALITY_DUPLICATE_CHECKS:
                account_scope = current_account_id if table in {"account_snapshot", "position_snapshot", "order_record", "trade_record"} else None
                duplicate_count = self.repository.duplicate_group_count(table, fields, account_id=account_scope)
                results.append(
                    build_duplicate_result(
                        check_type=check_type,
                        table=table,
                        label=label,
                        duplicate_count=duplicate_count,
                        account_scope=account_scope,
                    )
                )
            self.system_service.ensure_not_cancelled(task_id)
            self.system_service.finish_task_if_active(task_id, "running", 70, "正在检查代码格式、K线缺失和同步失败。", None, finished=False)
            invalid_symbol_count = self.repository.invalid_symbol_count()
            results.append({
                "check_type": "代码格式",
                "target_table": "all_market_tables",
                "status": "success" if invalid_symbol_count == 0 else "failed",
                "message": f"非标准股票代码数量：{invalid_symbol_count}。",
                "suggestion": None if invalid_symbol_count == 0 else "股票代码必须统一为 600000.SH / 000001.SZ 格式。",
            })
            missing_daily_symbols = self.repository.daily_kline_missing_symbol_count()
            results.append({
                "check_type": "K线缺失",
                "target_table": "daily_kline",
                "status": "success" if missing_daily_symbols == 0 else "warning",
                "message": f"已上市股票中缺少日K的标的数：{missing_daily_symbols}。",
                "suggestion": None if missing_daily_symbols == 0 else "请对缺少行情的标的补充同步日K。",
            })
            failed_sync_count = self.repository.failed_sync_count()
            results.append({
                "check_type": "同步失败",
                "target_table": "sync_task",
                "status": "success" if failed_sync_count == 0 else "failed",
                "message": f"未被后续成功同步覆盖的失败任务数：{failed_sync_count}。",
                "suggestion": None if failed_sync_count == 0 else "请查看同步任务和错误详情后重试。",
            })
            cursor_count = self.repository.cursor_count()
            results.append({
                "check_type": "同步游标",
                "target_table": "sync_cursor",
                "status": "success" if cursor_count > 0 else "warning",
                "message": f"同步游标记录数：{cursor_count}。",
                "suggestion": None if cursor_count > 0 else "请至少完成一次数据同步以生成增量游标。",
            })
            legacy_cursor_count = self.repository.legacy_cursor_symbol_count()
            results.append({
                "check_type": "同步游标格式",
                "target_table": "sync_cursor",
                "status": "success" if legacy_cursor_count == 0 else "warning",
                "message": f"旧格式逗号拼接游标数：{legacy_cursor_count}。",
                "suggestion": None if legacy_cursor_count == 0 else "建议后续清理旧游标；新同步会按数据类型、股票代码、周期分别维护游标。",
            })
            self.system_service.ensure_not_cancelled(task_id)
            self.system_service.finish_task_if_active(task_id, "running", 90, "正在检查委托成交一致性并写入结果。", None, finished=False)
            orphan_trade_count = self.repository.trade_without_order_count()
            results.append({
                "check_type": "委托成交",
                "target_table": "trade_record",
                "status": "success" if orphan_trade_count == 0 else "failed",
                "message": f"找不到本地委托的成交记录数：{orphan_trade_count}。",
                "suggestion": None if orphan_trade_count == 0 else "请检查成交同步和委托同步是否来自同一账户，并重新同步委托与成交。",
            })
            self.system_service.ensure_not_cancelled(task_id)
            self.repository.replace_quality_results(results)
            self.system_service.finish_task_if_active(task_id, "success", 100, "数据质量检查完成。", finished=True)
            self.system_repository.add_operation_log("数据中心", "质量检查完成", "runtime_task", task_id, "成功", "数据质量检查完成。")
        except TaskCancelledError:
            return
        except Exception as exc:
            if not self.system_repository.is_task_cancelled(task_id):
                self.system_service.finish_task_if_active(task_id, "failed", 100, "数据质量检查失败。", repr(exc), finished=True)
                self.system_repository.add_operation_log("数据中心", "质量检查失败", "runtime_task", task_id, "失败", "数据质量检查失败。", repr(exc))

    def list_quality_results(self, query: PageQuery | None = None) -> PageResult[DataQualityRecord] | list[DataQualityRecord]:
        result = self.repository.list_quality_results(query or PageQuery(page_size=50))
        return result if query else result.items

    def quality_summary(self) -> DataQualitySummary:
        return self.repository.quality_summary(expected_min_checks=QUALITY_EXPECTED_MIN_CHECKS)

    def list_account_snapshot_duplicates(self, query: PageQuery | None = None) -> PageResult[AccountSnapshotDuplicateRecord]:
        return self.repository.list_account_snapshot_duplicates(query or PageQuery(page_size=20, sort_field="snapshot_time", sort_order="desc"))

    def cleanup_legacy_sync_cursors(self) -> LegacyCursorCleanupResult:
        archived_rows = self.repository.cleanup_legacy_cursor_symbols()
        cleaned_count = len(archived_rows)
        message = (
            f"已清理 {cleaned_count} 条旧格式逗号拼接同步游标。"
            if cleaned_count
            else "未发现旧格式逗号拼接同步游标，无需清理。"
        )
        detail = {
            "reason": "legacy_comma_joined_symbol_cursor_cleanup",
            "cleaned_count": cleaned_count,
            "archived_rows": archived_rows,
            "next_step": "重新执行数据质量检查，确认同步游标格式检查项恢复正常。",
        }
        self.system_repository.add_operation_log(
            module="数据中心",
            action="清理旧同步游标",
            target_type="sync_cursor",
            target_id=None,
            result="成功",
            message=message,
            technical_detail=json.dumps(detail, ensure_ascii=False),
        )
        return LegacyCursorCleanupResult(
            cleaned_count=cleaned_count,
            archived_count=cleaned_count,
            message=message,
            technical_detail=json.dumps(detail, ensure_ascii=False),
        )

    def ensure_dictionary(self) -> None:
        self.repository.seed_dictionary(DICTIONARY_RECORDS)

    def list_dictionary(self, query: PageQuery | None = None, table_name: str | None = None) -> PageResult[DataDictionaryRecord] | list[DataDictionaryRecord]:
        self.ensure_dictionary()
        result = self.repository.list_dictionary(query or PageQuery(page_size=100, sort_field="table_name", sort_order="asc"), table_name)
        return result if query else result.items
