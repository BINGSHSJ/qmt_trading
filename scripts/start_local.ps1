$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = "utf-8"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

function Get-LanIPv4Addresses {
  $excludedAlias = "Loopback|vEthernet|VMware|VirtualBox|Docker|WSL|Hyper-V|singbox|Tailscale|ZeroTier"
  @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object {
      $_.IPAddress -notlike "127.*" `
        -and $_.IPAddress -notlike "169.254.*" `
        -and $_.PrefixOrigin -ne "WellKnown" `
        -and $_.InterfaceAlias -notmatch $excludedAlias
    } |
    Sort-Object @{ Expression = { if ($_.InterfaceAlias -match "WLAN|Wi-Fi|Ethernet|以太网|无线") { 0 } else { 1 } } }, InterfaceMetric |
    Select-Object -ExpandProperty IPAddress)
}

$LanAddresses = @(Get-LanIPv4Addresses)
$PrimaryLanIp = if ($LanAddresses.Count -gt 0) { $LanAddresses[0] } else { $null }
$LanDashboardUrl = if ($PrimaryLanIp) { "http://$PrimaryLanIp`:3000/dashboard" } else { $null }

trap {
  Write-Host ""
  Write-Host "[失败] 一键启动脚本执行失败。" -ForegroundColor Red
  Write-Host "原因：$($_.Exception.Message)" -ForegroundColor Red
  Write-Host "排查建议：请查看 logs\app.log、logs\error.log，或把本窗口内容复制给 AI 排查。"
  exit 1
}

Write-Host ""
Write-Host "========================================"
Write-Host " 本地量化控制台 - 一键启动"
Write-Host "========================================"
Write-Host ""
Write-Host "项目目录：$Root"
Write-Host "后端地址：http://127.0.0.1:8000"
Write-Host "前端地址：http://127.0.0.1:3000"
if ($LanDashboardUrl) {
  Write-Host "局域网地址：$LanDashboardUrl"
} else {
  Write-Host "局域网地址：未检测到可用 IPv4，启动后可重新运行 start.bat 检查。"
}
Write-Host "日志目录：$Root\logs"
Write-Host ""

$python = Join-Path $Root "backend\.venv\Scripts\python.exe"
if (-not (Test-Path -LiteralPath $python)) {
  Write-Host "[1/6] 首次启动：正在创建后端 Python 虚拟环境..."
  if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
    Write-Host "[失败] 未找到 Python。请安装 Python 3.10 或更高版本后重新运行 start.bat。"
    exit 1
  }
  python -m venv "backend\.venv"
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[失败] 创建 Python 虚拟环境失败。请确认 Python 版本为 3.10 或更高。"
    exit 1
  }
} else {
  Write-Host "[1/6] 后端 Python 虚拟环境已存在。"
}

$python = Join-Path $Root "backend\.venv\Scripts\python.exe"
$depsFlag = Join-Path $Root "backend\.venv\.deps_installed"
$requirementsPath = Join-Path $Root "backend\requirements.txt"
$requirementsHash = (Get-FileHash -LiteralPath $requirementsPath -Algorithm SHA256).Hash
$installedRequirementsHash = ""
if (Test-Path -LiteralPath $depsFlag) {
  $installedRequirementsHash = (Get-Content -LiteralPath $depsFlag -Raw -ErrorAction SilentlyContinue).Trim()
}
if ($installedRequirementsHash -ne $requirementsHash) {
  Write-Host "[2/6] 后端依赖需要安装或更新，首次运行可能需要几分钟..."
  & $python -m pip install -r "backend\requirements.txt"
  if ($LASTEXITCODE -ne 0) {
    Write-Host "[失败] 后端依赖安装失败。请检查网络、Python 环境，或查看上方 pip 错误。"
    exit 1
  }
  $requirementsHash | Set-Content -LiteralPath $depsFlag -Encoding ASCII
} else {
  Write-Host "[2/6] 后端依赖已就绪。"
}

