from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.core.database import initialize_database  # noqa: E402
from backend.services.system.system_service import SystemService  # noqa: E402


def main() -> int:
    initialize_database()
    record = SystemService().create_backup()
    print("备份完成。")
    print(f"备份名称：{record.backup_name}")
    print(f"备份路径：{record.backup_path}")
    print(f"备份大小：{record.backup_size} 字节")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
