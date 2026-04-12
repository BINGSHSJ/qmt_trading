# 第一阶段 MVP 规格冻结

> 基准文档: `qmt_lightweight_architecture_v2_8.md` §十七
> 冻结日期: 2026-04-11
> 本文件一旦写定，第一阶段开发期间只允许缩减、不允许扩充。

---

## 一、第一阶段目标

交付一个 **Mock 模式下可完整运行** 的最小可用后台，验证全链路（前端 → API → Service → Risk → Adapter）在无真实 QMT 环境下跑通。

---

## 二、接口范围

所有接口统一前缀 `/api/v1/`，统一响应格式 `{ code, message, data, timestamp, request_id }`。

### 2.1 纳入范围

| 模块 | 方法 | 路由 | 说明 |
|------|------|------|------|
| Dashboard | GET | `/api/v1/dashboard` | 首页总览聚合（系统状态、资产、策略数、信号数等） |
| Strategy | GET | `/api/v1/strategies` | 策略列表 |
| Strategy | POST | `/api/v1/strategies` | 注册策略 |
| Strategy | GET | `/api/v1/strategies/{strategy_id}` | 策略详情 |
| Strategy | POST | `/api/v1/strategies/{strategy_id}/start` | 启动策略 |
| Strategy | POST | `/api/v1/strategies/{strategy_id}/stop` | 停止策略 |
| Trading | POST | `/api/v1/signals` | 提交信号（信号 → 风控 → 下单） |
| Trading | GET | `/api/v1/signals` | 信号列表 |
| Trading | GET | `/api/v1/positions` | 当前持仓 |
| Trading | GET | `/api/v1/orders` | 委托列表 |
| Trading | GET | `/api/v1/fills` | 成交列表 |
| Risk | GET | `/api/v1/risk/rules` | 风控规则列表 |
| Risk | GET | `/api/v1/risk/events` | 风控拦截记录 |
| System | GET | `/api/v1/system-health` | QMT 健康检查 |
| System | GET | `/api/v1/logs` | 系统日志 |

### 2.2 不纳入（推迟到第二、三阶段）

- 非执行原因结构化接口
- 手工仓 / 策略仓分层接口
- 策略心跳自动重启接口
- 配置变更审计接口
- 通知 / Webhook 出口
- 权限管理接口（admin/trader/observer）
- 一键暂停全部策略
- 手动接管状态切换
- 备份 / 恢复接口

---

## 三、页面范围

第一阶段前端为 FastAPI 挂载的静态 HTML，不引入 React/Ant Design 构建流程。

### 3.1 纳入范围

| 页面 | 路径 | 说明 |
|------|------|------|
| 总览 Dashboard | `/static/index.html` | 系统状态、资产、策略计数、信号计数 |
| 策略列表 | Dashboard 内嵌表格 | 策略 ID、名称、状态、最近心跳 |
| 持仓列表 | Dashboard 内嵌表格 | 标的、持仓、市值、盈亏 |

### 3.2 不纳入

- 独立的交易中心页（委托 / 成交详情页）
- 独立的风控中心页
- 独立的日志中心页
- 策略详情弹窗 / 子页面
- 为什么没交易专区
- 高风险操作二次确认弹窗

---

## 四、数据表范围

所有表 id 主键自增、时间字段默认当前时间、status 有默认值、金额数量默认 0 且不允许 NULL。

### 4.1 纳入范围

| 表名 | 用途 | 关键索引 |
|------|------|----------|
| `strategy` | 策略元数据 | `strategy_id` UNIQUE |
| `strategy_runtime_state` | 策略运行时状态 | `strategy_id` |
| `signal_record` | 策略信号记录 | `(strategy_id, created_at)` |
| `order_record` | 委托记录 | `(strategy_id, created_at)` |
| `fill_record` | 成交记录 | `order_id` |
| `position_snapshot` | 持仓快照 | `(account_id, symbol, snapshot_time)` |
| `risk_rule` | 风控规则 | — |
| `risk_event` | 风控拦截事件 | `(strategy_id, created_at)`, `risk_level` |
| `system_log` | 系统日志 | `(module, created_at)` |

### 4.2 不纳入

- 配置变更审计表（`config_audit`）
- 权限 / 用户表
- 通知记录表
- 交易日历表（第一阶段用代码内置简化判断）

---

## 五、核心模块范围

### 5.1 纳入范围

