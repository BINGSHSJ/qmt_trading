$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = "utf-8"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

trap {
  Write-Host ""
  Write-Host "[失败] 备份脚本执行失败。" -ForegroundColor Red
  Write-Host "原因：$($_.Exception.Message)" -ForegroundColor Red
  Write-Host "排查建议：请查看 logs\app.log、logs\error.log，或到系统管理 - 操作记录查看详情。"
  exit 1
}

Write-Host ""
Write-Host "========================================"
Write-Host " 本地量化控制台 - 一键备份"
Write-Host "========================================"
Write-Host ""
Write-Host "备份内容：SQLite 数据库、系统配置、用户策略 strategies/user、重要日志 logs。"
Write-Host "源码快照：同时生成一份源码 ZIP，排除数据库、日志、备份、依赖和构建产物。"
Write-Host "备份目录：$Root\backups"
Write-Host ""

function New-SourceSnapshot {
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $snapshotRoot = Join-Path $Root "backups\source_snapshots"
  $snapshotPath = Join-Path $snapshotRoot "source_snapshot_$stamp.zip"
  $stagingRoot = Join-Path ([System.IO.Path]::GetTempPath()) "lqc_source_snapshot_$stamp"
  $rootFull = (Resolve-Path -LiteralPath $Root).Path.TrimEnd("\")
  $sourceItems = @(
    ".gitignore",
    "AGENTS.md",
    "README.md",
    "pytest.ini",
    "start.bat",
    "stop.bat",
    "backup.bat",
    "backend",
    "frontend\src",
    "frontend\tests",
    "frontend\eslint.config.js",
    "frontend\index.html",
    "frontend\package.json",
    "frontend\package-lock.json",
    "frontend\playwright.config.ts",
    "frontend\tsconfig.json",
    "frontend\tsconfig.node.json",
    "frontend\vite.config.ts",
    "scripts",
    "docs",
    "strategies"
  )
  $excludedPatterns = @(
    "\backend\.venv\",
    "\frontend\node_modules\",
    "\frontend\dist\",
    "\frontend\test-results\",
    "\frontend\playwright-report\",
    "\backups\",
    "\data\",
    "\logs\",
    "\test-results\",
    "\.pytest_cache\",
    "\__pycache__\",
    "\LocalQuantConsole_Codex_Docs_Pack_v2_2\"
  )
  $excludedExtensions = @(
    ".pyc", ".pyo", ".db", ".db-wal", ".db-shm", ".log", ".zip", ".tmp",
    ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".ico",
    ".pdf", ".xlsx", ".xls", ".csv", ".parquet", ".feather",
    ".mp4", ".mov", ".avi"
  )

  if (Test-Path -LiteralPath $stagingRoot) {
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Path $stagingRoot | Out-Null
  New-Item -ItemType Directory -Path $snapshotRoot -Force | Out-Null

  try {
    foreach ($item in $sourceItems) {
      $sourcePath = Join-Path $Root $item
      if (-not (Test-Path -LiteralPath $sourcePath)) { continue }

      $files = @()
      if (Test-Path -LiteralPath $sourcePath -PathType Leaf) {
        $files = @(Get-Item -LiteralPath $sourcePath)
      } else {
        $files = @(Get-ChildItem -LiteralPath $sourcePath -Recurse -Force -File)
      }

      foreach ($file in $files) {
        $fullPath = $file.FullName
        $relativePath = $fullPath.Substring($rootFull.Length + 1)
        $normalized = "\" + ($relativePath -replace "/", "\")
        $isExcluded = $false
        foreach ($pattern in $excludedPatterns) {
          if ($normalized.Contains($pattern)) {
            $isExcluded = $true
            break
          }
        }
        if ($isExcluded) { continue }
        if ($excludedExtensions -contains $file.Extension.ToLowerInvariant()) { continue }

        $targetPath = Join-Path $stagingRoot $relativePath
        $targetDir = Split-Path -Parent $targetPath
        if (-not (Test-Path -LiteralPath $targetDir)) {
          New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
        }
        Copy-Item -LiteralPath $fullPath -Destination $targetPath -Force
      }
    }

    $manifest = [ordered]@{
      app_name = "Local Quant Console"
      created_at = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
      purpose = "源码快照，仅用于本地版本追溯；恢复数据库时不会自动覆盖源码。"
      included = $sourceItems
      excluded = @("data", "logs", "backups", "node_modules", "frontend/dist", "backend/.venv", "test-results", "__pycache__", "images", "spreadsheets", "videos")
    } | ConvertTo-Json -Depth 4
    Set-Content -LiteralPath (Join-Path $stagingRoot "source_snapshot_manifest.json") -Value $manifest -Encoding UTF8
    Compress-Archive -Path (Join-Path $stagingRoot "*") -DestinationPath $snapshotPath -Force
    Write-Host "源码快照已创建：$snapshotPath"
  } finally {
    if (Test-Path -LiteralPath $stagingRoot) {
      Remove-Item -LiteralPath $stagingRoot -Recurse -Force
    }
  }
}

$python = Join-Path $Root "backend\.venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) {
  Write-Host "未发现后端虚拟环境，将尝试使用系统 Python。"
  $python = "python"
} else {
  Write-Host "使用后端虚拟环境执行备份。"
}

try {
  Write-Host "正在创建备份，请稍等..."
  & $python "scripts\local_backup.py"
  if ($LASTEXITCODE -ne 0) { throw "backup script failed with code $LASTEXITCODE" }
  New-SourceSnapshot
  Write-Host ""
  Write-Host "[正常] 备份完成。"
  Write-Host "你可以在 系统管理 - 备份恢复 中查看备份记录。"
} catch {
  Write-Host ""
  Write-Host "[失败] 备份失败。"
  Write-Host "请查看 logs\app.log、logs\error.log，或到 系统管理 - 操作记录 查看详情。"
  Write-Host "技术详情：$_"
  exit 1
}


