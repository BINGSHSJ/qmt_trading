from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
REPORTS = ROOT / "docs" / "reports"
AUTHORITY_FULL_QA_LOG = "logs\\qa\\qa_20260530_045605.log"
AUTHORITY_STATIC_QA_LOG = "logs\\qa\\qa_20260530_051607.log"


def read_text(path: Path) -> str:
    data = path.read_bytes()
    for encoding in ("utf-8-sig", "utf-16"):
        try:
            text = data.decode(encoding)
        except UnicodeDecodeError:
            continue
        if "\x00" not in text:
            return text
    return data.decode("utf-8", errors="ignore").replace("\x00", "")


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT)).replace("\\", "/")


def find_report(name_part: str) -> Path:
    matches = [path for path in REPORTS.glob("*.md") if name_part in path.name]
    if not matches:
        raise FileNotFoundError(f"report not found: {name_part}")
    return sorted(matches)[0]


def require_contains(failures: list[str], path: Path, text: str, needles: list[str]) -> None:
    for needle in needles:
        if needle not in text:
            failures.append(f"missing `{needle}` in {rel(path)}")


def require_not_contains(failures: list[str], path: Path, text: str, needles: list[str]) -> None:
    for needle in needles:
        if re.fullmatch(r"\d+ passed", needle):
            pattern = rf"(?<!\d){re.escape(needle)}"
            found = re.search(pattern, text) is not None
        else:
            found = needle in text
        if found:
            failures.append(f"stale text `{needle}` remains in {rel(path)}")


def check_authoritative_reports(failures: list[str]) -> None:
    index = REPORTS / "INDEX.md"
    readme = ROOT / "README.md"
    reading = find_report("报告阅读说明")
    todo = find_report("当前有效待办边界清单")
    final_qa = find_report("未完成建议最终闭环复核报告")
    final_ui = find_report("后续建议同类问题最终收口报告")

    required_files = [index, readme, reading, todo, final_qa, final_ui, ROOT / AUTHORITY_FULL_QA_LOG, ROOT / AUTHORITY_STATIC_QA_LOG]
    for path in required_files:
        if not path.exists():
            failures.append(f"required authority file missing: {path}")

    index_text = read_text(index)
    readme_text = read_text(readme)
    reading_text = read_text(reading)
    todo_text = read_text(todo)
    final_qa_text = read_text(final_qa)
    final_ui_text = read_text(final_ui)

    require_contains(
        failures,
        index,
        index_text,
        [
            AUTHORITY_FULL_QA_LOG,
            AUTHORITY_STATIC_QA_LOG,
            "前端契约审计",
            "前端样式审计",
            "运行入口审计",
            "仓库卫生审计",
            "SQLite 快速健康审计",
            "报告一致性审计",
        ],
    )
    require_contains(
        failures,
        readme,
        readme_text,
        [
            AUTHORITY_FULL_QA_LOG,
            AUTHORITY_STATIC_QA_LOG,
            "运行入口审计",
            "前端样式审计",
            "仓库卫生审计",
            "报告一致性审计",
            "视觉回归 `24 passed`",
            "冒烟 `56 passed`",
            "17 passed",
            "后续新增交易日需在数据中心显式续跑",
        ],
    )
    require_contains(
        failures,
        reading,
        reading_text,
        [
            "2026-05-30",
            AUTHORITY_FULL_QA_LOG,
            "251 passed",
            AUTHORITY_STATIC_QA_LOG,
            "Playwright 冒烟：56 passed",
            "Playwright 视觉回归：24 passed",
            "17 passed",
            "真实下单仍必须单独人工授权",
        ],
    )
    require_contains(
        failures,
        todo,
        todo_text,
        [
            "2026-05-30",
            "qa.bat",
            AUTHORITY_FULL_QA_LOG,
            "251 passed",
            AUTHORITY_STATIC_QA_LOG,
            "运行入口审计",
            "前端样式审计",
            "仓库卫生审计",
            "Playwright 冒烟：`56 passed`",
            "Playwright 视觉回归：`24 passed`",
            "17 passed",
            "当前可在普通修复批次中自动继续修复的源码问题：无",
        ],
    )
    require_contains(
        failures,
        final_qa,
        final_qa_text,
        [
            "2026-05-30 复核补充",
            AUTHORITY_FULL_QA_LOG,
            AUTHORITY_STATIC_QA_LOG,
            "251 passed",
            "冒烟 `56 passed`",
            "视觉回归 `24 passed`",
            "设备密度 `17 passed`",
            "当前剩余事项均属于需要用户明确授权或单独阶段验收的高风险操作",
        ],
    )
    require_contains(
        failures,
        final_ui,
        final_ui_text,
        [
            "报告一致性审计",
            "运行入口审计",
            "仓库卫生审计",
            AUTHORITY_FULL_QA_LOG,
        ],
    )

    stale_needles = [
        "最新日志待本轮最终 QA 写入",
        "最新 QA 日志",
        "49 passed",
        "Playwright 冒烟：33 passed",
        "Playwright 视觉回归：22 passed",
        "冒烟 `33 passed`",
        "视觉回归 `22 passed`",
        "248 passed",
        "249 passed",
        "当前测试以最新 QA 报告为准，但本文件未更新",
        "40 passed",
        "41 passed",
        "logs\\qa\\qa_20260530_030430.log",
        "logs\\qa\\qa_20260530_025754.log",
        "logs\\qa\\qa_20260530_034206.log",
        "logs\\qa\\qa_20260530_033629.log",
        "logs\\qa\\qa_20260530_041230.log",
        "logs\\qa\\qa_20260530_041131.log",
        "logs\\qa\\qa_20260530_044319.log",
        "logs\\qa\\qa_20260530_045208.log",
    ]
    for path, text in [(index, index_text), (readme, readme_text), (reading, reading_text), (todo, todo_text), (final_qa, final_qa_text), (final_ui, final_ui_text)]:
        require_not_contains(failures, path, text, stale_needles)


