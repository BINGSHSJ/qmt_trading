import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ApiOutlined,
  ArrowRightOutlined,
  CheckCircleOutlined,
  CloudSyncOutlined,
  CopyOutlined,
  DatabaseOutlined,
  DisconnectOutlined,
  DownloadOutlined,
  FileSearchOutlined,
  HddOutlined,
  LineChartOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { Alert, App, Button, Col, Progress, Row, Segmented, Space, Tabs, Tag, Tooltip, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import CommandPanel from '../../components/CommandPanel';
import DataTable from '../../components/DataTable';
import DataFreshnessTag from '../../components/DataFreshnessTag';
import ErrorDetailModal from '../../components/ErrorDetailModal';
import FinancialNumber from '../../components/FinancialNumber';
import KLineChart from '../../components/KLineChart';
import LogDrawer from '../../components/LogDrawer';
import MetricCard from '../../components/MetricCard';
import PageHeader from '../../components/PageHeader';
import RiskConfirmContent from '../../components/RiskConfirmContent';
import SectionCard from '../../components/SectionCard';
import TableActionGroup from '../../components/TableActionGroup';
import TaskActionGroup from '../../components/TaskActionGroup';
import TaskProgress from '../../components/TaskProgress';
import WorkbenchNav, { type WorkbenchNavItem } from '../../components/WorkbenchNav';
import { useTaskPolling } from '../../hooks/useTaskPolling';
import { useUrlSyncedTab } from '../../hooks/useUrlSyncedTab';
import {
  cleanupLegacySyncCursors,
  connectQmt,
  createQualityCheck,
  createSync,
  disconnectQmt,
  exportCoverage2026Missing,
  getAccountSnapshotDuplicates,
  getDataFreshnessSummary,
  getDailyKline,
  getDictionary,
  getCoverage2026,
  getInstrumentDetails,
  getLatestAccount,
  getMinuteKline,
  getOfficialCatalog,
  getOrders,
  getPositions,
  getQmtStatus,
  getQualityResults,
  getQualitySummary,
  getSyncLogs,
  getStocks,
  getSyncTasks,
  getTrades,
  getTradingCalendar,
  prepare2026Sync,
  runLatestDataSync,
  run2026Sync,
  testQmt,
  type AccountDataScope,
} from '../../services/dataCenter';
import { RequestError } from '../../services/request';
import { getTask } from '../../services/system';
import { defaultPageState, type PageState } from '../../types/api';
import { formatQmtModeLabel, isRealQmtMode, isTestIsolationMode, normalizeSyncSource } from '../../utils/sourceLabels';
import type {
  AccountSnapshot,
  AccountSnapshotDuplicateRecord,
  DailyKline,
  DataCoverageRecord,
  DataDictionaryRecord,
  DataFreshnessItem,
  DataFreshnessSummary,
  DataQualityRecord,
  DataQualitySummary,
  InstrumentDetail,
  MinuteKline,
  OrderRecord,
  OfficialDataCatalog,
  OfficialDataCatalogItem,
  Prepare2026Plan,
  PositionSnapshot,
  QmtStatus,
  StockBasic,
  SyncTaskSummary,
  TradeRecord,
  TradingCalendarRecord,
} from '../../types/dataCenter';
import type { RuntimeTaskRecord } from '../../types/system';
import { writeTextToClipboard } from '../../utils/clipboard';
import { formatMoney, formatMoneyByUnit, formatPrice, formatQuantity, formatSide, getPnLTextType, getSideColor } from '../../utils/format';
import { TABLE_COL, TABLE_SCROLL_X } from '../../utils/tableColumns';
import { formatNow } from '../../utils/time';
import {
  DATA_DETAIL_DRAWER_WIDTH,
  DATA_DETAIL_FIELD_COLUMNS,
  type DataCenterTabKey,
  type DictionaryTableGroup,
  type ErrorState,
  type LogDrawerState,
  type MarketPeriod,
  accountSourceMeta,
  buildDictionaryTableText,
  buildTaskDetailItems,
  coverageStatusText,
  coverageUnit,
  coverageUnitHint,
  dataCenterDrawerClassName,
  dataCenterTabKeys,
  extractActiveTaskMeta,
  freshnessCoverageUnit,
  freshnessCoverageUnitHint,
  freshnessStatusText,
  hasSyncFailure,
  isSyncRunning,
  parseTaskDetail,
  priorityColor,
  qualityDefinitions,
  renderTableCount,
  renderTaskDownloadDetail,
  renderTraceText,
  sourceTag,
  statusTag,
  syncSourceMeta,
  syncTaskToRuntimeTask,
  wrapLongText,
} from './dataCenterHelpers';
import './DataCenter.css';

export default function DataCenter() {
  const { message, modal } = App.useApp();
  const [qmtStatus, setQmtStatus] = useState<QmtStatus | null>(null);
  const [account, setAccount] = useState<AccountSnapshot | null>(null);
  const [positions, setPositions] = useState<PositionSnapshot[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [stocks, setStocks] = useState<StockBasic[]>([]);
  const [instrumentDetails, setInstrumentDetails] = useState<InstrumentDetail[]>([]);
  const [tradingCalendar, setTradingCalendar] = useState<TradingCalendarRecord[]>([]);
  const [dailyKline, setDailyKline] = useState<DailyKline[]>([]);
  const [minuteKline, setMinuteKline] = useState<MinuteKline[]>([]);
  const [syncTasks, setSyncTasks] = useState<SyncTaskSummary[]>([]);
  const [quality, setQuality] = useState<DataQualityRecord[]>([]);
  const [qualitySummary, setQualitySummary] = useState<DataQualitySummary | null>(null);
  const [freshnessSummary, setFreshnessSummary] = useState<DataFreshnessSummary | null>(null);
  const [accountDuplicates, setAccountDuplicates] = useState<AccountSnapshotDuplicateRecord[]>([]);
  const [dictionary, setDictionary] = useState<DataDictionaryRecord[]>([]);
  const [dictionaryCatalog, setDictionaryCatalog] = useState<DataDictionaryRecord[]>([]);
  const [selectedDictionaryTable, setSelectedDictionaryTable] = useState<string | null>(null);
  const [officialCatalog, setOfficialCatalog] = useState<OfficialDataCatalog | null>(null);
  const [coverage2026, setCoverage2026] = useState<DataCoverageRecord[]>([]);
  const [preparePlan2026, setPreparePlan2026] = useState<Prepare2026Plan | null>(null);
  const [positionPage, setPositionPage] = useState<PageState>(defaultPageState);
  const [orderPage, setOrderPage] = useState<PageState>(defaultPageState);
  const [tradePage, setTradePage] = useState<PageState>(defaultPageState);
  const [stockPage, setStockPage] = useState<PageState>(defaultPageState);
  const [instrumentPage, setInstrumentPage] = useState<PageState>({ ...defaultPageState, pageSize: 50 });
  const [calendarPage, setCalendarPage] = useState<PageState>({ ...defaultPageState, pageSize: 50 });
  const [dailyPage, setDailyPage] = useState<PageState>({ ...defaultPageState, pageSize: 50 });
  const [coveragePage, setCoveragePage] = useState<PageState>({ ...defaultPageState, pageSize: 50 });
  const [syncPage, setSyncPage] = useState<PageState>(defaultPageState);
  const [qualityPage, setQualityPage] = useState<PageState>({ ...defaultPageState, pageSize: 50 });
  const [accountDuplicatePage, setAccountDuplicatePage] = useState<PageState>({ ...defaultPageState, pageSize: 20 });
  const [dictionaryPage, setDictionaryPage] = useState<PageState>({ ...defaultPageState, pageSize: 50 });
  const [activeTask, setActiveTask] = useState<RuntimeTaskRecord | null>(null);
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useUrlSyncedTab<DataCenterTabKey>(dataCenterTabKeys, '数据概览');
  const [accountScope, setAccountScope] = useState<AccountDataScope>('current');
  const [marketPeriod, setMarketPeriod] = useState<MarketPeriod>('daily');
  const [loading, setLoading] = useState(false);
  const [sourceBusyAction, setSourceBusyAction] = useState<'connect' | 'disconnect' | 'test' | null>(null);
  const [updatedAt, setUpdatedAt] = useState(formatNow());
  const [errorState, setErrorState] = useState<ErrorState | null>(null);
  const [logDrawer, setLogDrawer] = useState<LogDrawerState | null>(null);
  const dictionaryAutoLoadRef = useRef(false);
  const currentTaskRef = useRef<HTMLDivElement | null>(null);
  const focusClearTimerRef = useRef<number | null>(null);
  const focusScrollTimerRef = useRef<number | null>(null);

  const showError = useCallback((fallback: string, error: unknown) => {
    if (error instanceof RequestError) {
      setErrorState({ message: error.message, error: error.apiError, traceId: error.traceId });
    } else {
      setErrorState({ message: fallback, error: { code: 'UNKNOWN', detail: String(error) } });
    }
  }, []);

  const fetchDictionaryData = useCallback(async () => {
    const [dict, catalog] = await Promise.all([
      getDictionary(undefined, dictionaryPage),
      getDictionary(undefined, { page: 1, pageSize: 200, sortField: 'table_name', sortOrder: 'asc' }),
    ]);
    setDictionary(dict.items);
    setDictionaryCatalog(catalog.items);
    setDictionaryPage((previous) => (
      previous.total === dict.total
        && previous.page === dict.page
        && previous.pageSize === dict.page_size
        ? previous
        : { ...previous, page: dict.page, pageSize: dict.page_size, total: dict.total }
    ));
    return dict;
  }, [dictionaryPage]);

  const refreshDictionaryData = useCallback(async (silent = false) => {
    setLoading(true);
    try {
      const dict = await fetchDictionaryData();
      setUpdatedAt(formatNow());
      if (!silent) {
        message.success(`数据字典已刷新，共 ${dict.total} 个字段说明`);
      }
    } catch (error) {
      showError('刷新数据字典失败', error);
    } finally {
      setLoading(false);
    }
  }, [fetchDictionaryData, message, showError]);

  const loadActiveData = useCallback(async (tabKey: DataCenterTabKey = activeTab) => {
    setLoading(true);
    try {
      try {
        const statusResult = await getQmtStatus();
        setQmtStatus(statusResult);
      } catch (statusError) {
        showError('获取 QMT 状态失败', statusError);
      }

      const [latestAccountResult, qualitySummaryResult, latestTasksResult, freshnessResult] = await Promise.all([
        getLatestAccount(),
        getQualitySummary(),
        getSyncTasks({ page: 1, pageSize: 5, sortField: 'started_at', sortOrder: 'desc' }),
        getDataFreshnessSummary(),
      ]);
      setAccount(latestAccountResult);
      setQualitySummary(qualitySummaryResult);
      setSyncTasks(latestTasksResult.items);
      setFreshnessSummary(freshnessResult);
      setSyncPage((previous) => (previous.total === latestTasksResult.total ? previous : { ...previous, total: latestTasksResult.total }));
      const latestRunningSyncTask = latestTasksResult.items.find(isSyncRunning);
      if (latestRunningSyncTask) {
        try {
          const runtimeTask = await getTask(latestRunningSyncTask.task_id);
          setActiveTask((previous) => (
            previous?.task_id === runtimeTask.task_id
              && previous.status === runtimeTask.status
              && previous.progress === runtimeTask.progress
              && previous.message === runtimeTask.message
              ? previous
              : runtimeTask
          ));
        } catch {
          setActiveTask((previous) => previous?.task_id === latestRunningSyncTask.task_id ? previous : syncTaskToRuntimeTask(latestRunningSyncTask));
        }
      }
      if (tabKey === '数据概览') {
        const [catalogResult, coverageResult] = await Promise.all([
          getOfficialCatalog(),
          getCoverage2026(coveragePage),
        ]);
        setOfficialCatalog(catalogResult);
        setCoverage2026(coverageResult.items);
        setCoveragePage((previous) => (previous.total === coverageResult.total ? previous : { ...previous, total: coverageResult.total }));
      }
      if (tabKey === '数据来源') {
        const catalogResult = await getOfficialCatalog();
        setOfficialCatalog(catalogResult);
      }
      if (tabKey === '账户数据') {
        const [positionsResult, ordersResult, tradesResult] = await Promise.all([
          getPositions(positionPage, accountScope),
          getOrders(orderPage, accountScope),
          getTrades(tradePage, accountScope),
        ]);
        setAccount(latestAccountResult);
        setPositions(positionsResult.items);
        setOrders(ordersResult.items);
        setTrades(tradesResult.items);
        setPositionPage((previous) => (previous.total === positionsResult.total ? previous : { ...previous, total: positionsResult.total }));
        setOrderPage((previous) => (previous.total === ordersResult.total ? previous : { ...previous, total: ordersResult.total }));
        setTradePage((previous) => (previous.total === tradesResult.total ? previous : { ...previous, total: tradesResult.total }));
      }
      if (tabKey === '行情数据') {
        const [stocksResult, dailyResult, minuteResult] = await Promise.all([
          getStocks(stockPage),
          getDailyKline('600000.SH', dailyPage),
          getMinuteKline(),
        ]);
        setStocks(stocksResult.items);
        setDailyKline(dailyResult.items);
        setMinuteKline(minuteResult.items);
        setStockPage((previous) => (previous.total === stocksResult.total ? previous : { ...previous, total: stocksResult.total }));
        setDailyPage((previous) => (previous.total === dailyResult.total ? previous : { ...previous, total: dailyResult.total }));
      }
      if (tabKey === '基础资料') {
        const [stocksResult, instrumentsResult, calendarResult] = await Promise.all([
          getStocks(stockPage),
          getInstrumentDetails(instrumentPage),
          getTradingCalendar(calendarPage),
        ]);
        setStocks(stocksResult.items);
        setInstrumentDetails(instrumentsResult.items);
        setTradingCalendar(calendarResult.items);
        setStockPage((previous) => (previous.total === stocksResult.total ? previous : { ...previous, total: stocksResult.total }));
        setInstrumentPage((previous) => (previous.total === instrumentsResult.total ? previous : { ...previous, total: instrumentsResult.total }));
        setCalendarPage((previous) => (previous.total === calendarResult.total ? previous : { ...previous, total: calendarResult.total }));
      }
      if (tabKey === '数据同步') {
        const tasks = await getSyncTasks(syncPage);
        setSyncTasks(tasks.items);
        setSyncPage((previous) => (previous.total === tasks.total ? previous : { ...previous, total: tasks.total }));
      }
      if (tabKey === '数据质量') {
        const [qualityResult, duplicateResult] = await Promise.all([
          getQualityResults(qualityPage),
          getAccountSnapshotDuplicates(accountDuplicatePage),
        ]);
        setQuality(qualityResult.items);
        setQualitySummary(qualitySummaryResult);
        setAccountDuplicates(duplicateResult.items);
        setQualityPage((previous) => (previous.total === qualityResult.total ? previous : { ...previous, total: qualityResult.total }));
        setAccountDuplicatePage((previous) => (previous.total === duplicateResult.total ? previous : { ...previous, total: duplicateResult.total }));
      }
      if (tabKey === '数据字典') {
        await fetchDictionaryData();
      }
      setUpdatedAt(formatNow());
    } catch (error) {
      showError('加载数据中心失败', error);
    } finally {
      setLoading(false);
    }
  }, [accountDuplicatePage, accountScope, activeTab, calendarPage, coveragePage, dailyPage, fetchDictionaryData, instrumentPage, orderPage, positionPage, qualityPage, showError, stockPage, syncPage, tradePage]);

  useEffect(() => {
    void loadActiveData();
  }, [loadActiveData]);

  useEffect(() => {
    if (activeTab !== '数据字典') return;
    if (dictionaryAutoLoadRef.current || loading || dictionary.length > 0 || dictionaryPage.total > 0) return;
    dictionaryAutoLoadRef.current = true;
    void refreshDictionaryData(true);
  }, [activeTab, dictionary.length, dictionaryPage.total, loading, refreshDictionaryData]);

  useTaskPolling({
    task: activeTask,
    onTaskChange: setActiveTask,
    onFinished: () => loadActiveData(),
    onError: (error) => showError('刷新任务失败', error),
  });

  useEffect(() => () => {
    if (focusClearTimerRef.current !== null) {
      window.clearTimeout(focusClearTimerRef.current);
    }
    if (focusScrollTimerRef.current !== null) {
      window.clearTimeout(focusScrollTimerRef.current);
    }
  }, []);

  const syncBusy = loading || activeTask?.status === 'running' || activeTask?.status === 'pending' || activeTask?.status === '运行中';
  const initialTableLoading = (rowCount: number) => loading && rowCount === 0;

  const focusCurrentTask = useCallback((taskId?: string) => {
    if (focusClearTimerRef.current !== null) {
      window.clearTimeout(focusClearTimerRef.current);
      focusClearTimerRef.current = null;
    }
    if (focusScrollTimerRef.current !== null) {
      window.clearTimeout(focusScrollTimerRef.current);
      focusScrollTimerRef.current = null;
    }
    setActiveTab('数据同步');
    if (taskId) {
      setFocusedTaskId(taskId);
      focusClearTimerRef.current = window.setTimeout(() => {
        setFocusedTaskId((current) => (current === taskId ? null : current));
        focusClearTimerRef.current = null;
      }, 3600);
    }
    focusScrollTimerRef.current = window.setTimeout(() => {
      currentTaskRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      focusScrollTimerRef.current = null;
    }, 80);
  }, [setActiveTab]);

  const handleTaskAlreadyRunning = useCallback(async (error: unknown) => {
    if (!(error instanceof RequestError) || error.apiError?.code !== 'TASK_ALREADY_RUNNING') {
      return false;
    }
    const meta = extractActiveTaskMeta(error);
    if (!meta.taskId) {
      showError('已有同类型任务正在执行', error);
      return true;
    }
    try {
      const runningTask = await getTask(meta.taskId);
      setActiveTask(runningTask);
    } catch {
      setActiveTask({
        task_id: meta.taskId,
        task_type: meta.taskType || 'sync_task',
        status: meta.status || 'running',
        progress: 0,
        message: '同类型任务正在执行，请查看当前任务进度。',
        created_at: formatNow(),
      });
    }
    focusCurrentTask(meta.taskId);
    message.warning('已有同类型任务正在执行，已定位到当前任务进度。');
    return true;
  }, [focusCurrentTask, message, showError]);

  const runTask = async (label: string, action: () => Promise<{ task_id: string; task_type: string; status: string; progress: number; message: string }>) => {
    if (syncBusy) {
      focusCurrentTask(activeTask?.task_id);
      message.warning('已有同步任务正在运行，已定位到当前任务进度。');
      return;
    }
    setLoading(true);
    try {
      const task = await action();
      setActiveTask({ ...task, created_at: formatNow() });
      message.success(`${label}任务已创建`);
    } catch (error) {
      const handled = await handleTaskAlreadyRunning(error);
      if (!handled) {
        showError(`${label}失败`, error);
      }
    } finally {
      setLoading(false);
    }
  };

  const sourceActions = async (action: 'connect' | 'disconnect' | 'test') => {
    if (sourceBusyAction) return;
    setSourceBusyAction(action);
    try {
      const next = action === 'connect' ? await connectQmt() : action === 'disconnect' ? await disconnectQmt() : await testQmt();
      setQmtStatus(next);
      message.success(next.message);
    } catch (error) {
      showError('数据源操作失败', error);
    } finally {
      setSourceBusyAction(null);
    }
  };

  const buildDefault2026Request = () => ({
    start_date: '2026-01-01',
    include_daily_kline: true,
    daily_batch_size: 200,
    include_minute_kline: false,
    minute_batch_size: 50,
    minute_window_days: 5,
    include_full_market_minute: false,
    include_financial: false,
  });

  const buildFullMarketMinute2026Request = () => ({
    start_date: '2026-01-01',
    include_daily_kline: false,
    daily_batch_size: 200,
    include_minute_kline: true,
    minute_batch_size: 50,
    minute_window_days: 5,
    include_full_market_minute: true,
    include_financial: false,
    period: '1m',
  });

  const buildLatestDataSyncRequest = () => ({
    start_date: '2026-01-01',
    include_account: true,
    include_positions: true,
    include_orders: true,
    include_trades: true,
    include_daily_kline: true,
    daily_batch_size: 200,
    include_minute_kline: false,
    include_full_market_minute: false,
  });

  const confirmRunLatestDataSync = () => {
    modal.confirm({
      className: 'data-center-confirm-modal',
      width: 720,
      centered: true,
      maskClosable: false,
      title: '同步到最新完成交易日',
      content: (
        <RiskConfirmContent
          level="warning"
          summary="即将同步到最新完成交易日。"
          objectLabel="交易日历、账户、委托成交、全市场日 K"
          riskItems={[
            '本任务只做真实 QMT 只读查询和本地 SQLite 落库，不提交真实委托。',
            '默认不会启动全市场分钟 K；分钟 K 必须走显式长任务。',
            '任务完成后请回到本地数据新鲜度和覆盖率检查确认是否仍有缺口。',
          ]}
          details={[
            { label: '账户模式', value: qmtModeText },
            { label: '账户', value: qmtStatus?.account_id || '未识别' },
            { label: '分钟K', value: '不默认同步' },
          ]}
          nextStep="开始后请在数据同步页查看 task_id、批次、写入行数、失败股票和技术详情。"
        />
      ),
      okText: '开始同步',
      cancelText: '取消',
      onOk: () => runTask('同步到最新完成交易日', () => runLatestDataSync(buildLatestDataSyncRequest())),
    });
  };

  const generate2026Plan = async () => {
    setLoading(true);
    try {
      const plan = await prepare2026Sync(buildDefault2026Request());
      setPreparePlan2026(plan);
      message.success('2026 数据补齐计划已生成');
    } catch (error) {
      showError('生成 2026 数据补齐计划失败', error);
    } finally {
      setLoading(false);
    }
  };

  const confirmRun2026Sync = () => {
    modal.confirm({
      className: 'data-center-confirm-modal',
      width: 720,
      centered: true,
      maskClosable: false,
      title: '启动 2026 数据补齐',
      content: (
        <RiskConfirmContent
          level="warning"
          summary="即将启动 2026 全市场日 K 数据补齐。"
          objectLabel="2026 股票基础资料与日 K"
          riskItems={[
            '本任务只读取真实 QMT 数据并写入本地 SQLite，不触发真实交易。',
            '内部自动按批次跑完整市场，不需要手动重复点击。',
            '中断后按覆盖率优先和 sync_cursor 续跑，避免从头重复落库。',
          ]}
          details={[
            { label: '数据范围', value: '2026 年至最新完成交易日' },
            { label: '批次', value: '日 K 每批最多 200 只' },
            { label: '续跑规则', value: 'coverage_first + sync_cursor' },
          ]}
          nextStep="启动后请在当前任务进度和同步任务列表核对批次、完整目标范围、写入行数和失败股票。"
        />
      ),
      okText: '启动补齐',
      cancelText: '取消',
      onOk: () => runTask('2026 数据补齐', () => run2026Sync(buildDefault2026Request())),
    });
  };

  const generateFullMarketMinute2026Plan = async () => {
    setLoading(true);
    try {
      const plan = await prepare2026Sync(buildFullMarketMinute2026Request());
      setPreparePlan2026(plan);
      message.success('2026 全市场分钟 K 计划已生成');
    } catch (error) {
      showError('生成 2026 全市场分钟 K 计划失败', error);
    } finally {
      setLoading(false);
    }
  };

  const confirmRunFullMarketMinute2026Sync = () => {
    modal.confirm({
      className: 'data-center-confirm-modal',
      width: 720,
      centered: true,
      maskClosable: false,
      title: '启动 2026 全市场分钟 K 补齐',
      content: (
        <RiskConfirmContent
          level="error"
          summary="即将启动 2026 全市场 1 分钟 K 补齐，这是耗时长任务。"
          objectLabel="2026 全市场 1 分钟 K"
          riskItems={[
            '本任务只读取真实 QMT 行情并落 SQLite，不提交真实下单。',
            '全市场分钟 K 数据量大，请保持 QMT 登录、电脑不断电、服务不中断。',
            '内部按股票批次和交易日窗口自动推进，不再截断首批股票。',
            '中断后按分钟覆盖率和 sync_cursor 续跑，不需要从头手动点 100 次。',
          ]}
          details={[
            { label: '数据范围', value: '2026 年至最新完成交易日' },
            { label: '周期', value: '1m' },
            { label: '窗口', value: '按交易日窗口自动推进' },
            { label: '续跑规则', value: 'minute_coverage_first + sync_cursor' },
          ]}
          nextStep="启动后重点查看当前任务进度中的完整目标范围、当前时间窗口、批次、写入行数、失败股票和无数据股票。"
        />
      ),
      okText: '启动全市场分钟K',
      cancelText: '取消',
      onOk: () => runTask('2026 全市场分钟K补齐', () => run2026Sync(buildFullMarketMinute2026Request())),
    });
  };

  const copyText = async (label: string, text: string) => {
    try {
      await writeTextToClipboard(text);
      message.success(`${label}已复制`);
    } catch {
      message.error(`${label}复制失败，请手动选择文本复制`);
    }
  };

  const currentMarketRows = marketPeriod === 'daily' ? dailyKline : minuteKline;
  const currentMarketUpdatedAt = currentMarketRows[0]
    ? 'trade_date' in currentMarketRows[0]
      ? currentMarketRows[0].trade_date
      : currentMarketRows[0].datetime
    : null;
  const currentMarketSummary = useMemo(() => {
    if (currentMarketRows.length === 0) {
      return {
        firstTime: '--',
        lastTime: '--',
        firstClose: '--',
        lastClose: '--',
        totalAmount: '--',
        totalVolume: '--',
      };
    }
    const sortedRows = [...currentMarketRows].sort((left, right) => {
      const leftTime = 'trade_date' in left ? left.trade_date : left.datetime;
      const rightTime = 'trade_date' in right ? right.trade_date : right.datetime;
      return leftTime.localeCompare(rightTime);
    });
    const first = sortedRows[0];
    const last = sortedRows[sortedRows.length - 1];
    const totalAmount = sortedRows.reduce((sum, row) => sum + (row.amount || 0), 0);
    const totalVolume = sortedRows.reduce((sum, row) => sum + (row.volume || 0), 0);
    return {
      firstTime: 'trade_date' in first ? first.trade_date : first.datetime,
      lastTime: 'trade_date' in last ? last.trade_date : last.datetime,
      firstClose: formatPrice(first.close),
      lastClose: formatPrice(last.close),
      totalAmount: formatMoney(totalAmount),
      totalVolume: formatQuantity(totalVolume, '股'),
    };
  }, [currentMarketRows]);

  const dictionaryTableGroups = useMemo<DictionaryTableGroup[]>(() => {
    const groups = new Map<string, DataDictionaryRecord[]>();
    const groupSource = dictionaryCatalog.length > 0 ? dictionaryCatalog : dictionary;
    groupSource.forEach((record) => {
      const group = groups.get(record.table_name) ?? [];
      group.push(record);
      groups.set(record.table_name, group);
    });
    return Array.from(groups.entries())
      .map(([tableName, fields]) => ({ tableName, fields }))
      .sort((left, right) => left.tableName.localeCompare(right.tableName));
  }, [dictionary, dictionaryCatalog]);

  const selectedDictionaryGroup = useMemo(
    () => dictionaryTableGroups.find((group) => group.tableName === selectedDictionaryTable) ?? dictionaryTableGroups[0] ?? null,
    [dictionaryTableGroups, selectedDictionaryTable],
  );

  useEffect(() => {
    if (activeTab !== '数据字典' || dictionaryTableGroups.length === 0) {
      return;
    }
    const selectedExists = dictionaryTableGroups.some((group) => group.tableName === selectedDictionaryTable);
    if (!selectedDictionaryTable || !selectedExists) {
      setSelectedDictionaryTable(dictionaryTableGroups[0].tableName);
    }
  }, [activeTab, dictionaryTableGroups, selectedDictionaryTable]);

  const qualityMatrix = useMemo(
    () =>
      qualityDefinitions.map((definition) => {
        const records = quality.filter((record) => {
          const source = `${record.check_type} ${record.target_table} ${record.message} ${record.suggestion ?? ''}`.toLowerCase();
          return definition.key === 'sync'
            ? record.status === 'failed' || definition.keywords.some((keyword) => source.includes(keyword.toLowerCase()))
            : definition.keywords.some((keyword) => source.includes(keyword.toLowerCase()));
        });
        const status = records.some((record) => record.status === 'failed')
          ? 'failed'
          : records.some((record) => record.status === 'warning')
            ? 'warning'
            : records.length > 0
              ? 'success'
              : 'pending';
        return {
          ...definition,
          status,
          count: records.length,
          focusRecord: records.find((record) => record.status === 'failed') ?? records.find((record) => record.status === 'warning') ?? records[0],
        };
      }),
    [quality],
  );

  const legacyCursorRecord = useMemo(
    () => quality.find((record) => record.check_type === '同步游标格式' && record.target_table === 'sync_cursor'),
    [quality],
  );
  const hasLegacyCursorWarning = legacyCursorRecord?.status === 'warning' || legacyCursorRecord?.status === 'failed';

  const confirmCleanupLegacyCursors = () => {
    modal.confirm({
      className: 'data-center-confirm-modal',
      width: 720,
      centered: true,
      maskClosable: false,
      title: '清理旧同步游标',
      content: (
        <RiskConfirmContent
          level="warning"
          summary="即将归档并清理旧格式同步游标。"
          objectLabel="sync_cursor 旧格式游标"
          riskItems={[
            '只清理 sync_cursor.symbol 中带逗号拼接的旧格式游标。',
            '不会删除账户、行情、委托、成交或策略数据。',
            '清理前会把旧游标完整归档到操作日志。',
          ]}
          details={[
            { label: '目标表', value: 'sync_cursor' },
            { label: '清理范围', value: '旧格式拼接游标' },
            { label: '当前检查', value: legacyCursorRecord?.message ?? '暂无质量检查记录' },
          ]}
          nextStep="清理后系统会自动创建一次数据质量检查任务，请回到数据质量页确认游标格式已恢复正常。"
        />
      ),
      okText: '归档并清理',
      cancelText: '取消',
      onOk: async () => {
        setLoading(true);
        try {
          const result = await cleanupLegacySyncCursors();
          const task = await createQualityCheck();
          setActiveTask({ ...task, created_at: formatNow() });
          message.success(`${result.message} 已自动创建质量检查任务`);
        } catch (error) {
          showError('清理旧同步游标失败', error);
        } finally {
          setLoading(false);
        }
      },
    });
  };

  const handleExportCoverageMissing = async (dataType?: string) => {
    setLoading(true);
    try {
      const filename = await exportCoverage2026Missing(dataType);
      message.success(`缺失清单已导出：${filename}`);
    } catch (error) {
      showError('导出 2026 缺失清单失败', error);
    } finally {
      setLoading(false);
    }
  };

  const findLatestSyncTask = (types: string[]) => syncTasks.find((task) => types.includes(task.sync_type));

  const syncCards = [
    {
      key: 'sync_latest_data',
      title: '同步到最新',
      description: '交易日历、账户、持仓、委托、成交和全市场日 K',
      types: ['sync_latest_data'],
      icon: <ThunderboltOutlined />,
      primary: true,
      actionLabel: '同步到最新',
      action: confirmRunLatestDataSync,
    },
    {
      key: 'account',
      title: '账户资金',
      description: '同步账户资金快照',
      types: ['account'],
      icon: <WalletOutlined />,
      action: () => runTask('同步账户', () => createSync('account')),
    },
    {
      key: 'positions',
      title: '持仓快照',
      description: '同步当前持仓和可卖数量',
      types: ['positions', 'position'],
      icon: <DatabaseOutlined />,
      action: () => runTask('同步持仓', () => createSync('positions')),
    },
    {
      key: 'orders',
      title: '委托记录',
      description: '同步委托状态和撤单结果',
      types: ['orders', 'order'],
      icon: <FileSearchOutlined />,
      action: () => runTask('同步委托', () => createSync('orders')),
    },
    {
      key: 'trades',
      title: '成交记录',
      description: '同步成交明细和手续费',
      types: ['trades', 'trade'],
      icon: <CheckCircleOutlined />,
      action: () => runTask('同步成交', () => createSync('trades')),
    },
    {
      key: 'stock_basic',
      title: '股票基础',
      description: '同步股票代码、名称和上市状态',
      types: ['stock_basic'],
      icon: <DatabaseOutlined />,
      action: () => runTask('同步股票', () => createSync('stock_basic')),
    },
    {
      key: 'instrument_detail',
      title: '合约基础',
      description: '同步前收、涨跌停和交易状态',
      types: ['instrument_detail'],
      icon: <FileSearchOutlined />,
      action: () => runTask('同步合约基础', () => createSync('instrument_detail')),
    },
    {
      key: 'trading_calendar',
      title: '交易日历',
      description: '同步 2026 已发生交易日',
      types: ['trading_calendar'],
      icon: <SafetyCertificateOutlined />,
      action: () => runTask('同步交易日历', () => createSync('trading_calendar')),
    },
    {
      key: 'sync_2026',
      title: '全市场日K',
      description: '补齐 2026 全市场日 K，供策略和回测使用',
      types: ['sync_2026'],
      icon: <CloudSyncOutlined />,
      primary: true,
      actionLabel: '全市场日K补齐',
      action: confirmRun2026Sync,
    },
    {
      key: 'full_market_minute_kline',
      title: '全市场分钟K',
      description: '显式长任务补齐 2026 全市场 1 分钟 K',
      types: ['sync_2026'],
      icon: <HddOutlined />,
      actionLabel: '全市场分钟K',
      action: confirmRunFullMarketMinute2026Sync,
    },
  ];

  const positionColumns: ColumnsType<PositionSnapshot> = [
    {
      title: '账户/来源',
      dataIndex: 'account_id',
      width: TABLE_COL.account,
      fixed: 'left',
      render: (value: string) => (
        <Space direction="vertical" size={2}>
          <Typography.Text className="data-source-account" ellipsis={{ tooltip: value }}>{value}</Typography.Text>
          {sourceTag(accountSourceMeta(value, qmtStatus))}
        </Space>
      ),
    },
    { title: '股票代码', dataIndex: 'symbol', sorter: (a, b) => a.symbol.localeCompare(b.symbol), width: TABLE_COL.stockCode, fixed: 'left' },
    { title: '股票名称', dataIndex: 'name', width: TABLE_COL.stockName, ellipsis: true },
    { title: '持仓数量', dataIndex: 'quantity', width: TABLE_COL.quantity, sorter: (a, b) => a.quantity - b.quantity, align: 'right', render: (value: number) => formatQuantity(value) },
    { title: '可卖数量', dataIndex: 'available_quantity', width: TABLE_COL.quantity, align: 'right', render: (value: number) => formatQuantity(value) },
    { title: '成本价', dataIndex: 'cost_price', width: TABLE_COL.price, align: 'right', render: (value: number) => formatPrice(value) },
    { title: '最新价', dataIndex: 'last_price', width: TABLE_COL.price, align: 'right', render: (value: number) => formatPrice(value) },
    { title: '市值', dataIndex: 'market_value', width: TABLE_COL.amountWide, align: 'right', render: (value: number) => formatMoneyByUnit(value) },
    { title: '浮盈亏', dataIndex: 'pnl', width: TABLE_COL.amountWide, align: 'right', render: (v: number) => <Typography.Text type={getPnLTextType(v)}>{formatMoneyByUnit(v)}</Typography.Text> },
    { title: '盈亏率', dataIndex: 'pnl_ratio', width: TABLE_COL.percent, align: 'right', render: (v: number) => <Typography.Text type={getPnLTextType(v)}>{Number.isFinite(v) ? `${v.toFixed(2)}%` : '--'}</Typography.Text> },
    { title: '快照时间', dataIndex: 'snapshot_time', width: TABLE_COL.time },
  ];

  const orderColumns: ColumnsType<OrderRecord> = [
    { title: '委托时间', dataIndex: 'order_time', width: TABLE_COL.time, fixed: 'left' },
    { title: '本地订单', dataIndex: 'local_order_id', width: TABLE_COL.orderId, fixed: 'left', ellipsis: true, render: renderTraceText },
    { title: 'QMT订单', dataIndex: 'qmt_order_id', width: TABLE_COL.qmtOrderId, responsive: ['xxl'], ellipsis: true, render: renderTraceText },
    {
      title: '账户/来源',
      dataIndex: 'account_id',
      width: TABLE_COL.account,
      responsive: ['xxl'],
      render: (value: string, record) => (
        <Space direction="vertical" size={2}>
          <Typography.Text className="data-source-account" ellipsis={{ tooltip: value }}>{value}</Typography.Text>
          <Space size={4} wrap>
            {sourceTag(accountSourceMeta(value, qmtStatus))}
            {sourceTag(syncSourceMeta(record.source))}
          </Space>
        </Space>
      ),
    },
    { title: '股票代码', dataIndex: 'symbol', width: TABLE_COL.stockCode },
    { title: '股票名称', dataIndex: 'name', width: TABLE_COL.stockName, ellipsis: true },
    { title: '方向', dataIndex: 'side', width: TABLE_COL.side, render: (value: string) => <Tag color={getSideColor(value)}>{formatSide(value)}</Tag> },
    { title: '价格', dataIndex: 'price', width: TABLE_COL.price, align: 'right', render: (value: number) => formatPrice(value) },
    { title: '数量', dataIndex: 'quantity', width: TABLE_COL.quantity, align: 'right', render: (value: number) => formatQuantity(value) },
    { title: '已成交', dataIndex: 'filled_quantity', width: TABLE_COL.quantity, align: 'right', render: (value: number) => formatQuantity(value) },
    { title: '状态', dataIndex: 'status', width: TABLE_COL.status, fixed: false, render: statusTag },
    { title: 'QMT状态', dataIndex: 'qmt_status', width: TABLE_COL.type, responsive: ['xxl'], render: (value?: string | null) => value || '--' },
    { title: '来源', dataIndex: 'source', width: TABLE_COL.source, responsive: ['xxl'], render: (value: string) => sourceTag(syncSourceMeta(value)) },
    { title: '更新时间', dataIndex: 'updated_at', width: TABLE_COL.time, responsive: ['xxl'] },
  ];

  const tradeColumns: ColumnsType<TradeRecord> = [
    { title: '成交时间', dataIndex: 'trade_time', width: TABLE_COL.time, fixed: 'left' },
    { title: '成交编号', dataIndex: 'trade_id', width: TABLE_COL.qmtOrderId, fixed: 'left', ellipsis: true, render: renderTraceText },
    {
      title: '账户/来源',
      dataIndex: 'account_id',
      width: TABLE_COL.account,
      responsive: ['xxl'],
      render: (value: string, record) => (
        <Space direction="vertical" size={2}>
          <Typography.Text className="data-source-account" ellipsis={{ tooltip: value }}>{value}</Typography.Text>
          <Space size={4} wrap>
            {sourceTag(accountSourceMeta(value, qmtStatus))}
            {sourceTag(syncSourceMeta(record.source))}
          </Space>
        </Space>
      ),
    },
    { title: '股票代码', dataIndex: 'symbol', width: TABLE_COL.stockCode },
    { title: '股票名称', dataIndex: 'name', width: TABLE_COL.stockName, ellipsis: true },
    { title: '方向', dataIndex: 'side', width: TABLE_COL.side, render: (value: string) => <Tag color={getSideColor(value)}>{formatSide(value)}</Tag> },
    { title: '成交价', dataIndex: 'price', width: TABLE_COL.price, align: 'right', render: (value: number) => formatPrice(value) },
    { title: '数量', dataIndex: 'quantity', width: TABLE_COL.quantity, align: 'right', render: (value: number) => formatQuantity(value) },
    { title: '金额', dataIndex: 'amount', width: TABLE_COL.amountWide, responsive: ['xl'], align: 'right', render: (value: number) => formatMoneyByUnit(value) },
    { title: '手续费', dataIndex: 'fee', width: TABLE_COL.amount, responsive: ['xxl'], align: 'right', render: (value: number) => formatMoneyByUnit(value) },
    { title: '来源', dataIndex: 'source', width: TABLE_COL.source, responsive: ['xxl'], render: (value: string) => sourceTag(syncSourceMeta(value)) },
  ];

  const stockColumns: ColumnsType<StockBasic> = [
    { title: '股票代码', dataIndex: 'symbol', sorter: (a, b) => a.symbol.localeCompare(b.symbol), width: TABLE_COL.stockCode, fixed: 'left' },
    { title: '股票名称', dataIndex: 'name', width: TABLE_COL.stockName, ellipsis: true },
    { title: '市场', dataIndex: 'market', width: TABLE_COL.source },
    { title: '证券类型', dataIndex: 'security_type', width: TABLE_COL.action },
    { title: '上市状态', dataIndex: 'list_status', width: TABLE_COL.status, render: (value: string) => <Tag color={value === '上市' ? 'green' : 'default'}>{value || '--'}</Tag> },
    { title: '是否ST', dataIndex: 'is_st', width: TABLE_COL.status, render: (value: boolean) => <Tag color={value ? 'red' : 'default'}>{value ? '是' : '否'}</Tag> },
    { title: '更新时间', dataIndex: 'updated_at', width: TABLE_COL.time },
  ];

  const instrumentColumns: ColumnsType<InstrumentDetail> = [
    { title: '股票代码', dataIndex: 'symbol', width: TABLE_COL.stockCode, fixed: 'left' },
    { title: '合约ID', dataIndex: 'instrument_id', width: TABLE_COL.stockCode, responsive: ['xxl'], ellipsis: true, render: renderTraceText },
    { title: '合约名称', dataIndex: 'instrument_name', width: TABLE_COL.stockWide, ellipsis: true },
    { title: '市场', dataIndex: 'exchange_id', width: TABLE_COL.source },
    { title: '交易代码', dataIndex: 'exchange_code', width: TABLE_COL.stockCode, responsive: ['xxl'], ellipsis: true },
    { title: '前收', dataIndex: 'pre_close', align: 'right', width: TABLE_COL.price, render: (value: number) => formatPrice(value) },
    { title: '涨停价', dataIndex: 'up_stop_price', align: 'right', width: TABLE_COL.price, render: (value: number) => formatPrice(value) },
    { title: '跌停价', dataIndex: 'down_stop_price', align: 'right', width: TABLE_COL.price, render: (value: number) => formatPrice(value) },
    { title: '可交易', dataIndex: 'is_trading', width: TABLE_COL.status, render: (value: boolean) => <Tag color={value ? 'green' : 'default'}>{value ? '是' : '否'}</Tag> },
    { title: '状态', dataIndex: 'instrument_status', width: TABLE_COL.action, responsive: ['xxl'], render: (value: string) => value || '暂无' },
    { title: '上市日期', dataIndex: 'open_date', width: TABLE_COL.date, render: (value?: string | null) => value || '--' },
    { title: '到期日期', dataIndex: 'expire_date', width: TABLE_COL.date, responsive: ['xxl'], render: (value?: string | null) => value || '--' },
    { title: '交易日', dataIndex: 'trading_day', width: TABLE_COL.date, responsive: ['xxl'], render: (value?: string | null) => value || '--' },
    { title: '同步时间', dataIndex: 'sync_time', width: TABLE_COL.time, responsive: ['xxl'] },
  ];

  const calendarColumns: ColumnsType<TradingCalendarRecord> = [
    { title: '市场', dataIndex: 'market', width: TABLE_COL.source, fixed: 'left' },
    { title: '交易日期', dataIndex: 'trade_date', width: TABLE_COL.date },
    { title: '是否交易日', dataIndex: 'is_trading_day', width: TABLE_COL.action, render: (value: boolean) => <Tag color={value ? 'green' : 'default'}>{value ? '交易日' : '非交易日'}</Tag> },
    { title: '来源', dataIndex: 'source', width: TABLE_COL.source },
    { title: '同步时间', dataIndex: 'sync_time', width: TABLE_COL.time },
  ];

  const klineColumns: ColumnsType<DailyKline> = [
    { title: '股票代码', dataIndex: 'symbol', width: TABLE_COL.stockCode, fixed: 'left' },
    { title: '日期', dataIndex: 'trade_date', width: TABLE_COL.date },
    { title: '开盘', dataIndex: 'open', width: TABLE_COL.price, align: 'right', render: (value: number) => formatPrice(value) },
    { title: '最高', dataIndex: 'high', width: TABLE_COL.price, align: 'right', render: (value: number) => formatPrice(value) },
    { title: '最低', dataIndex: 'low', width: TABLE_COL.price, align: 'right', render: (value: number) => formatPrice(value) },
    { title: '收盘', dataIndex: 'close', width: TABLE_COL.price, align: 'right', render: (value: number) => formatPrice(value) },
    { title: '成交量', dataIndex: 'volume', width: TABLE_COL.amount, align: 'right', render: (value: number) => formatQuantity(value, '股') },
    { title: '成交额', dataIndex: 'amount', width: TABLE_COL.amountWide, align: 'right', render: (value: number) => formatMoneyByUnit(value) },
    { title: '落库时间', dataIndex: 'created_at', width: TABLE_COL.time },
    {
      title: '详情',
      key: 'detail',
      fixed: 'right',
      width: TABLE_COL.detailAction,
      render: (_, record) => (
        <TableActionGroup
          primary={<Button aria-label="查看K线明细" title="查看K线明细" size="small" onClick={() => openKlineDetail(record)}>详情</Button>}
        />
      ),
    },
  ];

  const catalogColumns: ColumnsType<OfficialDataCatalogItem> = [
    { title: '数据类型', dataIndex: 'data_type', width: TABLE_COL.tableName, fixed: 'left' },
    { title: '名称', dataIndex: 'name', width: TABLE_COL.fieldName, render: wrapLongText },
    { title: '分类', dataIndex: 'category', width: TABLE_COL.type },
    { title: '官方接口', dataIndex: 'official_interface', width: TABLE_COL.interfaceName, responsive: ['xxl'], render: wrapLongText },
    { title: '本地表', dataIndex: 'local_table', width: TABLE_COL.stock },
    { title: '状态', dataIndex: 'enabled', width: TABLE_COL.status, render: (value: boolean) => <Tag color={value ? 'green' : 'default'}>{value ? '可用' : '规划'}</Tag> },
    { title: '回测必需', dataIndex: 'required_for_backtest', width: TABLE_COL.status, render: (value: boolean) => (value ? <Tag color="blue">是</Tag> : <Tag>否</Tag>) },
    { title: '优先级', dataIndex: 'priority', width: TABLE_COL.status, render: (value: string) => <Tag color={priorityColor(value)}>{value}</Tag> },
    { title: '同步频率', dataIndex: 'sync_frequency', width: TABLE_COL.range, responsive: ['xxl'], render: wrapLongText },
    { title: '边界说明', dataIndex: 'account_boundary', width: TABLE_COL.text, responsive: ['xxl'], render: wrapLongText },
    { title: '备注', dataIndex: 'notes', width: TABLE_COL.noteWide, responsive: ['xxl'], render: wrapLongText },
  ];

  const freshnessColumns: ColumnsType<DataFreshnessItem> = [
    { title: '数据项', dataIndex: 'name', width: TABLE_COL.fieldName, fixed: 'left', render: wrapLongText },
    { title: '状态', dataIndex: 'status', width: TABLE_COL.status, render: freshnessStatusText },
    { title: '最新日期', dataIndex: 'latest_date', width: TABLE_COL.date, render: (value?: string | null) => value || '--' },
    { title: '目标日期', dataIndex: 'target_date', width: TABLE_COL.date },
    {
      title: '滞后',
      dataIndex: 'lag_days',
      width: TABLE_COL.status,
      render: (value?: number | null) => (value === null || value === undefined ? '--' : `${value} 天`),
    },
    {
      title: '覆盖率',
      dataIndex: 'coverage_rate',
      width: TABLE_COL.action,
      render: (value?: number | null) => (value === null || value === undefined ? '--' : `${value.toFixed(2)}%`),
    },
    {
      title: '覆盖数量',
      dataIndex: 'actual_coverage_units',
      width: TABLE_COL.quantityWide,
      responsive: ['xxl'],
      align: 'right',
      render: (value?: number | null, record?: DataFreshnessItem) => {
        if (!record) return renderTableCount(value, '行');
        return (
          <Tooltip title={freshnessCoverageUnitHint(record)} placement="topRight">
            {renderTableCount(value ?? record.actual_rows, freshnessCoverageUnit(record))}
          </Tooltip>
        );
      },
    },
    { title: '说明', dataIndex: 'message', width: TABLE_COL.messageWide, render: wrapLongText },
    { title: '建议', dataIndex: 'suggestion', width: TABLE_COL.reasonWide, render: wrapLongText },
  ];

  const coverageColumns: ColumnsType<DataCoverageRecord> = [
    { title: '数据类型', dataIndex: 'data_type', width: TABLE_COL.stockWide, fixed: 'left', ellipsis: true },
    { title: '范围', dataIndex: 'symbol', width: TABLE_COL.stockCode },
    { title: '周期', dataIndex: 'period', width: TABLE_COL.status, render: (value: string) => value || '--' },
    { title: '开始日期', dataIndex: 'start_date', width: TABLE_COL.date },
    { title: '结束日期', dataIndex: 'end_date', width: TABLE_COL.date },
    {
      title: '交易日',
      key: 'trading_days',
      width: TABLE_COL.quantityWide,
      render: (_, record) => `${record.actual_trading_days}/${record.expected_trading_days}`,
    },
    {
      title: '覆盖率',
      dataIndex: 'coverage_rate',
      width: TABLE_COL.progress,
      render: (value: number) => <Progress percent={Math.round(value)} size="small" status={value >= 99.9 ? 'success' : value > 0 ? 'active' : 'exception'} />,
    },
    { title: '状态', dataIndex: 'status', width: TABLE_COL.status, render: coverageStatusText },
    {
      title: '实际覆盖',
      dataIndex: 'actual_rows',
      align: 'right',
      width: TABLE_COL.quantityWide,
      responsive: ['xxl'],
      render: (value: number, record) => (
        <Tooltip title={coverageUnitHint(record)} placement="topRight">
          {renderTableCount(record.actual_coverage_units ?? value, coverageUnit(record))}
        </Tooltip>
      ),
    },
    {
      title: '预期覆盖',
      dataIndex: 'expected_rows',
      align: 'right',
      width: TABLE_COL.quantityWide,
      responsive: ['xxl'],
      render: (value?: number | null, record?: DataCoverageRecord) => (
        <Tooltip title={record ? coverageUnitHint(record) : undefined} placement="topRight">
          {renderTableCount(record ? record.expected_coverage_units ?? value : value, record ? coverageUnit(record) : '行')}
        </Tooltip>
      ),
    },
    { title: '重复组', dataIndex: 'duplicate_rows', align: 'right', width: TABLE_COL.status, responsive: ['xxl'] },
    { title: '缺失日期', dataIndex: 'missing_days', width: TABLE_COL.messageWide, responsive: ['xxl'], render: (value: string) => (value === '[]' ? '无' : wrapLongText(value)) },
    { title: '检查时间', dataIndex: 'checked_at', width: TABLE_COL.time, responsive: ['xxl'] },
    {
      title: '详情',
      key: 'detail',
      fixed: 'right',
      width: TABLE_COL.detailAction,
      render: (_, record) => (
        <TableActionGroup
          primary={<Button aria-label="查看覆盖率详情" title="查看覆盖率详情" size="small" onClick={() => openCoverageDetail(record)}>详情</Button>}
        />
      ),
    },
  ];

  const openSyncLog = async (record: SyncTaskSummary) => {
    const hasFailure = hasSyncFailure(record);
    const isRunning = isSyncRunning(record);
    let logItems: Awaited<ReturnType<typeof getSyncLogs>>['items'] = [];
    try {
      const logResult = await getSyncLogs({ keyword: record.task_id, pageSize: 20, sortField: 'created_at', sortOrder: 'asc' });
      logItems = logResult.items;
    } catch {
      logItems = [];
    }
    const focusLogs = logItems.filter((item) => item.level === 'error' || item.level === 'warning');
    const lastLog = focusLogs.at(-1) ?? logItems.at(-1);
    const detailItems = buildTaskDetailItems(record.technical_detail, record.message);
    setLogDrawer({
      title: hasFailure ? '同步失败详情' : '同步任务详情',
      subtitle: `${record.sync_type} / ${record.task_id}`,
      status: record.status,
      statusTone: hasFailure ? 'red' : isRunning ? 'blue' : 'green',
      width: DATA_DETAIL_DRAWER_WIDTH,
      fieldColumns: DATA_DETAIL_FIELD_COLUMNS,
      className: dataCenterDrawerClassName('data-sync-detail-drawer'),
      message: hasFailure
        ? lastLog?.message || '同步任务存在失败记录。请先确认真实 QMT 数据源状态，再根据任务 ID 检查后端日志；周末券商维护时请等待 QMT 可登录后再重新发起小范围同步。'
        : isRunning
          ? '同步任务正在运行。请等待任务完成，页面刷新后可查看成功数、失败数和结束时间。'
          : lastLog?.message || '同步任务已记录摘要信息。当前页面展示任务级结果，明细异常会继续写入后端日志。',
      technicalDetail: JSON.stringify(
        {
          qa_type: 'data_sync_task_detail',
          ai_copy_version: '1.1',
          source_boundary: '页面只展示已创建的长任务和同步日志；实际 QMT 调用仍由后端 Adapter 执行。',
          task_id: record.task_id,
          sync_type: record.sync_type,
          status: record.status,
          progress: record.progress,
          message: record.message,
          total_count: record.total_count,
          success_count: record.success_count,
          failed_count: record.failed_count,
          technical_detail: parseTaskDetail(record.technical_detail) ?? record.technical_detail,
          started_at: record.started_at,
          finished_at: record.finished_at,
          sync_logs: logItems.map((item) => ({
            level: item.level,
            sync_type: item.sync_type,
            message: item.message,
            technical_detail: item.technical_detail,
            created_at: item.created_at,
          })),
          ui_next_steps: hasFailure
            ? [
                '检查数据源状态页的真实 QMT 连接状态',
                '复制任务 ID 到系统日志中检索',
                '先做小范围同步，不要直接全量重试',
              ]
            : ['确认成功数与预期范围一致', '必要时刷新数据质量检查'],
        },
        null,
        2,
      ),
      fields: [
        { label: '任务 ID', value: record.task_id, copyValue: record.task_id },
        { label: '同步类型', value: record.sync_type, copyValue: record.sync_type },
        { label: '任务状态', value: statusTag(record.status), copyValue: record.status },
        { label: '进度', value: `${Math.round(record.progress ?? 0)}%`, copyValue: `${Math.round(record.progress ?? 0)}%` },
        { label: '数据来源', value: '真实 QMT / SQLite 落库优先' },
        { label: '任务口径', value: '长任务 task_id 轮询，失败明细写入同步日志。' },
        { label: '当前说明', value: record.message || '暂无' },
        { label: '总数', value: record.total_count },
        { label: '成功', value: record.success_count },
        {
          label: '失败',
          value: hasFailure ? <Typography.Text type="danger">{record.failed_count}</Typography.Text> : record.failed_count,
        },
        {
          label: '建议',
          value: hasFailure ? '复制给 AI 或按任务 ID 去系统日志检索；确认 QMT 可用后再小范围重试。' : '无异常时可继续做数据质量检查。',
        },
        { label: '验收口径', value: '成功数、失败数、写入行数和覆盖率检查要共同核对。' },
        ...detailItems.map(([label, value]) => ({ label, value })),
        { label: '同步日志', value: logItems.length > 0 ? `${logItems.length} 条，已写入技术详情，可复制给 AI。` : '暂无同步日志明细。' },
        { label: '最近日志', value: lastLog ? `${lastLog.level} / ${lastLog.message}` : '暂无' },
        { label: '开始时间', value: record.started_at },
        { label: '结束时间', value: record.finished_at },
      ],
    });
  };

  const openQualityLog = (record: DataQualityRecord) => {
    setLogDrawer({
      title: '质量检查详情',
      subtitle: `${record.target_table} / ${record.check_type}`,
      status: record.status,
      width: DATA_DETAIL_DRAWER_WIDTH,
      fieldColumns: DATA_DETAIL_FIELD_COLUMNS,
      className: dataCenterDrawerClassName('data-quality-detail-drawer'),
      message: record.message || '暂无中文说明。',
      technicalDetail: JSON.stringify(
        {
          qa_type: 'data_quality_detail',
          ai_copy_version: '1.1',
          id: record.id,
          check_type: record.check_type,
          target_table: record.target_table,
          status: record.status,
          message: record.message,
          suggestion: record.suggestion,
          created_at: record.created_at,
        },
        null,
        2,
      ),
      fields: [
        { label: '检查项', value: record.check_type },
        { label: '目标表', value: record.target_table },
        { label: '状态', value: record.status },
        { label: '建议', value: record.suggestion },
        { label: '数据来源', value: 'SQLite 本地落库检查结果' },
        { label: '下一步', value: record.status === 'success' ? '可继续做覆盖率或回测前检查。' : '按建议补齐后重新执行质量检查。' },
        { label: '创建时间', value: record.created_at },
      ],
    });
  };

  const openCoverageDetail = (record: DataCoverageRecord) => {
    const missingDays = record.missing_days === '[]' ? '无' : record.missing_days;
    const isComplete = record.status === 'complete';
    const unit = coverageUnit(record);
    const unitHint = coverageUnitHint(record);
    const actualCoverageUnits = record.actual_coverage_units ?? record.actual_rows;
    const expectedCoverageUnits = record.expected_coverage_units ?? record.expected_rows;
    const coverageConclusion = isComplete
      ? '覆盖完整，可以作为回测前数据核对依据。'
      : '覆盖不完整，正式回测前需要补齐或解释缺口。';
    setLogDrawer({
      title: '覆盖率检查详情',
      subtitle: `${record.data_type} / ${record.symbol || 'ALL'} / ${record.period || '--'}`,
      status: record.status,
      statusTone: record.status === 'complete' ? 'green' : record.status === 'partial' ? 'orange' : record.status === 'missing' ? 'red' : 'blue',
      width: DATA_DETAIL_DRAWER_WIDTH,
      fieldColumns: DATA_DETAIL_FIELD_COLUMNS,
      className: dataCenterDrawerClassName('data-coverage-detail-drawer'),
      message: `本地 SQLite 覆盖率为 ${record.coverage_rate.toFixed(2)}%，实际交易日 ${record.actual_trading_days}/${record.expected_trading_days}，实际${unit} ${actualCoverageUnits.toLocaleString('zh-CN')}。${coverageConclusion}`,
      technicalDetail: JSON.stringify(
        {
          qa_type: 'data_coverage_detail',
          ai_copy_version: '1.1',
          source: {
            storage: 'SQLite',
            coverage_scope: '仅代表本地已落库行情覆盖，不等同于 QMT 服务端全量可用性。',
            coverage_unit: unit,
            coverage_unit_note: unitHint,
          },
          id: record.id,
          data_type: record.data_type,
          symbol: record.symbol,
          period: record.period,
          start_date: record.start_date,
          end_date: record.end_date,
          expected_trading_days: record.expected_trading_days,
          actual_trading_days: record.actual_trading_days,
          expected_coverage_units: expectedCoverageUnits,
          actual_coverage_units: actualCoverageUnits,
          duplicate_rows: record.duplicate_rows,
          coverage_rate: record.coverage_rate,
          missing_days: record.missing_days,
          status: record.status,
          checked_at: record.checked_at,
          audit: {
            coverage_complete: isComplete,
            duplicate_rows: record.duplicate_rows,
            missing_days: missingDays,
          },
          ui_next_steps: record.status === 'complete'
            ? ['覆盖率已完整，可继续用于正式核对。']
            : ['导出缺失清单', '回到数据同步页按数据类型补齐', '补齐后重新执行覆盖率检查。'],
        },
        null,
        2,
      ),
      fields: [
        { label: '数据类型', value: record.data_type },
        { label: '范围', value: record.symbol || 'ALL' },
        { label: '周期', value: record.period || '--' },
        { label: '日期区间', value: `${record.start_date} ~ ${record.end_date}` },
        { label: '交易日', value: `${record.actual_trading_days}/${record.expected_trading_days}` },
        { label: '覆盖数量', value: `${actualCoverageUnits.toLocaleString('zh-CN')}${expectedCoverageUnits ? ` / ${expectedCoverageUnits.toLocaleString('zh-CN')}` : ''} ${unit}` },
        { label: '覆盖率', value: `${record.coverage_rate.toFixed(2)}%` },
        { label: '重复组', value: record.duplicate_rows },
        { label: '缺失日期', value: missingDays },
        { label: '验收结论', value: coverageConclusion },
        { label: '数据口径', value: `本地 SQLite 覆盖率，不直接读取真实 QMT。${unitHint}` },
        { label: '下一步', value: isComplete ? '可进入策略运行或回测前检查。' : '先补齐缺失日期，再重新检查覆盖率。' },
        { label: '检查时间', value: record.checked_at },
      ],
    });
  };

  const openKlineDetail = (record: DailyKline | MinuteKline) => {
    const timeLabel = 'trade_date' in record ? record.trade_date : record.datetime;
    const period = 'period' in record ? record.period : '1d';
    const priceOrderOk = record.low <= record.open && record.low <= record.close && record.high >= record.open && record.high >= record.close;
    const amountOk = record.amount >= 0;
    const volumeOk = record.volume >= 0;
    const auditPassed = priceOrderOk && amountOk && volumeOk;
    setLogDrawer({
      title: 'K 线明细',
      subtitle: `${record.symbol} / ${timeLabel}`,
      status: auditPassed ? period : '需核对',
      statusTone: auditPassed ? 'blue' : 'orange',
      width: DATA_DETAIL_DRAWER_WIDTH,
      fieldColumns: DATA_DETAIL_FIELD_COLUMNS,
      className: dataCenterDrawerClassName('data-kline-detail-drawer'),
      message: `本条 K 线来自本地 SQLite 已落库数据。开 ${formatPrice(record.open)}，高 ${formatPrice(record.high)}，低 ${formatPrice(record.low)}，收 ${formatPrice(record.close)}。${auditPassed ? '基础数值检查通过。' : '存在价格顺序或成交字段异常，请先核对数据源。'}`,
      technicalDetail: JSON.stringify(
        {
          qa_type: 'data_kline_detail',
          ai_copy_version: '1.1',
          source: {
            storage: 'SQLite',
            data_source: 'QMT落库后读取',
            qmt_boundary: '详情页不直接调用 QMT；策略和回测只读取本地落库数据。',
          },
          kline: {
            symbol: record.symbol,
            period,
            time: timeLabel,
            open: record.open,
            high: record.high,
            low: record.low,
            close: record.close,
            volume: record.volume,
            amount: record.amount,
            created_at: record.created_at,
          },
          audit: {
            check_price_order: priceOrderOk,
            check_amount_positive: amountOk,
            check_volume_positive: volumeOk,
            passed: auditPassed,
          },
          raw: record,
        },
        null,
        2,
      ),
      fields: [
        { label: '股票代码', value: record.symbol },
        { label: '时间', value: timeLabel },
        { label: '周期', value: period },
        { label: '数据来源', value: 'QMT 落 SQLite 后读取' },
        { label: '开盘', value: formatPrice(record.open) },
        { label: '最高', value: formatPrice(record.high) },
        { label: '最低', value: formatPrice(record.low) },
        { label: '收盘', value: formatPrice(record.close) },
        { label: '成交量', value: formatQuantity(record.volume, '股') },
        { label: '成交额', value: formatMoneyByUnit(record.amount) },
        { label: '价格顺序', value: priceOrderOk ? '通过' : <Typography.Text type="warning">需核对</Typography.Text> },
        { label: '成交量/额', value: volumeOk && amountOk ? '通过' : <Typography.Text type="warning">需核对</Typography.Text> },
        { label: '策略可用', value: auditPassed ? '可作为策略/回测读取样本。' : '不建议直接用于策略验证。' },
        { label: '落库时间', value: record.created_at },
      ],
    });
  };

  const openDictionaryDetail = (record: DataDictionaryRecord) => {
    setLogDrawer({
      title: '数据字典字段详情',
      subtitle: `${record.table_name}.${record.field_name}`,
      status: record.is_indexed ? '已索引' : '未索引',
      statusTone: record.is_indexed ? 'green' : 'blue',
      width: DATA_DETAIL_DRAWER_WIDTH,
      fieldColumns: DATA_DETAIL_FIELD_COLUMNS,
      className: dataCenterDrawerClassName('data-dictionary-detail-drawer'),
      message: `${record.table_name}.${record.field_name}：${record.description}。策略使用说明：${record.strategy_usage || '暂无'}。`,
      technicalDetail: JSON.stringify(
        {
          qa_type: 'data_dictionary_field_detail',
          ai_copy_version: '1.1',
          field: {
            id: record.id,
            table_name: record.table_name,
            field_name: record.field_name,
            field_type: record.field_type,
            description: record.description,
            unit: record.unit,
            example_value: record.example_value,
            is_indexed: record.is_indexed,
          },
          strategy_guidance: {
            strategy_usage: record.strategy_usage,
            ai_strategy_note: '策略只能通过 StrategyContext 受控读取已落 SQLite 的数据字段，不得直接访问 QMT 或数据库连接。',
            usage_boundary: '字段字典用于理解数据含义，不代表可以绕过后端 StrategyContext 直接查库。',
          },
          raw: record,
        },
        null,
        2,
      ),
      fields: [
        { label: '表名', value: record.table_name },
        { label: '字段名', value: record.field_name },
        { label: '字段类型', value: record.field_type },
        { label: '中文含义', value: record.description },
        { label: '单位', value: record.unit || '无' },
        { label: '示例值', value: record.example_value || '暂无' },
        { label: '策略可用说明', value: record.strategy_usage || '暂无' },
        { label: '是否索引', value: record.is_indexed ? '是' : '否' },
        { label: 'AI 使用', value: '可复制给 AI 写策略字段说明，但策略仍需通过接口检查。' },
        { label: '访问边界', value: '不得在策略中直接访问数据库或 QMT 原始对象。' },
        { label: '下一步', value: record.strategy_usage ? '可用于策略字段依赖说明。' : '建议补充策略可用说明后再复制给 AI。' },
      ],
    });
  };

  const syncColumns: ColumnsType<SyncTaskSummary> = [
    { title: '任务ID', dataIndex: 'task_id', width: TABLE_COL.taskId, fixed: 'left', ellipsis: true },
    { title: '类型', dataIndex: 'sync_type', width: TABLE_COL.stockWide },
    { title: '状态', dataIndex: 'status', width: TABLE_COL.status, render: statusTag },
    {
      title: '进度',
      dataIndex: 'progress',
      width: TABLE_COL.progress,
      render: (value: number, record) => (
        <Progress percent={Math.round(value ?? 0)} size="small" status={record.status === 'failed' ? 'exception' : undefined} />
      ),
    },
    { title: '总数', dataIndex: 'total_count', align: 'right', width: TABLE_COL.quantity, render: (value?: number | null) => renderTableCount(value) },
    { title: '成功', dataIndex: 'success_count', align: 'right', width: TABLE_COL.quantity, render: (value?: number | null) => renderTableCount(value) },
    {
      title: '失败',
      dataIndex: 'failed_count',
      align: 'right',
      width: TABLE_COL.quantity,
      render: (value: number, record) => (
        value > 0 ? (
          <Button aria-label={`失败 ${value} 条`} title="查看同步失败详情" type="link" danger size="small" onClick={() => void openSyncLog(record)}>
            {value} 条
          </Button>
        ) : (
          <Typography.Text type="secondary">0</Typography.Text>
        )
      ),
    },
    { title: '当前说明', dataIndex: 'message', width: TABLE_COL.messageWide, responsive: ['xxl'], render: wrapLongText },
    { title: '开始时间', dataIndex: 'started_at', width: TABLE_COL.time, responsive: ['xxl'] },
    { title: '结束时间', dataIndex: 'finished_at', width: TABLE_COL.time, responsive: ['xxl'] },
    {
      title: '诊断',
      key: 'sync_diagnostics',
      className: 'data-table-col--action',
      onHeaderCell: () => ({ className: 'data-table-col--action' }),
      fixed: 'right',
      width: TABLE_COL.detailAction,
      render: (_, record) => (
        <TableActionGroup
          primary={(
            <Button
              aria-label={hasSyncFailure(record) ? '看失败' : '详情'}
              title={hasSyncFailure(record) ? '查看同步失败详情' : '查看同步任务详情'}
              size="small"
              danger={hasSyncFailure(record)}
              type={hasSyncFailure(record) ? 'primary' : 'default'}
              onClick={() => void openSyncLog(record)}
            >
              {hasSyncFailure(record) ? '看失败' : '详情'}
            </Button>
          )}
          actions={[
            {
              key: 'copy-task-id',
              label: '复制任务ID',
              onClick: () => void copyText('任务ID', record.task_id),
            },
            {
              key: 'copy-task-summary',
              label: '复制任务摘要',
              onClick: () => void copyText('任务摘要', JSON.stringify({
                module: '数据中心',
                source_page: '数据中心 / 数据同步',
                task_id: record.task_id,
                sync_type: record.sync_type,
                status: record.status,
                progress: record.progress,
                message: record.message,
                total_count: record.total_count,
                success_count: record.success_count,
                failed_count: record.failed_count,
                technical_detail: parseTaskDetail(record.technical_detail) ?? record.technical_detail ?? null,
                started_at: record.started_at,
                finished_at: record.finished_at,
              }, null, 2)),
            },
          ]}
        />
      ),
    },
  ];

  const qualityColumns: ColumnsType<DataQualityRecord> = [
    { title: '检查项', dataIndex: 'check_type', width: TABLE_COL.stockWide, fixed: 'left', ellipsis: true },
    { title: '目标表', dataIndex: 'target_table', width: TABLE_COL.stock },
    { title: '状态', dataIndex: 'status', width: TABLE_COL.status, render: statusTag },
    { title: '说明', dataIndex: 'message', width: TABLE_COL.messageWide, render: wrapLongText },
    { title: '建议', dataIndex: 'suggestion', width: TABLE_COL.reasonWide, render: wrapLongText },
    {
      title: '详情',
      key: 'detail',
      fixed: 'right',
      width: TABLE_COL.detailAction,
      render: (_, record) => (
        <TableActionGroup
          primary={<Button aria-label="查看质量检查详情" title="查看质量检查详情" size="small" onClick={() => openQualityLog(record)}>详情</Button>}
        />
      ),
    },
  ];

  const accountDuplicateColumns: ColumnsType<AccountSnapshotDuplicateRecord> = [
    {
      title: '账户',
      dataIndex: 'account_id',
      width: TABLE_COL.account,
      render: (value: string) => (
        <Space direction="vertical" size={2}>
          <Typography.Text>{value}</Typography.Text>
          {sourceTag(accountSourceMeta(value, qmtStatus))}
        </Space>
      ),
    },
    { title: '快照时间', dataIndex: 'snapshot_time', width: TABLE_COL.time },
    {
      title: '重复条数',
      dataIndex: 'duplicate_count',
      width: TABLE_COL.quantity,
      align: 'right',
      render: (value: number) => <Tag color="red">{value} 条</Tag>,
    },
    {
      title: 'ID范围',
      width: TABLE_COL.range,
      render: (_, record) => `${record.min_id} - ${record.max_id}`,
    },
    {
      title: '总资产范围',
      width: TABLE_COL.amountWide,
      align: 'right',
      render: (_, record) =>
        record.min_total_asset === record.max_total_asset
          ? formatMoney(record.max_total_asset)
          : `${formatMoney(record.min_total_asset)} ~ ${formatMoney(record.max_total_asset)}`,
    },
    {
      title: '可用资金范围',
      width: TABLE_COL.amountWide,
      align: 'right',
      render: (_, record) =>
        record.min_available_cash === record.max_available_cash
          ? formatMoney(record.max_available_cash)
          : `${formatMoney(record.min_available_cash)} ~ ${formatMoney(record.max_available_cash)}`,
    },
  ];

  const dictionaryStrategyCategory = (record: DataDictionaryRecord) => {
    const usage = record.strategy_usage || '';
    if (usage.includes('策略可通过')) return 'strategy_readable';
    if (usage.includes('只读')) return 'readonly_reference';
    if (usage.includes('不建议')) return 'not_recommended';
    return 'other';
  };

  const dictionaryColumns: ColumnsType<DataDictionaryRecord> = [
    { title: '表名', dataIndex: 'table_name', width: TABLE_COL.tableName, fixed: 'left', ellipsis: true },
    { title: '字段名', dataIndex: 'field_name', width: TABLE_COL.fieldName, fixed: 'left', ellipsis: true },
    { title: '类型', dataIndex: 'field_type', width: TABLE_COL.status },
    { title: '中文含义', dataIndex: 'description', width: TABLE_COL.reasonWide, render: wrapLongText },
    { title: '单位', dataIndex: 'unit', width: TABLE_COL.side, render: (value?: string | null) => value || '无' },
    { title: '示例', dataIndex: 'example_value', width: TABLE_COL.fieldName, responsive: ['xxl'], ellipsis: true },
    { title: '策略使用', dataIndex: 'strategy_usage', width: TABLE_COL.noteWide, responsive: ['xxl'], render: wrapLongText },
    { title: '索引', dataIndex: 'is_indexed', width: TABLE_COL.side, render: (v: boolean) => (v ? '是' : '否') },
    {
      title: '操作',
      fixed: 'right',
      width: TABLE_COL.detailAction,
      render: (_, record) => (
        <TableActionGroup
          primary={(
            <Button
              aria-label="查看数据字典字段详情"
              title="查看数据字典字段详情"
              size="small"
              onClick={() => openDictionaryDetail(record)}
            >
              详情
            </Button>
          )}
          actions={[
            {
              key: 'copy',
              label: '复制字段说明',
              onClick: () => void copyText('字段说明', `${record.table_name}.${record.field_name}: ${record.description}\n类型：${record.field_type}\n单位：${record.unit || '无'}\n示例：${record.example_value ?? '暂无'}\n策略可用说明：${record.strategy_usage || '暂无'}`),
            },
          ]}
        />
      ),
    },
  ];

  const isRealQmt = isRealQmtMode(qmtStatus?.mode);
  const isTestIsolationQmt = isTestIsolationMode(qmtStatus?.mode);
  const qmtModeText = formatQmtModeLabel(qmtStatus?.mode, { testIsolation: '测试隔离模式', real: '真实 QMT 只读' });
  const qmtConnectText = qmtStatus?.connected ? '已连接' : '未连接';
  const qmtXtquantText = qmtStatus?.xtquant_installed ? 'xtquant 已安装' : 'xtquant 未安装';
  const catalogItems = officialCatalog?.items ?? [];
  const enabledCatalogCount = catalogItems.filter((item) => item.enabled).length;
  const backtestCatalogCount = catalogItems.filter((item) => item.required_for_backtest).length;
  const unsupportedCatalogCount = officialCatalog?.unsupported_items.length ?? 0;
  const dailyCoverage = coverage2026.find((item) => item.data_type === 'daily_kline');
  const dailySymbolCoverage = coverage2026.filter((item) => item.data_type === 'daily_kline' && item.symbol !== 'ALL');
  const dailyGapCountOnPage = dailySymbolCoverage.filter((item) => item.status !== 'complete').length;
  const minuteCoverage = coverage2026.find((item) => item.data_type === 'minute_kline');
  const minuteSymbolCoverage = coverage2026.filter((item) => item.data_type === 'minute_kline' && item.symbol !== 'ALL');
  const minuteGapCountOnPage = minuteSymbolCoverage.filter((item) => item.status !== 'complete').length;
  const calendarCoverage = coverage2026.find((item) => item.data_type === 'trading_calendar');
  const instrumentCoverage = coverage2026.find((item) => item.data_type === 'instrument_detail');
  const coverageUpdatedAt = coverage2026[0]?.checked_at ?? null;
  const formatCoverageEvidence = (record?: DataCoverageRecord) => {
    if (!record) return { value: '--', detail: '等待覆盖率检查', status: <Tag>未检查</Tag> };
    const covered = record.actual_coverage_units ?? record.actual_rows;
    const expected = record.expected_coverage_units ?? record.expected_rows;
    return {
      value: `${record.coverage_rate.toFixed(2)}%`,
      detail: `${formatQuantity(covered, coverageUnit(record))} / ${formatQuantity(expected, coverageUnit(record))}`,
      status: coverageStatusText(record.status),
    };
  };
  const coverageEvidenceItems = [
    {
      key: 'daily',
      label: '日K覆盖',
      ...formatCoverageEvidence(dailyCoverage),
      hint: dailyCoverage ? `${dailyCoverage.start_date} ~ ${dailyCoverage.end_date}` : '日 K 覆盖率用于正式回测前验收。',
    },
    {
      key: 'minute',
      label: '分钟K覆盖',
      ...formatCoverageEvidence(minuteCoverage),
      hint: minuteCoverage ? `${minuteCoverage.start_date} ~ ${minuteCoverage.end_date}` : '分钟 K 策略必须先完成分钟覆盖验收。',
    },
    {
      key: 'calendar',
      label: '交易日历',
      ...formatCoverageEvidence(calendarCoverage),
      hint: calendarCoverage ? `${calendarCoverage.actual_trading_days}/${calendarCoverage.expected_trading_days} 个交易日` : '交易日历决定同步窗口和回测日期门禁。',
    },
    {
      key: 'instrument',
      label: '合约基础',
      ...formatCoverageEvidence(instrumentCoverage),
      hint: instrumentCoverage ? `重复组 ${instrumentCoverage.duplicate_rows || 0}` : '合约基础用于涨跌停、停牌和交易状态核对。',
    },
  ];
  const runningSyncTasks = syncTasks.filter(isSyncRunning);
  const failedSyncTasks = syncTasks.filter(hasSyncFailure);
  const latestSyncTask = syncTasks[0] ?? null;
  const activeOrLatestTask = activeTask ?? (latestSyncTask ? syncTaskToRuntimeTask(latestSyncTask) : null);
  const syncEvidenceItems = [
    {
      key: 'active',
      label: '当前任务',
      value: activeOrLatestTask ? `${Math.round(activeOrLatestTask.progress ?? 0)}%` : '--',
      detail: activeOrLatestTask?.task_type ?? '暂无运行中任务',
      status: activeOrLatestTask ? statusTag(activeOrLatestTask.status) : <Tag>空闲</Tag>,
      hint: activeOrLatestTask?.task_id ?? '创建同步任务后会显示 task_id。',
    },
    {
      key: 'tasks',
      label: '任务总量',
      value: `${syncPage.total || syncTasks.length} 条`,
      detail: `${runningSyncTasks.length} 运行 / ${failedSyncTasks.length} 失败`,
      status: failedSyncTasks.length > 0 ? <Tag color="red">需处理</Tag> : <Tag color="green">正常</Tag>,
      hint: '同步任务必须返回 task_id，并在任务列表保留状态、进度和技术详情。',
    },
    {
      key: 'latest',
      label: '最近同步',
      value: latestSyncTask?.sync_type ?? '--',
      detail: latestSyncTask?.finished_at || latestSyncTask?.started_at || '暂无时间',
      status: latestSyncTask ? statusTag(latestSyncTask.status) : <Tag>暂无</Tag>,
      hint: latestSyncTask?.message || '最近任务会用于判断数据链路是否仍在推进。',
    },
    {
      key: 'boundary',
      label: '执行边界',
      value: isRealQmt ? '真实只读' : qmtModeText,
      detail: '先落 SQLite，再供策略 / 回测 / 交易读取',
      status: <Tag color={isRealQmt ? 'green' : 'orange'}>{isRealQmt ? '业务模式' : '需核对'}</Tag>,
      hint: '本区不提交真实委托，真实交易仍必须经过交易执行和确认弹窗。',
    },
  ];
  const accountScopeText: Record<AccountDataScope, string> = {
    current: '当前账户最新快照',
    account_history: '当前账户历史数据',
    all_history: '全部历史数据',
  };
  const accountScopeDescription: Record<AccountDataScope, string> = {
    current: isRealQmt ? '默认只显示当前真实账户最新持仓和当前账户委托/成交，测试历史数据已隐藏。' : isTestIsolationQmt ? '当前为测试隔离数据视图，仅用于自动化回归或排障。' : '当前数据源模式未检测，请先刷新或到系统管理执行环境检测。',
    account_history: '显示当前账户的历史快照，适合核对同步轨迹。',
    all_history: '显示本地库全部历史数据，可能包含测试隔离与真实验收数据，请仅用于排查。',
  };
  const accountProvenance = accountSourceMeta(account?.account_id, qmtStatus);
  const accountEvidenceItems = [
    {
      key: 'scope',
      label: '账户范围',
      value: accountScopeText[accountScope],
      detail: account?.account_id || qmtStatus?.account_id || '未配置账户',
      status: <Tag color={isRealQmt ? 'green' : 'orange'}>{qmtModeText}</Tag>,
      hint: accountScope === 'current' ? '默认隔离测试历史数据。' : '排查视图需按来源列核对。',
    },
    {
      key: 'snapshot',
      label: '资产快照',
      value: account?.snapshot_time || '--',
      detail: `总资产 ${formatMoneyByUnit(account?.total_asset ?? 0)}`,
      status: <DataFreshnessTag label="账户" updatedAt={account?.snapshot_time} loading={loading} />,
      hint: '账户资产来自本地 SQLite 已落库快照。',
    },
    {
      key: 'orders',
      label: '持仓/委托',
      value: `${positionPage.total} / ${orderPage.total}`,
      detail: `${tradePage.total} 条成交记录`,
      status: positionPage.total + orderPage.total + tradePage.total > 0 ? <Tag color="blue">有数据</Tag> : <Tag>空</Tag>,
      hint: '账户数据页只读，不会提交真实委托。',
    },
    {
      key: 'boundary',
      label: '安全边界',
      value: isRealQmt ? '真实只读' : qmtModeText,
      detail: qmtStatus?.connected ? 'QMT 已连接' : 'QMT 未连接',
      status: <Tag color={qmtStatus?.connected ? 'green' : 'default'}>{qmtConnectText}</Tag>,
      hint: '下单必须进入交易执行并人工确认。',
    },
  ];
  const activeMarketCoverage = marketPeriod === 'daily' ? dailyCoverage : minuteCoverage;
  const marketEvidenceItems = [
    {
      key: 'period',
      label: '查看周期',
      value: marketPeriod === 'daily' ? '日 K' : '分钟 K',
      detail: `${currentMarketSummary.firstTime} ~ ${currentMarketSummary.lastTime}`,
      status: <DataFreshnessTag label={marketPeriod === 'daily' ? '日 K' : '分钟 K'} updatedAt={currentMarketUpdatedAt} loading={loading} />,
      hint: '图表和表格均读取已落 SQLite 的本地行情。',
    },
    {
      key: 'stock',
      label: '股票基础',
      value: `${formatQuantity(stockPage.total)} 条`,
      detail: '股票池代码、名称、上市状态',
      status: stockPage.total > 0 ? <Tag color="green">可用</Tag> : <Tag>待同步</Tag>,
      hint: '全市场回测前应先核对股票基础覆盖。',
    },
    {
      key: 'kline',
      label: '页内 K 线',
      value: `${currentMarketRows.length} 条`,
      detail: `成交额 ${currentMarketSummary.totalAmount}`,
      status: currentMarketRows.length > 0 ? <Tag color="blue">已加载</Tag> : <Tag>无数据</Tag>,
      hint: '本页只展示有限样本，不代表全市场已完整。',
    },
    {
      key: 'coverage',
      label: '覆盖门禁',
      value: activeMarketCoverage ? `${activeMarketCoverage.coverage_rate.toFixed(2)}%` : '--',
      detail: activeMarketCoverage ? `${activeMarketCoverage.start_date} ~ ${activeMarketCoverage.end_date}` : '等待覆盖率检查',
      status: activeMarketCoverage ? coverageStatusText(activeMarketCoverage.status) : <Tag>未检查</Tag>,
      hint: marketPeriod === 'minute' ? '分钟策略必须使用分钟 K 覆盖率验收。' : '日 K 回测需核对日 K 覆盖率。',
    },
  ];
  const basicEvidenceItems = [
    {
      key: 'stock',
      label: '股票资料',
      value: `${formatQuantity(stockPage.total)} 条`,
      detail: '代码、名称、市场和上市状态',
      status: stockPage.total > 0 ? <Tag color="green">可用</Tag> : <Tag>待同步</Tag>,
      hint: '策略股票池筛选依赖股票基础资料。',
    },
    {
      key: 'instrument',
      label: '合约基础',
      value: `${formatQuantity(instrumentPage.total)} 条`,
      detail: '前收、涨跌停、交易状态',
      status: instrumentCoverage ? coverageStatusText(instrumentCoverage.status) : <Tag>需核对</Tag>,
      hint: '回测涨跌停和停牌判断依赖合约基础。',
    },
    {
      key: 'calendar',
      label: '交易日历',
      value: `${formatQuantity(calendarPage.total)} 条`,
      detail: 'SH / SZ / BJ 交易日',
      status: calendarCoverage ? coverageStatusText(calendarCoverage.status) : <Tag>需核对</Tag>,
      hint: '同步窗口和回测日期门禁依赖交易日历。',
    },
    {
      key: 'boundary',
      label: '官方边界',
      value: '普通账户',
      detail: '不含 Level2 / 信用账户',
      status: <Tag color="blue">只读资料</Tag>,
      hint: '仅展示 QMT 普通股票账户可读取资料。',
    },
  ];
  const renderEvidenceBoard = (
    className: string,
    testId: string,
    ariaLabel: string,
    items: Array<{
      key: string;
      label: string;
      value: string;
      detail: string;
      status: ReactNode;
      hint: string;
    }>,
  ) => (
    <div className={`data-center-evidence-board ${className}`} data-testid={testId} aria-label={ariaLabel}>
      {items.map((item) => (
        <div className="data-center-evidence-card" key={item.key}>
          <div className="data-center-evidence-card__head">
            <Typography.Text type="secondary">{item.label}</Typography.Text>
            {item.status}
          </div>
          <Typography.Text className="data-center-evidence-card__value" strong ellipsis={{ tooltip: item.value }}>{item.value}</Typography.Text>
          <Typography.Text className="data-center-evidence-card__detail" ellipsis={{ tooltip: item.detail }}>{item.detail}</Typography.Text>
          <Typography.Text className="data-center-evidence-card__hint" type="secondary" ellipsis={{ tooltip: item.hint }}>{item.hint}</Typography.Text>
        </div>
      ))}
    </div>
  );
  const freshnessBlockedItems = freshnessSummary?.items.filter((item) => ['missing', 'stale', 'partial'].includes(item.status)) ?? [];
  const freshnessWarningItems = freshnessSummary?.items.filter((item) => item.status === 'unknown') ?? [];
  const freshnessAlertType = freshnessSummary?.overall_status === 'failed' ? 'error' : freshnessSummary?.overall_status === 'warning' ? 'warning' : 'success';
  const freshnessTitle = freshnessSummary
    ? `本地数据目标交易日：${freshnessSummary.target_trade_date}，${freshnessBlockedItems.length ? `${freshnessBlockedItems.length} 项需要补齐` : '关键数据已到目标日'}`
    : '正在读取本地数据新鲜度';
  const provenanceDescription = isRealQmt
    ? `当前默认按真实 QMT 账户 ${qmtStatus?.account_id || '未配置'} 展示；切到“全部历史”时，页面会逐行标记真实、测试隔离和历史账户。`
    : '当前未处于真实 QMT 模式；页面会保留来源标签，便于排查历史数据。';
  const changeAccountScope = (value: AccountDataScope) => {
    setAccountScope(value);
    setPositionPage({ ...defaultPageState });
    setOrderPage({ ...defaultPageState });
    setTradePage({ ...defaultPageState });
  };
  const dataWorkflowItems: WorkbenchNavItem<DataCenterTabKey>[] = [
    {
      key: '数据概览',
      title: '数据新鲜度',
      description: freshnessBlockedItems.length ? `${freshnessBlockedItems.length} 项待补齐` : '关键数据到目标日',
      tone: freshnessBlockedItems.length ? 'warning' : 'success',
    },
    {
      key: '数据同步',
      title: '同步落库',
      description: activeTask ? `当前 ${activeTask.task_type}` : `${syncPage.total || syncTasks.length} 条任务`,
      tone: activeTask ? 'info' : 'neutral',
    },
    {
      key: '数据质量',
      title: '覆盖质量',
      description: `${qualitySummary?.failed_count ?? 0} 失败 / ${qualitySummary?.warning_count ?? 0} 警告`,
      tone: (qualitySummary?.failed_count ?? 0) > 0 ? 'danger' : (qualitySummary?.warning_count ?? 0) > 0 ? 'warning' : 'success',
    },
    {
      key: '账户数据',
      title: '账户行情',
      description: isRealQmt ? '真实 QMT 数据优先' : isTestIsolationQmt ? '测试隔离需标记' : '模式未检测',
      tone: isRealQmt ? 'info' : isTestIsolationQmt ? 'neutral' : 'warning',
    },
    {
      key: '数据字典',
      title: '数据字典',
      description: `${dictionaryPage.total || dictionary.length} 个字段说明`,
      tone: 'neutral',
    },
  ];

  return (
    <div className="module-page data-center-page">
      <PageHeader
        title="数据中心"
        description="管理 QMT 数据源、账户数据、行情数据、同步任务、数据质量和数据字典。"
        updatedAt={updatedAt}
        loading={loading}
        onRefresh={() => loadActiveData()}
        extra={<DataFreshnessTag label="当前页" updatedAt={updatedAt} loading={loading} />}
        primaryAction={{ label: '同步到最新', testId: 'btn-sync-latest-data', disabled: syncBusy, onClick: confirmRunLatestDataSync }}
      />

      <CommandPanel
        eyebrow="DATA CONTROL"
        title={`当前数据来源：${qmtModeText}`}
        description={provenanceDescription}
        actions={(
          <>
            {sourceTag(accountProvenance)}
            <Tag color={qmtStatus?.connected ? 'green' : 'default'}>{qmtConnectText}</Tag>
          </>
        )}
        items={[
          { label: 'QMT 连接', value: qmtConnectText, helper: qmtModeText, tone: qmtStatus?.connected ? 'success' : 'warning' },
          { label: '数据新鲜度', value: freshnessBlockedItems.length ? `${freshnessBlockedItems.length} 待补` : '已到目标日', helper: freshnessSummary?.target_trade_date ?? '等待检查', tone: freshnessBlockedItems.length ? 'warning' : 'success' },
          { label: '同步任务', value: activeTask ? '运行中' : `${syncPage.total || syncTasks.length} 条`, helper: activeTask?.task_type ?? '无运行任务', tone: activeTask ? 'info' : 'neutral' },
          { label: '质量检查', value: `${qualitySummary?.failed_count ?? 0} 失败`, helper: `${qualitySummary?.warning_count ?? 0} 警告`, tone: (qualitySummary?.failed_count ?? 0) > 0 ? 'danger' : (qualitySummary?.warning_count ?? 0) > 0 ? 'warning' : 'success' },
        ]}
      />

      <TaskProgress task={activeTask} />

      <Row gutter={[8, 8]} className="data-center-overview">
        <Col xs={24} md={12} xl={6}>
          <MetricCard
            label="数据源状态"
            value={qmtConnectText}
            subValue={qmtModeText}
            icon={<ApiOutlined />}
            tone={qmtStatus?.connected ? 'green' : 'neutral'}
            loading={activeTab === '数据来源' && loading && !qmtStatus}
          />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <MetricCard
            label="账户资产"
            value={<FinancialNumber value={account?.total_asset} tone="primary" compact />}
            subValue={account?.snapshot_time ? `快照 ${account.snapshot_time}` : '切换到账户数据后显示'}
            icon={<WalletOutlined />}
            tone="blue"
          />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <MetricCard
            label="同步任务"
            value={`${syncPage.total || syncTasks.length} 条`}
            subValue={activeTask ? `当前：${activeTask.task_type}` : '切换到数据同步后显示'}
            icon={<CloudSyncOutlined />}
            tone="orange"
          />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <MetricCard
            label="质量检查"
            value={`${qualitySummary?.failed_count ?? 0} 失败`}
            subValue={qualitySummary?.latest_check_time ? `最近 ${qualitySummary.latest_check_time}` : '切换到数据质量后显示'}
            icon={<SafetyCertificateOutlined />}
            tone={(qualitySummary?.failed_count ?? 0) > 0 ? 'red' : 'green'}
          />
        </Col>
      </Row>

      <Alert
        className="data-provenance-alert"
        type={freshnessAlertType}
        showIcon
        message={freshnessTitle}
        description={freshnessSummary ? (
          <Space direction="vertical" size={4}>
            {freshnessSummary.next_actions.slice(0, 3).map((action) => (
              <Typography.Text key={action}>{action}</Typography.Text>
            ))}
            {freshnessWarningItems.length ? (
              <Typography.Text type="secondary">另有 {freshnessWarningItems.length} 项无记录但可能属于当天无委托/无成交的正常情况。</Typography.Text>
            ) : null}
          </Space>
        ) : '正在读取本地 SQLite 中行情、账户、持仓、委托、成交的最新日期。'}
        action={(
          <Space wrap size={6}>
            <Button size="small" type="primary" loading={syncBusy} disabled={syncBusy} onClick={confirmRunLatestDataSync}>
              同步到最新
            </Button>
            <Button size="small" onClick={() => setActiveTab('数据同步')}>
              去同步
            </Button>
          </Space>
        )}
      />

      <WorkbenchNav ariaLabel="数据中心工作流导航" items={dataWorkflowItems} activeKey={activeTab} onChange={setActiveTab} />

      <Tabs
        className="data-center-tabs"
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as DataCenterTabKey)}
        items={[
          {
            key: '数据概览',
            label: '数据概览',
            children: (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Row gutter={[8, 8]}>
                  <Col xs={24} sm={12} xl={6}>
                    <MetricCard
                      label="官方可用数据"
                      value={`${enabledCatalogCount} 类`}
                      subValue={`合约基础 ${instrumentCoverage ? `${instrumentCoverage.coverage_rate.toFixed(0)}%` : '待查'} / 共 ${catalogItems.length} 类`}
                      icon={<DatabaseOutlined />}
                      tone="blue"
                    />
                  </Col>
                  <Col xs={24} sm={12} xl={6}>
                    <MetricCard
                      label="回测必需数据"
                      value={`${backtestCatalogCount} 类`}
                      subValue={`交易日历 ${calendarCoverage ? `${calendarCoverage.coverage_rate.toFixed(0)}%` : '待查'} / 日 K 优先`}
                      icon={<LineChartOutlined />}
                      tone="green"
                    />
                  </Col>
                  <Col xs={24} sm={12} xl={6}>
                    <MetricCard label="明确不支持" value={`${unsupportedCatalogCount} 项`} subValue="Level2 / 信用 / 外部源等" icon={<SafetyCertificateOutlined />} tone="orange" />
                  </Col>
                  <Col xs={24} sm={12} xl={6}>
                    <MetricCard
                      label="2026 日K覆盖"
                      value={dailyCoverage ? `${dailyCoverage.coverage_rate.toFixed(0)}%` : '--'}
                      subValue={dailyCoverage ? `${formatQuantity(dailyCoverage.actual_rows)} 行 / 当前页缺口 ${dailyGapCountOnPage} 只` : '等待覆盖率检查'}
                      icon={<CloudSyncOutlined />}
                      tone={dailyCoverage && dailyCoverage.coverage_rate >= 99.9 ? 'green' : 'orange'}
                    />
                  </Col>
                </Row>

                <Alert
                  type="info"
                  showIcon
                  message="QMT 官方数据边界"
                  description={officialCatalog?.limitation_note ?? '当前按普通股票账户、无 Level2、无信用账户、不接外部数据源的边界执行。'}
                />

                <SectionCard
                  title="本地数据新鲜度"
                  description="真实 QMT 已连接不代表本地 SQLite 已经同步到最新完成交易日；这里按行情、账户、持仓和交易记录逐项核对。"
                  extra={(
                    <Space wrap>
                      <Tag color={freshnessAlertType === 'success' ? 'green' : freshnessAlertType === 'warning' ? 'orange' : 'red'}>
                        目标 {freshnessSummary?.target_trade_date ?? '--'}
                      </Tag>
                      <Button size="small" type="primary" onClick={confirmRunLatestDataSync} loading={loading} disabled={syncBusy}>
                        同步到最新
                      </Button>
                      <Button size="small" onClick={() => loadActiveData('数据概览')} loading={loading}>
                        刷新新鲜度
                      </Button>
                    </Space>
                  )}
                >
                  <DataTable<DataFreshnessItem>
                    rowKey="key"
                    size="small"
                    columns={freshnessColumns}
                    className="data-table--freshness"
                    dataSource={freshnessSummary?.items ?? []}
                    loading={loading && !freshnessSummary}
                    pagination={false}
                    tableLayout="fixed"
                    data-testid="table-data-freshness"
                    scroll={{ x: 'max-content' }}
                    emptyDescription="暂无数据新鲜度摘要，请刷新数据中心。"
                  />
                </SectionCard>

                <SectionCard
                  title="2026 数据补齐"
                  description="按文档要求先生成计划，再执行补齐；日 K 可一键全市场，分钟 K 只有显式确认后才跑全市场长任务。"
                  extra={
                    <Space wrap>
                      <Button aria-label="生成 2026 数据补齐计划" title="生成 2026 数据补齐计划" onClick={generate2026Plan} loading={loading}>
                        生成计划
                      </Button>
                      <Button aria-label="生成 2026 全市场分钟 K 计划" title="生成 2026 全市场分钟 K 计划" onClick={generateFullMarketMinute2026Plan} loading={loading}>
                        全市场分钟K计划
                      </Button>
                      <Button aria-label="启动 2026 全市场日 K 补齐" title="启动 2026 全市场日 K 补齐" type="primary" icon={<CloudSyncOutlined />} onClick={confirmRun2026Sync} loading={loading}>
                        全市场日K补齐
                      </Button>
                      <Button aria-label="启动 2026 全市场分钟 K 补齐" title="启动 2026 全市场分钟 K 补齐" danger icon={<HddOutlined />} onClick={confirmRunFullMarketMinute2026Sync} loading={loading}>
                        全市场分钟K补齐
                      </Button>
                    </Space>
                  }
                >
                  <Row gutter={[12, 12]}>
                    <Col xs={24} lg={12}>
                      <div className="data-2026-plan-panel">
                        <Space direction="vertical" size={8} style={{ width: '100%' }}>
                          <Typography.Text strong>当前执行边界</Typography.Text>
                          <Typography.Text type="secondary">普通股票账户；业务数据使用真实 QMT 只读同步验收；不会触发真实交易。</Typography.Text>
                          <Space wrap>
                            <Tag color="blue">股票基础资料</Tag>
                            <Tag color="blue">2026 日 K</Tag>
                            <Tag color="green">日K每批200只</Tag>
                            <Tag color="green">覆盖率优先续跑</Tag>
                            <Tag color="green">sync_cursor 辅助</Tag>
                            <Tag color="green">分钟K每批50只</Tag>
                            <Tag color="green">分钟K每窗口5个交易日</Tag>
                            <Tag color="green">分钟K覆盖率续跑</Tag>
                            <Tag color="orange">全市场分钟K需显式确认</Tag>
                            <Tag>财务数据规划中</Tag>
                          </Space>
                          {dailySymbolCoverage.length > 0 ? (
                            <Typography.Text type="secondary">
                              当前页股票覆盖：{dailySymbolCoverage.length - dailyGapCountOnPage}/{dailySymbolCoverage.length} 只完整；缺口股票可在下方表格按 daily_kline 过滤查看。
                            </Typography.Text>
                          ) : null}
                          {minuteCoverage ? (
                            <Typography.Text type="secondary">
                              分钟 K 覆盖：{minuteCoverage.status === 'missing' ? '尚未补齐或默认未启用' : `${minuteCoverage.coverage_rate.toFixed(0)}%`}；
                              当前页缺口 {minuteGapCountOnPage} 只。
                            </Typography.Text>
                          ) : null}
                        </Space>
                      </div>
                    </Col>
                    <Col xs={24} lg={12}>
                      <div className="data-2026-plan-panel">
                        <Space direction="vertical" size={8} style={{ width: '100%' }}>
                          <Typography.Text strong>计划结果</Typography.Text>
                          {preparePlan2026 ? (
                            <>
                              <Typography.Text type="secondary">
                                区间：{preparePlan2026.start_date} 至 {preparePlan2026.end_date}，周期：{preparePlan2026.period}
                              </Typography.Text>
                              <Space wrap size={6}>
                                <Tag color={preparePlan2026.test_isolation ? 'blue' : 'green'}>
                                  {preparePlan2026.test_isolation ? '测试隔离计划' : '真实 QMT 只读计划'}
                                </Tag>
                                <Typography.Text type="secondary">
                                  {preparePlan2026.test_isolation
                                    ? '仅用于自动化测试、离线回归和排障。'
                                    : '将读取真实 QMT 只读数据并先落 SQLite。'}
                                </Typography.Text>
                              </Space>
                              <Space wrap>
                                {preparePlan2026.steps.map((step) => (
                                  <Tag color={step.default_enabled ? 'green' : 'default'} key={step.data_type}>
                                    {step.step_no}. {step.name}
                                  </Tag>
                                ))}
                              </Space>
                              {preparePlan2026.warnings.map((warning) => (
                                <Typography.Text type="warning" key={warning}>{warning}</Typography.Text>
                              ))}
                            </>
                          ) : (
                            <Typography.Text type="secondary">点击“生成计划”后，这里会显示本批次补齐步骤、默认开关和风险提示。</Typography.Text>
                          )}
                        </Space>
                      </div>
                    </Col>
                  </Row>
                </SectionCard>

                <SectionCard
                  title="2026 覆盖率检查"
                  description="覆盖率只反映本地 SQLite 已落库数据；日K按股票-交易日行数统计，分钟K按股票-交易日覆盖单元统计，分钟原始bar行数请结合同步任务写入行数核对。"
                  extra={(
                    <Space wrap size={8}>
                      <DataFreshnessTag label="最近检查" updatedAt={coverageUpdatedAt} loading={loading} />
                      <Button
                        aria-label="导出2026覆盖率缺失清单"
                        title="导出2026覆盖率缺失清单"
                        icon={<DownloadOutlined />}
                        onClick={() => handleExportCoverageMissing()}
                        disabled={loading}
                      >
                        导出缺失清单
                      </Button>
                    </Space>
                  )}
                >
                  <div className="data-center-evidence-board data-center-evidence-board--coverage" data-testid="data-coverage-evidence-board" aria-label="2026覆盖率证据链">
                    {coverageEvidenceItems.map((item) => (
                      <div className="data-center-evidence-card" key={item.key}>
                        <div className="data-center-evidence-card__head">
                          <Typography.Text type="secondary">{item.label}</Typography.Text>
                          {item.status}
                        </div>
                        <Typography.Text className="data-center-evidence-card__value" strong>{item.value}</Typography.Text>
                        <Typography.Text className="data-center-evidence-card__detail">{item.detail}</Typography.Text>
                        <Typography.Text className="data-center-evidence-card__hint" type="secondary">{item.hint}</Typography.Text>
                      </div>
                    ))}
                  </div>
                  <DataTable<DataCoverageRecord>
                    rowKey="id"
                    size="small"
                    columns={coverageColumns}
                    className="data-table--coverage"
                    dataSource={coverage2026}
                    loading={initialTableLoading(coverage2026.length)}
                    pagination={{ current: coveragePage.page, pageSize: coveragePage.pageSize, total: coveragePage.total, showSizeChanger: true }}
                    onChange={(pagination) => setCoveragePage({ page: pagination.current ?? 1, pageSize: pagination.pageSize ?? 50, total: coveragePage.total })}
                    tableLayout="fixed"
                    data-testid="table-coverage-2026"
                    scroll={{ x: 'max-content' }}
                    quickSearch={{ placeholder: '当前页搜索数据类型/股票/状态/缺失日期', fields: ['data_type', 'symbol', 'status', 'missing_days'], width: 340 }}
                    quickFilters={[
                      { label: '覆盖状态', options: ['complete', 'partial', 'missing', 'failed'].map((value) => ({ label: value, value })), getValue: (record) => record.status },
                    ]}
                    emptyDescription="暂无覆盖率记录，请点击刷新或先生成 2026 补齐计划。"
                  />
                </SectionCard>

                <SectionCard title="官方数据目录" description="根据 QMT / MiniQMT 普通股票账户边界整理，区分已接入、规划中和明确不支持。">
                  <DataTable<OfficialDataCatalogItem>
                    rowKey="data_type"
                    size="small"
                    columns={catalogColumns}
                    className="data-table--official-catalog"
                    dataSource={catalogItems}
                    loading={initialTableLoading(catalogItems.length)}
                    pagination={{ pageSize: 10, showSizeChanger: false }}
                    tableLayout="fixed"
                    data-testid="table-official-catalog"
                    scroll={{ x: 'max-content' }}
                    quickSearch={{ placeholder: '当前页搜索数据类型/接口/本地表', fields: ['data_type', 'name', 'official_interface', 'local_table', 'notes'], width: 300 }}
                    quickFilters={[
                      { label: '是否可用', options: [{ label: '可用', value: 'true' }, { label: '规划', value: 'false' }], getValue: (record) => String(record.enabled) },
                      { label: '优先级', options: ['P0', 'P1', 'P2'].map((value) => ({ label: value, value })), getValue: (record) => record.priority },
                    ]}
                    emptyDescription="暂无官方数据目录，请刷新数据中心。"
                  />
                  {officialCatalog?.unsupported_items.length ? (
                    <div className="data-catalog-unsupported">
                      <Typography.Text strong>当前不纳入本地轻量版的数据：</Typography.Text>
                      <Space wrap>
                        {officialCatalog.unsupported_items.map((item) => <Tag key={item}>{item}</Tag>)}
                      </Space>
                    </div>
                  ) : null}
                </SectionCard>
              </Space>
            ),
          },
          {
            key: '数据来源',
            label: '数据来源',
            children: (
              <div className="data-source-workbench" data-testid="data-source-workbench">
                <Row gutter={[8, 8]} align="stretch" className="data-source-workbench__top">
                  <Col xs={24} xl={16}>
                    <SectionCard
                      className="data-source-main-card"
                      title="QMT 数据源"
                      description="业务运行使用真实 QMT 数据源；测试隔离数据只用于自动化测试和排障。"
                      extra={<Tag color={qmtStatus?.connected ? 'success' : 'default'}>{qmtConnectText}</Tag>}
                    >
                      <Row gutter={[12, 12]} className="data-source-grid">
                        <Col xs={24} md={12}>
                          <div className="data-source-cell">
                            <Typography.Text type="secondary">数据源名称</Typography.Text>
                            <Typography.Text strong>QMT</Typography.Text>
                          </div>
                        </Col>
                        <Col xs={24} md={12}>
                          <div className="data-source-cell">
                            <Typography.Text type="secondary">运行模式</Typography.Text>
                            <Typography.Text strong>{qmtModeText}</Typography.Text>
                          </div>
                        </Col>
                        <Col xs={24} md={12}>
                          <div className="data-source-cell">
                            <Typography.Text type="secondary">账户 ID</Typography.Text>
                            <Typography.Text strong>{qmtStatus?.account_id || '未配置'}</Typography.Text>
                          </div>
                        </Col>
                        <Col xs={24} md={12}>
                          <div className="data-source-cell">
                            <Typography.Text type="secondary">xtquant 状态</Typography.Text>
                            <Typography.Text strong>{qmtXtquantText}</Typography.Text>
                          </div>
                        </Col>
                        <Col xs={24} md={12}>
                          <div className="data-source-cell">
                            <Typography.Text type="secondary">最近连接</Typography.Text>
                            <Typography.Text strong>{qmtStatus?.last_connected_at ?? '暂无'}</Typography.Text>
                          </div>
                        </Col>
                        <Col xs={24} md={12}>
                          <div className="data-source-cell">
                            <Typography.Text type="secondary">QMT 路径</Typography.Text>
                            <Typography.Text strong ellipsis={{ tooltip: qmtStatus?.qmt_path || '未配置' }}>
                              {qmtStatus?.qmt_path || '未配置'}
                            </Typography.Text>
                          </div>
                        </Col>
                      </Row>
                      <Alert className="data-center-note" type="info" showIcon message={qmtStatus?.message ?? '未获取数据源状态'} />
                    </SectionCard>
                  </Col>
                  <Col xs={24} xl={8}>
                    <SectionCard className="data-source-action-card" title="数据源操作" description="只做连接、测试和断开，不会触发真实交易。">
                      <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        <Button aria-label="测试真实 QMT 数据源连接" title="测试真实 QMT 数据源连接" block icon={<ThunderboltOutlined />} loading={sourceBusyAction === 'test'} disabled={Boolean(sourceBusyAction)} onClick={() => sourceActions('test')}>
                          测试连接
                        </Button>
                        <Button aria-label="连接真实 QMT 数据源" title="连接真实 QMT 数据源" block type="primary" icon={<ApiOutlined />} loading={sourceBusyAction === 'connect'} disabled={Boolean(sourceBusyAction)} onClick={() => sourceActions('connect')}>
                          连接数据
                        </Button>
                        <Button aria-label="断开当前数据源连接" title="断开当前数据源连接" block icon={<DisconnectOutlined />} loading={sourceBusyAction === 'disconnect'} disabled={Boolean(sourceBusyAction)} onClick={() => sourceActions('disconnect')}>
                          断开连接
                        </Button>
                      </Space>
                    </SectionCard>
                  </Col>
                </Row>
                <SectionCard className="data-source-flow-card" title="数据中心工作流" description="所有数据先落 SQLite，再供策略、回测和交易页面读取。">
                  <div className="data-flow-strip">
                    {[
                      ['1', '连接检测', '确认真实 QMT 可用', '只读状态'],
                      ['2', '同步落库', '标准化写入 SQLite', '长任务'],
                      ['3', '质量检查', '识别空、过期、重复、缺失', '可诊断'],
                      ['4', '供给业务', '策略、回测、交易统一读本地库', '可信数据'],
                    ].map(([step, title, description, tag], index, list) => (
                      <div className="data-flow-strip__node" key={step}>
                        <div className="data-flow-strip__card">
                          <span className="data-flow-strip__index">{step}</span>
                          <div>
                            <Space size={6} wrap>
                              <Typography.Text strong>{title}</Typography.Text>
                              <Tag>{tag}</Tag>
                            </Space>
                            <Typography.Text type="secondary">{description}</Typography.Text>
                          </div>
                        </div>
                        {index < list.length - 1 ? <ArrowRightOutlined className="data-flow-strip__arrow" /> : null}
                      </div>
                    ))}
                  </div>
                </SectionCard>
                <SectionCard className="data-source-boundary-card" title="数据源边界" description="把真实数据、测试隔离、回测读取和交易安全边界放在同一处，避免误解当前数据口径。">
                  <div className="data-source-boundary-grid" data-testid="data-source-boundary-grid">
                    {[
                      ['真实 QMT', qmtModeText, qmtStatus?.connected ? '已连接，页面只读展示真实账户边界' : '未连接时显示中文错误和技术详情'],
                      ['SQLite 落库', '统一供给', '策略、回测、交易页面只读取已落库数据'],
                      ['回测安全', '本地推演', '不会调用真实 QMT 下单接口'],
                      ['交易安全', '人工确认', '信号进入交易执行后仍需确认与幂等保护'],
                      ['测试隔离', '不进业务视图', '仅用于自动化测试和离线排障'],
                      ['数据缺口', '质量检查', '空数据、重复、过期和缺失通过数据质量页诊断'],
                    ].map(([label, value, hint]) => (
                      <div className="data-source-boundary-item" key={label}>
                        <span>{label}</span>
                        <strong>{value}</strong>
                        <em>{hint}</em>
                      </div>
                    ))}
                  </div>
                </SectionCard>
              </div>
            ),
          },
          {
            key: '账户数据',
            label: '账户数据',
            children: (
              <Space className="data-account-workbench" direction="vertical" size={8} style={{ width: '100%' }}>
                <Row gutter={[8, 8]}>
                  <Col xs={24} sm={12} lg={6}>
                    <MetricCard label="总资产" value={<FinancialNumber value={account?.total_asset} tone="primary" compact />} icon={<WalletOutlined />} tone="blue" />
                  </Col>
                  <Col xs={24} sm={12} lg={6}>
                    <MetricCard label="可用资金" value={<FinancialNumber value={account?.available_cash} tone="neutral" compact />} subValue="可用于新委托" />
                  </Col>
                  <Col xs={24} sm={12} lg={6}>
                    <MetricCard label="持仓市值" value={<FinancialNumber value={account?.market_value} tone="neutral" compact />} subValue={`${positionPage.total} 条持仓记录`} />
                  </Col>
                  <Col xs={24} sm={12} lg={6}>
                    <MetricCard label="今日盈亏" value={<FinancialNumber value={account?.today_pnl} tone="auto-pnl" showSign compact />} subValue="A 股红涨绿跌" tone={(account?.today_pnl ?? 0) >= 0 ? 'red' : 'green'} />
                  </Col>
                </Row>
                {renderEvidenceBoard('data-center-evidence-board--account', 'data-account-evidence-board', '账户数据证据链', accountEvidenceItems)}
                <div className="account-scope-panel" data-testid="account-scope-panel">
                  <div>
                    <Space wrap size={8}>
                      <Typography.Text strong>{accountScopeText[accountScope]}</Typography.Text>
                      <Tag color={isRealQmt ? 'blue' : 'default'}>{qmtModeText}</Tag>
                      <Tag>{account?.account_id || qmtStatus?.account_id || '未配置账户'}</Tag>
                      {sourceTag(accountProvenance)}
                      <DataFreshnessTag label="账户快照" updatedAt={account?.snapshot_time} loading={loading} />
                    </Space>
                    <Typography.Paragraph type="secondary" className="account-scope-panel__hint">
                      {accountScopeDescription[accountScope]}
                    </Typography.Paragraph>
                  </div>
                  <Segmented
                    value={accountScope}
                    onChange={(value) => changeAccountScope(value as AccountDataScope)}
                    options={[
                      { label: '当前最新', value: 'current' },
                      { label: '账户历史', value: 'account_history' },
                      { label: '全部历史', value: 'all_history' },
                    ]}
                  />
                </div>
                {isRealQmt && accountScope === 'current' ? (
                  <Alert
                    type="info"
                    showIcon
                    message="真实 QMT 默认只看当前账户"
                    description="当前视图按系统配置账户和最新快照过滤，测试历史持仓、委托、成交不会混入默认表格；如需排查旧数据，请手动切换到“全部历史”。"
                  />
                ) : null}
                {accountScope === 'all_history' ? (
                  <Alert
                    type="warning"
                    showIcon
                    message="全部历史视图包含多来源数据"
                    description="这里可能同时出现真实 QMT、测试隔离和旧历史账户数据。请以“账户/来源”列为准，不要把全部历史视图当作当前真实账户状态。"
                  />
                ) : null}
                <SectionCard title="持仓" description="账户持仓快照，账户数据页面只读。">
                  <DataTable<PositionSnapshot>
                    rowKey="id"
                    size="small"
                    columns={positionColumns}
                    className="data-table--account-positions"
                    dataSource={positions}
                    loading={initialTableLoading(positions.length)}
                    pagination={{ current: positionPage.page, pageSize: positionPage.pageSize, total: positionPage.total, showSizeChanger: true }}
                    onChange={(pagination) => setPositionPage({ page: pagination.current ?? 1, pageSize: pagination.pageSize ?? 20, total: positionPage.total })}
                    data-testid="table-positions"
                    tableLayout="fixed"
                    scroll={{ x: TABLE_SCROLL_X.dataPositions }}
                    quickSearch={{ placeholder: '当前页搜索股票/账户', fields: ['symbol', 'name', 'account_id'], width: 240 }}
                    emptyDescription={isRealQmt ? '暂无当前真实账户持仓数据，请先执行真实 QMT 只读持仓同步，或切换到历史视图排查。' : '暂无持仓数据；当前不是业务真实数据视图，请先切换真实 QMT 并执行只读同步。'}
                  />
                </SectionCard>
                <Row gutter={[8, 8]}>
                  <Col xs={24} xl={24} xxl={12}>
                    <SectionCard title="委托" description="最近委托状态，便于检查同步结果。">
                      <DataTable<OrderRecord>
                        rowKey="id"
                        size="small"
                        columns={orderColumns}
                        className="data-table--account-orders"
                        dataSource={orders}
                        loading={initialTableLoading(orders.length)}
                        pagination={{ current: orderPage.page, pageSize: orderPage.pageSize, total: orderPage.total, showSizeChanger: true }}
                        onChange={(pagination) => setOrderPage({ page: pagination.current ?? 1, pageSize: pagination.pageSize ?? 20, total: orderPage.total })}
                        data-testid="table-orders"
                        tableLayout="fixed"
                        scroll={{ x: 'max-content' }}
                        quickSearch={{ placeholder: '当前页搜索订单/股票/来源', fields: ['local_order_id', 'qmt_order_id', 'symbol', 'name', 'account_id', 'source'], width: 260 }}
                        quickFilters={[
                          { label: '委托状态', options: ['待提交', '已提交', '已报', '部分成交', '全部成交', '已撤', '废单', '失败'].map((value) => ({ label: value, value })), getValue: (record) => record.status },
                          { label: '来源', options: [{ label: '真实同步', value: 'real_sync' }, { label: '测试隔离', value: 'test_sync' }], getValue: (record) => normalizeSyncSource(record.source) },
                        ]}
                        emptyDescription="暂无委托数据，请先同步委托记录；账户数据页面只读，不会直接下单。"
                      />
                    </SectionCard>
                  </Col>
                  <Col xs={24} xl={24} xxl={12}>
                    <SectionCard title="成交" description="最近成交快照，供策略和交易核对。">
                      <DataTable<TradeRecord>
                        rowKey="id"
                        size="small"
                        columns={tradeColumns}
                        className="data-table--account-trades"
                        dataSource={trades}
                        loading={initialTableLoading(trades.length)}
                        pagination={{ current: tradePage.page, pageSize: tradePage.pageSize, total: tradePage.total, showSizeChanger: true }}
                        onChange={(pagination) => setTradePage({ page: pagination.current ?? 1, pageSize: pagination.pageSize ?? 20, total: tradePage.total })}
                        data-testid="table-trades"
                        tableLayout="fixed"
                        scroll={{ x: 'max-content' }}
                        quickSearch={{ placeholder: '当前页搜索成交/股票/来源', fields: ['trade_id', 'symbol', 'name', 'account_id', 'source'], width: 260 }}
                        quickFilters={[
                          { label: '方向', options: [{ label: '买入', value: 'BUY' }, { label: '卖出', value: 'SELL' }], getValue: (record) => record.side },
                          { label: '来源', options: [{ label: '真实同步', value: 'real_sync' }, { label: '测试隔离', value: 'test_sync' }], getValue: (record) => normalizeSyncSource(record.source) },
                        ]}
                        emptyDescription="暂无成交数据，请先同步成交记录。"
                      />
                    </SectionCard>
                  </Col>
                </Row>
              </Space>
            ),
          },
          {
            key: '行情数据',
            label: '行情数据',
            children: (
              <Space className="data-market-workbench" direction="vertical" size={8} style={{ width: '100%' }}>
                <Alert
                  type={isRealQmt ? 'success' : 'info'}
                  showIcon
                  message="行情数据来源提示"
                  description={isRealQmt
                    ? '当前行情同步来自真实 QMT 只读链路；K 线表按本地 SQLite 展示历史落库结果，请结合同步任务时间和覆盖率核对。'
                    : '当前行情可能来自测试隔离或历史落库数据；正式回测前请先切换真实 QMT 并完成同步验收。'}
                />
                {renderEvidenceBoard('data-center-evidence-board--market', 'data-market-evidence-board', '行情数据证据链', marketEvidenceItems)}
                <div className="market-kline-workbench" aria-label="K线查看工作台">
                    <SectionCard
                      className="market-kline-card market-kline-workbench__chart"
                      title="K 线查看：600000.SH"
                      description="默认查看有限区间，图表只做本地行情检查，不作为复杂行情终端。"
                      extra={
                        <Segmented
                          value={marketPeriod}
                          onChange={(value) => setMarketPeriod(value as MarketPeriod)}
                          options={[
                            { label: '日 K', value: 'daily' },
                            { label: '分钟 K', value: 'minute' },
                          ]}
                        />
                      }
                    >
                      <KLineChart title={marketPeriod === 'daily' ? '日K查看：600000.SH' : '分钟K查看：600000.SH'} rows={currentMarketRows} height={300} framed={false} />
                    </SectionCard>
                    <SectionCard className="market-kline-side-panel" title="数据新鲜度" description="检查当前查看周期的最新落库时间。">
                      <Space direction="vertical" size={8} style={{ width: '100%' }}>
                        <DataFreshnessTag label={marketPeriod === 'daily' ? '日 K' : '分钟 K'} updatedAt={currentMarketUpdatedAt} loading={loading} />
                        <div className="market-freshness-item">
                          <Typography.Text type="secondary">当前周期</Typography.Text>
                          <Typography.Text strong>{marketPeriod === 'daily' ? '日 K' : '1 分钟 K'}</Typography.Text>
                        </div>
                        <div className="market-freshness-item">
                          <Typography.Text type="secondary">当前页记录</Typography.Text>
                          <Typography.Text strong>{currentMarketRows.length} 条</Typography.Text>
                        </div>
                        <div className="market-freshness-item">
                          <Typography.Text type="secondary">首条时间</Typography.Text>
                          <Typography.Text strong>{currentMarketSummary.firstTime}</Typography.Text>
                        </div>
                        <div className="market-freshness-item">
                          <Typography.Text type="secondary">末条时间</Typography.Text>
                          <Typography.Text strong>{currentMarketSummary.lastTime}</Typography.Text>
                        </div>
                        <div className="market-freshness-item">
                          <Typography.Text type="secondary">首/末收盘</Typography.Text>
                          <Typography.Text strong>{currentMarketSummary.firstClose} / {currentMarketSummary.lastClose}</Typography.Text>
                        </div>
                        <div className="market-freshness-item">
                          <Typography.Text type="secondary">页内成交额</Typography.Text>
                          <Typography.Text strong>{currentMarketSummary.totalAmount}</Typography.Text>
                        </div>
                        <div className="market-freshness-item">
                          <Typography.Text type="secondary">范围约束</Typography.Text>
                          <Typography.Text strong>按需同步</Typography.Text>
                        </div>
                      <Alert
                        type="warning"
                        showIcon
                        message="分钟 K 不会默认全市场多年同步；如需 2026 全市场分钟 K，请在数据补齐中显式启动全市场分钟 K 长任务。"
                      />
                      </Space>
                    </SectionCard>
                </div>
                <SectionCard title="行情同步" description="行情补齐统一走 2026 数据补齐入口；本区只保留股票基础刷新和全市场分钟 K 显式长任务。">
                  <div className="market-sync-strip">
                    <Button aria-label="同步股票基础信息" title="同步股票基础信息" icon={<DatabaseOutlined />} loading={syncBusy} disabled={syncBusy} onClick={() => runTask('同步股票', () => createSync('stock_basic'))}>
                      同步股票
                    </Button>
                    <Button aria-label="启动 2026 全市场分钟 K 补齐" title="启动 2026 全市场分钟 K 补齐" danger icon={<HddOutlined />} loading={syncBusy} disabled={syncBusy} onClick={confirmRunFullMarketMinute2026Sync}>
                      全市场分钟K
                    </Button>
                    <Typography.Text type="secondary">同步会创建 task_id，进度在“数据同步”页查看。</Typography.Text>
                  </div>
                </SectionCard>
                <SectionCard title="股票基础" description="股票代码、名称、市场和上市状态。">
                  <DataTable<StockBasic>
                    rowKey="id"
                    size="small"
                    columns={stockColumns}
                    className="data-table--stock-basic"
                    dataSource={stocks}
                    loading={initialTableLoading(stocks.length)}
                    pagination={{ current: stockPage.page, pageSize: stockPage.pageSize, total: stockPage.total, showSizeChanger: true }}
                    onChange={(pagination) => setStockPage({ page: pagination.current ?? 1, pageSize: pagination.pageSize ?? 20, total: stockPage.total })}
                    data-testid="table-stocks"
                    tableLayout="fixed"
                    scroll={{ x: TABLE_SCROLL_X.dataStockBasic }}
                    quickSearch={{ placeholder: '当前页搜索代码/名称/市场', fields: ['symbol', 'name', 'market', 'security_type'], width: 260 }}
                    quickFilters={[{ label: '上市状态', options: [{ label: '上市', value: '上市' }, { label: '退市', value: '退市' }, { label: '暂停', value: '暂停' }], getValue: (record) => record.list_status }]}
                    emptyDescription="暂无股票基础信息，请点击“同步股票”。"
                  />
                </SectionCard>
                <SectionCard title="日K数据" description="原始日 K 分页数据。">
                  <DataTable<DailyKline>
                    rowKey="id"
                    size="small"
                    columns={klineColumns}
                    className="data-table--daily-kline"
                    dataSource={dailyKline}
                    loading={initialTableLoading(dailyKline.length)}
                    pagination={{ current: dailyPage.page, pageSize: dailyPage.pageSize, total: dailyPage.total, showSizeChanger: true }}
                    onChange={(pagination) => setDailyPage({ page: pagination.current ?? 1, pageSize: pagination.pageSize ?? 50, total: dailyPage.total })}
                    data-testid="table-daily-kline"
                    tableLayout="fixed"
                    scroll={{ x: TABLE_SCROLL_X.dataDailyKline }}
                    quickSearch={{ placeholder: '当前页搜索股票/日期', fields: ['symbol', 'trade_date'], width: 240 }}
                    emptyDescription="暂无日 K 数据，请先同步日 K，默认仅查看有限区间。"
                  />
                </SectionCard>
              </Space>
            ),
          },
          {
            key: '基础资料',
            label: '基础资料',
            children: (
              <Space className="data-basic-workbench" direction="vertical" size={8} style={{ width: '100%' }}>
                <Row gutter={[8, 8]}>
                  <Col xs={24} sm={12} xl={6}>
                    <MetricCard label="股票资料" value={`${stockPage.total} 条`} subValue="股票代码、名称、上市状态" icon={<DatabaseOutlined />} tone="blue" />
                  </Col>
                  <Col xs={24} sm={12} xl={6}>
                    <MetricCard label="合约基础" value={`${instrumentPage.total} 条`} subValue="前收、涨跌停、交易状态" icon={<FileSearchOutlined />} tone="green" />
                  </Col>
                  <Col xs={24} sm={12} xl={6}>
                    <MetricCard label="交易日历" value={`${calendarPage.total} 条`} subValue="SH / SZ 官方交易日" icon={<SafetyCertificateOutlined />} tone="orange" />
                  </Col>
                  <Col xs={24} sm={12} xl={6}>
                    <MetricCard label="数据边界" value="普通账户" subValue="不含 Level2 / 信用账户" icon={<ApiOutlined />} tone="neutral" />
                  </Col>
                </Row>
                {renderEvidenceBoard('data-center-evidence-board--basic', 'data-basic-evidence-board', '基础资料证据链', basicEvidenceItems)}

                <Alert
                  type="info"
                  showIcon
                  message="基础资料同步边界"
                  description="本页只接 QMT / MiniQMT 普通股票账户可读的基础资料。涨跌停价优先来自 get_instrument_detail；业务验收以 QMT 官方返回为准。"
                />

                <SectionCard title="基础资料同步" description="先同步股票基础，再同步合约详情和交易日历；所有动作都会创建 task_id。">
                  <div className="market-sync-strip">
                    <Button aria-label="同步股票基础信息" title="同步股票基础信息" icon={<DatabaseOutlined />} loading={syncBusy} disabled={syncBusy} onClick={() => runTask('同步股票', () => createSync('stock_basic'))}>
                      同步股票
                    </Button>
                    <Button aria-label="同步合约基础信息" title="同步合约基础信息" icon={<FileSearchOutlined />} loading={syncBusy} disabled={syncBusy} onClick={() => runTask('同步合约基础', () => createSync('instrument_detail'))}>
                      同步合约基础
                    </Button>
                    <Button aria-label="同步交易日历" title="同步交易日历" icon={<SafetyCertificateOutlined />} loading={syncBusy} disabled={syncBusy} onClick={() => runTask('同步交易日历', () => createSync('trading_calendar'))}>
                      同步交易日历
                    </Button>
                    <Button aria-label="启动 2026 全市场日 K 补齐" title="启动 2026 全市场日 K 补齐" type="primary" icon={<CloudSyncOutlined />} loading={syncBusy} disabled={syncBusy} onClick={confirmRun2026Sync}>
                      全市场日K补齐
                    </Button>
                  </div>
                </SectionCard>

                <SectionCard title="合约基础信息" description="保存前收价、涨跌停价、是否可交易和官方原始 JSON，用于回测可信和交易前提示。">
                  <DataTable<InstrumentDetail>
                    rowKey="id"
                    size="small"
                    columns={instrumentColumns}
                    className="data-table--instrument-detail"
                    dataSource={instrumentDetails}
                    loading={initialTableLoading(instrumentDetails.length)}
                    pagination={{ current: instrumentPage.page, pageSize: instrumentPage.pageSize, total: instrumentPage.total, showSizeChanger: true }}
                    onChange={(pagination) => setInstrumentPage({ page: pagination.current ?? 1, pageSize: pagination.pageSize ?? 50, total: instrumentPage.total })}
                    data-testid="table-instrument-detail"
                    tableLayout="fixed"
                    scroll={{ x: 'max-content' }}
                    quickSearch={{ placeholder: '当前页搜索代码/名称/状态', fields: ['symbol', 'instrument_name', 'exchange_id', 'instrument_status'], width: 280 }}
                    quickFilters={[{ label: '可交易', options: [{ label: '是', value: 'true' }, { label: '否', value: 'false' }], getValue: (record) => String(record.is_trading) }]}
                    emptyDescription="暂无合约基础信息，请先点击“同步合约基础”。"
                  />
                </SectionCard>

                <SectionCard title="交易日历" description="交易日历用于 2026 覆盖率、回测日期门禁和同步任务调度。">
                  <DataTable<TradingCalendarRecord>
                    rowKey="id"
                    size="small"
                    columns={calendarColumns}
                    className="data-table--trading-calendar"
                    dataSource={tradingCalendar}
                    loading={initialTableLoading(tradingCalendar.length)}
                    pagination={{ current: calendarPage.page, pageSize: calendarPage.pageSize, total: calendarPage.total, showSizeChanger: true }}
                    onChange={(pagination) => setCalendarPage({ page: pagination.current ?? 1, pageSize: pagination.pageSize ?? 50, total: calendarPage.total })}
                    data-testid="table-trading-calendar"
                    tableLayout="fixed"
                    scroll={{ x: TABLE_SCROLL_X.dataTradingCalendar }}
                    quickSearch={{ placeholder: '当前页搜索市场/日期/来源', fields: ['market', 'trade_date', 'source'], width: 260 }}
                    quickFilters={[{ label: '市场', options: ['SH', 'SZ', 'BJ'].map((value) => ({ label: value, value })), getValue: (record) => record.market }]}
                    emptyDescription="暂无交易日历，请先点击“同步交易日历”。"
                  />
                </SectionCard>
              </Space>
            ),
          },
          {
            key: '数据同步',
            label: '数据同步',
            children: (
              <div className="data-sync-workbench" data-testid="data-sync-workbench">
                <div className="data-center-evidence-board data-center-evidence-board--sync" data-testid="data-sync-evidence-board" aria-label="数据同步证据链">
                  {syncEvidenceItems.map((item) => (
                    <div className="data-center-evidence-card" key={item.key}>
                      <div className="data-center-evidence-card__head">
                        <Typography.Text type="secondary">{item.label}</Typography.Text>
                        {item.status}
                      </div>
                      <Typography.Text className="data-center-evidence-card__value" strong ellipsis={{ tooltip: item.value }}>{item.value}</Typography.Text>
                      <Typography.Text className="data-center-evidence-card__detail" ellipsis={{ tooltip: item.detail }}>{item.detail}</Typography.Text>
                      <Typography.Text className="data-center-evidence-card__hint" type="secondary" ellipsis={{ tooltip: item.hint }}>{item.hint}</Typography.Text>
                    </div>
                  ))}
                </div>
                <div className="data-sync-workbench__main">
                <SectionCard className="data-sync-entry-card" title="同步卡片矩阵" description="每个同步动作都会创建 task_id；这里不改变同步范围和业务语义。">
                  <div className="data-sync-card-grid">
                    {syncCards.map((card) => {
                      const latestTask = findLatestSyncTask(card.types);
                      const failed = latestTask ? hasSyncFailure(latestTask) : false;
                      return (
                        <div className={['data-sync-card', card.primary ? 'data-sync-card--primary' : '', failed ? 'data-sync-card--failed' : ''].filter(Boolean).join(' ')} key={card.key}>
                          <div className="data-sync-card__head">
                            <span className="data-sync-card__icon">{card.icon}</span>
                            <div>
                              <Typography.Text strong>{card.title}</Typography.Text>
                              <Typography.Text type="secondary">{card.description}</Typography.Text>
                            </div>
                          </div>
                          <div className="data-sync-card__meta">
                            <span>最近状态</span>
                            {latestTask ? statusTag(latestTask.status) : <Tag>暂无</Tag>}
                          </div>
                          <div className="data-sync-card__meta">
                            <span>成功/失败</span>
                            <Typography.Text>
                              {latestTask ? `${latestTask.success_count}/${latestTask.failed_count}` : '--'}
                            </Typography.Text>
                          </div>
                          <Typography.Text className="data-sync-card__time" type="secondary">
                            {latestTask?.finished_at || latestTask?.started_at || '尚未执行'}
                          </Typography.Text>
                          <Button
                            aria-label={`执行${card.title}`}
                            title={`执行${card.title}`}
                            type={card.primary ? 'primary' : 'default'}
                            block
                            loading={loading}
                            disabled={syncBusy}
                            onClick={card.action}
                          >
                            {card.actionLabel || (card.primary ? '立即一键同步' : '开始同步')}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </SectionCard>
                <div ref={currentTaskRef}>
                  <SectionCard className="data-sync-current-card" title="当前任务进度" description="同步任务创建后立即返回 task_id，页面轮询任务状态。">
                    {activeTask ? (
                      <div
                        className={[
                          'data-sync-current-task',
                          focusedTaskId === activeTask.task_id ? 'data-sync-current-task--focused' : '',
                        ].filter(Boolean).join(' ')}
                      >
                        <Space direction="vertical" size={10} style={{ width: '100%' }}>
                          <div className="data-sync-current-task__head">
                            <Space wrap>
                              <Typography.Text strong>{activeTask.task_type}</Typography.Text>
                              {statusTag(activeTask.status)}
                              <Typography.Text copyable type="secondary">{activeTask.task_id}</Typography.Text>
                            </Space>
                            <TaskActionGroup task={activeTask} mode="inline" detailTitle="当前同步任务详情" ariaPrefix="当前同步任务" />
                          </div>
                          <Typography.Text type="secondary">
                            与历史同步任务详情同口径：批次、窗口、目标范围、写入行数、成功/失败股票都会在这里展示。
                          </Typography.Text>
                          <Progress percent={Math.round(activeTask.progress ?? 0)} status={activeTask.status === 'failed' ? 'exception' : undefined} />
                          <Typography.Text>{activeTask.message || '任务正在执行，请等待进度刷新。'}</Typography.Text>
                          {renderTaskDownloadDetail(activeTask.technical_detail, activeTask.message)}
                        </Space>
                      </div>
                    ) : (
                      <div className="data-sync-current-task data-sync-current-task--empty">
                        <Typography.Text strong>当前没有运行中的数据同步任务。</Typography.Text>
                        <Typography.Text type="secondary">点击上方同步卡片后，这里会显示 task_id、进度、状态和中文提示。</Typography.Text>
                      </div>
                    )}
                  </SectionCard>
                </div>
                </div>
                <SectionCard className="data-sync-table-card" title="同步任务" description="同步任务摘要，失败时会保留中文说明和技术详情。">
                  <DataTable<SyncTaskSummary>
                    rowKey="task_id"
                    size="small"
                    columns={syncColumns}
                    className="data-table--sync-tasks"
                    dataSource={syncTasks}
                    loading={initialTableLoading(syncTasks.length)}
                    pagination={{ current: syncPage.page, pageSize: syncPage.pageSize, total: syncPage.total, showSizeChanger: true }}
                    onChange={(pagination) => setSyncPage({ page: pagination.current ?? 1, pageSize: pagination.pageSize ?? 20, total: syncPage.total })}
                    tableLayout="fixed"
                    data-testid="table-sync-tasks"
                    scroll={{ x: 'max-content' }}
                    toolbarTitle="同步任务列表"
                    toolbarDescription="失败时点击“看失败”，可复制中文说明和技术详情给 AI。"
                    updatedAt={updatedAt}
                    onRefresh={() => loadActiveData('数据同步')}
                    quickSearch={{ placeholder: '当前页搜索任务ID/类型', fields: ['task_id', 'sync_type'], width: 260 }}
                    quickFilters={[{ label: '同步状态', options: ['pending', 'running', 'success', 'failed', 'cancelled'].map((value) => ({ label: value, value })), getValue: (record) => record.status }]}
                    emptyDescription="暂无同步任务。点击上方同步按钮后，任务进度会显示在这里。"
                  />
                </SectionCard>
              </div>
            ),
          },
          {
            key: '数据质量',
            label: '数据质量',
            children: (
              <Space className="data-quality-workbench" direction="vertical" size={8} style={{ width: '100%' }}>
                <Row gutter={[8, 8]}>
                  <Col xs={24} md={8}>
                    <MetricCard label="正常" value={`${qualitySummary?.success_count ?? 0} 项`} icon={<CheckCircleOutlined />} tone="green" />
                  </Col>
                  <Col xs={24} md={8}>
                    <MetricCard label="警告" value={`${qualitySummary?.warning_count ?? 0} 项`} icon={<SafetyCertificateOutlined />} tone="orange" />
                  </Col>
                  <Col xs={24} md={8}>
                    <MetricCard label="失败" value={`${qualitySummary?.failed_count ?? 0} 项`} icon={<SafetyCertificateOutlined />} tone={(qualitySummary?.failed_count ?? 0) > 0 ? 'red' : 'neutral'} />
                  </Col>
                </Row>
                <SectionCard
                  title="检查矩阵"
                  description="把数据为空、更新时间、K 线缺失、重复数据、代码格式、委托成交和同步失败放在同一张运维视图里。"
                  extra={
                    <Space wrap>
                      <Button
                        aria-label="导出2026覆盖率缺失清单"
                        title="导出2026覆盖率缺失清单"
                        icon={<DownloadOutlined />}
                        loading={loading}
                        onClick={() => handleExportCoverageMissing()}
                        disabled={loading}
                      >
                        导出缺失清单
                      </Button>
                      <Button aria-label="归档并清理旧同步游标" title="归档并清理旧同步游标" danger={hasLegacyCursorWarning} loading={loading} disabled={loading} onClick={confirmCleanupLegacyCursors}>
                        清理旧游标
                      </Button>
                      <Button aria-label="在检查矩阵开始数据质量检查" title="开始数据质量检查" type="primary" icon={<SafetyCertificateOutlined />} loading={loading} disabled={loading} onClick={() => runTask('质量检查', () => createQualityCheck())}>
                        开始检查
                      </Button>
                    </Space>
                  }
                >
                  {qualitySummary?.is_stale ? (
                    <Alert
                      style={{ marginBottom: 12 }}
                      type="warning"
                      showIcon
                      message="数据质量结果需要重新检查"
                      description={qualitySummary.stale_reason || '当前质量结果可能早于最近一次数据同步，请重新执行检查。'}
                    />
                  ) : null}
                  <div className="quality-matrix-grid">
                    {qualityMatrix.map((item) => (
                      <div className={`quality-check-card quality-check-card--${item.status}`} key={item.key}>
                        <div className="quality-check-card__head">
                          <Typography.Text strong>{item.title}</Typography.Text>
                          {item.status === 'pending' ? <Tag>未检查</Tag> : statusTag(item.status)}
                        </div>
                        <Typography.Text className="quality-check-card__message" type={item.status === 'failed' ? 'danger' : 'secondary'}>
                          {item.focusRecord?.message || `暂无${item.title}异常记录。`}
                        </Typography.Text>
                        <div className="quality-check-card__meta">
                          <span>{item.count} 条相关记录</span>
                          <span>{item.focusRecord?.target_table || '待检查'}</span>
                        </div>
                        <div className="quality-check-card__next">
                          <Typography.Text type="secondary">{item.status === 'success' ? '当前检查项未发现明显异常。' : item.focusRecord?.suggestion || item.nextStep}</Typography.Text>
                        </div>
                        {item.focusRecord ? (
                          <Button size="small" onClick={() => openQualityLog(item.focusRecord)}>
                            看详情
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </SectionCard>
                <SectionCard
                  title="账户快照重复排查"
                  description="只读展示 account_id + snapshot_time 重复分组；这里不自动删除历史数据。"
                  extra={<Tag color={accountDuplicatePage.total > 0 ? 'red' : 'green'}>{accountDuplicatePage.total} 组</Tag>}
                >
                  <Alert
                    type="info"
                    showIcon
                    message="只读排查，不自动清理"
                    description="如果出现重复组，请先核对账户、时间和同步任务；后续如需清理，会单独做备份与人工确认。"
                    style={{ marginBottom: 12 }}
                  />
                  <DataTable<AccountSnapshotDuplicateRecord>
                    rowKey={(record) => `${record.account_id}-${record.snapshot_time}`}
                    size="small"
                    columns={accountDuplicateColumns}
                    className="data-table--account-duplicates"
                    dataSource={accountDuplicates}
                    loading={initialTableLoading(accountDuplicates.length)}
                    pagination={{
                      current: accountDuplicatePage.page,
                      pageSize: accountDuplicatePage.pageSize,
                      total: accountDuplicatePage.total,
                      showSizeChanger: true,
                    }}
                    onChange={(pagination) =>
                      setAccountDuplicatePage({
                        page: pagination.current ?? 1,
                        pageSize: pagination.pageSize ?? 20,
                        total: accountDuplicatePage.total,
                      })
                    }
                    tableLayout="fixed"
                    data-testid="table-account-duplicates"
                    scroll={{ x: TABLE_SCROLL_X.dataAccountDuplicates }}
                    quickSearch={{ placeholder: '当前页搜索账户/时间', fields: ['account_id', 'snapshot_time'], width: 260 }}
                    emptyDescription="未发现 account_id + snapshot_time 重复分组。"
                  />
                </SectionCard>
                <SectionCard
                  title="质量检查"
                  description="检查空数据、过期、重复、缺失和同步失败。"
                  extra={<DataFreshnessTag label="最近检查" updatedAt={qualitySummary?.latest_check_time} />}
                >
                  <Space style={{ marginBottom: 12 }}>
                    <Button aria-label="在质量检查列表开始数据质量检查" title="开始数据质量检查" type="primary" icon={<SafetyCertificateOutlined />} loading={loading} disabled={loading} onClick={() => runTask('质量检查', () => createQualityCheck())}>
                      开始检查
                    </Button>
                    <Button aria-label="归档并清理旧同步游标" title="归档并清理旧同步游标" danger={hasLegacyCursorWarning} loading={loading} disabled={loading} onClick={confirmCleanupLegacyCursors}>
                      清理旧游标
                    </Button>
                  </Space>
                  <DataTable<DataQualityRecord>
                    rowKey="id"
                    size="small"
                    columns={qualityColumns}
                    className="data-table--quality"
                    dataSource={quality}
                    loading={initialTableLoading(quality.length)}
                    pagination={{ current: qualityPage.page, pageSize: qualityPage.pageSize, total: qualityPage.total, showSizeChanger: true }}
                    onChange={(pagination) => setQualityPage({ page: pagination.current ?? 1, pageSize: pagination.pageSize ?? 50, total: qualityPage.total })}
                    tableLayout="fixed"
                    data-testid="table-quality"
                    scroll={{ x: TABLE_SCROLL_X.dataQuality }}
                    quickSearch={{ placeholder: '当前页搜索检查项/表/说明', fields: ['check_type', 'target_table', 'message', 'suggestion'], width: 280 }}
                    quickFilters={[{ label: '检查状态', options: ['success', 'warning', 'failed'].map((value) => ({ label: value, value })), getValue: (record) => record.status }]}
                    emptyDescription="暂无质量检查结果，请点击“开始检查”。"
                  />
                </SectionCard>
              </Space>
            ),
          },
          {
            key: '数据字典',
            label: '数据字典',
            children: (
              <div className="data-dictionary-workbench" data-testid="data-dictionary-workbench">
                <SectionCard
                  className="data-dictionary-index-card"
                  title="表说明复制"
                  description="按表分组整理字段说明，方便直接复制给 AI 写策略。"
                  extra={(
                    <Button
                      aria-label="刷新数据字典表说明"
                      title="刷新数据字典表说明"
                      size="small"
                      icon={<ReloadOutlined />}
                      loading={loading && activeTab === '数据字典'}
                      disabled={loading && activeTab === '数据字典'}
                      onClick={() => void refreshDictionaryData()}
                    >
                      刷新字典
                    </Button>
                  )}
                >
                  <div className="dictionary-index-workbench">
                    <div className="dictionary-index-list" aria-label="数据字典表索引">
                      {dictionaryTableGroups.length > 0 ? (
                        dictionaryTableGroups.map((group) => {
                          const indexedCount = group.fields.filter((field) => field.is_indexed).length;
                          return (
                            <div className="dictionary-index-item" key={group.tableName}>
                              <button
                                type="button"
                                className={`dictionary-index-row${selectedDictionaryGroup?.tableName === group.tableName ? ' dictionary-index-row--active' : ''}`}
                                onClick={() => setSelectedDictionaryTable(group.tableName)}
                              >
                                <span className="dictionary-index-row__main">
                                  <Typography.Text strong>{group.tableName}</Typography.Text>
                                  <Typography.Text type="secondary">
                                    {group.fields.length} 字段 / {indexedCount} 索引
                                  </Typography.Text>
                                </span>
                                <span className="dictionary-index-row__sample">
                                  {group.fields.slice(0, 3).map((field) => field.field_name).join('、') || '暂无示例字段'}
                                </span>
                              </button>
                              <Button
                                aria-label={`复制${group.tableName}表说明给 AI`}
                                title={`复制${group.tableName}表说明给 AI`}
                                size="small"
                                icon={<CopyOutlined />}
                                onClick={() => void copyText('表说明', buildDictionaryTableText(group))}
                              />
                            </div>
                          );
                        })
                      ) : (
                        <div className="dictionary-index-empty">
                          <Typography.Text strong>暂无表说明分组</Typography.Text>
                          <Typography.Text type="secondary">请刷新数据字典列表，或检查后端数据字典服务。</Typography.Text>
                        </div>
                      )}
                    </div>
                    <div className="dictionary-index-detail" aria-label="数据字典字段详情">
                      {selectedDictionaryGroup ? (
                        <>
                          <div className="dictionary-index-detail__head">
                            <div>
                              <Typography.Text strong>{selectedDictionaryGroup.tableName}</Typography.Text>
                              <Typography.Text type="secondary">
                                {selectedDictionaryGroup.fields.length} 个字段，{selectedDictionaryGroup.fields.filter((field) => field.is_indexed).length} 个查询索引
                              </Typography.Text>
                            </div>
                            <Button
                              aria-label={`复制${selectedDictionaryGroup.tableName}完整字段说明给 AI`}
                              title={`复制${selectedDictionaryGroup.tableName}完整字段说明给 AI`}
                              size="small"
                              icon={<CopyOutlined />}
                              onClick={() => void copyText('表说明', buildDictionaryTableText(selectedDictionaryGroup))}
                            >
                              复制当前表
                            </Button>
                          </div>
                          <div className="dictionary-field-list">
                            {selectedDictionaryGroup.fields.map((field) => (
                              <div className="dictionary-field-row" key={`${field.table_name}-${field.field_name}`}>
                                <div className="dictionary-field-row__meta">
                                  <Typography.Text strong>{field.field_name}</Typography.Text>
                                  <Tag>{field.field_type}</Tag>
                                  {field.is_indexed ? <Tag color="blue">索引</Tag> : null}
                                </div>
                                <Typography.Text type="secondary">{field.description}</Typography.Text>
                                <div className="dictionary-field-row__foot">
                                  <span>单位：{field.unit || '无'}</span>
                                  <span>示例：{field.example_value ?? '暂无'}</span>
                                  <span>策略：{field.strategy_usage || '暂无'}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <div className="dictionary-index-empty">
                          <Typography.Text strong>暂无字段详情</Typography.Text>
                          <Typography.Text type="secondary">刷新后可在这里查看表字段、示例和策略使用说明。</Typography.Text>
                        </div>
                      )}
                    </div>
                  </div>
                </SectionCard>
                <SectionCard
                  className="data-dictionary-table-card"
                  title="数据字典"
                  description={`字段中文含义、示例值和策略可用说明，可复制给 AI 写策略。当前共 ${dictionaryPage.total || dictionary.length} 个字段说明。`}
                >
                  <DataTable<DataDictionaryRecord>
                    rowKey="id"
                    size="small"
                    columns={dictionaryColumns}
                    className="data-table--dictionary"
                    dataSource={dictionary}
                    loading={initialTableLoading(dictionary.length)}
                    pagination={{ current: dictionaryPage.page, pageSize: dictionaryPage.pageSize, total: dictionaryPage.total, showSizeChanger: true }}
                    onChange={(pagination) => setDictionaryPage({ page: pagination.current ?? 1, pageSize: pagination.pageSize ?? 50, total: dictionaryPage.total })}
                    tableLayout="fixed"
                    data-testid="table-dictionary"
                    onRefresh={() => void refreshDictionaryData()}
                    scroll={{ x: 'max-content' }}
                    quickSearch={{ placeholder: '当前页搜索表名/字段/含义/策略说明', fields: ['table_name', 'field_name', 'description', 'example_value', 'unit', 'strategy_usage'], width: 320 }}
                    quickFilters={[
                      { label: '是否索引', options: [{ label: '已索引', value: 'true' }, { label: '未索引', value: 'false' }], getValue: (record) => String(record.is_indexed) },
                      {
                        label: '策略使用',
                        options: [
                          { label: '策略可读', value: 'strategy_readable' },
                          { label: '只读参考', value: 'readonly_reference' },
                          { label: '不建议使用', value: 'not_recommended' },
                        ],
                        getValue: dictionaryStrategyCategory,
                      },
                    ]}
                    emptyDescription="暂无数据字典记录，请先点击刷新字典；如果仍为空，请检查后端数据字典接口。"
                    emptyAction={(
                      <Button
                        aria-label="空状态刷新数据字典"
                        title="空状态刷新数据字典"
                        size="small"
                        icon={<ReloadOutlined />}
                        loading={loading && activeTab === '数据字典'}
                        disabled={loading && activeTab === '数据字典'}
                        onClick={() => void refreshDictionaryData()}
                      >
                        刷新数据字典
                      </Button>
                    )}
                  />
                </SectionCard>
              </div>
            ),
          },
        ]}
      />

      <ErrorDetailModal
        open={Boolean(errorState)}
        message={errorState?.message ?? ''}
        error={errorState?.error}
        traceId={errorState?.traceId}
        onClose={() => setErrorState(null)}
      />

      <LogDrawer
        open={Boolean(logDrawer)}
        title={logDrawer?.title ?? '详情'}
        subtitle={logDrawer?.subtitle}
        status={logDrawer?.status}
        statusTone={logDrawer?.statusTone}
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
