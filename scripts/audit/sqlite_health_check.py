"""SQLite health audit using the application connection settings.

This script is intentionally read-only for business data. It reuses
backend.core.database.get_connection() so WAL, busy_timeout and foreign_keys
match the running backend instead of a bare sqlite3 connection.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.core.database import get_connection  # noqa: E402


CRITICAL_DUPLICATE_CHECKS = {
    "daily_kline": ["symbol", "trade_date"],
    "minute_kline": ["symbol", "period", "datetime"],
    "order_record": ["local_order_id"],
    "trade_record": ["trade_id"],
}

WARNING_DUPLICATE_CHECKS = {
    "position_snapshot": ["account_id", "symbol", "snapshot_time"],
}


def has_unique_index_for_fields(table: str, fields: list[str]) -> bool:
    expected = list(fields)
    with get_connection() as connection:
        indexes = connection.execute(f"PRAGMA index_list({table})").fetchall()
        for index in indexes:
            if int(index["unique"] or 0) != 1:
                continue
            index_fields = [row["name"] for row in connection.execute(f"PRAGMA index_info({index['name']})").fetchall()]
            if index_fields == expected:
                return True
    return False


def duplicate_group_count(table: str, fields: list[str]) -> int:
    columns = ", ".join(fields)
    predicates = " AND ".join(f"{field} IS NOT NULL AND {field} != ''" for field in fields)
    with get_connection() as connection:
        row = connection.execute(
            f"""
            SELECT COUNT(*) AS total
            FROM (
                SELECT {columns}
                FROM {table}
                WHERE {predicates}
                GROUP BY {columns}
                HAVING COUNT(*) > 1
            )
            """
        ).fetchone()
    return int(row["total"])


def collect() -> dict[str, object]:
    with get_connection() as connection:
        pragmas = {
            "journal_mode": connection.execute("PRAGMA journal_mode").fetchone()[0],
            "synchronous": connection.execute("PRAGMA synchronous").fetchone()[0],
            "foreign_keys": connection.execute("PRAGMA foreign_keys").fetchone()[0],
            "busy_timeout": connection.execute("PRAGMA busy_timeout").fetchone()[0],
        }
        tables = [
            row["name"]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()
        ]
        indexes = [
            row["name"]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name").fetchall()
        ]
    unique_index_checks = {
        table: has_unique_index_for_fields(table, fields)
        for table, fields in CRITICAL_DUPLICATE_CHECKS.items()
    }
    critical_duplicates = {table: duplicate_group_count(table, fields) for table, fields in CRITICAL_DUPLICATE_CHECKS.items()}
    warning_duplicates = {table: duplicate_group_count(table, fields) for table, fields in WARNING_DUPLICATE_CHECKS.items()}
    return {
        "connection": "backend.core.database.get_connection",
        "pragmas": pragmas,
        "table_count": len(tables),
        "index_count": len(indexes),
        "unique_index_checks": unique_index_checks,
        "critical_duplicates": critical_duplicates,
        "warning_duplicates": warning_duplicates,
        "ok": (
            pragmas["journal_mode"].lower() == "wal"
            and pragmas["foreign_keys"] == 1
            and all(unique_index_checks.values())
            and all(value == 0 for value in critical_duplicates.values())
        ),
    }


def collect_quick() -> dict[str, object]:
    with get_connection() as connection:
        pragmas = {
            "journal_mode": connection.execute("PRAGMA journal_mode").fetchone()[0],
            "synchronous": connection.execute("PRAGMA synchronous").fetchone()[0],
            "foreign_keys": connection.execute("PRAGMA foreign_keys").fetchone()[0],
            "busy_timeout": connection.execute("PRAGMA busy_timeout").fetchone()[0],
        }
        table_count = connection.execute("SELECT COUNT(*) AS total FROM sqlite_master WHERE type='table'").fetchone()["total"]
        index_count = connection.execute("SELECT COUNT(*) AS total FROM sqlite_master WHERE type='index'").fetchone()["total"]
    unique_index_checks = {
        table: has_unique_index_for_fields(table, fields)
        for table, fields in CRITICAL_DUPLICATE_CHECKS.items()
    }
    return {
        "connection": "backend.core.database.get_connection",
        "mode": "quick",
        "pragmas": pragmas,
        "table_count": int(table_count),
        "index_count": int(index_count),
        "unique_index_checks": unique_index_checks,
        "critical_duplicates": "skipped_in_quick_mode",
        "warning_duplicates": "skipped_in_quick_mode",
        "ok": pragmas["journal_mode"].lower() == "wal" and pragmas["foreign_keys"] == 1 and all(unique_index_checks.values()),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit SQLite using the application connection.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    parser.add_argument("--quick", action="store_true", help="Skip full-table duplicate scans and validate PRAGMA plus critical unique indexes.")
    args = parser.parse_args()
    result = collect_quick() if args.quick else collect()
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print("SQLite 审查连接：", result["connection"])
        print("PRAGMA：", result["pragmas"])
        print("关键唯一索引：", result["unique_index_checks"])
        print("关键重复键组：", result["critical_duplicates"])
        print("快照重复提示：", result["warning_duplicates"])
        print("结果：", "通过" if result["ok"] else "需排查")
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
