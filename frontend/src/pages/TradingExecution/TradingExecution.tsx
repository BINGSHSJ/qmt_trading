import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  ReloadOutlined,
  SendOutlined,
  SyncOutlined,
  TransactionOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { Alert, App, Button, Col, Form, Input, InputNumber, Modal, Row, Segmented, Space, Tabs, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Link } from 'react-router-dom';
import CommandPanel, { type CommandPanelTone } from '../../components/CommandPanel';
import DataTable from '../../components/DataTable';
import DataFreshnessTag from '../../components/DataFreshnessTag';
import ErrorDetailModal from '../../components/ErrorDetailModal';
import FinancialNumber from '../../components/FinancialNumber';
import LogDrawer, { type LogDrawerField } from '../../components/LogDrawer';
import MetricCard from '../../components/MetricCard';
import OrderConfirmModal, { type OrderConfirmData } from '../../components/OrderConfirmModal';
import PageHeader from '../../components/PageHeader';
import RiskConfirmContent from '../../components/RiskConfirmContent';
import SectionCard from '../../components/SectionCard';
import TableActionGroup from '../../components/TableActionGroup';
import TaskProgress from '../../components/TaskProgress';
import WorkbenchNav, { type WorkbenchNavItem } from '../../components/WorkbenchNav';
import { useTaskPolling } from '../../hooks/useTaskPolling';
import { useUrlSyncedTab } from '../../hooks/useUrlSyncedTab';
import { getLatestAccount, getQmtStatus } from '../../services/dataCenter';
import { RequestError } from '../../services/request';
import {
  cancelTradingOrder,
  getExecutionLogs,
  getTradingOrders,
  getTradingPositions,
  getTradingSignals,
  getTradingTrades,
  ignoreTradingSignal,
  submitManualOrder,
  submitSignalOrder,
  syncTradingOrders,
  syncTradingTrades,
} from '../../services/trading';
import { defaultPageState, type ApiError, type PageState } from '../../types/api';
import type { AccountSnapshot, QmtStatus } from '../../types/dataCenter';
import type { RuntimeTaskRecord, TaskCreated } from '../../types/system';
import { isRealQmtMode, isTestIsolationMode, normalizeSyncSource } from '../../utils/sourceLabels';
import type {
  ExecutionLogRecord,
  ManualOrderRequest,
  TradingOrderRecord,
  TradingPosition,
  TradingSignalRecord,
  TradingTradeRecord,
} from '../../types/trading';
import { formatMoney, formatMoneyByUnit, formatPrice, formatQuantity, formatSide, formatStatusLabel, formatStockLabel, getPnLTextType, getSideColor, getStatusColor } from '../../utils/format';
import { TABLE_COL, TABLE_SCROLL_X } from '../../utils/tableColumns';
import { formatNow } from '../../utils/time';
import './TradingExecution.css';

interface ErrorState {
  message: string;
  error?: ApiError | null;
  traceId?: string;
}

interface LogDrawerState {
  title: string;
  subtitle?: string;
  status?: string;
  statusTone?: string;
  message?: string;
  technicalDetail?: string | null;
  fields?: LogDrawerField[];
  width?: number;
  fieldColumns?: number;
  className?: string;
}

const initialOrder: ManualOrderRequest = {
  symbol: '600000.SH',
  name: '浦发银行',
  side: 'BUY',
  price: 9.12,
  quantity: 100,
  order_type: '限价委托',
};

const tradingTabKeys = ['信号下单', '交易面板', '当前持仓', '委托记录', '成交记录', '执行日志'] as const;
type TradingTabKey = (typeof tradingTabKeys)[number];
const TRADING_WORKBENCH_PAGE_SIZE = 5;
const TRADING_AUDIT_PAGE_SIZE = 2;
const createTradingWorkbenchPageState = (): PageState => ({
  ...defaultPageState,
  pageSize: TRADING_WORKBENCH_PAGE_SIZE,
});
const createTradingAuditPageState = (): PageState => ({
  ...defaultPageState,
  pageSize: TRADING_AUDIT_PAGE_SIZE,
});

function statusTag(value: string) {
  return <Tag color={getStatusColor(value)}>{formatStatusLabel(value)}</Tag>;
}

function renderTradingAuditText(value?: string | null) {
  const text = value || '暂无';
  return (
    <Typography.Text className="trading-audit-cell-text" title={text}>
      {text}
    </Typography.Text>
  );
}

