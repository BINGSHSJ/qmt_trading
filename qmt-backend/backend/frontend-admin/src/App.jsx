import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  ConfigProvider,
  Descriptions,
  Drawer,
  Form,
  Input,
  InputNumber,
  notification,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  AlertOutlined,
  DashboardOutlined,
  FileTextOutlined,
  LineChartOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { PageContainer, ProLayout } from '@ant-design/pro-components';
import dayjs from 'dayjs';
import zhCN from 'antd/locale/zh_CN';
import { apiGet, apiPost, getWsTicket, initSession } from './api';
import './App.css';

const { Text } = Typography;

const MENU_ITEMS = [
  { path: '/dashboard', name: '系统总览', icon: <DashboardOutlined /> },
  { path: '/strategies', name: '策略中心', icon: <SafetyCertificateOutlined /> },
  { path: '/trading', name: '交易中心', icon: <LineChartOutlined /> },
  { path: '/risk', name: '风控中心', icon: <AlertOutlined /> },
  { path: '/logs', name: '数据与日志中心', icon: <FileTextOutlined /> },
];

const STATUS_MAP = {
  running: { color: 'success', text: '运行中' },
  registered: { color: 'default', text: '已注册' },
  stopped: { color: 'default', text: '已停止' },
  error: { color: 'error', text: '异常' },
  paused: { color: 'warning', text: '暂停' },
  pending_restart: { color: 'processing', text: '待重启' },
  loaded: { color: 'processing', text: '已加载' },
  approved: { color: 'success', text: '通过' },
  rejected: { color: 'error', text: '拒绝' },
  skipped: { color: 'default', text: '跳过' },
  pending: { color: 'warning', text: '待处理' },
  submitted: { color: 'processing', text: '已提交' },
  filled: { color: 'success', text: '已成交' },
  partial_filled: { color: 'processing', text: '部分成交' },
  canceled: { color: 'default', text: '已撤单' },
  normal: { color: 'success', text: '正常' },
  degraded: { color: 'warning', text: '降级' },
};

function statusTag(status) {
  const meta = STATUS_MAP[status] || { color: 'default', text: status || '-' };
  return <Tag color={meta.color}>{meta.text}</Tag>;
}

