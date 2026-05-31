# 05_API接口规范

> 本文件约束统一响应格式、分页格式、任务接口格式、错误格式和模块 API 清单。

## API 基本原则

1. 所有接口统一前缀建议使用 `/api`。
2. 所有响应使用统一格式。
3. 所有列表接口必须分页。
4. 所有长任务接口必须返回 `task_id`。
5. 所有写操作必须写入 `operation_log`。
6. 所有错误必须包含中文 `message` 和可选 `detail`。
7. 前端只通过 services 层调用 API。

## 7. 通用后端规范

### 7.1 API 响应格式

所有 API 统一响应：

```json
{
  "success": true,
  "message": "操作成功",
  "data": {},
  "error": null,
  "trace_id": "20260508-xxxx"
}
```

错误响应：

```json
{
  "success": false,
  "message": "分钟K数据为空，请先同步分钟K数据。",
  "data": null,
  "error": {
    "code": "MARKET_DATA_EMPTY",
    "detail": "minute_kline has no rows for symbol=600000.SH",
    "suggestion": "请到数据中心同步分钟K数据"
  },
  "trace_id": "20260508-xxxx"
}
```

### 7.2 分页格式

列表接口统一：

请求参数：

```text
page=1
page_size=50
sort_field=created_at
sort_order=desc
keyword=
start_date=
end_date=
```

返回格式：

```json
{
  "items": [],
  "page": 1,
  "page_size": 50,
  "total": 0,
  "has_more": false
}
```

### 7.3 任务状态格式

```json
{
  "task_id": "task_20260508_xxxx",
  "task_type": "sync_minute_kline",
  "status": "running",
  "progress": 45,
  "message": "正在同步分钟K：600000.SH",
  "started_at": "2026-05-08 10:00:00",
  "finished_at": null,
  "error_message": null,
  "technical_detail": null
}
```

### 7.4 日志格式

日志必须包含：

| 字段 | 说明 |
|---|---|
| log_id | 日志 ID |
| module | 模块 |
| level | info/warning/error |
| message | 中文信息 |
| technical_detail | 技术详情 |
| related_id | 关联任务/策略/订单 |
| created_at | 时间 |

### 7.5 异常处理规范

后端必须提供统一异常类：

| 异常类型 | 示例 |
|---|---|
| ConfigError | QMT 路径未配置 |
| QmtConnectionError | QMT 未连接 |
| DataSyncError | 数据同步失败 |
| StrategyValidationError | 策略接口不正确 |
| StrategyRunError | 策略运行失败 |
| BacktestError | 回测失败 |
| TradingError | 下单失败 |
| DatabaseError | 数据库写入失败 |

API 层不得直接返回 Python 原始异常。

---

## 16. API 接口总表

### 16.1 总览看板

```text
GET  /api/dashboard/summary
GET  /api/dashboard/tasks
GET  /api/dashboard/today-signals
GET  /api/dashboard/today-trades
```

### 16.2 数据中心

```text
GET  /api/data/sources
GET  /api/data/sources/qmt/status
POST /api/data/sources/qmt/connect
POST /api/data/sources/qmt/disconnect
POST /api/data/sources/qmt/test

GET  /api/data/account/latest
GET  /api/data/positions
GET  /api/data/orders
GET  /api/data/trades

GET  /api/data/stocks
GET  /api/data/kline/daily
GET  /api/data/kline/minute
GET  /api/data/quotes/latest

POST /api/data/sync/stock-basic
POST /api/data/sync/account
POST /api/data/sync/positions
POST /api/data/sync/orders
POST /api/data/sync/trades
POST /api/data/sync/daily-kline
POST /api/data/sync/minute-kline
POST /api/data/sync/all
GET  /api/data/sync/tasks

POST /api/data/quality/check
GET  /api/data/quality/results
GET  /api/data/quality/summary

GET  /api/data/dictionary
GET  /api/data/dictionary/{table_name}
```

### 16.3 策略开发

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

### 16.4 回测研究

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
GET    /api/backtests/{task_id}/logs
GET    /api/backtests/{task_id}/report
```

### 16.5 交易执行

```text
POST /api/trading/orders/manual
POST /api/trading/orders/from-signal/{signal_id}
POST /api/trading/signals/{signal_id}/ignore
POST /api/trading/orders/{order_id}/cancel
GET  /api/trading/positions
GET  /api/trading/orders
GET  /api/trading/trades
POST /api/trading/orders/sync
POST /api/trading/trades/sync
```

### 16.6 系统管理

```text
GET  /api/system/config
PUT  /api/system/config
POST /api/system/config/test-path
POST /api/system/env/check
GET  /api/system/env/results
GET  /api/system/logs
GET  /api/system/monitor
POST /api/system/backups
GET  /api/system/backups
POST /api/system/backups/{backup_id}/restore
DELETE /api/system/backups/{backup_id}
GET  /api/system/operations
GET  /api/tasks/{task_id}
POST /api/tasks/{task_id}/cancel
```

---
