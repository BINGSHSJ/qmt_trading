# QMT 轻量化交易后台 — 部署与运维手册

> 版本: v1.0 (Phase 1)
> 更新日期: 2025-01

---

## 一、环境要求

| 项目 | 要求 |
|------|------|
| Python | 3.10+ |
| 操作系统 | Windows 10/11（QMT SDK 仅支持 Windows） |
| QMT 客户端 | 国金证券 QMT 迅投终端（Phase 1 使用 Mock 模式无需安装） |
| 磁盘空间 | ≥ 500 MB（含 SQLite 数据库 + 日志 + 备份） |
| 网络 | 需访问 QMT 行情/交易网关（Mock 模式无需） |

---

## 二、部署步骤

### 2.1 获取代码

```bash
git clone <repo-url> qmt-backend
cd qmt-backend/backend
```

### 2.2 创建虚拟环境

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 2.3 配置文件

**必须配置 `.env`：**

```ini
# .env
ENV=dev                           # dev / prod
MOCK_MODE=true                    # Phase 1 必须为 true
API_KEY=<替换为强密钥>             # 生产环境必须修改
SECRET_KEY=<替换为随机字符串>
QMT_ACCOUNT_ID=<你的QMT账户ID>
QMT_EXE_PATH=<QMT安装路径>        # Mock 模式可留空
```

**可选修改 `config.dev.yaml`：**

```yaml
server:
  host: "0.0.0.0"
  port: 8000

risk:
  max_single_order_value: 100000   # 单笔最大金额
  max_daily_order_count: 50        # 每日最大下单次数
  max_daily_loss_pct: 5.0          # 每日最大亏损百分比（Phase 2 实装）
```

### 2.4 启动服务

```powershell
# 开发模式
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload

# 生产模式
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1
```

> **注意**: SQLite 不支持多 worker 并发写入，`--workers` 必须为 1。

### 2.5 验证启动

```bash
# 健康检查
curl -H "X-API-Key: <your-key>" http://localhost:8001/api/v1/system-health

# 启动前检查
curl -H "X-API-Key: <your-key>" http://localhost:8001/api/v1/system-preflight

# 前端页面
浏览器打开 http://localhost:8001/static/index.html
```

---

## 三、运维操作

### 3.1 数据库备份

```powershell
# 手动备份
python scripts/backup_db.py

# 仅查看/清理过期备份
python scripts/backup_db.py --cleanup-only

# 备份到指定目录
python scripts/backup_db.py --output D:\backups
```

建议：使用 Windows 任务计划 每日定时执行备份脚本。

### 3.2 数据库恢复

```powershell
# 列出可用备份
python scripts/restore_db.py --list

# 恢复最新备份
python scripts/restore_db.py --latest

# 恢复指定备份
python scripts/restore_db.py runtime\backups\app_20250101_120000.db
```

> **重要**: 恢复前必须停止服务。恢复脚本会自动备份当前数据库。

### 3.3 一键暂停全部策略

```bash
curl -X POST -H "X-API-Key: <your-key>" http://localhost:8001/api/v1/strategies/pause-all
```

或在前端"策略中心"页面点击"一键暂停"按钮。

### 3.4 查看审计日志

```bash
# 查看全部审计日志
curl -H "X-API-Key: <your-key>" http://localhost:8001/api/v1/audit-logs

# 按类型过滤
curl -H "X-API-Key: <your-key>" "http://localhost:8001/api/v1/audit-logs?target_type=strategy"
```

### 3.5 日志文件

日志位于 `runtime/logs/` 目录，按日期轮转：
- `qmt_backend.log` — 当前日志
- `qmt_backend.log.YYYY-MM-DD` — 历史日志

---

## 四、运维红线 ⚠️

### 绝对禁止

1. **禁止关闭 WAL 模式** — SQLite WAL 是并发读写的基础，关闭会导致锁竞争
2. **禁止外部直接写入数据库** — 所有写操作必须通过 API，否则破坏数据一致性
3. **禁止使用默认 API_KEY 上生产** — `dev-api-key` 仅供开发环境
4. **禁止多 worker 运行** — SQLite 不支持多进程并发写入，`--workers 1`
5. **禁止在交易时段重启服务** — 可能导致策略状态丢失、订单遗漏
6. **禁止删除 runtime/ 目录** — 包含心跳文件、策略状态、备份等关键数据

