# 本地量化控制台

本地量化控制台（Local Quant Console）是一个面向个人量化研究和本地交易辅助的桌面化 Web 控制台。项目围绕 MiniQMT / QMT 本地环境构建，目标是把“数据同步、Python 策略开发、可信回测、交易确认、日志诊断、备份恢复”这些日常工作收束到一个可视化后台中。

它不是云端 SaaS，也不是多用户交易平台；第一版重点是本地、轻量、可审计、可长期使用。

## 核心能力

- **总览看板**：汇总 QMT 状态、账户资产、任务队列、策略信号和交易摘要。
- **数据中心**：按 QMT 官方数据边界同步账户、持仓、委托、成交、日 K、分钟 K、交易日历等数据，先落 SQLite 再供策略和回测使用。
- **策略开发**：支持 Python 策略文件管理、代码编辑、接口检查、运行、信号展示和版本记录。
- **回测研究**：提供本地 SQLite 数据驱动的单策略回测、分钟信号本地撮合、资金曲线、交易明细、日志和导出能力。
- **交易执行**：策略只生成信号，真实下单必须经过交易执行模块、人工确认和幂等保护。
- **系统管理**：提供环境检测、配置管理、日志中心、备份恢复、运行监控和启动健康检查。

## 安全边界

- 回测只读取已落库的历史行情，不调用真实 QMT 下单接口。
- 策略只能通过受控 `StrategyContext` 读取数据，不允许直接访问 QMT 原始对象、数据库连接或交易服务。
- 真实下单必须经过交易执行模块和确认弹窗；默认不启用自动实盘交易。
- SQLite 数据库、日志、备份、真实账号、本机路径和用户私有策略不会提交到公开仓库。

## 技术栈

```text
Frontend  React + TypeScript + Vite + Ant Design + Lightweight Charts + Monaco Editor
Backend   Python + FastAPI
Database  SQLite
QMT       xtquant / MiniQMT through Adapter layer
Runtime   Windows local scripts: start.bat / stop.bat / backup.bat
```

## 适合谁

这个项目适合想在本地管理 QMT 数据、编写 Python 策略、做回测研究和人工确认交易的个人用户或开发者。它也适合作为“本地量化控制台”类产品的工程参考：分层后端、长任务、SQLite 数据可信、策略沙箱、交易幂等、前端密度控制和深浅主题。

## 不适合什么

本项目不提供投资建议，不保证收益，不内置商业数据源，不做多用户权限系统、审批流、复杂风控中心、云部署或默认自动实盘交易。

## 开源版提示

本仓库为可公开源码快照，不包含本地 SQLite 数据、日志、备份、真实账号、历史报告截图和 `strategies/user/` 用户私有策略。真实 QMT 路径、账户 ID 和运行数据请只保存在本机配置中，不要提交到 Git。更多边界见 [OPEN_SOURCE.md](OPEN_SOURCE.md)。

## 一键启动

在 Windows 中运行：

```bat
start.bat
```

脚本会用中文提示创建后端虚拟环境、首次安装依赖、检查并停止旧服务、启动后端 `http://127.0.0.1:8000`，启动前端 `http://127.0.0.1:3000`，执行启动健康检查，并打开浏览器。启动脚本会自动识别局域网 IPv4，输出类似 `http://192.168.x.x:3000/dashboard` 的局域网访问地址，在项目根目录生成 `局域网访问本地量化控制台.url` 快捷方式，并把本次地址清单写入 `logs\runtime\局域网访问地址.txt`。后端依赖会按 `backend\requirements.txt` 哈希判断是否需要更新，前端依赖会按 `frontend\package-lock.json` 或 `package.json` 哈希判断是否需要重新安装，避免依赖文件变化后继续误用旧环境。

局域网访问说明：

- 同一 Wi-Fi / 有线局域网内的设备，打开启动脚本输出的 `http://局域网IP:3000/dashboard`。
- 前端会通过 Vite 代理访问本机后端，后端 8000 端口不直接对局域网开放。
- 如果其他设备打不开，请检查 Windows 防火墙是否放行 Node.js 或 3000 端口。

启动失败时，优先查看：

```text
logs\app.log
logs\error.log
后端服务窗口
前端页面窗口
```

