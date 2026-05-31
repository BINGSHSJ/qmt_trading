from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import Counter, defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]

GENERATED_PARTS = {
    ".pytest_cache",
    "__pycache__",
    "dist",
    "node_modules",
    "playwright-report",
    "test-results",
    "tmp",
}

GENERATED_SUFFIXES = {
    ".db",
    ".db-shm",
    ".db-wal",
    ".log",
    ".pyc",
    ".pyo",
    ".tmp",
    ".tsbuildinfo",
}

MISPLACED_GENERATED_PREFIXES = {
    "frontend/docs/",
    "docs/reports/ui-audit/",
}

PROTECTED_PREFIXES = {
    "data/",
    "logs/",
    "backups/",
    "strategies/user/",
}


@dataclass(frozen=True)
class ChangeItem:
    status: str
    path: str
    category: str
    action: str


def run_git(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-c", "core.quotepath=false", *args],
        cwd=ROOT,
        text=True,
        encoding="utf-8",
        errors="replace",
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )


def normalize(path: str) -> str:
    return path.replace("\\", "/").strip().strip('"')


def git_status() -> list[tuple[str, str]]:
    result = run_git(["status", "--short"])
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "git status failed")

    rows: list[tuple[str, str]] = []
    for line in result.stdout.splitlines():
        if not line:
            continue
        status = line[:2].strip() or "M"
        path = normalize(line[3:] if len(line) > 3 else "")
        if " -> " in path:
            path = normalize(path.split(" -> ", 1)[1])
        rows.append((status, path))
    return rows


def classify(path: str) -> tuple[str, str]:
    parts = set(path.split("/"))
    suffix = Path(path).suffix.lower()

    if any(path.startswith(prefix) for prefix in PROTECTED_PREFIXES):
        if path.startswith("strategies/user/"):
            return "protected_user_strategy", "manual_review_do_not_delete"
        return "protected_runtime_data", "manual_review_do_not_delete"

    if any(path.startswith(prefix) for prefix in MISPLACED_GENERATED_PREFIXES):
        return "misplaced_generated_artifact", "archive_or_delete"

    if parts & GENERATED_PARTS or suffix in GENERATED_SUFFIXES:
        return "generated_artifact", "clean_or_ignore"

    if path.startswith("frontend/src/"):
        return "frontend_source", "review_then_commit"
    if path.startswith("frontend/tests/"):
        return "frontend_test", "review_then_commit"
    if path.startswith("frontend/"):
        return "frontend_config", "review_then_commit"
    if path.startswith("backend/tests/"):
        return "backend_test", "review_then_commit"
    if path.startswith("backend/"):
        return "backend_source", "review_then_commit"
    if path.startswith("scripts/"):
        return "tooling_script", "review_then_commit"
    if path.startswith("docs/reports/screenshots/"):
        return "report_screenshot_evidence", "keep_or_archive_after_reference_check"
    if path.startswith("docs/reports/") and suffix == ".md":
        return "report_markdown", "review_then_commit_or_archive"
    if path.startswith("docs/"):
        return "project_documentation", "review_then_commit"
    if path in {".gitignore", "README.md", "qa.bat", "局域网访问地址.txt"}:
        return "project_entry_or_policy", "review_then_commit"
    return "other", "manual_review"


def build_inventory() -> list[ChangeItem]:
    return [
        ChangeItem(status=status, path=path, category=classify(path)[0], action=classify(path)[1])
        for status, path in git_status()
    ]


def find_failures(items: list[ChangeItem]) -> list[str]:
    failures: list[str] = []
    for item in items:
        if item.category in {"generated_artifact", "misplaced_generated_artifact"}:
            failures.append(f"{item.category}: {item.path}")
    return failures


def write_report(items: list[ChangeItem], report_path: Path, failures: list[str]) -> None:
    by_category = Counter(item.category for item in items)
    by_status = Counter(item.status for item in items)
    grouped: dict[str, list[ChangeItem]] = defaultdict(list)
    for item in items:
        grouped[item.category].append(item)

    lines: list[str] = [
        "# 仓库变更清单审计报告（自动生成）",
        "",
        "## 结论",
        "",
        "当前工作区存在真实项目变更，需要提交前人工确认边界；本报告只分类，不删除任何文件。",
        "",
        f"- 变更总数：{len(items)}",
        f"- 状态分布：{dict(sorted(by_status.items()))}",
        f"- 分类分布：{dict(sorted(by_category.items()))}",
        "",
        "## 自动阻断项",
        "",
    ]
    if failures:
        lines.extend(f"- {failure}" for failure in failures)
    else:
        lines.append("- 未发现缓存、构建产物、误落报告目录等应清理项。")

    lines.extend(["", "## 分类明细", ""])
    for category in sorted(grouped):
        lines.append(f"### {category}")
        lines.append("")
        for item in sorted(grouped[category], key=lambda value: value.path):
            lines.append(f"- `{item.status}` `{item.path}`：{item.action}")
        lines.append("")

    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit current git change inventory without mutating files.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable inventory JSON.")
    parser.add_argument("--write-report", type=Path, help="Write a markdown inventory report.")
    parser.add_argument(
        "--fail-on-generated",
        action="store_true",
        help="Exit non-zero when generated or misplaced generated artifacts appear in git status.",
    )
    args = parser.parse_args()

    try:
        items = build_inventory()
        failures = find_failures(items)
        if args.write_report:
            write_report(items, ROOT / args.write_report, failures)
        if args.json:
            print(json.dumps([asdict(item) for item in items], ensure_ascii=False, indent=2))
        else:
            print("change inventory audit completed")
            print(f"- total changes: {len(items)}")
            for category, count in sorted(Counter(item.category for item in items).items()):
                print(f"- {category}: {count}")
            if failures:
                print("- generated cleanup candidates:")
                for failure in failures:
                    print(f"  - {failure}")
            else:
                print("- no generated cleanup candidates found")
    except Exception as exc:  # noqa: BLE001
        print(f"change inventory audit failed: {exc}")
        return 1

    if args.fail_on_generated and failures:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
