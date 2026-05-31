# 开源版说明

本仓库是本地量化控制台的公开源码快照。为了保护本地实盘环境和个人研究资产，开源版不包含以下内容：

- 本地 SQLite 数据库、WAL/SHM 文件、同步数据、日志和备份。
- 真实 QMT 账号、真实本机路径、局域网固定 IP、运行截图和历史审查报告。
- `strategies/user/` 下的用户自定义策略文件。
- 前端依赖、构建产物、Playwright 报告和测试结果。

公开仓库保留系统源码、文档、示例策略和自动化测试隔离替身。真实 QMT 使用者需要在本机自行配置 QMT 路径、账户 ID 和数据目录。

## 本地数据边界

本项目默认将运行数据写入以下本地目录，这些目录不应提交到 Git：

```text
data/
logs/
backups/
frontend/node_modules/
frontend/dist/
frontend/test-results/
frontend/playwright-report/
backend/.venv/
docs/reports/
```

## 策略边界

`strategies/user/` 是用户私有策略目录。开源版只保留 `.gitkeep`，不会公开个人策略。示例策略放在 `strategies/examples/`。

## 风险声明

本项目仅用于本地量化研究和工程学习，不构成投资建议。真实交易必须经过交易执行模块、人工确认和幂等保护；回测结果不代表未来收益。