## 一键停止

在 Windows 中运行：

```bat
stop.bat
```

脚本会停止本机 `8000` 和 `3000` 端口上的本项目服务，并显示被停止的端口、PID 和进程名。

## 一键备份

在 Windows 中运行：

```bat
backup.bat
```

脚本会备份 SQLite 数据库、系统配置、`strategies/user/` 用户策略目录和 `logs/` 下的重要日志文件。备份文件按时间命名，存放在 `backups/` 目录，并写入系统管理的备份记录和操作记录。

同时，`backup.bat` 会额外生成一份源码快照，存放在 `backups/source_snapshots/`。源码快照用于本地版本追溯，自动排除数据库、日志、备份、依赖目录、构建产物和测试结果；恢复数据库时不会自动覆盖源码。脚本会用中文显示备份目录、源码快照路径和失败排查建议。

## 长期使用建议

```text
1. 双击 start.bat 启动系统。
2. 打开系统管理，查看版本号和启动健康检查。
3. 每天首次使用前执行环境检测。
4. 重要操作前运行 backup.bat 或在系统管理中创建备份。
5. 排查问题时，在系统管理 - 日志中心点击“导出日志”。
6. 迁移配置时，在系统管理 - 基础设置点击“导出配置”。
7. 结束使用时运行 stop.bat。
```

备份恢复说明：

- 恢复前系统会自动创建当前快照。
- 恢复会恢复数据库和配置。
- 用户策略文件不会直接覆盖 `strategies/user/`，只会提取到 `backups/restored_strategies/`，便于人工核对后再处理。

## 开发启动

后端：

```bash
cd backend
python -m pip install -r requirements.txt
python -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

前端：

```bash
cd frontend
npm install
npm run dev
```

## 测试命令

一键 QA 闸门：

```bat
qa.bat
```

默认会依次运行后端 pytest、前端 lint、typecheck、build、项目边界审计、前端契约审计、前端样式审计、运行入口审计、仓库卫生审计、报告一致性审计、SQLite 快速健康审计、六大菜单冒烟、视觉回归和设备密度正式护栏。日志会写入 `logs\qa\qa_时间戳.log`。

只做静态与构建检查、不跑浏览器自动化：

```bat
qa.bat -SkipE2E
```

需要刷新设备截图和密度指标基线时：

```bat
qa.bat -IncludeCapture
```

后端：

```bash
python -m pytest backend -q
```

前端：

```bash
cd frontend
npm run lint
npm run typecheck
npm run build
npm run e2e:smoke
npm run e2e:visual
npm run e2e:device-density
```

Playwright 配置会先构建前端，再使用独立的生产预览服务 `http://127.0.0.1:3100` 跑自动化测试，并通过代理访问后端 `http://127.0.0.1:8000`。日常开发服务仍使用 `http://localhost:3000`，两者互不复用，避免测试把正在使用的页面或旧 dev server 当成验收目标。

项目边界审计：

```bash
python scripts/audit/project_boundary_audit.py
```

该审计会检查六大菜单是否被改名、是否引入禁止 UI 框架、是否使用 `zoom` / `transform scale` 偷缩放、API 层是否直连数据库、接口是否保持 `ApiResponse` / `FileResponse` 合同、长任务入口是否返回 `TaskCreated` 并调度后台任务、分页接口是否保持 `PageResult` 和 `page_size <= 200`、真实 QMT 调用是否越过 Adapter、用户策略是否直连 QMT / DB / 网络 / 交易 API，以及真实模式、下单确认、盘中自动运行、策略沙箱、真实交易阻断和数据中心只读适配器边界。

SQLite 快速健康审计：

```bash
python scripts/audit/sqlite_health_check.py --quick --json
```

该审计会通过后端统一连接检查 WAL、foreign_keys、busy_timeout 和日 K、分钟 K、委托、成交关键唯一索引。需要全表重复键深扫时可去掉 `--quick`，但大库上会更慢。

前端契约审计：

```bash
python scripts/audit/frontend_contract_audit.py
```

该审计会检查业务页面是否绕过 `frontend/src/services` 直接写 `/api/`，`fetch` 是否只保留在 `services/request.ts`，统一请求层是否仍包含超时、取消、中文网络错误、非 JSON 诊断、下载错误处理和分页查询构造，并拦截调试语句和旧业务 Mock 标记回流。