def check_index_links(failures: list[str]) -> None:
    index = REPORTS / "INDEX.md"
    text = read_text(index)
    for match in re.finditer(r"`([^`]+\.md)`", text):
        raw = match.group(1)
        if raw.startswith("C:\\") or raw.startswith("c:\\"):
            continue
        if not raw.startswith("docs/"):
            continue
        candidate = ROOT / raw.replace("/", "\\")
        if not candidate.exists():
            failures.append(f"INDEX references missing repo file: {raw}")


def check_authority_qa_log_content(failures: list[str]) -> None:
    expected_fragments = {
        AUTHORITY_FULL_QA_LOG: [
            "all passed.",
            "passed: backend pytest",
            "passed: frontend lint",
            "passed: frontend typecheck",
            "passed: frontend build",
            "passed: report consistency audit",
            "Playwright smoke",
            "Playwright visual regression",
            "Playwright device density",
        ],
        AUTHORITY_STATIC_QA_LOG: [
            "all passed.",
            "Playwright E2E skipped by parameter.",
            "passed: backend pytest",
            "passed: frontend lint",
            "passed: frontend typecheck",
            "passed: frontend build",
            "passed: report consistency audit",
            "passed: sqlite quick health audit",
        ],
    }

    forbidden_line_patterns = [
        re.compile(r"^\s*failed:", re.IGNORECASE),
        re.compile(r"^\s*error:", re.IGNORECASE),
        re.compile(r"Traceback \(most recent call last\)", re.IGNORECASE),
        re.compile(r"\bAssertionError\b", re.IGNORECASE),
        re.compile(r"\bFAILED\b"),
    ]

    for log_path, fragments in expected_fragments.items():
        path = ROOT / log_path
        if not path.exists():
            failures.append(f"authority QA log missing: {log_path}")
            continue
        text = read_text(path)
        for fragment in fragments:
            if fragment not in text:
                failures.append(f"authority QA log missing `{fragment}`: {log_path}")
        for lineno, line in enumerate(text.splitlines(), start=1):
            if any(pattern.search(line) for pattern in forbidden_line_patterns):
                failures.append(f"authority QA log contains failure marker at {log_path}:{lineno}: {line[:160]}")


def main() -> int:
    failures: list[str] = []
    try:
        check_authoritative_reports(failures)
        check_index_links(failures)
        check_authority_qa_log_content(failures)
    except Exception as exc:  # noqa: BLE001 - audit should report context instead of crashing without details
        failures.append(f"report consistency audit crashed: {exc}")

    if failures:
        print("report consistency audit failed")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("report consistency audit passed")
    print(f"- authority full QA log points to {AUTHORITY_FULL_QA_LOG}")
    print(f"- authority static QA log points to {AUTHORITY_STATIC_QA_LOG}")
    print("- report index links resolve for repository-local markdown files")
    print("- authority QA logs contain expected passed markers and no failure markers")
    print("- stale QA counts and pending-log placeholders are blocked")
    return 0


if __name__ == "__main__":
    sys.exit(main())
