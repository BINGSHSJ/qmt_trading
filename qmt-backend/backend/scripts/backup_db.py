"""
数据库备份脚本

用法:
    python scripts/backup_db.py                 # 备份到默认目录
    python scripts/backup_db.py --output /path  # 备份到指定目录

说明:
  - 复制 SQLite 数据库文件 + WAL/SHM 文件到 runtime/backups/
  - 使用 SQLite 安全备份（VACUUM INTO）确保一致性
  - 自动清理超过 retention_days 的旧备份
"""

import argparse
import os
import shutil
import sqlite3
import sys
from datetime import datetime, timedelta
from pathlib import Path

# 让脚本能找到 app 模块
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import get_db_path, get_runtime_dir, yaml_get


def backup(output_dir: Path | None = None) -> Path:
    db_path = get_db_path()
    if not db_path.exists():
        print(f"[ERROR] 数据库文件不存在: {db_path}")
        sys.exit(1)

    backup_dir = output_dir or get_runtime_dir("backup")
    backup_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_file = backup_dir / f"app_{timestamp}.db"

    print(f"[INFO] 源数据库: {db_path}")
    print(f"[INFO] 备份目标: {backup_file}")

    # 使用 SQLite VACUUM INTO 进行安全备份（生成独立一致的副本）
    try:
        conn = sqlite3.connect(str(db_path))
        conn.execute(f"VACUUM INTO '{backup_file}'")
        conn.close()
        print(f"[OK] 备份完成, 大小: {backup_file.stat().st_size / 1024:.1f} KB")
    except Exception as e:
        print(f"[ERROR] 备份失败: {e}")
        # 回退：使用文件拷贝
        print("[INFO] 回退到文件拷贝方式...")
        shutil.copy2(str(db_path), str(backup_file))
        wal = db_path.with_suffix(".db-wal")
        shm = db_path.with_suffix(".db-shm")
        if wal.exists():
            shutil.copy2(str(wal), str(backup_file.with_suffix(".db-wal")))
        if shm.exists():
            shutil.copy2(str(shm), str(backup_file.with_suffix(".db-shm")))
        print(f"[OK] 文件拷贝备份完成")

    return backup_file


def cleanup(backup_dir: Path | None = None) -> int:
    """清理过期备份"""
    retention_days = yaml_get("backup", "retention_days", default=7)
    bk_dir = backup_dir or get_runtime_dir("backup")
    cutoff = datetime.now() - timedelta(days=retention_days)
    removed = 0

    for f in bk_dir.glob("app_*.db*"):
        if f.stat().st_mtime < cutoff.timestamp():
            f.unlink()
            removed += 1
            print(f"[CLEANUP] 删除过期备份: {f.name}")

    if removed:
        print(f"[INFO] 共清理 {removed} 个过期文件 (保留 {retention_days} 天)")
    else:
        print(f"[INFO] 无过期备份需清理")
    return removed


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="QMT 数据库备份")
    parser.add_argument("--output", type=Path, help="备份输出目录")
    parser.add_argument("--cleanup-only", action="store_true", help="仅清理过期备份")
    args = parser.parse_args()

    if args.cleanup_only:
        cleanup(args.output)
    else:
        backup(args.output)
        cleanup(args.output)
