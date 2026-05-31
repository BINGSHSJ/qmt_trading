import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircleOutlined,
  CopyOutlined,
  DatabaseOutlined,
  DownloadOutlined,
  FileSearchOutlined,
  LineChartOutlined,
  PlayCircleOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { Alert, App, Button, Checkbox, Col, Descriptions, Form, Input, InputNumber, Row, Select, Space, Tabs, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useSearchParams } from 'react-router-dom';
import BacktestChart from '../../components/BacktestChart';
import CommandPanel from '../../components/CommandPanel';
import DataTable from '../../components/DataTable';
import DataFreshnessTag from '../../components/DataFreshnessTag';
import EmptyGuide from '../../components/EmptyGuide';
import ErrorDetailModal from '../../components/ErrorDetailModal';
import FinancialNumber from '../../components/FinancialNumber';
import LogDrawer from '../../components/LogDrawer';
import MetricCard from '../../components/MetricCard';
import PageHeader from '../../components/PageHeader';
import RiskConfirmContent from '../../components/RiskConfirmContent';
import SectionCard from '../../components/SectionCard';
import TableActionGroup from '../../components/TableActionGroup';
import TaskProgress from '../../components/TaskProgress';
import WorkbenchNav, { type WorkbenchNavItem } from '../../components/WorkbenchNav';
import { useTaskPolling } from '../../hooks/useTaskPolling';
import { useUrlSyncedTab } from '../../hooks/useUrlSyncedTab';
import {
  cancelBacktest,
  checkBacktestData,
  createBacktest,
  deleteBacktest,
  exportBacktestWorkbook,
  getBacktestEquity,
  getBacktestLogs,
  getBacktestReport,
  getBacktestResult,
  getBacktestSignals,
  getBacktestTrades,
  getBacktests,
} from '../../services/backtest';
import { RequestError } from '../../services/request';
import { copyExampleStrategy, getStrategyFiles } from '../../services/strategyDev';
import { defaultPageState, type PageState } from '../../types/api';
import type {
  BacktestCreateRequest,
  BacktestDataCheckResult,
  BacktestEquityRecord,
  BacktestLogRecord,
  BacktestManifestRecord,
  BacktestResultRecord,
  BacktestSignalRecord,
  BacktestStrategySnapshotCheck,
  BacktestTaskRecord,
  BacktestTradeRecord,
} from '../../types/backtest';
import type { StrategyFileRecord } from '../../types/strategyDev';
import type { RuntimeTaskRecord, TaskCreated } from '../../types/system';
import { writeTextToClipboard } from '../../utils/clipboard';
import { formatMoney, formatMoneyByUnit, formatPercent, formatPrice, formatQuantity, formatSide, formatStatusLabel, formatStockLabel, getSideColor, getStatusColor } from '../../utils/format';
import { TABLE_COL, TABLE_SCROLL_X } from '../../utils/tableColumns';
import { formatNow } from '../../utils/time';
import {
  type BacktestTabKey,
  type ErrorState,
  type LogDrawerState,
  type StockTradeChainState,
  backtestTabKeys,
  buildBacktestName,
  buildStockSignalChainStats,
  buildStockTradeChainStats,
  buildTradeAuditStats,
  formatBacktestQmtMode,
  formatStrategySelectLabel,
  getLowCoverageWarning,
  initialFormValues,
  isMinuteStrategy,
  parseManifestJson,
  pickDefaultStrategy,
  renderAuditText,
  sortSignalsByTime,
  sortTradesByTime,
} from './backtestResearchHelpers';
import './BacktestResearch.css';

const BACKTEST_WORKBENCH_PAGE_SIZE = 5;
const BACKTEST_LOG_PAGE_SIZE = 2;
const createBacktestPageState = (): PageState => ({
  ...defaultPageState,
  pageSize: BACKTEST_WORKBENCH_PAGE_SIZE,
});
const createBacktestLogPageState = (): PageState => ({
  ...defaultPageState,
  pageSize: BACKTEST_LOG_PAGE_SIZE,
});

function formatManifestCount(value: number | null | undefined, suffix = '') {
  return typeof value === 'number' ? `${value.toLocaleString('zh-CN')}${suffix}` : '未记录';
}

function formatManifestBoolean(value: boolean | null | undefined, enabledLabel = '启用', disabledLabel = '未启用') {
  return value ? enabledLabel : disabledLabel;
}

function formatCoverageDataType(value: string | null | undefined) {
  if (value === 'minute_kline') return '分钟K覆盖';
  if (value === 'daily_kline') return '日K覆盖';
  return value || '未知覆盖';
}

function formatCoverageStatus(value: string | null | undefined) {
  if (value === 'complete') return 'complete 完整';
  if (value === 'partial') return 'partial 部分';
  if (value === 'missing') return 'missing 缺失';
  return value || '未记录';
}

function formatCoverageMatchMode(value: string | null | undefined) {
  if (value === 'covering_range') return '大区间覆盖';
  if (value === 'exact_range') return '精确区间';
  return value || '未记录';
}

