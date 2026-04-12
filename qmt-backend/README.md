# QMT 轻量化交易后台

基于国金 QMT 的轻量级单体量化交易后台：单机部署、模块分层、可视化管理。

## 目录结构

```
backend/
├── app/
│   ├── main.py              # FastAPI 应用入口
│   ├── api/                  # API 路由层（参数接收、鉴权、返回统一响应）
│   ├── services/             # Service 层（业务编排、风控校验、状态整合）
│   ├── adapters/             # Adapter 层（QMT 接口调用、字段转换、异常处理）
│   ├── models/               # 数据模型层（SQLAlchemy ORM 表定义）
│   ├── repositories/         # Repository 层（SQLite 读写、查询封装）
│   ├── core/                 # 公共模块（配置、枚举、响应格式、依赖注入、交易日历）
│   └── db/                   # 数据库引擎初始化、WAL 设置
├── frontend-admin/           # React 管理前端 (Vite + antd)
├── migrations/               # 数据库迁移脚本（YYYYMMDD_HHMM_description.sql）
├── scripts/                  # 工具脚本（种子数据、备份等）
├── static/                   # 前端构建产物（FastAPI 挂载）
├── runtime/                  # 运行时文件（不提交 Git）
│   ├── heartbeat/            # 策略心跳文件
│   ├── strategy_state/       # 策略状态文件
│   ├── backups/              # 数据库备份
│   └── logs/                 # 日志文件
├── .env                      # 环境变量（不提交 Git）
├── config.dev.yaml           # 开发环境配置
└── requirements.txt          # Python 依赖
docs/
├── mvp_scope.md              # 第一阶段 MVP 规格冻结
```

## 快速开始

### 环境要求

- Python 3.10+
- Node.js 18+（前端构建）
- Windows（QMT 仅支持 Windows）

### 安装

```powershell
# 后端
cd backend
python -m venv .venv
.venv\Scripts\pip.exe install -r requirements.txt

# 前端
cd frontend-admin
npm install
```

### 配置

```powershell
# backend/.env 关键变量：
#   MOCK_MODE=false   ← false 启用真实 QMT 连接
#   API_KEY=xxx       ← 接口鉴权密钥（前后端一致）
#   ENV=dev           ← 加载 config.dev.yaml
#   SECRET_KEY=xxx    ← 会话签名密钥（生产环境必改）

# frontend-admin/.env
#   VITE_API_KEY=xxx  ← 与后端 API_KEY 保持一致
```

### 启动

```powershell
cd backend
$env:PYTHONPATH="$PWD"
.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

### 前端开发

```powershell
cd backend/frontend-admin
npm run dev    # 启动 Vite 开发服务器，自动代理到后端
npm run build  # 构建到 ../static/
```

### 验证

```powershell
# 健康检查（需 API Key）
curl -H "X-API-Key: dev-api-key-change-me" http://localhost:8001/api/v1/health

# 自动生成的 API 文档
# http://localhost:8001/docs
```

## 架构链路

```
前端 → FastAPI API → Service → Risk → Adapter → QMT
          ↓                                ↓
     SQLite (WAL)                    行情/交易
```

前端不直连 QMT，所有链路强制走 API → Service → Risk → Adapter。

## 认证与安全

### 认证流程

1. **X-API-Key Header**（主认证方式）：前端和脚本在每个请求头中携带 `X-API-Key`
2. **HttpOnly Cookie**（兼容方式）：`POST /api/v1/auth/session` 需携带 `X-API-Key` 后下发 HttpOnly Cookie
3. **WebSocket 认证**：通过一次性 Ticket（`GET /api/v1/auth/ws-ticket`）或 Cookie 认证

### 速率限制

配置在 `config.dev.yaml` 的 `rate_limit` 段，默认关闭：

```yaml
rate_limit:
  enabled: true          # 启用速率限制
  max_per_second: 10     # 每个 endpoint 每个 IP 每秒最大请求数
```

超限返回 HTTP 429 + `Retry-After: 1` 响应头。

## Non-Mock（真实 QMT）集成指南

### 前置条件

1. 安装国金 QMT 客户端并完成登录
2. 在 `.env` 中配置：
   ```
   MOCK_MODE=false
   QMT_ACCOUNT_ID=你的资金账号
   QMT_EXE_PATH=C:\国金QMT\XtMiniQmt.exe
   ```
3. 确保 QMT Mini 客户端已启动

### 启动前检查（Preflight）

系统启动时自动执行 7 项检查：

| 检查项 | 级别 | 说明 |
|--------|------|------|
| 环境变量 | warning | API_KEY/SECRET_KEY 是否使用默认值 |
| YAML 配置 | critical | 必要配置段是否齐全 |
| 数据库 | critical | SQLite WAL 模式 + 连接正常 |
| 运行时目录 | critical | heartbeat/logs 等目录可写 |
| Adapter 连接 | warning | xtdata/xttrader 连接状态 |
| 磁盘空间 | warning | 剩余 >100MB |
| 时间同步 | warning | 与 NTP 偏差 <5 秒 |

Critical 级失败项会阻断策略启动；Warning 级仅记录日志。

### WebSocket 实时推送

连接 `ws://<host>:<port>/ws?ticket=<ticket>`，服务端推送：

- `trade_fill` — 成交回报
- `risk_alert` — 风控拦截
- `system_error` — 系统异常（500 级）
- `strategy_error` — 策略异常

### API 端点速览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/health` | 系统健康 |
| GET | `/api/v1/system-health` | 详细健康状态 |
| POST | `/api/v1/auth/session` | 创建会话（需 X-API-Key） |
| GET | `/api/v1/auth/ws-ticket` | 获取 WS 票据 |
| GET | `/api/v1/strategies` | 策略列表 |
| POST | `/api/v1/strategies` | 注册策略 |
| POST | `/api/v1/strategies/{id}/start` | 启动策略 |
| POST | `/api/v1/strategies/{id}/stop` | 停止策略 |
| POST | `/api/v1/trading/signals` | 提交交易信号 |
| GET | `/api/v1/trading/orders` | 委托列表 |
| GET | `/api/v1/trading/fills` | 成交列表 |
| GET | `/api/v1/trading/positions` | 持仓列表 |
| GET | `/api/v1/risk/rules` | 风控规则 |
| GET | `/api/v1/risk/events` | 风控事件 |
| GET | `/api/v1/logs` | 系统日志 |

## 文档

- 架构设计: `qmt_lightweight_architecture_v2_8.md`
- MVP 规格冻结: [docs/mvp_scope.md](docs/mvp_scope.md)
