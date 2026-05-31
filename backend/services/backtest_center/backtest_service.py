import ast
import hashlib
import json
import re
import traceback
from pathlib import Path
from typing import Any
from backend.core.config import settings
from backend.core.exceptions import BacktestError, TaskCancelledError
from backend.services.system.system_service import SystemService
from backend.repositories.backtest_center.backtest_repository import BacktestRepository
from backend.repositories.data_center.data_center_repository import DataCenterRepository
from backend.repositories.strategy_dev.strategy_repository import StrategyRepository
from backend.repositories.system.system_repository import SystemRepository, now_text
from backend.schemas.backtest import (
    BacktestCreateRequest,
    BacktestDataCheckRequest,
    BacktestDataCheckResult,
    BacktestEquityRecord,
    BacktestLogRecord,
    BacktestReport,
    BacktestResultRecord,
    BacktestSignalRecord,
    BacktestTaskRecord,
    BacktestTradeRecord,
    BacktestValidationStep,
)
from backend.schemas.common import PageQuery, PageResult
from backend.schemas.system import TaskCreated
from backend.services.backtest_center.backtest_engine import (
    BacktestBroker,
    DataLoader,
    MINUTE_SCAN_DIAGNOSTIC_PREFIX,
    MatchingEngine,
    MetricsService,
    ReportService,
    StrategyRunner,
)
from backend.services.backtest_center.xlsx_exporter import write_xlsx
from backend.services.strategy_dev.sandbox_runner import StrategyExecutionCancelled


