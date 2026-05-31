param(
    [switch]$ArchiveAuditEvidence
)

$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptRoot
$Workspace = (Resolve-Path -LiteralPath $RepoRoot).Path
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"

function Assert-InWorkspace {
    param([string]$Path)
    $resolved = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path
    if (-not $resolved.StartsWith($Workspace, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing path outside workspace: $resolved"
    }
    if ($resolved -like "*\backend\.venv\*" -or $resolved -like "*\frontend\node_modules\*") {
        throw "Refusing dependency/runtime path: $resolved"
    }
    return $resolved
}

function Remove-SafePath {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }
    $resolved = Assert-InWorkspace -Path $Path
    Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction Stop
    Write-Host "removed $resolved"
}

Push-Location $RepoRoot
try {
    $safeTargets = @(
        ".pytest_cache",
        "backend\.pytest_cache",
        "test-results",
        "frontend\test-results",
        "frontend\dist",
        "frontend\debug.log",
        "tmp",
        "frontend\docs"
    )

    foreach ($target in $safeTargets) {
        Remove-SafePath -Path (Join-Path $RepoRoot $target)
    }

    $pyCaches = Get-ChildItem -Path "backend","strategies" -Recurse -Force -Directory -Filter "__pycache__" -ErrorAction SilentlyContinue |
        Where-Object {
            $_.FullName -notlike "*\backend\.venv\*" -and
            $_.FullName -notlike "*\frontend\node_modules\*"
        }

    foreach ($cache in $pyCaches) {
        Remove-SafePath -Path $cache.FullName
    }

    if ($ArchiveAuditEvidence) {
        $source = Join-Path $RepoRoot "docs\reports\ui-audit"
        if (Test-Path -LiteralPath $source) {
            $resolvedSource = Assert-InWorkspace -Path $source
            $archiveRoot = Join-Path $RepoRoot "backups\report_artifacts"
            New-Item -ItemType Directory -Force -Path $archiveRoot | Out-Null
            $destination = Join-Path $archiveRoot "ui-audit_$Timestamp"
            Move-Item -LiteralPath $resolvedSource -Destination $destination -Force
            Write-Host "archived $resolvedSource to $destination"
        }
    }

    Write-Host "generated artifact cleanup completed"
}
finally {
    Pop-Location
}
