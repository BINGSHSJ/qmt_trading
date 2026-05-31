import logging
from pathlib import Path
from logging.handlers import RotatingFileHandler

from backend.core.config import settings


def _has_rotating_file_handler(logger: logging.Logger, path: Path) -> bool:
    target = path.resolve()
    for handler in logger.handlers:
        base_filename = getattr(handler, "baseFilename", None)
        if base_filename and Path(base_filename).resolve() == target:
            return True
    return False


def _add_rotating_file_handler(
    logger: logging.Logger,
    path: Path,
    level: int,
    formatter: logging.Formatter,
) -> None:
    if _has_rotating_file_handler(logger, path):
        return
    handler = RotatingFileHandler(
        path,
        maxBytes=5 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    handler.setLevel(level)
    handler.setFormatter(formatter)
    logger.addHandler(handler)


def configure_logging() -> None:
    settings.logs_dir.mkdir(parents=True, exist_ok=True)
    formatter = logging.Formatter(
        "%(asctime)s %(levelname)s [%(name)s] %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    _add_rotating_file_handler(root_logger, settings.logs_dir / "app.log", logging.INFO, formatter)
    _add_rotating_file_handler(root_logger, settings.logs_dir / "error.log", logging.ERROR, formatter)
    logging.getLogger("backend.logging").info("文件日志已启用。")
