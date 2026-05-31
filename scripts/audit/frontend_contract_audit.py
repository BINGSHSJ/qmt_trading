from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SRC_ROOT = ROOT / "frontend" / "src"
SERVICE_ROOT = SRC_ROOT / "services"
REQUEST_FILE = SERVICE_ROOT / "request.ts"

SKIP_DIRS = {
    "node_modules",
    "dist",
    "build",
    "playwright-report",
    "test-results",
}

PROHIBITED_DEBUG_PATTERNS = [
    ("console.log must not remain in frontend source", r"\bconsole\.log\s*\("),
    ("console.debug must not remain in frontend source", r"\bconsole\.debug\s*\("),
    ("debugger must not remain in frontend source", r"\bdebugger\b"),
    ("browser alert must not be used for product errors", r"\balert\s*\("),
]

PROHIBITED_BUSINESS_MOCK_PATTERNS = [
    ("business mock flag must not leak into frontend source", r"\bmock_qmt\s*=\s*true\b"),
    ("business mock flag must not leak into frontend source", r"\bmock_mode\s*=\s*true\b"),
    ("business mock mode must not be presented as a user mode", r"\bqmt_mode\s*:\s*['\"]mock['\"]"),
    ("business mock wording must not return as a product entry", r"\bbusiness_mock\b"),
    ("business mock copy must not appear in user-facing frontend", r"Mock\s*(入口|模式|仅用于|QMT|数据|账户)"),
]


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT)).replace("\\", "/")


def iter_source_files():
    for path in SRC_ROOT.rglob("*"):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.is_file() and path.suffix in {".ts", ".tsx", ".css"}:
            yield path


def line_number(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def add_pattern_failures(failures: list[str], path: Path, text: str, patterns: list[tuple[str, str]]) -> None:
    for label, pattern in patterns:
        for match in re.finditer(pattern, text, flags=re.IGNORECASE | re.MULTILINE):
            line = line_number(text, match.start())
            snippet = text.splitlines()[line - 1].strip()
            failures.append(f"{label}: {rel(path)}:{line}: {snippet}")


def is_under(path: Path, base: Path) -> bool:
    try:
        path.relative_to(base)
        return True
    except ValueError:
        return False


def check_single_request_gateway(failures: list[str]) -> None:
    for path in iter_source_files():
        if path.suffix == ".css":
            continue
        text = read_text(path)
        if path != REQUEST_FILE and re.search(r"\bfetch\s*\(", text):
            add_pattern_failures(failures, path, text, [("frontend fetch must go through services/request.ts", r"\bfetch\s*\(")])
        if re.search(r"^\s*import\s+.*\baxios\b|^\s*import\s+['\"]axios['\"]", text, flags=re.MULTILINE):
            failures.append(f"axios must not be introduced into frontend source: {rel(path)}")
        if not is_under(path, SERVICE_ROOT) and re.search(r"['\"`]\/api\/", text):
            add_pattern_failures(failures, path, text, [("raw /api path must stay inside frontend/src/services", r"['\"`]\/api\/")])


def check_service_request_contract(failures: list[str]) -> None:
    request_text = read_text(REQUEST_FILE)
    required = [
        "const DEFAULT_TIMEOUT_MS = 30000",
        "new AbortController()",
        "NETWORK_ERROR",
        "RESPONSE_PARSE_ERROR",
        "downloadErrorFromResponse",
        "export function buildPageQuery",
        "page_size",
    ]
    for needle in required:
        if needle not in request_text:
            failures.append(f"frontend request contract missing `{needle}` in {rel(REQUEST_FILE)}")

    for path in SERVICE_ROOT.glob("*.ts"):
        if path == REQUEST_FILE:
            continue
        text = read_text(path)
        if "/api/" in text and "request" not in text and "downloadFile" not in text:
            failures.append(f"service API file must use request/downloadFile gateway: {rel(path)}")


def check_debug_and_business_mock_leaks(failures: list[str]) -> None:
    for path in iter_source_files():
        text = read_text(path)
        add_pattern_failures(failures, path, text, PROHIBITED_DEBUG_PATTERNS)
        add_pattern_failures(failures, path, text, PROHIBITED_BUSINESS_MOCK_PATTERNS)


def collect_summary() -> dict[str, object]:
    service_files = sorted(rel(path) for path in SERVICE_ROOT.glob("*.ts"))
    api_literals = 0
    for path in SERVICE_ROOT.glob("*.ts"):
        api_literals += len(re.findall(r"['\"`]\/api\/", read_text(path)))
    return {
        "service_files": service_files,
        "service_file_count": len(service_files),
        "service_api_literal_count": api_literals,
        "request_gateway": rel(REQUEST_FILE),
    }


def main() -> int:
    failures: list[str] = []
    check_single_request_gateway(failures)
    check_service_request_contract(failures)
    check_debug_and_business_mock_leaks(failures)

    if failures:
        print("frontend contract audit failed")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("frontend contract audit passed")
    print(json.dumps(collect_summary(), ensure_ascii=False, indent=2))
    print("- frontend API calls stay inside services")
    print("- frontend fetch stays in services/request.ts")
    print("- request gateway keeps timeout, abort, Chinese network errors, parse diagnostics, downloads, and pagination query builder")
    print("- no debug statements, old business mock flags, or user-facing Mock copy in frontend source")
    return 0


if __name__ == "__main__":
    sys.exit(main())