export default function TradingExecution() {
  const { message } = App.useApp();
  const [form] = Form.useForm<ManualOrderRequest>();
  const [account, setAccount] = useState<AccountSnapshot | null>(null);
  const [positions, setPositions] = useState<TradingPosition[]>([]);
  const [signals, setSignals] = useState<TradingSignalRecord[]>([]);
  const [orders, setOrders] = useState<TradingOrderRecord[]>([]);
  const [trades, setTrades] = useState<TradingTradeRecord[]>([]);
  const [logs, setLogs] = useState<ExecutionLogRecord[]>([]);
  const [qmtStatus, setQmtStatus] = useState<QmtStatus | null>(null);
  const [positionPage, setPositionPage] = useState<PageState>(createTradingWorkbenchPageState);
  const [signalPage, setSignalPage] = useState<PageState>(createTradingWorkbenchPageState);
  const [orderPage, setOrderPage] = useState<PageState>(createTradingAuditPageState);
  const [tradePage, setTradePage] = useState<PageState>(createTradingWorkbenchPageState);
  const [logPage, setLogPage] = useState<PageState>(createTradingAuditPageState);
  const [activeTask, setActiveTask] = useState<RuntimeTaskRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionBusyKey, setActionBusyKey] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState(formatNow());
  const [errorState, setErrorState] = useState<ErrorState | null>(null);
  const [logDrawer, setLogDrawer] = useState<LogDrawerState | null>(null);
  const [confirmData, setConfirmData] = useState<OrderConfirmData | null>(null);
  const [confirmAction, setConfirmAction] = useState<(() => Promise<void>) | null>(null);
  const [activeTab, setActiveTab] = useUrlSyncedTab<TradingTabKey>(tradingTabKeys, '信号下单');

  const symbol = Form.useWatch('symbol', form);
  const side = Form.useWatch('side', form);
  const price = Form.useWatch('price', form) ?? 0;
  const quantity = Form.useWatch('quantity', form) ?? 0;
  const selectedPosition = useMemo(() => positions.find((item) => item.symbol === symbol), [positions, symbol]);
  const pendingSignalCount = signals.filter((item) => item.status === '未处理').length;
  const activeOrderCount = orders.filter((item) => ['待提交', '已提交', '已报', '部分成交'].includes(item.status)).length;
  const failedOrderCount = orders.filter((item) => ['失败', '废单'].includes(item.status)).length;
  const todayTradeAmount = trades.reduce((sum, item) => sum + item.amount, 0);
  const orderAmount = price * quantity;
  const actionLocked = submitting || Boolean(actionBusyKey);
  const lotRulePassed = quantity >= 100 && quantity % 100 === 0;
  const isRealQmt = isRealQmtMode(qmtStatus?.mode);
  const isTestIsolationQmt = isTestIsolationMode(qmtStatus?.mode);
  const tradingActionsLockedByMode = !isTestIsolationQmt;
  const tradingModeTitle = isRealQmt ? '真实 QMT 只读验收模式' : isTestIsolationQmt ? '测试隔离交易模式' : '交易模式未检测';
  const tradingModeDescription = isRealQmt
    ? '当前仅展示真实账户相关数据，测试历史委托、成交和日志已隔离。真实下单与撤单仍被后端阻止，等单独小额验收后再开启。'
    : isTestIsolationQmt
      ? '当前页面按实盘标准核对：所有交易操作都需要人工确认，策略只生成信号，委托和成交状态以同步结果为准。'
      : '当前尚未确认 QMT 运行模式，交易输入、同步和下单操作已锁定。请先刷新页面或到系统管理执行环境检测。';
  const tradingModeValue = isRealQmt ? '真实 / 只读' : isTestIsolationQmt ? '测试隔离' : '未检测';
  const realSubmitValue = isRealQmt ? '暂未启用' : isTestIsolationQmt ? '不连接真实' : '已锁定';
  const tradingModeTagText = isRealQmt ? '真实只读验收' : isTestIsolationQmt ? '测试隔离交易' : '模式未检测';
  const tradingModeTagColor = isRealQmt ? 'orange' : isTestIsolationQmt ? 'blue' : 'default';
  const lockedModeTitle = isRealQmt ? '真实 QMT 只读验收中，暂不允许提交委托' : '交易模式未检测，暂不允许提交委托';
  const readonlyMaskText = isRealQmt ? '只读模式，交易功能已锁定' : '交易模式未检测，交易功能已锁定';
  const nonRealReadonlyDescription = isTestIsolationQmt ? '测试隔离数据仅用于自动化回归和排障。' : '交易模式未检测，请先刷新或执行环境检测。';
  const orderSyncTitle = isTestIsolationQmt ? '同步委托订单状态' : isRealQmt ? '真实 QMT 只读订单请到数据中心同步' : '交易模式未检测，请先刷新或执行环境检测';
  const tradeSyncTitle = isTestIsolationQmt ? '同步成交记录' : isRealQmt ? '真实 QMT 只读成交请到数据中心同步' : '交易模式未检测，请先刷新或执行环境检测';
  const orderLifecycleItems = [
    { label: '待提交', count: orders.filter((item) => item.status === '待提交').length, tone: 'neutral' },
    { label: '已提交', count: orders.filter((item) => item.status === '已提交').length, tone: 'info' },
    { label: '已报', count: orders.filter((item) => item.status === '已报').length, tone: 'info' },
    { label: '部分成交', count: orders.filter((item) => item.status === '部分成交').length, tone: 'warning' },
    { label: '全部成交', count: orders.filter((item) => item.status === '全部成交').length, tone: 'success' },
    { label: '已撤', count: orders.filter((item) => item.status === '已撤').length, tone: 'neutral' },
    { label: '废单/失败', count: failedOrderCount, tone: 'danger' },
  ];
  const safetyItems: Array<{ label: string; value: string; tone: CommandPanelTone }> = [
    { label: '交易模式', value: tradingModeValue, tone: isRealQmt ? 'warning' : isTestIsolationQmt ? 'info' : 'warning' },
    { label: '真实下单', value: realSubmitValue, tone: isRealQmt ? 'danger' : isTestIsolationQmt ? 'success' : 'warning' },
    { label: '人工确认', value: '开启', tone: 'success' },
    { label: '请求锁定', value: actionLocked ? '处理中' : '就绪', tone: actionLocked ? 'warning' : 'success' },
    { label: '信号防重', value: '同信号仅一单', tone: 'success' },
  ];
  const executionGuardItems = [
    { title: '只读同步', description: isRealQmt ? '真实账户、持仓、委托、成交请到数据中心同步落库后查看。' : nonRealReadonlyDescription, tone: 'info' },
    { title: '人工确认', description: '策略信号只进入确认弹窗，不会绕过交易执行模块直接下单。', tone: 'success' },
    { title: '自动实盘', description: '当前未开启默认自动实盘交易；真实下单需单独验收后再启用。', tone: 'danger' },
  ];

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
      const [accountResult, qmtStatusResult, positionResult, signalResult, orderResult, tradeResult, logResult] = await Promise.all([
        getLatestAccount(),
        getQmtStatus(),
        getTradingPositions(positionPage),
        getTradingSignals(signalPage),
        getTradingOrders(orderPage),
        getTradingTrades(tradePage),
        getExecutionLogs(logPage),
      ]);
      setAccount(accountResult);
      setQmtStatus(qmtStatusResult);
      setPositions(positionResult.items);
      setSignals(signalResult.items);
      setOrders(orderResult.items);
      setTrades(tradeResult.items);
      setLogs(logResult.items);
      setPositionPage((previous) => (previous.total === positionResult.total ? previous : { ...previous, total: positionResult.total }));
      setSignalPage((previous) => (previous.total === signalResult.total ? previous : { ...previous, total: signalResult.total }));
      setOrderPage((previous) => (previous.total === orderResult.total ? previous : { ...previous, total: orderResult.total }));
      setTradePage((previous) => (previous.total === tradeResult.total ? previous : { ...previous, total: tradeResult.total }));
      setLogPage((previous) => (previous.total === logResult.total ? previous : { ...previous, total: logResult.total }));
      setUpdatedAt(formatNow());
    } catch (error) {
      showError('加载交易执行失败', error);
    } finally {
      setLoading(false);
    }
  }, [logPage, orderPage, positionPage, showError, signalPage, tradePage]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useTaskPolling({
    task: activeTask,
    onTaskChange: setActiveTask,
    onFinished: loadAll,
    onError: (error) => showError('刷新交易任务失败', error),
  });

  const setTask = async (task: TaskCreated) => {
    setActiveTask({ ...task, created_at: formatNow() });
  };

  const openConfirm = (data: OrderConfirmData, action: () => Promise<void>) => {
    setConfirmData(data);
    setConfirmAction(() => action);
  };

  const closeConfirm = () => {
    setConfirmData(null);
    setConfirmAction(null);
  };

  const runConfirmed = async () => {
    if (!confirmAction || submitting) return;
    setSubmitting(true);
    try {
      await confirmAction();
      closeConfirm();
      await loadAll();
    } catch (error) {
      showError('交易操作失败', error);
    } finally {
      setSubmitting(false);
    }
  };

  const prepareManualOrder = async (values: ManualOrderRequest) => {
    openConfirm(
      {
        title: values.side === 'BUY' ? '确认买入' : '确认卖出',
        tradingMode: tradingModeTitle,
        source: '手动下单',
        symbol: values.symbol,
        name: values.name || values.symbol,
        side: values.side,
        price: values.price,
        quantity: values.quantity,
      },
      async () => {
        const result = await submitManualOrder(values);
        message.success(result.message);
      },
    );
  };

  const prepareSignalOrder = (signal: TradingSignalRecord) => {
    const inferredQuantity = Math.max(Math.floor(((signal.amount || 10000) / signal.price) / 100) * 100, 100);
    openConfirm(
      {
        title: '确认信号下单',
        strategyName: signal.strategy_name,
        tradingMode: tradingModeTitle,
        source: `策略信号人工确认 / 信号 ${signal.id}`,
        symbol: signal.symbol,
        name: signal.name || signal.symbol,
        side: signal.action,
        price: signal.price,
        quantity: inferredQuantity,
        reason: signal.reason,
      },
      async () => {
        const result = await submitSignalOrder(signal.id, { price: signal.price, quantity: inferredQuantity });
        message.success(result.duplicate ? '该信号已有关联订单，已返回原订单。' : result.message);
      },
    );
  };

  const confirmCancel = (order: TradingOrderRecord) => {
    Modal.confirm({
      className: 'trading-confirm-modal',
      width: 720,
      centered: true,
      maskClosable: false,
      title: '确认撤单',
      content: (
        <RiskConfirmContent
          level="warning"
          summary={`即将撤销委托：${order.local_order_id}`}
          objectLabel={order.local_order_id}
          riskItems={[
            '撤单请求提交后，最终状态仍以 QMT 同步结果为准。',
            '如果委托已全部成交或已撤，系统会显示后端返回的中文错误详情。',
            '撤单会写入执行日志和操作链路，便于后续核对订单状态一致性。',
          ]}
          details={[
            { label: '本地订单号', value: order.local_order_id },
            { label: 'QMT订单号', value: order.qmt_order_id ?? '暂无' },
            { label: '股票', value: formatStockLabel(order.symbol, order.name) },
            { label: '方向', value: formatSide(order.side) },
            { label: '数量', value: formatQuantity(order.quantity) },
            { label: '当前状态', value: order.status },
          ]}
          nextStep="提交撤单后请刷新委托记录，并通过订单详情核对 local_order_id、qmt_order_id 和状态流转。"
        />
      ),
      okText: '确认撤单',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        const key = `cancel-${order.local_order_id}`;
        setActionBusyKey(key);
        try {
          await cancelTradingOrder(order.local_order_id);
          message.success('撤单处理完成');
          await loadAll();
        } catch (error) {
          showError('撤单失败', error);
        } finally {
          setActionBusyKey(null);
        }
      },
    });
  };

  const openOrderDetail = (order: TradingOrderRecord) => {
    const statusLabel = formatStatusLabel(order.status);
    const orderAmount = order.price * order.quantity;
    setLogDrawer({
      title: '订单详情',
      subtitle: formatStockLabel(order.symbol, order.name),
      status: statusLabel,
      statusTone: getStatusColor(order.status),
      message: `本地订单 ${order.local_order_id} 当前状态为 ${statusLabel}。请按本地订单号、QMT订单号、成交数量和更新时间核对订单生命周期。`,
      technicalDetail: JSON.stringify(
        {
          qa_type: 'trading_order_detail',
          ai_copy_version: '1.0',
          identifiers: {
            local_order_id: order.local_order_id,
            qmt_order_id: order.qmt_order_id,
            signal_id: order.signal_id,
            idempotency_key: order.idempotency_key,
          },
          account: {
            account_id: order.account_id,
            source: order.source,
          },
          stock: {
            symbol: order.symbol,
            name: order.name,
            display_name: formatStockLabel(order.symbol, order.name),
          },
          order: {
            side_raw: order.side,
            side_text: formatSide(order.side),
            price: order.price,
            quantity: order.quantity,
            filled_quantity: order.filled_quantity,
            amount: orderAmount,
            status_raw: order.status,
            status_text: statusLabel,
            qmt_status: order.qmt_status,
          },
          strategy: {
            strategy_id: order.strategy_id,
            strategy_name: order.strategy_name,
          },
          times: {
            order_time: order.order_time,
            updated_at: order.updated_at,
          },
          raw: order,
        },
        null,
        2,
      ),
      width: 720,
      fieldColumns: 2,
      className: 'order-detail-drawer',
      fields: [
        { label: '本地订单号', value: order.local_order_id },
        { label: 'QMT订单号', value: order.qmt_order_id ?? '暂无' },
        { label: '账户', value: order.account_id },
        { label: '股票', value: formatStockLabel(order.symbol, order.name) },
        { label: '方向', value: <Tag color={getSideColor(order.side)}>{formatSide(order.side)}</Tag>, copyValue: formatSide(order.side) },
        { label: '订单状态', value: <Tag color={getStatusColor(order.status)}>{statusLabel}</Tag>, copyValue: statusLabel },
        { label: '委托价格', value: formatPrice(order.price) },
        { label: '委托数量', value: formatQuantity(order.quantity) },
        { label: '已成数量', value: formatQuantity(order.filled_quantity) },
        { label: '订单金额', value: formatMoneyByUnit(orderAmount) },
        { label: '订单来源', value: order.source },
        { label: '策略名称', value: order.strategy_name ?? '暂无' },
        { label: '信号ID', value: order.signal_id ?? '暂无' },
        { label: '委托时间', value: order.order_time ?? '暂无' },
        { label: '更新时间', value: order.updated_at ?? '暂无' },
      ],
    });
  };

  const openPositionDetail = (position: TradingPosition) => {
    setLogDrawer({
      title: '持仓详情',
      subtitle: formatStockLabel(position.symbol, position.name),
      status: position.pnl >= 0 ? '浮盈' : '浮亏',
      statusTone: position.pnl >= 0 ? 'red' : 'green',
      message: `当前持仓 ${formatStockLabel(position.symbol, position.name)} 数量 ${formatQuantity(position.quantity)}，可卖 ${formatQuantity(position.available_quantity)}。`,
      technicalDetail: JSON.stringify(position, null, 2),
      width: 720,
      fieldColumns: 2,
      className: 'position-detail-drawer',
      fields: [
        { label: '账户', value: position.account_id },
        { label: '股票', value: formatStockLabel(position.symbol, position.name) },
        { label: '持仓数量', value: formatQuantity(position.quantity) },
        { label: '可卖数量', value: formatQuantity(position.available_quantity) },
        { label: '成本价', value: formatPrice(position.cost_price) },
        { label: '最新价', value: formatPrice(position.last_price) },
        { label: '持仓市值', value: formatMoney(position.market_value) },
        { label: '浮盈亏', value: <Typography.Text type={getPnLTextType(position.pnl)}>{formatMoney(position.pnl)}</Typography.Text> },
        { label: '盈亏比例', value: `${position.pnl_ratio.toFixed(2)}%` },
        { label: '快照时间', value: position.snapshot_time },
      ],
    });
  };

  const openTradeDetail = (trade: TradingTradeRecord) => {
    setLogDrawer({
      title: '成交详情',
      subtitle: formatStockLabel(trade.symbol, trade.name),
      status: formatSide(trade.side),
      statusTone: getSideColor(trade.side),
      message: `成交 ${trade.trade_id}：${formatSide(trade.side)} ${formatQuantity(trade.quantity)}，成交金额 ${formatMoneyByUnit(trade.amount)}。请用成交编号、订单号和成交时间核对委托成交一致性。`,
      technicalDetail: JSON.stringify(
        {
          qa_type: 'trading_trade_detail',
          ai_copy_version: '1.0',
          identifiers: {
            trade_id: trade.trade_id,
            local_order_id: trade.local_order_id,
            qmt_order_id: trade.qmt_order_id,
          },
          account: {
            account_id: trade.account_id,
            source: trade.source,
          },
          stock: {
            symbol: trade.symbol,
            name: trade.name,
            display_name: formatStockLabel(trade.symbol, trade.name),
          },
          trade: {
            side_raw: trade.side,
            side_text: formatSide(trade.side),
            price: trade.price,
            quantity: trade.quantity,
            amount: trade.amount,
            fee: trade.fee,
            trade_time: trade.trade_time,
          },
          strategy: {
            strategy_name: trade.strategy_name,
          },
          raw: trade,
        },
        null,
        2,
      ),
      width: 720,
      fieldColumns: 2,
      className: 'trade-detail-drawer',
      fields: [
        { label: '成交编号', value: trade.trade_id },
        { label: '本地订单号', value: trade.local_order_id ?? '暂无' },
        { label: 'QMT订单号', value: trade.qmt_order_id ?? '暂无' },
        { label: '账户', value: trade.account_id },
        { label: '股票', value: formatStockLabel(trade.symbol, trade.name) },
        { label: '方向', value: <Tag color={getSideColor(trade.side)}>{formatSide(trade.side)}</Tag>, copyValue: formatSide(trade.side) },
        { label: '成交价', value: formatPrice(trade.price) },
        { label: '成交数量', value: formatQuantity(trade.quantity) },
        { label: '成交金额', value: formatMoneyByUnit(trade.amount) },
        { label: '费用', value: formatMoneyByUnit(trade.fee) },
        { label: '来源', value: trade.source },
        { label: '策略', value: trade.strategy_name ?? '暂无' },
        { label: '成交时间', value: trade.trade_time },
      ],
    });
  };

  const openExecutionLogDetail = (record: ExecutionLogRecord) => {
    setLogDrawer({
      title: '交易执行日志详情',
      subtitle: record.created_at,
      status: record.level,
      statusTone: record.level === 'error' ? 'red' : record.level === 'warning' ? 'orange' : 'blue',
      message: record.message,
      technicalDetail: record.technical_detail,
      width: 720,
      fieldColumns: 2,
      className: 'execution-log-detail-drawer',
      fields: [
        { label: '日志ID', value: record.id },
        { label: '本地订单号', value: record.local_order_id ?? '暂无' },
        { label: '级别', value: record.level },
        { label: '时间', value: record.created_at },
      ],
    });
  };

  const ignoreSignal = async (signalId: number) => {
    const key = `ignore-${signalId}`;
    setActionBusyKey(key);
    try {
      await ignoreTradingSignal(signalId);
      message.success('信号已忽略');
      await loadAll();
    } catch (error) {
      showError('忽略信号失败', error);
    } finally {
      setActionBusyKey(null);
    }
  };

  const runTaskAction = async (label: string, action: () => Promise<TaskCreated>) => {
    if (actionBusyKey) return;
    setActionBusyKey(`task-${label}`);
    try {
      const task = await action();
      message.success(`${label}任务已创建`);
      await setTask(task);
    } catch (error) {
      showError(`${label}失败`, error);
    } finally {
      setActionBusyKey(null);
    }
  };

  const signalColumns: ColumnsType<TradingSignalRecord> = [
    { title: '信号时间', dataIndex: 'signal_time', width: TABLE_COL.time, fixed: 'left' },
    { title: '股票', width: TABLE_COL.stockWide, fixed: 'left', render: (_, record) => renderTradingAuditText(formatStockLabel(record.symbol, record.name)) },
    { title: '策略', dataIndex: 'strategy_name', width: TABLE_COL.strategyWide, responsive: ['xxl'], render: renderTradingAuditText },
    { title: '方向', dataIndex: 'action', width: TABLE_COL.side, render: (value: string) => <Tag color={getSideColor(value)}>{formatSide(value)}</Tag> },
    { title: '参考价', dataIndex: 'price', width: TABLE_COL.price, align: 'right', render: (value: number) => formatPrice(value) },
    { title: '建议金额', dataIndex: 'amount', width: TABLE_COL.amountWide, align: 'right', render: (value: number | null) => formatMoneyByUnit(value) },
    {
      title: '原因',
      dataIndex: 'reason',
      width: TABLE_COL.messageWide,
      responsive: ['xxl'],
      render: (reason: string, record) => (
        <button
          className="trading-reason-button"
          type="button"
          title={reason || '查看信号触发原因'}
          onClick={() => setLogDrawer({
            title: '信号触发原因',
            subtitle: formatStockLabel(record.symbol, record.name),
            status: record.status,
            statusTone: getStatusColor(record.status),
            width: 720,
            fieldColumns: 2,
            className: 'trading-signal-reason-drawer',
            message: reason || '暂无触发原因',
            technicalDetail: JSON.stringify(record, null, 2),
            fields: [
              { label: '策略名称', value: record.strategy_name },
              { label: '信号时间', value: record.signal_time },
              { label: '方向', value: formatSide(record.action) },
              { label: '参考价', value: formatPrice(record.price) },
              { label: '建议金额', value: formatMoney(record.amount) },
            ],
          })}
        >
          <span>{reason || '暂无触发原因'}</span>
        </button>
      ),
    },
    { title: '状态', dataIndex: 'status', width: TABLE_COL.status, render: statusTag },
    {
      title: '防重复',
      width: TABLE_COL.quantityWide,
      render: (_, record) => {
        const hasOrder = Boolean(record.order_id) || record.status === '已下单';
        return (
          <Tag color={hasOrder ? 'blue' : 'green'}>
            {hasOrder ? '已关联订单' : '同信号一单'}
          </Tag>
        );
      },
    },
    {
      title: '操作',
      width: TABLE_COL.detailAction,
      fixed: 'right',
      render: (_, record) => (
        <TableActionGroup
          primary={(
            <Button
              aria-label={`将信号 ${record.id} 转入下单确认`}
              title={tradingActionsLockedByMode ? (isRealQmt ? '真实 QMT 只读验收中，暂不允许信号下单' : '交易模式未检测，暂不允许信号下单') : `将信号 ${record.id} 转入下单确认`}
              size="small"
              type="primary"
              icon={<SendOutlined />}
              disabled={tradingActionsLockedByMode || submitting || Boolean(actionBusyKey) || record.status !== '未处理'}
              onClick={() => prepareSignalOrder(record)}
            >
              下单
            </Button>
          )}
          actions={[
            {
              key: 'ignore',
              label: actionBusyKey === `ignore-${record.id}` ? '忽略中' : '忽略',
              danger: true,
              disabled: submitting || Boolean(actionBusyKey) || record.status === '已忽略',
              onClick: () => ignoreSignal(record.id),
            },
          ]}
        />
      ),
    },
  ];

  const positionColumns: ColumnsType<TradingPosition> = [
    { title: '股票代码', dataIndex: 'symbol', width: TABLE_COL.stockCode, fixed: 'left' },
    { title: '股票名称', dataIndex: 'name', width: TABLE_COL.stockWide, fixed: 'left', render: renderTradingAuditText },
    { title: '持仓数量', dataIndex: 'quantity', width: TABLE_COL.quantity, align: 'right', render: (value: number) => formatQuantity(value) },
    { title: '可卖数量', dataIndex: 'available_quantity', width: TABLE_COL.quantity, align: 'right', render: (value: number) => formatQuantity(value) },
    { title: '成本价', dataIndex: 'cost_price', width: TABLE_COL.price, align: 'right', render: (value: number) => formatPrice(value) },
    { title: '最新价', dataIndex: 'last_price', width: TABLE_COL.price, align: 'right', render: (value: number) => formatPrice(value) },
    { title: '市值', dataIndex: 'market_value', width: TABLE_COL.amountWide, align: 'right', render: (value: number) => formatMoneyByUnit(value) },
    { title: '浮盈亏', dataIndex: 'pnl', width: TABLE_COL.amountWide, align: 'right', render: (value: number) => <Typography.Text type={getPnLTextType(value)}>{formatMoneyByUnit(value)}</Typography.Text> },
    {
      title: '操作',
      width: TABLE_COL.detailAction,
      fixed: 'right',
      render: (_, record) => (
        <TableActionGroup
          primary={(
            <Button aria-label={`查看持仓详情：${record.symbol}`} title={`查看持仓详情 ${record.symbol}`} size="small" icon={<FileTextOutlined />} onClick={() => openPositionDetail(record)}>
              详情
            </Button>
          )}
          actions={[
            {
              key: 'quick-sell',
              label: '填入卖出',
              disabled: tradingActionsLockedByMode,
              onClick: () => {
                form.setFieldsValue({ symbol: record.symbol, name: record.name, side: 'SELL', price: record.last_price, quantity: Math.max(Math.min(record.available_quantity, 100), 100) });
                message.success('已填入快速卖出表单');
              },
            },
          ]}
        />
      ),
    },
  ];

  const orderColumns: ColumnsType<TradingOrderRecord> = [
    { title: '本地订单号', dataIndex: 'local_order_id', width: TABLE_COL.orderId, fixed: 'left', render: renderTradingAuditText },
    { title: 'QMT订单号', dataIndex: 'qmt_order_id', width: TABLE_COL.qmtOrderId, responsive: ['xxl'], render: renderTradingAuditText },
    { title: '委托时间', dataIndex: 'order_time', width: TABLE_COL.time },
    { title: '股票', width: TABLE_COL.stockWide, render: (_, record) => renderTradingAuditText(formatStockLabel(record.symbol, record.name)) },
    { title: '方向', dataIndex: 'side', width: TABLE_COL.side, render: (value: string) => <Tag color={getSideColor(value)}>{formatSide(value)}</Tag> },
    { title: '价格', dataIndex: 'price', width: TABLE_COL.price, align: 'right', render: (value: number) => formatPrice(value) },
    { title: '数量', dataIndex: 'quantity', width: TABLE_COL.quantity, align: 'right', render: (value: number) => formatQuantity(value) },
    { title: '已成', dataIndex: 'filled_quantity', width: TABLE_COL.quantity, align: 'right', render: (value: number) => formatQuantity(value) },
    { title: '状态', dataIndex: 'status', width: TABLE_COL.status, render: statusTag },
    { title: '来源', dataIndex: 'source', width: TABLE_COL.type, responsive: ['xxl'] },
    { title: '信号ID', dataIndex: 'signal_id', width: TABLE_COL.signalId, responsive: ['xxl'], render: (value?: string | null) => value ?? '暂无' },
    { title: '策略', dataIndex: 'strategy_name', width: TABLE_COL.strategyWide, responsive: ['xxl'], render: renderTradingAuditText },
    {
      title: '操作',
      width: TABLE_COL.detailAction,
      fixed: 'right',
      render: (_, record) => (
        <TableActionGroup
          primary={(
            <Button
              aria-label={`查看订单详情：${record.local_order_id}`}
              title={`查看订单详情 ${record.local_order_id}`}
              size="small"
              icon={<FileTextOutlined />}
              onClick={() => openOrderDetail(record)}
            >
              详情
            </Button>
          )}
          actions={[
            {
              key: 'cancel',
              label: actionBusyKey === `cancel-${record.local_order_id}` ? '撤单处理中' : '撤单',
              danger: true,
              disabled: tradingActionsLockedByMode || Boolean(actionBusyKey) || !['待提交', '已提交', '已报', '部分成交'].includes(record.status),
              onClick: () => confirmCancel(record),
            },
          ]}
        />
      ),
    },
  ];

  const tradeColumns: ColumnsType<TradingTradeRecord> = [
    { title: '成交时间', dataIndex: 'trade_time', width: TABLE_COL.time, fixed: 'left' },
    { title: '股票', width: TABLE_COL.stockWide, render: (_, record) => renderTradingAuditText(formatStockLabel(record.symbol, record.name)) },
    { title: '方向', dataIndex: 'side', width: TABLE_COL.side, render: (value: string) => <Tag color={getSideColor(value)}>{formatSide(value)}</Tag> },
    { title: '成交价', dataIndex: 'price', width: TABLE_COL.price, align: 'right', render: (value: number) => formatPrice(value) },
    { title: '数量', dataIndex: 'quantity', width: TABLE_COL.quantity, align: 'right', render: (value: number) => formatQuantity(value) },
    { title: '金额', dataIndex: 'amount', width: TABLE_COL.amountWide, align: 'right', render: (value: number) => formatMoneyByUnit(value) },
    { title: '费用', dataIndex: 'fee', width: TABLE_COL.amountWide, align: 'right', render: (value: number) => formatMoneyByUnit(value) },
    { title: '来源', dataIndex: 'source', width: TABLE_COL.type },
    {
      title: '详情',
      width: TABLE_COL.detailAction,
      fixed: 'right',
      render: (_, record) => (
        <TableActionGroup
          primary={<Button aria-label={`查看成交详情：${record.trade_id}`} title={`查看成交详情 ${record.trade_id}`} size="small" icon={<FileTextOutlined />} onClick={() => openTradeDetail(record)}>详情</Button>}
        />
      ),
    },
  ];

  const logColumns: ColumnsType<ExecutionLogRecord> = [
    { title: '时间', dataIndex: 'created_at', width: TABLE_COL.time, fixed: 'left' },
    { title: '本地订单号', dataIndex: 'local_order_id', width: TABLE_COL.orderId, render: renderTradingAuditText },
    { title: '级别', dataIndex: 'level', width: TABLE_COL.level, render: (value: string) => <Tag color={value === 'error' ? 'red' : value === 'warning' ? 'orange' : 'blue'}>{value}</Tag> },
    { title: '消息', dataIndex: 'message', width: TABLE_COL.messageWide, render: renderTradingAuditText },
    { title: '技术详情', dataIndex: 'technical_detail', width: TABLE_COL.textWide, responsive: ['xxl'], render: renderTradingAuditText },
    {
      title: '详情',
      width: TABLE_COL.detailAction,
      fixed: 'right',
      render: (_, record) => (
        <TableActionGroup
          primary={<Button aria-label="查看交易执行日志详情" title="查看交易执行日志详情" size="small" onClick={() => openExecutionLogDetail(record)}>详情</Button>}
        />
      ),
    },
  ];

  return (
    <div className="module-page trading-page">
      <PageHeader
        title="交易执行"
        description="手动下单、信号下单、撤单、持仓、委托、成交和执行日志。"
        updatedAt={updatedAt}
        loading={loading}
        onRefresh={loadAll}
        extra={<DataFreshnessTag label="交易数据" updatedAt={updatedAt} loading={loading} />}
        secondaryActions={(
          <Button
            aria-label="顶部同步委托入口"
            title={orderSyncTitle}
            icon={<SyncOutlined />}
            loading={actionBusyKey === 'task-同步委托'}
            disabled={tradingActionsLockedByMode || Boolean(actionBusyKey)}
            onClick={() => runTaskAction('同步委托', syncTradingOrders)}
          >
            同步委托
          </Button>
        )}
        primaryAction={{ label: '处理信号', testId: 'btn-open-trading-signals', onClick: () => setActiveTab('信号下单') }}
      />

      <CommandPanel
        dataTestId="trading-safety-panel"
        eyebrow="ORDER CONTROL"
        title={tradingModeTitle}
        description={tradingModeDescription}
        actions={(
          <>
            <Tag color={tradingModeTagColor}>{tradingModeTagText}</Tag>
            <Tag color="green">人工确认保留</Tag>
            <Tag color={pendingSignalCount > 0 ? 'orange' : 'default'}>{pendingSignalCount} 条待处理信号</Tag>
          </>
        )}
        items={safetyItems.map((item) => ({
          label: item.label,
          value: item.value,
          helper: item.label === '提交保护' ? '防重复点击 / 幂等' : item.label === '订单链路' ? '委托 / 成交 / 日志' : undefined,
          tone: item.tone,
        }))}
      />

      <TaskProgress task={activeTask} />

      <section className="trading-guard-rail" aria-label="交易执行护栏说明">
        {executionGuardItems.map((item) => (
          <div className={`trading-guard-rail__item trading-guard-rail__item--${item.tone}`} key={item.title}>
            <Typography.Text strong>{item.title}</Typography.Text>
            <Typography.Text type="secondary">{item.description}</Typography.Text>
          </div>
        ))}
      </section>

      <Row gutter={[8, 8]} className="trading-overview">
        <Col xs={24} sm={12} xl={6}>
          <MetricCard label="可用资金" value={<FinancialNumber value={account?.available_cash} tone="primary" compact />} subValue="手动和信号下单共用" icon={<WalletOutlined />} tone="blue" />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <MetricCard label="持仓市值" value={<FinancialNumber value={account?.market_value} tone="neutral" compact />} subValue={`${positionPage.total || positions.length} 条持仓`} icon={<FileTextOutlined />} tone="neutral" />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <MetricCard label="待处理信号" value={`${pendingSignalCount} 条`} subValue={`${signalPage.total || signals.length} 条信号记录`} icon={<TransactionOutlined />} tone={pendingSignalCount > 0 ? 'orange' : 'green'} />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <MetricCard label="成交额/委托" value={<FinancialNumber value={todayTradeAmount} tone="neutral" compact />} subValue={`${activeOrderCount} 活跃 / ${failedOrderCount} 异常`} icon={<ClockCircleOutlined />} tone={failedOrderCount > 0 ? 'red' : 'blue'} />
        </Col>
      </Row>

      <WorkbenchNav
        ariaLabel="交易执行流程"
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          { key: '信号下单', title: '策略信号', description: `${pendingSignalCount} 条待处理`, tone: pendingSignalCount > 0 ? 'warning' : 'neutral' },
          { key: '交易面板', title: '人工确认', description: '确认弹窗保留，请求中锁定', tone: 'success' },
          { key: '委托记录', title: '委托状态', description: `${activeOrderCount} 活跃 / ${failedOrderCount} 异常`, tone: failedOrderCount > 0 ? 'danger' : 'info' },
          { key: '成交记录', title: '成交回写', description: `${trades.length} 条当前页成交`, tone: 'neutral' },
          { key: '执行日志', title: '日志追踪', description: `${logs.length} 条当前页日志`, tone: 'neutral' },
        ] satisfies WorkbenchNavItem<TradingTabKey>[]}
      />

      <Tabs
        className="trading-tabs"
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as TradingTabKey)}
        items={[
          {
            key: '信号下单',
            label: '信号下单',
            children: (
              <SectionCard title="信号下单" description="策略信号只进入人工确认流程，不会自动提交委托。" extra={<Tag color={pendingSignalCount > 0 ? 'orange' : 'default'}>{pendingSignalCount} 条待处理</Tag>}>
                <div className="trading-signal-layout" data-testid="trading-signal-layout">
                  <div className="trading-signal-layout__table">
                    <DataTable<TradingSignalRecord>
                      rowKey="id"
                      columns={signalColumns}
                      className="data-table--trading-signals"
                      dataSource={signals}
                      loading={loading}
                      updatedAt={updatedAt}
                      onRefresh={loadAll}
                      pagination={{ current: signalPage.page, pageSize: signalPage.pageSize, total: signalPage.total, showSizeChanger: true }}
                      onChange={(pagination) => setSignalPage({ page: pagination.current ?? 1, pageSize: pagination.pageSize ?? TRADING_WORKBENCH_PAGE_SIZE, total: signalPage.total })}
                      data-testid="table-trading-signals"
                      tableLayout="fixed"
                      scroll={{ x: 'max-content' }}
                      quickSearch={{ placeholder: '当前页搜索策略/股票/原因', fields: ['strategy_name', 'symbol', 'name', 'reason'], width: 260 }}
                      quickFilters={[
                        { label: '信号状态', options: [{ label: '未处理', value: '未处理' }, { label: '已下单', value: '已下单' }, { label: '已忽略', value: '已忽略' }], getValue: (record) => record.status },
                        { label: '方向', options: [{ label: '买入', value: 'BUY' }, { label: '卖出', value: 'SELL' }], getValue: (record) => record.action },
                      ]}
                      emptyDescription="暂无可下单信号。请先到“策略开发”运行策略；已有信号会在这里进入人工确认下单流程，不会自动交易。"
                      emptyAction={
                        <Link to="/strategy-dev?tab=代码编辑">
                          <Button aria-label="从空状态打开策略开发" title="打开策略开发并编辑策略" icon={<FileTextOutlined />}>
                            打开策略开发
                          </Button>
                        </Link>
                      }
                    />
                  </div>
                  <aside className="trading-signal-layout__rail" data-testid="trading-signal-safety-rail" aria-label="信号下单安全边界">
                    <div className="trading-signal-flow-head">
                      <Typography.Text className="trading-signal-flow-head__eyebrow">ORDER GUARD</Typography.Text>
                      <Typography.Text strong className="trading-signal-flow-head__title">信号下单安全边界</Typography.Text>
                      <Typography.Text type="secondary" className="trading-signal-flow-head__desc">
                        策略信号只进入人工确认；真实下单必须经过确认弹窗和幂等保护。
                      </Typography.Text>
                    </div>
                    <div className="trading-signal-flow-list">
                      {[
                        [<FileTextOutlined key="signal" />, '策略信号', '只读取已落库信号，不允许策略直接调用 QMT。'],
                        [<CheckCircleOutlined key="confirm" />, '人工确认', '下单前必须核对股票、方向、价格、数量和金额。'],
                        [<ClockCircleOutlined key="lock" />, '请求锁定', '按钮请求中禁用，同一 signal_id 不重复生成有效订单。'],
                        [<ExclamationCircleOutlined key="trace" />, '日志追踪', '失败、撤单和状态同步必须保留中文原因与技术详情。'],
                      ].map(([icon, title, desc]) => (
                        <div className="trading-signal-flow-step" key={String(title)}>
                          <span className="trading-signal-flow-step__icon">{icon}</span>
                          <span className="trading-signal-flow-step__body">
                            <Typography.Text strong>{title}</Typography.Text>
                            <Typography.Text type="secondary">{desc}</Typography.Text>
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="trading-signal-flow-actions">
                      <Link to="/strategy-dev?tab=代码编辑">
                        <Button aria-label="安全边界打开策略开发" title="打开策略开发并编辑策略" icon={<FileTextOutlined />}>
                          策略开发
                        </Button>
                      </Link>
                      <Button aria-label="安全边界打开交易面板" title="打开交易面板" icon={<SendOutlined />} onClick={() => setActiveTab('交易面板')}>
                        交易面板
                      </Button>
                      <Button aria-label="安全边界刷新交易数据" title="刷新交易数据" icon={<ReloadOutlined />} loading={loading} onClick={loadAll}>
                        刷新
                      </Button>
                    </div>
                  </aside>
                </div>
              </SectionCard>
            ),
          },
          {
            key: '交易面板',
            label: '交易面板',
            children: (
              <div className="trading-manual-workbench" data-testid="trading-manual-workbench">
                <Row gutter={[8, 8]} align="stretch" className="trading-manual-workbench__grid">
                <Col xs={24} xl={7}>
                  <SectionCard title="下单核对" description="下单前先核对资金、可卖数量和委托金额。">
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      <MetricCard label="可用资金" value={<FinancialNumber value={account?.available_cash} tone="primary" compact />} />
                      <MetricCard label="当前可卖" value={side === 'SELL' ? formatQuantity(selectedPosition?.available_quantity ?? 0) : '-'} />
                      <MetricCard label="委托金额" value={<FinancialNumber value={price * quantity} tone={side === 'SELL' ? 'loss' : 'profit'} compact />} tone={side === 'SELL' ? 'green' : 'red'} />
                      <Alert
                        type="warning"
                        showIcon
                        icon={<ExclamationCircleOutlined />}
                        message="人工确认后才会提交"
                        description={isRealQmt ? '真实 QMT 只读验收中，页面暂不提交真实委托。请先核对数据中心的真实账户和持仓。' : '按钮提交后会弹出确认框，并在请求中锁定，避免重复点击。'}
                      />
                      <div className="trading-checklist" data-testid="trading-checklist">
                        <div className="trading-checklist__item">
                          <span>股票代码</span>
                          <Tag color={symbol ? 'blue' : 'orange'}>{symbol || '未填写'}</Tag>
                        </div>
                        <div className="trading-checklist__item">
                          <span>委托金额</span>
                          <Typography.Text strong>{formatMoney(orderAmount)}</Typography.Text>
                        </div>
                        <div className="trading-checklist__item">
                          <span>数量规则</span>
                          <Tag color={lotRulePassed ? 'green' : 'orange'}>100股一手</Tag>
                        </div>
                        <div className="trading-checklist__item">
                          <span>提交状态</span>
                          <Tag color={actionLocked ? 'orange' : 'green'}>{actionLocked ? '请求中锁定' : '可提交'}</Tag>
                        </div>
                      </div>
                    </Space>
                  </SectionCard>
                </Col>
                <Col xs={24} xl={11}>
                  <SectionCard title="手动下单" description="手动下单也会生成 local_order_id，并写入执行日志。">
                    <div className={`order-ticket order-ticket--${side === 'SELL' ? 'sell' : 'buy'} ${tradingActionsLockedByMode ? 'order-ticket--readonly' : ''}`} data-testid="manual-order-ticket">
                      {tradingActionsLockedByMode ? (
                        <div className="order-ticket__readonly-mask" aria-hidden="true">
                          <ExclamationCircleOutlined />
                          <span>{readonlyMaskText}</span>
                        </div>
                      ) : null}
                      <div className="order-ticket__head">
                        <div>
                          <Typography.Text className="order-ticket__eyebrow">订单票据</Typography.Text>
                          <Typography.Title level={4} className="order-ticket__title">
                            {side === 'SELL' ? '卖出委托' : '买入委托'}
                          </Typography.Title>
                        </div>
                        <Tag color={tradingModeTagColor}>{isRealQmt ? '真实只读' : isTestIsolationQmt ? '测试确认' : '未检测'}</Tag>
                      </div>
                      <Form form={form} layout="vertical" initialValues={initialOrder} onFinish={prepareManualOrder}>
                        <Row gutter={16}>
                          <Col xs={24} md={7}>
                            <Form.Item name="symbol" label="股票代码" rules={[{ required: true, message: '请输入股票代码' }]}>
                              <Input placeholder="600000.SH" disabled={tradingActionsLockedByMode} />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={7}>
                            <Form.Item name="name" label="股票名称">
                              <Input disabled={tradingActionsLockedByMode} />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={10}>
                            <Form.Item name="side" label="买卖方向" rules={[{ required: true }]}>
                              <Segmented block disabled={tradingActionsLockedByMode} options={[{ value: 'BUY', label: '买入' }, { value: 'SELL', label: '卖出' }]} />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={8}>
                            <Form.Item name="price" label="委托价格" rules={[{ required: true }]}>
                              <InputNumber min={0.01} step={0.01} style={{ width: '100%' }} disabled={tradingActionsLockedByMode} />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={8}>
                            <Form.Item name="quantity" label="委托数量" rules={[{ required: true }]}>
                              <InputNumber min={100} step={100} style={{ width: '100%' }} disabled={tradingActionsLockedByMode} />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={8}>
                            <Form.Item label="订单金额">
                              <div className="order-ticket__amount">
                                <FinancialNumber value={orderAmount} tone={side === 'SELL' ? 'loss' : 'profit'} />
                              </div>
                            </Form.Item>
                          </Col>
                        </Row>
                        <div className="order-ticket__summary">
                          <span>资金：<strong>{formatMoney(account?.available_cash ?? 0)}</strong></span>
                          <span>可卖：<strong>{side === 'SELL' ? formatQuantity(selectedPosition?.available_quantity ?? 0) : '-'}</strong></span>
                          <span>规则：<strong>{lotRulePassed ? '100股整数倍' : '数量待修正'}</strong></span>
                          <span>状态：<strong>{tradingActionsLockedByMode ? (isRealQmt ? '只读阻断' : '未检测锁定') : actionLocked ? '请求中' : '待确认'}</strong></span>
                        </div>
                        <Space className="order-ticket__actions">
                          <Button
                            aria-label="提交手动下单并进入确认"
                            title={tradingActionsLockedByMode ? lockedModeTitle : '提交手动下单并进入确认'}
                            htmlType="submit"
                            type="primary"
                            icon={<SendOutlined />}
                            loading={submitting}
                            disabled={tradingActionsLockedByMode || Boolean(actionBusyKey)}
                            data-testid="btn-submit-order"
                          >
                            {side === 'SELL' ? '确认卖出' : '确认买入'}
                          </Button>
                          <Button aria-label="重置手动下单表单" title="重置手动下单表单" disabled={tradingActionsLockedByMode} onClick={() => form.resetFields()}>重置</Button>
                        </Space>
                      </Form>
                    </div>
                  </SectionCard>
                </Col>
                <Col xs={24} xl={6}>
                  <SectionCard className="trading-submit-trace-card" title="提交后追踪" description="下单不是结束，必须核对订单、成交、日志。">
                    <div className="trading-submit-trace" data-testid="trading-submit-trace">
                      {[
                        ['01', '本地订单', 'local_order_id 在调用 QMT 前生成'],
                        ['02', 'QMT 回写', 'qmt_order_id 仅在 QMT 返回后保存'],
                        ['03', '信号关联', 'signal_id / strategy_name 保留来源'],
                        ['04', '状态同步', '委托与成交以同步结果更新'],
                        ['05', '失败诊断', '失败、撤单和废单写执行日志'],
                      ].map(([index, title, description]) => (
                        <div className="trading-submit-trace__item" key={index}>
                          <span>{index}</span>
                          <strong>{title}</strong>
                          <em>{description}</em>
                        </div>
                      ))}
                    </div>
                  </SectionCard>
                </Col>
              </Row>
                <div className="trading-panel-lifecycle" data-testid="trading-panel-lifecycle">
                  {orderLifecycleItems.map((item) => (
                    <span key={item.label} className={`order-lifecycle__step order-lifecycle__step--${item.tone}`}>
                      <span>{item.label}</span>
                      <strong>{item.count}</strong>
                    </span>
                  ))}
                </div>
                <div className="trading-panel-boundary" data-testid="trading-panel-boundary">
                  <span>人工确认保留</span>
                  <span>请求中按钮锁定</span>
                  <span>同一 signal_id 仅一笔有效订单</span>
                  <span>真实只读模式不提交委托</span>
                </div>
              </div>
            ),
          },
          {
            key: '当前持仓',
            label: '当前持仓',
            children: (
              <SectionCard
                className="trading-record-workbench trading-record-workbench--positions"
                title="当前持仓"
                description={isRealQmt ? '仅展示当前真实账户的最新持仓快照；真实验收中不提供快速卖出填表。' : '持仓数据只读展示，快速卖出只填入表单，不会直接提交。'}
              >
                <DataTable<TradingPosition>
                  rowKey="id"
                  columns={positionColumns}
                  className="data-table--trading-positions"
                  dataSource={positions}
                  loading={loading}
                  updatedAt={updatedAt}
                  onRefresh={loadAll}
                  pagination={{ current: positionPage.page, pageSize: positionPage.pageSize, total: positionPage.total, showSizeChanger: true }}
                  onChange={(pagination) => setPositionPage({ page: pagination.current ?? 1, pageSize: pagination.pageSize ?? TRADING_WORKBENCH_PAGE_SIZE, total: positionPage.total })}
                  data-testid="table-trading-positions"
                  tableLayout="fixed"
                  scroll={{ x: TABLE_SCROLL_X.tradingPositions }}
                  quickSearch={{ placeholder: '当前页搜索股票代码/名称', fields: ['symbol', 'name'], width: 240 }}
                  emptyDescription="暂无持仓数据。请先到“数据中心 / 数据同步”同步持仓，或检查当前账户是否已有持仓。"
                />
              </SectionCard>
            ),
          },
          {
            key: '委托记录',
            label: '委托记录',
            children: (
              <SectionCard
                className="trading-record-workbench trading-record-workbench--orders"
                title="委托记录"
                description={isRealQmt ? '仅展示当前真实账户的委托记录；测试历史委托不会混入本页。' : '按生命周期跟踪 local_order_id、QMT 订单号、状态和来源。'}
                extra={
                  <Button aria-label="同步委托订单状态" title={orderSyncTitle} icon={<SyncOutlined />} loading={actionBusyKey === 'task-同步委托'} disabled={tradingActionsLockedByMode || Boolean(actionBusyKey)} onClick={() => runTaskAction('同步委托', syncTradingOrders)}>
                    同步状态
                  </Button>
                }
              >
                <div className="order-lifecycle" data-testid="order-lifecycle">
                  {orderLifecycleItems.map((item) => (
                    <span key={item.label} className={`order-lifecycle__step order-lifecycle__step--${item.tone}`}>
                      <span>{item.label}</span>
                      <strong>{item.count}</strong>
                    </span>
                  ))}
                </div>
                <div className="order-lifecycle-note">
                  <Typography.Text strong>状态说明</Typography.Text>
                  <Typography.Text type="secondary">
                    待提交、已提交、已报表示委托尚未最终成交；部分成交、全部成交来自委托/成交同步回写；已撤、废单、失败需要打开执行日志核对中文原因和技术详情。
                  </Typography.Text>
                </div>
                <DataTable<TradingOrderRecord>
                  rowKey="local_order_id"
                  columns={orderColumns}
                  className="data-table--trading-orders"
                  dataSource={orders}
                  loading={loading}
                  updatedAt={updatedAt}
                  onRefresh={loadAll}
                  pagination={{ current: orderPage.page, pageSize: orderPage.pageSize, total: orderPage.total, showSizeChanger: true }}
                  onChange={(pagination) => setOrderPage({ page: pagination.current ?? 1, pageSize: pagination.pageSize ?? TRADING_AUDIT_PAGE_SIZE, total: orderPage.total })}
                  data-testid="table-trading-orders"
                  tableLayout="fixed"
                  scroll={{ x: 'max-content' }}
                  quickSearch={{ placeholder: '当前页搜索订单号/股票', fields: ['local_order_id', 'qmt_order_id', 'symbol', 'name'], width: 260 }}
                  quickFilters={[
                    {
                      label: '订单状态',
                      options: ['待提交', '已提交', '已报', '部分成交', '全部成交', '已撤', '废单', '失败', '待同步'].map((value) => ({ label: value, value })),
                      getValue: (record) => record.status,
                    },
                    { label: '来源', options: ['manual', 'signal', 'auto', 'real_sync', 'test_sync'].map((value) => ({ label: value, value })), getValue: (record) => normalizeSyncSource(record.source) || record.source },
                  ]}
                  emptyDescription={isRealQmt ? '暂无真实委托记录。请到“数据中心”执行委托只读同步；交易执行页不会在真实只读验收中调用同步或下单。' : '暂无委托记录。手动下单、信号下单或点击右上“同步状态”后，会显示订单生命周期。'}
                />
              </SectionCard>
            ),
          },
          {
            key: '成交记录',
            label: '成交记录',
            children: (
              <SectionCard
                className="trading-record-workbench trading-record-workbench--trades"
                title="成交记录"
                description={isRealQmt ? '仅展示当前真实账户的成交记录；真实 QMT 无成交时保持空状态。' : '成交价、数量、费用、来源和策略名称用于核对订单一致性。'}
                extra={
                  <Button aria-label="同步成交记录" title={tradeSyncTitle} icon={<CheckCircleOutlined />} loading={actionBusyKey === 'task-同步成交'} disabled={tradingActionsLockedByMode || Boolean(actionBusyKey)} onClick={() => runTaskAction('同步成交', syncTradingTrades)}>
                    同步成交
                  </Button>
                }
              >
                <DataTable<TradingTradeRecord>
                  rowKey="trade_id"
                  columns={tradeColumns}
                  className="data-table--trading-trades"
                  dataSource={trades}
                  loading={loading}
                  updatedAt={updatedAt}
                  onRefresh={loadAll}
                  pagination={{ current: tradePage.page, pageSize: tradePage.pageSize, total: tradePage.total, showSizeChanger: true }}
                  onChange={(pagination) => setTradePage({ page: pagination.current ?? 1, pageSize: pagination.pageSize ?? TRADING_WORKBENCH_PAGE_SIZE, total: tradePage.total })}
                  data-testid="table-trading-trades"
                  tableLayout="fixed"
                  scroll={{ x: 'max-content' }}
                  quickSearch={{ placeholder: '当前页搜索股票/来源/策略', fields: ['symbol', 'name', 'source', 'strategy_name'], width: 260 }}
                  quickFilters={[{ label: '方向', options: [{ label: '买入', value: 'BUY' }, { label: '卖出', value: 'SELL' }], getValue: (record) => record.side }]}
                  emptyDescription={isRealQmt ? '暂无真实成交记录。请到“数据中心”执行成交只读同步；交易执行页不会在真实只读验收中调用成交同步。' : '暂无成交记录。请点击右上“同步成交”；同步完成后会显示成交价、数量、费用和来源。'}
                />
              </SectionCard>
            ),
          },
          {
            key: '执行日志',
            label: '执行日志',
            children: (
              <SectionCard
                className="trading-record-workbench trading-record-workbench--logs"
                title="执行日志"
                description={isRealQmt ? '仅展示当前真实账户相关执行日志，测试历史日志已隔离。' : '下单、撤单、失败和同步操作都会记录，便于追踪问题。'}
                extra={<Button aria-label="刷新交易执行日志" title="刷新交易执行日志" icon={<ReloadOutlined />} loading={loading} disabled={loading} onClick={loadAll}>刷新日志</Button>}
              >
                <DataTable<ExecutionLogRecord>
                  rowKey="id"
                  columns={logColumns}
                  className="data-table--trading-logs"
                  dataSource={logs}
                  loading={loading}
                  updatedAt={updatedAt}
                  onRefresh={loadAll}
                  pagination={{ current: logPage.page, pageSize: logPage.pageSize, total: logPage.total, showSizeChanger: true }}
                  onChange={(pagination) => setLogPage({ page: pagination.current ?? 1, pageSize: pagination.pageSize ?? TRADING_AUDIT_PAGE_SIZE, total: logPage.total })}
                  data-testid="table-trading-logs"
                  tableLayout="fixed"
                  scroll={{ x: 'max-content' }}
                  quickSearch={{ placeholder: '当前页搜索订单号/消息', fields: ['local_order_id', 'message', 'technical_detail'], width: 260 }}
                  quickFilters={[{ label: '日志级别', options: ['info', 'warning', 'error'].map((value) => ({ label: value, value })), getValue: (record) => record.level }]}
                  emptyDescription={isRealQmt ? '暂无真实交易执行日志。当前为只读验收状态，真实下单、撤单和交易中心同步均不会执行。' : '暂无执行日志。执行下单、撤单、同步，或点击“刷新日志”后，相关操作记录会显示在这里。'}
                />
              </SectionCard>
            ),
          },
        ]}
      />

      <OrderConfirmModal open={Boolean(confirmData)} data={confirmData} loading={submitting} onCancel={closeConfirm} onConfirm={runConfirmed} />
      <ErrorDetailModal
        open={Boolean(errorState)}
        message={errorState?.message ?? ''}
        error={errorState?.error}
        traceId={errorState?.traceId}
        onClose={() => setErrorState(null)}
      />
      <LogDrawer
        open={Boolean(logDrawer)}
        title={logDrawer?.title ?? ''}
        subtitle={logDrawer?.subtitle}
        status={logDrawer?.status}
        message={logDrawer?.message}
        technicalDetail={logDrawer?.technicalDetail}
        fields={logDrawer?.fields}
        width={logDrawer?.width}
        fieldColumns={logDrawer?.fieldColumns}
        className={logDrawer?.className}
        onClose={() => setLogDrawer(null)}
      />
    </div>
  );
}
