from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="ignore")


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT)).replace("\\", "/")


def require_file(failures: list[str], path: Path) -> str:
    if not path.exists():
        failures.append(f"required runtime entry missing: {rel(path)}")
        return ""
    return read_text(path)


def require_contains(failures: list[str], path: Path, text: str, needles: list[str]) -> None:
    for needle in needles:
        if needle not in text:
            failures.append(f"missing `{needle}` in {rel(path)}")


def check_bat_entries(failures: list[str]) -> None:
    bat_to_script = {
        "start.bat": "scripts\\start_local.ps1",
        "stop.bat": "scripts\\stop_local.ps1",
        "backup.bat": "scripts\\backup_local.ps1",
        "qa.bat": "scripts\\qa_gate.ps1",
    }
    for bat_name, script_name in bat_to_script.items():
        path = ROOT / bat_name
        text = require_file(failures, path)
        require_contains(
            failures,
            path,
            text,
            [
                '@echo off',
                'cd /d "%~dp0"',
                f'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0{script_name}"',
                'exit /b %ERRORLEVEL%',
            ],
        )


def check_frontend_dev_entry(failures: list[str]) -> None:
    package_path = ROOT / "frontend" / "package.json"
    package = json.loads(require_file(failures, package_path) or "{}")
    scripts = package.get("scripts") or {}
    dev_script = scripts.get("dev") or ""
    for token in ("vite", "--host 0.0.0.0", "--port 3000", "--strictPort"):
        if token not in dev_script:
            failures.append(f"frontend dev script must include `{token}` in {rel(package_path)}")

    preview_e2e_script = scripts.get("preview:e2e") or ""
    for token in ("vite preview", "--host 127.0.0.1", "--port 3100", "--strictPort"):
        if token not in preview_e2e_script:
            failures.append(f"frontend preview:e2e script must include `{token}` in {rel(package_path)}")

    for script_name in ("e2e:smoke", "e2e:visual", "e2e:device-density"):
        if script_name not in scripts:
            failures.append(f"frontend QA script `{script_name}` missing in {rel(package_path)}")

    vite_path = ROOT / "frontend" / "vite.config.ts"
    vite = require_file(failures, vite_path)
    require_contains(
        failures,
        vite_path,
        vite,
        [
            "host: '0.0.0.0'",
            "port: 3000",
            "strictPort: true",
            "preview: {",
            "host: '127.0.0.1'",
            "port: 3100",
            "target: 'http://127.0.0.1:8000'",
        ],
    )

    playwright_path = ROOT / "frontend" / "playwright.config.ts"
    playwright = require_file(failures, playwright_path)
    require_contains(
        failures,
        playwright_path,
        playwright,
        [
            'npm run build && npm run preview:e2e',
            "url: 'http://127.0.0.1:3100'",
            "baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3100'",
            "reuseExistingServer: false",
        ],
    )
    for stale_port_token in ("--port 3000", "http://localhost:3000", "http://127.0.0.1:3000"):
        if stale_port_token in playwright:
            failures.append(
                f"Playwright E2E must use isolated preview port 3100, found `{stale_port_token}` in {rel(playwright_path)}"
            )


def check_start_script(failures: list[str]) -> None:
    path = ROOT / "scripts" / "start_local.ps1"
    text = require_file(failures, path)
    require_contains(
        failures,
        path,
        text,
        [
            "Get-LanIPv4Addresses",
            "Get-FileHash -LiteralPath $requirementsPath -Algorithm SHA256",
            "Get-FileHash -LiteralPath $frontendDepsHashSource -Algorithm SHA256",
            '$npmInstallCommand = if (Test-Path -LiteralPath $frontendLockPath) { "ci" } else { "install" }',
            "http://$PrimaryLanIp`:3000/dashboard",
            "stop_local.ps1",
            "Get-NetTCPConnection -LocalPort @(8000, 3000)",
            'Start-Process `',
            "-WindowStyle Hidden",
            "service_pids.json",
            "Invoke-RestMethod -Uri \"http://127.0.0.1:8000/api/health\"",
            "Invoke-WebRequest -Uri \"http://127.0.0.1:3000/dashboard\"",
            'Join-Path $runtimeLogDir "局域网访问地址.txt"',
        ],
    )
    if 'Join-Path $Root "局域网访问地址.txt"' in text:
        failures.append(f"start script must not rewrite tracked root LAN address text: {rel(path)}")
    if '"--host", "127.0.0.1", "--port", "8000"' not in text:
        failures.append(f"backend must stay local-only behind Vite proxy: {rel(path)}")


def check_stop_script(failures: list[str]) -> None:
    path = ROOT / "scripts" / "stop_local.ps1"
    text = require_file(failures, path)
    require_contains(
        failures,
        path,
        text,
        [
            "Test-ProjectProcess",
            "[跳过] PID",
            "不是本项目启动的服务",
            "Get-ChildProcessIds",
            "Get-ProjectAncestorIds",
            "service_pids.json",
        ],
    )
    risky = re.findall(r"Stop-Process\s+-Id\s+\$\w+\s+-Force", text)
    if not risky:
        failures.append(f"stop script must explicitly stop only checked process ids: {rel(path)}")


def check_backup_script(failures: list[str]) -> None:
    path = ROOT / "scripts" / "backup_local.ps1"
    text = require_file(failures, path)
    require_contains(
        failures,
        path,
        text,
        [
            "scripts\\local_backup.py",
            "New-SourceSnapshot",
            "source_snapshot_manifest.json",
            "strategies",
            "\\data\\",
            "\\logs\\",
            "\\backups\\",
            "\\frontend\\node_modules\\",
            "\\frontend\\dist\\",
            "\\backend\\.venv\\",
            "Compress-Archive",
        ],
    )


def check_qa_gate_script(failures: list[str]) -> None:
    path = ROOT / "scripts" / "qa_gate.ps1"
    text = require_file(failures, path)
    require_contains(
        failures,
        path,
        text,
        [
            "function Invoke-QAStep",
            '$ErrorActionPreference = "Continue"',
            "$ExitCode = $LASTEXITCODE",
            "Tee-Object -FilePath $LogPath -Append",
            'Invoke-QAStep -Name "frontend style audit"',
            'throw "QA step failed: $Name"',
        ],
    )


def main() -> int:
    failures: list[str] = []
    check_bat_entries(failures)
    check_frontend_dev_entry(failures)
    check_start_script(failures)
    check_stop_script(failures)
    check_backup_script(failures)
    check_qa_gate_script(failures)

    if failures:
        print("runtime entry audit failed")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("runtime entry audit passed")
    print("- start/stop/backup/qa entry scripts are wired to managed PowerShell scripts")
    print("- Vite dev server is LAN-capable and pinned to strict port 3000")
    print("- Playwright E2E is isolated on production preview port 3100")
    print("- backend remains local-only behind frontend proxy")
    print("- stop script skips non-project processes")
    print("- backup script excludes data/logs/dependencies/build outputs from source snapshots")
    return 0


if __name__ == "__main__":
    sys.exit(main())