前端样式审计：

```bash
python scripts/audit/frontend_style_audit.py
```

该审计会检查页面和组件样式是否绕过主题 Token 直接写裸色值，阻断旧硬编码遮罩色、非 `rgba(var(--lqc-...), alpha)` 的 rgb/rgba、页面组件中的 `#fff/#000` 等颜色回流，并确认深色 / 浅色主题变量、显示密度变量和 Ant Design v5 主题配置仍然完整。

运行入口审计：

```bash
python scripts/audit/runtime_entry_audit.py
```

该审计会检查 `start.bat`、`stop.bat`、`backup.bat`、`qa.bat` 是否仍指向受控 PowerShell 脚本，Vite 是否固定局域网访问和 `3000` 严格端口，后端是否保持本机只监听并通过前端代理访问，停止脚本是否跳过非本项目进程，备份源码快照是否排除数据库、日志、备份、依赖和构建产物。

仓库卫生审计：

```bash
python scripts/audit/repository_hygiene_audit.py
```

该审计会检查 `.gitignore` 是否继续保护数据库、日志、备份、依赖、构建产物、测试产物和局域网快捷方式，阻断运行时数据、日志、备份包、node_modules、dist、Playwright 报告、缓存文件和超过 10MB 的已跟踪或未跟踪本地大文件进入版本跟踪，并确认 `docs/reports/screenshots/` 下新增的未跟踪截图证据已被 README 或 docs Markdown 引用，避免 UI 排查附件失控堆积。

报告一致性审计：

```bash
python scripts/audit/report_consistency_audit.py
```

该审计会检查当前权威报告、当前有效待办边界、最终收口报告和报告索引是否指向权威 QA 基线日志，阻断旧测试数量、待写入日志占位和缺失的仓库内报告链接，避免历史报告口径误导后续修复。

## 阶段一接口

```text
GET /api/health
```

返回统一响应结构，包含 API 状态、QMT 运行模式、`data` / `logs` / `backups` 目录状态。

## 总览看板接口

```text
GET /api/dashboard/summary
GET /api/dashboard/tasks
GET /api/dashboard/today-signals
GET /api/dashboard/today-trades
GET /api/dashboard/bundle
```

`bundle` 是前端首页使用的聚合接口，只做轻量摘要读取，不触发同步、不调用 QMT。

## 阶段二接口

```text
GET    /api/system/config
PUT    /api/system/config
POST   /api/system/config/test-path
POST   /api/system/env/check
GET    /api/system/env/results
GET    /api/system/logs
GET    /api/system/monitor
GET    /api/system/startup-check
POST   /api/system/backups
GET    /api/system/backups
POST   /api/system/backups/{backup_id}/restore
DELETE /api/system/backups/{backup_id}
GET    /api/system/logs/export
GET    /api/system/config/export
POST   /api/system/maintenance/cleanup
GET    /api/system/operations
GET    /api/tasks/{task_id}
POST   /api/tasks/{task_id}/cancel
```

## 阶段三接口

```text
GET  /api/data/sources
GET  /api/data/catalog
GET  /api/data/catalog/official
GET  /api/data/sources/qmt/status
POST /api/data/sources/qmt/connect
POST /api/data/sources/qmt/disconnect
POST /api/data/sources/qmt/test
GET  /api/data/account/latest
GET  /api/data/positions
GET  /api/data/orders
GET  /api/data/trades
GET  /api/data/stocks
GET  /api/data/basic/instruments
GET  /api/data/basic/trading-calendar
GET  /api/data/kline/daily
GET  /api/data/kline/minute
GET  /api/data/quotes/latest
POST /api/data/sync/stock-basic
POST /api/data/sync/instrument-detail
POST /api/data/sync/trading-calendar
POST /api/data/sync/account
POST /api/data/sync/positions
POST /api/data/sync/orders
POST /api/data/sync/trades
POST /api/data/sync/daily-kline
POST /api/data/sync/minute-kline
POST /api/data/sync/all
POST /api/data/sync/prepare-2026
POST /api/data/sync/run-2026
POST /api/data/sync/latest
GET  /api/data/sync/coverage-2026
GET  /api/data/freshness/summary
GET  /api/data/sync/coverage-2026/missing-export
GET  /api/data/sync/tasks
GET  /api/data/sync/logs
POST /api/data/quality/check
GET  /api/data/quality/results
GET  /api/data/quality/summary
GET  /api/data/quality/account-snapshot-duplicates
POST /api/data/sync/cursors/legacy/cleanup
GET  /api/data/dictionary
GET  /api/data/dictionary/{table_name}
```

