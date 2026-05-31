from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MAX_REVIEW_FILE_BYTES = 10 * 1024 * 1024

REQUIRED_GITIGNORE_LINES = [
    "backend/.venv/",
    "__pycache__/",
    ".pytest_cache/",
    "*.pyc",
    "*.pyo",
    "*.log",
    "frontend/node_modules/",
    "frontend/dist/",
    "frontend/test-results/",
    "frontend/playwright-report/",
    "frontend/docs/reports/",
    "docs/reports/ui-audit/",
    "*.tsbuildinfo",
    "data/*",
    "!data/.gitkeep",
    "logs/*",
    "!logs/.gitkeep",
    "backups/",
    "test-results/",
    "*.url",
]

IGNORE_SAMPLES = [
    "data/local_quant_console.db",
    "data/local_quant_console.db-wal",
    "logs/app.log",
    "backups/manual.zip",
    "frontend/node_modules/pkg/index.js",
    "frontend/dist/assets/index.js",
    "frontend/test-results/result.json",
    "frontend/playwright-report/index.html",
    "frontend/debug.log",
    "frontend/docs/reports/ui-audit/result.png",
    "docs/reports/ui-audit/run/result.png",
    "backend/.venv/Scripts/python.exe",
    "__pycache__/x.pyc",
    ".pytest_cache/CACHEDIR.TAG",
    "test-results/result.json",
    "局域网访问本地量化控制台.url",
]

FORBIDDEN_TRACKED_PARTS = {
    "node_modules",
    "dist",
    "build",
    ".venv",
    "__pycache__",
    ".pytest_cache",
    "playwright-report",
    "test-results",
    "backups",
}

FORBIDDEN_TRACKED_SUFFIXES = {
    ".db",
    ".db-wal",
    ".db-shm",
    ".pyc",
    ".pyo",
    ".log",
    ".tmp",
    ".tsbuildinfo",
}

ALLOWED_TRACKED_PLACEHOLDERS = {
    "data/.gitkeep",
    "logs/.gitkeep",
}

STABLE_LAN_GUIDE = ROOT / "局域网访问地址.txt"
REPORT_SCREENSHOT_ROOT = ROOT / "docs" / "reports" / "screenshots"
REPORT_REFERENCE_ROOTS = [ROOT / "README.md", ROOT / "docs"]
REPORT_ARTIFACT_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif"}


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
    return path.replace("\\", "/").strip()


def check_gitignore_lines(failures: list[str]) -> None:
    gitignore = ROOT / ".gitignore"
    if not gitignore.exists():
        failures.append(".gitignore is missing")
        return
    lines = {line.strip() for line in gitignore.read_text(encoding="utf-8", errors="ignore").splitlines()}
    for required in REQUIRED_GITIGNORE_LINES:
        if required not in lines:
            failures.append(f".gitignore missing `{required}`")


def check_ignore_samples(failures: list[str]) -> None:
    for sample in IGNORE_SAMPLES:
        result = run_git(["check-ignore", "-q", sample])
        if result.returncode != 0:
            failures.append(f"generated/local path is not ignored by git: {sample}")


def check_tracked_files(failures: list[str]) -> None:
    result = run_git(["ls-files"])
    if result.returncode != 0:
        failures.append(f"git ls-files failed: {result.stderr.strip()}")
        return

    for raw in result.stdout.splitlines():
        path = normalize(raw)
        if path in ALLOWED_TRACKED_PLACEHOLDERS:
            continue
        parts = set(path.split("/"))
        suffix = Path(path).suffix.lower()
        if parts & FORBIDDEN_TRACKED_PARTS:
            failures.append(f"generated/local directory is tracked: {path}")
        if suffix in FORBIDDEN_TRACKED_SUFFIXES:
            failures.append(f"generated/local file type is tracked: {path}")


def check_large_tracked_files(failures: list[str]) -> None:
    result = run_git(["ls-files"])
    if result.returncode != 0:
        return
    for raw in result.stdout.splitlines():
        path = normalize(raw)
        full_path = ROOT / path
        if not full_path.exists() or not full_path.is_file():
            continue
        size = full_path.stat().st_size
        if size > MAX_REVIEW_FILE_BYTES:
            failures.append(f"tracked file exceeds 10MB and should be reviewed: {path} ({size} bytes)")


