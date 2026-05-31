param(
    [switch]$WhatIfOnly
)

$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptRoot
$Workspace = (Resolve-Path -LiteralPath $RepoRoot).Path
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$ScreenshotRoot = Join-Path $RepoRoot "docs\reports\screenshots"
$ArchiveRoot = Join-Path $RepoRoot "backups\report_artifacts"
$ArchiveTarget = Join-Path $ArchiveRoot "unreferenced_screenshots_$Timestamp"

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

function Convert-ToRepoPath {
    param([string]$Path)
    return $Path.Substring($Workspace.Length + 1).Replace("\", "/")
}

if (-not (Test-Path -LiteralPath $ScreenshotRoot)) {
    Write-Host "docs/reports/screenshots not found"
    exit 0
}

$markdownFiles = Get-ChildItem -Path (Join-Path $RepoRoot "docs"), (Join-Path $RepoRoot "README.md") -Recurse -File -Include "*.md" -ErrorAction SilentlyContinue
$referenceTextBuilder = New-Object System.Text.StringBuilder
foreach ($file in $markdownFiles) {
    [void]$referenceTextBuilder.AppendLine((Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 -ErrorAction SilentlyContinue))
}
$referenceText = $referenceTextBuilder.ToString()

$gitOutput = git -C $RepoRoot ls-files --others --exclude-standard -- "docs/reports/screenshots"
if ($LASTEXITCODE -ne 0) {
    throw "git ls-files failed"
}

$candidates = @()
foreach ($rawPath in $gitOutput) {
    if ([string]::IsNullOrWhiteSpace($rawPath)) {
        continue
    }
    $repoPath = $rawPath.Replace("\", "/")
    $fullPath = Join-Path $RepoRoot ($repoPath.Replace("/", "\"))
    if (-not (Test-Path -LiteralPath $fullPath)) {
        continue
    }
    $item = Get-Item -LiteralPath $fullPath -Force
    if ($item.PSIsContainer) {
        continue
    }
    $fileName = $item.Name
    $isReferenced = $referenceText.Contains($repoPath) -or $referenceText.Contains($fileName)
    if (-not $isReferenced) {
        $candidates += [PSCustomObject]@{
            RepoPath = $repoPath
            FullPath = $item.FullName
            Size = $item.Length
        }
    }
}

$totalBytes = ($candidates | Measure-Object Size -Sum).Sum
if ($null -eq $totalBytes) {
    $totalBytes = 0
}

if ($WhatIfOnly) {
    Write-Host "unreferenced screenshot candidates: $($candidates.Count)"
    Write-Host ("candidate size MB: {0:N2}" -f ($totalBytes / 1MB))
    $candidates | Select-Object -First 80 RepoPath,Size | Format-Table -AutoSize
    exit 0
}

if ($candidates.Count -eq 0) {
    Write-Host "no unreferenced screenshot candidates"
    exit 0
}

New-Item -ItemType Directory -Force -Path $ArchiveTarget | Out-Null
$manifest = @()
foreach ($candidate in $candidates) {
    $resolved = Assert-InWorkspace -Path $candidate.FullPath
    $relativeInsideArchive = $candidate.RepoPath.Replace("/", "\")
    $destination = Join-Path $ArchiveTarget $relativeInsideArchive
    $destinationDir = Split-Path -Parent $destination
    New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
    Move-Item -LiteralPath $resolved -Destination $destination -Force
    $manifest += [PSCustomObject]@{
        repo_path = $candidate.RepoPath
        bytes = $candidate.Size
    }
}

$manifestPath = Join-Path $ArchiveTarget "manifest.json"
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
Write-Host "archived unreferenced screenshot candidates: $($candidates.Count)"
Write-Host ("archived size MB: {0:N2}" -f ($totalBytes / 1MB))
Write-Host "archive: $ArchiveTarget"
