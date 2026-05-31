# Local Quant Console Design System

本目录是前端视觉重构的基线，不承载业务逻辑。

## 原则

1. 现代金融 SaaS，不做旧式监控大屏。
2. 高信息密度，但每个页面必须有清楚主任务。
3. 真实 QMT、回测可信、交易确认等风险状态必须优先可见。
4. 所有金额、价格、数量使用等宽数字。
5. A 股红涨绿跌颜色全局统一。
6. 样式先落 design system，再迁移页面，不逐页自由发挥。

## 当前内容

- `tokens.ts`：TypeScript 侧主题 Token，供 Ant Design ConfigProvider 和组件使用。

后续规划可继续补充：

- 页面模板组件。
- 查询表单 / 数据表格规范。
- 图表色板。
- 空状态和错误状态规范。