### 必须遵守

1. **改密钥后重启** — 修改 `.env` 后必须重启服务
2. **备份后再升级** — 任何代码更新前先执行 `python scripts/backup_db.py`
3. **监控磁盘空间** — SQLite + 日志会持续增长，确保 > 100MB 可用
4. **定期清理备份** — 备份脚本会自动清理 7 天前的备份，但需确保任务执行
5. **恢复前停服务** — 数据库恢复必须在服务停止后执行

---

## 五、Phase 1 已知限制

| 限制 | 影响 | Phase 2 解决方案 |
|------|------|-----------------|
| Mock 模式 | 无法真实下单 | 对接 QMT SDK 真实 Adapter |
| 固定 API Key | 无用户管理 | JWT 认证 + RBAC 权限 |
| SQLite 单机 | 不支持高并发 | Phase 1 足够，后续评估 PostgreSQL |
| 前端轮询 | 非实时 (3-30s 延迟) | WebSocket 推送 |
| 硬编码交易日历 | 无节假日支持 | 数据库交易日历 + 数据源同步 |
| 单账户 | 仅支持一个 QMT 账户 | 多账户管理 |
| 无止损止盈 | 仅有基础风控规则 | 高级风控引擎 |
| 无策略脚本管理 | 策略手动启停 | 子进程管理器 |
| 无进程守护 | 服务崩溃需手动恢复 | systemd / Windows Service |
| max_daily_loss_pct | 配置已有但未实装 | Phase 2 实时计算亏损率 |

---

## 六、Phase 2 扩展接入指南

Phase 2 接口已在 `app/core/phase2_stubs.py` 中预定义，开发时参照接入：

| 模块 | 接入文件 | 说明 |
|------|---------|------|
| 真实 Adapter | `adapters/factory.py` | mock_mode=false 时实例化 RealXtdataAdapter |
| 高级风控 | `services/risk_service.py` | check_risk() 中链式调用 AdvancedRiskEngine |
| 策略进程 | `services/strategy_service.py` | start_strategy() 中调用 ProcessManager |
| 用户认证 | `core/dependencies.py` | 替换 verify_api_key → verify_jwt_token |
| WS 推送 | `api/ws.py` | ConnectionManager 添加 subscribe/publish |
| 交易日历 | `core/trading_calendar.py` | 替换硬编码为 DB 查询 |
| 多账户 | `services/trading_service.py` | 按策略获取 account_id |

---

## 七、目录结构

```
backend/
├── .env                      # 敏感配置（不提交 Git）
├── config.dev.yaml           # 环境配置
├── requirements.txt          # Python 依赖
├── app/
│   ├── main.py              # FastAPI 入口 + 生命周期
│   ├── api/                 # API 路由
│   │   ├── system.py       # 健康检查、预检、审计
│   │   ├── strategies.py   # 策略 CRUD + 生命周期
│   │   ├── trading.py      # 信号 → 风控 → 下单
│   │   ├── risk.py         # 风控规则 + 事件
│   │   ├── logs.py         # 系统日志
│   │   └── ws.py           # WebSocket
│   ├── core/               # 核心模块
│   │   ├── config.py       # 配置加载
│   │   ├── preflight.py    # 启动前检查
│   │   ├── phase2_stubs.py # Phase 2 接口预留
│   │   ├── trading_calendar.py
│   │   ├── enums.py
│   │   ├── exceptions.py
│   │   ├── response.py
│   │   ├── dependencies.py
│   │   └── logging.py
│   ├── services/           # 业务逻辑
│   │   ├── strategy_service.py
│   │   ├── trading_service.py
│   │   ├── risk_service.py
│   │   └── audit_service.py
│   ├── adapters/           # 外部 SDK 适配
│   │   ├── xtdata_adapter.py
│   │   ├── xttrader_adapter.py
│   │   └── factory.py
│   ├── repositories/       # 数据访问
│   ├── models/             # ORM 模型
│   ├── db/                 # 数据库引擎 + 迁移
│   └── static/             # 前端 SPA
├── scripts/
│   ├── backup_db.py        # 数据库备份
│   ├── restore_db.py       # 数据库恢复
│   └── verify_*.py         # 各阶段验证脚本
└── runtime/                # 运行时数据（不提交 Git）
    ├── heartbeat/
    ├── strategy_state/
    ├── logs/
    └── backups/
```