$frontendNodeModules = Join-Path $Root "frontend\node_modules"
$frontendDepsFlag = Join-Path $frontendNodeModules ".deps_installed"
$frontendLockPath = Join-Path $Root "frontend\package-lock.json"
$frontendPackagePath = Join-Path $Root "frontend\package.json"
$frontendDepsHashSource = if (Test-Path -LiteralPath $frontendLockPath) { $frontendLockPath } else { $frontendPackagePath }
$frontendDepsHash = (Get-FileHash -LiteralPath $frontendDepsHashSource -Algorithm SHA256).Hash
$installedFrontendDepsHash = ""
if (Test-Path -LiteralPath $frontendDepsFlag) {
  $installedFrontendDepsHash = (Get-Content -LiteralPath $frontendDepsFlag -Raw -ErrorAction SilentlyContinue).Trim()
}
if ((-not (Test-Path -LiteralPath $frontendNodeModules)) -or $installedFrontendDepsHash -ne $frontendDepsHash) {
  Write-Host "[3/6] 前端依赖需要安装或更新，首次运行可能需要几分钟..."
  $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if (-not $npmCommand) {
    $npmCommand = Get-Command npm -ErrorAction SilentlyContinue
  }
  if (-not $npmCommand) {
    Write-Host "[失败] 未找到 Node.js / npm。请安装 Node.js 后重新运行 start.bat。"
    exit 1
  }
  $npmInstallCommand = if (Test-Path -LiteralPath $frontendLockPath) { "ci" } else { "install" }
  Push-Location "frontend"
  & $npmCommand.Source $npmInstallCommand
  $npmCode = $LASTEXITCODE
  Pop-Location
  if ($npmCode -ne 0) {
    Write-Host "[失败] 前端依赖安装失败。请检查 Node.js、npm 和网络。"
    exit 1
  }
  $frontendDepsHash | Set-Content -LiteralPath $frontendDepsFlag -Encoding ASCII
} else {
  Write-Host "[3/6] 前端依赖已就绪。"
}

Write-Host "[4/6] 正在检查 8000/3000 端口，并停止旧的本地服务..."
& (Join-Path $PSScriptRoot "stop_local.ps1") | Out-Null
$remainingPorts = @(Get-NetTCPConnection -LocalPort @(8000, 3000) -State Listen -ErrorAction SilentlyContinue)
if ($remainingPorts.Count -gt 0) {
  Write-Host "[失败] 8000/3000 端口仍被其他本地程序占用，启动已停止。" -ForegroundColor Red
  foreach ($connection in $remainingPorts) {
    $processName = "未知进程"
    try {
      $processName = (Get-Process -Id $connection.OwningProcess -ErrorAction Stop).ProcessName
    } catch {
      $processName = "进程已退出"
    }
    Write-Host "端口 $($connection.LocalPort)：PID $($connection.OwningProcess)，进程 $processName"
  }
  Write-Host "排查建议：请确认这些端口上的程序是否属于本项目；如不是，请换端口或手动关闭后再运行 start.bat。"
  exit 1
}

$runtimeLogDir = Join-Path $Root "logs\runtime"
New-Item -ItemType Directory -Force -Path $runtimeLogDir | Out-Null
$backendStdout = Join-Path $runtimeLogDir "backend_stdout.log"
$backendStderr = Join-Path $runtimeLogDir "backend_stderr.log"
$frontendStdout = Join-Path $runtimeLogDir "frontend_stdout.log"
$frontendStderr = Join-Path $runtimeLogDir "frontend_stderr.log"
$pidFile = Join-Path $runtimeLogDir "service_pids.json"

Write-Host "[5/6] 正在后台启动后端服务：http://127.0.0.1:8000"
$backendProcess = Start-Process `
  -FilePath $python `
  -ArgumentList @("-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", "8000") `
  -WorkingDirectory $Root `
  -WindowStyle Hidden `
  -RedirectStandardOutput $backendStdout `
  -RedirectStandardError $backendStderr `
  -PassThru

Write-Host "[6/6] 正在后台启动前端页面：http://127.0.0.1:3000"
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCommand) {
  $npmCommand = Get-Command npm -ErrorAction Stop
}
$frontendProcess = Start-Process `
  -FilePath $npmCommand.Source `
  -ArgumentList @("run", "dev") `
  -WorkingDirectory (Join-Path $Root "frontend") `
  -WindowStyle Hidden `
  -RedirectStandardOutput $frontendStdout `
  -RedirectStandardError $frontendStderr `
  -PassThru

@{
  backend_pid = $backendProcess.Id
  frontend_pid = $frontendProcess.Id
  started_at = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
  backend_url = "http://127.0.0.1:8000"
  frontend_url = "http://127.0.0.1:3000"
  backend_stdout = $backendStdout
  backend_stderr = $backendStderr
  frontend_stdout = $frontendStdout
  frontend_stderr = $frontendStderr
} | ConvertTo-Json | Set-Content -LiteralPath $pidFile -Encoding UTF8