| 包 | 模块文件 | 职责 |
|---|---|---|
| `core/` | `config.py` | .env + config.{ENV}.yaml 加载 |
| `core/` | `response.py` | 统一响应格式 + 错误码常量 |
| `core/` | `enums.py` | 状态枚举总表（§十六） |
| `core/` | `dependencies.py` | FastAPI 依赖注入（DB 会话、API_KEY 鉴权） |
| `core/` | `trading_calendar.py` | 交易时段 / 交易日判断 |
| `core/` | `startup_check.py` | 启动前依赖检查 |
| `db/` | `database.py` | SQLite 引擎、WAL、busy_timeout、会话工厂 |
| `models/` | `base.py` | SQLAlchemy 声明基类 |
| `models/` | `tables.py` | 全部 ORM 表定义 |
| `adapters/` | `xtdata_adapter.py` | 行情适配器（先 Mock，后真实） |
| `adapters/` | `xttrader_adapter.py` | 交易适配器（先 Mock，后真实） |
| `repositories/` | `strategy_repo.py` | 策略 CRUD |
| `repositories/` | `trading_repo.py` | 信号 / 订单 / 成交 / 持仓 CRUD |
| `repositories/` | `risk_repo.py` | 风控规则 / 事件 CRUD |
| `repositories/` | `log_repo.py` | 系统日志 CRUD |
| `services/` | `dashboard_service.py` | 首页总览数据聚合 |
| `services/` | `strategy_service.py` | 策略生命周期管理 |
| `services/` | `trading_service.py` | 信号 → 风控 → 下单编排 |
| `services/` | `risk_service.py` | 下单前风控校验 |
| `services/` | `health_service.py` | QMT 健康检查 |
| `api/` | `dashboard.py` | Dashboard 路由 |
| `api/` | `strategies.py` | 策略路由 |
| `api/` | `trading.py` | 信号 / 持仓 / 委托 / 成交路由 |
| `api/` | `risk.py` | 风控路由 |
| `api/` | `system.py` | 健康检查 / 日志路由 |

### 5.2 不纳入

- WebSocket 推送模块
- 通知 / Webhook 出口模块
- 策略进程管理器（start_script / stop_script 执行）
- 配置变更审计 service
- 权限 service / middleware
- 自动备份脚本
- 日志清理定时任务
- API 限流 middleware

---

## 六、技术约束（硬性）

1. 单体 FastAPI，内部模块化
2. SQLite 本地文件，启用 WAL 和 busy_timeout=5000ms
3. 前端静态资源由 FastAPI 挂载 `/static/`
4. 不引入 Redis、Kafka、Celery、gRPC、微服务
5. 前端不直连 QMT；链路必须走 API → Service → Risk → Adapter
6. 必须先 `mock_mode=true` 跑通全链路，再接真实 QMT
7. 统一响应格式 `{ code, message, data, timestamp, request_id }`
8. 错误码按文档 §十五 区间划分（0 / 1000-6999）
9. 目录和命名遵循文档 §七 和 §十六
10. 鉴权：第一阶段固定 API_KEY（Header `X-API-Key`）

---

## 七、Mock 模式约定

- `.env` 中 `MOCK_MODE=true` 启用
- Mock 模式下 adapter 返回固定模拟数据，不调用 xtdata / xttrader
- Mock 模式下也走统一 API 响应格式、错误码、页面轮询
- Mock 目的：开发验收、无 QMT 环境演示、CI 测试

---

## 八、错误码区间

| 区间 | 含义 | 示例 |
|------|------|------|
| 0 | 成功 | — |
| 1000-1999 | 参数错误 | 1001 必填参数缺失 |
| 2000-2999 | 业务错误 | 2002 风控拦截 |
| 3000-3999 | 系统错误 | 3001 数据库错误 |
| 4000-4999 | 权限错误 | 4001 API_KEY 缺失 |
| 5000-5999 | 外部依赖错误 | 5003 xttrader 断连 |
| 6000-6999 | 策略运行错误 | 6001 策略心跳超时 |

---

## 九、状态枚举（冻结）

直接引用文档 §十六 状态枚举总表，不额外新增：

- **strategy_status**: registered / loaded / running / paused / pending_restart / error / stopped
- **order_status**: pending / submitted / partial_filled / filled / canceled / rejected
- **signal_decision_status**: pending / approved / rejected / skipped
- **system_mode**: readonly / simulated / live
- **risk_level**: low / medium / high / critical
- **system_health_status**: normal / warning / degraded / error
- **source_type**: manual / strategy / mixed / unattributed
- **signal_type**: BUY / SELL / ADD / REDUCE / HOLD / CANCEL

---

## 十、配置文件约定

| 文件 | 用途 | 是否提交 Git |
|------|------|-------------|
| `.env` | 敏感变量（账户、密钥、模式） | ❌ |
| `config.example.yaml` | 配置模板 | ✅ |
| `config.{ENV}.yaml` | 按环境加载 | ✅ |
| `config.local.yaml` | 本机覆盖 | ❌ |

---

## 十一、SQLite 约定

- 数据库路径: `backend/app/db/app.db`
- 每次连接执行 `PRAGMA journal_mode=WAL;` 和 `PRAGMA busy_timeout=5000;`
- 策略进程禁止直接写数据库，所有写入通过后台 API
- 迁移脚本放 `backend/migrations/`，命名 `YYYYMMDD_HHMM_description.sql`

---

## 十二、明确不做的事

以下内容属于第二至四阶段，第一阶段 **禁止提前实现**：

- PostgreSQL / Redis
- 多账户隔离
- 多券商适配
- WebSocket 推送
- 通知 / Webhook
- 权限模型（admin / trader / observer）
- 配置变更审计
- 自动备份 / 恢复
- 异常分级与降级运行
- 策略自动重启
- 一键暂停全部策略
- 手动接管状态
- API 限流
- React / Ant Design Pro 构建流程
- 报表系统 / 任务调度