function fmtMoney(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return Number(value).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtTime(value) {
  if (!value) return '-';
  return dayjs(value).format('YYYY-MM-DD HH:mm:ss');
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export default function App() {
  const [messageApi, contextHolder] = message.useMessage();
  const [pathname, setPathname] = useState('/dashboard');
  const [loading, setLoading] = useState(false);

  const [health, setHealth] = useState({});
  const [strategies, setStrategies] = useState([]);
  const [positions, setPositions] = useState([]);
  const [signals, setSignals] = useState([]);
  const [orders, setOrders] = useState([]);
  const [fills, setFills] = useState([]);
  const [riskEvents, setRiskEvents] = useState([]);
  const [riskRules, setRiskRules] = useState({});
  const [systemLogs, setSystemLogs] = useState([]);
  const [wsEvents, setWsEvents] = useState([]);
  const [wsConnected, setWsConnected] = useState(false);

  const [strategyDrawerOpen, setStrategyDrawerOpen] = useState(false);
  const [strategyForm] = Form.useForm();
  const [signalForm] = Form.useForm();
  const [tradeTab, setTradeTab] = useState('signals');
  const [logTab, setLogTab] = useState('systemLogs');
  const actionBusyRef = useRef({});
  const [, forceUpdate] = useState(0);
  const setActionBusy = useCallback((updater) => {
    actionBusyRef.current = typeof updater === 'function' ? updater(actionBusyRef.current) : updater;
    forceUpdate((n) => n + 1);
  }, []);
  const actionBusy = actionBusyRef.current;
  const visibleRef = useRef(true);

  const loadHealth = useCallback(async () => {
    const res = await apiGet('/system-health');
    if (res.code === 0) setHealth(res.data || {});
  }, []);

  const loadStrategies = useCallback(async () => {
    const res = await apiGet('/strategies');
    if (res.code === 0) setStrategies(safeArray(res.data));
  }, []);

  const loadPositions = useCallback(async () => {
    const res = await apiGet('/trading/positions');
    if (res.code === 0) setPositions(safeArray(res.data));
  }, []);

  const loadSignals = useCallback(async () => {
    const res = await apiGet('/trading/signals?limit=100');
    if (res.code === 0) setSignals(safeArray(res.data));
  }, []);

  const loadOrders = useCallback(async () => {
    const res = await apiGet('/trading/orders?limit=100');
    if (res.code === 0) setOrders(safeArray(res.data));
  }, []);

  const loadFills = useCallback(async () => {
    const res = await apiGet('/trading/fills?limit=100');
    if (res.code === 0) setFills(safeArray(res.data));
  }, []);

  const loadRiskEvents = useCallback(async () => {
    const res = await apiGet('/risk/events?limit=100');
    if (res.code === 0) setRiskEvents(safeArray(res.data));
  }, []);

  const loadRiskRules = useCallback(async () => {
    const res = await apiGet('/risk/rules');
    if (res.code === 0) setRiskRules(res.data || {});
  }, []);

  const loadSystemLogs = useCallback(async () => {
    const res = await apiGet('/logs?limit=100');
    if (res.code === 0) setSystemLogs(safeArray(res.data));
  }, []);

  const refreshCurrentPage = useCallback(async () => {
    setLoading(true);
    try {
      await loadHealth();
      if (pathname === '/dashboard') {
        await Promise.all([loadStrategies(), loadPositions(), loadSignals(), loadOrders()]);
      } else if (pathname === '/strategies') {
        await loadStrategies();
      } else if (pathname === '/trading') {
        await Promise.all([loadSignals(), loadOrders(), loadFills(), loadPositions()]);
      } else if (pathname === '/risk') {
        await Promise.all([loadRiskRules(), loadRiskEvents()]);
      } else if (pathname === '/logs') {
        await Promise.all([loadSystemLogs()]);
      }
    } finally {
      setLoading(false);
    }
  }, [
    loadFills,
    loadHealth,
    loadOrders,
    loadPositions,
    loadRiskEvents,
    loadRiskRules,
    loadSignals,
    loadStrategies,
    loadSystemLogs,
    pathname,
  ]);

  useEffect(() => {
    let ws = null;
    let retryTimer = null;
    let closed = false;

    const connect = async () => {
      if (closed) return;
      const ticket = await getWsTicket();
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const query = ticket ? `?ticket=${encodeURIComponent(ticket)}` : '';
      ws = new WebSocket(`${protocol}://${window.location.host}/ws${query}`);

      ws.onopen = () => {
        setWsConnected(true);
        // WS 重连后主动刷新，补偿断连期间可能丢失的事件
        refreshCurrentPage();
      };
      ws.onclose = () => {
        setWsConnected(false);
        if (!closed) {
          retryTimer = setTimeout(connect, 5000);
        }
      };
      ws.onerror = () => ws?.close();
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'pong') return;

          // system_error / strategy_error → 显著提示
          if (msg.type === 'system_error' || msg.type === 'strategy_error') {
            notification.error({
              message: msg.type === 'system_error' ? '系统异常' : '策略异常',
              description: msg.data?.message || JSON.stringify(msg.data || {}),
              duration: 8,
            });
          }

          setWsEvents((prev) => {
            const next = [
              {
                key: `${Date.now()}-${Math.random()}`,
                type: msg.type || 'event',
                detail: JSON.stringify(msg.data || {}),
                timestamp: msg.timestamp || new Date().toISOString(),
              },
              ...prev,
            ];
            return next.slice(0, 100);
          });
        } catch {
          // ignore non-json payload
        }
      };
    };

    (async () => {
      await initSession();
      await refreshCurrentPage();
      connect();
    })();

    const pingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send('ping');
      }
    }, 30000);

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      clearInterval(pingTimer);
      ws?.close();
    };
  }, [refreshCurrentPage]);

  // 页面可见性 — 不可见时暂停轮询
  useEffect(() => {
    const handler = () => { visibleRef.current = !document.hidden; };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  useEffect(() => {
    const timers = [];
    const addTask = (fn, ms) => {
      const guard = () => { if (visibleRef.current) fn(); };
      guard();
      timers.push(setInterval(guard, ms));
    };

    // v2.8 轮询频率
    addTask(loadHealth, 10000);

    if (pathname === '/dashboard') {
      addTask(loadStrategies, 5000);
      addTask(loadPositions, 3000);
      addTask(loadSignals, 3000);
      addTask(loadOrders, 3000);
    }

    if (pathname === '/strategies') {
      addTask(loadStrategies, 5000);
    }

    if (pathname === '/trading') {
      if (tradeTab === 'signals') addTask(loadSignals, 3000);
      if (tradeTab === 'orders') addTask(loadOrders, 3000);
      if (tradeTab === 'fills') addTask(loadFills, 3000);
      if (tradeTab === 'positions') addTask(loadPositions, 3000);
    }

    if (pathname === '/risk') {
      addTask(loadRiskRules, 30000);
      addTask(loadRiskEvents, 10000);
    }

    if (pathname === '/logs') {
      if (logTab === 'systemLogs') addTask(loadSystemLogs, 30000);
      if (logTab === 'wsEvents') { /* ws events are pushed, no polling needed */ }
    }

    return () => timers.forEach(clearInterval);
  }, [
    loadFills,
    loadHealth,
    loadOrders,
    loadPositions,
    loadRiskEvents,
    loadRiskRules,
    loadSignals,
    loadStrategies,
    loadSystemLogs,
    logTab,
    pathname,
    tradeTab,
  ]);

  const handleStrategyAction = useCallback(
    async (strategyId, action) => {
      const busyKey = `${strategyId}_${action}`;
      if (actionBusy[busyKey]) return;
      setActionBusy((prev) => ({ ...prev, [busyKey]: true }));
      try {
        const res = await apiPost(`/strategies/${strategyId}/${action}`, {});
        if (res.code === 0) {
          messageApi.success(`策略 ${strategyId} ${action === 'start' ? '已启动' : '已停止'}`);
        } else if (action === 'stop' && res.code === 6003) {
          messageApi.warning(`策略 ${strategyId} 已停止，但有告警：${res.message}`);
        } else {
          messageApi.error(res.message || '操作失败');
        }
        await Promise.all([loadStrategies(), loadHealth()]);
      } finally {
        setTimeout(() => setActionBusy((prev) => ({ ...prev, [busyKey]: false })), 3000);
      }
    },
    [actionBusy, loadHealth, loadStrategies, messageApi]
  );

  const handleRegisterStrategy = useCallback(async () => {
    const values = await strategyForm.validateFields();
    let envOverrides = {};
    const envText = (values.env_overrides || '').trim();
    if (envText) {
      try {
        const parsed = JSON.parse(envText);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          envOverrides = parsed;
        } else {
          messageApi.error('环境变量覆盖必须是 JSON 对象');
          return;
        }
      } catch {
        messageApi.error('环境变量覆盖 JSON 格式不正确');
        return;
      }
    }

    const res = await apiPost('/strategies', {
      strategy_id: values.strategy_id,
      name: values.name,
      description: values.description || '',
      start_script: values.start_script || '',
      stop_script: values.stop_script || '',
      working_dir: values.working_dir || '',
      env_overrides: envOverrides,
    });

    if (res.code === 0) {
      messageApi.success('策略注册成功');
      strategyForm.resetFields();
      setStrategyDrawerOpen(false);
      await loadStrategies();
    } else {
      messageApi.error(res.message || '策略注册失败');
    }
  }, [loadStrategies, messageApi, strategyForm]);

  const handleSubmitSignal = useCallback(async () => {
    const values = await signalForm.validateFields();
    const payload = {
      signal_id: values.signal_id,
      strategy_id: values.strategy_id,
      symbol: values.symbol,
      signal_type: values.signal_type,
      signal_price: Number(values.signal_price),
      confidence: Number(values.confidence || 0),
      reason: values.reason || '',
    };
    if (values.target_volume) payload.target_volume = Number(values.target_volume);
    if (values.target_value) payload.target_value = Number(values.target_value);

    if (actionBusy.submitSignal) return;
    setActionBusy((prev) => ({ ...prev, submitSignal: true }));
    try {
      const res = await apiPost('/trading/signals', payload);
      if (res.code === 0) {
        messageApi.success(`信号已提交：${res.data?.message || '已处理'}`);
        signalForm.resetFields();
        await Promise.all([loadSignals(), loadOrders()]);
      } else {
        messageApi.error(res.message || '信号提交失败');
      }
    } finally {
      setTimeout(() => setActionBusy((prev) => ({ ...prev, submitSignal: false })), 3000);
    }
  }, [actionBusy, loadOrders, loadSignals, messageApi, signalForm]);

  const runningCount = strategies.filter((item) => item.status === 'running').length;
  const totalAsset = positions.reduce((sum, item) => sum + Number(item.market_value || 0), 0);
  const totalProfit = positions.reduce((sum, item) => sum + Number(item.profit || 0), 0);
  const preflight = health.preflight || {};
  const criticalFailures = safeArray(preflight.critical_failures);
  const todayStats = health.today || {};
  const recentRisk = safeArray(health.recent_risk_events);

  const strategyColumns = useMemo(
    () => [
      { title: '策略ID', dataIndex: 'strategy_id', key: 'strategy_id', width: 180 },
      { title: '名称', dataIndex: 'name', key: 'name', width: 180 },
      { title: '状态', dataIndex: 'status', key: 'status', width: 110, render: statusTag },
      {
        title: '心跳',
        key: 'heartbeat',
        width: 180,
        render: (_, row) => fmtTime(row.runtime?.last_heartbeat_time),
      },
      {
        title: 'PID',
        key: 'pid',
        width: 90,
        render: (_, row) => row.runtime?.pid || '-',
      },
      { title: '更新时间', dataIndex: 'updated_at', key: 'updated_at', width: 180, render: fmtTime },
      {
        title: '操作',
        key: 'action',
        width: 180,
        render: (_, row) => (
          <Space>
            {row.status === 'running' ? (
              <Button
                danger
                size="small"
                icon={<StopOutlined />}
                onClick={() => handleStrategyAction(row.strategy_id, 'stop')}
                loading={!!actionBusy[`${row.strategy_id}_stop`]}
              >
                停止
              </Button>
            ) : (
              <Button
                type="primary"
                size="small"
                icon={<PlayCircleOutlined />}
                onClick={() => handleStrategyAction(row.strategy_id, 'start')}
                loading={!!actionBusy[`${row.strategy_id}_start`]}
              >
                启动
              </Button>
            )}
          </Space>
        ),
      },
    ],
    [handleStrategyAction]
  );

  const dashboardContent = (
    <>
      <Row gutter={[12, 12]}>
        <Col xs={24} sm={12} lg={6}>
          <Card><Statistic title="系统状态" value={STATUS_MAP[health.status]?.text || '-'} /></Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card><Statistic title="运行策略" value={runningCount} suffix={`/ ${strategies.length}`} /></Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card><Statistic title="持仓市值" value={fmtMoney(totalAsset)} prefix="¥" /></Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card><Statistic title="浮动盈亏" value={fmtMoney(totalProfit)} prefix="¥" /></Card>
        </Col>
      </Row>
      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col xs={12} sm={6} lg={3}>
          <Card><Statistic title="今日信号" value={todayStats.signal_count ?? '-'} /></Card>
        </Col>
        <Col xs={12} sm={6} lg={3}>
          <Card><Statistic title="今日委托" value={todayStats.order_count ?? '-'} /></Card>
        </Col>
        <Col xs={12} sm={6} lg={3}>
          <Card><Statistic title="今日成交" value={todayStats.fill_count ?? '-'} /></Card>
        </Col>
        <Col xs={12} sm={6} lg={3}>
          <Card><Statistic title="今日风控" value={todayStats.risk_event_count ?? '-'} valueStyle={todayStats.risk_event_count > 0 ? { color: '#ff4d4f' } : {}} /></Card>
        </Col>
      </Row>
      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col xs={24} lg={14}>
          <Card title="策略运行状态">
            <Table
              rowKey="strategy_id"
              size="small"
              pagination={false}
              dataSource={strategies.slice(0, 8)}
              columns={strategyColumns.filter((c) => c.key !== 'action')}
            />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card title="系统健康">
            <Descriptions column={1} size="small">
              <Descriptions.Item label="运行模式">
                <Space>
                  <Tag color={health.mock_mode ? 'warning' : 'success'}>
                    {health.mock_mode ? 'Mock' : 'Non-Mock'}
                  </Tag>
                  <Text>{health.mode || '-'}</Text>
                </Space>
              </Descriptions.Item>
              <Descriptions.Item label="预检结果">
                {preflight.critical_ok ? (
                  <Tag color="success">Critical 全通过</Tag>
                ) : (
                  <Tag color="error">Critical 未通过</Tag>
                )}
              </Descriptions.Item>
              <Descriptions.Item label="失败项">
                {criticalFailures.length ? criticalFailures.join('，') : '无'}
              </Descriptions.Item>
              <Descriptions.Item label="WebSocket">
                <Badge status={wsConnected ? 'success' : 'error'} text={wsConnected ? '已连接' : '未连接'} />
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>
      {recentRisk.length > 0 && (
        <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
          <Col span={24}>
            <Card title="最近风控告警" size="small">
              <Table
                rowKey={(_, i) => `risk-${i}`}
                size="small"
                pagination={false}
                dataSource={recentRisk.slice(0, 5)}
                columns={[
                  { title: '时间', dataIndex: 'created_at', width: 170, render: fmtTime },
                  { title: '规则', dataIndex: 'rule_name', width: 160 },
                  { title: '级别', dataIndex: 'risk_level', width: 100, render: statusTag },
                  { title: '描述', dataIndex: 'description' },
                ]}
              />
            </Card>
          </Col>
        </Row>
      )}
    </>
  );

  const tradingContent = (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Card title="提交交易信号">
        <Form form={signalForm} layout="vertical" className="signal-grid">
          <Form.Item name="signal_id" label="信号ID" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="strategy_id" label="策略ID" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="symbol" label="证券代码" rules={[{ required: true }]}><Input placeholder="000001.SZ" /></Form.Item>
          <Form.Item name="signal_type" label="方向" initialValue="BUY" rules={[{ required: true }]}>
            <Select options={['BUY', 'SELL', 'ADD', 'REDUCE', 'HOLD', 'CANCEL'].map((v) => ({ value: v, label: v }))} />
          </Form.Item>
          <Form.Item name="signal_price" label="信号价格" rules={[{ required: true }]}><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="target_volume" label="目标数量"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="target_value" label="目标金额"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="confidence" label="置信度" initialValue={0.5}><InputNumber min={0} max={1} step={0.01} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="reason" label="原因" className="signal-reason"><Input /></Form.Item>
        </Form>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleSubmitSignal} loading={!!actionBusy.submitSignal}>提交信号</Button>
      </Card>
      <Card title="交易数据">
        <Tabs
          activeKey={tradeTab}
          onChange={setTradeTab}
          items={[
            { key: 'signals', label: '信号', children: <Table rowKey="signal_id" size="small" pagination={{ pageSize: 10 }} dataSource={signals} columns={[
              { title: '信号ID', dataIndex: 'signal_id', width: 180 },
              { title: '策略ID', dataIndex: 'strategy_id', width: 140 },
              { title: '标的', dataIndex: 'symbol', width: 120 },
              { title: '方向', dataIndex: 'signal_type', width: 90 },
              { title: '价格', dataIndex: 'signal_price', width: 100, render: fmtMoney },
              { title: '状态', dataIndex: 'decision_status', width: 100, render: statusTag },
              { title: '时间', dataIndex: 'created_at', width: 170, render: fmtTime },
            ]} /> },
            { key: 'orders', label: '委托', children: <Table rowKey="order_id" size="small" pagination={{ pageSize: 10 }} dataSource={orders} columns={[
              { title: '委托号', dataIndex: 'order_id', width: 180 },
              { title: '标的', dataIndex: 'symbol', width: 120 },
              { title: '方向', dataIndex: 'order_type', width: 90 },
              { title: '价格', dataIndex: 'price', width: 100, render: fmtMoney },
              { title: '委托量', dataIndex: 'volume', width: 100 },
              { title: '状态', dataIndex: 'status', width: 100, render: statusTag },
              { title: '时间', dataIndex: 'created_at', width: 170, render: fmtTime },
            ]} /> },
            { key: 'fills', label: '成交', children: <Table rowKey="fill_id" size="small" pagination={{ pageSize: 10 }} dataSource={fills} columns={[
              { title: '成交号', dataIndex: 'fill_id', width: 180 },
              { title: '标的', dataIndex: 'symbol', width: 120 },
              { title: '方向', dataIndex: 'direction', width: 90 },
              { title: '价格', dataIndex: 'fill_price', width: 100, render: fmtMoney },
              { title: '数量', dataIndex: 'fill_volume', width: 100 },
              { title: '成交时间', dataIndex: 'filled_at', width: 170, render: fmtTime },
            ]} /> },
            { key: 'positions', label: '持仓', children: <Table rowKey={(row) => `${row.account_id}-${row.symbol}`} size="small" pagination={{ pageSize: 10 }} dataSource={positions} columns={[
              { title: '标的', dataIndex: 'symbol', width: 120 },
              { title: '数量', dataIndex: 'volume', width: 100 },
              { title: '可用', dataIndex: 'available_volume', width: 100 },
              { title: '成本价', dataIndex: 'cost_price', width: 100, render: fmtMoney },
              { title: '市值', dataIndex: 'market_value', width: 120, render: fmtMoney },
              { title: '盈亏', dataIndex: 'profit', width: 100, render: fmtMoney },
            ]} /> },
          ]}
        />
      </Card>
    </Space>
  );

  const riskContent = (
    <Space direction="vertical" style={{ width: '100%' }} size={12}>
      <Card title="风控规则">
        <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} bordered size="small">
          <Descriptions.Item label="单笔委托上限">
            {fmtMoney(riskRules.max_single_order_value)} 元
          </Descriptions.Item>
          <Descriptions.Item label="日委托次数上限">
            {riskRules.max_daily_order_count ?? '-'} 次
          </Descriptions.Item>
          <Descriptions.Item label="日亏损比例上限">
            {riskRules.max_daily_loss_pct != null ? `${riskRules.max_daily_loss_pct}%` : '-'}
          </Descriptions.Item>
        </Descriptions>
      </Card>
      <Card title="风控事件">
        <Table
          rowKey="id"
          size="small"
          pagination={{ pageSize: 10 }}
          dataSource={riskEvents}
          columns={[
            { title: '时间', dataIndex: 'created_at', width: 170, render: fmtTime },
            { title: '策略ID', dataIndex: 'strategy_id', width: 140 },
            { title: '规则', dataIndex: 'rule_name', width: 160 },
            { title: '级别', dataIndex: 'risk_level', width: 100, render: statusTag },
            { title: '描述', dataIndex: 'description' },
          ]}
        />
      </Card>
    </Space>
  );

  const logsContent = (
    <Card title="数据与日志">
      <Tabs
        activeKey={logTab}
        onChange={setLogTab}
        items={[
          {
            key: 'systemLogs',
            label: '系统日志',
            children: (
              <Table
                rowKey="id"
                size="small"
                pagination={{ pageSize: 10 }}
                dataSource={systemLogs}
                columns={[
                  { title: '时间', dataIndex: 'created_at', width: 170, render: fmtTime },
                  { title: '模块', dataIndex: 'module', width: 140 },
                  { title: '级别', dataIndex: 'level', width: 100, render: (v) => statusTag(v === 'ERROR' ? 'error' : v === 'WARNING' ? 'degraded' : 'normal') },
                  { title: '内容', dataIndex: 'message' },
                ]}
              />
            ),
          },
          {
            key: 'wsEvents',
            label: '实时事件',
            children: (
              <Table
                rowKey="key"
                size="small"
                pagination={{ pageSize: 10 }}
                dataSource={wsEvents}
                columns={[
                  { title: '时间', dataIndex: 'timestamp', width: 170, render: fmtTime },
                  { title: '类型', dataIndex: 'type', width: 160 },
                  { title: '详情', dataIndex: 'detail' },
                ]}
              />
            ),
          },
        ]}
      />
    </Card>
  );

  const pageContent = pathname === '/dashboard'
    ? dashboardContent
    : pathname === '/strategies'
      ? (
        <Card
          title="策略管理"
          extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setStrategyDrawerOpen(true)}>注册策略</Button>}
        >
          <Table rowKey="strategy_id" size="small" pagination={{ pageSize: 10 }} dataSource={strategies} columns={strategyColumns} />
        </Card>
      )
      : pathname === '/trading'
        ? tradingContent
        : pathname === '/risk'
          ? riskContent
          : logsContent;

  const pageTitle = MENU_ITEMS.find((item) => item.path === pathname)?.name || '控制台';

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{ token: { colorPrimary: '#1677ff', borderRadius: 6 } }}
    >
      {contextHolder}
      <ProLayout
        title="QMT 交易后台"
        layout="mix"
        contentWidth="Fluid"
        fixedHeader
        fixSiderbar
        navTheme="light"
        location={{ pathname }}
        route={{ routes: MENU_ITEMS }}
        menuItemRender={(item, dom) => (
          <span onClick={() => setPathname(item.path)}>{dom}</span>
        )}
      >
        <PageContainer
          title={pageTitle}
          extra={[
            <Badge key="ws" status={wsConnected ? 'success' : 'error'} text={wsConnected ? 'WS 已连接' : 'WS 未连接'} />,
            <Button key="refresh" icon={<ReloadOutlined />} loading={loading} onClick={refreshCurrentPage}>
              刷新
            </Button>,
          ]}
        >
          {!preflight.critical_ok && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="Preflight Critical 未全部通过，部分启动行为会被阻断。"
              description={criticalFailures.length ? `失败项：${criticalFailures.join('，')}` : '请检查 system-preflight 结果。'}
            />
          )}
          {pageContent}
        </PageContainer>
      </ProLayout>

      <Drawer
        title="注册策略"
        width={520}
        open={strategyDrawerOpen}
        onClose={() => setStrategyDrawerOpen(false)}
        footer={(
          <Space>
            <Button onClick={() => setStrategyDrawerOpen(false)}>取消</Button>
            <Button type="primary" onClick={handleRegisterStrategy}>提交</Button>
          </Space>
        )}
      >
        <Form layout="vertical" form={strategyForm}>
          <Form.Item label="策略ID" name="strategy_id" rules={[{ required: true, message: '请输入策略ID' }]}><Input /></Form.Item>
          <Form.Item label="策略名称" name="name" rules={[{ required: true, message: '请输入策略名称' }]}><Input /></Form.Item>
          <Form.Item label="描述" name="description"><Input /></Form.Item>
          <Form.Item label="启动脚本" name="start_script"><Input placeholder='例如: "python.exe" scripts/start.py' /></Form.Item>
          <Form.Item label="停止脚本" name="stop_script"><Input placeholder='例如: "python.exe" scripts/stop.py' /></Form.Item>
          <Form.Item label="工作目录" name="working_dir"><Input placeholder="例如: C:/qmt/strategies/demo" /></Form.Item>
          <Form.Item label="环境变量覆盖(JSON)" name="env_overrides">
            <Input.TextArea rows={5} placeholder='{"STRATEGY_CUSTOM_VAR":"v1"}' />
          </Form.Item>
        </Form>
      </Drawer>
    </ConfigProvider>
  );
}
