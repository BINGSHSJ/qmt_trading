import { useCallback, useEffect, useState } from 'react';
import {
  ApiOutlined,
  BankOutlined,
  CodeOutlined,
  DatabaseOutlined,
  ExperimentOutlined,
  LineChartOutlined,
  ReloadOutlined,
  RiseOutlined,
  SettingOutlined,
  SwapOutlined,
  TransactionOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { Alert, App, Button, Col, Progress, Row, Space, Tabs, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Link } from 'react-router-dom';
import DataTable from '../../components/DataTable';
import DataFreshnessTag from '../../components/DataFreshnessTag';
import ErrorDetailModal from '../../components/ErrorDetailModal';
import FinancialNumber from '../../components/FinancialNumber';
import PageHeader from '../../components/PageHeader';
import TaskActionGroup from '../../components/TaskActionGroup';
import { InspectorPanel, WorkspaceGrid, WorkspacePanel } from '../../components/Workspace';
import { useTaskPolling } from '../../hooks/useTaskPolling';
import { useUrlSyncedTab } from '../../hooks/useUrlSyncedTab';
import { connectQmt, createSync } from '../../services/dataCenter';
import { getDashboardBundle } from '../../services/dashboard';
import { RequestError } from '../../services/request';
import type { ApiError } from '../../types/api';
import type { DashboardBundle } from '../../types/dashboard';
import type { RuntimeTaskRecord, TaskCreated } from '../../types/system';
import type { TradingOrderRecord, TradingSignalRecord, TradingTradeRecord } from '../../types/trading';
import { formatMoney, formatMoneyByUnit, formatPrice, formatQuantity, formatSide, formatStatusLabel, formatStockLabel, getSideColor, getStatusColor } from '../../utils/format';
import { formatQmtModeLabel, isRealQmtMode, isTestIsolationMode } from '../../utils/sourceLabels';
import { TABLE_COL } from '../../utils/tableColumns';
import { formatNow } from '../../utils/time';
import './Dashboard.css';

interface ErrorState {
  message: string;
  error?: ApiError | null;
  traceId?: string;
}

const dashboardDetailTabKeys = ['任务状态', '今日信号', '今日交易'] as const;
type DashboardDetailTabKey = (typeof dashboardDetailTabKeys)[number];

function statusTag(value: string) {
  return <Tag color={getStatusColor(value)}>{formatStatusLabel(value)}</Tag>;
}

function taskStatusTag(value: string) {
  return <Tag color={getStatusColor(value)}>{formatStatusLabel(value)}</Tag>;
}

function taskTypeCode(value?: string | null) {
  const text = value || 'unknown_task';
  return (
    <Tooltip title={text} placement="topLeft">
      <Typography.Text strong className="dashboard-task-type-code">
        {text}
      </Typography.Text>
    </Tooltip>
  );
}

export default function Dashboard() {
  const { message } = App.useApp();
  const [bundle, setBundle] = useState<DashboardBundle | null>(null);
  const [activeTask, setActiveTask] = useState<RuntimeTaskRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(formatNow());
  const [errorState, setErrorState] = useState<ErrorState | null>(null);
  const [activeDetailTab, setActiveDetailTab] = useUrlSyncedTab<DashboardDetailTabKey>(dashboardDetailTabKeys, '任务状态');

  const showError = useCallback((fallback: string, error: unknown) => {
    if (error instanceof RequestError) {
      setErrorState({ message: error.message, error: error.apiError, traceId: error.traceId });
    } else {
      setErrorState({ message: fallback, error: { code: 'UNKNOWN', detail: String(error) } });
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      setBundle(await getDashboardBundle());
      setUpdatedAt(formatNow());
    } catch (error) {
      showError('加载总览看板失败', error);
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useTaskPolling({
    task: activeTask,
    onTaskChange: setActiveTask,
    onFinished: loadAll,
    onError: (error) => showError('刷新任务状态失败', error),
  });

  const runTask = async (label: string, action: () => Promise<TaskCreated>) => {
    try {
      const task = await action();
      setActiveTask({ ...task, created_at: formatNow() });
      message.success(`${label}任务已创建`);
    } catch (error) {
      showError(`${label}失败`, error);
    }
  };

  const connect = async () => {
    try {
      const next = await connectQmt();
      message.success(`连接${next.source_name}成功`);
      await loadAll();
    } catch (error) {
      showError('连接 QMT 失败', error);
    }
  };

  const asset = bundle?.summary.asset;
  const trade = bundle?.today_trades;
  const summary = bundle?.summary;
  const dashboardLoading = loading && !bundle;
  const accountUpdatedAt = asset?.updated_at ?? updatedAt;
  const qmtMode = formatQmtModeLabel(summary?.qmt_mode, { testIsolation: '测试隔离模式', real: '真实 QMT 只读' });
  const qmtConnected = summary?.qmt_connected ?? false;
  const realQmtMode = isRealQmtMode(summary?.qmt_mode);
  const testIsolationQmtMode = isTestIsolationMode(summary?.qmt_mode);
  const qmtSourceGuard = !summary
    ? { value: '状态未检测', tone: 'neutral' }
    : realQmtMode
      ? { value: '真实 QMT 落库优先', tone: 'green' }
      : testIsolationQmtMode
        ? { value: '测试隔离需标记', tone: 'blue' }
        : { value: '状态未检测', tone: 'neutral' };
  const qmtGuardItems = [
    { label: '数据来源', value: qmtSourceGuard.value, tone: qmtSourceGuard.tone },
    { label: '同步方式', value: '只读同步到账本', tone: 'blue' },
    { label: '交易方式', value: '策略信号需人工确认', tone: 'orange' },
    { label: '自动实盘', value: '默认未开启', tone: 'red' },
  ];
  const todaySignals = bundle?.today_signals ?? [];
  const latestOrders = bundle?.latest_orders ?? [];
  const latestTrades = bundle?.latest_trades ?? [];
  const taskRows = bundle?.tasks ?? [];
  const pendingSignalCount = todaySignals.filter((item) => item.status === '未处理').length;
  const orderCount = trade?.order_count ?? summary?.today_order_count ?? 0;
  const filledRate = orderCount > 0 ? Math.round(((trade?.filled_count ?? 0) / orderCount) * 100) : 0;
  const latestStrategyTask = taskRows.find((task) => task.task_type === 'strategy_run');
  const signalEmptyReason = latestStrategyTask
    ? `上次策略运行：${latestStrategyTask.created_at}`
    : '今日尚未运行策略';
  const orderEmptyReason = orderCount === 0 ? '今日暂无委托记录' : undefined;
  const tradeEmptyReason = (trade?.trade_count ?? 0) === 0 ? '今日暂无成交记录' : undefined;
  const primaryTask = activeTask ?? taskRows.find((task) => task.status === 'running' || task.status === 'pending') ?? null;
  const visibleTasks = [activeTask, ...taskRows]
    .filter((task): task is RuntimeTaskRecord => Boolean(task))
    .reduce<RuntimeTaskRecord[]>((items, task) => {
      if (!items.some((item) => item.task_id === task.task_id)) items.push(task);
      return items;
    }, [])
    .slice(0, 5);
  const workflowItems = [
    { key: 'data', title: '数据补齐', description: '同步 2026 全市场行情', icon: <DatabaseOutlined />, action: <Link to="/data-center?tab=数据同步"><Button size="small" type="primary" icon={<DatabaseOutlined />}>数据中心</Button></Link> },
    { key: 'strategy', title: '策略运行', description: 'Python 策略生成信号', icon: <CodeOutlined />, action: <Link to="/strategy-dev"><Button size="small" icon={<CodeOutlined />}>策略开发</Button></Link> },
    { key: 'backtest', title: '回测研究', description: '本地 SQLite 推演验证', icon: <ExperimentOutlined />, action: <Link to="/backtest"><Button size="small" icon={<ExperimentOutlined />}>回测研究</Button></Link> },
    { key: 'trading', title: '交易执行', description: '人工确认后下单', icon: <TransactionOutlined />, action: <Link to="/trading"><Button size="small" icon={<TransactionOutlined />}>交易执行</Button></Link> },
    { key: 'system', title: '系统检查', description: 'QMT、数据库、日志', icon: <SettingOutlined />, action: <Link to="/system?tab=环境检测"><Button size="small" icon={<SettingOutlined />}>系统管理</Button></Link> },
  ];

  const taskColumns: ColumnsType<RuntimeTaskRecord> = [
    { title: '任务ID', dataIndex: 'task_id', width: TABLE_COL.taskId, ellipsis: true },
    { title: '类型', dataIndex: 'task_type', width: TABLE_COL.type, render: taskTypeCode },
    { title: '状态', dataIndex: 'status', width: TABLE_COL.status, render: taskStatusTag },
    { title: '进度', dataIndex: 'progress', width: TABLE_COL.status, render: (value: number) => `${value}%` },
    { title: '说明', dataIndex: 'message', ellipsis: true },
    { title: '创建时间', dataIndex: 'created_at', width: TABLE_COL.time },
    {
      title: '诊断',
      width: TABLE_COL.actionWide,
      fixed: false,
      render: (_, record) => <TaskActionGroup task={record} detailTitle="首页任务详情" />,
    },
  ];

  const signalColumns: ColumnsType<TradingSignalRecord> = [
    { title: '时间', dataIndex: 'signal_time', width: TABLE_COL.time },
    { title: '策略', dataIndex: 'strategy_name', width: TABLE_COL.strategy, ellipsis: true },
    { title: '股票', width: TABLE_COL.stockWide, ellipsis: true, render: (_, record) => formatStockLabel(record.symbol, record.name) },
    { title: '方向', dataIndex: 'action', width: TABLE_COL.side, render: (value: string) => <Tag color={getSideColor(value)}>{formatSide(value)}</Tag> },
    { title: '价格', dataIndex: 'price', width: TABLE_COL.price, align: 'right', render: (value: number) => formatPrice(value) },
    { title: '金额', dataIndex: 'amount', width: TABLE_COL.amountWide, align: 'right', render: (value: number) => formatMoneyByUnit(value) },
    { title: '状态', dataIndex: 'status', width: TABLE_COL.status, render: statusTag },
    { title: '原因', dataIndex: 'reason', ellipsis: true },
  ];

  const signalSummaryColumns: ColumnsType<TradingSignalRecord> = [
    { title: '时间', dataIndex: 'signal_time', width: 112, ellipsis: true },
    { title: '股票', width: 132, ellipsis: true, render: (_, record) => formatStockLabel(record.symbol, record.name) },
    { title: '方向', dataIndex: 'action', width: 56, render: (value: string) => <Tag color={getSideColor(value)}>{formatSide(value)}</Tag> },
    { title: '价格', dataIndex: 'price', width: 68, align: 'right', render: (value: number) => formatPrice(value) },
    { title: '状态', dataIndex: 'status', width: 64, render: statusTag },
  ];

  const orderColumns: ColumnsType<TradingOrderRecord> = [
    { title: '本地订单', dataIndex: 'local_order_id', width: TABLE_COL.orderId, ellipsis: true },
    { title: '股票', width: TABLE_COL.stockWide, ellipsis: true, render: (_, record) => formatStockLabel(record.symbol, record.name) },
    { title: '方向', dataIndex: 'side', width: TABLE_COL.side, render: (value: string) => <Tag color={getSideColor(value)}>{formatSide(value)}</Tag> },
    { title: '价格', dataIndex: 'price', width: TABLE_COL.price, align: 'right', render: (value: number) => formatPrice(value) },
    { title: '数量', dataIndex: 'quantity', width: TABLE_COL.quantity, align: 'right', render: (value: number) => formatQuantity(value) },
    { title: '状态', dataIndex: 'status', width: TABLE_COL.status, render: statusTag },
    { title: '时间', dataIndex: 'order_time', width: TABLE_COL.time },
  ];

  const tradeColumns: ColumnsType<TradingTradeRecord> = [
    { title: '成交时间', dataIndex: 'trade_time', width: TABLE_COL.time },
    { title: '股票', width: TABLE_COL.stockWide, ellipsis: true, render: (_, record) => formatStockLabel(record.symbol, record.name) },
    { title: '方向', dataIndex: 'side', width: TABLE_COL.side, render: (value: string) => <Tag color={getSideColor(value)}>{formatSide(value)}</Tag> },
    { title: '成交价', dataIndex: 'price', width: TABLE_COL.price, align: 'right', render: (value: number) => formatPrice(value) },
    { title: '数量', dataIndex: 'quantity', width: TABLE_COL.quantity, align: 'right', render: (value: number) => formatQuantity(value) },
    { title: '金额', dataIndex: 'amount', width: TABLE_COL.amountWide, align: 'right', render: (value: number) => formatMoneyByUnit(value) },
  ];

  const orderSummaryColumns: ColumnsType<TradingOrderRecord> = [
    { title: '股票', width: 132, ellipsis: true, render: (_, record) => formatStockLabel(record.symbol, record.name) },
    { title: '方向', dataIndex: 'side', width: 56, render: (value: string) => <Tag color={getSideColor(value)}>{formatSide(value)}</Tag> },
    { title: '价格', dataIndex: 'price', width: 68, align: 'right', render: (value: number) => formatPrice(value) },
    { title: '状态', dataIndex: 'status', width: 64, render: statusTag },
  ];
  const tradeSummaryColumns: ColumnsType<TradingTradeRecord> = [
    { title: '股票', width: 110, ellipsis: true, render: (_, record) => formatStockLabel(record.symbol, record.name) },
    { title: '方向', dataIndex: 'side', width: 56, render: (value: string) => <Tag color={getSideColor(value)}>{formatSide(value)}</Tag> },
    { title: '成交价', dataIndex: 'price', width: 66, align: 'right', render: (value: number) => formatPrice(value) },
    { title: '金额', dataIndex: 'amount', width: 74, align: 'right', render: (value: number) => formatMoneyByUnit(value) },
  ];

  return (
    <div className="module-page dashboard-page">
      <PageHeader
        title="总览看板"
        description="系统、数据、策略、回测和交易的实时摘要。"
        updatedAt={updatedAt}
        loading={loading}
        onRefresh={loadAll}
        extra={
          <Space className="dashboard-header-actions">
            <DataFreshnessTag label="账户数据" updatedAt={accountUpdatedAt} loading={loading} />
            <Button icon={<ApiOutlined />} onClick={connect}>
              连接 QMT
            </Button>
            <Link to="/strategy-dev">
              <Button icon={<CodeOutlined />}>运行策略</Button>
            </Link>
            <Link to="/backtest">
              <Button icon={<ExperimentOutlined />}>新建回测</Button>
            </Link>
            <Link to="/trading">
              <Button icon={<TransactionOutlined />}>进入交易</Button>
            </Link>
          </Space>
        }
        primaryAction={{ label: '刷新账户交易', testId: 'btn-dashboard-sync', onClick: () => runTask('账户交易刷新', () => createSync('all')) }}
      />

      <section className="dashboard-market-strip" aria-label="总览看板核心状态">
        <div className="dashboard-market-strip__cell dashboard-market-strip__cell--primary">
          <span className={['dashboard-market-strip__dot', qmtConnected ? 'is-live' : 'is-muted'].join(' ')} />
          <Typography.Text>QMT</Typography.Text>
          <strong>{qmtConnected ? qmtMode : '未连接'}</strong>
        </div>
        <div className="dashboard-market-strip__cell">
          <Typography.Text>交易</Typography.Text>
          <strong>{summary?.trading_mode ?? '未检测'}</strong>
        </div>
        <div
          className="dashboard-market-strip__cell"
          title={`今日信号 ${summary?.today_signal_count ?? 0}，今日成交 ${trade?.trade_count ?? 0}，待处理 ${pendingSignalCount}，委托 ${orderCount}`}
        >
          <Typography.Text>信号/成交</Typography.Text>
          <strong>{summary?.today_signal_count ?? 0} / {trade?.trade_count ?? 0}</strong>
        </div>
        <div className="dashboard-market-strip__cell">
          <Typography.Text>任务</Typography.Text>
          <strong>{summary?.running_task_count ?? 0}运行 / {summary?.failed_task_count ?? 0}失败</strong>
        </div>
      </section>

      {bundle && !asset?.has_account ? (
        <Alert
          type="info"
          showIcon
          className="dashboard-account-alert"
          message="暂无账户数据，请先点击页面右上角“刷新账户交易”，或到数据中心同步账户数据。"
        />
      ) : null}

      <WorkspaceGrid layout="three-column" className="dashboard-workspace-grid">
        <div className="dashboard-workspace-column">
          <WorkspacePanel
            title="账户资产"
            description="账户资产、现金、持仓和当日盈亏"
            extra={<DataFreshnessTag label="资产" updatedAt={asset?.updated_at} loading={dashboardLoading} />}
          >
            <div className="dashboard-portfolio-main">
              <div>
                <Typography.Text>总资产</Typography.Text>
                <strong><FinancialNumber value={asset?.total_asset} tone="primary" compact /></strong>
              </div>
              <WalletOutlined />
            </div>
            <div className="dashboard-portfolio-matrix">
              <div className="dashboard-portfolio-cell">
                <BankOutlined />
                <Typography.Text>可用资金</Typography.Text>
                <strong><FinancialNumber value={asset?.available_cash} tone="neutral" compact /></strong>
              </div>
              <div className="dashboard-portfolio-cell">
                <LineChartOutlined />
                <Typography.Text>持仓市值</Typography.Text>
                <strong><FinancialNumber value={asset?.market_value} tone="neutral" compact /></strong>
              </div>
              <div className="dashboard-portfolio-cell">
                <RiseOutlined />
                <Typography.Text>今日盈亏</Typography.Text>
                <strong><FinancialNumber value={asset?.today_pnl} tone="auto-pnl" showSign compact /></strong>
              </div>
              <div className="dashboard-portfolio-cell">
                <SwapOutlined />
                <Typography.Text>今日成交</Typography.Text>
                <strong>{trade?.trade_count ?? 0} 笔</strong>
              </div>
            </div>
          </WorkspacePanel>

          <WorkspacePanel title="安全边界" description="真实模式、只读同步、交易确认边界">
            <div className="dashboard-guard-list">
              {qmtGuardItems.map((item) => (
                <div className="dashboard-guard-row" key={item.label}>
                  <Typography.Text>{item.label}</Typography.Text>
                  <Tag color={item.tone}>{item.value}</Tag>
                </div>
              ))}
              <div className="dashboard-guard-row">
                <Typography.Text>账户快照</Typography.Text>
                <DataFreshnessTag label="更新" updatedAt={asset?.updated_at} />
              </div>
              <div className="dashboard-guard-row">
                <Typography.Text>总览刷新</Typography.Text>
                <DataFreshnessTag label="更新" updatedAt={updatedAt} loading={loading} />
              </div>
            </div>
          </WorkspacePanel>
        </div>

        <div className="dashboard-workspace-column dashboard-workspace-column--main">
          <WorkspacePanel
            title="策略信号"
            description="策略信号只进入交易流程，不自动下单"
            extra={<Link to="/trading">查看全部</Link>}
          >
            <DataTable<TradingSignalRecord>
              rowKey="id"
              className="data-table--dashboard-summary"
              columns={signalSummaryColumns}
              dataSource={todaySignals.slice(0, 10)}
              loading={loading}
              pagination={false}
              disableAutoScroll
              data-testid="table-dashboard-signals-summary"
              quickSearch={{ placeholder: '搜索策略/股票', fields: ['strategy_name', 'symbol', 'name'], width: 210 }}
              emptyDescription="今日暂无策略信号。可以先到策略开发运行策略，或检查数据是否已同步。"
              emptyReason={signalEmptyReason}
              emptyAction={<Link to="/strategy-dev"><Button size="small" icon={<CodeOutlined />}>运行策略</Button></Link>}
            />
          </WorkspacePanel>

          <WorkspacePanel title="委托队列" description="最新委托状态，重点关注待报、废单和失败" extra={<Link to="/trading">进入交易执行</Link>}>
            <DataTable<TradingOrderRecord>
              rowKey="local_order_id"
              className="data-table--dashboard-summary"
              columns={orderSummaryColumns}
              dataSource={latestOrders.slice(0, 8)}
              loading={loading}
              pagination={false}
              disableAutoScroll
              quickSearch={{ placeholder: '搜索订单/股票', fields: ['local_order_id', 'qmt_order_id', 'symbol', 'name'], width: 210 }}
              quickFilters={[{ label: '订单状态', options: ['待提交', '已提交', '已报', '部分成交', '全部成交', '已撤', '废单', '失败', '待同步'].map((value) => ({ label: value, value })), getValue: (record) => record.status }]}
              emptyDescription="暂无委托记录。请先确认策略信号，再到交易执行页按人工确认流程处理；真实 QMT 只读状态下请到数据中心同步委托。"
              emptyReason={orderEmptyReason}
              emptyAction={<Link to="/trading"><Button size="small" icon={<TransactionOutlined />}>进入交易执行</Button></Link>}
            />
          </WorkspacePanel>
        </div>

        <div className="dashboard-workspace-column">
          <InspectorPanel
            title="任务队列"
            subtitle="同步、策略、回测等长任务"
            status={(summary?.running_task_count ?? 0) > 0 ? '运行中' : '待命'}
            testId="dashboard-task-inspector"
            fields={[
              { label: '运行任务', value: `${summary?.running_task_count ?? 0}`, tone: (summary?.running_task_count ?? 0) > 0 ? 'info' : 'neutral' },
              { label: '失败任务', value: `${summary?.failed_task_count ?? 0}`, tone: (summary?.failed_task_count ?? 0) > 0 ? 'danger' : 'success' },
              { label: '当前任务', value: primaryTask?.task_type ?? '暂无运行任务', tone: primaryTask ? 'info' : 'neutral', span: 2 },
            ]}
            actions={<Link to="/system?tab=运行监控"><Button size="small">运行监控</Button></Link>}
          >
            {primaryTask ? (
              <div className="dashboard-task-primary">
                <Space wrap>
                  {taskTypeCode(primaryTask.task_type)}
                  {taskStatusTag(primaryTask.status)}
                </Space>
                <Progress percent={primaryTask.progress} size="small" status={primaryTask.status === 'failed' ? 'exception' : undefined} />
                <Typography.Text type="secondary">{primaryTask.message}</Typography.Text>
              </div>
            ) : (
              <div className="dashboard-task-primary dashboard-task-primary--idle">
                <Typography.Text strong>当前无运行任务</Typography.Text>
                <Typography.Text type="secondary">数据同步、策略运行和回测任务会显示在这里。</Typography.Text>
              </div>
            )}
            <div className="dashboard-task-list">
              {visibleTasks.map((task) => (
                <div className="dashboard-task-row" key={task.task_id}>
                  <div>
                    {taskTypeCode(task.task_type)}
                    <Typography.Text type="secondary">{task.created_at}</Typography.Text>
                  </div>
                  <Space size={6} wrap className="dashboard-task-row__ops">
                    {taskStatusTag(task.status)}
                    <TaskActionGroup task={task} mode="inline" detailTitle="首页任务详情" />
                  </Space>
                </div>
              ))}
            </div>
          </InspectorPanel>

          <WorkspacePanel title="成交记录" description={`今日成交额 ${formatMoney(trade?.trade_amount ?? summary?.today_trade_amount)}`} extra={<Link to="/trading">成交明细</Link>}>
            <div className="dashboard-execution-summary">
              <div>
                <Typography.Text>成交率</Typography.Text>
                <strong>{filledRate}%</strong>
              </div>
              <Progress percent={filledRate} size="small" showInfo={false} />
            </div>
            <DataTable<TradingTradeRecord>
              rowKey="trade_id"
              className="data-table--dashboard-summary data-table--dashboard-trades"
              columns={tradeSummaryColumns}
              dataSource={latestTrades.slice(0, 6)}
              loading={loading}
              pagination={false}
              disableAutoScroll
              quickSearch={{ placeholder: '搜索成交/股票', fields: ['trade_id', 'symbol', 'name', 'source'], width: 210 }}
              emptyDescription="暂无成交记录。真实账户成交请先到数据中心做只读成交同步。"
              emptyReason={tradeEmptyReason}
              emptyAction={<Link to="/data-center?tab=数据同步"><Button size="small" icon={<DatabaseOutlined />}>去数据同步</Button></Link>}
            />
          </WorkspacePanel>

          <WorkspacePanel title="主链路入口" description="数据、策略、回测、交易和系统检查">
            <div className="dashboard-workflow-actions">
              {workflowItems.map((item) => (
                <div className="dashboard-workflow-action" key={item.key}>
                  <span className="dashboard-workflow-action__icon">{item.icon}</span>
                  <div className="dashboard-workflow-action__copy">
                    <Typography.Text strong>{item.title}</Typography.Text>
                    <Typography.Text type="secondary">{item.description}</Typography.Text>
                  </div>
                  {item.action}
                </div>
              ))}
            </div>
            <Button size="small" icon={<ReloadOutlined />} loading={loading} disabled={loading} onClick={loadAll}>
              刷新首页
            </Button>
          </WorkspacePanel>
        </div>

        <Tabs
          className="dashboard-detail-tabs"
          activeKey={activeDetailTab}
          onChange={(key) => setActiveDetailTab(key as DashboardDetailTabKey)}
          items={[
            {
              key: '任务状态',
              label: '任务状态',
              children: (
                <DataTable<RuntimeTaskRecord>
                  rowKey="task_id"
                  columns={taskColumns}
                  dataSource={taskRows}
                  loading={loading}
                  updatedAt={updatedAt}
                  onRefresh={loadAll}
                  pagination={{ pageSize: 5 }}
                  data-testid="table-dashboard-tasks"
                  scroll={{ x: 1120 }}
                  quickSearch={{ placeholder: '当前页搜索任务ID/类型/说明', fields: ['task_id', 'task_type', 'message'], width: 260 }}
                  quickFilters={[{ label: '任务状态', options: ['pending', 'running', 'success', 'failed', 'cancelled'].map((value) => ({ label: value, value })), getValue: (record) => record.status }]}
                  emptyDescription="暂无运行任务。需要同步数据、运行策略或启动回测时，任务会出现在这里。"
                  emptyAction={<Link to="/data-center?tab=数据同步"><Button icon={<DatabaseOutlined />}>创建同步任务</Button></Link>}
                />
              ),
            },
            {
              key: '今日信号',
              label: '今日信号',
              children: (
                <DataTable<TradingSignalRecord>
                  rowKey="id"
                  columns={signalColumns}
                  dataSource={todaySignals}
                  loading={loading}
                  updatedAt={updatedAt}
                  onRefresh={loadAll}
                  pagination={{ pageSize: 10 }}
                  data-testid="table-dashboard-signals"
                  scroll={{ x: 980 }}
                  quickSearch={{ placeholder: '当前页搜索策略/股票/原因', fields: ['strategy_name', 'symbol', 'name', 'reason'], width: 260 }}
                  quickFilters={[
                    { label: '信号状态', options: [{ label: '未处理', value: '未处理' }, { label: '已下单', value: '已下单' }, { label: '已忽略', value: '已忽略' }], getValue: (record) => record.status },
                    { label: '方向', options: [{ label: '买入', value: 'BUY' }, { label: '卖出', value: 'SELL' }], getValue: (record) => record.action },
                  ]}
                  emptyDescription="今日暂无策略信号。可以先到策略开发运行策略，或检查数据是否已同步。"
                  emptyReason={signalEmptyReason}
                  emptyAction={<Link to="/strategy-dev"><Button icon={<CodeOutlined />}>运行策略</Button></Link>}
                />
              ),
            },
            {
              key: '今日交易',
              label: '今日交易',
              children: (
                <Row gutter={[8, 8]}>
                  <Col xs={24} xl={12}>
                    <DataTable<TradingOrderRecord>
                      rowKey="local_order_id"
                      toolbarTitle="最新委托"
                      updatedAt={updatedAt}
                      onRefresh={loadAll}
                      columns={orderColumns}
                      dataSource={latestOrders}
                      loading={loading}
                      pagination={{ pageSize: 10 }}
                      scroll={{ x: 820 }}
                      quickSearch={{ placeholder: '当前页搜索订单/股票', fields: ['local_order_id', 'qmt_order_id', 'symbol', 'name'], width: 240 }}
                      quickFilters={[{ label: '订单状态', options: ['待提交', '已提交', '已报', '部分成交', '全部成交', '已撤', '废单', '失败', '待同步'].map((value) => ({ label: value, value })), getValue: (record) => record.status }]}
                      emptyDescription="暂无委托记录。请先确认策略信号，再到交易执行页按人工确认流程处理；真实 QMT 只读状态下请到数据中心同步委托。"
                      emptyReason={orderEmptyReason}
                      emptyAction={<Link to="/trading"><Button icon={<TransactionOutlined />}>进入交易执行</Button></Link>}
                    />
                  </Col>
                  <Col xs={24} xl={12}>
                    <DataTable<TradingTradeRecord>
                      rowKey="trade_id"
                      toolbarTitle="最新成交"
                      updatedAt={updatedAt}
                      onRefresh={loadAll}
                      columns={tradeColumns}
                      dataSource={latestTrades}
                      loading={loading}
                      pagination={{ pageSize: 10 }}
                      scroll={{ x: 760 }}
                      quickSearch={{ placeholder: '当前页搜索成交/股票', fields: ['trade_id', 'symbol', 'name', 'source'], width: 240 }}
                      emptyDescription="暂无成交记录。真实账户成交请先到数据中心做只读成交同步；测试隔离数据只用于自动化测试和离线排障。"
                      emptyReason={tradeEmptyReason}
                      emptyAction={<Link to="/data-center?tab=数据同步"><Button icon={<DatabaseOutlined />}>去数据同步</Button></Link>}
                    />
                  </Col>
                </Row>
              ),
            },
          ]}
        />
      </WorkspaceGrid>

      <ErrorDetailModal
        open={Boolean(errorState)}
        message={errorState?.message ?? ''}
        error={errorState?.error}
        traceId={errorState?.traceId}
        onClose={() => setErrorState(null)}
      />
    </div>
  );
}
