"""
cleanup_logs.py — 日志与备份清理脚本

v2.8 §十九.2: 日志文件保留 30 天，备份文件保留 7 天。
建议通过 Windows 任务计划程序每日 03:00 执行。

用法:
  cd backend
  $env:PYTHONPATH="$PWD"
  .venv\\Scripts\\python.exe scripts/cleanup_logs.py [--dry-run]
"""

import argparse
import sys
from datetime import datetime, timedelta
from pathlib import Path

# 添加 backend 目录到 sys.path
backend_dir = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(backend_dir))

from app.core.config import yaml_get, get_runtime_dir


def cleanup_directory(
    directory: Path,
    retention_days: int,
    extensions: set[str] | None = None,
    dry_run: bool = False,
) -> list[str]:
    """清理指定目录中超过保留天数的文件。

    Args:
        directory: 目标目录
        retention_days: 保留天数
        extensions: 限定文件扩展名（None = 全部）
        dry_run: 仅打印不删除

    Returns:
        被删除的文件路径列表
    """
    if not directory.exists():
        return []

    cutoff = datetime.now() - timedelta(days=retention_days)
    removed: list[str] = []

    for f in directory.iterdir():
        if not f.is_file():
            continue
        if extensions and f.suffix.lower() not in extensions:
            continue

        mtime = datetime.fromtimestamp(f.stat().st_mtime)
        if mtime < cutoff:
            if dry_run:
                print(f"  [DRY-RUN] 将删除: {f.name} (修改于 {mtime:%Y-%m-%d %H:%M})")
            else:
                try:
                    f.unlink()
                    print(f"  已删除: {f.name} (修改于 {mtime:%Y-%m-%d %H:%M})")
                except OSError as e:
                    print(f"  删除失败: {f.name}: {e}")
            removed.append(str(f))

    return removed


def main():
    parser = argparse.ArgumentParser(description="清理过期日志和备份文件")
    parser.add_argument("--dry-run", action="store_true", help="仅打印将删除的文件，不实际删除")
    args = parser.parse_args()

    log_retention = yaml_get("log", "retention_days", default=30)
    backup_retention = yaml_get("backup", "retention_days", default=7)

    print(f"=== 日志清理 ({datetime.now():%Y-%m-%d %H:%M:%S}) ===")
    print(f"日志保留: {log_retention} 天 | 备份保留: {backup_retention} 天")
    if args.dry_run:
        print("[DRY-RUN 模式]")
    print()

    # 清理日志文件
    log_dir = get_runtime_dir("log")
    print(f"[1] 日志目录: {log_dir}")
    log_removed = cleanup_directory(
        log_dir, log_retention,
        extensions={".log", ".txt"},
        dry_run=args.dry_run,
    )
    if not log_removed:
        print("  无过期日志文件")

    # 清理备份文件
    backup_dir = get_runtime_dir("backup")
    print(f"\n[2] 备份目录: {backup_dir}")
    backup_removed = cleanup_directory(
        backup_dir, backup_retention,
        extensions={".db", ".sqlite", ".sql", ".bak", ".gz"},
        dry_run=args.dry_run,
    )
    if not backup_removed:
        print("  无过期备份文件")

    total = len(log_removed) + len(backup_removed)
    action = "将清理" if args.dry_run else "已清理"
    print(f"\n{action} {total} 个文件（日志 {len(log_removed)} + 备份 {len(backup_removed)}）")


if __name__ == "__main__":
    main()
