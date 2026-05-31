$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root
$RootText = [string]$Root

trap {
  Write-Host ""
  Write-Host "[失败] 停止脚本执行失败。" -ForegroundColor Red
  Write-Host "原因：$($_.Exception.Message)" -ForegroundColor Red
  Write-Host "排查建议：请确认是否有权限停止本地 8000/3000 端口进程。"
  exit 1
}

Write-Host ""
Write-Host "========================================"
Write-Host " 本地量化控制台 - 一键停止"
Write-Host "========================================"
Write-Host ""

$ports = @(8000, 3000)
$connections = Get-NetTCPConnection -LocalPort $ports -State Listen -ErrorAction SilentlyContinue

if (-not $connections) {
  Write-Host "未发现正在监听 8000/3000 端口的本地服务。"
  Write-Host "如果浏览器仍能打开页面，请刷新后再确认。"
  exit 0
}

function Get-ProcessInfo($processId) {
  Get-CimInstance Win32_Process -Filter "ProcessId=$processId" -ErrorAction SilentlyContinue
}

function Test-ProjectProcess($processId, $portsText) {
  $currentId = [int]$processId
  for ($depth = 0; $depth -lt 8 -and $currentId -gt 0; $depth++) {
    $process = Get-ProcessInfo $currentId
    if (-not $process) {
      break
    }
    $commandLine = [string]$process.CommandLine
    if ($commandLine.Contains($RootText)) {
      return $true
    }
    if ($portsText -match "8000" -and $commandLine -like "*backend.main:app*" -and $commandLine -like "*--port 8000*") {
      return $true
    }
    if ($portsText -match "3000" -and $commandLine -like "*vite*" -and $commandLine -like "*--port 3000*" -and $commandLine -like "*miniqmt*") {
      return $true
    }
    $currentId = [int]$process.ParentProcessId
  }
  return $false
}

function Get-ChildProcessIds($parentId) {
  $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$parentId" -ErrorAction SilentlyContinue)
  foreach ($child in $children) {
    [int]$child.ProcessId
    Get-ChildProcessIds $child.ProcessId
  }
}

function Get-ProjectAncestorIds($processId) {
  $ids = @()
  $currentId = [int]$processId
  for ($depth = 0; $depth -lt 8 -and $currentId -gt 0; $depth++) {
    $process = Get-ProcessInfo $currentId
    if (-not $process) {
      break
    }
    $commandLine = [string]$process.CommandLine
    if ($commandLine.Contains($RootText)) {
      $ids += [int]$process.ProcessId
      $currentId = [int]$process.ParentProcessId
      continue
    }
    break
  }
  $ids
}

$groups = $connections | Where-Object { $_.OwningProcess } | Group-Object OwningProcess
foreach ($group in $groups) {
  $processId = [int]$group.Name
  $portText = ($group.Group | Select-Object -ExpandProperty LocalPort -Unique | Sort-Object) -join ", "
  $processName = "未知进程"
  try {
    $processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName
  } catch {
    $processName = "进程已退出"
  }
  if (-not (Test-ProjectProcess $processId $portText)) {
    Write-Host "[跳过] PID $processId，进程 $processName，端口 $portText 不是本项目启动的服务。"
    Write-Host "       如需释放该端口，请手动确认后停止对应程序。"
    continue
  }
  Write-Host "正在停止：PID $processId，进程 $processName，端口 $portText"
  $ancestorIds = @(Get-ProjectAncestorIds $processId)
  $treeIds = @($processId) + $ancestorIds + @(Get-ChildProcessIds $processId)
  foreach ($ancestorId in $ancestorIds) {
    $treeIds += @(Get-ChildProcessIds $ancestorId)
  }
  foreach ($targetId in ($treeIds | Select-Object -Unique | Sort-Object -Descending)) {
    Stop-Process -Id $targetId -Force -ErrorAction SilentlyContinue
  }
  Write-Host "[正常] 已停止 PID $processId 及其子进程"
}

$staleConsoleProcesses = @(
  Get-CimInstance Win32_Process -Filter "Name='cmd.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      ([string]$_.CommandLine).Contains($RootText) -and
      ([string]$_.CommandLine) -like "*title 本地量化控制台*"
    }
)
foreach ($process in $staleConsoleProcesses) {
  Write-Host "正在清理旧版可见终端：PID $($process.ProcessId)"
  $treeIds = @([int]$process.ProcessId) + @(Get-ChildProcessIds ([int]$process.ProcessId))
  foreach ($targetId in ($treeIds | Select-Object -Unique | Sort-Object -Descending)) {
    Stop-Process -Id $targetId -Force -ErrorAction SilentlyContinue
  }
}

$runtimeLogDir = Join-Path $Root "logs\runtime"
$pidFile = Join-Path $runtimeLogDir "service_pids.json"
if (Test-Path -LiteralPath $pidFile) {
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "本地量化控制台已停止。"