## 阶段四接口

```text
GET    /api/strategies/files
POST   /api/strategies/files
POST   /api/strategies/import
POST   /api/strategies/copy-example
DELETE /api/strategies/files/{strategy_id}
PATCH  /api/strategies/files/{strategy_id}/status
GET    /api/strategies/files/{strategy_id}/content
PUT    /api/strategies/files/{strategy_id}/content
POST   /api/strategies/files/{strategy_id}/validate
POST   /api/strategies/{strategy_id}/run
POST   /api/strategies/runs/{run_id}/stop
GET    /api/strategies/runs
GET    /api/strategies/runs/{run_id}
GET    /api/strategies/runs/{run_id}/logs
GET    /api/strategies/signals
GET    /api/strategies/signals/{signal_id}
PATCH  /api/strategies/signals/{signal_id}/ignore
PATCH  /api/strategies/signals/{signal_id}/status
GET    /api/strategies/{strategy_id}/versions
GET    /api/strategies/versions/{version_id}
POST   /api/strategies/versions/{version_id}/restore
GET    /api/strategies/versions/compare
```

## 阶段五接口

```text
POST   /api/backtests
POST   /api/backtests/check-data
GET    /api/backtests
GET    /api/backtests/{task_id}
DELETE /api/backtests/{task_id}
POST   /api/backtests/{task_id}/cancel
POST   /api/backtests/{task_id}/rerun
GET    /api/backtests/{task_id}/result
GET    /api/backtests/{task_id}/equity
GET    /api/backtests/{task_id}/drawdown
GET    /api/backtests/{task_id}/trades
GET    /api/backtests/{task_id}/signals
GET    /api/backtests/{task_id}/logs
GET    /api/backtests/{task_id}/report
GET    /api/backtests/{task_id}/export
```

## 阶段六接口

```text
POST /api/trading/orders/manual
POST /api/trading/orders/from-signal/{signal_id}
POST /api/trading/signals/{signal_id}/ignore
POST /api/trading/orders/{order_id}/cancel
GET  /api/trading/positions
GET  /api/trading/orders
GET  /api/trading/trades
GET  /api/trading/signals
GET  /api/trading/logs
POST /api/trading/orders/sync
POST /api/trading/trades/sync
```

## 数据库表

阶段二初始化 SQLite：`data/local_quant_console.db`。

系统管理相关表：

- `app_config`
- `runtime_task`
- `operation_log`
- `backup_record`
- `environment_check`
- `system_log`

数据中心相关表：

- `data_source`
- `stock_basic`
- `instrument_detail`
- `trading_calendar`
- `daily_kline`
- `minute_kline`
- `account_snapshot`
- `position_snapshot`
- `order_record`
- `trade_record`
- `sync_cursor`
- `sync_task`
- `sync_log`
- `data_quality_check`
- `data_dictionary`
- `data_coverage`

策略开发相关表：

- `strategy_file`
- `strategy_version`
- `strategy_run_log`
- `strategy_signal`
- `strategy_error_log`

回测研究相关表：

- `backtest_task`
- `backtest_result`
- `backtest_manifest`
- `backtest_trade`
- `backtest_signal`
- `backtest_equity`
- `backtest_log`

交易执行相关表：

- 复用 `order_record`
- 复用 `trade_record`
- `signal_order`
- `execution_log`

## 真实 QMT 与测试隔离说明

当前业务运行口径是“真实 QMT 数据优先、业务 Mock 下线”：