Write-Host ""
Write-Host "正在执行启动健康检查，请稍等..."

$backendOk = $false
for ($i = 0; $i -lt 60; $i++) {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/health" -TimeoutSec 2
    if ($health.success) {
      $backendOk = $true
      break
    }
  } catch {
    Start-Sleep -Seconds 1
  }
}
if (-not $backendOk) {
  Write-Host "[失败] 后端健康检查未通过。"
  Write-Host "请查看“本地量化控制台 - 后端服务”窗口，以及 logs\app.log / logs\error.log。"
  exit 1
}
Write-Host "[正常] 后端健康检查通过。"

$frontendOk = $false
for ($i = 0; $i -lt 60; $i++) {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:3000/dashboard" -UseBasicParsing -TimeoutSec 2
    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
      $frontendOk = $true
      break
    }
  } catch {
    Start-Sleep -Seconds 1
  }
}
if (-not $frontendOk) {
  Write-Host "[失败] 前端页面检查未通过。"
  Write-Host "请查看“本地量化控制台 - 前端页面”窗口，确认 npm run dev 是否启动成功。"
  exit 1
}
Write-Host "[正常] 前端页面检查通过。"

if ($LanDashboardUrl) {
  try {
    $lanResponse = Invoke-WebRequest -Uri $LanDashboardUrl -UseBasicParsing -TimeoutSec 3
    if ($lanResponse.StatusCode -ge 200 -and $lanResponse.StatusCode -lt 500) {
      Write-Host "[正常] 局域网页面检查通过：$LanDashboardUrl"
    }
  } catch {
    Write-Host "[提示] 局域网页面暂时无法从本机自检访问：$LanDashboardUrl" -ForegroundColor Yellow
    Write-Host "       如果其他设备也打不开，请允许 Windows 防火墙放行 Node.js 或 3000 端口。"
  }

  try {
    $lanApiHealthUrl = "http://$PrimaryLanIp`:3000/api/health"
    $lanHealth = Invoke-RestMethod -Uri $lanApiHealthUrl -TimeoutSec 3
    if ($lanHealth.success) {
      Write-Host "[正常] 局域网 API 代理检查通过：$lanApiHealthUrl"
    }
  } catch {
    Write-Host "[提示] 局域网 API 代理自检未通过，页面可能能打开但接口无法访问。" -ForegroundColor Yellow
  }

  $shortcutPath = Join-Path $Root "局域网访问本地量化控制台.url"
  @(
    "[InternetShortcut]"
    "URL=$LanDashboardUrl"
  ) | Set-Content -LiteralPath $shortcutPath -Encoding ASCII

  $addressPath = Join-Path $runtimeLogDir "局域网访问地址.txt"
  $addressLines = @(
    "本地量化控制台局域网访问地址"
    ""
    "推荐地址：$LanDashboardUrl"
    ""
    "全部检测到的局域网地址："
  )
  foreach ($ip in $LanAddresses) {
    $addressLines += "http://$ip`:3000/dashboard"
  }
  $addressLines += ""
  $addressLines += "说明：同一局域网设备打开推荐地址即可访问；如打不开，请检查 Windows 防火墙是否放行 Node.js 或 3000 端口。"
  $addressLines | Set-Content -LiteralPath $addressPath -Encoding UTF8
}

Start-Process "http://127.0.0.1:3000/dashboard"

Write-Host ""
Write-Host "========================================"
Write-Host " 本地量化控制台已启动"
Write-Host "========================================"
Write-Host "前端页面：http://127.0.0.1:3000/dashboard"
if ($LanDashboardUrl) {
  Write-Host "局域网页面：$LanDashboardUrl"
  Write-Host "快捷方式：$Root\局域网访问本地量化控制台.url"
  Write-Host "地址文件：$runtimeLogDir\局域网访问地址.txt"
}
Write-Host "后端健康：http://127.0.0.1:8000/api/health"
Write-Host "系统日志：$Root\logs\app.log"
Write-Host "错误日志：$Root\logs\error.log"
Write-Host "运行日志：$runtimeLogDir"
Write-Host "后台说明：服务已在隐藏后台进程运行，关闭本窗口不会停止系统。"
Write-Host "结束使用时，请双击 stop.bat 停止本地服务。"
