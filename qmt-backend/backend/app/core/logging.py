"""
日志系统

- 控制台 + 文件双输出
- 文件按天滚动，写入 runtime/logs/
- 级别从 config.yaml log.level 读取
"""

from __future__ import annotations

import logging
import sys
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path

from app.core.config import get_runtime_dir, yaml_get

_initialized = False


def setup_logging() -> None:
    """初始化日志，整个进程只执行一次"""
    global _initialized
    if _initialized:
        return
    _initialized = True

    level_name = yaml_get("log", "level", default="INFO")
    level = getattr(logging, level_name.upper(), logging.INFO)

    fmt = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    datefmt = "%Y-%m-%d %H:%M:%S"
    formatter = logging.Formatter(fmt, datefmt=datefmt)

    root = logging.getLogger()
    root.setLevel(level)

    # 清除已有 handler（防止 reload 重复）
    root.handlers.clear()

    # 控制台
    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(formatter)
    root.addHandler(console)

    # 文件 — 按天滚动
    log_dir: Path = get_runtime_dir("log")
    log_file = log_dir / "app.log"
    file_handler = TimedRotatingFileHandler(
        filename=str(log_file),
        when="midnight",
        interval=1,
        backupCount=yaml_get("log", "retention_days", default=30),
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    root.addHandler(file_handler)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
