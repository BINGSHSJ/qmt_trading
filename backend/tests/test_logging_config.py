import logging
from pathlib import Path

from backend.core.config import settings
from backend.core.logging import configure_logging


def _flush_handlers(logger: logging.Logger) -> None:
    for handler in logger.handlers:
        try:
            handler.flush()
        except Exception:
            pass


def test_configure_logging_adds_file_handlers_when_console_handler_exists(tmp_path, monkeypatch):
    root_logger = logging.getLogger()
    original_handlers = list(root_logger.handlers)
    for handler in original_handlers:
        root_logger.removeHandler(handler)

    console_handler = logging.StreamHandler()
    root_logger.addHandler(console_handler)
    monkeypatch.setattr(settings, "logs_dir", tmp_path)

    try:
        configure_logging()
        configure_logging()
        log_paths = [
            Path(handler.baseFilename).resolve()
            for handler in root_logger.handlers
            if getattr(handler, "baseFilename", None)
        ]

        assert log_paths.count((tmp_path / "app.log").resolve()) == 1
        assert log_paths.count((tmp_path / "error.log").resolve()) == 1

        logger = logging.getLogger("backend.tests.logging")
        logger.info("测试文件日志写入")
        logger.error("测试错误日志写入")
        _flush_handlers(root_logger)

        app_log = (tmp_path / "app.log").read_text(encoding="utf-8")
        error_log = (tmp_path / "error.log").read_text(encoding="utf-8")

        assert "测试文件日志写入" in app_log
        assert "测试错误日志写入" in app_log
        assert "测试错误日志写入" in error_log
    finally:
        for handler in list(root_logger.handlers):
            root_logger.removeHandler(handler)
            if handler not in original_handlers:
                handler.close()
        for handler in original_handlers:
            root_logger.addHandler(handler)
