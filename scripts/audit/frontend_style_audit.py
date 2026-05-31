from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
FRONTEND_SRC = ROOT / "frontend" / "src"
VARIABLES_FILE = FRONTEND_SRC / "styles" / "variables.css"
ANTD_THEME_FILE = FRONTEND_SRC / "theme" / "antdTheme.ts"

ALLOWED_RAW_COLOR_PATHS = {
    FRONTEND_SRC / "design-system" / "tokens.ts",
    VARIABLES_FILE,
    ANTD_THEME_FILE,
    FRONTEND_SRC / "theme" / "chartTheme.ts",
    FRONTEND_SRC / "theme" / "codeEditorTheme.ts",
    FRONTEND_SRC / "theme" / "global.css",
    FRONTEND_SRC / "theme" / "themeMode.ts",
}

SKIP_DIRS = {"node_modules", "dist", "build", "test-results", "playwright-report"}
SOURCE_SUFFIXES = {".css", ".ts", ".tsx"}

HEX_COLOR = re.compile(r"#[0-9a-fA-F]{3,8}\b")
RAW_RGB = re.compile(r"\brgba?\((?!\s*var\(--lqc-)")
FORBIDDEN_COLOR_WORDS = re.compile(
    r"(?:(?:background|color|border(?:-color)?|outline|box-shadow)\s*:[^;\n]*(?:\bwhite\b|\bblack\b))",
    re.IGNORECASE,
)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT)).replace("\\", "/")


def iter_frontend_source_files():
    for path in FRONTEND_SRC.rglob("*"):
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        if path.is_file() and path.suffix in SOURCE_SUFFIXES:
            yield path


def line_number(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def add_match_failures(
    failures: list[str],
    path: Path,
    text: str,
    pattern: re.Pattern[str],
    label: str,
) -> None:
    for match in pattern.finditer(text):
        line = line_number(text, match.start())
        snippet = text.splitlines()[line - 1].strip()
        failures.append(f"{label}: {rel(path)}:{line}: {snippet}")


def check_raw_colors_are_tokenized(failures: list[str]) -> None:
    for path in iter_frontend_source_files():
        text = read_text(path)
        if path in ALLOWED_RAW_COLOR_PATHS:
            continue

        add_match_failures(
            failures,
            path,
            text,
            HEX_COLOR,
            "raw hex color must stay in design tokens or theme variable files",
        )
        add_match_failures(
            failures,
            path,
            text,
            RAW_RGB,
            "raw rgb/rgba color must use rgba(var(--lqc-...), alpha)",
        )
        add_match_failures(
            failures,
            path,
            text,
            FORBIDDEN_COLOR_WORDS,
            "literal white/black colors must use theme variables",
        )


def check_theme_variable_contract(failures: list[str]) -> None:
    if not VARIABLES_FILE.exists():
        failures.append(f"theme variables file missing: {rel(VARIABLES_FILE)}")
        return

    variables = read_text(VARIABLES_FILE)
    required_fragments = [
        ':root {',
        'html[data-theme="dark"]',
        'html[data-theme="light"]',
        'html[data-density="comfortable"]',
        'html[data-density="compact"]',
        'html[data-density="dense"]',
        "--lqc-primary-rgb:",
        "--lqc-surface-rgb:",
        "--lqc-surface-muted-rgb:",
        "--lqc-shadow-rgb:",
        "--lqc-mask-solid:",
        "--lqc-profit-a:",
        "--lqc-loss-a:",
        "--lqc-control-height:",
        "--lqc-sidebar-width:",
        "--lqc-status-height:",
    ]
    for fragment in required_fragments:
        if fragment not in variables:
            failures.append(f"theme variable contract missing `{fragment}` in {rel(VARIABLES_FILE)}")

    light_block_index = variables.find('html[data-theme="light"]')
    if light_block_index < 0:
        return
    light_block = variables[light_block_index:]
    light_required = [
        "--lqc-primary-rgb:",
        "--lqc-surface-rgb:",
        "--lqc-surface-muted-rgb:",
        "--lqc-shadow-rgb:",
        "--lqc-control-bg:",
        "--lqc-table-bg:",
        "--lqc-scrollbar-track:",
    ]
    for fragment in light_required:
        if fragment not in light_block:
            failures.append(f"light theme variable contract missing `{fragment}` in {rel(VARIABLES_FILE)}")


def check_antd_theme_contract(failures: list[str]) -> None:
    if not ANTD_THEME_FILE.exists():
        failures.append(f"Ant Design theme file missing: {rel(ANTD_THEME_FILE)}")
        return

    theme_text = read_text(ANTD_THEME_FILE)
    required_fragments = [
        "const palettes: Record<ThemeMode, ThemePalette>",
        "mode === 'light' ? antdThemeCore.defaultAlgorithm : antdThemeCore.darkAlgorithm",
        "antdThemeCore.compactAlgorithm",
        "colorBgLayout: palette.colorBgPage",
        "colorBgContainer: palette.colorBgCard",
        "controlHeight: densityToken.controlHeight",
        "Table: {",
        "Input: {",
        "Select: {",
        "DatePicker: {",
    ]
    for fragment in required_fragments:
        if fragment not in theme_text:
            failures.append(f"Ant Design theme contract missing `{fragment}` in {rel(ANTD_THEME_FILE)}")


def collect_summary() -> dict[str, int]:
    css_files = 0
    ts_files = 0
    checked_files = 0
    for path in iter_frontend_source_files():
        checked_files += 1
        if path.suffix == ".css":
            css_files += 1
        else:
            ts_files += 1
    return {
        "checked_files": checked_files,
        "css_files": css_files,
        "ts_tsx_files": ts_files,
    }


def main() -> int:
    failures: list[str] = []
    check_raw_colors_are_tokenized(failures)
    check_theme_variable_contract(failures)
    check_antd_theme_contract(failures)

    if failures:
        print("frontend style audit failed")
        for failure in failures:
            print(f"- {failure}")
        return 1

    summary = collect_summary()
    print("frontend style audit passed")
    print(f"- checked frontend source files: {summary['checked_files']}")
    print("- raw page/component colors are blocked outside token and theme files")
    print("- light/dark theme variables and compact density contracts are present")
    print("- Ant Design v5 theme is wired to mode and density tokens")
    return 0


if __name__ == "__main__":
    sys.exit(main())