- 默认配置使用真实 QMT 只读数据链路，`simulation_mode=false`。
- 数据中心、总览看板、系统管理和交易执行的日常页面不把 Mock 作为普通用户入口。
- 真实 QMT 不可用时，页面会显示中文错误、技术详情和下一步建议；不会自动切回 Mock 生成业务数据。
- Mock / Fake / Test Adapter 只用于自动化测试、离线回归和开发排障，不混入默认业务视图。
- 回测只读取已经落 SQLite 的历史行情数据，不调用真实 QMT 下单接口。
- 真实下单仍保持保护态：必须经过交易执行模块、人工确认、幂等保护和单独的小额人工验收；系统不会默认自动实盘交易。

当前真实实现：

- QMT 环境检测：真实检查 QMT 路径、账户 ID、`xtquant`、`xtdata`、`xttrader` 和只读查询能力。
- 数据中心同步：真实 QMT 只读查询后先落 SQLite，再供总览、策略、回测和交易页面读取。
- 策略开发：真实执行本地 Python 策略并保存信号，但 `StrategyContext` 只提供受控只读数据，不暴露 QMT 原始对象、交易服务或数据库连接。
- 回测研究：基于本地 SQLite 已落库行情做本地撮合回测；支持任务、指标、曲线、成交、信号、日志、报告和 Excel 导出；不提交真实委托。
- 交易执行：真实模式下展示真实账户相关持仓、委托、成交和执行日志；真实下单、撤单和交易中心同步仍处于人工验收前保护态。
- 总览看板：读取 SQLite 中的资产、任务、信号、委托和成交摘要，并显示真实 QMT 只读状态。
- 备份恢复：恢复前自动创建当前快照；恢复数据库和配置；用户策略文件只提取到 `backups/restored_strategies/`，不覆盖 `strategies/user/`。

仍属于测试隔离替身：

- 自动化测试中的测试隔离 QMT 数据同步、测试隔离手动下单、测试隔离信号下单、测试隔离撤单、测试隔离委托/成交同步。
- 测试用策略、测试用导出、测试用浏览器路由拦截。
- 离线回归中用于验证错误提示、空状态、任务进度和导出下载的假数据。

## 当前复核快照（2026-05-30）

当前权威复核入口：

- `docs/reports/QA_未完成建议最终闭环复核报告_20260522.md`
- `docs/reports/QA_未完成建议数据覆盖闭环报告_20260522.md`
- `docs/reports/INDEX.md`
- `logs\qa\qa_20260530_045605.log`
- `logs\qa\qa_20260530_051607.log`

当前现场状态：

- 业务模式：真实 QMT 数据优先，`simulation_mode=false`。
- QMT 健康检查：真实模式，`connected=true`。
- 最近一次数据覆盖复核：日 K 和 1 分钟 K 已补齐到 `2026-05-21`，覆盖率 `100.00% / complete`；后续新增交易日需在数据中心显式续跑。
- 后端回归：`python -m pytest backend -q`，`251 passed`。
- 前端检查：`npm run lint`、`npm run typecheck`、`npm run build` 通过。
- 一键 QA：`.\qa.bat` 通过，串联项目边界审计、前端契约审计、前端样式审计、运行入口审计、仓库卫生审计、报告一致性审计、SQLite 快速健康审计、Playwright 冒烟、视觉回归和设备密度护栏。
- Playwright：冒烟 `56 passed`，视觉回归 `24 passed`，设备密度 `17 passed`。

仍需单独授权：

- 真实小额交易人工验收。
- 后续新增完成交易日的全市场日 K / 1 分钟 K 续跑。
- 29GB 级 SQLite 主库字段迁移或生成列改造。

说明：历史报告里的“后续建议 / 未处理事项”只保留为过程证据，不自动等同于当前待办；当前待办以最新 QA 闭环报告和报告索引为准。

## 第一版使用流程

```text
1. 打开总览看板，确认系统正常。
2. 进入系统管理，执行环境检测。
3. 进入数据中心，执行“同步到最新”或按需补齐 2026 行情数据。
4. 进入策略开发，新建/导入策略并运行。
5. 进入回测研究，创建单策略本地回测，并查看报告、成交、信号和日志。
6. 进入交易执行查看信号、持仓、委托、成交和执行日志；真实下单必须先完成单独的小额人工验收。
7. 数据中心同步账户、委托和成交后，回到总览看板查看摘要。
```
