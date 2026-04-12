"""
数据库恢复脚本

用法:
    python scripts/restore_db.py <备份文件路径>
    python scripts/restore_db.py --list          # 列出可用备份
    python scripts/restore_db.py --latest         # 恢复最新备份

安全措施:
  - 恢复前自动备份当前数据库（带 _pre_restore 后缀）
  - 要求确认操作
  - 验证备份文件完整性
"""

import argparse
import shutil
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import get_db_path, get_runtime_dir


def list_backups() -> list[Path]:
    backup_dir = get_runtime_dir("backup")
    backups = sorted(backup_dir.glob("app_*.db"), key=lambda f: f.stat().st_mtime, reverse=True)
    if not backups:
        print("[INFO] runtime/backups/ 下无可用备份")
        return []
    print(f"[INFO] 共 {len(backups)} 个备份:")
    for i, f in enumerate(backups):
        size_kb = f.stat().st_size / 1024
        print(f"  {i+1}. {f.name}  ({size_kb:.1f} KB)")
    return backups


def verify_backup(backup_file: Path) -> bool:
    """验证备份文件是有效 SQLite 数据库"""
    try:
        conn = sqlite3.connect(str(backup_file))
        conn.execute("SELECT count(*) FROM sqlite_master")
        conn.execute("PRAGMA integrity_check")
        conn.close()
        return True
    except Exception as e:
        print(f"[ERROR] 备份文件验证失败: {e}")
        return False


def restore(backup_file: Path, skip_confirm: bool = False) -> bool:
    db_path = get_db_path()

    if not backup_file.exists():
        print(f"[ERROR] 备份文件不存在: {backup_file}")
        return False

    print(f"[INFO] 备份文件: {backup_file}")
    print(f"[INFO] 目标数据库: {db_path}")

    # 验证备份
    if not verify_backup(backup_file):
        return False
    print("[OK] 备份文件验证通过")

    # 安全确认
    if not skip_confirm:
        ans = input("[WARNING] 即将覆盖当前数据库，是否继续? (yes/no): ").strip().lower()
        if ans != "yes":
            print("[INFO] 操作取消")
            return False

    # 先备份当前数据库
    if db_path.exists():
        from datetime import datetime
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        pre_restore = db_path.with_name(f"app_pre_restore_{ts}.db")
        shutil.copy2(str(db_path), str(pre_restore))
        print(f"[INFO] 当前数据库已备份到: {pre_restore.name}")

    # 执行恢复
    try:
        # 删除 WAL/SHM 文件（恢复后不兼容）
        for suffix in (".db-wal", ".db-shm"):
            wal_file = db_path.with_suffix(suffix)
            if wal_file.exists():
                wal_file.unlink()

        shutil.copy2(str(backup_file), str(db_path))
        print(f"[OK] 恢复完成, 大小: {db_path.stat().st_size / 1024:.1f} KB")

        # 恢复后重新启用 WAL
        conn = sqlite3.connect(str(db_path))
        conn.execute("PRAGMA journal_mode=WAL")
        conn.close()
        print("[OK] WAL 模式已重新启用")
        return True
    except Exception as e:
        print(f"[ERROR] 恢复失败: {e}")
        return False


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="QMT 数据库恢复")
    parser.add_argument("backup_file", nargs="?", type=Path, help="备份文件路径")
    parser.add_argument("--list", action="store_true", help="列出可用备份")
    parser.add_argument("--latest", action="store_true", help="恢复最新备份")
    parser.add_argument("--yes", action="store_true", help="跳过确认")
    args = parser.parse_args()

    if args.list:
        list_backups()
    elif args.latest:
        backups = list_backups()
        if backups:
            restore(backups[0], skip_confirm=args.yes)
    elif args.backup_file:
        restore(args.backup_file, skip_confirm=args.yes)
    else:
        parser.print_help()
