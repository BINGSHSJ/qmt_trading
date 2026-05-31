import ast
import hashlib
import re
import shutil
import traceback
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

from backend.core.config import settings
from backend.core.exceptions import StrategyRunError, StrategyValidationError, TaskCancelledError
from backend.repositories.strategy_dev.strategy_repository import StrategyRepository
from backend.repositories.system.system_repository import SystemRepository, now_text
from backend.schemas.common import PageQuery, PageResult
from backend.schemas.strategy_dev import (
    SignalStatusUpdate,
    StrategyContent,
    StrategyContentUpdate,
    StrategyFileCreate,
    StrategyFileRecord,
    StrategyImportRequest,
    StrategyRunRecord,
    StrategySignalRecord,
    StrategyStatusUpdate,
    StrategyValidationResult,
    StrategyVersionCompare,
    StrategyVersionDetail,
    StrategyVersionRecord,
)
from backend.schemas.system import TaskCreated
from backend.services.strategy_dev.sandbox_runner import StrategyExecutionCancelled, StrategyExecutionFailed, StrategyExecutionTimeout, run_strategy_code
from backend.services.system.system_service import SystemService


USER_STRATEGY_DIR = settings.strategy_user_dir
EXAMPLE_STRATEGY_DIR = settings.strategy_example_dir