export default function BacktestResearch() {
  const { message, modal } = App.useApp();
  const [searchParams, setSearchParams] = useSearchParams();
  const [form] = Form.useForm<BacktestCreateRequest>();
  const [strategies, setStrategies] = useState<StrategyFileRecord[]>([]);
  const [tasks, setTasks] = useState<BacktestTaskRecord[]>([]);
  const [activeTask, setActiveTask] = useState<RuntimeTaskRecord | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResultRecord | null>(null);
  const [manifest, setManifest] = useState<BacktestManifestRecord | null>(null);
  const [strategySnapshotCheck, setStrategySnapshotCheck] = useState<BacktestStrategySnapshotCheck | null>(null);
  const [equity, setEquity] = useState<BacktestEquityRecord[]>([]);
  const [trades, setTrades] = useState<BacktestTradeRecord[]>([]);
  const [focusedTrade, setFocusedTrade] = useState<BacktestTradeRecord | null>(null);
  const [previewTrade, setPreviewTrade] = useState<BacktestTradeRecord | null>(null);
  const [previewEquity, setPreviewEquity] = useState<BacktestEquityRecord | null>(null);
  const [selectedEquityDate, setSelectedEquityDate] = useState<string | null>(null);
  const [stockTradeChain, setStockTradeChain] = useState<StockTradeChainState | null>(null);
  const [signalAudits, setSignalAudits] = useState<BacktestSignalRecord[]>([]);
  const [logs, setLogs] = useState<BacktestLogRecord[]>([]);
  const [officialLogs, setOfficialLogs] = useState<BacktestLogRecord[]>([]);
  const [taskPage, setTaskPage] = useState<PageState>(createBacktestPageState);
  const [tradePage, setTradePage] = useState<PageState>(createBacktestPageState);
  const [signalPage, setSignalPage] = useState<PageState>(createBacktestPageState);
  const [logPage, setLogPage] = useState<PageState>(createBacktestLogPageState);
  const [tradeSearchInput, setTradeSearchInput] = useState('');
  const [tradeKeyword, setTradeKeyword] = useState('');
  const [tradeSideFilter, setTradeSideFilter] = useState<string | undefined>();
  const [signalSearchInput, setSignalSearchInput] = useState('');
  const [signalKeyword, setSignalKeyword] = useState('');
  const [signalStatusFilter, setSignalStatusFilter] = useState<string | undefined>();
  const [logSearchInput, setLogSearchInput] = useState('');
  const [logKeyword, setLogKeyword] = useState('');
  const [logLevelFilter, setLogLevelFilter] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [checkingData, setCheckingData] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(formatNow());
  const [errorState, setErrorState] = useState<ErrorState | null>(null);
  const [logDrawer, setLogDrawer] = useState<LogDrawerState | null>(null);
  const [dataCheck, setDataCheck] = useState<BacktestDataCheckResult | null>(null);
  const [activeTab, setActiveTab] = useUrlSyncedTab<BacktestTabKey>(backtestTabKeys, '回测任务');
  const strategyParam = searchParams.get('strategy_id');
  const autoBacktestNameRef = useRef(initialFormValues.backtest_name);
  const consumedStrategyParamRef = useRef<string | null>(null);
  const watchedStrategyId = Form.useWatch('strategy_id', form);
  const watchedStartDate = Form.useWatch('start_date', form);
  const watchedEndDate = Form.useWatch('end_date', form);
  const watchedFrequency = Form.useWatch('data_frequency', form);
  const minuteFrequencySelected = watchedFrequency === '分钟K';
  const watchedStrategy = strategies.find((item) => item.id === watchedStrategyId);
  const generatedBacktestName = useMemo(
    () => buildBacktestName(watchedStrategy?.strategy_name, watchedStartDate, watchedEndDate, watchedFrequency),
    [watchedEndDate, watchedFrequency, watchedStartDate, watchedStrategy?.strategy_name],
  );

  const setStrategyId = useCallback(
    (strategyId: number) => {
      form.setFieldValue('strategy_id', strategyId);
    },
    [form],
  );

  const showError = useCallback((fallback: string, error: unknown) => {
    if (error instanceof RequestError) {
      setErrorState({ message: error.message, error: error.apiError, traceId: error.traceId });
    } else {
      setErrorState({ message: fallback, error: { code: 'UNKNOWN', detail: String(error) } });
    }
  }, []);

  const clearTaskDetails = useCallback((preserveTradeFocus = false) => {
    setResult(null);
    setManifest(null);
    setStrategySnapshotCheck(null);
    setEquity([]);
    setTrades([]);
    if (!preserveTradeFocus) {
      setFocusedTrade(null);
      setPreviewTrade(null);
      setPreviewEquity(null);
      setSelectedEquityDate(null);
      setStockTradeChain(null);
    }
    setSignalAudits([]);
    setLogs([]);
    setOfficialLogs([]);
  }, []);

  const clearFocusedTrade = useCallback(() => {
    setFocusedTrade(null);
    setPreviewTrade(null);
    setPreviewEquity(null);
    setSelectedEquityDate(null);
    setStockTradeChain(null);
  }, []);

  const commitTradeKeyword = useCallback((value: string) => {
    setTradeKeyword(value.trim());
    setTradePage((previous) => ({ ...previous, page: 1 }));
  }, []);

  const commitSignalKeyword = useCallback((value: string) => {
    setSignalKeyword(value.trim());
    setSignalPage((previous) => ({ ...previous, page: 1 }));
  }, []);

  const commitLogKeyword = useCallback((value: string) => {
    setLogKeyword(value.trim());
    setLogPage((previous) => ({ ...previous, page: 1 }));
  }, []);

  const handleTradeSearchInputChange = useCallback((value: string) => {
    setTradeSearchInput(value);
    if (!value.trim() && tradeKeyword) {
      commitTradeKeyword('');
    }
  }, [commitTradeKeyword, tradeKeyword]);

  const handleSignalSearchInputChange = useCallback((value: string) => {
    setSignalSearchInput(value);
    if (!value.trim() && signalKeyword) {
      commitSignalKeyword('');
    }
  }, [commitSignalKeyword, signalKeyword]);

  const handleLogSearchInputChange = useCallback((value: string) => {
    setLogSearchInput(value);
    if (!value.trim() && logKeyword) {
      commitLogKeyword('');
    }
  }, [commitLogKeyword, logKeyword]);

  const loadDetails = useCallback(
    async (taskId: string) => {
      clearTaskDetails(true);
      try {
        const [nextReport, nextResult, nextEquity, nextTrades, nextSignals, nextLogs, nextOfficialLogs] = await Promise.all([
          getBacktestReport(taskId),
          getBacktestResult(taskId),
          getBacktestEquity(taskId),
          getBacktestTrades(taskId, {
            ...tradePage,
            keyword: tradeKeyword || undefined,
            status: tradeSideFilter,
            startDate: selectedEquityDate ?? undefined,
            endDate: selectedEquityDate ?? undefined,
            sortField: selectedEquityDate ? 'trade_time' : undefined,
            sortOrder: selectedEquityDate ? 'asc' : undefined,
          }),
          getBacktestSignals(taskId, {
            ...signalPage,
            keyword: signalKeyword || undefined,
            status: signalStatusFilter,
            startDate: selectedEquityDate ?? undefined,
            endDate: selectedEquityDate ?? undefined,
            sortField: selectedEquityDate ? 'signal_time' : undefined,
            sortOrder: selectedEquityDate ? 'asc' : undefined,
          }),
          getBacktestLogs(taskId, { ...logPage, keyword: logKeyword || undefined, status: logLevelFilter }),
          getBacktestLogs(taskId, { page: 1, pageSize: 20, keyword: '官方路径', sortField: 'created_at', sortOrder: 'asc' }),
        ]);
        setResult(nextResult);
        setManifest(nextReport.manifest ?? null);
        setStrategySnapshotCheck(nextReport.strategy_snapshot_check ?? null);
        setEquity(nextEquity);
        setTrades(nextTrades.items);
        const nextEquityExists = (record: BacktestEquityRecord | null) => Boolean(
          record && nextEquity.some((item) => item.trade_date === record.trade_date && item.backtest_id === record.backtest_id),
        );
        const nextTradeExists = (record: BacktestTradeRecord | null) => Boolean(
          record && nextTrades.items.some((item) => item.id === record.id && item.backtest_id === record.backtest_id),
        );
        setFocusedTrade((previous) => (nextTradeExists(previous) ? previous : null));
        setPreviewTrade((previous) => (nextTradeExists(previous) ? previous : null));
        setPreviewEquity((previous) => (nextEquityExists(previous) ? previous : null));
        setSelectedEquityDate((previous) => (
          previous && nextEquity.some((item) => item.trade_date === previous) ? previous : null
        ));
        setStockTradeChain((previous) => (
          previous && nextTrades.items.some((item) => item.symbol === previous.symbol) ? previous : null
        ));
        setTradePage((previous) => (previous.total === nextTrades.total ? previous : { ...previous, total: nextTrades.total }));
        setSignalAudits(nextSignals.items);
        setSignalPage((previous) => (previous.total === nextSignals.total ? previous : { ...previous, total: nextSignals.total }));
        setLogs(nextLogs.items);
        setOfficialLogs(nextOfficialLogs.items);
        setLogPage((previous) => (previous.total === nextLogs.total ? previous : { ...previous, total: nextLogs.total }));
        setSelectedTaskId(taskId);
      } catch (error) {
        showError('加载回测详情失败', error);
      }
    },
    [clearTaskDetails, logKeyword, logLevelFilter, logPage, selectedEquityDate, showError, signalKeyword, signalPage, signalStatusFilter, tradeKeyword, tradePage, tradeSideFilter],
  );

  const openTaskDetails = useCallback(
    async (record: BacktestTaskRecord) => {
      await loadDetails(record.task_id);
      setActiveTab(record.status === 'success' ? '绩效结果' : '回测日志');
    },
    [loadDetails, setActiveTab],
  );

  const loadAll = useCallback(async (focusTaskId?: string) => {
    setLoading(true);
    try {
      const [strategyPage, taskResult] = await Promise.all([getStrategyFiles(), getBacktests(taskPage)]);
      setStrategies(strategyPage.items);
      setTasks(taskResult.items);
      setTaskPage((previous) => (previous.total === taskResult.total ? previous : { ...previous, total: taskResult.total }));
      const requestedStrategyId = Number(strategyParam);
      if (strategyParam && consumedStrategyParamRef.current !== strategyParam) {
        const linkedStrategy = strategyPage.items.find((item) => item.id === requestedStrategyId);
        consumedStrategyParamRef.current = strategyParam;
        if (linkedStrategy) {
          setStrategyId(linkedStrategy.id);
          autoBacktestNameRef.current = initialFormValues.backtest_name;
          setActiveTab('新建回测');
          message.info(`已带入策略：${linkedStrategy.strategy_name} / ${linkedStrategy.file_name}`);
        } else {
          const defaultStrategy = pickDefaultStrategy(strategyPage.items, form.getFieldValue('data_frequency'));
          if (defaultStrategy) {
            setStrategyId(defaultStrategy.id);
          }
          message.warning(`未找到策略 ID ${strategyParam}，已按当前数据频率选择默认策略。`);
        }
        setSearchParams((previous) => {
          const nextParams = new URLSearchParams(previous);
          nextParams.delete('strategy_id');
          return nextParams;
        }, { replace: true });
      } else if (!form.getFieldValue('strategy_id') && strategyPage.items.length > 0) {
        const defaultStrategy = pickDefaultStrategy(strategyPage.items, form.getFieldValue('data_frequency'));
        if (defaultStrategy) {
          setStrategyId(defaultStrategy.id);
        }
      }
      const nextTaskId = focusTaskId ?? selectedTaskId ?? taskResult.items[0]?.task_id;
      if (nextTaskId) {
        await loadDetails(nextTaskId);
      }
      setUpdatedAt(formatNow());
    } catch (error) {
      showError('加载回测研究失败', error);
    } finally {
      setLoading(false);
    }
  }, [form, loadDetails, message, selectedTaskId, setActiveTab, setSearchParams, setStrategyId, showError, strategyParam, taskPage]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    const currentName = form.getFieldValue('backtest_name');
    if (!currentName || currentName === initialFormValues.backtest_name || currentName === autoBacktestNameRef.current) {
      form.setFieldValue('backtest_name', generatedBacktestName);
      autoBacktestNameRef.current = generatedBacktestName;
    }
  }, [form, generatedBacktestName]);

  useTaskPolling({
    task: activeTask,
    onTaskChange: setActiveTask,
    onFinished: async (task) => {
      setSelectedTaskId(task.task_id);
      await loadAll(task.task_id);
      await loadDetails(task.task_id);
    },
    onError: (error) => showError('刷新回测任务失败', error),
    intervalMs: 2000,
  });

  const setCreatedTask = async (task: TaskCreated) => {
    setActiveTask({ ...task, created_at: formatNow() });
    setSelectedTaskId(task.task_id);
    clearTaskDetails();
    setActiveTab('回测任务');
  };

  const handleCreate = async (values: BacktestCreateRequest) => {
    const payload = { ...values, ...form.getFieldsValue(true) } as BacktestCreateRequest;
    if (payload.data_frequency === '分钟K' && payload.fill_mode !== '正式分钟回放') {
      payload.fill_mode = '正式分钟回放';
      form.setFieldValue('fill_mode', '正式分钟回放');
      message.info('分钟K回测已强制切换为正式分钟回放。');
    }
    if (!payload.strategy_id) {
      message.warning('请先选择策略。');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(payload.end_date)) {
      message.warning('回测日期格式必须为 YYYY-MM-DD。');
      return;
    }
    if (payload.start_date > payload.end_date) {
      message.warning('开始日期不能晚于结束日期。');
      return;
    }
    const strategy = strategies.find((item) => item.id === payload.strategy_id);
    let latestCheck: BacktestDataCheckResult | null = null;
    try {
      latestCheck = await checkBacktestData({
        strategy_id: payload.strategy_id,
        start_date: payload.start_date,
        end_date: payload.end_date,
        data_frequency: payload.data_frequency,
        fill_mode: payload.fill_mode,
      });
      setDataCheck(latestCheck);
      if (!latestCheck.ok) {
        message.warning(latestCheck.suggestion ? `${latestCheck.message} ${latestCheck.suggestion}` : latestCheck.message);
        return;
      }
    } catch (error) {
      showError('检查回测数据失败', error);
      return;
    }
    const lowCoverageWarning = getLowCoverageWarning(latestCheck);
    let lowCoverageAccepted = false;
    modal.confirm({
      className: 'backtest-confirm-modal',
      width: 720,
      centered: true,
      maskClosable: false,
      title: '确认创建回测',
      content: (
        <RiskConfirmContent
          level="warning"
          summary="请确认本次实际提交到后端的回测参数。"
          objectLabel={strategy?.strategy_name ?? String(payload.strategy_id)}
          riskItems={[
            '回测会严格按下方区间创建任务；如果这里不是你要的日期，请取消后重新填写。',
            '这是基于本地 SQLite 已落库行情的本地撮合回测，不会调用真实 QMT 下单接口。',
            '回测任务创建后，任务列表中的“区间”应与这里完全一致。',
            ...(lowCoverageWarning ? [lowCoverageWarning] : []),
          ]}
          details={[
            { label: '策略', value: strategy?.strategy_name ?? String(payload.strategy_id) },
            { label: '策略文件', value: strategy?.file_name ?? '暂无' },
            { label: '策略版本', value: strategy?.version ?? '暂无' },
            { label: '提交区间', value: `${payload.start_date} ~ ${payload.end_date}` },
            { label: '数据频率', value: payload.data_frequency },
            { label: '成交模式', value: payload.fill_mode },
            { label: '初始资金', value: formatMoney(payload.initial_cash) },
            { label: '单笔金额', value: formatMoney(payload.single_order_amount) },
          ]}
          nextStep="创建后请在任务列表核对策略、日期区间和数据频率，再进入绩效结果查看曲线、明细和日志。"
        >
          {lowCoverageWarning ? (
            <Checkbox onChange={(event) => { lowCoverageAccepted = event.target.checked; }}>
              我了解覆盖率不足，结果可能失真，仍只作为技术验证。
            </Checkbox>
          ) : null}
        </RiskConfirmContent>
      ),
      okText: '确认创建',
      cancelText: '取消',
      onOk: async () => {
        if (lowCoverageWarning && !lowCoverageAccepted) {
          message.warning('请先勾选覆盖率不足确认项。');
          return Promise.reject();
        }
        setLoading(true);
        try {
          const task = await createBacktest(payload);
          message.success(`回测任务已创建：${payload.start_date} ~ ${payload.end_date}`);
          await setCreatedTask(task);
        } catch (error) {
          showError('创建回测失败', error);
        } finally {
          setLoading(false);
        }
      },
    });
  };

  const handleCheckData = async () => {
    if (checkingData) return;
    setCheckingData(true);
    try {
      const values = await form.validateFields(['strategy_id', 'start_date', 'end_date', 'data_frequency', 'fill_mode']);
      const check = await checkBacktestData(values);
      if (!check.ok && values.data_frequency !== '分钟K' && check.technical_detail?.includes('strategy_requires_minute_bars=true')) {
        const retryValues = { ...values, data_frequency: '分钟K', fill_mode: '正式分钟回放' };
        form.setFieldValue('data_frequency', '分钟K');
        form.setFieldValue('fill_mode', '正式分钟回放');
        const minuteCheck = await checkBacktestData(retryValues);
        setDataCheck(minuteCheck);
        if (minuteCheck.ok) {
          message.success(`已自动切换为分钟K：${minuteCheck.message}`);
        } else {
          message.warning(minuteCheck.suggestion ? `${minuteCheck.message} ${minuteCheck.suggestion}` : minuteCheck.message);
        }
        return;
      }
      setDataCheck(check);
      if (check.ok) {
        message.success(check.message);
      } else {
        message.warning(check.suggestion ? `${check.message} ${check.suggestion}` : check.message);
      }
    } catch (error) {
      showError('检查回测数据失败', error);
    } finally {
      setCheckingData(false);
    }
  };

  const handleFrequencyChange = (value: string) => {
    setDataCheck(null);
    if (value === '分钟K') {
      form.setFieldValue('fill_mode', '正式分钟回放');
      const currentStrategy = strategies.find((strategy) => strategy.id === form.getFieldValue('strategy_id'));
      if (currentStrategy && !isMinuteStrategy(currentStrategy)) {
        const minuteStrategy = strategies.find(isMinuteStrategy);
        if (minuteStrategy) {
          form.setFieldValue('strategy_id', minuteStrategy.id);
          message.info(`已切换到分钟策略：${minuteStrategy.strategy_name}`);
        }
      }
    } else if (['下一分钟成交', '正式分钟回放'].includes(form.getFieldValue('fill_mode'))) {
      form.setFieldValue('fill_mode', '下一日开盘');
    }
  };

  const handleCopyExample = async () => {
    setLoading(true);
    try {
      const strategy = await copyExampleStrategy();
      message.success('示例策略已复制');
      setStrategyId(strategy.id);
      await loadAll();
    } catch (error) {
      showError('复制示例策略失败', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!selectedTaskId) return;
    try {
      await cancelBacktest(selectedTaskId);
      await loadAll();
      message.success('取消请求已处理');
    } catch (error) {
      showError('取消回测失败', error);
    }
  };

  const handleUseTaskTemplate = (record: BacktestTaskRecord) => {
    const currentStartDate = form.getFieldValue('start_date') || initialFormValues.start_date;
    const currentEndDate = form.getFieldValue('end_date') || initialFormValues.end_date;
    form.setFieldsValue({
      strategy_id: record.strategy_id,
      backtest_name: `${record.backtest_name} 复用`,
      start_date: currentStartDate,
      end_date: currentEndDate,
      initial_cash: record.initial_cash,
      single_order_amount: record.single_order_amount,
      data_frequency: record.data_frequency,
      fill_mode: record.data_frequency === '分钟K' ? '正式分钟回放' : record.fill_mode,
      fee_rate: record.fee_rate,
      stamp_tax_rate: record.stamp_tax_rate,
      slippage: record.slippage,
    });
    setDataCheck(null);
    setActiveTab('新建回测');
    message.info(`已复用历史任务的策略、资金和成交规则；日期保持当前表单：${currentStartDate} ~ ${currentEndDate}。`);
  };

  const handleExport = (taskId: string) => {
    const exportTarget = tasks.find((task) => task.task_id === taskId);
    const isCurrentReport = selectedTaskId === taskId;
    const currentReportTask = selectedTaskId ? tasks.find((task) => task.task_id === selectedTaskId) : null;
    const exportRange = exportTarget ? `${exportTarget.start_date} ~ ${exportTarget.end_date}` : '暂无';
    const currentRange = currentReportTask ? `${currentReportTask.start_date} ~ ${currentReportTask.end_date}` : '未打开报告';
    const loadedTradeCount = isCurrentReport ? (tradePage.total || trades.length) : null;
    const loadedSignalCount = isCurrentReport ? (signalPage.total || signalAudits.length) : null;
    const loadedLogCount = isCurrentReport ? (logPage.total || logs.length) : null;
    let exportConfirm: ReturnType<typeof modal.confirm> | null = null;
    const handleReviewBeforeExport = () => {
      exportConfirm?.destroy();
      if (!exportTarget) {
        message.warning('未找到该回测任务，无法先查看报告。');
        return;
      }
      void openTaskDetails(exportTarget);
      message.info('已切换到该任务报告，请核对日期、策略和明细后再导出。');
    };
    exportConfirm = modal.confirm({
      className: 'backtest-confirm-modal',
      width: 720,
      centered: true,
      maskClosable: false,
      title: isCurrentReport ? '导出回测记录' : '导出历史回测记录',
      content: (
        <RiskConfirmContent
          level="warning"
          summary={isCurrentReport ? '即将导出当前正在查看的完整工作簿。' : '导出任务与当前页面报告不一致，请先确认。'}
          objectLabel={exportTarget?.backtest_name ?? taskId}
          riskItems={[
            '导出只读取本地 SQLite 已生成的回测结果，不会重新运行策略，也不会调用真实 QMT 交易接口。',
            '工作簿包含任务摘要、绩效、交易明细、信号审计和日志，适合做复盘核对。',
            '如果任务仍在运行或已失败，请先查看任务日志确认结果是否可用于分析。',
            isCurrentReport ? '当前页面报告与导出任务一致，可以继续核对后导出。' : '当前页面报告与导出任务不一致：建议先查看报告；若你确定要导出历史任务，可点击“继续导出”。',
          ]}
          details={[
            { label: '一致性', value: <Tag color={isCurrentReport ? 'green' : 'orange'}>{isCurrentReport ? '当前报告' : '非当前报告'}</Tag> },
            { label: '当前页面任务', value: selectedTaskId ?? '未选择' },
            { label: '任务 ID', value: taskId },
            { label: '回测名称', value: exportTarget?.backtest_name ?? '当前选中任务' },
            { label: '策略', value: exportTarget?.strategy_name ?? '暂无' },
            { label: '导出区间', value: exportRange },
            { label: '当前页面区间', value: currentRange },
            { label: '状态', value: exportTarget ? formatStatusLabel(exportTarget.status) : '暂无' },
            { label: '页面成交数', value: loadedTradeCount === null ? '未加载该任务' : `${loadedTradeCount} 条` },
            { label: '页面信号数', value: loadedSignalCount === null ? '未加载该任务' : `${loadedSignalCount} 条` },
            { label: '页面日志数', value: loadedLogCount === null ? '未加载该任务' : `${loadedLogCount} 条` },
          ]}
          nextStep={isCurrentReport ? '导出后优先核对任务摘要、交易明细和信号审计三个 Sheet，确认日期区间与页面一致。' : '建议点击“先查看报告”，让页面证据与导出对象对齐后再导出。'}
        >
          <div className="backtest-export-consistency" data-testid="backtest-export-consistency">
            <div className={`backtest-export-consistency__item ${isCurrentReport ? 'backtest-export-consistency__item--ok' : 'backtest-export-consistency__item--warn'}`}>
              <span>页面与导出</span>
              <strong>{isCurrentReport ? '一致' : '不一致'}</strong>
              <small>{isCurrentReport ? '导出的是当前正在查看的报告。' : '请确认你确实要导出列表中的另一个任务。'}</small>
            </div>
            <div className="backtest-export-consistency__item">
              <span>导出任务</span>
              <strong>{exportTarget?.strategy_name ?? '暂无策略'}</strong>
              <small>{exportRange}</small>
            </div>
            <div className="backtest-export-consistency__item">
              <span>页面证据</span>
              <strong>{loadedSignalCount === null ? '未加载' : `${loadedSignalCount} 信号 / ${loadedTradeCount} 成交`}</strong>
              <small>{loadedLogCount === null ? '请先查看报告以核对页面证据。' : `${loadedLogCount} 条日志可辅助排查。`}</small>
            </div>
          </div>
          <div className={`backtest-export-actions ${isCurrentReport ? 'backtest-export-actions--ok' : 'backtest-export-actions--warn'}`}>
            <div className="backtest-export-actions__copy">
              <strong>{isCurrentReport ? '页面证据已对齐' : '建议先对齐页面证据'}</strong>
              <span>{isCurrentReport ? '当前报告、任务 ID 和导出对象一致。' : '先打开该任务报告，确认日期、策略、交易明细和日志后再导出。'}</span>
            </div>
            {!isCurrentReport && (
              <Button size="small" onClick={handleReviewBeforeExport}>
                先查看报告
              </Button>
            )}
          </div>
        </RiskConfirmContent>
      ),
      okText: isCurrentReport ? '确认导出' : '继续导出',
      cancelText: '取消',
      onOk: async () => {
        try {
          const filename = await exportBacktestWorkbook(taskId);
          message.success(`已下载回测记录：${filename}`);
        } catch (error) {
          showError('导出回测记录失败', error);
        }
      },
    });
  };

  const copyBacktestTaskSummary = async (record: BacktestTaskRecord) => {
    try {
      await writeTextToClipboard(JSON.stringify({
        module: '回测研究',
        source_page: '回测研究 / 回测任务',
        task_id: record.task_id,
        backtest_name: record.backtest_name,
        strategy_name: record.strategy_name,
        range: `${record.start_date}~${record.end_date}`,
        data_frequency: record.data_frequency,
        fill_mode: record.fill_mode,
        status: record.status,
        created_at: record.created_at,
      }, null, 2));
      message.success('回测任务摘要已复制');
    } catch {
      message.error('回测任务摘要复制失败，请手动复制任务 ID。');
    }
  };

  const handleDelete = (record: BacktestTaskRecord) => {
    modal.confirm({
      className: 'backtest-confirm-modal',
      width: 720,
      centered: true,
      maskClosable: false,
      title: '删除回测记录',
      content: (
        <RiskConfirmContent
          level="error"
          summary={`即将删除回测：${record.backtest_name}`}
          objectLabel={record.backtest_name}
          riskItems={[
            '此操作会删除该回测任务及其结果展示数据。',
            '不会删除策略文件，也不会影响真实交易订单和成交记录。',
            '删除后如需重新查看，需要重新发起回测。',
          ]}
          details={[
            { label: '任务 ID', value: record.task_id },
            { label: '策略', value: record.strategy_name },
            { label: '区间', value: `${record.start_date} ~ ${record.end_date}` },
            { label: '状态', value: formatStatusLabel(record.status) },
          ]}
          nextStep="删除前请确认该任务的 Excel 或截图已经留存；删除后页面将不再展示该任务报告。"
        />
      ),
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteBacktest(record.task_id);
          if (selectedTaskId === record.task_id) {
            setSelectedTaskId(null);
            setResult(null);
            setEquity([]);
            setTrades([]);
            setFocusedTrade(null);
            setPreviewTrade(null);
            setPreviewEquity(null);
            setSelectedEquityDate(null);
            setStockTradeChain(null);
            setLogs([]);
            setOfficialLogs([]);
          }
          await loadAll();
          message.success('回测已删除');
        } catch (error) {
          showError('删除回测失败', error);
        }
      },
    });
  };

  const openTradeDetail = (record: BacktestTradeRecord) => {
    const taskForTrade = tasks.find((task) => task.id === record.backtest_id) ?? null;
    setLogDrawer({
      title: '回测交易详情',
      subtitle: `${formatStockLabel(record.symbol, record.name)} / ${record.trade_time}`,
      status: formatSide(record.side),
      statusTone: getSideColor(record.side),
      width: 720,
      fieldColumns: 2,
      className: 'backtest-trade-detail-drawer',
      message: record.reason || '暂无触发原因。请结合策略信号、回测成交规则和当日行情核对；正式验收时应同时查看信号审计、成交规则和资金曲线。',
      technicalDetail: JSON.stringify(
        {
          qa_type: 'backtest_trade_detail',
          ai_copy_version: '1.0',
          backtest: {
            trade_id: record.id,
            backtest_id: record.backtest_id,
            task_id: taskForTrade?.task_id,
            strategy_name: taskForTrade?.strategy_name,
            data_frequency: taskForTrade?.data_frequency,
            fill_mode: taskForTrade?.fill_mode,
            range: taskForTrade ? `${taskForTrade.start_date} ~ ${taskForTrade.end_date}` : null,
          },
          stock: {
            symbol: record.symbol,
            name: record.name,
            display_name: formatStockLabel(record.symbol, record.name),
          },
          trade: {
            side_raw: record.side,
            side_text: formatSide(record.side),
            price: record.price,
            quantity: record.quantity,
            amount: record.amount,
            fee: record.fee,
            pnl: record.pnl,
            trade_time: record.trade_time,
            reason: record.reason,
          },
          audit: {
            check_signal_time: record.side === 'BUY',
            check_exit_rule: record.side === 'SELL',
            check_fee_and_cash_curve: true,
            note: '回测交易详情只来自本地 SQLite 回测结果，不调用真实 QMT 下单接口。',
          },
          raw: record,
        },
        null,
        2,
      ),
      fields: [
        { label: '回测ID', value: record.backtest_id },
        { label: '股票', value: formatStockLabel(record.symbol, record.name) },
        { label: '方向', value: <Tag color={getSideColor(record.side)}>{formatSide(record.side)}</Tag>, copyValue: formatSide(record.side) },
        { label: '成交时间', value: record.trade_time },
        { label: '成交价', value: formatPrice(record.price) },
        { label: '成交数量', value: formatQuantity(record.quantity) },
        { label: '成交金额', value: formatMoneyByUnit(record.amount) },
        { label: '费用', value: formatMoneyByUnit(record.fee) },
        { label: '盈亏', value: <Typography.Text type={record.pnl >= 0 ? 'danger' : 'success'}>{formatMoneyByUnit(record.pnl)}</Typography.Text>, copyValue: formatMoneyByUnit(record.pnl) },
        { label: '核对建议', value: record.side === 'BUY' ? '买入记录请核对信号审计中的 signal_time、价格和成交规则。' : '卖出记录请核对退出规则、持仓周期、止盈止损或收盘前退出原因。' },
      ],
    });
  };

  const loadStockTradeChain = useCallback(
    async (record: BacktestTradeRecord) => {
      if (!selectedTaskId) return;
      setStockTradeChain({
        symbol: record.symbol,
        name: record.name,
        rows: [],
        total: 0,
        hasMore: false,
        signalRows: [],
        signalTotal: 0,
        signalHasMore: false,
        loading: true,
        error: null,
      });
      try {
        const [tradeResult, signalResult] = await Promise.all([
          getBacktestTrades(selectedTaskId, {
            page: 1,
            pageSize: 200,
            keyword: record.symbol,
            sortField: 'trade_time',
            sortOrder: 'asc',
          }),
          getBacktestSignals(selectedTaskId, {
            page: 1,
            pageSize: 200,
            keyword: record.symbol,
            sortField: 'signal_time',
            sortOrder: 'asc',
          }),
        ]);
        const rows = sortTradesByTime(tradeResult.items.filter((item) => item.symbol === record.symbol));
        const signalRows = sortSignalsByTime(signalResult.items.filter((item) => item.symbol === record.symbol));
        setStockTradeChain({
          symbol: record.symbol,
          name: record.name,
          rows,
          total: tradeResult.total,
          hasMore: tradeResult.has_more || tradeResult.total > rows.length,
          signalRows,
          signalTotal: signalResult.total,
          signalHasMore: signalResult.has_more || signalResult.total > signalRows.length,
          loading: false,
          error: null,
        });
      } catch (error) {
        const errorMessage = error instanceof RequestError ? error.message : '加载当前股票买卖链路失败';
        setStockTradeChain((previous) => previous && previous.symbol === record.symbol ? {
          ...previous,
          loading: false,
          error: errorMessage,
        } : previous);
        message.error(errorMessage);
      }
    },
    [message, selectedTaskId],
  );

  const handleChartTradePreview = useCallback((record: BacktestTradeRecord | null) => {
    setPreviewTrade(record);
    const recordDate = record?.trade_time.slice(0, 10) ?? null;
    setPreviewEquity(recordDate ? (equity.find((item) => item.trade_date === recordDate) ?? null) : null);
  }, [equity]);

  const handleChartEquityPreview = useCallback((record: BacktestEquityRecord | null) => {
    if (selectedEquityDate) {
      return;
    }
    setPreviewEquity(record);
  }, [selectedEquityDate]);

  const handleChartEquitySelect = useCallback(
    (record: BacktestEquityRecord) => {
      setSelectedEquityDate(record.trade_date);
      setPreviewEquity(record);
      setFocusedTrade(null);
      setPreviewTrade(null);
      setStockTradeChain(null);
      setTradePage((previous) => ({ ...previous, page: 1 }));
      setSignalPage((previous) => ({ ...previous, page: 1 }));
      setActiveTab('交易明细');
      message.info(`已按服务端日期筛选定位 ${record.trade_date} 的成交明细和信号审计。`);
    },
    [message, setActiveTab],
  );

  const handleChartTradeSelect = useCallback(
    (record: BacktestTradeRecord) => {
      const recordDate = record.trade_time.slice(0, 10);
      setFocusedTrade(record);
      setPreviewTrade(record);
      setSelectedEquityDate(null);
      setPreviewEquity(equity.find((item) => item.trade_date === recordDate) ?? null);
      void loadStockTradeChain(record);
      setActiveTab('交易明细');
      message.info(`已定位 ${formatStockLabel(record.symbol, record.name)} / ${recordDate} 的当前页成交明细。`);
    },
    [equity, loadStockTradeChain, message, setActiveTab],
  );

  const handleTradeRowLocate = useCallback(
    (record: BacktestTradeRecord) => {
      const recordDate = record.trade_time.slice(0, 10);
      setFocusedTrade(record);
      setPreviewTrade(record);
      setSelectedEquityDate(null);
      setPreviewEquity(equity.find((item) => item.trade_date === recordDate) ?? null);
      void loadStockTradeChain(record);
      setActiveTab('绩效结果');
      message.info(`已从交易明细反向定位到 ${formatStockLabel(record.symbol, record.name)} 的曲线买卖点。`);
    },
    [equity, loadStockTradeChain, message, setActiveTab],
  );

  const selectedTask = useMemo(() => tasks.find((task) => task.task_id === selectedTaskId) ?? tasks[0] ?? null, [selectedTaskId, tasks]);
  const selectedTaskRangeMismatch = Boolean(
    selectedTask
      && watchedStartDate
      && watchedEndDate
      && (selectedTask.start_date !== watchedStartDate || selectedTask.end_date !== watchedEndDate),
  );
  const selectedStrategy = useMemo(() => strategies.find((strategy) => strategy.id === watchedStrategyId) ?? null, [strategies, watchedStrategyId]);
  const strategyOptions = useMemo(() => strategies.map((strategy) => ({
    label: formatStrategySelectLabel(strategy),
    value: strategy.id,
    title: formatStrategySelectLabel(strategy),
  })), [strategies]);
  const fillModeOptions = useMemo(
    () => (minuteFrequencySelected
      ? [
        { value: '正式分钟回放', label: '正式分钟回放' },
      ]
      : [
        { value: '下一日开盘', label: '下一日开盘' },
        { value: '当日收盘', label: '当日收盘' },
      ]),
    [minuteFrequencySelected],
  );
  const frequencyOptions = useMemo(() => [
    { value: '日K', label: '日K' },
    { value: '分钟K', label: '分钟K' },
  ], []);
  const successCount = tasks.filter((task) => task.status === 'success').length;
  const failedCount = tasks.filter((task) => task.status === 'failed').length;
  const runningCount = tasks.filter((task) => task.status === 'running').length;
  const bestTrade = useMemo(() => [...trades].sort((left, right) => right.pnl - left.pnl)[0], [trades]);
  const worstTrade = useMemo(() => [...trades].sort((left, right) => left.pnl - right.pnl)[0], [trades]);
  const totalFee = useMemo(() => trades.reduce((sum, trade) => sum + trade.fee, 0), [trades]);
  const focusedTradeDate = focusedTrade?.trade_time.slice(0, 10) ?? null;
  const activeEquityPreview = useMemo(
    () => previewEquity ?? (selectedEquityDate ? (equity.find((item) => item.trade_date === selectedEquityDate) ?? null) : null),
    [equity, previewEquity, selectedEquityDate],
  );
  const activeEquityDailyPnl = useMemo(
    () => activeEquityPreview ? getEquityDailyPnlForRows(equity, activeEquityPreview) : 0,
    [activeEquityPreview, equity],
  );
  const activeEquityTradeRows = useMemo(
    () => {
      if (!activeEquityPreview) return [];
      if (selectedEquityDate && activeEquityPreview.trade_date !== selectedEquityDate) {
        return [];
      }
      return trades.filter((trade) => trade.trade_time.slice(0, 10) === activeEquityPreview.trade_date);
    },
    [activeEquityPreview, selectedEquityDate, trades],
  );
  const activeEquityTradeSourceLabel = selectedEquityDate && activeEquityPreview?.trade_date === selectedEquityDate
    ? '服务端当日分页'
    : '当前页预览';
  const activeEquitySyncTone = activeEquityPreview
    ? activeEquityDailyPnl > 0
      ? 'red'
      : activeEquityDailyPnl < 0
        ? 'green'
        : 'blue'
    : 'neutral';
  const activeEquityTradePreviewRows = useMemo(() => activeEquityTradeRows.slice(0, 3), [activeEquityTradeRows]);
  const activeEquityTradeAmount = useMemo(
    () => activeEquityTradeRows.reduce((sum, trade) => sum + trade.amount, 0),
    [activeEquityTradeRows],
  );
  const activeEquityTradePnl = useMemo(
    () => activeEquityTradeRows.reduce((sum, trade) => sum + trade.pnl, 0),
    [activeEquityTradeRows],
  );
  const tradeDetailRows = useMemo(() => {
    if (focusedTrade && focusedTradeDate) {
      return trades.filter((trade) => trade.symbol === focusedTrade.symbol && trade.trade_time.slice(0, 10) === focusedTradeDate);
    }
    if (selectedEquityDate) {
      return trades.filter((trade) => trade.trade_time.slice(0, 10) === selectedEquityDate);
    }
    return trades;
  }, [focusedTrade, focusedTradeDate, selectedEquityDate, trades]);
  const focusedTradeMatched = useMemo(() => Boolean(focusedTrade && tradeDetailRows.some((trade) => trade.id === focusedTrade.id)), [focusedTrade, tradeDetailRows]);
  const focusedTradeSideCount = useMemo(
    () => focusedTrade ? tradeDetailRows.filter((trade) => trade.side === focusedTrade.side).length : 0,
    [focusedTrade, tradeDetailRows],
  );
  const tradeDetailStats = useMemo(() => buildTradeAuditStats(tradeDetailRows), [tradeDetailRows]);
  const tradeDetailTotalFee = useMemo(() => tradeDetailRows.reduce((sum, trade) => sum + trade.fee, 0), [tradeDetailRows]);
  const tradeDetailScopeLabel = focusedTrade ? '联动范围' : selectedEquityDate ? '曲线日期' : '当前页';
  const tradeFilterSummaryItems = [
    { label: '查询范围', value: focusedTrade ? '图表定位同日同股' : selectedEquityDate ? '曲线定位当日成交' : '当前回测任务全量' },
    { label: '服务端总数', value: `${tradePage.total || trades.length} 条` },
    { label: '当前页', value: `${tradePage.page} / ${tradePage.pageSize} 条每页` },
    { label: '关键字', value: tradeKeyword || '全部' },
    { label: '方向', value: tradeSideFilter ? formatSide(tradeSideFilter) : '全部' },
  ];
  const signalFilterSummaryItems = [
    { label: '查询范围', value: selectedEquityDate ? '曲线定位当日信号' : '当前回测任务全量' },
    { label: '服务端总数', value: `${signalPage.total || signalAudits.length} 条` },
    { label: '当前页', value: `${signalPage.page} / ${signalPage.pageSize} 条每页` },
    { label: '日期', value: selectedEquityDate || '全部' },
    { label: '关键字', value: signalKeyword || '全部' },
    { label: '状态', value: signalStatusFilter || '全部' },
  ];
  const logFilterSummaryItems = [
    { label: '查询范围', value: '当前回测任务全量' },
    { label: '服务端总数', value: `${logPage.total || logs.length} 条` },
    { label: '当前页', value: `${logPage.page} / ${logPage.pageSize} 条每页` },
    { label: '曲线日期', value: selectedEquityDate || '未定位' },
    { label: '日志时间口径', value: '任务运行时间 created_at' },
    { label: '关键字', value: logKeyword || '全部' },
    { label: '级别', value: logLevelFilter || '全部' },
  ];
  const stockTradeChainStats = useMemo(() => buildStockTradeChainStats(stockTradeChain?.rows ?? []), [stockTradeChain]);
  const stockSignalChainStats = useMemo(() => buildStockSignalChainStats(stockTradeChain?.signalRows ?? []), [stockTradeChain]);
  const finalEquityMatched = result ? Math.abs((result.ending_cash + result.open_market_value) - result.final_cash) < 1 : false;
  const officialPathLogs = useMemo(() => officialLogs.filter((log) => log.message.includes('官方路径')), [officialLogs]);
  const reportLogSummary = useMemo(() => {
    const source = officialPathLogs.length > 0 ? officialPathLogs : logs;
    return source.slice(0, 5);
  }, [logs, officialPathLogs]);
  const equityCheckpoints = useMemo(() => {
    if (equity.length === 0) return [];
    const highestEquity = equity.reduce((best, row) => (row.equity > best.equity ? row : best), equity[0]);
    const lowestEquity = equity.reduce((best, row) => (row.equity < best.equity ? row : best), equity[0]);
    const maxDrawdown = equity.reduce((best, row) => (Math.abs(row.drawdown) > Math.abs(best.drawdown) ? row : best), equity[0]);
    return [
      {
        label: '最高权益点',
        value: formatMoney(highestEquity.equity),
        meta: `${highestEquity.trade_date} / 现金 ${formatMoneyByUnit(highestEquity.cash)}`,
        tone: 'blue',
      },
      {
        label: '最低权益点',
        value: formatMoney(lowestEquity.equity),
        meta: `${lowestEquity.trade_date} / 市值 ${formatMoneyByUnit(lowestEquity.market_value)}`,
        tone: 'green',
      },
      {
        label: '最大回撤点',
        value: `${maxDrawdown.drawdown.toFixed(2)}%`,
        meta: `${maxDrawdown.trade_date} / 权益 ${formatMoneyByUnit(maxDrawdown.equity)}`,
        tone: 'orange',
      },
    ];
  }, [equity]);
  const manifestCoverage = useMemo(
    () => parseManifestJson<Array<{ data_type: string; status: string; coverage_rate: number; start_date?: string; end_date?: string; matched_by?: string }>>(manifest?.data_coverage_snapshot, []),
    [manifest],
  );
  const manifestUniverse = useMemo(
    () => parseManifestJson<{
      symbols_total?: number;
      symbols_with_daily_bars?: number;
      daily_bar_count?: number;
      minute_bar_count?: number;
      minute_scanned_trade_days?: number;
      minute_symbols_scanned?: number;
      minute_symbols_with_rows?: number;
      minute_trigger_count?: number;
      minute_return_limit?: number;
      minute_limit_hit_days?: number;
      minute_possible_truncation?: boolean;
      minute_mode?: string;
      signal_count?: number;
      trade_count?: number;
      matched_signal_count?: number;
      skipped_signal_count?: number;
    }>(manifest?.universe_summary, {}),
    [manifest],
  );
  const manifestRules = useMemo(
    () => parseManifestJson<{ lot_size?: number; t_plus_1?: boolean; minute_mode?: string; real_qmt_order?: boolean; minute_market_cap_basis?: string; strategy_max_signals?: number }>(manifest?.rule_snapshot, {}),
    [manifest],
  );
  const minuteModeLabel = (manifestRules.minute_mode || manifestUniverse.minute_mode) === 'minute_replay' ? '正式分钟回放' : '历史非正式分钟模式';
  const manifestCoverageEvidenceItems = useMemo(() => manifestCoverage.map((item) => ({
    label: formatCoverageDataType(item.data_type),
    value: `${Number(item.coverage_rate ?? 0).toFixed(2)}%`,
    meta: `${item.start_date ?? '-'} ~ ${item.end_date ?? '-'} / ${formatCoverageStatus(item.status)} / ${formatCoverageMatchMode(item.matched_by)}`,
    tone: item.status === 'complete' ? 'green' : 'orange',
  })), [manifestCoverage]);
  const manifestEvidenceSections = useMemo(() => {
    if (!manifest) return [];
    const signalLimit = manifestUniverse.minute_return_limit ?? manifestRules.strategy_max_signals;
    const marketCapBasis = manifestRules.minute_market_cap_basis === 'previous_visible_daily_bar' ? '前一可见日K' : '默认规则';
    return [
      {
        title: 'Manifest 快照',
        subtitle: '代码、引擎、数据源',
        testId: 'backtest-evidence-manifest',
        items: [
          { label: '策略文件', value: manifest.strategy_file_name || '未记录', meta: manifest.strategy_name || '未记录', tone: 'blue' },
          { label: '代码哈希', value: manifest.strategy_code_hash ? manifest.strategy_code_hash.slice(0, 12) : '未记录', meta: `版本 ${manifest.strategy_version || '未记录'}`, tone: 'blue' },
          { label: '引擎版本', value: manifest.engine_version || '未记录', meta: `${manifest.data_frequency} / ${manifest.fill_mode}`, tone: 'neutral' },
          { label: '数据源模式', value: formatBacktestQmtMode(manifest.qmt_mode, true), meta: '只读落库，不真实下单', tone: 'green' },
        ],
      },
      {
        title: '覆盖率快照',
        subtitle: '正式复盘前必须可追溯',
        testId: 'backtest-evidence-coverage',
        items: manifestCoverageEvidenceItems.length
          ? manifestCoverageEvidenceItems
          : [{ label: '覆盖记录', value: '未记录', meta: '建议复跑生成 Manifest', tone: 'orange' }],
      },
      {
        title: '股票池与信号',
        subtitle: '扫描范围、触发、成交',
        testId: 'backtest-evidence-universe',
        items: [
          { label: '股票池', value: formatManifestCount(manifestUniverse.symbols_total, ' 只'), meta: `日K ${formatManifestCount(manifestUniverse.daily_bar_count)} 行`, tone: manifestUniverse.symbols_total ? 'green' : 'orange' },
          { label: '分钟扫描', value: formatManifestCount(manifestUniverse.minute_symbols_scanned, ' 只'), meta: `有分钟K ${formatManifestCount(manifestUniverse.minute_symbols_with_rows, ' 只')}`, tone: manifest.data_frequency === '分钟K' ? 'blue' : 'neutral' },
          { label: '信号审计', value: formatManifestCount(manifestUniverse.signal_count, ' 条'), meta: `成交 ${formatManifestCount(manifestUniverse.matched_signal_count, ' 条')} / 跳过 ${formatManifestCount(manifestUniverse.skipped_signal_count, ' 条')}`, tone: 'blue' },
          { label: '成交明细', value: formatManifestCount(manifestUniverse.trade_count, ' 笔'), meta: `分钟触发 ${formatManifestCount(manifestUniverse.minute_trigger_count, ' 次')}`, tone: manifestUniverse.trade_count ? 'green' : 'orange' },
        ],
      },
      {
        title: '撮合规则',
        subtitle: 'A股基础约束与安全边界',
        testId: 'backtest-evidence-rules',
        items: [
          { label: 'T+1', value: formatManifestBoolean(manifestRules.t_plus_1), meta: `一手 ${formatManifestCount(manifestRules.lot_size ?? 100, ' 股')}`, tone: manifestRules.t_plus_1 ? 'green' : 'orange' },
          { label: '分钟推演', value: manifest.data_frequency === '分钟K' ? minuteModeLabel : manifest.fill_mode, meta: `市值基准 ${marketCapBasis}`, tone: manifest.data_frequency === '分钟K' ? 'blue' : 'neutral' },
          { label: '信号上限', value: signalLimit ? formatManifestCount(signalLimit, ' 条') : '未记录', meta: manifestUniverse.minute_possible_truncation ? `${manifestUniverse.minute_limit_hit_days ?? 0} 日触顶` : '未触顶', tone: manifestUniverse.minute_possible_truncation ? 'orange' : 'green' },
          { label: '真实下单', value: formatManifestBoolean(manifestRules.real_qmt_order, '是', '否'), meta: '回测不调用真实 QMT 下单', tone: manifestRules.real_qmt_order ? 'orange' : 'green' },
        ],
      },
    ];
  }, [manifest, manifestCoverageEvidenceItems, manifestRules, manifestUniverse, minuteModeLabel]);
  const exportTraceItems = useMemo(() => {
    const completeCoverageCount = manifestCoverage.filter((item) => item.status === 'complete').length;
    const coverageSummary = manifestCoverage.length
      ? `${completeCoverageCount}/${manifestCoverage.length} 完整`
      : '未记录';
    const universeSummary = manifestUniverse.symbols_total
      ? `${manifestUniverse.symbols_total}只 / 日K ${manifestUniverse.daily_bar_count ?? '-'} / 分钟K ${manifestUniverse.minute_bar_count ?? '-'}`
      : '未记录';
    return [
      {
        title: '运行参数',
        value: selectedTask ? `${selectedTask.start_date}~${selectedTask.end_date}` : '未选择任务',
        detail: selectedTask ? `${selectedTask.data_frequency} / ${selectedTask.fill_mode} / ${formatMoneyByUnit(selectedTask.initial_cash)}` : '选择成功回测后显示任务参数。',
        tone: selectedTask ? 'blue' : 'orange',
      },
      {
        title: '数据覆盖快照',
        value: coverageSummary,
        detail: manifestCoverage.length ? '覆盖率、请求区间、匹配方式会写入导出文件。' : '缺少覆盖快照，建议复跑后再正式复盘。',
        tone: manifestCoverage.length && completeCoverageCount === manifestCoverage.length ? 'green' : 'orange',
      },
      {
        title: '股票池摘要',
        value: universeSummary,
        detail: manifestUniverse.minute_possible_truncation ? '存在分钟信号触顶，导出后必须核对是否截断。' : '股票池、信号、成交和跳过数量会写入导出文件。',
        tone: manifestUniverse.minute_possible_truncation ? 'orange' : manifestUniverse.symbols_total ? 'green' : 'orange',
      },
      {
        title: '规则快照',
        value: `${manifestRules.t_plus_1 ? 'T+1' : 'T+1未记录'} / ${manifestRules.lot_size ?? 100}股 / ${minuteModeLabel}`,
        detail: `真实下单：${manifestRules.real_qmt_order ? '是' : '否'}；市值基准：${manifestRules.minute_market_cap_basis === 'previous_visible_daily_bar' ? '前一可见日K' : '默认规则'}。`,
        tone: manifestRules.real_qmt_order ? 'orange' : 'blue',
      },
    ];
  }, [manifestCoverage, manifestRules, manifestUniverse, minuteModeLabel, selectedTask]);
  const trustLabel = manifest?.trust_level === 'verified_data_minute_replay'
    ? '真实数据完整 · 正式分钟回放'
    : manifest?.trust_level === 'verified_data_signal_simulation'
      ? '历史非正式分钟结果'
      : manifest?.trust_level === 'verified_data_simulation'
        ? '真实数据完整 · 本地撮合回测'
        : manifest?.trust_level === 'test_only'
          ? '测试隔离'
          : '技术验证';
  const trustAlertType: 'success' | 'warning' = manifest?.trust_level?.startsWith('verified') ? 'success' : 'warning';
  const strategySnapshotCheckLabel = strategySnapshotCheck?.status === 'matched'
    ? '已匹配运行快照'
    : strategySnapshotCheck?.status === 'unmatched'
      ? '未匹配同一代码'
      : strategySnapshotCheck?.status === 'no_run_snapshot'
        ? '无运行快照'
        : strategySnapshotCheck?.status === 'no_manifest'
          ? '缺少 Manifest'
          : '未核对';
  const strategySnapshotCheckAlertType: 'success' | 'warning' = strategySnapshotCheck?.status === 'matched' ? 'success' : 'warning';
  const backtestAnalysisPath = [
    {
      title: '1 可信证据',
      description: manifest ? trustLabel : '缺少 Manifest，建议复跑',
      icon: <SafetyCertificateOutlined />,
      actionLabel: '看证据',
      disabled: false,
      onClick: () => setActiveTab('绩效结果'),
    },
    {
      title: '2 资金曲线',
      description: `${equity.length} 个权益点`,
      icon: <LineChartOutlined />,
      actionLabel: '看曲线',
      disabled: false,
      onClick: () => setActiveTab('绩效结果'),
    },
    {
      title: '3 成交明细',
      description: `${tradePage.total || trades.length} 条成交记录`,
      icon: <FileSearchOutlined />,
      actionLabel: '看明细',
      disabled: !selectedTaskId,
      onClick: () => setActiveTab('交易明细'),
    },
    {
      title: '4 导出复盘',
      description: 'Excel 多 Sheet 汇总',
      icon: <DownloadOutlined />,
      actionLabel: '导出',
      disabled: !selectedTaskId || selectedTask?.status === 'running' || selectedTask?.status === 'pending',
      onClick: () => selectedTaskId && handleExport(selectedTaskId),
    },
  ];
  const precheckItems = [
    {
      title: '策略接口',
      status: selectedStrategy ? 'success' : 'warning',
      icon: <CheckCircleOutlined />,
      description: selectedStrategy ? `${selectedStrategy.strategy_name} · v${selectedStrategy.version} · ${selectedStrategy.file_name}` : '请选择已通过接口检查的 Python 策略。',
    },
    {
      title: '回测区间',
      status: watchedStartDate && watchedEndDate ? 'success' : 'warning',
      icon: <LineChartOutlined />,
      description: watchedStartDate && watchedEndDate ? `${watchedStartDate} ~ ${watchedEndDate}` : '请填写开始日期和结束日期。',
    },
    {
      title: '数据频率',
      status: watchedFrequency ? 'success' : 'warning',
      icon: <DatabaseOutlined />,
      description: minuteFrequencySelected
        ? '分钟K，适合依赖分钟线或盘中触发的策略。'
        : watchedFrequency
          ? `${watchedFrequency}，必须已在数据中心落库。`
          : '请选择日K或分钟K。',
    },
    {
      title: '数据检查',
      status: dataCheck ? (dataCheck.ok ? 'success' : 'failed') : 'pending',
      icon: <SafetyCertificateOutlined />,
      description: dataCheck ? `${dataCheck.message}${dataCheck.suggestion ? ` ${dataCheck.suggestion}` : ''}` : '点击“检查数据”后显示结果和下一步建议。',
    },
  ];
  const officialCheckItems = dataCheck?.steps?.length
    ? dataCheck.steps.map((step) => ({
      title: step.title,
      status: step.status,
      icon: step.title.includes('数据') || step.title.includes('落库') || step.title.includes('覆盖') ? <DatabaseOutlined /> : <SafetyCertificateOutlined />,
      description: step.message,
    }))
    : precheckItems;

  const taskColumns: ColumnsType<BacktestTaskRecord> = [
    {
      title: '回测名称',
      dataIndex: 'backtest_name',
      width: 204,
      fixed: 'left',
      ellipsis: true,
      render: (value: string, record) => (
        <Button aria-label={`查看回测结果：${value}`} title={`查看回测结果：${value}`} type="link" className="backtest-link-button" onClick={(event) => { event.stopPropagation(); void openTaskDetails(record); }}>
          {value}
        </Button>
      ),
    },
    { title: '策略', dataIndex: 'strategy_name', width: 184, render: renderAuditText },
    { title: '区间', width: 154, render: (_, record) => `${record.start_date} ~ ${record.end_date}` },
    { title: '频率', dataIndex: 'data_frequency', width: 72 },
    { title: '状态', dataIndex: 'status', width: 78, render: (value: string) => <Tag color={getStatusColor(value)}>{formatStatusLabel(value)}</Tag> },
    { title: '创建时间', dataIndex: 'created_at', width: 152 },
    {
      title: '操作',
      width: 144,
      fixed: false,
      render: (_, record) => (
        <TableActionGroup
          primary={(
            <Button size="small" type="primary" aria-label="查看回测结果" title="查看回测结果" icon={<SearchOutlined />} onClick={(event) => { event.stopPropagation(); void openTaskDetails(record); }}>
              查看报告
            </Button>
          )}
          actions={[
              { key: 'template', label: '复用参数', onClick: () => handleUseTaskTemplate(record) },
              {
                key: 'export',
                label: record.status === 'running' || record.status === 'pending' ? '任务运行中，暂不可导出' : '导出完整Excel',
                disabled: record.status === 'running' || record.status === 'pending',
                onClick: () => { handleExport(record.task_id); },
              },
              { key: 'copy-task-summary', label: '复制任务摘要', onClick: () => { void copyBacktestTaskSummary(record); } },
              { key: 'delete', label: '删除回测记录', type: 'delete', danger: true, onClick: () => handleDelete(record) },
            ]}
        />
      ),
    },
  ];

  const tradeColumns: ColumnsType<BacktestTradeRecord> = [
    { title: '成交时间', dataIndex: 'trade_time', width: TABLE_COL.time, fixed: 'left' },
    { title: '股票', width: TABLE_COL.stockWide, fixed: 'left', render: (_, record) => renderAuditText(formatStockLabel(record.symbol, record.name)) },
    { title: '方向', dataIndex: 'side', width: TABLE_COL.side, render: (value: string) => <Tag color={getSideColor(value)}>{formatSide(value)}</Tag> },
    { title: '成交价', dataIndex: 'price', width: TABLE_COL.price, align: 'right', render: (value: number) => formatPrice(value) },
    { title: '数量', dataIndex: 'quantity', width: TABLE_COL.quantityWide, align: 'right', render: (value: number) => formatQuantity(value) },
    { title: '金额', dataIndex: 'amount', width: TABLE_COL.amountWide, align: 'right', render: (value: number) => formatMoneyByUnit(value) },
    { title: '费用', dataIndex: 'fee', width: TABLE_COL.amountWide, align: 'right', render: (value: number) => formatMoneyByUnit(value) },
    { title: '盈亏', dataIndex: 'pnl', width: TABLE_COL.amountWide, align: 'right', render: (value: number) => <Typography.Text type={value >= 0 ? 'danger' : 'success'}>{formatMoneyByUnit(value)}</Typography.Text> },
    { title: '原因', dataIndex: 'reason', width: TABLE_COL.reasonWide, responsive: ['xxl'], render: renderAuditText },
    {
      title: '详情',
      key: 'detail',
      fixed: false,
      width: TABLE_COL.actionWide,
      render: (_, record) => (
        <TableActionGroup
          primary={(
            <Space size={4}>
              <Button aria-label="查看回测交易详情" title="查看回测交易详情" size="small" onClick={() => openTradeDetail(record)}>详情</Button>
              <Button aria-label="定位回测曲线买卖点" title="定位回测曲线买卖点" size="small" onClick={() => handleTradeRowLocate(record)}>定位</Button>
            </Space>
          )}
        />
      ),
    },
  ];

  const signalColumns: ColumnsType<BacktestSignalRecord> = [
    { title: '信号时间', dataIndex: 'signal_time', width: TABLE_COL.time, fixed: 'left' },
    { title: '股票', width: TABLE_COL.stockWide, fixed: 'left', render: (_, record) => renderAuditText(formatStockLabel(record.symbol, record.name)) },
    { title: '动作', dataIndex: 'action', width: TABLE_COL.side, render: (value: string) => <Tag color={getSideColor(value)}>{formatSide(value)}</Tag> },
    { title: '状态', dataIndex: 'status', width: TABLE_COL.status, render: (value: string) => <Tag color={getStatusColor(value)}>{formatStatusLabel(value)}</Tag> },
    { title: '信号价', dataIndex: 'price', width: TABLE_COL.price, align: 'right', render: (value: number) => formatPrice(value) },
    { title: '信号金额', dataIndex: 'amount', width: TABLE_COL.amountWide, align: 'right', render: (value?: number | null) => (value ? formatMoneyByUnit(value) : '-') },
    { title: '成交时间', dataIndex: 'execution_time', width: TABLE_COL.time, responsive: ['xxl'], render: (value?: string | null) => value || '-' },
    { title: '成交价', dataIndex: 'execution_price', width: TABLE_COL.price, align: 'right', render: (value?: number | null) => (value ? formatPrice(value) : '-') },
    { title: '数量', dataIndex: 'quantity', width: TABLE_COL.quantityWide, align: 'right', render: (value: number) => (value ? formatQuantity(value) : '-') },
    { title: '跳过原因', dataIndex: 'skip_reason', width: TABLE_COL.reasonWide, responsive: ['xxl'], render: renderAuditText },
    { title: '信号原因', dataIndex: 'reason', width: TABLE_COL.messageWide, responsive: ['xxl'], render: renderAuditText },
  ];

  const logColumns: ColumnsType<BacktestLogRecord> = [
    { title: '时间', dataIndex: 'created_at', width: TABLE_COL.time, fixed: 'left' },
    { title: '级别', dataIndex: 'level', width: TABLE_COL.level, render: (value: string) => <Tag color={value === 'error' ? 'red' : value === 'warning' ? 'orange' : 'blue'}>{value}</Tag> },
    { title: '消息', dataIndex: 'message', width: TABLE_COL.messageWide, render: renderAuditText },
    { title: '技术详情', dataIndex: 'technical_detail', width: TABLE_COL.textWide, render: renderAuditText },
    {
      title: '详情',
      width: TABLE_COL.detailAction,
      fixed: false,
      render: (_, record) => (
        <TableActionGroup
          primary={(
            <Button
              aria-label="查看回测日志详情"
              title="查看回测日志详情"
              size="small"
              onClick={() => setLogDrawer({
            title: '回测日志详情',
            subtitle: record.created_at,
            status: record.level,
            statusTone: record.level === 'error' ? 'red' : record.level === 'warning' ? 'orange' : 'blue',
            width: 720,
            fieldColumns: 2,
            className: 'backtest-log-detail-drawer',
            message: record.message,
            technicalDetail: record.technical_detail ?? JSON.stringify(
              {
                id: record.id,
                backtest_id: record.backtest_id,
                level: record.level,
                message: record.message,
                created_at: record.created_at,
              },
              null,
              2,
            ),
            fields: [
              { label: '回测ID', value: record.backtest_id },
              { label: '级别', value: record.level },
              { label: '时间', value: record.created_at },
            ],
              })}
            >
              详情
            </Button>
          )}
        />
      ),
    },
  ];

  const renderStockTradeChainPanel = (variant: 'side' | 'wide' = 'side') => {
    if (!stockTradeChain) {
      return (
        <div className={`backtest-stock-chain backtest-stock-chain--empty backtest-stock-chain--${variant}`} data-testid="backtest-stock-chain-panel">
          <Typography.Text strong>当前股票链路</Typography.Text>
          <Typography.Text type="secondary">
            点击曲线买卖点或交易明细“定位”，这里会按股票代码读取买入、卖出、费用和盈亏闭环。
          </Typography.Text>
        </div>
      );
    }

    const refreshRecord = stockTradeChain.rows[0] ?? focusedTrade;
    return (
      <div className={`backtest-stock-chain backtest-stock-chain--${variant}`} data-testid="backtest-stock-chain-panel">
        <div className="backtest-stock-chain__head">
          <div>
            <Typography.Text strong>当前股票链路</Typography.Text>
            <Typography.Text type="secondary">{formatStockLabel(stockTradeChain.symbol, stockTradeChain.name)}</Typography.Text>
          </div>
          <Space size={6}>
            <Tag color={stockTradeChain.hasMore ? 'orange' : 'blue'}>{stockTradeChain.rows.length}/{stockTradeChain.total || stockTradeChain.rows.length}</Tag>
            <Button
              size="small"
              loading={stockTradeChain.loading}
              disabled={!refreshRecord}
              onClick={() => refreshRecord && void loadStockTradeChain(refreshRecord)}
            >
              刷新
            </Button>
          </Space>
        </div>
        <div className="backtest-stock-chain__metrics" aria-label="当前股票信号与买卖链路摘要">
          <div>
            <span>信号</span>
            <strong>{stockSignalChainStats.signalCount}/{stockTradeChain.signalTotal || stockSignalChainStats.signalCount}</strong>
          </div>
          <div>
            <span>已成交 / 跳过</span>
            <strong>{stockSignalChainStats.tradedCount} / {stockSignalChainStats.skippedCount}</strong>
          </div>
          <div>
            <span>买 / 卖</span>
            <strong>{stockTradeChainStats.buyCount} / {stockTradeChainStats.sellCount}</strong>
          </div>
          <div>
            <span>净数量</span>
            <strong>{formatQuantity(stockTradeChainStats.netQuantity)}</strong>
          </div>
          <div>
            <span>费用</span>
            <strong>{formatMoney(stockTradeChainStats.totalFee)}</strong>
          </div>
          <div>
            <span>盈亏</span>
            <strong className={stockTradeChainStats.totalPnl > 0 ? 'is-profit' : stockTradeChainStats.totalPnl < 0 ? 'is-loss' : ''}>
              {formatMoney(stockTradeChainStats.totalPnl)}
            </strong>
          </div>
        </div>
        {stockTradeChain.hasMore ? (
          <div className="backtest-stock-chain__warning">
            当前接口最多展示前 200 条匹配成交；如该股票链路超过展示范围，请导出完整 Excel 后核对。
          </div>
        ) : null}
        {stockTradeChain.signalHasMore ? (
          <div className="backtest-stock-chain__warning">
            当前接口最多展示前 200 条匹配信号；如该股票信号超过展示范围，请导出完整 Excel 后核对。
          </div>
        ) : null}
        {stockTradeChain.error ? (
          <div className="backtest-stock-chain__warning backtest-stock-chain__warning--error">
            {stockTradeChain.error}
          </div>
        ) : null}
        {stockTradeChain.loading ? (
          <div className="backtest-stock-chain__loading">正在读取当前股票信号与买卖链路...</div>
        ) : (
          <>
            <div className="backtest-stock-chain__section-title">
              <span>信号审计</span>
              <strong>{stockTradeChain.signalRows.length} 条</strong>
            </div>
            {stockTradeChain.signalRows.length > 0 ? (
              <div className="backtest-stock-chain__list backtest-stock-chain__list--signals" aria-label="当前股票信号审计时间线">
                {stockTradeChain.signalRows.map((signal, index) => (
                  <div
                    className={[
                      'backtest-stock-chain__signal-row',
                      signal.action === 'BUY' ? 'backtest-stock-chain__signal-row--buy' : 'backtest-stock-chain__signal-row--sell',
                      signal.status === '跳过' ? 'backtest-stock-chain__signal-row--skipped' : '',
                    ].filter(Boolean).join(' ')}
                    key={signal.id}
                    title={`${formatSide(signal.action)} ${signal.signal_time} / ${signal.status} / ${signal.reason || signal.skip_reason || '暂无原因'}`}
                  >
                    <span className="backtest-stock-chain__index">{String(index + 1).padStart(2, '0')}</span>
                    <span className="backtest-stock-chain__side">{formatSide(signal.action)}</span>
                    <strong>{signal.signal_time}</strong>
                    <small>{signal.status} / 成交 {signal.execution_time || '暂无'} / {signal.skip_reason || signal.reason || '暂无原因'}</small>
                    <em>{signal.execution_price ? formatPrice(signal.execution_price) : formatPrice(signal.price)}</em>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyGuide description="当前股票暂未返回信号审计。旧历史回测可能没有保存信号审计，建议复跑后核对。" />
            )}
            <div className="backtest-stock-chain__section-title">
              <span>成交链路</span>
              <strong>{stockTradeChain.rows.length} 条</strong>
            </div>
            {stockTradeChain.rows.length > 0 ? (
              <div className="backtest-stock-chain__list" aria-label="当前股票买卖时间线">
                {stockTradeChain.rows.map((trade, index) => (
                  <button
                    type="button"
                    className={[
                      'backtest-stock-chain__row',
                      trade.side === 'BUY' ? 'backtest-stock-chain__row--buy' : 'backtest-stock-chain__row--sell',
                      trade.id === focusedTrade?.id ? 'backtest-stock-chain__row--active' : '',
                    ].filter(Boolean).join(' ')}
                    key={trade.id}
                    onClick={() => openTradeDetail(trade)}
                    title={`${formatSide(trade.side)} ${trade.trade_time} / ${formatPrice(trade.price)} / ${formatQuantity(trade.quantity)}`}
                  >
                    <span className="backtest-stock-chain__index">{String(index + 1).padStart(2, '0')}</span>
                    <span className="backtest-stock-chain__side">{formatSide(trade.side)}</span>
                    <strong>{trade.trade_time}</strong>
                    <small>{formatPrice(trade.price)} / {formatQuantity(trade.quantity)} / 费 {formatMoneyByUnit(trade.fee)}</small>
                    <em className={trade.pnl > 0 ? 'is-profit' : trade.pnl < 0 ? 'is-loss' : ''}>{formatMoneyByUnit(trade.pnl)}</em>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyGuide description="当前股票暂未返回买卖链路。请确认任务是否有成交，或导出完整 Excel 进行核对。" />
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="module-page backtest-page">
      <PageHeader
        title="回测研究"
        description="真实落库行情、本地撮合回测、绩效指标、曲线、成交明细和回测日志。"
        updatedAt={updatedAt}
        loading={loading}
        onRefresh={loadAll}
        extra={<DataFreshnessTag label="回测数据" updatedAt={updatedAt} loading={loading} />}
        secondaryActions={(
          <Button aria-label="复制回测示例策略" title="复制回测示例策略" icon={<CopyOutlined />} onClick={handleCopyExample}>
            复制示例策略
          </Button>
        )}
        primaryAction={{ label: '新建回测', testId: 'btn-open-create-backtest', onClick: () => setActiveTab('新建回测') }}
      />

      <CommandPanel
        eyebrow="BACKTEST LAB"
        title={selectedTask?.backtest_name ?? '先选择或新建一个回测任务'}
        description="回测只读取本地 SQLite 已落库行情；分钟策略需要分钟 K 回放证据，结果页必须能追溯任务、区间、成交、资金曲线和日志。"
        actions={(
          <>
            <Tag color="blue">{taskPage.total || tasks.length} 个任务</Tag>
            <Tag color={failedCount > 0 ? 'red' : 'green'}>{successCount} 成功 / {failedCount} 失败</Tag>
            <Tag color={runningCount > 0 ? 'processing' : 'default'}>{runningCount} 运行中</Tag>
          </>
        )}
        items={[
          { label: '当前任务', value: selectedTask?.strategy_name ?? '未选择', helper: selectedTask?.start_date && selectedTask?.end_date ? `${selectedTask.start_date} ~ ${selectedTask.end_date}` : '请选择回测任务', tone: selectedTask ? 'info' : 'warning' },
          { label: '最终权益', value: <FinancialNumber value={result?.final_cash} tone="primary" compact />, helper: `${result?.trade_count ?? 0} 笔成交`, tone: 'info' },
          { label: '总收益率', value: formatPercent(result?.total_return), helper: 'A 股红涨绿跌口径', tone: (result?.total_return ?? 0) >= 0 ? 'success' : 'warning' },
          { label: '可信证据', value: result ? '可核对' : '待生成', helper: '曲线 / 明细 / 日志', tone: result ? 'success' : 'neutral' },
        ]}
      />

      <TaskProgress task={activeTask} />

      {selectedTaskRangeMismatch ? (
        <Alert
          type="warning"
          showIcon
          message="当前查看的回测结果区间与新建表单日期不一致"
          description={`你现在打开的是历史任务 ${selectedTask?.start_date} ~ ${selectedTask?.end_date}；新建表单当前日期是 ${watchedStartDate} ~ ${watchedEndDate}。请不要用历史任务的买入记录判断当前日期回测。`}
          action={(
            <Button size="small" onClick={() => setActiveTab('新建回测')}>
              回到新建回测
            </Button>
          )}
        />
      ) : null}

      <WorkbenchNav
        ariaLabel="回测研究流程"
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          { key: '回测任务', title: '选任务', description: `${taskPage.total || tasks.length} 个任务 / ${runningCount} 运行中`, tone: runningCount ? 'info' : 'neutral' },
          { key: '绩效结果', title: '看报告', description: result ? `${formatPercent(result.total_return)} / ${result.trade_count} 笔成交` : '收益、回撤、可信证据', tone: result ? ((result.total_return ?? 0) >= 0 ? 'success' : 'warning') : 'neutral' },
          { key: '交易明细', title: '查明细', description: '逐笔核对信号、成交、费用和跳过原因', tone: 'info' },
          { key: '回测日志', title: '看日志', description: failedCount > 0 ? `${failedCount} 个失败任务` : '失败、取消和技术详情', tone: failedCount > 0 ? 'danger' : 'neutral' },
        ] satisfies WorkbenchNavItem<BacktestTabKey>[]}
      />

      <Tabs
        className="backtest-tabs"
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as BacktestTabKey)}
        items={[
          {
            key: '新建回测',
            label: '新建回测',
            children: (
              <SectionCard
                title="新建回测"
                description="按研究流程填写策略、区间、资金费用和成交规则。"
                extra={<Tag color="blue">本地撮合，不调用真实 QMT 下单</Tag>}
              >
                <Form form={form} layout="vertical" initialValues={initialFormValues} onFinish={handleCreate}>
                  <Row gutter={[8, 8]}>
                    <Col xs={24} xl={9}>
                      <div className="backtest-form-block">
                        <Typography.Text strong>策略与区间</Typography.Text>
                        <Row gutter={12}>
                          <Col xs={24}>
                            <Form.Item name="strategy_id" label="策略" rules={[{ required: true, message: '请选择策略' }]}>
                              <Select
                                options={strategyOptions}
                                placeholder="请选择策略"
                              />
                            </Form.Item>
                          </Col>
                          <Col xs={24}>
                            <Form.Item name="backtest_name" label="回测名称" rules={[{ required: true, message: '请输入回测名称' }]}>
                              <Input />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={12}>
                            <Form.Item name="start_date" label="开始日期" rules={[{ required: true, message: '请输入开始日期' }]}>
                              <Input placeholder="YYYY-MM-DD" />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={12}>
                            <Form.Item name="end_date" label="结束日期" rules={[{ required: true, message: '请输入结束日期' }]}>
                              <Input placeholder="YYYY-MM-DD" />
                            </Form.Item>
                          </Col>
                        </Row>
                      </div>
                    </Col>
                    <Col xs={24} xl={8}>
                      <div className="backtest-form-block">
                        <Typography.Text strong>资金与费用</Typography.Text>
                        <Row gutter={12}>
                          <Col xs={24} md={12}>
                            <Form.Item name="initial_cash" label="初始资金" rules={[{ required: true }]}>
                              <InputNumber min={1} style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={12}>
                            <Form.Item name="single_order_amount" label="单笔下单金额" rules={[{ required: true }]}>
                              <InputNumber min={1} style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={8}>
                            <Form.Item name="fee_rate" label="手续费率">
                              <InputNumber min={0} step={0.0001} style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={8}>
                            <Form.Item name="stamp_tax_rate" label="印花税率">
                              <InputNumber min={0} step={0.0001} style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={8}>
                            <Form.Item name="slippage" label="滑点">
                              <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                        </Row>
                      </div>
                    </Col>
                    <Col xs={24} xl={7}>
                      <div className="backtest-form-block">
                        <Typography.Text strong>成交规则</Typography.Text>
                        <Row gutter={12}>
                          <Col xs={24} md={12}>
                            <Form.Item name="fill_mode" label="成交模式">
                              <Select options={fillModeOptions} />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={12}>
                            <Form.Item name="data_frequency" label="数据频率">
                              <Select options={frequencyOptions} onChange={handleFrequencyChange} />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Alert
                          type="info"
                          showIcon
                          message="可信回测约束"
                          description="回测按本地 SQLite 数据执行，策略只能读取当前时间点及以前的数据；真实交易接口不会被调用。"
                        />
                        {minuteFrequencySelected ? (
                          <Alert
                            type="success"
                            showIcon
                            message="分钟K正式回放已启用"
                            description="系统强制逐行扫描本地 SQLite 1分钟K生成历史信号，信号后按下一根1分钟K本地撮合成交；不会调用真实 QMT 下单，快速分钟扫描已禁用。"
                          />
                        ) : null}
                        <div className="backtest-precheck-list">
                          <Typography.Text strong>回测前检查摘要</Typography.Text>
                          {officialCheckItems.map((item) => (
                            <div className={`backtest-precheck-item backtest-precheck-item--${item.status}`} key={item.title}>
                              <span className="backtest-precheck-item__icon">{item.icon}</span>
                              <div>
                                <Space size={6} wrap>
                                  <Typography.Text strong>{item.title}</Typography.Text>
                                  <Tag color={item.status === 'success' ? 'green' : item.status === 'failed' ? 'red' : item.status === 'warning' ? 'orange' : 'default'}>
                                    {item.status === 'success' ? '通过' : item.status === 'failed' ? '异常' : item.status === 'warning' ? '需核对' : '待检查'}
                                  </Tag>
                                </Space>
                                <Typography.Text type="secondary">{item.description}</Typography.Text>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </Col>
                  </Row>
                  <Space wrap className="backtest-form-actions">
                    <Alert
                      type="warning"
                      showIcon
                      message={`本次提交区间：${watchedStartDate || '未填写'} ~ ${watchedEndDate || '未填写'}`}
                      description="点击“开始回测”后会再次弹窗确认实际提交参数；如任务列表区间不一致，请不要用该结果。"
                    />
                    <Button aria-label="复制回测示例策略" title="复制回测示例策略" icon={<CopyOutlined />} onClick={handleCopyExample}>
                      复制示例策略
                    </Button>
                    <Button aria-label="检查回测所需数据" title="检查回测所需数据" icon={<SearchOutlined />} loading={checkingData} disabled={checkingData || loading} onClick={handleCheckData}>
                      检查数据
                    </Button>
                    <Button aria-label="创建并启动回测任务" title="创建并启动回测任务" type="primary" htmlType="submit" icon={<PlayCircleOutlined />} loading={loading}>
                      开始回测
                    </Button>
                    <Button aria-label="取消当前选中的回测任务" title="取消当前选中的回测任务" icon={<StopOutlined />} onClick={handleCancel} disabled={!selectedTaskId}>
                      取消回测
                    </Button>
                  </Space>
                </Form>
              </SectionCard>
            ),
          },
          {
            key: '回测任务',
            label: '回测任务',
            children: (
              <SectionCard title="回测任务" description="选择任务后会刷新绩效结果、曲线、交易明细和日志。">
                <div className="backtest-task-layout" data-testid="backtest-task-layout">
                  <div className="backtest-task-layout__table">
                    <DataTable<BacktestTaskRecord>
                      rowKey="task_id"
                      columns={taskColumns}
                      className="data-table--backtest-tasks"
                      dataSource={tasks}
                      loading={loading}
                      updatedAt={updatedAt}
                      onRefresh={loadAll}
                      pagination={{ current: taskPage.page, pageSize: taskPage.pageSize, total: taskPage.total, showSizeChanger: true }}
                      onChange={(pagination) => setTaskPage({ page: pagination.current ?? 1, pageSize: pagination.pageSize ?? BACKTEST_WORKBENCH_PAGE_SIZE, total: taskPage.total })}
                      data-testid="table-backtest-tasks"
                      tableLayout="fixed"
                      scroll={{ x: TABLE_SCROLL_X.backtestTasks }}
                      rowClassName={(record) => `backtest-clickable-row ${record.task_id === selectedTaskId ? 'backtest-selected-row' : ''}`}
                      onRow={(record) => ({
                        role: 'button',
                        tabIndex: 0,
                        'aria-label': `打开回测结果：${record.backtest_name}`,
                        onClick: () => { void openTaskDetails(record); },
                        onKeyDown: (event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            void openTaskDetails(record);
                          }
                        },
                      })}
                      quickSearch={{ placeholder: '当前页搜索回测/策略/任务ID', fields: ['backtest_name', 'strategy_name', 'task_id'], width: 280 }}
                      quickFilters={[{ label: '任务状态', options: ['pending', 'running', 'success', 'failed', 'cancelled'].map((value) => ({ label: formatStatusLabel(value), value })), getValue: (record) => record.status }]}
                      emptyDescription="暂无回测任务。请先到“新建回测”选择策略并启动回测。"
                    />
                  </div>
                  <aside className="backtest-task-layout__rail" data-testid="backtest-task-flow-rail" aria-label="回测任务工作流">
                    <div className="backtest-task-flow-head">
                      <Typography.Text className="backtest-task-flow-head__eyebrow">BACKTEST FLOW</Typography.Text>
                      <Typography.Text strong className="backtest-task-flow-head__title">可信回测路径</Typography.Text>
                      <Typography.Text type="secondary" className="backtest-task-flow-head__desc">
                        本地 SQLite 推演，回测不调用真实 QMT 下单接口。
                      </Typography.Text>
                    </div>
                    <div className="backtest-task-flow-list">
                      {[
                        [<DatabaseOutlined key="data" />, '先检查数据', '确认日K/分钟K频率、覆盖率和策略依赖一致。'],
                        [<PlayCircleOutlined key="run" />, '创建任务', '任务返回 task_id，前端只轮询进度和状态。'],
                        [<LineChartOutlined key="chart" />, '查看报告', '收益曲线、交易明细、信号审计和日志一起核对。'],
                        [<SafetyCertificateOutlined key="safe" />, '交易隔离', '回测信号不会自动实盘，真实交易仍需人工确认。'],
                      ].map(([icon, title, desc]) => (
                        <div className="backtest-task-flow-step" key={String(title)}>
                          <span className="backtest-task-flow-step__icon">{icon}</span>
                          <span className="backtest-task-flow-step__body">
                            <Typography.Text strong>{title}</Typography.Text>
                            <Typography.Text type="secondary">{desc}</Typography.Text>
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="backtest-task-flow-actions">
                      <Button aria-label="工作流新建回测" title="新建回测" type="primary" icon={<PlayCircleOutlined />} onClick={() => setActiveTab('新建回测')}>
                        新建回测
                      </Button>
                      <Button aria-label="工作流复制回测示例策略" title="复制回测示例策略" icon={<CopyOutlined />} onClick={handleCopyExample}>
                        复制示例
                      </Button>
                      <Button
                        aria-label="工作流查看当前回测报告"
                        title={selectedTask ? `查看回测报告：${selectedTask.backtest_name}` : '请先选择回测任务'}
                        icon={<LineChartOutlined />}
                        disabled={!selectedTask}
                        onClick={() => setActiveTab('绩效结果')}
                      >
                        看报告
                      </Button>
                    </div>
                  </aside>
                </div>
              </SectionCard>
            ),
          },
          {
            key: '绩效结果',
            label: '绩效结果',
            children: (
              <Space direction="vertical" size={8} style={{ width: '100%' }} className="backtest-report-stack">
                <SectionCard
                  className="backtest-report-intro-card"
                  title="研究报告"
                  description="核心指标、资金曲线和回测任务信息集中展示。"
                  extra={(
                    <Space size={8}>
                      <Button
                        size="small"
                        icon={<DownloadOutlined />}
                        disabled={!selectedTaskId || selectedTask?.status === 'running' || selectedTask?.status === 'pending'}
                        onClick={() => selectedTaskId && handleExport(selectedTaskId)}
                      >
                        导出Excel
                      </Button>
                      <DataFreshnessTag label="结果生成" updatedAt={result?.created_at} />
                    </Space>
                  )}
                >
                  {result ? (
                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                      <div className="backtest-report-head">
                        <div>
                          <Typography.Title level={4}>{selectedTask?.backtest_name ?? '回测报告'}</Typography.Title>
                          <Typography.Text type="secondary">本报告基于本地 SQLite 数据和单策略回测任务生成，不调用真实 QMT 交易接口。</Typography.Text>
                        </div>
                        <div className="backtest-report-head__meta">
                          <span>策略：{selectedTask?.strategy_name ?? '暂无'}</span>
                          <span>区间：{selectedTask ? `${selectedTask.start_date} ~ ${selectedTask.end_date}` : '暂无'}</span>
                          <span>初始资金：{selectedTask ? formatMoney(selectedTask.initial_cash) : '暂无'}</span>
                          <span>频率：{selectedTask?.data_frequency ?? '暂无'}</span>
                          <span>生成：{result.created_at}</span>
                        </div>
                      </div>
                      <div className="backtest-report-terminal-strip" aria-label="回测结果终端状态条">
                        {[
                          { label: '最终权益', value: formatMoney(result.final_cash), tone: 'blue' },
                          { label: '总收益', value: formatPercent(result.total_return), tone: result.total_return >= 0 ? 'red' : 'green' },
                          { label: '最大回撤', value: formatPercent(result.max_drawdown), tone: 'orange' },
                          { label: '成交', value: `${result.trade_count} 笔`, tone: 'neutral' },
                          { label: '可信', value: manifest ? trustLabel : '缺少证据', tone: manifest ? 'green' : 'orange' },
                        ].map((item) => (
                          <div className={`backtest-report-terminal-strip__cell backtest-report-terminal-strip__cell--${item.tone}`} key={item.label}>
                            <span>{item.label}</span>
                            <strong>{item.value}</strong>
                          </div>
                        ))}
                      </div>
                      <section className="backtest-analysis-path" aria-label="回测结果分析路径">
                        {backtestAnalysisPath.map((item) => (
                          <button
                            type="button"
                            key={item.title}
                            className="backtest-analysis-path__item"
                            disabled={item.disabled}
                            onClick={item.onClick}
                          >
                            <span className="backtest-analysis-path__icon">{item.icon}</span>
                            <span className="backtest-analysis-path__copy">
                              <strong>{item.title}</strong>
                              <span>{item.description}</span>
                            </span>
                            <span className="backtest-analysis-path__action">{item.actionLabel}</span>
                          </button>
                        ))}
                      </section>
                      <section className="backtest-export-trace-grid" aria-label="回测导出追溯清单">
                        <div className="backtest-export-trace-grid__head">
                          <Typography.Text strong>导出追溯清单</Typography.Text>
                          <Typography.Text type="secondary">导出的 xlsx 会按这些证据拆成独立工作表，便于复盘核对。</Typography.Text>
                        </div>
                        <div className="backtest-export-trace-grid__items">
                          {exportTraceItems.map((item) => (
                            <div className={`backtest-export-trace-item backtest-export-trace-item--${item.tone}`} key={item.title}>
                              <span>{item.title}</span>
                              <strong>{item.value}</strong>
                              <small>{item.detail}</small>
                            </div>
                          ))}
                        </div>
                      </section>
                      {manifest ? (
                        <Space direction="vertical" size={12} style={{ width: '100%' }}>
                          <div className="backtest-trust-strip" aria-label="回测可信状态摘要">
                            {[
                              { label: '可信等级', value: trustLabel },
                              { label: '数据模式', value: formatBacktestQmtMode(manifest.qmt_mode) },
                              { label: '推演模式', value: manifest.data_frequency === '分钟K' ? minuteModeLabel : manifest.fill_mode },
                              { label: '覆盖快照', value: manifestCoverage.length ? `${manifestCoverage.length} 条` : '未记录' },
                              { label: '运行核对', value: strategySnapshotCheckLabel },
                            ].map((item) => (
                              <div className="backtest-trust-strip__item" key={item.label}>
                                <span>{item.label}</span>
                                <strong>{item.value}</strong>
                              </div>
                            ))}
                          </div>
                          <Alert
                            type={trustAlertType}
                            showIcon
                            message={`回测可信等级：${trustLabel}`}
                            description={(
                              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                <Typography.Text>{manifest.trust_message}</Typography.Text>
                                <div className="backtest-evidence-board" data-testid="backtest-evidence-board" aria-label="回测 Manifest 证据链">
                                  {manifestEvidenceSections.map((section) => (
                                    <section className="backtest-evidence-section" data-testid={section.testId} key={section.title}>
                                      <div className="backtest-evidence-section__head">
                                        <strong>{section.title}</strong>
                                        <span>{section.subtitle}</span>
                                      </div>
                                      <div className="backtest-evidence-section__grid">
                                        {section.items.map((item) => (
                                          <div className={`backtest-evidence-cell backtest-evidence-cell--${item.tone}`} key={`${section.title}-${item.label}`}>
                                            <span>{item.label}</span>
                                            <strong title={item.value}>{item.value}</strong>
                                            <small title={item.meta}>{item.meta}</small>
                                          </div>
                                        ))}
                                      </div>
                                    </section>
                                  ))}
                                </div>
                                {manifestUniverse.minute_possible_truncation ? (
                                  <Alert
                                    type="warning"
                                    showIcon
                                    message="分钟信号可能被截断"
                                    description="本次回测存在交易日触达策略返回上限，说明真实触发数量可能更多。正式研究前请提高策略 max_signals 或按区间/股票池分批复核。"
                                  />
                                ) : null}
                              </Space>
                            )}
                          />
                          <Alert
                            className="backtest-snapshot-check-alert"
                            type={strategySnapshotCheckAlertType}
                            showIcon
                            message={(
                              <span className="backtest-snapshot-check-alert__message">
                                <span>策略运行交叉核对：{strategySnapshotCheckLabel}</span>
                                <span className="backtest-snapshot-check-alert__evidence">
                                  {strategySnapshotCheck?.message ?? '尚未返回策略运行快照核对信息，建议复跑后再导出正式报告。'}
                                </span>
                                <span className="backtest-snapshot-check-alert__evidence">
                                  匹配运行：{strategySnapshotCheck?.matched_run_id ?? '暂无'}
                                </span>
                              </span>
                            )}
                            description={(
                              <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                <Typography.Text>核对结论已显示在标题行；这里保留哈希和最新运行编号，便于追溯同一份策略代码。</Typography.Text>
                                <Space size={12} wrap>
                                  <Typography.Text type="secondary">
                                    Manifest哈希：{strategySnapshotCheck?.manifest_hash ? strategySnapshotCheck.manifest_hash.slice(0, 12) : manifest.strategy_code_hash.slice(0, 12)}
                                  </Typography.Text>
                                  <Typography.Text type="secondary">
                                    匹配运行ID：{strategySnapshotCheck?.matched_run_id ?? '暂无'}
                                  </Typography.Text>
                                  <Typography.Text type="secondary">
                                    最新运行：{strategySnapshotCheck?.latest_run_id ?? '暂无'}
                                  </Typography.Text>
                                  <Typography.Text type="secondary">
                                    最新哈希：{strategySnapshotCheck?.latest_code_hash ? strategySnapshotCheck.latest_code_hash.slice(0, 12) : '暂无'}
                                  </Typography.Text>
                                </Space>
                              </Space>
                            )}
                          />
                        </Space>
                      ) : (
                        <Alert
                          type="warning"
                          showIcon
                          message="历史回测缺少可信证据清单"
                          description="这条回测是在 Manifest 功能启用前生成的，未保存策略代码哈希、覆盖率快照和股票池摘要；建议点击复跑，生成可复查的新报告。"
                        />
                      )}
                      {officialPathLogs.length > 0 ? (
                        <div className="backtest-official-path">
                          <Typography.Text strong>官方路径逐步推演</Typography.Text>
                          <Row gutter={[12, 12]}>
                            {officialPathLogs.map((log) => (
                              <Col xs={24} md={12} xl={8} key={log.id}>
                                <div className="backtest-official-path__item">
                                  <Typography.Text strong>{log.message}</Typography.Text>
                                  {log.technical_detail ? <Typography.Text type="secondary">{log.technical_detail}</Typography.Text> : null}
                                </div>
                              </Col>
                            ))}
                          </Row>
                        </div>
                      ) : null}
                    </Space>
                  ) : (
                    <div className="backtest-report-empty-workbench" data-testid="backtest-report-empty-workbench">
                      <section className="backtest-report-empty-workbench__intro">
                        <span>REPORT EMPTY</span>
                        <strong>暂无可分析报告</strong>
                        <Typography.Text type="secondary">
                          请先选择已完成任务，或新建回测；任务成功后这里会展示收益、回撤、资金曲线、成交明细和日志证据。
                        </Typography.Text>
                        <div className="backtest-report-empty-workbench__facts" aria-label="空报告状态可信边界">
                          {[
                            ['数据源', 'SQLite 落库'],
                            ['交易接口', '不会下单'],
                            ['执行方式', '长任务'],
                            ['复盘证据', '可导出'],
                          ].map(([label, value]) => (
                            <div key={label}>
                              <small>{label}</small>
                              <strong>{value}</strong>
                            </div>
                          ))}
                        </div>
                      </section>
                      <section className="backtest-report-empty-workbench__checks" aria-label="回测报告生成路径">
                        {[
                          { title: '选择策略', desc: 'Python 策略接口通过检查' },
                          { title: '核对数据', desc: '日K/分钟K覆盖率和区间一致' },
                          { title: '频率匹配', desc: '分钟策略必须使用分钟K数据' },
                          { title: '成交规则', desc: '按本地 SQLite 推演，不调用实盘接口' },
                          { title: '等待任务', desc: '长任务完成后生成 task_id 报告' },
                          { title: '资金对账', desc: '权益、现金、持仓和费用互相校验' },
                          { title: '复盘证据', desc: '曲线、明细、日志和 Excel 统一追溯' },
                          { title: '导出归档', desc: '正式复盘前导出单文件证据包' },
                        ].map((item, index) => (
                          <div className="backtest-report-empty-workbench__step" key={item.title}>
                            <span>{String(index + 1).padStart(2, '0')}</span>
                            <strong>{item.title}</strong>
                            <small>{item.desc}</small>
                          </div>
                        ))}
                      </section>
                      <section className="backtest-report-empty-workbench__actions" aria-label="回测报告空状态操作">
                        <div className="backtest-report-empty-workbench__action-buttons">
                          <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => setActiveTab('新建回测')}>
                            新建回测
                          </Button>
                          <Button icon={<FileSearchOutlined />} onClick={() => setActiveTab('回测任务')}>
                            查看任务
                          </Button>
                          <Button icon={<SearchOutlined />} loading={loading} onClick={() => void loadAll()}>
                            刷新状态
                          </Button>
                        </div>
                        <div className="backtest-report-empty-workbench__outputs" aria-label="报告生成后输出内容">
                          <strong>报告输出</strong>
                          {['资金曲线', '回撤曲线', '成交明细', '信号审计', '运行日志', 'Excel 归档'].map((item) => (
                            <span key={item}>{item}</span>
                          ))}
                        </div>
                        <div className="backtest-report-empty-workbench__next">
                          <strong>正式复盘前</strong>
                          <Typography.Text type="secondary">
                            先确认频率、覆盖率、成交规则和资金对账；分钟策略必须看到分钟级推演证据后再比较收益。
                          </Typography.Text>
                        </div>
                      </section>
                    </div>
                  )}
                </SectionCard>
                {result ? (
                  <>
                    <div
                      className="backtest-report-workbench"
                      data-testid="backtest-result-workbench"
                      data-workbench-role="backtest-report-workstation"
                      data-layout="chart-left-inspector-right"
                      aria-label="回测报告图表与核心指标"
                    >
                      <div className="backtest-report-workbench__topbar" data-testid="backtest-report-workbench-topbar">
                        <div className="backtest-report-workbench__topbar-title">
                          <span>RESEARCH WORKSTATION</span>
                          <strong>资金曲线推演台</strong>
                        </div>
                        <div className="backtest-report-workbench__topbar-meta" aria-label="回测报告工作台摘要">
                          <span>任务 {selectedTaskId ?? '未选择'}</span>
                          <span>{selectedTask?.data_frequency ?? '暂无'} / {selectedTask?.fill_mode ?? '暂无'}</span>
                          <span>权益点 {equity.length}</span>
                          <span>成交 {trades.length}</span>
                        </div>
                      </div>
                      <div className="backtest-report-workbench__chart" data-workbench-zone="chart">
                        <BacktestChart
                          rows={equity}
                          trades={trades}
                          height={400}
                          selectedTradeId={focusedTrade?.id ?? null}
                          selectedEquityDate={selectedEquityDate}
                          onSelectTrade={handleChartTradeSelect}
                          onPreviewTrade={handleChartTradePreview}
                          onPreviewEquity={handleChartEquityPreview}
                          onSelectEquityDate={handleChartEquitySelect}
                        />
                      </div>
                      <section className="backtest-report-side-panel" data-workbench-zone="inspector" aria-label="回测核心指标">
                        <div className="backtest-report-side-panel__head">
                          <div>
                            <Typography.Text strong>核心指标</Typography.Text>
                            <Typography.Text type="secondary">{selectedTask?.data_frequency ?? '暂无'} / {selectedTask?.fill_mode ?? '暂无'}</Typography.Text>
                          </div>
                          <div className="backtest-report-side-panel__actions">
                            <Button size="small" onClick={() => setActiveTab('交易明细')}>明细</Button>
                            <Button size="small" onClick={() => setActiveTab('回测日志')}>日志</Button>
                          </div>
                        </div>
                        <div className="backtest-report-side-panel__status-row" aria-label="回测指标摘要">
                          <span>资金对账 {finalEquityMatched ? '通过' : '需核对'}</span>
                          <span>日志 {reportLogSummary.length}</span>
                          <span>明细 {trades.length}</span>
                        </div>
                        <Row gutter={[6, 6]} className="backtest-result-grid">
                          <Col xs={12}><MetricCard label="总收益率" value={formatPercent(result.total_return)} subValue="区间累计" tone={result.total_return >= 0 ? 'red' : 'green'} /></Col>
                          <Col xs={12}><MetricCard label="年化收益率" value={formatPercent(result.annual_return)} subValue="折算年化" tone={result.annual_return >= 0 ? 'red' : 'green'} /></Col>
                          <Col xs={12}><MetricCard label="最大回撤" value={formatPercent(result.max_drawdown)} subValue="风险指标" tone="orange" /></Col>
                          <Col xs={12}><MetricCard label="胜率" value={formatPercent(result.win_rate)} subValue="盈利交易占比" tone="blue" /></Col>
                          <Col xs={12}><MetricCard label="成交次数" value={result.trade_count} subValue={`买 ${result.buy_count ?? 0} / 卖 ${result.sell_count ?? 0}`} /></Col>
                          <Col xs={12}><MetricCard label="盈亏比" value={result.profit_loss_ratio} subValue="平均盈亏" /></Col>
                          <Col xs={12}><MetricCard label="最终权益" value={<FinancialNumber value={result.final_cash} tone="primary" compact />} subValue="现金 + 持仓" /></Col>
                          <Col xs={12}><MetricCard label="平均持仓" value={result.average_holding_days} subValue="交易日" /></Col>
                        </Row>
                        <div className="backtest-report-risk-ladder" aria-label="回测可信核对明细">
                          {[
                            { label: '资金对账', value: finalEquityMatched ? '通过' : '需核对', tone: finalEquityMatched ? 'green' : 'orange' },
                            { label: '未平仓', value: `${result.open_position_count} 只`, tone: result.open_position_count > 0 ? 'orange' : 'green' },
                            { label: '总费用', value: formatMoney(result.total_fee), tone: 'neutral' },
                            { label: '代码哈希', value: manifest?.strategy_code_hash ? manifest.strategy_code_hash.slice(0, 12) : '暂无', tone: manifest ? 'blue' : 'orange' },
                            { label: '运行核对', value: strategySnapshotCheckLabel, tone: strategySnapshotCheck?.status === 'matched' ? 'green' : 'orange' },
                          ].map((item) => (
                            <div className={`backtest-report-risk-ladder__row backtest-report-risk-ladder__row--${item.tone}`} key={item.label}>
                              <span>{item.label}</span>
                              <strong>{item.value}</strong>
                            </div>
                          ))}
                        </div>
                        {renderStockTradeChainPanel('side')}
                        <div className="backtest-report-checkpoints" aria-label="回测曲线关键点">
                          <div className="backtest-report-checkpoints__title">曲线关键点</div>
                          {equityCheckpoints.length > 0 ? (
                            equityCheckpoints.map((item) => (
                              <div className={`backtest-report-checkpoint backtest-report-checkpoint--${item.tone}`} key={item.label}>
                                <span>{item.label}</span>
                                <strong>{item.value}</strong>
                                <small>{item.meta}</small>
                              </div>
                            ))
                          ) : (
                            <div className="backtest-report-checkpoint backtest-report-checkpoint--empty">
                              <span>暂无权益曲线</span>
                              <strong>--</strong>
                              <small>选择成功任务后显示关键点</small>
                            </div>
                          )}
                        </div>
                        <Alert
                          type={result.open_position_count > 0 ? 'warning' : 'success'}
                          showIcon
                          message="回测可信度核对"
                          description={
                            <Space direction="vertical" size={4}>
                              <Typography.Text>
                                期末现金 {formatMoney(result.ending_cash)} + 未平仓市值 {formatMoney(result.open_market_value)}
                                {finalEquityMatched ? ' = ' : ' ≈ '}
                                最终权益 {formatMoney(result.final_cash)}。
                              </Typography.Text>
                              <Typography.Text>
                                未平仓 {result.open_position_count} 只；总费用 {formatMoney(result.total_fee)}；已实现盈亏 {formatMoney(result.realized_pnl)}。
                              </Typography.Text>
                              <Typography.Text type="secondary">
                                只读取本地 SQLite 历史行情，不调用真实 QMT 下单接口。
                              </Typography.Text>
                            </Space>
                          }
                        />
                      </section>
                    </div>
                    <div
                      className="backtest-report-bottom-grid"
                      data-testid="backtest-report-bottom-grid"
                      data-workbench-role="backtest-report-dock"
                      aria-label="回测报告底部明细与任务信息"
                    >
                      <SectionCard
                        className={[
                          'backtest-report-dock-card backtest-report-trade-card',
                          activeEquityPreview ? 'backtest-report-trade-card--synced' : '',
                          activeEquityPreview ? `backtest-report-trade-card--${activeEquitySyncTone}` : '',
                        ].filter(Boolean).join(' ')}
                        title="交易摘要"
                        description="基于当前回测明细页展示最好/最差交易、费用和成交概览。"
                        extra={<Button size="small" onClick={() => setActiveTab('交易明细')}>查看明细</Button>}
                      >
                        {activeEquityPreview ? (
                          <div
                            className={`backtest-report-sync-ribbon backtest-report-sync-ribbon--${activeEquitySyncTone}`}
                            data-testid="backtest-report-sync-ribbon"
                            aria-label="图表与交易摘要同步状态"
                          >
                            <span>图表定位同步</span>
                            <strong>{activeEquityPreview.trade_date}</strong>
                            <small>
                              {activeEquityTradeSourceLabel} / 当日变化 {formatMoneyByUnit(activeEquityDailyPnl)} / 成交 {activeEquityTradeRows.length} 条 / 成交额 {formatMoneyByUnit(activeEquityTradeAmount)}
                            </small>
                          </div>
                        ) : null}
                        {activeEquityPreview ? (
                          <div className="backtest-report-equity-preview" data-testid="backtest-report-equity-preview" aria-label="曲线日期核对">
                            <div>
                              <span>{activeEquityPreview.trade_date === selectedEquityDate ? '已定位曲线日期' : 'hover 曲线日期'}</span>
                              <strong>{activeEquityPreview.trade_date}</strong>
                              <small>{activeEquityTradeSourceLabel} {activeEquityTradeRows.length} 条</small>
                            </div>
                            <div>
                              <span>权益 / 当日变化</span>
                              <strong>{formatMoney(activeEquityPreview.equity)}</strong>
                              <small className={activeEquityDailyPnl >= 0 ? 'is-profit' : 'is-loss'}>{formatMoney(activeEquityDailyPnl)}</small>
                            </div>
                            <div>
                              <span>现金 / 回撤</span>
                              <strong>{formatMoney(activeEquityPreview.cash)}</strong>
                              <small>{formatPercent(activeEquityPreview.drawdown)}</small>
                            </div>
                            <Button
                              size="small"
                              data-testid="backtest-report-equity-preview-locate"
                              onMouseDown={(event) => {
                                event.preventDefault();
                                handleChartEquitySelect(activeEquityPreview);
                              }}
                              onClick={() => handleChartEquitySelect(activeEquityPreview)}
                            >
                              定位当日
                            </Button>
                          </div>
                        ) : (
                          <div className="backtest-report-equity-preview backtest-report-equity-preview--empty" data-testid="backtest-report-equity-preview">
                            hover 曲线或点击关键点后，这里会显示当日资金、回撤和当前已加载成交背景。
                          </div>
                        )}
                        {activeEquityPreview ? (
                          <div
                            className={`backtest-report-day-trades backtest-report-day-trades--${activeEquitySyncTone}`}
                            data-testid="backtest-report-day-trades"
                            aria-label="当前曲线日期成交摘要"
                          >
                            <div className="backtest-report-day-trades__head">
                              <span>当日成交摘要</span>
                              <strong>{activeEquityTradeRows.length} 条 / 盈亏 {formatMoneyByUnit(activeEquityTradePnl)}</strong>
                            </div>
                            {activeEquityTradePreviewRows.length > 0 ? (
                              <div className="backtest-report-day-trades__list">
                                {activeEquityTradePreviewRows.map((trade) => (
                                  <button
                                    type="button"
                                    className="backtest-report-day-trade"
                                    key={trade.id}
                                    onClick={() => handleChartTradeSelect(trade)}
                                    title={`定位 ${formatStockLabel(trade.symbol, trade.name)} / ${trade.trade_time}`}
                                  >
                                    <span>{trade.trade_time.slice(11, 16)}</span>
                                    <strong>{formatStockLabel(trade.symbol, trade.name)}</strong>
                                    <small>{formatSide(trade.side)} / {formatMoneyByUnit(trade.pnl)}</small>
                                  </button>
                                ))}
                                {activeEquityTradeRows.length > activeEquityTradePreviewRows.length ? (
                                  <div className="backtest-report-day-trades__more">
                                    另有 {activeEquityTradeRows.length - activeEquityTradePreviewRows.length} 条，可在交易明细按服务端分页继续核对。
                                  </div>
                                ) : null}
                              </div>
                            ) : (
                              <div className="backtest-report-day-trades__empty">
                                当前查询范围内没有该日成交；定位当日会按服务端日期条件复核完整分页。
                              </div>
                            )}
                          </div>
                        ) : null}
                        {previewTrade ? (
                          <div className="backtest-report-preview-trade" data-testid="backtest-report-preview-trade" aria-label="图表买卖点预览">
                            <div>
                              <span>{previewTrade.id === focusedTrade?.id ? '已定位买卖点' : 'hover 预览买卖点'}</span>
                              <strong>{formatStockLabel(previewTrade.symbol, previewTrade.name)}</strong>
                              <small>{previewTrade.trade_time}</small>
                            </div>
                            <div>
                              <span>{formatSide(previewTrade.side)} / {formatPrice(previewTrade.price)}</span>
                              <strong>{formatMoney(previewTrade.amount)}</strong>
                              <small>盈亏 {formatMoney(previewTrade.pnl)} / 费用 {formatMoney(previewTrade.fee)}</small>
                            </div>
                            <Space size={6}>
                              <Button
                                size="small"
                                data-testid="backtest-report-preview-locate"
                                onMouseDown={(event) => {
                                  event.preventDefault();
                                  handleChartTradeSelect(previewTrade);
                                }}
                                onClick={() => handleChartTradeSelect(previewTrade)}
                              >
                                定位明细
                              </Button>
                              <Button size="small" onClick={() => openTradeDetail(previewTrade)}>详情</Button>
                            </Space>
                          </div>
                        ) : (
                          <div className="backtest-report-preview-trade backtest-report-preview-trade--empty" data-testid="backtest-report-preview-trade">
                            hover 图表右侧买卖点后，这里会显示对应交易，并可一键跳到交易明细。
                          </div>
                        )}
                        {trades.length > 0 ? (
                          <Row gutter={[6, 6]} className="backtest-trade-summary">
                            <Col xs={24} md={8}>
                              <div className="backtest-summary-tile">
                                <Typography.Text type="secondary">最好交易</Typography.Text>
                                <Typography.Text strong>{bestTrade ? `${bestTrade.symbol} ${formatMoney(bestTrade.pnl)}` : '暂无'}</Typography.Text>
                              </div>
                            </Col>
                            <Col xs={24} md={8}>
                              <div className="backtest-summary-tile">
                                <Typography.Text type="secondary">最差交易</Typography.Text>
                                <Typography.Text strong>{worstTrade ? `${worstTrade.symbol} ${formatMoney(worstTrade.pnl)}` : '暂无'}</Typography.Text>
                              </div>
                            </Col>
                            <Col xs={24} md={8}>
                              <div className="backtest-summary-tile">
                                <Typography.Text type="secondary">当前页费用合计</Typography.Text>
                                <Typography.Text strong>{formatMoney(totalFee)}</Typography.Text>
                              </div>
                            </Col>
                          </Row>
                        ) : (
                          <EmptyGuide description="暂无交易摘要。回测成功并产生交易明细后，这里会显示当前页最好/最差交易和费用合计。" />
                        )}
                      </SectionCard>
                      <SectionCard
                        className="backtest-report-dock-card backtest-report-task-card"
                        title="任务信息"
                        description="当前结果对应的任务、区间和生成时间。"
                        extra={(
                          <Button
                            size="small"
                            disabled={!selectedTaskId || selectedTask?.status === 'running' || selectedTask?.status === 'pending'}
                            onClick={() => selectedTaskId && handleExport(selectedTaskId)}
                          >
                            导出
                          </Button>
                        )}
                      >
                        <div className="backtest-task-evidence-strip" data-testid="backtest-task-evidence" aria-label="回测任务关键证据">
                          {[
                            { label: '任务ID', value: selectedTaskId ?? '暂无', meta: '唯一回测任务' },
                            { label: '区间/频率', value: selectedTask ? `${selectedTask.start_date}~${selectedTask.end_date}` : '暂无', meta: `${selectedTask?.data_frequency ?? '暂无'} / ${selectedTask?.fill_mode ?? '暂无'}` },
                            { label: '资金口径', value: selectedTask ? formatMoney(selectedTask.initial_cash) : '暂无', meta: `单笔 ${selectedTask ? formatMoneyByUnit(selectedTask.single_order_amount) : '暂无'}` },
                            { label: 'Manifest', value: manifest?.strategy_code_hash ? manifest.strategy_code_hash.slice(0, 12) : '暂无', meta: strategySnapshotCheckLabel },
                          ].map((item) => (
                            <div className="backtest-task-evidence-strip__cell" key={item.label}>
                              <span>{item.label}</span>
                              <strong title={item.value}>{item.value}</strong>
                              <small title={item.meta}>{item.meta}</small>
                            </div>
                          ))}
                        </div>
                        <Descriptions bordered size="small" column={2} className="backtest-task-descriptions">
                          <Descriptions.Item label="任务ID">{selectedTaskId ?? '暂无'}</Descriptions.Item>
                          <Descriptions.Item label="回测名称">{selectedTask?.backtest_name ?? '暂无'}</Descriptions.Item>
                          <Descriptions.Item label="策略名称">{selectedTask?.strategy_name ?? '暂无'}</Descriptions.Item>
                          <Descriptions.Item label="回测区间">{selectedTask ? `${selectedTask.start_date} ~ ${selectedTask.end_date}` : '暂无'}</Descriptions.Item>
                          <Descriptions.Item label="数据频率">{selectedTask?.data_frequency ?? '暂无'}</Descriptions.Item>
                          <Descriptions.Item label="成交模式">{selectedTask?.fill_mode ?? '暂无'}</Descriptions.Item>
                          <Descriptions.Item label="初始资金">{selectedTask ? formatMoney(selectedTask.initial_cash) : '暂无'}</Descriptions.Item>
                          <Descriptions.Item label="单笔金额">{selectedTask ? formatMoney(selectedTask.single_order_amount) : '暂无'}</Descriptions.Item>
                          <Descriptions.Item label="手续费率">{selectedTask?.fee_rate ?? '暂无'}</Descriptions.Item>
                          <Descriptions.Item label="印花税率">{selectedTask?.stamp_tax_rate ?? '暂无'}</Descriptions.Item>
                          <Descriptions.Item label="滑点">{selectedTask?.slippage ?? '暂无'}</Descriptions.Item>
                          <Descriptions.Item label="代码哈希">{manifest?.strategy_code_hash ? manifest.strategy_code_hash.slice(0, 12) : '暂无'}</Descriptions.Item>
                          <Descriptions.Item label="快照核对">{strategySnapshotCheckLabel}</Descriptions.Item>
                          <Descriptions.Item label="匹配运行ID">{strategySnapshotCheck?.matched_run_id ?? '暂无'}</Descriptions.Item>
                          <Descriptions.Item label="生成时间">{result?.created_at ?? '暂无'}</Descriptions.Item>
                        </Descriptions>
                      </SectionCard>
                      <SectionCard
                        className="backtest-report-dock-card backtest-report-log-card"
                        title="日志摘要"
                        description="优先显示官方路径日志；没有官方路径时显示最近回测日志。"
                        extra={<Button size="small" onClick={() => setActiveTab('回测日志')}>查看日志</Button>}
                      >
                        {reportLogSummary.length > 0 ? (
                          <div className="backtest-report-log-list" aria-label="回测报告日志摘要">
                            {reportLogSummary.map((log) => (
                              <button
                                type="button"
                                className="backtest-report-log-item"
                                key={log.id}
                                onClick={() => setLogDrawer({
                                  title: '回测日志详情',
                                  subtitle: log.created_at,
                                  status: log.level,
                                  statusTone: log.level === 'error' ? 'red' : log.level === 'warning' ? 'orange' : 'blue',
                                  width: 720,
                                  fieldColumns: 2,
                                  className: 'backtest-log-detail-drawer',
                                  message: log.message,
                                  technicalDetail: log.technical_detail ?? JSON.stringify(log, null, 2),
                                  fields: [
                                    { label: '回测ID', value: log.backtest_id },
                                    { label: '级别', value: log.level },
                                    { label: '时间', value: log.created_at },
                                  ],
                                })}
                              >
                                <span className="backtest-report-log-item__level">{log.level}</span>
                                <span className="backtest-report-log-item__message">{log.message}</span>
                                <span className="backtest-report-log-item__time">{log.created_at}</span>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <EmptyGuide description="暂无日志摘要。回测任务完成后，这里会显示官方路径、成交、资金和错误诊断日志。" />
                        )}
                      </SectionCard>
                    </div>
                  </>
                ) : null}
              </Space>
            ),
          },
          {
            key: '交易明细',
            label: '交易明细',
            children: (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <SectionCard
                  title="交易明细"
                  description={selectedTask ? `当前任务 ${selectedTask.task_id}，回测区间 ${selectedTask.start_date} ~ ${selectedTask.end_date}。逐笔成交、费用和触发原因均来自该任务后端接口。` : '逐笔成交、费用和触发原因，用于核对资金曲线。'}
                >
                  {focusedTrade ? (
                    <Alert
                      className="backtest-trade-focus-panel"
                      data-testid="backtest-trade-linkage-panel"
                      type="info"
                      showIcon
                      message="已从曲线买卖点定位到交易明细"
                      description={(
                        <Space direction="vertical" size={8} style={{ width: '100%' }}>
                          <Typography.Text>
                            当前显示 {focusedTrade.symbol} 在 {focusedTradeDate} 的当前页成交记录；若要核对全部成交，请清除定位后翻页或导出完整 Excel。
                          </Typography.Text>
                          <div className="backtest-trade-linkage-grid" data-testid="backtest-trade-linkage-grid">
                            <div>
                              <span>定位记录</span>
                              <strong>#{focusedTrade.id}</strong>
                              <small>{formatStockLabel(focusedTrade.symbol, focusedTrade.name)}</small>
                            </div>
                            <div>
                              <span>方向 / 成交价</span>
                              <strong>{formatSide(focusedTrade.side)} / {formatPrice(focusedTrade.price)}</strong>
                              <small>{focusedTrade.trade_time}</small>
                            </div>
                            <div>
                              <span>同日同股</span>
                              <strong>{tradeDetailRows.length} 条</strong>
                              <small>{focusedTradeSideCount} 条同方向</small>
                            </div>
                            <div>
                              <span>匹配状态</span>
                              <strong>{focusedTradeMatched ? '已命中当前页' : '当前页未命中'}</strong>
                              <small>{focusedTradeMatched ? '下方高亮行为定位成交' : '建议导出 Excel 或翻页核对'}</small>
                            </div>
                          </div>
                        </Space>
                      )}
                      action={(
                        <Space size={6}>
                          <Button size="small" onClick={() => setActiveTab('绩效结果')}>
                            回到曲线
                          </Button>
                          <Button size="small" onClick={() => openTradeDetail(focusedTrade)}>
                            查看详情
                          </Button>
                          <Button size="small" onClick={clearFocusedTrade}>
                            清除定位
                          </Button>
                        </Space>
                      )}
                    />
                  ) : selectedEquityDate ? (
                    <Alert
                      className="backtest-trade-focus-panel"
                      data-testid="backtest-equity-date-linkage-panel"
                      type="info"
                      showIcon
                      message="已从曲线日期定位到交易明细"
                      description={(
                        <Space direction="vertical" size={8} style={{ width: '100%' }}>
                          <Typography.Text>
                            后端已按 {selectedEquityDate} 查询成交明细，当前分页显示 {tradeDetailRows.length} / {tradePage.total || tradeDetailRows.length} 条；可继续翻页或导出完整 Excel 核对。
                          </Typography.Text>
                          <div className="backtest-trade-linkage-grid" data-testid="backtest-equity-date-linkage-grid">
                            <div>
                              <span>曲线日期</span>
                              <strong>{selectedEquityDate}</strong>
                              <small>{activeEquityPreview ? '已匹配资金曲线' : '当前页未匹配资金曲线'}</small>
                            </div>
                            <div>
                              <span>权益 / 现金</span>
                              <strong>{activeEquityPreview ? formatMoneyByUnit(activeEquityPreview.equity) : '暂无'}</strong>
                              <small>{activeEquityPreview ? formatMoneyByUnit(activeEquityPreview.cash) : '暂无'}</small>
                            </div>
                            <div>
                              <span>当日成交</span>
                              <strong>{tradePage.total || tradeDetailRows.length} 条</strong>
                              <small>当前页买 {tradeDetailStats.buyCount} / 卖 {tradeDetailStats.sellCount}</small>
                            </div>
                            <div>
                              <span>当日盈亏</span>
                              <strong>{formatMoneyByUnit(activeEquityDailyPnl)}</strong>
                              <small>费用 {formatMoneyByUnit(tradeDetailTotalFee)}</small>
                            </div>
                          </div>
                        </Space>
                      )}
                      action={(
                        <Space size={6}>
                          <Button size="small" onClick={() => setActiveTab('绩效结果')}>
                            回到曲线
                          </Button>
                          <Button size="small" onClick={clearFocusedTrade}>
                            清除定位
                          </Button>
                        </Space>
                      )}
                    />
                  ) : null}
                  {focusedTrade ? renderStockTradeChainPanel('wide') : null}
                  <div className="backtest-trade-audit-grid" aria-label="当前页交易明细核对摘要">
                    <div className="backtest-trade-audit-card">
                      <Typography.Text type="secondary">{tradeDetailScopeLabel}买 / 卖</Typography.Text>
                      <Typography.Text strong>{tradeDetailStats.buyCount} / {tradeDetailStats.sellCount}</Typography.Text>
                    </div>
                    <div className="backtest-trade-audit-card">
                      <Typography.Text type="secondary">{tradeDetailScopeLabel}股票 / 成对</Typography.Text>
                      <Typography.Text strong>{tradeDetailStats.symbolCount} / {tradeDetailStats.pairedSymbolCount}</Typography.Text>
                    </div>
                    <div className="backtest-trade-audit-card">
                      <Typography.Text type="secondary">{tradeDetailScopeLabel}盈亏</Typography.Text>
                      <Typography.Text strong type={tradeDetailStats.pagePnl >= 0 ? 'danger' : 'success'}>{formatMoney(tradeDetailStats.pagePnl)}</Typography.Text>
                    </div>
                    <div className="backtest-trade-audit-card">
                      <Typography.Text type="secondary">{tradeDetailScopeLabel}胜率</Typography.Text>
                      <Typography.Text strong>{formatPercent(tradeDetailStats.winRate)}</Typography.Text>
                    </div>
                    <div className="backtest-trade-audit-card">
                      <Typography.Text type="secondary">{tradeDetailScopeLabel}费用</Typography.Text>
                      <Typography.Text strong>{formatMoney(tradeDetailTotalFee)}</Typography.Text>
                    </div>
                    <div className="backtest-trade-audit-card">
                      <Typography.Text type="secondary">平均成交额</Typography.Text>
                      <Typography.Text strong>{formatMoney(tradeDetailStats.avgAmount)}</Typography.Text>
                    </div>
                  </div>
                  <div className="backtest-filter-summary" data-testid="backtest-trade-filter-summary" aria-label="交易明细当前筛选条件">
                    <div className="backtest-filter-summary__head">
                      <Typography.Text strong>当前筛选条件</Typography.Text>
                      <Tag color={tradeKeyword || tradeSideFilter || focusedTrade || selectedEquityDate ? 'blue' : 'default'}>{tradeKeyword || tradeSideFilter || focusedTrade || selectedEquityDate ? '已筛选' : '全部'}</Tag>
                    </div>
                    <div className="backtest-filter-summary__items">
                      {tradeFilterSummaryItems.map((item) => (
                        <span key={item.label} className="backtest-filter-summary__item">
                          <small>{item.label}</small>
                          <strong title={item.value}>{item.value}</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                  <DataTable<BacktestTradeRecord>
                    rowKey="id"
                    columns={tradeColumns}
                    className="data-table--backtest-trades"
                    dataSource={tradeDetailRows}
                    loading={loading}
                    updatedAt={updatedAt}
                    onRefresh={loadAll}
                    pagination={focusedTrade ? false : { current: tradePage.page, pageSize: tradePage.pageSize, total: tradePage.total, showSizeChanger: true }}
                    onChange={(pagination) => setTradePage({ page: pagination.current ?? 1, pageSize: pagination.pageSize ?? BACKTEST_WORKBENCH_PAGE_SIZE, total: tradePage.total })}
                    data-testid="table-backtest-trades"
                    tableLayout="fixed"
                    scroll={{ x: 'max-content' }}
                    rowClassName={(record) => (record.id === focusedTrade?.id ? 'backtest-focused-trade-row' : '')}
                    toolbarTitle={focusedTrade ? '联动成交明细' : selectedEquityDate ? '曲线日期成交明细' : undefined}
                    toolbarDescription={focusedTrade
                      ? `来自图表买卖点：${formatStockLabel(focusedTrade.symbol, focusedTrade.name)} / ${focusedTrade.trade_time} / ${formatSide(focusedTrade.side)}。清除定位后恢复当前页全部成交。`
                      : selectedEquityDate
                        ? `来自资金曲线日期：${selectedEquityDate}，后端已按 start_date=end_date 查询该日成交并分页展示。清除定位后恢复当前任务全量成交。`
                        : undefined}
                    quickFilterScope="server"
                    quickFilterHint="服务端筛选，按当前回测任务全量查询；输入关键字后按回车或点击搜索生效。"
                    quickSearch={{
                      placeholder: '全量搜索股票/原因',
                      fields: ['symbol', 'name', 'reason'],
                      width: 260,
                      value: tradeSearchInput,
                      onChange: handleTradeSearchInputChange,
                      onSearch: commitTradeKeyword,
                    }}
                    quickFilters={[{
                      label: '方向',
                      options: [{ label: '买入', value: 'BUY' }, { label: '卖出', value: 'SELL' }],
                      getValue: (record) => record.side,
                      value: tradeSideFilter,
                      onChange: (value) => {
                        setTradeSideFilter(value);
                        setTradePage((previous) => ({ ...previous, page: 1 }));
                      },
                    }]}
                    emptyDescription={focusedTrade
                      ? '当前页没有找到该买卖点的同日同股交易，请清除定位后翻页或导出完整 Excel 核对。'
                      : selectedEquityDate
                        ? '后端按该曲线日期查询后没有成交记录，请核对资金曲线变化、信号审计或导出完整 Excel。'
                        : '暂无回测交易明细。回测成功并产生买卖信号后会显示成交记录。'}
                    emptyAction={<Button onClick={() => setActiveTab(selectedTaskId ? '绩效结果' : '回测任务')}>{selectedTaskId ? '返回绩效结果' : '选择回测任务'}</Button>}
                  />
                </SectionCard>
                <SectionCard
                  title="信号审计"
                  description={selectedTask ? `当前任务 ${selectedTask.task_id}，信号时间必须落在 ${selectedTask.start_date} ~ ${selectedTask.end_date} 内。` : '逐条记录策略信号、成交状态和跳过原因，用于确认筛选与撮合是否真实执行。'}
                >
                  <div className="backtest-filter-summary" data-testid="backtest-signal-filter-summary" aria-label="信号审计当前筛选条件">
                    <div className="backtest-filter-summary__head">
                      <Typography.Text strong>当前筛选条件</Typography.Text>
                      <Tag color={signalKeyword || signalStatusFilter || selectedEquityDate ? 'blue' : 'default'}>{signalKeyword || signalStatusFilter || selectedEquityDate ? '已筛选' : '全部'}</Tag>
                    </div>
                    <div className="backtest-filter-summary__items">
                      {signalFilterSummaryItems.map((item) => (
                        <span key={item.label} className="backtest-filter-summary__item">
                          <small>{item.label}</small>
                          <strong title={item.value}>{item.value}</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                  <DataTable<BacktestSignalRecord>
                    rowKey="id"
                    columns={signalColumns}
                    className="data-table--backtest-signals"
                    dataSource={signalAudits}
                    loading={loading}
                    updatedAt={updatedAt}
                    onRefresh={loadAll}
                    pagination={{ current: signalPage.page, pageSize: signalPage.pageSize, total: signalPage.total, showSizeChanger: true }}
                    onChange={(pagination) => setSignalPage({ page: pagination.current ?? 1, pageSize: pagination.pageSize ?? BACKTEST_WORKBENCH_PAGE_SIZE, total: signalPage.total })}
                    data-testid="table-backtest-signals"
                    tableLayout="fixed"
                    scroll={{ x: 'max-content' }}
                    toolbarTitle={selectedEquityDate ? '曲线日期信号审计' : undefined}
                    toolbarDescription={selectedEquityDate
                      ? `来自资金曲线日期：${selectedEquityDate}，后端已按 start_date=end_date 查询该日信号并分页展示。清除定位后恢复当前任务全量信号。`
                      : undefined}
                    quickFilterScope="server"
                    quickFilterHint="服务端筛选，按当前回测任务全量查询；输入关键字后按回车或点击搜索生效。"
                    quickSearch={{
                      placeholder: '全量搜索信号/原因/跳过原因',
                      fields: ['symbol', 'name', 'action', 'status', 'reason', 'skip_reason'],
                      width: 280,
                      value: signalSearchInput,
                      onChange: handleSignalSearchInputChange,
                      onSearch: commitSignalKeyword,
                    }}
                    quickFilters={[{
                      label: '信号状态',
                      options: ['已成交', '跳过', '未成交', '观察'].map((value) => ({ label: value, value })),
                      getValue: (record) => record.status,
                      value: signalStatusFilter,
                      onChange: (value) => {
                        setSignalStatusFilter(value);
                        setSignalPage((previous) => ({ ...previous, page: 1 }));
                      },
                    }]}
                    emptyDescription={selectedEquityDate
                      ? '后端按该曲线日期查询后没有信号审计记录，请核对成交明细、策略日志或导出完整 Excel。'
                      : '暂无回测信号审计。新回测完成后会记录每条信号的成交或跳过原因；旧历史回测建议复跑生成审计。'}
                    emptyAction={<Button onClick={() => setActiveTab(selectedTaskId ? '绩效结果' : '新建回测')}>{selectedTaskId ? '查看任务报告' : '新建回测'}</Button>}
                  />
                </SectionCard>
              </Space>
            ),
          },
          {
            key: '回测日志',
            label: '回测日志',
            children: (
              <SectionCard className="backtest-log-workbench-card" title="回测日志" description="失败原因、中文说明和技术详情会保留在这里。">
                {selectedEquityDate ? (
                  <Alert
                    className="backtest-log-boundary-alert"
                    data-testid="backtest-log-date-boundary"
                    type="info"
                    showIcon
                    message="回测日志不按曲线交易日强制筛选"
                    description={`当前已定位曲线日期 ${selectedEquityDate}；成交明细和信号审计按该交易日筛选。回测日志记录的是任务运行时间 created_at，用于排查执行阶段、异常和技术详情，直接按交易日过滤会误导判断。`}
                  />
                ) : null}
                <div className="backtest-filter-summary" data-testid="backtest-log-filter-summary" aria-label="回测日志当前筛选条件">
                  <div className="backtest-filter-summary__head">
                    <Typography.Text strong>当前筛选条件</Typography.Text>
                    <Tag color={logKeyword || logLevelFilter ? 'blue' : 'default'}>{logKeyword || logLevelFilter ? '已筛选' : '全部'}</Tag>
                  </div>
                  <div className="backtest-filter-summary__items">
                    {logFilterSummaryItems.map((item) => (
                      <span key={item.label} className="backtest-filter-summary__item">
                        <small>{item.label}</small>
                        <strong title={item.value}>{item.value}</strong>
                      </span>
                    ))}
                  </div>
                </div>
                <DataTable<BacktestLogRecord>
                  rowKey="id"
                  columns={logColumns}
                  className="data-table--backtest-logs"
                  dataSource={logs}
                  loading={loading}
                  updatedAt={updatedAt}
                  onRefresh={loadAll}
                  pagination={{ current: logPage.page, pageSize: logPage.pageSize, total: logPage.total, showSizeChanger: true }}
                  onChange={(pagination) => setLogPage({ page: pagination.current ?? 1, pageSize: pagination.pageSize ?? BACKTEST_LOG_PAGE_SIZE, total: logPage.total })}
                  data-testid="table-backtest-logs"
                  tableLayout="fixed"
                  scroll={{ x: TABLE_SCROLL_X.backtestLogs }}
                  quickFilterScope="server"
                  quickFilterHint="服务端筛选，按当前回测任务全量查询；输入关键字后按回车或点击搜索生效。"
                  quickSearch={{
                    placeholder: '全量搜索日志消息/技术详情',
                    fields: ['message', 'technical_detail'],
                    width: 260,
                    value: logSearchInput,
                    onChange: handleLogSearchInputChange,
                    onSearch: commitLogKeyword,
                  }}
                  quickFilters={[{
                    label: '日志级别',
                    options: ['info', 'warning', 'error'].map((value) => ({ label: value, value })),
                    getValue: (record) => record.level,
                    value: logLevelFilter,
                    onChange: (value) => {
                      setLogLevelFilter(value);
                      setLogPage((previous) => ({ ...previous, page: 1 }));
                    },
                  }]}
                  emptyDescription="暂无回测日志。启动回测后，运行阶段、错误和技术详情会显示在这里。"
                />
              </SectionCard>
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
        title={logDrawer?.title ?? ''}
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

function getEquityDailyPnlForRows(rows: BacktestEquityRecord[], record: BacktestEquityRecord) {
  const index = rows.findIndex((item) => item.trade_date === record.trade_date);
  if (index <= 0) return 0;
  return record.equity - rows[index - 1].equity;
}
