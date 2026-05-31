param(
    [switch]$SkipE2E,
    [switch]$IncludeCapture
)

$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptRoot
$LogDir = Join-Path $RepoRoot "logs\qa"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$LogPath = Join-Path $LogDir "qa_$Timestamp.log"
$FrontendDir = Join-Path $RepoRoot "frontend"

function Write-LogLine {
    param([string]$Message)
    $Message | Tee-Object -FilePath $LogPath -Append
}

function Resolve-Python {
    $VenvPython = Join-Path $RepoRoot "backend\.venv\Scripts\python.exe"
    if (Test-Path $VenvPython) {
        return $VenvPython
    }
    return "python"
}

function Invoke-QAStep {
    param(
        [string]$Name,
        [string]$WorkingDirectory,
        [string]$FilePath,
        [string[]]$Arguments
    )

    Write-LogLine ""
    Write-LogLine "===== $Name ====="
    Write-LogLine "cwd: $WorkingDirectory"
    Write-LogLine "cmd: $FilePath $($Arguments -join ' ')"

    Push-Location $WorkingDirectory
    try {
        $previousErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        & $FilePath @Arguments 2>&1 | Tee-Object -FilePath $LogPath -Append
        $ExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
        Pop-Location
    }

    if ($null -eq $ExitCode) {
        $ExitCode = 0
    }

    if ($ExitCode -ne 0) {
        Write-LogLine "failed: $Name, exit code $ExitCode"
        throw "QA step failed: $Name"
    }

    Write-LogLine "passed: $Name"
}

$Python = Resolve-Python
$Npm = "npm.cmd"

Write-LogLine "Local Quant Console QA gate"
Write-LogLine "started_at: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-LogLine "log_file: $LogPath"
Write-LogLine "note: this script runs tests and build checks only. It does not mutate business data or submit real orders."

Invoke-QAStep -Name "backend pytest" -WorkingDirectory $RepoRoot -FilePath $Python -Arguments @("-m", "pytest", "backend", "-q")
Invoke-QAStep -Name "frontend lint" -WorkingDirectory $FrontendDir -FilePath $Npm -Arguments @("run", "lint")
Invoke-QAStep -Name "frontend typecheck" -WorkingDirectory $FrontendDir -FilePath $Npm -Arguments @("run", "typecheck")
Invoke-QAStep -Name "frontend build" -WorkingDirectory $FrontendDir -FilePath $Npm -Arguments @("run", "build")
Invoke-QAStep -Name "project boundary audit" -WorkingDirectory $RepoRoot -FilePath $Python -Arguments @("scripts/audit/project_boundary_audit.py")
Invoke-QAStep -Name "frontend contract audit" -WorkingDirectory $RepoRoot -FilePath $Python -Arguments @("scripts/audit/frontend_contract_audit.py")
Invoke-QAStep -Name "frontend style audit" -WorkingDirectory $RepoRoot -FilePath $Python -Arguments @("scripts/audit/frontend_style_audit.py")
Invoke-QAStep -Name "runtime entry audit" -WorkingDirectory $RepoRoot -FilePath $Python -Arguments @("scripts/audit/runtime_entry_audit.py")
Invoke-QAStep -Name "repository hygiene audit" -WorkingDirectory $RepoRoot -FilePath $Python -Arguments @("scripts/audit/repository_hygiene_audit.py")
Invoke-QAStep -Name "change inventory audit" -WorkingDirectory $RepoRoot -FilePath $Python -Arguments @("scripts/audit/change_inventory_audit.py", "--fail-on-generated")
Invoke-QAStep -Name "report consistency audit" -WorkingDirectory $RepoRoot -FilePath $Python -Arguments @("scripts/audit/report_consistency_audit.py")
Invoke-QAStep -Name "sqlite quick health audit" -WorkingDirectory $RepoRoot -FilePath $Python -Arguments @("scripts/audit/sqlite_health_check.py", "--quick", "--json")

if ($SkipE2E) {
    Write-LogLine ""
    Write-LogLine "Playwright E2E skipped by parameter."
} else {
    Invoke-QAStep -Name "Playwright smoke" -WorkingDirectory $FrontendDir -FilePath $Npm -Arguments @("run", "e2e:smoke")
    Invoke-QAStep -Name "Playwright visual regression" -WorkingDirectory $FrontendDir -FilePath $Npm -Arguments @("run", "e2e:visual")
    Invoke-QAStep -Name "Playwright device density" -WorkingDirectory $FrontendDir -FilePath $Npm -Arguments @("run", "e2e:device-density")

    if ($IncludeCapture) {
        Invoke-QAStep -Name "Playwright device screenshot baseline" -WorkingDirectory $FrontendDir -FilePath $Npm -Arguments @("run", "e2e:device-density:capture")
    }
}

Write-LogLine ""
Write-LogLine "all passed. finished_at: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-LogLine "log_file: $LogPath"