def check_large_untracked_files(failures: list[str]) -> None:
    result = run_git(["ls-files", "--others", "--exclude-standard"])
    if result.returncode != 0:
        failures.append(f"git ls-files --others failed: {result.stderr.strip()}")
        return

    for raw in result.stdout.splitlines():
        path = normalize(raw)
        full_path = ROOT / path
        if not full_path.exists() or not full_path.is_file():
            continue
        size = full_path.stat().st_size
        if size > MAX_REVIEW_FILE_BYTES:
            failures.append(f"untracked file exceeds 10MB and should be reviewed before commit: {path} ({size} bytes)")


def check_misplaced_frontend_docs(failures: list[str]) -> None:
    frontend_docs = ROOT / "frontend" / "docs"
    if frontend_docs.exists():
        failures.append("generated audit docs must not live under frontend/docs; use docs/reports or backups/report_artifacts")


def check_stable_lan_access_guide(failures: list[str]) -> None:
    if not STABLE_LAN_GUIDE.exists():
        failures.append("stable LAN access guide is missing: 局域网访问地址.txt")
        return

    text = STABLE_LAN_GUIDE.read_text(encoding="utf-8", errors="ignore")
    required_fragments = [
        "请运行 start.bat 启动系统",
        "logs\\runtime\\局域网访问地址.txt",
        "局域网访问本地量化控制台.url",
    ]
    for fragment in required_fragments:
        if fragment not in text:
            failures.append(f"stable LAN access guide missing `{fragment}`")

    if "http://192.168." in text or "http://10." in text or "http://172." in text:
        failures.append("stable LAN access guide must not contain machine-specific runtime IP addresses")


def iter_markdown_reference_files() -> list[Path]:
    files: list[Path] = []
    for root in REPORT_REFERENCE_ROOTS:
        if root.is_file() and root.suffix.lower() == ".md":
            files.append(root)
            continue
        if not root.exists():
            continue
        for path in root.rglob("*.md"):
            if path.is_file():
                files.append(path)
    return files


def report_reference_text() -> str:
    parts: list[str] = []
    for path in iter_markdown_reference_files():
        parts.append(path.read_text(encoding="utf-8", errors="ignore"))
    return "\n".join(parts)


def untracked_report_screenshots() -> list[Path]:
    result = run_git(["ls-files", "--others", "--exclude-standard", "--", "docs/reports/screenshots"])
    if result.returncode != 0:
        return []
    paths: list[Path] = []
    for raw in result.stdout.splitlines():
        path = ROOT / normalize(raw)
        if path.exists() and path.is_file() and path.suffix.lower() in REPORT_ARTIFACT_SUFFIXES:
            paths.append(path)
    return paths


def check_unreferenced_report_screenshots(failures: list[str]) -> None:
    if not REPORT_SCREENSHOT_ROOT.exists():
        return

    reference_text = report_reference_text()
    unreferenced: list[str] = []
    for path in untracked_report_screenshots():
        repo_path = normalize(str(path.relative_to(ROOT)))
        if repo_path in reference_text or path.name in reference_text:
            continue
        unreferenced.append(repo_path)

    for repo_path in sorted(unreferenced)[:80]:
        failures.append(f"untracked report screenshot is not referenced by README/docs markdown: {repo_path}")
    if len(unreferenced) > 80:
        failures.append(f"report screenshot reference audit found {len(unreferenced) - 80} additional unreferenced files")


def main() -> int:
    failures: list[str] = []
    check_gitignore_lines(failures)
    check_ignore_samples(failures)
    check_tracked_files(failures)
    check_large_tracked_files(failures)
    check_large_untracked_files(failures)
    check_misplaced_frontend_docs(failures)
    check_stable_lan_access_guide(failures)
    check_unreferenced_report_screenshots(failures)

    if failures:
        print("repository hygiene audit failed")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("repository hygiene audit passed")
    print("- .gitignore protects runtime data, logs, backups, dependencies, build outputs, and test artifacts")
    print("- tracked files do not include generated local data except data/logs .gitkeep placeholders")
    print("- tracked and untracked files do not exceed the 10MB review threshold")
    print("- untracked report screenshots under docs/reports/screenshots are referenced by README/docs markdown")
    print("- stable LAN access guide points to logs/runtime without committing runtime IP addresses")
    return 0


if __name__ == "__main__":
    sys.exit(main())