class StrategyService:
    def __init__(self) -> None:
        self.repository = StrategyRepository()
        self.system_repository = SystemRepository()
        self.system_service = SystemService()
        USER_STRATEGY_DIR.mkdir(parents=True, exist_ok=True)
        EXAMPLE_STRATEGY_DIR.mkdir(parents=True, exist_ok=True)

    def list_files(self, query: PageQuery) -> PageResult[StrategyFileRecord]:
        self.scan_user_directory()
        return self.repository.list_files(query)

    def create_file(self, request: StrategyFileCreate) -> StrategyFileRecord:
        file_name = self._safe_file_name(request.file_name)
        path = self._unique_user_path(file_name)
        code = self._template_code(request.strategy_name, request.description)
        path.write_text(code, encoding="utf-8")
        meta = self._extract_metadata(code)
        record = self.repository.upsert_strategy_file(path.name, path, meta.strategy_name, meta.version, meta.description)
        self.repository.add_version(record.id, meta.version, code, self._hash(code), "新建策略")
        self.system_repository.add_operation_log("策略开发", "新建策略", "strategy_file", str(record.id), "成功", f"已新建策略文件：{file_name}")
        return record

    def import_file(self, request: StrategyImportRequest) -> StrategyFileRecord:
        file_name = self._safe_file_name(request.file_name)
        path = self._unique_user_path(file_name)
        self.validate_code(request.code_content)
        path.write_text(request.code_content, encoding="utf-8")
        meta = self._extract_metadata(request.code_content)
        record = self.repository.upsert_strategy_file(path.name, path, meta.strategy_name, meta.version, meta.description)
        self.repository.add_version(record.id, meta.version, request.code_content, self._hash(request.code_content), "导入策略")
        self.system_repository.add_operation_log("策略开发", "导入策略", "strategy_file", str(record.id), "成功", f"已导入策略文件：{file_name}")
        return record

    def copy_example(self) -> StrategyFileRecord:
        source = EXAMPLE_STRATEGY_DIR / "simple_signal.py"
        target = self._unique_user_path("simple_signal.py")
        shutil.copyfile(source, target)
        code = target.read_text(encoding="utf-8")
        meta = self._extract_metadata(code)
        record = self.repository.upsert_strategy_file(target.name, target, meta.strategy_name, meta.version, meta.description)
        self.repository.add_version(record.id, meta.version, code, self._hash(code), "复制示例")
        self.system_repository.add_operation_log("策略开发", "复制示例", "strategy_file", str(record.id), "成功", "已复制示例策略。")
        return record

    def get_content(self, strategy_id: int) -> StrategyContent:
        record = self._get_file_or_error(strategy_id)
        return StrategyContent(strategy_id=record.id, file_name=record.file_name, code_content=Path(record.file_path).read_text(encoding="utf-8"))

    def save_content(self, strategy_id: int, update: StrategyContentUpdate) -> StrategyContent:
        record = self._get_file_or_error(strategy_id)
        path = self._assert_user_path(Path(record.file_path))
        old_code = path.read_text(encoding="utf-8") if path.exists() else ""
        if old_code:
            self.repository.add_version(strategy_id, record.version, old_code, self._hash(old_code), update.remark or "保存前快照")
        validation = self.validate_code(update.code_content)
        path.write_text(update.code_content, encoding="utf-8")
        self.repository.update_file_metadata(
            strategy_id,
            validation.strategy_name or record.strategy_name,
            validation.version or record.version,
            validation.description or record.description,
        )
        self.system_repository.add_operation_log("策略开发", "保存代码", "strategy_file", str(strategy_id), "成功", f"已保存策略代码：{record.file_name}")
        return self.get_content(strategy_id)

    def validate_strategy(self, strategy_id: int) -> StrategyValidationResult:
        return self.validate_code(self.get_content(strategy_id).code_content)

    def validate_code(self, code: str) -> StrategyValidationResult:
        try:
            tree = ast.parse(code)
        except SyntaxError as exc:
            raise StrategyValidationError(
                message="策略 Python 语法错误。",
                code="STRATEGY_INTERFACE_INVALID",
                detail=f"{exc.msg} at line {exc.lineno}",
                suggestion="请检查标红行附近的缩进、冒号或括号。",
            ) from exc
        strategy_class = next((node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "Strategy"), None)
        if strategy_class is None:
            raise StrategyValidationError("策略缺少 Strategy 类。", "STRATEGY_INTERFACE_INVALID", "class Strategy not found", "请按统一接口定义 class Strategy。")
        methods = {node.name for node in strategy_class.body if isinstance(node, ast.FunctionDef)}
        if "__init__" not in methods or "run" not in methods:
            raise StrategyValidationError("策略缺少 __init__ 或 run 方法。", "STRATEGY_INTERFACE_INVALID", str(methods), "请补齐 __init__(context) 和 run()。")
        meta = self._extract_metadata(code)
        return StrategyValidationResult(
            valid=True,
            message="策略接口检查通过。",
            strategy_name=meta.strategy_name,
            version=meta.version,
            description=meta.description,
        )

    def create_run_task(self, strategy_id: int) -> TaskCreated:
        record = self._get_file_or_error(strategy_id)
        if record.status != "enabled":
            raise StrategyRunError("策略已停用，不能运行。", "STRATEGY_RUN_FAILED", f"strategy_id={strategy_id}", "请先启用策略。")
        task = self.system_repository.create_task("strategy_run", f"正在运行策略：{record.strategy_name}")
        run_id = f"run_{uuid4().hex[:10]}"
        code = Path(record.file_path).read_text(encoding="utf-8")
        self.repository.create_run(
            run_id,
            strategy_id,
            task.task_id,
            strategy_name=record.strategy_name,
            strategy_file_name=record.file_name,
            strategy_version=record.version,
            strategy_code_hash=self._hash(code),
        )
        self.system_repository.add_operation_log("策略开发", "运行策略", "strategy_file", str(strategy_id), "成功", f"已创建策略运行任务：{run_id}")
        return TaskCreated(task_id=task.task_id, task_type=task.task_type, status=task.status, progress=task.progress, message=task.message)

    def run_strategy_task(self, strategy_id: int, task_id: str) -> None:
        run = self._find_run_by_task(task_id)
        try:
            self.system_service.ensure_not_cancelled(task_id)
            record = self.repository.get_file(strategy_id)
            code = Path(record.file_path).read_text(encoding="utf-8")
            self.validate_code(code)
            self.system_service.ensure_not_cancelled(task_id)
            raw_signals, logs = run_strategy_code(
                code,
                record.file_name,
                self.system_service.get_config().strategy_timeout_seconds,
                cancel_check=lambda: self.system_repository.is_task_cancelled(task_id),
            )
            self.system_service.ensure_not_cancelled(task_id)
            signals = self._validate_signals(raw_signals)
            count = self.repository.add_signals(strategy_id, run.run_id, signals)
            technical = "\n".join(logs).strip()
            self.repository.update_run(run.run_id, "success", count, f"策略运行完成，生成 {count} 条信号。", technical, finished=True)
            self.repository.mark_last_run(strategy_id)
            self.system_service.finish_task_if_active(task_id, "success", 100, f"策略运行完成，生成 {count} 条信号。", technical, finished=True)
        except TaskCancelledError:
            self.repository.update_run(run.run_id, "cancelled", 0, "策略运行任务已取消。", "task_cancelled=true", finished=True)
        except StrategyExecutionCancelled:
            self.repository.update_run(run.run_id, "cancelled", 0, "策略运行任务已取消。", "task_cancelled=true", finished=True)
        except StrategyExecutionTimeout as exc:
            detail = str(exc)
            if not self.system_repository.is_task_cancelled(task_id):
                self.repository.update_run(run.run_id, "failed", 0, "策略运行超时，已终止。", detail, finished=True)
                self.repository.add_error(strategy_id, run.run_id, "策略运行超时。", detail)
                self.system_service.finish_task_if_active(task_id, "failed", 100, "策略运行超时，已终止。", detail, finished=True)
        except StrategyExecutionFailed as exc:
            detail = str(exc)
            if not self.system_repository.is_task_cancelled(task_id):
                self.repository.update_run(run.run_id, "failed", 0, "策略运行失败。", detail, finished=True)
                self.repository.add_error(strategy_id, run.run_id, "策略运行失败。", detail)
                self.system_service.finish_task_if_active(task_id, "failed", 100, "策略运行失败。", detail, finished=True)
        except Exception as exc:
            detail = traceback.format_exc()
            if not self.system_repository.is_task_cancelled(task_id):
                self.repository.update_run(run.run_id, "failed", 0, "策略运行失败。", detail, finished=True)
                self.repository.add_error(strategy_id, run.run_id, "策略运行失败。", detail)
                self.system_service.finish_task_if_active(task_id, "failed", 100, "策略运行失败。", detail, finished=True)

    def list_runs(self, query: PageQuery) -> PageResult[StrategyRunRecord]:
        return self.repository.list_runs(query)

    def get_run(self, run_id: str) -> StrategyRunRecord:
        try:
            return self.repository.get_run(run_id)
        except KeyError as exc:
            raise StrategyRunError("策略运行记录不存在。", "STRATEGY_RUN_NOT_FOUND", str(exc), "请刷新运行记录后重试。", status_code=404) from exc

    def stop_run(self, run_id: str) -> StrategyRunRecord:
        run = self.get_run(run_id)
        if run.status in {"running", "pending"}:
            self.system_service.cancel_task(run.task_id)
            self.repository.cancel_run_by_task(run.task_id)
            self.system_repository.add_operation_log(
                "策略开发",
                "停止运行",
                "strategy_run",
                run_id,
                "成功",
                "已提交策略停止请求。",
                f"task_id={run.task_id}",
            )
        return self.get_run(run_id)

    def run_logs(self, run_id: str) -> list[str]:
        run = self.get_run(run_id)
        return [line for line in (run.technical_detail or "").splitlines() if line]

    def list_signals(self, query: PageQuery) -> PageResult[StrategySignalRecord]:
        return self.repository.list_signals(query)

    def get_signal(self, signal_id: int) -> StrategySignalRecord:
        try:
            return self.repository.get_signal(signal_id)
        except KeyError as exc:
            raise StrategyRunError("策略信号不存在。", "STRATEGY_SIGNAL_NOT_FOUND", str(exc), "请刷新信号列表后重试。", status_code=404) from exc

    def ignore_signal(self, signal_id: int) -> StrategySignalRecord:
        signal = self.repository.update_signal_status(signal_id, "已忽略")
        self.system_repository.add_operation_log("策略开发", "忽略信号", "strategy_signal", str(signal_id), "成功", f"已忽略策略信号：{signal.symbol}")
        return signal

    def update_signal_status(self, signal_id: int, update: SignalStatusUpdate) -> StrategySignalRecord:
        signal = self.repository.update_signal_status(signal_id, update.status)
        self.system_repository.add_operation_log("策略开发", "更新信号状态", "strategy_signal", str(signal_id), "成功", f"策略信号状态更新为 {update.status}。")
        return signal

    def list_versions(self, strategy_id: int, query: PageQuery) -> PageResult[StrategyVersionRecord]:
        return self.repository.list_versions(strategy_id, query)

    def get_version(self, version_id: int) -> StrategyVersionDetail:
        try:
            return self.repository.get_version(version_id)
        except KeyError as exc:
            raise StrategyRunError("策略版本不存在。", "STRATEGY_VERSION_NOT_FOUND", str(exc), "请刷新版本列表后重试。", status_code=404) from exc

    def restore_version(self, version_id: int) -> StrategyContent:
        version = self.get_version(version_id)
        content = self.save_content(version.strategy_id, StrategyContentUpdate(code_content=version.code_content, remark=f"恢复版本 {version.version_no}"))
        self.system_repository.add_operation_log("策略开发", "恢复版本", "strategy_version", str(version_id), "成功", f"已恢复策略版本 {version.version_no}。")
        return content

    def compare_versions(self, left_version_id: int, right_version_id: int) -> StrategyVersionCompare:
        left = self.get_version(left_version_id)
        right = self.get_version(right_version_id)
        return StrategyVersionCompare(
            left_version_id=left_version_id,
            right_version_id=right_version_id,
            left_content=left.code_content,
            right_content=right.code_content,
        )

    def update_status(self, strategy_id: int, update: StrategyStatusUpdate) -> StrategyFileRecord:
        self.repository.update_status(strategy_id, update.status)
        self.system_repository.add_operation_log("策略开发", "更新状态", "strategy_file", str(strategy_id), "成功", f"策略状态更新为 {update.status}。")
        return self._get_file_or_error(strategy_id)

    def delete_file(self, strategy_id: int) -> None:
        record = self._get_file_or_error(strategy_id)
        path = self._assert_user_path(Path(record.file_path))
        if path.exists():
            path.unlink()
        self.repository.delete_file_record(strategy_id)
        self.system_repository.add_operation_log("策略开发", "删除策略", "strategy_file", str(strategy_id), "成功", f"已删除策略：{record.file_name}")

    def scan_user_directory(self) -> None:
        user_root = USER_STRATEGY_DIR.resolve()
        for path in USER_STRATEGY_DIR.glob("*.py"):
            code = path.read_text(encoding="utf-8")
            try:
                meta = self._extract_metadata(code)
            except Exception:
                meta = SimpleNamespace(strategy_name=path.stem, version="0.0.0", description="未通过接口解析")
            record = self.repository.upsert_strategy_file(path.name, path, meta.strategy_name, meta.version, meta.description, modified_at=self._file_modified_at(path))
            if self.repository.count_versions(record.id) == 0:
                self.repository.add_version(record.id, meta.version, code, self._hash(code), "扫描现有策略")
        for record in self.repository.list_file_records():
            path = Path(record.file_path)
            try:
                resolved = path.resolve()
            except OSError:
                resolved = path
            if str(resolved).startswith(str(user_root)) and not resolved.exists():
                self.repository.delete_file_record(record.id)

    def _find_run_by_task(self, task_id: str) -> StrategyRunRecord:
        runs = self.repository.list_runs(PageQuery(page=1, page_size=200)).items
        for run in runs:
            if run.task_id == task_id:
                return run
        raise StrategyRunError("运行记录不存在。", "STRATEGY_RUN_FAILED", task_id, "请刷新页面后重试。")

    def _validate_signals(self, raw_signals: object) -> list[dict[str, object]]:
        if not isinstance(raw_signals, list):
            raise StrategyRunError("策略 run() 必须返回 signals 列表。", "STRATEGY_RUN_FAILED", type(raw_signals).__name__, "请返回 list[dict]。")
        allowed_actions = {"BUY", "SELL", "WATCH"}
        validated = []
        for index, item in enumerate(raw_signals):
            if not isinstance(item, dict):
                raise StrategyRunError("策略信号必须是字典。", "STRATEGY_RUN_FAILED", f"index={index}", "请检查 signals 中的元素。")
            for field in ["symbol", "action", "price", "reason"]:
                if field not in item:
                    raise StrategyRunError("策略信号缺少必填字段。", "STRATEGY_RUN_FAILED", f"missing={field}; signal={item}", "请补齐 symbol/action/price/reason。")
            symbol = str(item["symbol"]).strip().upper()
            if not re.match(r"^\d{6}\.(SH|SZ|BJ)$", symbol):
                raise StrategyRunError(
                    "策略信号股票代码格式不正确。",
                    "STRATEGY_RUN_FAILED",
                    f"index={index}; symbol={item['symbol']}",
                    "请使用 600000.SH / 000001.SZ / 430000.BJ 这类标准代码格式。",
                )
            action = str(item["action"]).strip().upper()
            if action not in allowed_actions:
                raise StrategyRunError("策略信号 action 不合法。", "STRATEGY_RUN_FAILED", str(item), "action 只能是 BUY / SELL / WATCH。")
            try:
                price = float(item["price"])
            except (TypeError, ValueError) as exc:
                raise StrategyRunError(
                    "策略信号 price 必须是数字。",
                    "STRATEGY_RUN_FAILED",
                    f"index={index}; price={item['price']}",
                    "请把参考价格改为数字，例如 10.25。",
                ) from exc
            if price <= 0:
                raise StrategyRunError(
                    "策略信号 price 必须大于 0。",
                    "STRATEGY_RUN_FAILED",
                    f"index={index}; price={price}",
                    "请检查行情数据或策略价格计算逻辑。",
                )
            amount = item.get("amount")
            if amount in ("", None):
                amount_value = None
            else:
                try:
                    amount_value = float(amount)
                except (TypeError, ValueError) as exc:
                    raise StrategyRunError(
                        "策略信号 amount 必须是数字。",
                        "STRATEGY_RUN_FAILED",
                        f"index={index}; amount={amount}",
                        "请把建议金额改为数字，或不填写 amount。",
                    ) from exc
                if amount_value < 0:
                    raise StrategyRunError(
                        "策略信号 amount 不能小于 0。",
                        "STRATEGY_RUN_FAILED",
                        f"index={index}; amount={amount_value}",
                        "请检查建议金额计算逻辑。",
                    )
            reason = str(item["reason"]).strip()
            if not reason:
                raise StrategyRunError("策略信号 reason 不能为空。", "STRATEGY_RUN_FAILED", f"index={index}", "请写明信号触发原因。")
            signal_time = str(item.get("signal_time") or "").strip() or None
            if signal_time:
                self._validate_signal_time(signal_time, index)
            validated.append({
                **item,
                "symbol": symbol,
                "action": action,
                "price": price,
                "amount": amount_value,
                "reason": reason,
                "signal_time": signal_time,
            })
        return validated

    def _validate_signal_time(self, signal_time: str, index: int) -> None:
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
            try:
                datetime.strptime(signal_time, fmt)
                return
            except ValueError:
                continue
        raise StrategyRunError(
            "策略信号 signal_time 格式不正确。",
            "STRATEGY_RUN_FAILED",
            f"index={index}; signal_time={signal_time}",
            "请使用 2026-05-08 或 2026-05-08 10:15:00 格式。",
        )

    def _extract_metadata(self, code: str) -> SimpleNamespace:
        tree = ast.parse(code)
        strategy_cls = next((node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "Strategy"), None)
        if strategy_cls is None:
            return SimpleNamespace(strategy_name="未命名策略", version="0.0.0", description="")
        values = {"name": "未命名策略", "version": "1.0.0", "description": ""}
        for node in strategy_cls.body:
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name) and target.id in values:
                        try:
                            values[target.id] = str(ast.literal_eval(node.value))
                        except Exception:
                            values[target.id] = str(values[target.id])
        return SimpleNamespace(
            strategy_name=values["name"],
            version=values["version"],
            description=values["description"],
        )

    def _safe_file_name(self, file_name: str) -> str:
        cleaned = re.sub(r"[^A-Za-z0-9_\-.]", "_", file_name.strip())
        if not cleaned.endswith(".py"):
            cleaned += ".py"
        if cleaned in {".py", ""}:
            raise StrategyValidationError("策略文件名无效。", "STRATEGY_INTERFACE_INVALID", file_name, "请使用英文、数字或下划线命名。")
        return cleaned

    def _unique_user_path(self, file_name: str) -> Path:
        base = USER_STRATEGY_DIR / file_name
        if not base.exists():
            return base
        stem = base.stem
        suffix = base.suffix
        for index in range(1, 1000):
            candidate = USER_STRATEGY_DIR / f"{stem}_{index}{suffix}"
            if not candidate.exists():
                return candidate
        raise StrategyValidationError("无法生成唯一策略文件名。", "STRATEGY_INTERFACE_INVALID", file_name, "请换一个文件名。")

    def _assert_user_path(self, path: Path) -> Path:
        resolved = path.resolve()
        user_root = USER_STRATEGY_DIR.resolve()
        if not resolved.is_relative_to(user_root):
            raise StrategyValidationError("策略文件路径不在用户策略目录内。", "STRATEGY_INTERFACE_INVALID", str(path), "请只操作 strategies/user 目录内文件。")
        return resolved

    def _get_file_or_error(self, strategy_id: int) -> StrategyFileRecord:
        try:
            return self.repository.get_file(strategy_id)
        except KeyError as exc:
            raise StrategyRunError("策略文件不存在。", "STRATEGY_FILE_NOT_FOUND", str(exc), "请刷新策略文件列表后重试。", status_code=404) from exc

    def _hash(self, code: str) -> str:
        return hashlib.sha256(code.encode("utf-8")).hexdigest()

    def _file_modified_at(self, path: Path) -> str:
        return datetime.fromtimestamp(path.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S")

    def _template_code(self, strategy_name: str, description: str) -> str:
        return f'''class Strategy:
    name = "{strategy_name}"
    version = "1.0.0"
    description = "{description}"
    params = {{}}

    def __init__(self, context):
        self.context = context

    def run(self):
        signals = []
        self.context.log("策略运行完成，当前未生成信号。")
        return signals
'''