class BacktestService:
    def __init__(self) -> None:
        self.repository = BacktestRepository()
        self.data_center_repository = DataCenterRepository()
        self.strategy_repository = StrategyRepository()
        self.system_repository = SystemRepository()
        self.system_service = SystemService()
        self.data_loader = DataLoader()
        self.strategy_runner = StrategyRunner()
        self.broker = BacktestBroker(MatchingEngine())
        self.metrics_service = MetricsService()
        self.report_service = ReportService()

    def check_data(self, request: BacktestDataCheckRequest) -> BacktestDataCheckResult:
        strategy = self.strategy_repository.get_file(request.strategy_id)
        steps = self._base_validation_steps(request, strategy.file_path)
        if request.start_date > request.end_date:
            steps.append(BacktestValidationStep(title="回测区间", status="failed", message="开始日期不能晚于结束日期。"))
            return BacktestDataCheckResult(ok=False, message="开始日期不能晚于结束日期。", suggestion="请调整回测日期范围。", steps=steps)
        if request.data_frequency != "分钟K" and self._strategy_requires_minute_bars(strategy.file_path):
            steps.append(BacktestValidationStep(title="数据频率", status="failed", message="当前策略依赖分钟K，但页面选择了日K。", technical_detail="strategy_requires_minute_bars=true"))
            return BacktestDataCheckResult(
                ok=False,
                message="当前策略依赖分钟K，不能使用日K回测创建可信结果。",
                suggestion="请将数据频率切换为分钟K后重新检查；系统会使用本地 SQLite 分钟线生成历史信号，并按回测成交规则本地撮合买入，不会调用真实 QMT 下单。",
                technical_detail=(
                    "strategy_requires_minute_bars=true; "
                    f"requested_frequency={request.data_frequency}; "
                    "minute_kline_backtest_enabled=true; real_qmt_order=false"
                ),
                steps=steps,
            )
        if request.data_frequency == "分钟K":
            mode_error = self._minute_replay_mode_error(request.fill_mode)
            if mode_error:
                steps.append(mode_error)
                return BacktestDataCheckResult(
                    ok=False,
                    message="分钟K回测必须使用正式分钟回放，不能使用快速扫描。",
                    suggestion="请将成交模式切换为“正式分钟回放”；系统会按本地 SQLite 1分钟K逐行推演信号，并按下一根1分钟K本地撮合成交。",
                    technical_detail=f"requested_fill_mode={request.fill_mode}; required_fill_mode=正式分钟回放; quick_scan_disabled=true",
                    steps=steps,
                )
            if not self._strategy_requires_minute_bars(strategy.file_path):
                steps.append(
                    BacktestValidationStep(
                        title="数据频率",
                        status="failed",
                        message=f"当前选择的策略【{strategy.strategy_name}】未调用分钟K接口，不能用分钟K结果冒充可信回测。",
                        technical_detail=f"strategy_id={strategy.id}; file_name={strategy.file_name}; strategy_path={strategy.file_path}; requires_minute=false",
                    )
                )
                return BacktestDataCheckResult(
                    ok=False,
                    message=f"当前选择的策略【{strategy.strategy_name}】未使用分钟K接口，不建议选择分钟K回测。",
                    suggestion="请对日K策略使用日K回测；如需分钟K，请切换到依赖 get_minute_bars 或 find_minute_amount_triggers 的分钟策略，例如当前的 8%止盈5日退出版。",
                    technical_detail=(
                        "strategy_requires_minute_bars=false; "
                        "requested_frequency=分钟K; "
                        f"strategy_id={strategy.id}; "
                        f"strategy_name={strategy.strategy_name}; "
                        f"file_name={strategy.file_name}; "
                        f"strategy_path={strategy.file_path}"
                    ),
                    steps=steps,
                )
            minute_count = self.repository.count_minute_rows(request.start_date, request.end_date, "1m")
            daily_count = self.repository.count_market_rows("daily_kline", "trade_date", request.start_date, request.end_date)
            steps.append(self._row_count_step("分钟K落库", minute_count, "minute_kline", request.start_date, request.end_date))
            steps.append(self._row_count_step("日K落库", daily_count, "daily_kline", request.start_date, request.end_date))
            steps.extend(self._coverage_steps(request, include_minute=True))
            minute_coverage = self.data_center_repository.get_coverage_record_covering("minute_kline", "ALL", "1m", request.start_date, request.end_date)
            if minute_coverage is not None and minute_coverage.status != "complete":
                technical_detail = json.dumps(
                    {
                        "data_type": "minute_kline",
                        "symbol": minute_coverage.symbol,
                        "period": minute_coverage.period,
                        "requested_range": f"{request.start_date}~{request.end_date}",
                        "coverage_range": f"{minute_coverage.start_date}~{minute_coverage.end_date}",
                        "coverage_status": minute_coverage.status,
                        "coverage_rate": minute_coverage.coverage_rate,
                        "expected_coverage_units": minute_coverage.expected_rows,
                        "actual_coverage_units": minute_coverage.actual_rows,
                    },
                    ensure_ascii=False,
                )
                steps.append(
                    BacktestValidationStep(
                        title="分钟K正式验收",
                        status="failed",
                        message="分钟K覆盖率记录未完成，不能创建正式分钟回放回测。",
                        technical_detail=technical_detail,
                    )
                )
                return BacktestDataCheckResult(
                    ok=False,
                    message="分钟K覆盖率未完成，不能创建可信分钟回测。",
                    suggestion="请先在数据中心补齐分钟K并重新执行覆盖率检查；覆盖率状态为 complete 后再开始回测。",
                    technical_detail=technical_detail,
                    steps=steps,
                )
            params = self._extract_strategy_params(strategy.file_path)
            window_steps, window_block_detail = self._minute_window_validation_steps(request, params, minute_coverage)
            steps.extend(window_steps)
            if window_block_detail is not None:
                return BacktestDataCheckResult(
                    ok=False,
                    message="分钟K关键时间窗口数据不完整，不能创建可信分钟回测。",
                    suggestion="请先在数据中心补齐策略买入窗口和卖出窗口的分钟K，再重新执行回测前检查。",
                    technical_detail=window_block_detail,
                    steps=steps,
                )
            steps.append(self._minute_full_day_bar_baseline_step(request, minute_coverage))
            max_signals = params.get("max_signals")
            if isinstance(max_signals, (int, float)):
                steps.append(
                    BacktestValidationStep(
                        title="分钟信号上限",
                        status="warning",
                        message=f"当前策略参数 max_signals={int(max_signals)}；若某交易日触发数量达到上限，回测报告会标记为可能截断。",
                        technical_detail=json.dumps({"max_signals": max_signals, "truncation_check": "enabled"}, ensure_ascii=False),
                    )
                )
            steps.append(
                BacktestValidationStep(
                    title="分钟回放模式",
                    status="success",
                    message="已强制使用正式分钟回放；快速分钟扫描已禁用。",
                    technical_detail="minute_mode=minute_replay; quick_scan_disabled=true",
                )
            )
            steps.append(
                BacktestValidationStep(
                    title="市值筛选基准",
                    status="success",
                    message="分钟K回测中，股票池和市值读取默认只使用当前交易日前一交易日及以前的日K，避免开盘策略使用当天收盘价。",
                    technical_detail="minute_backtest_market_cap_basis=previous_visible_daily_bar",
                )
            )
            if minute_count <= 0:
                return BacktestDataCheckResult(ok=False, message="分钟K数据不足。", suggestion="请先在数据中心同步回测区间内的 1 分钟K 数据。", steps=steps)
            if daily_count <= 0:
                return BacktestDataCheckResult(ok=False, message="日K数据不足，无法完成本地撮合成交和净值计算。", suggestion="分钟K信号回测仍需要日K用于下一日开盘撮合和资金曲线，请先补齐日K。", steps=steps)
            return BacktestDataCheckResult(
                ok=True,
                message=f"分钟K数据可用，共 {minute_count} 条；日K {daily_count} 条；将使用正式分钟回放。",
                suggestion="系统会逐行扫描本地 SQLite 1分钟K并按下一根1分钟K本地撮合成交，不会调用真实 QMT 下单。",
                technical_detail=f"minute_kline_rows={minute_count}; daily_kline_rows={daily_count}; minute_replay_enabled=true; minute_signal_scan_enabled=false; fill_rule=next_1m_bar; real_qmt_order=false; quick_scan_disabled=true",
                steps=steps,
            )
        count = self.repository.count_market_rows("daily_kline", "trade_date", request.start_date, request.end_date)
        if count <= 0:
            steps.append(self._row_count_step("日K落库", count, "daily_kline", request.start_date, request.end_date))
            return BacktestDataCheckResult(ok=False, message="日K数据不足。", suggestion="请先在数据中心同步日K数据。", steps=steps)
        steps.append(self._row_count_step("日K落库", count, "daily_kline", request.start_date, request.end_date))
        return self._coverage_checked_result(request, "daily_kline", "1d", count, steps=steps)

    def create_backtest(self, request: BacktestCreateRequest) -> TaskCreated:
        if request.start_date > request.end_date:
            raise BacktestError("开始日期不能晚于结束日期。", "BACKTEST_PARAM_INVALID", f"{request.start_date}>{request.end_date}", "请调整回测日期范围。")
        self._assert_backtest_mode(request)
        strategy = self.strategy_repository.get_file(request.strategy_id)
        if strategy.status != "enabled":
            raise BacktestError("策略已停用，不能创建回测。", "BACKTEST_PARAM_INVALID", f"strategy_id={request.strategy_id}", "请先启用策略。")
        request = self._normalize_backtest_name(request, strategy.strategy_name)
        check = self.check_data(
            BacktestDataCheckRequest(
                strategy_id=request.strategy_id,
                start_date=request.start_date,
                end_date=request.end_date,
                data_frequency=request.data_frequency,
                fill_mode=request.fill_mode,
            )
        )
        if not check.ok:
            raise BacktestError(check.message, "BACKTEST_DATA_NOT_READY", check.technical_detail, check.suggestion)
        task = self.system_repository.create_task("backtest_run", f"正在运行回测：{request.backtest_name}")
        self.repository.create_task(task.task_id, request)
        self.system_repository.add_operation_log(
            "回测研究",
            "创建回测",
            "backtest_task",
            task.task_id,
            "成功",
            f"已创建回测任务：{request.backtest_name}（{request.start_date} ~ {request.end_date}）",
            json.dumps(
                {
                    "strategy_id": request.strategy_id,
                    "backtest_name": request.backtest_name,
                    "start_date": request.start_date,
                    "end_date": request.end_date,
                    "initial_cash": request.initial_cash,
                    "single_order_amount": request.single_order_amount,
                    "data_frequency": request.data_frequency,
                    "fill_mode": request.fill_mode,
                    "fee_rate": request.fee_rate,
                    "stamp_tax_rate": request.stamp_tax_rate,
                    "slippage": request.slippage,
                },
                ensure_ascii=False,
            ),
        )
        return TaskCreated(task_id=task.task_id, task_type=task.task_type, status=task.status, progress=task.progress, message=task.message)

    @staticmethod
    def _compact_date_label(value: str) -> str:
        compact = (value or "").replace("-", "")
        return compact[4:] if len(compact) >= 8 else compact or "日期"

    def _normalize_backtest_name(self, request: BacktestCreateRequest, strategy_name: str) -> BacktestCreateRequest:
        current = (request.backtest_name or "").strip()
        generic_names = {
            "",
            "单策略本地撮合回测",
        }
        if current not in generic_names:
            return request
        name = "".join((strategy_name or "未选策略").split())
        start = self._compact_date_label(request.start_date)
        end = self._compact_date_label(request.end_date)
        generated = f"{name}_{start}-{end}_{request.data_frequency or '日K'}"
        return request.model_copy(update={"backtest_name": generated})

    def run_backtest_task(self, task_id: str) -> None:
        task = self.repository.get_task(task_id)
        try:
            self._checkpoint(task_id, 10, "正在加载策略。")
            strategy = self.strategy_repository.get_file(task.strategy_id)
            self.repository.add_log(task.id, "info", f"加载策略：{strategy.strategy_name}")

            symbols = self.data_loader.available_symbols(task.start_date, task.end_date)
            if not symbols:
                raise BacktestError("没有可用行情，无法回测。", "BACKTEST_DATA_NOT_READY", f"range={task.start_date}~{task.end_date}", "请先同步回测区间内的日K数据。")
            bars_by_symbol = self.data_loader.load_daily_bars(task, symbols)
            if not any(bars_by_symbol.values()):
                raise BacktestError("没有可用行情，无法回测。", "BACKTEST_DATA_NOT_READY", f"symbols={symbols}", "请先同步对应股票的日K数据。")
            self.repository.add_log(
                task.id,
                "info",
                f"加载全市场日 K 行情完成：共 {len(symbols)} 只股票，{sum(len(rows) for rows in bars_by_symbol.values())} 根 K 线。",
                f"sample_symbols={symbols[:50]}; range={task.start_date}~{task.end_date}; data_frequency={task.data_frequency}",
            )
            self.repository.add_logs(task.id, self._official_path_start_logs(task, strategy.strategy_name, symbols, bars_by_symbol))
            self.repository.save_manifest(task.id, self._manifest_payload(task, strategy, symbols, bars_by_symbol))
            self.repository.add_log(task.id, "info", "回测证据清单已生成：策略代码哈希、数据覆盖快照、股票池摘要和撮合规则已保存。")
            if task.data_frequency == "分钟K":
                self.repository.add_log(
                    task.id,
                    "info",
                    "分钟K回测模式：正式分钟回放；策略按当前回测日期逐行读取本地1分钟K生成信号，成交按下一根1分钟K本地撮合，不调用真实QMT。",
                    f"mode={self._minute_mode(task)}; fill_rule=next_1m_bar; real_qmt_order=false; quick_scan_disabled=true",
                )
            self._checkpoint(task_id, 30, "正在按交易日运行策略。", self._progress_detail("strategy_start", range=f"{task.start_date}~{task.end_date}", symbols=len(symbols)))

            signals, strategy_logs = self.strategy_runner.run(
                task,
                strategy.file_path,
                bars_by_symbol,
                cancel_check=lambda: self.system_repository.is_task_cancelled(task_id),
                progress_callback=lambda processed, total, current_date, signal_count: self._checkpoint(
                    task_id,
                    min(44, 30 + int(processed / max(total, 1) * 15)),
                    f"正在按交易日运行策略：{processed}/{total}，当前 {current_date}，累计信号 {signal_count} 条。",
                    self._progress_detail(
                        "strategy",
                        processed=processed,
                        total=total,
                        current_date=current_date,
                        signal_count=signal_count,
                        progress_range="30-45",
                    ),
                ),
                minute_progress_callback=lambda day_index, total_days, current_date, event: self._minute_scan_checkpoint(task_id, day_index, total_days, current_date, event),
            )
            self.repository.add_logs(task.id, [("info", "策略日志", line) for line in strategy_logs])
            self.repository.add_logs(task.id, [("info", *row) for row in self._signal_audit_logs(signals)])
            minute_scan_summary = self._minute_scan_summary(strategy_logs)
            if minute_scan_summary:
                self.repository.add_log(
                    task.id,
                    "warning" if minute_scan_summary.get("limit_hit_days") else "info",
                    self._minute_scan_summary_message(minute_scan_summary),
                    json.dumps(minute_scan_summary, ensure_ascii=False),
                )
            self._checkpoint(task_id, 45, f"策略逐日运行完成，生成 {len(signals)} 条信号。", self._progress_detail("strategy_done", signal_count=len(signals)))
            self._checkpoint(task_id, 55, "正在执行本地撮合回测。", self._progress_detail("broker_start", signal_count=len(signals), fill_mode=task.fill_mode, data_frequency=task.data_frequency))

            trades, _portfolio, broker_logs, signal_audits = self.broker.execute_with_audit(
                task,
                signals,
                bars_by_symbol,
                cancel_check=lambda: self.system_repository.is_task_cancelled(task_id),
                progress_callback=lambda processed, total, trade_count, skipped_count, current_symbol: self._checkpoint(
                    task_id,
                    min(74, 55 + int(processed / max(total, 1) * 20)),
                    f"正在执行本地撮合回测：{processed}/{total} 条事件，成交 {trade_count} 笔，跳过 {skipped_count} 条。",
                    self._progress_detail(
                        "broker",
                        processed=processed,
                        total=total,
                        trade_count=trade_count,
                        skipped_signal_count=skipped_count,
                        current_symbol=current_symbol,
                        progress_range="55-75",
                    ),
                ),
            )
            self.repository.add_logs(task.id, [("info", line, None) for line in broker_logs])
            self.repository.add_logs(task.id, [("info", *row) for row in self._trade_audit_logs(task, trades)])
            skipped_count = sum(1 for row in signal_audits if row.get("status") in {"跳过", "未成交"})
            self._checkpoint(task_id, 75, "正在计算净值和指标。", self._progress_detail("metrics_start", signal_count=len(signals), trade_count=len(trades), skipped_signal_count=skipped_count))

            equity = self.metrics_service.build_equity(task, bars_by_symbol, trades)
            metrics = self.metrics_service.metrics(task, equity, trades)
            report_lines = self.report_service.summarize(metrics, len(trades), len(broker_logs) + len(strategy_logs))
            report_lines.extend(self._minute_scan_audit_lines(minute_scan_summary))
            report_lines.extend(self._reconcile_audit_lines(metrics))
            self.repository.add_logs(task.id, [("info", line, None) for line in report_lines])
            self._checkpoint(task_id, 90, "正在保存回测结果。")
            self.repository.save_manifest(task.id, self._manifest_payload(task, strategy, symbols, bars_by_symbol, signals, trades, signal_audits, strategy_logs))
            self.repository.save_signals(task.id, signal_audits)
            self.repository.save_trades(task.id, trades)
            self.repository.save_equity(task.id, equity)
            self.repository.save_result(task.id, metrics)
            self._checkpoint(task_id, 95, "正在确认回测任务状态。")
            self.repository.update_status(task_id, "success")
            self.system_service.finish_task_if_active(task_id, "success", 100, "回测完成。", "\n".join(report_lines), finished=True)
        except (TaskCancelledError, StrategyExecutionCancelled):
            self.repository.add_log(task.id, "warning", "回测任务已取消，停止写入后续结果。", "task_cancelled=true")
            self.repository.update_status(task_id, "cancelled")
        except Exception as exc:
            if not self.system_repository.is_task_cancelled(task_id):
                traceback_detail = traceback.format_exc()
                if isinstance(exc, BacktestError):
                    detail = json.dumps(
                        {
                            "code": exc.code,
                            "message": exc.message,
                            "detail": exc.detail,
                            "suggestion": exc.suggestion,
                            "traceback": traceback_detail,
                        },
                        ensure_ascii=False,
                    )
                    message = exc.message
                else:
                    detail = traceback_detail
                    message = "回测失败。"
                self.repository.add_log(task.id, "error", message, detail)
                self.repository.update_status(task_id, "failed")
                self.system_service.finish_task_if_active(task_id, "failed", 100, message, detail, finished=True)
                if isinstance(exc, BacktestError):
                    return

    def list_tasks(self, query: PageQuery) -> PageResult[BacktestTaskRecord]:
        return self.repository.list_tasks(query)

    def get_task(self, task_id: str) -> BacktestTaskRecord:
        try:
            return self.repository.get_task(task_id)
        except KeyError as exc:
            raise BacktestError("回测任务不存在。", "BACKTEST_NOT_FOUND", str(exc), "请刷新回测列表后重试。", status_code=404) from exc

    def delete_task(self, task_id: str) -> None:
        self.get_task(task_id)
        self.repository.delete_task(task_id)
        self.system_repository.add_operation_log("回测研究", "删除回测", "backtest_task", task_id, "成功", "已删除回测任务和结果。")

    def cancel_task(self, task_id: str) -> BacktestTaskRecord:
        task = self.get_task(task_id)
        if task.status == "running":
            SystemService().cancel_task(task_id)
            self.repository.add_log(task.id, "warning", "已请求取消回测任务。")
            self.system_repository.add_operation_log("回测研究", "取消回测", "backtest_task", task_id, "成功", "已请求取消回测任务。")
        return self.repository.get_task(task_id)

    def rerun(self, task_id: str) -> TaskCreated:
        task = self.get_task(task_id)
        raise BacktestError(
            "历史任务直接复跑已停用，避免沿用旧日期造成回测区间误判。",
            "BACKTEST_RERUN_DISABLED",
            f"task_id={task_id}; historical_range={task.start_date}~{task.end_date}",
            "请在页面点击“复用参数”，确认开始日期和结束日期后，再点击“开始回测”。",
        )
        return self.create_backtest(request)

    def result(self, task_id: str) -> BacktestResultRecord | None:
        self.get_task(task_id)
        return self.repository.get_result(task_id)

    def equity(self, task_id: str, max_points: int = 2000) -> list[BacktestEquityRecord]:
        self.get_task(task_id)
        return self.repository.list_equity(task_id, max_points=max_points)

    def drawdown(self, task_id: str, max_points: int = 2000) -> list[BacktestEquityRecord]:
        self.get_task(task_id)
        return self.repository.list_equity(task_id, max_points=max_points)

    def trades(self, task_id: str, query: PageQuery) -> PageResult[BacktestTradeRecord]:
        self.get_task(task_id)
        return self.repository.list_trades(task_id, query)

    def signals(self, task_id: str, query: PageQuery) -> PageResult[BacktestSignalRecord]:
        self.get_task(task_id)
        return self.repository.list_signals(task_id, query)

    def logs(self, task_id: str, query: PageQuery) -> PageResult[BacktestLogRecord]:
        self.get_task(task_id)
        return self.repository.list_logs(task_id, query)

    def report(self, task_id: str) -> BacktestReport:
        self.get_task(task_id)
        task = self.repository.get_task(task_id)
        manifest = self.repository.get_manifest(task_id)
        return BacktestReport(
            task=task,
            result=self.repository.get_result(task_id),
            manifest=manifest,
            strategy_snapshot_check=self.repository.get_strategy_snapshot_check(task, manifest),
            trades=self.repository.list_trades(task_id, PageQuery(page=1, page_size=200)).items,
            signals=self.repository.list_signals(task_id, PageQuery(page=1, page_size=200)).items,
            equity=self.repository.list_equity(task_id, max_points=2000),
            logs=self.repository.list_logs(task_id, PageQuery(page=1, page_size=200)).items,
        )

    def export_workbook(self, task_id: str) -> Path:
        task = self.get_task(task_id)
        result = self.repository.get_result(task_id)
        manifest = self.repository.get_manifest(task_id)
        snapshot_check = self.repository.get_strategy_snapshot_check(task, manifest)
        trades = self.repository.list_all_trades(task_id)
        signals = self.repository.list_all_signals(task_id)
        equity = self.repository.list_all_equity(task_id)
        logs = self.repository.list_all_logs(task_id)

        export_dir = settings.backups_dir / "exports"
        timestamp = re.sub(r"\D", "", now_text())[:14]
        safe_task_id = re.sub(r"[^A-Za-z0-9_-]", "_", task.task_id)
        path = export_dir / f"backtest_{safe_task_id}_完整记录_{timestamp}.xlsx"
        write_xlsx(
            path,
            [
                ("回测汇总", ["分类", "字段", "值"], self._summary_rows(task, result, manifest, trades, signals, logs)),
                ("成交明细", ["成交时间", "股票代码", "股票名称", "方向", "价格", "数量", "成交金额", "费用", "盈亏", "原因"], [
                    [row.trade_time, row.symbol, row.name, row.side, row.price, row.quantity, row.amount, row.fee, row.pnl, row.reason]
                    for row in trades
                ]),
                ("信号审计", ["信号时间", "股票代码", "股票名称", "动作", "价格", "金额", "状态", "成交时间", "成交价格", "数量", "是否自动卖出", "跳过原因", "触发原因"], [
                    [
                        row.signal_time, row.symbol, row.name, row.action, row.price, row.amount, row.status,
                        row.execution_time, row.execution_price, row.quantity, row.is_auto_exit, row.skip_reason, row.reason,
                    ]
                    for row in signals
                ]),
                ("资金曲线", ["日期", "权益", "现金", "持仓市值", "回撤"], [
                    [row.trade_date, row.equity, row.cash, row.market_value, row.drawdown]
                    for row in equity
                ]),
                ("回撤曲线", ["日期", "回撤", "权益"], [
                    [row.trade_date, row.drawdown, row.equity]
                    for row in equity
                ]),
                ("回测日志", ["时间", "级别", "中文说明", "技术详情"], [
                    [row.created_at, row.level, row.message, row.technical_detail]
                    for row in logs
                ]),
                ("可信快照", ["字段", "值"], self._manifest_rows(manifest, snapshot_check)),
                ("运行参数", ["分类", "字段", "值"], self._run_parameter_rows(task, manifest, snapshot_check)),
                ("数据覆盖快照", ["数据类型", "股票", "周期", "请求开始", "请求结束", "覆盖开始", "覆盖结束", "状态", "覆盖率", "预期单位", "实际单位", "重复行", "匹配方式", "缺失日期"], self._coverage_snapshot_rows(manifest)),
                ("股票池摘要", ["字段", "值"], self._json_key_value_rows(manifest.universe_summary if manifest else None)),
                ("规则快照", ["字段", "值"], self._json_key_value_rows(manifest.rule_snapshot if manifest else None)),
            ],
        )
        self.system_repository.add_operation_log(
            "回测研究",
            "导出回测记录",
            "export_file",
            path.name,
            "成功",
            f"已导出回测完整记录：{task.backtest_name}。",
            json.dumps(
                {
                    "task_id": task.task_id,
                    "backtest_name": task.backtest_name,
                    "strategy_name": task.strategy_name,
                    "start_date": task.start_date,
                    "end_date": task.end_date,
                    "data_frequency": task.data_frequency,
                    "file_path": str(path),
                    "trade_count": len(trades),
                    "signal_count": len(signals),
                    "equity_count": len(equity),
                    "log_count": len(logs),
                    "strategy_snapshot_check": snapshot_check.status,
                    "workbook_sheets": [
                        "回测汇总",
                        "成交明细",
                        "信号审计",
                        "资金曲线",
                        "回撤曲线",
                        "回测日志",
                        "可信快照",
                        "运行参数",
                        "数据覆盖快照",
                        "股票池摘要",
                        "规则快照",
                    ],
                },
                ensure_ascii=False,
            ),
        )
        return path

    def _summary_rows(
        self,
        task: BacktestTaskRecord,
        result: BacktestResultRecord | None,
        manifest,
        trades: list[BacktestTradeRecord],
        signals: list[BacktestSignalRecord],
        logs: list[BacktestLogRecord],
    ) -> list[list[Any]]:
        rows: list[list[Any]] = [
            ["任务", "任务ID", task.task_id],
            ["任务", "回测名称", task.backtest_name],
            ["任务", "策略名称", task.strategy_name],
            ["任务", "回测区间", f"{task.start_date} ~ {task.end_date}"],
            ["任务", "数据频率", task.data_frequency],
            ["任务", "成交模式", task.fill_mode],
            ["任务", "状态", task.status],
            ["资金", "初始资金", task.initial_cash],
            ["资金", "单笔下单金额", task.single_order_amount],
            ["费用", "手续费率", task.fee_rate],
            ["费用", "印花税率", task.stamp_tax_rate],
            ["费用", "滑点", task.slippage],
            ["明细", "成交明细条数", len(trades)],
            ["明细", "信号审计条数", len(signals)],
            ["明细", "日志条数", len(logs)],
        ]
        if result:
            rows.extend([
                ["结果", "总收益率", result.total_return],
                ["结果", "年化收益率", result.annual_return],
                ["结果", "最大回撤", result.max_drawdown],
                ["结果", "胜率", result.win_rate],
                ["结果", "成交次数", result.trade_count],
                ["结果", "买入次数", result.buy_count],
                ["结果", "卖出次数", result.sell_count],
                ["结果", "盈亏比", result.profit_loss_ratio],
                ["结果", "平均持仓天数", result.average_holding_days],
                ["结果", "期末现金", result.ending_cash],
                ["结果", "未平仓数量", result.open_position_count],
                ["结果", "未平仓市值", result.open_market_value],
                ["结果", "总费用", result.total_fee],
                ["结果", "已实现盈亏", result.realized_pnl],
                ["结果", "最终权益", result.final_cash],
                ["结果", "结果生成时间", result.created_at],
            ])
        if manifest:
            snapshot_check = self.repository.get_strategy_snapshot_check(task, manifest)
            rows.extend([
                ["可信", "可信等级", manifest.trust_level],
                ["可信", "可信说明", manifest.trust_message],
                ["可信", "引擎版本", manifest.engine_version],
                ["可信", "QMT模式", manifest.qmt_mode],
                ["可信", "策略运行核对", snapshot_check.message],
            ])
        return rows

    def _manifest_rows(self, manifest, snapshot_check=None) -> list[list[Any]]:
        if not manifest:
            return [["说明", "当前回测没有可信快照记录"]]
        rows = [
            ["策略文件", manifest.strategy_file_name],
            ["策略代码哈希", manifest.strategy_code_hash],
            ["策略名称", manifest.strategy_name],
            ["策略版本", manifest.strategy_version],
            ["数据频率", manifest.data_frequency],
            ["成交模式", manifest.fill_mode],
            ["QMT模式", manifest.qmt_mode],
            ["QMT路径", manifest.qmt_path],
            ["账户ID", manifest.account_id],
            ["数据覆盖快照", manifest.data_coverage_snapshot],
            ["股票池摘要", manifest.universe_summary],
            ["规则快照", manifest.rule_snapshot],
            ["引擎版本", manifest.engine_version],
            ["可信等级", manifest.trust_level],
            ["可信说明", manifest.trust_message],
            ["生成时间", manifest.created_at],
        ]
        if snapshot_check:
            rows.extend([
                ["策略运行核对状态", snapshot_check.status],
                ["策略运行核对说明", snapshot_check.message],
                ["匹配运行ID", snapshot_check.matched_run_id or ""],
                ["匹配任务ID", snapshot_check.matched_task_id or ""],
                ["最新运行ID", snapshot_check.latest_run_id or ""],
                ["最新运行代码哈希", snapshot_check.latest_code_hash or ""],
                ["最新运行策略文件", snapshot_check.latest_strategy_file_name or ""],
                ["最新运行策略版本", snapshot_check.latest_strategy_version or ""],
                ["策略运行核对技术详情", snapshot_check.technical_detail or ""],
            ])
        return rows

    def _run_parameter_rows(self, task: BacktestTaskRecord, manifest, snapshot_check=None) -> list[list[Any]]:
        rows: list[list[Any]] = [
            ["任务", "任务ID", task.task_id],
            ["任务", "回测名称", task.backtest_name],
            ["任务", "策略ID", task.strategy_id],
            ["任务", "策略名称", task.strategy_name],
            ["任务", "开始日期", task.start_date],
            ["任务", "结束日期", task.end_date],
            ["任务", "状态", task.status],
            ["数据", "数据频率", task.data_frequency],
            ["成交", "成交模式", task.fill_mode],
            ["资金", "初始资金", task.initial_cash],
            ["资金", "单笔下单金额", task.single_order_amount],
            ["费用", "手续费率", task.fee_rate],
            ["费用", "印花税率", task.stamp_tax_rate],
            ["费用", "滑点", task.slippage],
        ]
        if manifest:
            rows.extend([
                ["可信", "策略文件", manifest.strategy_file_name],
                ["可信", "策略代码哈希", manifest.strategy_code_hash],
                ["可信", "策略版本", manifest.strategy_version],
                ["可信", "QMT模式", manifest.qmt_mode],
                ["可信", "账户ID", manifest.account_id],
                ["可信", "引擎版本", manifest.engine_version],
                ["可信", "可信等级", manifest.trust_level],
                ["可信", "可信说明", manifest.trust_message],
                ["可信", "快照生成时间", manifest.created_at],
            ])
        if snapshot_check:
            rows.extend([
                ["策略运行核对", "状态", snapshot_check.status],
                ["策略运行核对", "说明", snapshot_check.message],
                ["策略运行核对", "匹配任务ID", snapshot_check.matched_task_id or ""],
                ["策略运行核对", "最新任务ID", snapshot_check.latest_task_id or ""],
            ])
        return rows

    def _coverage_snapshot_rows(self, manifest) -> list[list[Any]]:
        rows: list[list[Any]] = []
        snapshot = self._json_value(manifest.data_coverage_snapshot if manifest else None, [])
        if not isinstance(snapshot, list):
            return rows
        for item in snapshot:
            if not isinstance(item, dict):
                continue
            rows.append([
                item.get("data_type", ""),
                item.get("symbol", ""),
                item.get("period", ""),
                item.get("requested_start_date", ""),
                item.get("requested_end_date", ""),
                item.get("start_date", ""),
                item.get("end_date", ""),
                item.get("status", ""),
                item.get("coverage_rate", ""),
                item.get("expected_rows", ""),
                item.get("actual_rows", ""),
                item.get("duplicate_rows", ""),
                item.get("matched_by", ""),
                item.get("missing_days", ""),
            ])
        return rows

    def _json_key_value_rows(self, raw_json: str | None) -> list[list[Any]]:
        payload = self._json_value(raw_json, {})
        if not isinstance(payload, dict):
            return [["说明", "无结构化快照"]]
        rows: list[list[Any]] = []
        for key in sorted(payload):
            value = payload[key]
            if isinstance(value, (dict, list)):
                rows.append([key, json.dumps(value, ensure_ascii=False)])
            else:
                rows.append([key, value])
        return rows

    def _json_value(self, raw_json: str | None, fallback: Any) -> Any:
        if not raw_json:
            return fallback
        try:
            return json.loads(raw_json)
        except json.JSONDecodeError:
            return fallback

    def _strategy_requires_minute_bars(self, strategy_path: str) -> bool:
        code = Path(strategy_path).read_text(encoding="utf-8")
        return re.search(r"\b(get_minute_bars|get_latest_minute_trade_date|find_minute_amount_triggers)\s*\(", code) is not None

    def _extract_strategy_params(self, strategy_path: str) -> dict[str, object]:
        try:
            tree = ast.parse(Path(strategy_path).read_text(encoding="utf-8"))
        except SyntaxError:
            return {}
        strategy_class = next((node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "Strategy"), None)
        if strategy_class is None:
            return {}
        for node in strategy_class.body:
            if not isinstance(node, ast.Assign):
                continue
            if not any(isinstance(target, ast.Name) and target.id == "params" for target in node.targets):
                continue
            try:
                value = ast.literal_eval(node.value)
            except (ValueError, SyntaxError):
                return {}
            return value if isinstance(value, dict) else {}
        return {}

    def _normalize_clock_text(self, value: object) -> str | None:
        text = str(value or "").strip()
        if not text:
            return None
        if re.fullmatch(r"\d{1,2}:\d{2}", text):
            text = f"{text}:00"
        if not re.fullmatch(r"\d{1,2}:\d{2}:\d{2}", text):
            return None
        hour, minute, second = [int(part) for part in text.split(":")]
        if hour > 23 or minute > 59 or second > 59:
            return None
        return f"{hour:02d}:{minute:02d}:{second:02d}"

    def _clock_to_seconds(self, value: str) -> int:
        hour, minute, second = [int(part) for part in value.split(":")]
        return hour * 3600 + minute * 60 + second

    def _expected_minute_bars_in_window(self, start_clock: str, end_clock: str) -> int:
        start_seconds = self._clock_to_seconds(start_clock)
        end_seconds = self._clock_to_seconds(end_clock)
        if end_seconds < start_seconds:
            return 0
        return int((end_seconds - start_seconds) // 60) + 1

    def _minute_required_windows(self, params: dict[str, object]) -> list[dict[str, str]]:
        windows: list[dict[str, str]] = []
        start_clock = self._normalize_clock_text(params.get("start_time"))
        end_clock = (
            self._normalize_clock_text(params.get("end_time"))
            or self._normalize_clock_text(params.get("trigger_end_time"))
            or self._normalize_clock_text(params.get("confirm_end"))
        )
        if start_clock and end_clock:
            windows.append({"label": "策略买入扫描窗口", "start": start_clock, "end": end_clock})
        baseline_start_clock = self._normalize_clock_text(params.get("baseline_start_time"))
        if baseline_start_clock and end_clock:
            windows.append({"label": "买入前基准窗口", "start": baseline_start_clock, "end": end_clock})
        signal_clock = self._normalize_clock_text(params.get("signal_time"))
        if signal_clock:
            signal_start = baseline_start_clock or self._normalize_clock_text(params.get("confirm_start")) or "09:30:00"
            windows.append({"label": "信号确认窗口", "start": signal_start, "end": signal_clock})
        confirm_end_clock = self._normalize_clock_text(params.get("confirm_end"))
        if confirm_end_clock and not start_clock:
            confirm_start = self._normalize_clock_text(params.get("confirm_start")) or baseline_start_clock or "09:30:00"
            windows.append({"label": "确认窗口", "start": confirm_start, "end": confirm_end_clock})
        for key, label in [
            ("fallback_exit_time", "兜底卖出窗口"),
            ("exit_time", "卖出窗口"),
            ("sell_time", "卖出窗口"),
        ]:
            clock = self._normalize_clock_text(params.get(key))
            if clock:
                windows.append({"label": label, "start": clock, "end": clock})
        unique: list[dict[str, str]] = []
        seen: set[tuple[str, str, str]] = set()
        for window in windows:
            key = (window["label"], window["start"], window["end"])
            if key not in seen:
                seen.add(key)
                unique.append(window)
        return unique

    def _minute_window_validation_steps(
        self,
        request: BacktestDataCheckRequest,
        params: dict[str, object],
        minute_coverage: object | None,
    ) -> tuple[list[BacktestValidationStep], str | None]:
        windows = self._minute_required_windows(params)
        if not windows:
            return [
                BacktestValidationStep(
                    title="分钟关键窗口",
                    status="warning",
                    message="当前策略未在 params 中声明 start_time/end_time/fallback_exit_time，系统只能按全区间分钟K覆盖率核验。",
                    technical_detail=json.dumps({"minute_window_declared": False, "params_keys": sorted(str(key) for key in params.keys())}, ensure_ascii=False),
                )
            ], None
        expected_units = self.repository.expected_minute_symbol_days(request.start_date, request.end_date)
        expected_units_source = "requested_range_daily_tradable_symbol_days"
        if expected_units <= 0 and minute_coverage is not None:
            expected_units = int(getattr(minute_coverage, "expected_rows", 0) or 0)
            expected_units_source = "coverage_record_fallback"
        steps: list[BacktestValidationStep] = []
        failed_windows: list[dict[str, object]] = []
        valid_windows: list[dict[str, object]] = []
        valid_expected_bars: dict[str, int] = {}
        for window in windows:
            expected_bars = self._expected_minute_bars_in_window(window["start"], window["end"])
            if expected_bars <= 0:
                detail = {
                    "window_label": window["label"],
                    "start_time": window["start"],
                    "end_time": window["end"],
                    "error": "end_time_before_start_time",
                }
                failed_windows.append(detail)
                steps.append(
                    BacktestValidationStep(
                        title=f"分钟窗口-{window['label']}",
                        status="failed",
                        message=f"{window['label']} 的结束时间早于开始时间，无法做可信分钟回测。",
                        technical_detail=json.dumps(detail, ensure_ascii=False),
                    )
                )
                continue
            key = f"window_{len(valid_windows)}"
            valid_windows.append(
                {
                    "key": key,
                    "label": window["label"],
                    "start": window["start"],
                    "end": window["end"],
                    "expected_bars_per_unit": expected_bars,
                }
            )
            valid_expected_bars[key] = expected_bars

        window_stats = self.repository.minute_windows_coverage_stats(
            request.start_date,
            request.end_date,
            valid_windows,
            "1m",
        )
        for window in valid_windows:
            key = str(window["key"])
            label = str(window["label"])
            stats = window_stats.get(
                key,
                {
                    "minute_rows": 0,
                    "symbols": 0,
                    "trading_days": 0,
                    "covered_units": 0,
                    "complete_units": 0,
                    "incomplete_units": 0,
                    "min_bars_per_unit": 0,
                    "max_bars_per_unit": 0,
                    "expected_bars_per_unit": valid_expected_bars[key],
                },
            )
            expected_bars_per_unit = stats["expected_bars_per_unit"]
            covered_units = stats["covered_units"]
            complete_units = stats["complete_units"]
            coverage_rate = None
            if isinstance(expected_units, int) and expected_units > 0:
                display_expected_units = max(expected_units, complete_units)
                coverage_rate = round(min(complete_units / display_expected_units * 100, 100), 2)
                status = "success" if complete_units >= expected_units else "failed"
                message = (
                    f"{label} {window['start']}~{window['end']} 完整覆盖 "
                    f"{complete_units}/{display_expected_units} 个股票-交易日；每单元预期 {expected_bars_per_unit} 根1分钟K，"
                    f"实际覆盖 {covered_units} 个单元，分钟行 {stats['minute_rows']}。"
                )
            else:
                display_expected_units = expected_units
                status = "success" if complete_units > 0 else "failed"
                message = (
                    f"{label} {window['start']}~{window['end']} 找到 "
                    f"{complete_units} 个完整股票-交易日，分钟行 {stats['minute_rows']}；未找到预期覆盖单位，只能做窗口完整性存在核验。"
                )
            detail = {
                "window_label": label,
                "start_time": window["start"],
                "end_time": window["end"],
                "covered_symbol_days": covered_units,
                "complete_symbol_days": complete_units,
                "incomplete_symbol_days": stats["incomplete_units"],
                "expected_symbol_days": display_expected_units,
                "raw_expected_symbol_days": expected_units,
                "expected_symbol_days_source": expected_units_source,
                "expected_bars_per_symbol_day": expected_bars_per_unit,
                "min_bars_per_symbol_day": stats["min_bars_per_unit"],
                "max_bars_per_symbol_day": stats["max_bars_per_unit"],
                "coverage_rate": coverage_rate,
                "minute_rows": stats["minute_rows"],
                "symbols": stats["symbols"],
                "trading_days": stats["trading_days"],
                "coverage_unit": "股票-交易日",
            }
            if status == "failed":
                failed_windows.append(detail)
            steps.append(
                BacktestValidationStep(
                    title=f"分钟窗口-{label}",
                    status=status,
                    message=message,
                    technical_detail=json.dumps(detail, ensure_ascii=False),
                )
            )
        if not failed_windows:
            return steps, None
        return steps, json.dumps({"failed_minute_windows": failed_windows, "requested_range": f"{request.start_date}~{request.end_date}"}, ensure_ascii=False)

    def _minute_full_day_bar_baseline_step(
        self,
        request: BacktestDataCheckRequest,
        minute_coverage: object | None,
    ) -> BacktestValidationStep:
        expected_units = self.repository.expected_minute_symbol_days(request.start_date, request.end_date)
        expected_units_source = "requested_range_daily_tradable_symbol_days"
        if expected_units <= 0 and minute_coverage is not None:
            expected_units = int(getattr(minute_coverage, "expected_rows", 0) or 0)
            expected_units_source = "coverage_record_fallback"
        if minute_coverage is not None and getattr(minute_coverage, "status", "") == "complete":
            coverage_expected = int(getattr(minute_coverage, "expected_rows", 0) or 0)
            coverage_actual = int(getattr(minute_coverage, "actual_rows", 0) or 0)
            detail = {
                "baseline": "a_share_regular_session_1m",
                "check_level": "coverage_record_fast_path",
                "requested_range": f"{request.start_date}~{request.end_date}",
                "coverage_range": f"{getattr(minute_coverage, 'start_date', '')}~{getattr(minute_coverage, 'end_date', '')}",
                "coverage_status": getattr(minute_coverage, "status", ""),
                "coverage_rate": getattr(minute_coverage, "coverage_rate", None),
                "coverage_expected_symbol_days": coverage_expected,
                "coverage_actual_symbol_days": coverage_actual,
                "expected_symbol_days": expected_units,
                "expected_symbol_days_source": expected_units_source,
                "minimum_expected_bars_per_symbol_day": 240,
                "note": "数据中心已有覆盖当前区间的分钟K complete 覆盖率记录，回测前检查不再同步重复扫描全日分钟K；策略关键时间窗口仍在前置检查中强校验。",
            }
            status = "success" if expected_units <= 0 or coverage_actual >= expected_units else "warning"
            if status == "success":
                message = (
                    "全日分钟K基线通过：已使用数据中心 complete 覆盖率记录验收，"
                    f"覆盖记录 {coverage_actual}/{coverage_expected} 个股票-交易日；策略关键窗口已单独强校验。"
                )
            else:
                message = (
                    "全日分钟K基线需核对：覆盖率记录为 complete，但覆盖单位少于本次回测区间预期；"
                    "策略关键窗口已单独强校验，正式回测前建议重新执行数据中心覆盖率检查。"
                )
            return BacktestValidationStep(
                title="全日分钟K基线",
                status=status,
                message=message,
                technical_detail=json.dumps(detail, ensure_ascii=False),
            )

        stats = self.repository.minute_full_day_bar_baseline_stats(request.start_date, request.end_date, "1m", 240)
        complete_units = int(stats["complete_units"])
        covered_units = int(stats["covered_units"])
        min_bars = int(stats["min_bars_per_unit"])
        max_bars = int(stats["max_bars_per_unit"])
        expected_bars = int(stats["minimum_expected_bars_per_unit"])
        detail = {
            "baseline": "a_share_regular_session_1m",
            "check_level": "warning_only",
            "requested_range": f"{request.start_date}~{request.end_date}",
            "session_scope": stats["session_scope"],
            "minimum_expected_bars_per_symbol_day": expected_bars,
            "covered_symbol_days": covered_units,
            "complete_symbol_days": complete_units,
            "incomplete_symbol_days": stats["incomplete_units"],
            "expected_symbol_days": expected_units,
            "expected_symbol_days_source": expected_units_source,
            "minute_rows": stats["minute_rows"],
            "symbols": stats["symbols"],
            "trading_days": stats["trading_days"],
            "min_bars_per_symbol_day": min_bars,
            "max_bars_per_symbol_day": max_bars,
            "note": "该项用于提示全日分钟K完整性，不替代策略关键窗口强校验；不同行情源可能存在 240/241/242 根标记差异。",
        }
        if isinstance(expected_units, int) and expected_units > 0:
            if complete_units >= expected_units:
                status = "success"
                message = (
                    f"全日分钟K基线通过：完整股票-交易日 {complete_units}/{expected_units}，"
                    f"每单元至少 {expected_bars} 根1分钟K，实际范围 {min_bars}~{max_bars}。"
                )
            else:
                status = "warning"
                message = (
                    f"全日分钟K基线需核对：完整股票-交易日 {complete_units}/{expected_units}，"
                    f"每单元至少 {expected_bars} 根1分钟K，实际范围 {min_bars}~{max_bars}。"
                )
        elif complete_units > 0:
            status = "warning"
            message = (
                f"全日分钟K基线可技术核对：找到 {complete_units} 个完整股票-交易日，"
                f"但缺少覆盖率预期单位；每单元至少 {expected_bars} 根1分钟K。"
            )
        else:
            status = "warning"
            message = (
                f"全日分钟K基线需核对：未找到达到 {expected_bars} 根1分钟K的股票-交易日；"
                "策略关键窗口已单独校验，正式结论前建议补齐全日分钟K。"
            )
        return BacktestValidationStep(
            title="全日分钟K基线",
            status=status,
            message=message,
            technical_detail=json.dumps(detail, ensure_ascii=False),
        )

    def _checkpoint(self, task_id: str, progress: int, message: str, technical_detail: str | None = None) -> None:
        task = self.repository.get_task(task_id)
        if task.status == "cancelled" or self.system_repository.is_task_cancelled(task_id):
            raise TaskCancelledError("回测任务已取消。", "BACKTEST_CANCELLED", task_id)
        self.system_service.finish_task_if_active(task_id, "running", progress, message, technical_detail)

    def _progress_detail(self, stage: str, **payload: object) -> str:
        return json.dumps({"stage": stage, **payload}, ensure_ascii=False)

    def _minute_scan_checkpoint(self, task_id: str, day_index: int, total_days: int, current_date: str, event: dict[str, object]) -> None:
        if not event:
            return
        total_chunks = max(int(event.get("total_chunks") or 1), 1)
        chunk_index = min(max(int(event.get("chunk_index") or 1), 1), total_chunks)
        day_fraction = (day_index - 1 + chunk_index / total_chunks) / max(total_days, 1)
        progress = min(44, 30 + int(day_fraction * 15))
        stage = str(event.get("stage") or "")
        if stage == "minute_scan_stats":
            stage_label = "统计分钟K覆盖"
        elif stage == "minute_replay_scan":
            stage_label = "逐分钟回放扫描"
        else:
            stage_label = "扫描分钟触发"
        scanned_symbols = int(event.get("scanned_symbols") or 0)
        candidate_symbols = int(event.get("candidate_symbols") or 0)
        minute_rows = int(event.get("minute_rows") or 0)
        triggers = int(event.get("triggers_returned") or 0)
        message = (
            f"正在{stage_label}：交易日 {current_date}（{day_index}/{total_days}），"
            f"股票批次 {chunk_index}/{total_chunks}，已扫 {scanned_symbols}/{candidate_symbols} 只，"
            f"分钟K {minute_rows} 行，触发 {triggers} 条。"
        )
        detail = {
            "stage": stage or "minute_scan",
            "processed_days": day_index,
            "total_days": total_days,
            "current_date": current_date,
            **event,
            "progress_range": "30-45",
        }
        self._checkpoint(task_id, progress, message, json.dumps(detail, ensure_ascii=False))

    def _minute_scan_entries(self, strategy_logs: list[str] | None) -> list[dict[str, object]]:
        entries: list[dict[str, object]] = []
        for line in strategy_logs or []:
            if not line.startswith(MINUTE_SCAN_DIAGNOSTIC_PREFIX):
                continue
            try:
                payload = json.loads(line[len(MINUTE_SCAN_DIAGNOSTIC_PREFIX) :])
            except json.JSONDecodeError:
                continue
            if isinstance(payload, dict):
                entries.append(payload)
        return entries

    def _minute_scan_summary(self, strategy_logs: list[str] | None) -> dict[str, object]:
        entries = self._minute_scan_entries(strategy_logs)
        if not entries:
            return {}
        limit_hit_dates = [str(entry.get("trade_date")) for entry in entries if entry.get("limit_hit")]
        candidate_symbols = max(int(entry.get("candidate_symbols") or 0) for entry in entries)
        symbols_with_minute_rows = max(int(entry.get("symbols_with_minute_rows") or 0) for entry in entries)
        return {
            "mode": "minute_replay" if any(str(entry.get("mode")) == "minute_replay" for entry in entries) else "legacy_non_replay",
            "scanned_trade_days": len(entries),
            "first_trade_date": str(entries[0].get("trade_date") or ""),
            "last_trade_date": str(entries[-1].get("trade_date") or ""),
            "candidate_symbols": candidate_symbols,
            "symbols_with_minute_rows": symbols_with_minute_rows,
            "minute_rows": sum(int(entry.get("minute_rows") or 0) for entry in entries),
            "triggers_returned": sum(int(entry.get("triggers_returned") or 0) for entry in entries),
            "return_limit": max(int(entry.get("return_limit") or 0) for entry in entries),
            "limit_hit_days": len(limit_hit_dates),
            "limit_hit_dates": limit_hit_dates[:20],
            "possible_truncation": bool(limit_hit_dates),
        }

    def _minute_scan_summary_message(self, summary: dict[str, object]) -> str:
        if not summary:
            return ""
        suffix = "；存在达到返回上限的交易日，信号可能被截断。" if summary.get("possible_truncation") else "；未发现达到返回上限的交易日。"
        mode_label = "正式分钟回放" if summary.get("mode") == "minute_replay" else "历史非正式分钟模式"
        return (
            f"{mode_label}汇总：扫描 {summary.get('scanned_trade_days')} 个交易日，候选股票 {summary.get('candidate_symbols')} 只，"
            f"窗口内分钟K {summary.get('minute_rows')} 行，返回触发 {summary.get('triggers_returned')} 条{suffix}"
        )

    def _minute_scan_audit_lines(self, summary: dict[str, object]) -> list[str]:
        if not summary:
            return []
        lines = [self._minute_scan_summary_message(summary)]
        if summary.get("possible_truncation"):
            lines.append(f"分钟K扫描风险：{summary.get('limit_hit_days')} 个交易日触达 return_limit={summary.get('return_limit')}，请提高策略 max_signals 或分批复核后再作为正式结论。")
        return lines

    def _base_validation_steps(self, request: BacktestDataCheckRequest, strategy_path: str) -> list[BacktestValidationStep]:
        config = self.system_service.get_config()
        source_status = "warning" if config.simulation_mode else "success"
        source_message = (
            "当前为测试隔离数据源；只能用于自动化回归或排障，不能作为真实 QMT 官方数据验收。"
            if config.simulation_mode
            else "当前系统配置为真实 QMT 模式；回测仍只读取已落 SQLite 的行情，不会调用真实下单接口。"
        )
        return [
            BacktestValidationStep(
                title="数据源模式",
                status=source_status,
                message=source_message,
                technical_detail=f"simulation_mode={config.simulation_mode}; qmt_path={config.qmt_path}; account_id={config.account_id}",
            ),
            BacktestValidationStep(
                title="策略接口",
                status="success",
                message="策略文件可读取；回测会通过 StrategyContext 受控读取数据。",
                technical_detail=f"strategy_path={strategy_path}; requires_minute={self._strategy_requires_minute_bars(strategy_path)}",
            ),
            BacktestValidationStep(
                title="回测区间",
                status="success" if request.start_date <= request.end_date else "failed",
                message=f"{request.start_date} ~ {request.end_date}",
            ),
        ]

    def _row_count_step(self, title: str, count: int, table_name: str, start_date: str, end_date: str) -> BacktestValidationStep:
        return BacktestValidationStep(
            title=title,
            status="success" if count > 0 else "failed",
            message=f"本地 SQLite {table_name} 在 {start_date} ~ {end_date} 范围内共有 {count} 行。",
            technical_detail=f"table={table_name}; rows={count}; range={start_date}~{end_date}",
        )

    def _coverage_steps(self, request: BacktestDataCheckRequest, include_minute: bool) -> list[BacktestValidationStep]:
        checks = [("daily_kline", "ALL", "1d", "日K覆盖率")]
        if include_minute:
            checks.append(("minute_kline", "ALL", "1m", "分钟K覆盖率"))
        steps: list[BacktestValidationStep] = []
        for data_type, symbol, period, title in checks:
            coverage = self.data_center_repository.get_coverage_record_covering(data_type, symbol, period, request.start_date, request.end_date)
            if coverage is None:
                steps.append(
                    BacktestValidationStep(
                        title=title,
                        status="warning",
                        message="尚未找到完全匹配的覆盖率记录；可以技术回测，但正式验收前建议先在数据中心执行覆盖率检查。",
                        technical_detail=f"data_type={data_type}; symbol={symbol}; period={period}; range={request.start_date}~{request.end_date}",
                    )
                )
                continue
            status = "success" if coverage.status == "complete" else "warning" if coverage.status == "partial" else "failed"
            matched_note = "" if coverage.start_date == request.start_date and coverage.end_date == request.end_date else f"；使用覆盖当前区间的大区间记录 {coverage.start_date}~{coverage.end_date}"
            steps.append(
                BacktestValidationStep(
                    title=title,
                    status=status,
                    message=f"覆盖率 {coverage.coverage_rate:.2f}%，状态 {coverage.status}，实际交易日 {coverage.actual_trading_days}/{coverage.expected_trading_days}{matched_note}。",
                    technical_detail=json.dumps({"requested_range": f"{request.start_date}~{request.end_date}", **coverage.model_dump()}, ensure_ascii=False),
                )
            )
        return steps

    def _official_path_start_logs(
        self,
        task: BacktestTaskRecord,
        strategy_name: str,
        symbols: list[str],
        bars_by_symbol: dict[str, list],
    ) -> list[tuple[str, str, str | None]]:
        config = self.system_service.get_config()
        source_label = "真实 QMT 模式" if not config.simulation_mode else "测试隔离模式"
        daily_bar_count = sum(len(rows) for rows in bars_by_symbol.values())
        rows: list[tuple[str, str, str | None]] = [
            (
                "info",
                "官方路径 1/6：数据源确认完成。",
                f"source={source_label}; simulation_mode={config.simulation_mode}; qmt_path={config.qmt_path}; account_id={config.account_id}; real_qmt_order=false",
            ),
            (
                "info",
                "官方路径 2/6：行情已先落 SQLite，再供回测读取。",
                f"strategy={strategy_name}; symbols={len(symbols)}; daily_bars={daily_bar_count}; range={task.start_date}~{task.end_date}; data_frequency={task.data_frequency}",
            ),
            (
                "info",
                "官方路径 3/6：策略按交易日逐步推演，StrategyContext 只暴露当前日期及以前的数据。",
                "future_function_guard=true; strategy_direct_qmt=false; strategy_direct_order=false",
            ),
        ]
        if task.data_frequency == "分钟K":
            rows.append(
                (
                    "info",
                    "分钟K官方路径说明：当前采用正式分钟回放，信号来自本地 1 分钟K逐行推演，买入按下一根 1 分钟K开盘价本地撮合成交。",
                    f"minute_source=sqlite.minute_kline; minute_mode={self._minute_mode(task)}; fill_rule=next_1m_bar_open; qmt_order=false; quick_scan_disabled=true",
                )
            )
        return rows

    def _signal_audit_logs(self, signals: list[dict[str, object]]) -> list[tuple[str, str | None]]:
        if not signals:
            return [("官方路径 4/6：策略逐步推演完成，未生成交易信号。", "signal_count=0")]
        signal_times = sorted(str(signal.get("signal_time") or "") for signal in signals if signal.get("signal_time"))
        return [
            (
                f"官方路径 4/6：策略逐步推演完成，生成 {len(signals)} 条信号。",
                f"signal_count={len(signals)}; first_signal_time={signal_times[0] if signal_times else ''}; last_signal_time={signal_times[-1] if signal_times else ''}",
            )
        ]

    def _trade_audit_logs(self, task: BacktestTaskRecord, trades: list[dict[str, object]]) -> list[tuple[str, str | None]]:
        buy_count = sum(1 for trade in trades if trade.get("side") == "BUY")
        sell_count = sum(1 for trade in trades if trade.get("side") == "SELL")
        return [
            (
                f"官方路径 5/6：本地撮合回测完成，成交 {len(trades)} 笔，其中买入 {buy_count} 笔、卖出 {sell_count} 笔。",
                f"fill_mode={task.fill_mode}; data_frequency={task.data_frequency}; lot_size=100; t_plus_1=true; fee_rate={task.fee_rate}; stamp_tax_rate={task.stamp_tax_rate}; slippage={task.slippage}",
            )
        ]

    def _reconcile_audit_lines(self, metrics: dict[str, object]) -> list[str]:
        ending_cash = float(metrics.get("ending_cash") or 0)
        open_market_value = float(metrics.get("open_market_value") or 0)
        final_cash = float(metrics.get("final_cash") or 0)
        diff = round(ending_cash + open_market_value - final_cash, 4)
        status = "通过" if abs(diff) < 1 else "异常"
        return [
            f"官方路径 6/6：资金对账{status}，期末现金 + 未平仓市值 - 最终权益 = {diff}。",
        ]

    def _coverage_checked_result(self, request: BacktestDataCheckRequest, data_type: str, period: str, count: int, steps: list[BacktestValidationStep] | None = None) -> BacktestDataCheckResult:
        data_label = "分钟K" if data_type == "minute_kline" else "日K"
        steps = steps or []
        steps.extend(self._coverage_steps(request, include_minute=data_type == "minute_kline"))
        try:
            coverage = self.data_center_repository.get_coverage_record_covering(data_type, "ALL", period, request.start_date, request.end_date)
        except Exception as exc:
            return BacktestDataCheckResult(
                ok=True,
                message=f"{data_label}数据可用，共 {count} 条；覆盖率检查暂不可用。",
                suggestion="建议先到数据中心刷新 2026 覆盖率后再做正式回测。",
                technical_detail=f"coverage_check_error={repr(exc)}",
                steps=steps,
            )
        if coverage is None:
            return BacktestDataCheckResult(
                ok=True,
                message=f"{data_label}数据可用，共 {count} 条；尚未形成覆盖率记录。",
                suggestion="建议先到数据中心执行覆盖率检查或导出缺失清单。",
                steps=steps,
            )
        technical_detail = json.dumps(
            {
                "data_type": data_type,
                "symbol": coverage.symbol,
                "period": coverage.period,
                "start_date": coverage.start_date,
                "end_date": coverage.end_date,
                "expected_rows": coverage.expected_rows,
                "actual_rows": coverage.actual_rows,
                "expected_trading_days": coverage.expected_trading_days,
                "actual_trading_days": coverage.actual_trading_days,
                "missing_days": coverage.missing_days,
                "duplicate_rows": coverage.duplicate_rows,
                "coverage_rate": coverage.coverage_rate,
                "status": coverage.status,
            },
            ensure_ascii=False,
        )
        if coverage.status in {"missing", "failed"}:
            return BacktestDataCheckResult(
                ok=False,
                message=f"{data_label}覆盖率检查未通过，当前状态为{coverage.status}。",
                suggestion="请先到数据中心补齐 2026 数据，或导出缺失清单后按股票和日期小范围重试。",
                technical_detail=technical_detail,
                steps=steps,
            )
        if coverage.status == "partial":
            return BacktestDataCheckResult(
                ok=True,
                message=f"{data_label}数据可用，共 {count} 条；但 2026 覆盖率为 {coverage.coverage_rate:.2f}%，存在缺失。",
                suggestion="可以做技术验证；正式回测前建议先到数据中心导出缺失清单并补齐。",
                technical_detail=technical_detail,
                steps=steps,
            )
        return BacktestDataCheckResult(
            ok=True,
            message=f"{data_label}数据可用，共 {count} 条；2026 覆盖率 {coverage.coverage_rate:.2f}%。",
            technical_detail=technical_detail,
            steps=steps,
        )

    def _manifest_payload(
        self,
        task: BacktestTaskRecord,
        strategy: object,
        symbols: list[str],
        bars_by_symbol: dict[str, list],
        signals: list[dict[str, object]] | None = None,
        trades: list[dict[str, object]] | None = None,
        signal_audits: list[dict[str, object]] | None = None,
        strategy_logs: list[str] | None = None,
    ) -> dict[str, object]:
        config = self.system_service.get_config()
        coverage_snapshot = self._coverage_snapshot(task)
        trust_level, trust_message = self._trust_from_coverage(config.simulation_mode, task, coverage_snapshot)
        strategy_path = Path(strategy.file_path)
        code_bytes = strategy_path.read_bytes()
        daily_bar_count = sum(len(rows) for rows in bars_by_symbol.values())
        strategy_params = self._extract_strategy_params(strategy.file_path)
        minute_scan_summary = self._minute_scan_summary(strategy_logs)
        if task.data_frequency == "分钟K" and minute_scan_summary.get("possible_truncation"):
            trust_level = "technical"
            trust_message = f"{trust_message} 当前策略分钟扫描触达返回上限，可能存在信号截断；正式结论前请提高 max_signals 或分批复核。"
        universe_summary = {
            "symbols_total": len(symbols),
            "symbols_with_daily_bars": sum(1 for rows in bars_by_symbol.values() if rows),
            "daily_bar_count": daily_bar_count,
            "minute_bar_count": minute_scan_summary.get("minute_rows", 0),
            "minute_scanned_trade_days": minute_scan_summary.get("scanned_trade_days", 0),
            "minute_symbols_scanned": minute_scan_summary.get("candidate_symbols", 0),
            "minute_symbols_with_rows": minute_scan_summary.get("symbols_with_minute_rows", 0),
            "minute_trigger_count": minute_scan_summary.get("triggers_returned", 0),
            "minute_return_limit": minute_scan_summary.get("return_limit", strategy_params.get("max_signals")),
            "minute_limit_hit_days": minute_scan_summary.get("limit_hit_days", 0),
            "minute_limit_hit_dates": minute_scan_summary.get("limit_hit_dates", []),
            "minute_possible_truncation": bool(minute_scan_summary.get("possible_truncation")),
            "minute_mode": minute_scan_summary.get("mode") or self._minute_mode(task),
            "start_date": task.start_date,
            "end_date": task.end_date,
            "signal_count": len(signals or []),
            "trade_count": len(trades or []),
            "matched_signal_count": sum(1 for row in signal_audits or [] if row.get("status") == "已成交"),
            "skipped_signal_count": sum(1 for row in signal_audits or [] if row.get("status") in {"跳过", "未成交"}),
            "watch_signal_count": sum(1 for row in signal_audits or [] if row.get("status") == "观察"),
            "sample_symbols": symbols[:20],
        }
        rule_snapshot = {
            "initial_cash": task.initial_cash,
            "single_order_amount": task.single_order_amount,
            "fee_rate": task.fee_rate,
            "stamp_tax_rate": task.stamp_tax_rate,
            "slippage": task.slippage,
            "lot_size": 100,
            "t_plus_1": True,
            "real_qmt_order": False,
            "minute_mode": self._minute_mode(task),
            "minute_market_cap_basis": "previous_visible_daily_bar" if task.data_frequency == "分钟K" else "",
            "strategy_max_signals": strategy_params.get("max_signals"),
            "strategy_params": strategy_params,
        }
        return {
            "strategy_file_name": strategy.file_name,
            "strategy_code_hash": hashlib.sha256(code_bytes).hexdigest(),
            "strategy_name": strategy.strategy_name,
            "strategy_version": strategy.version,
            "data_frequency": task.data_frequency,
            "fill_mode": task.fill_mode,
            "qmt_mode": "test_isolation" if config.simulation_mode else "real_qmt_data",
            "qmt_path": config.qmt_path,
            "account_id": config.account_id,
            "data_coverage_snapshot": json.dumps(coverage_snapshot, ensure_ascii=False),
            "universe_summary": json.dumps(universe_summary, ensure_ascii=False),
            "rule_snapshot": json.dumps(rule_snapshot, ensure_ascii=False),
            "engine_version": "backtest-local-1.2",
            "trust_level": trust_level,
            "trust_message": trust_message,
        }

    def _coverage_snapshot(self, task: BacktestTaskRecord) -> list[dict[str, object]]:
        checks = [("daily_kline", "ALL", "1d")]
        if task.data_frequency == "分钟K":
            checks.append(("minute_kline", "ALL", "1m"))
        rows: list[dict[str, object]] = []
        for data_type, symbol, period in checks:
            coverage = self.data_center_repository.get_coverage_record_covering(data_type, symbol, period, task.start_date, task.end_date)
            if coverage is None:
                rows.append(
                    {
                        "data_type": data_type,
                        "symbol": symbol,
                        "period": period,
                        "requested_start_date": task.start_date,
                        "requested_end_date": task.end_date,
                        "status": "missing_record",
                        "coverage_rate": 0,
                    }
                )
                continue
            payload = coverage.model_dump()
            payload["requested_start_date"] = task.start_date
            payload["requested_end_date"] = task.end_date
            payload["matched_by"] = "exact" if coverage.start_date == task.start_date and coverage.end_date == task.end_date else "covering_range"
            rows.append(payload)
        return rows

    def _trust_from_coverage(self, simulation_mode: bool, task: BacktestTaskRecord, coverage_snapshot: list[dict[str, object]]) -> tuple[str, str]:
        if simulation_mode:
            return "test_only", "当前为测试隔离模式，只能用于自动化回归或排障，不能作为真实数据研究结论。"
        if not coverage_snapshot or any(row.get("status") != "complete" for row in coverage_snapshot):
            return "technical", "覆盖率未全部完成，本次结果只能作为技术验证；正式研究前请先补齐数据并刷新覆盖率。"
        if task.data_frequency == "分钟K":
            return "verified_data_minute_replay", "真实 QMT 落库覆盖完整；当前为正式分钟回放模式，按本地 1 分钟K逐行扫描信号，并按下一根 1 分钟K本地撮合成交，不调用真实 QMT 下单。"
        return "verified_data_simulation", "真实 QMT 落库覆盖完整；当前为本地 SQLite 本地撮合回测，不调用真实 QMT 下单接口。"

    def _minute_mode(self, task: BacktestTaskRecord) -> str:
        if task.data_frequency != "分钟K":
            return ""
        return "minute_replay"

    def _assert_backtest_mode(self, request: BacktestCreateRequest) -> None:
        if request.data_frequency == "分钟K" and request.fill_mode != "正式分钟回放":
            raise BacktestError(
                "分钟K回测必须使用正式分钟回放，不能使用快速扫描。",
                "BACKTEST_MODE_NOT_ALLOWED",
                f"data_frequency={request.data_frequency}; fill_mode={request.fill_mode}; required_fill_mode=正式分钟回放; quick_scan_disabled=true",
                "请将成交模式切换为“正式分钟回放”；系统会按本地 SQLite 1分钟K逐行推演信号，并按下一根1分钟K本地撮合成交。",
            )

    def _minute_replay_mode_error(self, fill_mode: str | None) -> BacktestValidationStep | None:
        if fill_mode in (None, "", "正式分钟回放"):
            return None
        return BacktestValidationStep(
            title="分钟回放模式",
            status="failed",
            message="分钟K回测必须使用正式分钟回放；快速分钟扫描已禁用。",
            technical_detail=f"requested_fill_mode={fill_mode}; required_fill_mode=正式分钟回放; quick_scan_disabled=true",
        )
