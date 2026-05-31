import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CloudDownloadOutlined,
  DatabaseOutlined,
  DownloadOutlined,
  SafetyCertificateOutlined,
  ToolOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Col,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import { useSearchParams } from 'react-router-dom';
import DataTable from '../../components/DataTable';
import DataFreshnessTag from '../../components/DataFreshnessTag';
import EmptyGuide from '../../components/EmptyGuide';
import ErrorDetailModal from '../../components/ErrorDetailModal';
import LogDrawer from '../../components/LogDrawer';
import MetricCard from '../../components/MetricCard';
import PageHeader from '../../components/PageHeader';
import RiskConfirmContent from '../../components/RiskConfirmContent';
import SectionCard from '../../components/SectionCard';
import TableActionGroup from '../../components/TableActionGroup';
import TaskActionGroup from '../../components/TaskActionGroup';
import TaskProgress from '../../components/TaskProgress';
import { useTaskPolling } from '../../hooks/useTaskPolling';
import { RequestError } from '../../services/request';
import {
  createBackup,
  createEnvironmentCheck,
  createMaintenanceCleanup,
  deleteBackup,
  exportSystemConfig,
  exportSystemLogs,
  getBackups,
  getEnvironmentResults,
  getOperations,
  getStartupCheck,
  getSystemConfig,
  getSystemLogs,
  getSystemMonitor,
  restoreBackup,
  saveSystemConfig,
  testSystemPath,
} from '../../services/system';
import { defaultPageState, type PageState } from '../../types/api';
import type {
  BackupRecord,
  EnvironmentCheckResult,
  OperationLogRecord,
  RuntimeTaskRecord,
  StartupCheckItem,
  StartupCheckResult,
  SystemConfig,
  SystemLogRecord,
  SystemMonitor,
} from '../../types/system';
import { writeTextToClipboard } from '../../utils/clipboard';
import { TABLE_COL, TABLE_SCROLL_X } from '../../utils/tableColumns';
import { formatNow } from '../../utils/time';
import {
  type ErrorState,
  type LogDrawerState,
  type SystemTabKey,
  buildSystemQaDetail,
  envGroupDefinitions,
  formatBytes,
  getTimeBucket,
  matchEnvGroup,
  readSystemTab,
  renderAuditCode,
  renderAuditText,
  renderStatus,
  statusColor,
  statusLabel,
} from './systemManageHelpers';

const SYSTEM_AUDIT_PAGE_SIZE = 1;
import './SystemManage.css';

export default function SystemManage() {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<SystemConfig>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<SystemTabKey>(() => readSystemTab(searchParams.get('tab')));
  const [config, setConfig] = useState<SystemConfig | null>(null);
  const [envResults, setEnvResults] = useState<EnvironmentCheckResult[]>([]);
  const [activeTask, setActiveTask] = useState<RuntimeTaskRecord | null>(null);
  const [logs, setLogs] = useState<SystemLogRecord[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [monitor, setMonitor] = useState<SystemMonitor | null>(null);
  const [startupCheck, setStartupCheck] = useState<StartupCheckResult | null>(null);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [backupPage, setBackupPage] = useState<PageState>({ ...defaultPageState });
  const [operations, setOperations] = useState<OperationLogRecord[]>([]);
  const [operationsTotal, setOperationsTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(formatNow());
  const [errorState, setErrorState] = useState<ErrorState | null>(null);
  const [logDrawer, setLogDrawer] = useState<LogDrawerState | null>(null);

  const showError = useCallback((fallback: string, error: unknown) => {
    if (error instanceof RequestError) {
      setErrorState({ message: error.message, error: error.apiError, traceId: error.traceId });
    } else {
      setErrorState({ message: fallback, error: { code: 'UNKNOWN', detail: String(error) } });
    }
  }, []);

  useEffect(() => {
    setActiveTab(readSystemTab(searchParams.get('tab')));
  }, [searchParams]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [configResult, envResult, logsResult, monitorResult, startupResult, backupsResult, operationsResult] = await Promise.all([
        getSystemConfig(),
        getEnvironmentResults(),
        getSystemLogs({ page: 1, pageSize: SYSTEM_AUDIT_PAGE_SIZE }),
        getSystemMonitor(),
        getStartupCheck(),
        getBackups({ page: 1, pageSize: defaultPageState.pageSize }),
        getOperations({ page: 1, pageSize: SYSTEM_AUDIT_PAGE_SIZE }),
      ]);
      setConfig(configResult);
      form.setFieldsValue(configResult);
      setEnvResults(envResult);
      setLogs(logsResult.items);
      setLogsTotal(logsResult.total);
      setMonitor(monitorResult);
      setStartupCheck(startupResult);
      setBackups(backupsResult.items);
      setBackupPage({ page: backupsResult.page, pageSize: backupsResult.page_size, total: backupsResult.total });
      setOperations(operationsResult.items);
      setOperationsTotal(operationsResult.total);
      setUpdatedAt(formatNow());
    } catch (error) {
      showError('加载系统管理数据失败', error);
    } finally {
      setLoading(false);
    }
  }, [form, showError]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useTaskPolling({
    task: activeTask,
    onTaskChange: setActiveTask,
    onFinished: async (task) => {
      if (task.task_type === 'environment_check') {
        const results = await getEnvironmentResults(task.task_id);
        setEnvResults(results);
      }
      const backupsResult = await getBackups({ page: 1, pageSize: backupPage.pageSize });
      setBackups(backupsResult.items);
      setBackupPage({ page: backupsResult.page, pageSize: backupsResult.page_size, total: backupsResult.total });
      setMonitor(await getSystemMonitor());
      setStartupCheck(await getStartupCheck());
      setUpdatedAt(formatNow());
    },
    onError: (error) => showError('刷新任务状态失败', error),
  });

  const saveConfig = async () => {
    try {
      const values = await form.validateFields();
      const payload = { ...values, simulation_mode: false };
      setLoading(true);
      const saved = await saveSystemConfig(payload);
      setConfig(saved);
      form.setFieldsValue(saved);
      message.success('系统配置已保存');
      await loadAll();
    } catch (error) {
      if (error instanceof Error && error.message.includes('Validate')) return;
      showError('保存系统配置失败', error);
    } finally {
      setLoading(false);
    }
  };

  const runEnvCheck = async () => {
    setLoading(true);
    try {
      const task = await createEnvironmentCheck();
      setActiveTask({ ...task, created_at: formatNow() });
      message.success('环境检测任务已创建');
    } catch (error) {
      showError('创建环境检测任务失败', error);
    } finally {
      setLoading(false);
    }
  };

  const testPath = async (field: keyof Pick<SystemConfig, 'qmt_path' | 'database_path' | 'strategy_dir' | 'backup_dir'>) => {
    const value = form.getFieldValue(field);
    if (!value) {
      message.warning('请先填写路径');
      return;
    }
    try {
      const result = await testSystemPath(value, field !== 'database_path');
      if (result.exists) {
        message.success(result.message);
      } else {
        message.warning(result.suggestion ?? result.message);
      }
    } catch (error) {
      showError('路径检测失败', error);
    }
  };

  const createBackupRecord = async () => {
    setLoading(true);
    try {
      const task = await createBackup();
      setActiveTask({ ...task, created_at: formatNow() });
      message.success('备份任务已创建');
    } catch (error) {
      showError('创建备份失败', error);
    } finally {
      setLoading(false);
    }
  };

  const createCleanupTask = async () => {
    setLoading(true);
    try {
      const task = await createMaintenanceCleanup();
      setActiveTask({ ...task, created_at: formatNow() });
      message.success('清理归档任务已创建');
    } catch (error) {
      showError('创建清理归档任务失败', error);
    } finally {
      setLoading(false);
    }
  };

  const confirmRestore = (backup: BackupRecord) => {
    modal.confirm({
      className: 'system-confirm-modal',
      width: 720,
      centered: true,
      maskClosable: false,
      title: '恢复备份',
      content: (
        <RiskConfirmContent
          level="error"
          summary={`即将恢复备份：${backup.backup_name}`}
          objectLabel={backup.backup_name}
          riskItems={[
            '系统会先自动生成当前快照，再恢复数据库和配置。',
            '用户策略文件只会提取到备份目录，不会覆盖 strategies/user。',
            '恢复期间请不要进行同步、回测或交易操作。',
          ]}
          details={[
            { label: '备份 ID', value: backup.id },
            { label: '备份大小', value: formatBytes(backup.backup_size) },
            { label: '创建时间', value: backup.created_at },
            { label: '备份路径', value: backup.backup_path },
          ]}
          nextStep="确认恢复后请等待长任务完成，再检查环境检测、数据库路径、策略目录和最近操作记录。"
        />
      ),
      okText: '确认恢复',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const task = await restoreBackup(backup.id);
          setActiveTask({ ...task, created_at: formatNow() });
          message.success('备份恢复任务已创建，恢复前已自动生成当前快照');
        } catch (error) {
          showError('恢复备份失败', error);
        }
      },
    });
  };

  const exportLogs = async () => {
    setLoading(true);
    try {
      const filename = await exportSystemLogs();
      message.success(`日志已导出：${filename}`);
      await loadAll();
    } catch (error) {
      showError('导出日志失败', error);
    } finally {
      setLoading(false);
    }
  };

  const exportConfig = async () => {
    setLoading(true);
    try {
      const filename = await exportSystemConfig();
      message.success(`配置已导出：${filename}`);
      await loadAll();
    } catch (error) {
      showError('导出配置失败', error);
    } finally {
      setLoading(false);
    }
  };

  const confirmDeleteBackup = (backup: BackupRecord) => {
    modal.confirm({
      className: 'system-confirm-modal',
      width: 720,
      centered: true,
      maskClosable: false,
      title: '删除备份',
      content: (
        <RiskConfirmContent
          level="error"
          summary={`即将删除备份：${backup.backup_name}`}
          objectLabel={backup.backup_name}
          riskItems={[
            '删除后该备份记录和备份文件将不可在页面恢复。',
            '不会影响当前数据库、配置和用户策略目录。',
            '建议至少保留一个最近可用备份后再删除旧备份。',
          ]}
          details={[
            { label: '备份 ID', value: backup.id },
            { label: '备份大小', value: formatBytes(backup.backup_size) },
            { label: '创建时间', value: backup.created_at },
          ]}
          nextStep="删除后请刷新备份列表，确认仍保留至少一个可用备份用于回滚。"
        />
      ),
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteBackup(backup.id);
          message.success('备份已删除');
          const result = await getBackups({ page: 1, pageSize: backupPage.pageSize });
          setBackups(result.items);
          setBackupPage({ page: result.page, pageSize: result.page_size, total: result.total });
        } catch (error) {
          showError('删除备份失败', error);
        }
      },
    });
  };

  const copyLogText = async (record: SystemLogRecord) => {
    const text = [
      'qa_type：system_log_detail',
      `模块：${record.module}`,
      `等级：${record.level}`,
      `时间：${record.created_at}`,
      `关联ID：${record.related_id ?? '暂无'}`,
      `中文信息：${record.message}`,
      `技术详情：${buildSystemQaDetail('system_log_detail', {
        log: {
          id: record.id,
          module: record.module,
          level: record.level,
          related_id: record.related_id,
          message: record.message,
          technical_detail: record.technical_detail,
          created_at: record.created_at,
        },
        next_steps: ['按模块和关联ID回查对应长任务或操作记录', '如为 QMT 相关错误，先确认当前真实只读状态和券商客户端连接'],
        raw: record,
      })}`,
    ].join('\n');
    try {
      await writeTextToClipboard(text);
      message.success('日志详情已复制');
    } catch {
      message.error('复制失败，请手动选择日志详情复制。');
    }
  };

  const showBackupDetail = (backup: BackupRecord) => {
    setLogDrawer({
      title: '备份记录详情',
      subtitle: backup.backup_name,
      status: backup.status,
      statusTone: backup.status === 'success' ? 'green' : backup.status === 'failed' ? 'red' : 'blue',
      width: 720,
      fieldColumns: 2,
      className: 'system-backup-detail-drawer',
      message: `备份 ${backup.backup_name} 当前状态为 ${backup.status}。恢复属于高风险操作，必须人工确认，恢复前系统会先生成当前快照。`,
      technicalDetail: buildSystemQaDetail('system_backup_detail', {
        backup: {
          id: backup.id,
          backup_name: backup.backup_name,
          backup_path: backup.backup_path,
          backup_size: backup.backup_size,
          status: backup.status,
          created_at: backup.created_at,
        },
        safety: {
          restore_requires_manual_confirm: true,
          snapshot_before_restore: true,
          strategies_user_protected: true,
        },
        raw: backup,
      }),
      fields: [
        { label: '备份ID', value: backup.id },
        { label: '备份名称', value: backup.backup_name },
        { label: '状态', value: <Tag color={statusColor[backup.status] ?? 'default'}>{statusLabel[backup.status] ?? backup.status}</Tag>, copyValue: statusLabel[backup.status] ?? backup.status },
        { label: '备份大小', value: formatBytes(backup.backup_size) },
        { label: '备份路径', value: backup.backup_path },
        { label: '创建时间', value: backup.created_at },
      ],
    });
  };

  const envStats = useMemo(
    () => ({
      success: envResults.filter((item) => item.status === 'success').length,
      warning: envResults.filter((item) => item.status === 'warning').length,
      failed: envResults.filter((item) => item.status === 'failed').length,
    }),
    [envResults],
  );

  const startupStats = useMemo(
    () => ({
      success: startupCheck?.items.filter((item) => item.status === 'success').length ?? 0,
      warning: startupCheck?.items.filter((item) => item.status === 'warning').length ?? 0,
      failed: startupCheck?.items.filter((item) => item.status === 'failed').length ?? 0,
    }),
    [startupCheck],
  );

  const restartInterruptedCount = useMemo(() => {
    const isRestartInterrupted = (value?: string | null) =>
      (value ?? '').includes('服务重启导致') || (value ?? '').includes('process_restart');
    const taskCount = (monitor?.slow_tasks ?? []).filter(
      (task) => isRestartInterrupted(task.message) || isRestartInterrupted(task.technical_detail),
    ).length;
    const logCount = (monitor?.recent_errors ?? []).filter(
      (log) => isRestartInterrupted(log.message) || isRestartInterrupted(log.technical_detail),
    ).length;
    return Math.max(taskCount, logCount);
  }, [monitor]);

  const realQmtReadonlyPassed = useMemo(() => {
    if (config?.simulation_mode !== false) return false;
    const requiredItems = ['是否能查询资产', '是否能查询持仓', '是否能查询委托', '是否能查询成交', '是否能获取行情'];
    return requiredItems.every((checkItem) =>
      envResults.some((record) => record.check_item === checkItem && record.status === 'success'),
    );
  }, [config?.simulation_mode, envResults]);

  const latestBackup = backups[0];
  const opsStatusItems = [
    {
      label: '启动健康',
      value: startupCheck?.overall_status ? statusLabel[startupCheck.overall_status] ?? startupCheck.overall_status : '未检测',
      tone: startupCheck?.overall_status === 'failed' ? 'danger' : startupCheck?.overall_status === 'warning' ? 'warning' : 'success',
    },
    {
      label: '环境检测',
      value: `${envStats.success} 正常 / ${envStats.failed} 失败`,
      tone: envStats.failed > 0 ? 'danger' : envStats.warning > 0 ? 'warning' : 'success',
    },
    {
      label: '日志保留',
      value: config?.log_retention_days ? `${config.log_retention_days} 天` : '未配置',
      tone: 'info',
    },
    {
      label: '最近备份',
      value: latestBackup ? latestBackup.created_at : '暂无备份',
      tone: latestBackup ? 'success' : 'warning',
    },
  ];
  const pathSummaryItems = [
    {
      label: 'QMT 路径',
      value: config?.qmt_path || '未配置',
      hint: realQmtReadonlyPassed ? '真实 QMT 只读已通过' : '真实 QMT 待人工验收',
      tone: config?.qmt_path && realQmtReadonlyPassed ? 'success' : config?.qmt_path ? 'warning' : 'warning',
    },
    { label: '数据库路径', value: config?.database_path || '未配置', hint: 'SQLite 本地数据文件', tone: config?.database_path ? 'success' : 'warning' },
    { label: '策略目录', value: config?.strategy_dir || '未配置', hint: '保护 strategies/user/', tone: config?.strategy_dir ? 'success' : 'warning' },
    { label: '备份目录', value: config?.backup_dir || '未配置', hint: latestBackup ? `最近备份 ${latestBackup.created_at}` : '建议创建首个备份', tone: config?.backup_dir && latestBackup ? 'success' : 'warning' },
  ];
  const envGroups = envGroupDefinitions.map((group) => {
    const records = envResults.filter((record) => matchEnvGroup(record, group.keywords));
    const failed = records.filter((record) => record.status === 'failed').length;
    const warning = records.filter((record) => record.status === 'warning').length;
    const success = records.filter((record) => record.status === 'success').length;
    return {
      ...group,
      records,
      failed,
      warning,
      success,
      status: failed > 0 ? 'failed' : warning > 0 ? 'warning' : records.length > 0 ? 'success' : 'pending',
      focus: records.find((record) => record.status === 'failed') ?? records.find((record) => record.status === 'warning') ?? records[0],
    };
  });
  const logModuleOptions = Array.from(new Set(logs.map((log) => log.module).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right))
    .map((module) => ({ label: module, value: module }));
  const monitorHealthItems = [
    {
      label: '数据库',
      value: formatBytes(monitor?.database_size_bytes ?? 0),
      hint: 'SQLite 本地文件大小',
      tone: (monitor?.database_size_bytes ?? 0) > 1024 * 1024 * 1024 ? 'warning' : 'success',
    },
    {
      label: '日志',
      value: formatBytes(monitor?.log_size_bytes ?? 0),
      hint: `保留 ${config?.log_retention_days ?? '--'} 天`,
      tone: (monitor?.log_size_bytes ?? 0) > 512 * 1024 * 1024 ? 'warning' : 'success',
    },
    {
      label: '备份',
      value: `${monitor?.backup_count ?? backups.length} 个`,
      hint: latestBackup ? `最近 ${latestBackup.created_at}` : '建议创建首个备份',
      tone: latestBackup ? 'success' : 'warning',
    },
    {
      label: '最近错误',
      value: `${monitor?.recent_errors.length ?? 0} 条`,
      hint: '用于定位长期运行异常',
      tone: (monitor?.recent_errors.length ?? 0) > 0 ? 'danger' : 'success',
    },
    {
      label: '慢任务',
      value: `${monitor?.slow_tasks.length ?? 0} 条`,
      hint: '同步、回测、备份耗时观察',
      tone: (monitor?.slow_tasks.length ?? 0) > 0 ? 'warning' : 'success',
    },
  ];
  const monitorFailedHint = monitor?.historical_failed_task_count
    ? `历史失败 ${monitor.historical_failed_task_count} 个，可清理归档`
    : '不含历史已完成失败';
  const jumpSystemTab = (tab: SystemTabKey) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };
  const systemWorkflowItems: Array<{
    title: string;
    description: string;
    tab: SystemTabKey;
    tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  }> = [
    {
      title: '环境检测',
      description: `${envStats.success} 正常 / ${envStats.failed} 失败`,
      tab: '环境检测',
      tone: envStats.failed > 0 ? 'danger' : envStats.warning > 0 ? 'warning' : 'success',
    },
    {
      title: '运行监控',
      description: `${monitor?.running_task_count ?? 0} 运行 / ${monitor?.failed_task_count ?? 0} 失败`,
      tab: '运行监控',
      tone: (monitor?.failed_task_count ?? 0) > 0 ? 'danger' : (monitor?.slow_tasks.length ?? 0) > 0 ? 'warning' : 'info',
    },
    {
      title: '日志中心',
      description: `${formatBytes(monitor?.log_size_bytes ?? 0)}，可导出`,
      tab: '日志中心',
      tone: (monitor?.recent_errors.length ?? 0) > 0 ? 'warning' : 'neutral',
    },
    {
      title: '备份恢复',
      description: latestBackup ? `最近 ${latestBackup.created_at}` : '建议创建首个备份',
      tab: '备份恢复',
      tone: latestBackup ? 'success' : 'warning',
    },
    {
      title: '操作记录',
      description: `${operationsTotal} 条可追踪记录`,
      tab: '操作记录',
      tone: 'neutral',
    },
  ];

  const envColumns: ColumnsType<EnvironmentCheckResult> = [
    { title: '检测项', dataIndex: 'check_item', width: TABLE_COL.strategy, fixed: 'left', render: renderAuditCode },
    {
      title: '结果',
      dataIndex: 'status',
      width: TABLE_COL.status,
      filters: [
        { text: '正常', value: 'success' },
        { text: '警告', value: 'warning' },
        { text: '失败', value: 'failed' },
      ],
      onFilter: (value, record) => record.status === value,
      render: renderStatus,
    },
    { title: '说明', dataIndex: 'message', width: TABLE_COL.messageWide, render: renderAuditText },
    { title: '修复建议', dataIndex: 'suggestion', width: TABLE_COL.reasonWide, render: renderAuditText },
    { title: '任务ID', dataIndex: 'task_id', width: TABLE_COL.taskId, responsive: ['xxl'], render: renderAuditCode },
    { title: '时间', dataIndex: 'created_at', width: TABLE_COL.time, responsive: ['xxl'], render: renderAuditCode },
    {
      title: '详情',
      width: TABLE_COL.detailAction,
      fixed: false,
      render: (_, record) => (
        <TableActionGroup
          primary={(
            <Button
              aria-label={`查看环境检测详情：${record.check_item}`}
              title={`查看环境检测详情：${record.check_item}`}
              size="small"
              onClick={() => setLogDrawer({
                title: '环境检测详情',
                subtitle: record.check_item,
                status: statusLabel[record.status] ?? record.status,
                statusTone: statusColor[record.status] ?? 'default',
                width: 720,
                fieldColumns: 2,
                className: 'system-env-detail-drawer',
                message: record.message,
                technicalDetail: buildSystemQaDetail('system_environment_check_detail', {
                  check: {
                    id: record.id,
                    task_id: record.task_id,
                    check_item: record.check_item,
                    status_raw: record.status,
                    status_text: statusLabel[record.status] ?? record.status,
                    message: record.message,
                    suggestion: record.suggestion,
                    technical_detail: record.technical_detail,
                    created_at: record.created_at,
                  },
                  qmt_policy: {
                    real_qmt_first: true,
                    business_fallback_to_test_isolation_disabled: true,
                    test_isolation_for_automation_only: true,
                    read_only_before_live_trade_acceptance: true,
                  },
                  raw: record,
                }),
                fields: [
                  { label: '检测项', value: record.check_item },
                  { label: '状态', value: <Tag color={statusColor[record.status] ?? 'default'}>{statusLabel[record.status] ?? record.status}</Tag>, copyValue: statusLabel[record.status] ?? record.status },
                  { label: '修复建议', value: record.suggestion ?? '暂无' },
                  { label: '任务ID', value: record.task_id },
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

  const monitorTaskColumns: ColumnsType<RuntimeTaskRecord> = [
    { title: '任务ID', dataIndex: 'task_id', width: TABLE_COL.taskId, fixed: 'left', render: renderAuditCode },
    { title: '类型', dataIndex: 'task_type', width: TABLE_COL.module, render: renderAuditCode },
    { title: '状态', dataIndex: 'status', width: TABLE_COL.status, render: renderStatus },
    {
      title: '进度',
      dataIndex: 'progress',
      width: TABLE_COL.status,
      render: (value: number) => `${Math.round(Number(value) || 0)}%`,
    },
    { title: '说明', dataIndex: 'message', width: TABLE_COL.messageWide, render: renderAuditText },
    { title: '开始时间', dataIndex: 'started_at', width: TABLE_COL.time, render: renderAuditCode },
    {
      title: '诊断',
      width: TABLE_COL.detailAction,
      fixed: 'right',
      render: (_, record) => <TaskActionGroup task={record} detailTitle="运行监控任务详情" primaryAction="source" />,
    },
  ];

  const logColumns: ColumnsType<SystemLogRecord> = [
    { title: '时间', dataIndex: 'created_at', width: TABLE_COL.time, fixed: 'left', sorter: (a, b) => a.created_at.localeCompare(b.created_at), render: renderAuditCode },
    { title: '模块', dataIndex: 'module', width: TABLE_COL.module, render: renderAuditCode },
    { title: '等级', dataIndex: 'level', width: TABLE_COL.level, render: (level: string) => <Tag color={level === 'error' ? 'red' : level === 'warning' ? 'orange' : 'blue'}>{level}</Tag> },
    { title: '中文信息', dataIndex: 'message', width: TABLE_COL.messageWide, render: renderAuditText },
    {
      title: '详情',
      width: TABLE_COL.detailAction,
      fixed: false,
      render: (_, record) => (
        <TableActionGroup
          primary={(
            <Button
              aria-label="查看系统日志详情"
              title="查看系统日志详情"
              size="small"
              onClick={() => setLogDrawer({
                title: '系统日志详情',
                subtitle: record.created_at,
                status: record.level,
                statusTone: record.level === 'error' ? 'red' : record.level === 'warning' ? 'orange' : 'blue',
                width: 720,
                fieldColumns: 2,
                className: 'system-log-detail-drawer',
                message: record.message,
                technicalDetail: buildSystemQaDetail('system_log_detail', {
                  log: {
                    id: record.id,
                    module: record.module,
                    level: record.level,
                    message: record.message,
                    related_id: record.related_id,
                    technical_detail: record.technical_detail,
                    created_at: record.created_at,
                  },
                  next_steps: ['按关联ID定位对应任务、订单或操作记录', '复制技术详情给 AI 时保留中文信息和原始 technical_detail'],
                  raw: record,
                }),
                fields: [
                  { label: '模块', value: record.module },
                  { label: '等级', value: <Tag color={record.level === 'error' ? 'red' : record.level === 'warning' ? 'orange' : 'blue'}>{record.level}</Tag>, copyValue: record.level },
                  { label: '关联ID', value: record.related_id ?? '暂无' },
                  { label: '时间', value: record.created_at },
                ],
              })}
            >
              详情
            </Button>
          )}
          actions={[{ key: 'copy', label: '复制日志详情', onClick: () => void copyLogText(record) }]}
        />
      ),
    },
  ];

  const backupColumns: ColumnsType<BackupRecord> = [
    { title: '备份名称', dataIndex: 'backup_name', width: TABLE_COL.strategyWide, fixed: 'left', render: renderAuditCode },
    { title: '备份路径', dataIndex: 'backup_path', width: TABLE_COL.textWide, render: renderAuditText },
    { title: '大小', dataIndex: 'backup_size', width: TABLE_COL.quantity, render: (value: number) => formatBytes(value) },
    { title: '状态', dataIndex: 'status', width: TABLE_COL.status, render: (status: string) => <Tag color={statusColor[status] ?? 'default'}>{statusLabel[status] ?? status}</Tag> },
    { title: '时间', dataIndex: 'created_at', width: TABLE_COL.time, render: renderAuditCode },
    {
      title: '操作',
      width: TABLE_COL.detailAction,
      fixed: 'right',
      render: (_, record) => (
        <TableActionGroup
          primary={<Button aria-label="查看备份详情" title="查看备份详情" size="small" onClick={() => showBackupDetail(record)}>详情</Button>}
          actions={[
            { key: 'restore', label: '恢复备份', type: 'restore', danger: true, onClick: () => confirmRestore(record) },
            { key: 'delete', label: '删除备份', type: 'delete', danger: true, onClick: () => confirmDeleteBackup(record) },
          ]}
        />
      ),
    },
  ];

  const operationColumns: ColumnsType<OperationLogRecord> = [
    { title: '时间', dataIndex: 'created_at', width: TABLE_COL.time, fixed: 'left', render: renderAuditCode },
    { title: '模块', dataIndex: 'module', width: TABLE_COL.module, render: renderAuditCode },
    { title: '操作', dataIndex: 'action', width: TABLE_COL.type, render: renderAuditCode },
    { title: '结果', dataIndex: 'result', width: TABLE_COL.status, render: (result: string) => <Tag color={result === '成功' || result === 'success' ? 'green' : result === '失败' || result === 'failed' ? 'red' : 'default'}>{result}</Tag> },
    { title: '说明', dataIndex: 'message', width: TABLE_COL.messageWide, render: renderAuditText },
    {
      title: '详情',
      width: TABLE_COL.detailAction,
      fixed: false,
      render: (_, record) => (
        <TableActionGroup
          primary={(
            <Button
              aria-label="查看操作记录详情"
              title="查看操作记录详情"
              size="small"
              onClick={() => setLogDrawer({
                title: '操作记录详情',
                subtitle: `${record.module} / ${record.action}`,
                status: record.result,
                statusTone: record.result === '成功' || record.result === 'success' ? 'green' : record.result === '失败' || record.result === 'failed' ? 'red' : 'blue',
                width: 720,
                fieldColumns: 2,
                className: 'system-operation-detail-drawer',
                message: record.message,
                technicalDetail: buildSystemQaDetail('system_operation_log_detail', {
                  operation: {
                    id: record.id,
                    module: record.module,
                    action: record.action,
                    target_type: record.target_type,
                    target_id: record.target_id,
                    result: record.result,
                    message: record.message,
                    technical_detail: record.technical_detail,
                    created_at: record.created_at,
                  },
                  audit: {
                    should_have_operation_log_for_writes: true,
                    check_related_system_log_when_failed: record.result === '失败' || record.result === 'failed',
                  },
                  raw: record,
                }),
                fields: [
                  { label: '模块', value: record.module },
                  { label: '操作', value: record.action },
                  { label: '结果', value: <Tag color={record.result === '成功' || record.result === 'success' ? 'green' : record.result === '失败' || record.result === 'failed' ? 'red' : 'default'}>{record.result}</Tag>, copyValue: record.result },
                  { label: '目标类型', value: record.target_type },
                  { label: '目标ID', value: record.target_id ?? '暂无' },
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

  const startupColumns: ColumnsType<StartupCheckItem> = [
    { title: '检查项', dataIndex: 'check_item', width: TABLE_COL.strategy, fixed: 'left', render: renderAuditCode },
    { title: '状态', dataIndex: 'status', width: TABLE_COL.status, render: renderStatus },
    { title: '说明', dataIndex: 'message', width: TABLE_COL.messageWide, render: renderAuditText },
    { title: '建议', dataIndex: 'suggestion', width: TABLE_COL.reasonWide, render: renderAuditText },
    {
      title: '详情',
      width: TABLE_COL.detailAction,
      fixed: false,
      render: (_, record) => (
        <TableActionGroup
          primary={(
            <Button
              aria-label={`查看启动健康详情：${record.check_item}`}
              title={`查看启动健康详情：${record.check_item}`}
              size="small"
              onClick={() => setLogDrawer({
                title: '启动健康详情',
                subtitle: record.check_item,
                status: statusLabel[record.status] ?? record.status,
                statusTone: statusColor[record.status] ?? 'default',
                width: 720,
                fieldColumns: 2,
                className: 'system-startup-detail-drawer',
                message: record.message,
                technicalDetail: buildSystemQaDetail('system_startup_check_detail', {
                  startup_check: {
                    check_item: record.check_item,
                    status_raw: record.status,
                    status_text: statusLabel[record.status] ?? record.status,
                    message: record.message,
                    suggestion: record.suggestion,
                    technical_detail: record.technical_detail,
                    checked_at: startupCheck?.checked_at,
                    version: startupCheck?.version,
                  },
                  next_steps: ['启动失败先看中文说明，再按技术详情检查目录、数据库、前后端端口和 xtquant 状态'],
                  raw: record,
                }),
                fields: [
                  { label: '检查项', value: record.check_item },
                  { label: '状态', value: <Tag color={statusColor[record.status] ?? 'default'}>{statusLabel[record.status] ?? record.status}</Tag>, copyValue: statusLabel[record.status] ?? record.status },
                  { label: '建议', value: record.suggestion ?? '暂无' },
                  { label: '检查时间', value: startupCheck?.checked_at ?? '暂无' },
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

  const logPagination: TablePaginationConfig = useMemo(
    () => ({
      pageSize: SYSTEM_AUDIT_PAGE_SIZE,
      total: logsTotal,
      onChange: async (page, pageSize) => {
        try {
          const result = await getSystemLogs({ page, pageSize });
          setLogs(result.items);
          setLogsTotal(result.total);
        } catch (error) {
          showError('加载日志失败', error);
        }
      },
    }),
    [logsTotal, showError],
  );

  const backupPagination: TablePaginationConfig = useMemo(
    () => ({
      current: backupPage.page,
      pageSize: backupPage.pageSize,
      total: backupPage.total,
      showSizeChanger: true,
      onChange: async (page, pageSize) => {
        try {
          const result = await getBackups({ page, pageSize });
          setBackups(result.items);
          setBackupPage({ page: result.page, pageSize: result.page_size, total: result.total });
        } catch (error) {
          showError('加载备份记录失败', error);
        }
      },
    }),
    [backupPage.page, backupPage.pageSize, backupPage.total, showError],
  );

  const operationPagination: TablePaginationConfig = useMemo(
    () => ({
      pageSize: SYSTEM_AUDIT_PAGE_SIZE,
      total: operationsTotal,
      onChange: async (page, pageSize) => {
        try {
          const result = await getOperations({ page, pageSize });
          setOperations(result.items);
          setOperationsTotal(result.total);
        } catch (error) {
          showError('加载操作记录失败', error);
        }
      },
    }),
    [operationsTotal, showError],
  );

  return (
    <div className="module-page system-page">
      <PageHeader
        title="系统管理"
        description="管理基础设置、环境检测、日志、运行监控、备份恢复和操作记录。"
        updatedAt={updatedAt}
        loading={loading}
        onRefresh={loadAll}
        extra={
          <Space wrap>
            <DataFreshnessTag label="系统数据" updatedAt={updatedAt} loading={loading} />
            <Tag color={startupCheck?.overall_status === 'success' ? 'green' : startupCheck?.overall_status === 'failed' ? 'red' : 'orange'}>
              版本：{startupCheck?.version ?? '0.1.0'}
            </Tag>
          </Space>
        }
        primaryAction={{ label: '环境检测', testId: 'btn-env-check', onClick: runEnvCheck }}
      />

      <section className="system-ops-panel" data-testid="system-ops-panel" aria-label="本地长期使用控制中心">
        <div className="system-ops-panel__main">
          <span className="system-ops-panel__icon">
            <SafetyCertificateOutlined />
          </span>
          <div>
            <Typography.Title level={5} className="system-ops-panel__title">
              本地长期使用控制中心
            </Typography.Title>
            <Typography.Text className="system-ops-panel__description">
              集中管理 QMT 路径、账户、日志、备份、启动健康检查和运行监控。恢复备份属于高风险操作，执行前会提示并生成当前快照。
            </Typography.Text>
          </div>
        </div>
        <div className="system-ops-panel__checks">
          {opsStatusItems.map((item) => (
            <div key={item.label} className={`system-ops-panel__check system-ops-panel__check--${item.tone}`}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="system-workflow" aria-label="系统管理长期运维流程">
        {systemWorkflowItems.map((item, index) => (
          <button
            type="button"
            key={item.title}
            className={`system-workflow__step system-workflow__step--${item.tone}${activeTab === item.tab ? ' system-workflow__step--active' : ''}`}
            onClick={() => jumpSystemTab(item.tab)}
          >
            <span className="system-workflow__index">{index + 1}</span>
            <span className="system-workflow__content">
              <strong>{item.title}</strong>
              <span>{item.description}</span>
            </span>
          </button>
        ))}
      </section>

      <Row gutter={[8, 8]} className="system-overview">
        <Col xs={24} sm={12} xl={6}>
          <MetricCard label="启动健康" value={startupCheck?.overall_status ? statusLabel[startupCheck.overall_status] ?? startupCheck.overall_status : '未检测'} subValue={`${startupStats.success} 正常 / ${startupStats.failed} 失败`} icon={<SafetyCertificateOutlined />} tone={(startupCheck?.overall_status === 'failed' || startupStats.failed > 0) ? 'red' : 'green'} />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <MetricCard label="运行任务" value={`${monitor?.running_task_count ?? 0} 个`} subValue={`今日失败 ${monitor?.failed_task_count ?? 0} 个`} icon={<ToolOutlined />} tone={(monitor?.failed_task_count ?? 0) > 0 ? 'red' : 'blue'} />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <MetricCard label="数据库 / 日志" value={formatBytes(monitor?.database_size_bytes ?? 0)} subValue={`日志 ${formatBytes(monitor?.log_size_bytes ?? 0)}`} icon={<DatabaseOutlined />} tone="neutral" />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <MetricCard label="备份记录" value={`${monitor?.backup_count ?? backups.length} 个`} subValue={latestBackup ? `最近 ${latestBackup.created_at}` : '暂无备份'} icon={<CloudDownloadOutlined />} tone="orange" />
        </Col>
      </Row>

      <TaskProgress task={activeTask} />

      <Tabs
        className="system-tabs"
        activeKey={activeTab}
        onChange={(key) => jumpSystemTab(readSystemTab(key))}
        items={[
          {
            key: '基础设置',
            label: '基础设置',
            forceRender: true,
            children: (
              <SectionCard title="基础设置" description="QMT、数据库、策略和备份目录配置。" className="system-config-workbench-card system-config-workbench-card--basic">
                <div className="system-path-summary" data-testid="system-path-summary">
                  {pathSummaryItems.map((item) => (
                    <div key={item.label} className={`system-path-summary__item system-path-summary__item--${item.tone}`}>
                      <div className="system-path-summary__head">
                        <span>{item.label}</span>
                        <Tag color={item.tone === 'success' ? 'green' : 'orange'}>{item.tone === 'success' ? '已配置' : '需确认'}</Tag>
                      </div>
                      <Typography.Text className="system-path-summary__value" ellipsis={{ tooltip: item.value }}>
                        {item.value}
                      </Typography.Text>
                      <Typography.Text type="secondary" className="system-path-summary__hint">
                        {item.hint}
                      </Typography.Text>
                    </div>
                  ))}
                </div>
                <Form form={form} layout="vertical" disabled={!config && loading}>
                  <div className="system-settings-workbench" data-testid="system-settings-workbench">
                    <div className="system-form-block system-form-block--paths">
                      <Typography.Text strong>本地路径</Typography.Text>
                      <div className="system-path-input-grid">
                        <Form.Item name="qmt_path" label="QMT 路径">
                          <Input.Search allowClear enterButton="测试" onSearch={() => testPath('qmt_path')} />
                        </Form.Item>
                        <Form.Item name="database_path" label="数据库路径">
                          <Input.Search allowClear enterButton="测试" onSearch={() => testPath('database_path')} />
                        </Form.Item>
                        <Form.Item name="strategy_dir" label="策略目录">
                          <Input.Search allowClear enterButton="测试" onSearch={() => testPath('strategy_dir')} />
                        </Form.Item>
                        <Form.Item name="backup_dir" label="备份目录">
                          <Input.Search allowClear enterButton="测试" onSearch={() => testPath('backup_dir')} />
                        </Form.Item>
                      </div>
                      <div className="system-setting-checklist">
                        <div><span>路径检测</span><strong>测试按钮只校验本地可用性</strong></div>
                        <div><span>数据库</span><strong>SQLite 本地落库，启用 WAL</strong></div>
                      </div>
                    </div>
                    <div className="system-form-block system-form-block--account">
                      <Typography.Text strong>账户与启动</Typography.Text>
                      <div className="system-account-grid">
                        <Form.Item name="account_id" label="账户 ID" className="system-account-grid__account">
                          <Input placeholder="请输入 QMT 账户 ID" />
                        </Form.Item>
                        <Form.Item name="auto_connect" label="启动自动连接" valuePropName="checked">
                          <Switch />
                        </Form.Item>
                        <Form.Item name="auto_sync" label="启动自动同步" valuePropName="checked">
                          <Switch />
                        </Form.Item>
                      </div>
                      <Alert type="info" showIcon message="用户策略保护" description="系统不会覆盖 strategies/user/ 下已有用户策略。" />
                      <div className="system-setting-checklist">
                        <div><span>自动连接</span><strong>仅连接真实 QMT 数据源</strong></div>
                        <div><span>自动同步</span><strong>只读同步到本地 SQLite</strong></div>
                      </div>
                    </div>
                    <div className="system-form-block system-form-block--boundary">
                      <Typography.Text strong>长期使用边界</Typography.Text>
                      <div className="system-setting-checklist">
                        <div><span>启动方式</span><strong>一键启动 / 一键停止</strong></div>
                        <div><span>数据来源</span><strong>真实 QMT 只读优先</strong></div>
                        <div><span>策略目录</span><strong>保护 strategies/user/</strong></div>
                        <div><span>备份恢复</span><strong>恢复前生成当前快照</strong></div>
                        <div><span>日志导出</span><strong>系统管理统一导出</strong></div>
                        <div><span>健康检查</span><strong>启动后检查后端/前端/数据库</strong></div>
                        <div><span>异常提示</span><strong>中文说明 + 技术详情</strong></div>
                      </div>
                    </div>
                  </div>
                  <Space wrap className="system-form-actions">
                    <Button aria-label="保存系统基础设置" title="保存系统基础设置" type="primary" loading={loading} onClick={saveConfig} data-testid="btn-save-config">
                      保存设置
                    </Button>
                    <Button aria-label="导出系统配置" title="导出系统配置" icon={<DownloadOutlined />} loading={loading} disabled={loading} onClick={exportConfig}>
                      导出配置
                    </Button>
                    <Button aria-label="恢复表单为当前已保存配置" title="恢复表单为当前已保存配置" onClick={() => config && form.setFieldsValue(config)}>恢复当前配置</Button>
                  </Space>
                  <div className="system-config-evidence-grid" data-testid="system-basic-evidence-grid">
                    <div>
                      <span>启动链路</span>
                      <strong>start.bat 检查目录、依赖和本地服务后启动前后端</strong>
                    </div>
                    <div>
                      <span>数据链路</span>
                      <strong>真实 QMT 只读同步先落 SQLite，再给策略和回测读取</strong>
                    </div>
                    <div>
                      <span>策略保护</span>
                      <strong>用户策略目录独立保护，不覆盖 strategies/user/</strong>
                    </div>
                    <div>
                      <span>恢复边界</span>
                      <strong>备份恢复前生成当前快照，失败可查看中文详情</strong>
                    </div>
                  </div>
                </Form>
              </SectionCard>
            ),
          },
          {
            key: '环境检测',
            label: '环境检测',
            children: (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <Row gutter={[8, 8]}>
                  <Col xs={24} md={8}><MetricCard label="正常" value={`${envStats.success} 项`} icon={<SafetyCertificateOutlined />} tone="green" /></Col>
                  <Col xs={24} md={8}><MetricCard label="警告" value={`${envStats.warning} 项`} icon={<WarningOutlined />} tone="orange" /></Col>
                  <Col xs={24} md={8}><MetricCard label="失败" value={`${envStats.failed} 项`} icon={<WarningOutlined />} tone={envStats.failed > 0 ? 'red' : 'neutral'} /></Col>
                </Row>
                <SectionCard
                  title="环境分组视图"
                  description="按 QMT、Python、本地系统和交易能力分组，异常项给出下一步建议。"
                  extra={<Button aria-label="重新运行环境检测" title="重新运行环境检测" type="primary" loading={loading} disabled={loading} onClick={runEnvCheck}>重新检测</Button>}
                >
                  <div className="env-group-grid">
                    {envGroups.map((group) => (
                      <div className={`env-group-card env-group-card--${group.status}`} key={group.key}>
                        <div className="env-group-card__head">
                          <span className="env-group-card__icon">{group.icon}</span>
                          <div>
                            <Typography.Text strong>{group.title}</Typography.Text>
                            <Typography.Text type="secondary">
                              {group.records.length > 0 ? `${group.success} 正常 / ${group.warning} 警告 / ${group.failed} 失败` : '暂无检测结果'}
                            </Typography.Text>
                          </div>
                          {group.status === 'pending' ? <Tag>未检测</Tag> : renderStatus(group.status)}
                        </div>
                        <Typography.Paragraph className="env-group-card__message" type={group.status === 'failed' ? 'danger' : 'secondary'}>
                          {group.focus?.message || group.nextStep}
                        </Typography.Paragraph>
                        <div className="env-group-card__next">
                          <Typography.Text type="secondary">{group.focus?.suggestion || group.nextStep}</Typography.Text>
                        </div>
                        {group.focus ? (
                          <Button
                            size="small"
                            onClick={() => setLogDrawer({
                              title: `${group.title}检测详情`,
                              subtitle: group.focus?.check_item,
                              status: statusLabel[group.focus.status] ?? group.focus.status,
                              statusTone: statusColor[group.focus.status] ?? 'default',
                              width: 720,
                              fieldColumns: 2,
                              className: 'system-env-group-detail-drawer',
                              message: group.focus.message,
                              technicalDetail: buildSystemQaDetail('system_environment_group_focus_detail', {
                                group: {
                                  key: group.key,
                                  title: group.title,
                                  status: group.status,
                                  success: group.success,
                                  warning: group.warning,
                                  failed: group.failed,
                                  next_step: group.nextStep,
                                },
                                focus_check: {
                                  id: group.focus.id,
                                  task_id: group.focus.task_id,
                                  check_item: group.focus.check_item,
                                  status_raw: group.focus.status,
                                  status_text: statusLabel[group.focus.status] ?? group.focus.status,
                                  message: group.focus.message,
                                  suggestion: group.focus.suggestion,
                                  technical_detail: group.focus.technical_detail,
                                  created_at: group.focus.created_at,
                                },
                                raw: group.focus,
                              }),
                              fields: [
                                { label: '检测项', value: group.focus.check_item },
                                { label: '状态', value: <Tag color={statusColor[group.focus.status] ?? 'default'}>{statusLabel[group.focus.status] ?? group.focus.status}</Tag>, copyValue: statusLabel[group.focus.status] ?? group.focus.status },
                                { label: '修复建议', value: group.focus.suggestion ?? group.nextStep },
                                { label: '任务ID', value: group.focus.task_id },
                                { label: '时间', value: group.focus.created_at },
                              ],
                            })}
                          >
                            看详情
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </SectionCard>
                <SectionCard
                  title="环境检测结果"
                  description="检查 QMT 路径、账户、xtquant、目录权限和只读能力。"
                  extra={<Button aria-label="重新运行环境检测" title="重新运行环境检测" type="primary" loading={loading} disabled={loading} onClick={runEnvCheck}>重新检测</Button>}
                >
                  <DataTable<EnvironmentCheckResult>
                    rowKey="id"
                    columns={envColumns}
                    dataSource={envResults}
                    loading={loading}
                    updatedAt={updatedAt}
                    onRefresh={loadAll}
                    pagination={{ pageSize: 20 }}
                    data-testid="table-env-results"
                    className="system-env-table data-table--system-env"
                    tableLayout="fixed"
                    scroll={{ x: 'max-content' }}
                    quickSearch={{ placeholder: '当前页搜索检测项/说明/建议', fields: ['check_item', 'message', 'suggestion', 'technical_detail'], width: 280 }}
                    quickFilters={[{ label: '检测结果', options: [{ label: '正常', value: 'success' }, { label: '警告', value: 'warning' }, { label: '失败', value: 'failed' }], getValue: (record) => record.status }]}
                    emptyDescription="暂无环境检测结果。点击右上角“环境检测”后，会显示检测项、修复建议和技术详情。"
                  />
                </SectionCard>
              </Space>
            ),
          },
          {
            key: '交易设置',
            label: '交易设置',
            children: (
              <SectionCard title="交易设置" description="控制默认金额、最大单笔金额和下单确认。" className="system-config-workbench-card system-config-workbench-card--trade">
                <Form form={form} layout="vertical">
                  <Row gutter={[8, 8]} className="system-setting-grid system-setting-grid--trade">
                    <Col xs={24} xl={8}>
                      <div className="system-form-block">
                        <Typography.Text strong>金额与委托</Typography.Text>
                        <Row gutter={16}>
                          <Col xs={24} md={12}>
                            <Form.Item name="default_order_amount" label="默认单笔金额">
                              <InputNumber min={0} style={{ width: '100%' }} suffix="元" />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={12}>
                            <Form.Item name="max_order_amount" label="最大单笔金额">
                              <InputNumber min={0} style={{ width: '100%' }} suffix="元" />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={12}>
                            <Form.Item name="default_order_type" label="默认委托方式">
                              <Select options={[{ label: '限价委托', value: '限价委托' }]} />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={12}>
                            <Form.Item name="price_offset" label="委托价格偏移">
                              <InputNumber style={{ width: '100%' }} />
                            </Form.Item>
                          </Col>
                        </Row>
                        <div className="system-setting-checklist">
                          <div><span>金额来源</span><strong>交易执行页读取当前配置</strong></div>
                          <div><span>金额限制</span><strong>最大单笔金额作为下单前检查</strong></div>
                          <div><span>委托方式</span><strong>默认限价，避免隐式市价</strong></div>
                        </div>
                      </div>
                    </Col>
                    <Col xs={24} xl={8}>
                      <div className="system-form-block">
                        <Typography.Text strong>交易护栏</Typography.Text>
                        <Row gutter={16}>
                          <Col xs={24} md={12}>
                            <Form.Item name="order_confirm_required" label="下单前确认" valuePropName="checked">
                              <Switch />
                            </Form.Item>
                          </Col>
                          <Form.Item name="simulation_mode" hidden initialValue={false}>
                            <Input type="hidden" />
                          </Form.Item>
                        </Row>
                        <Alert
                          type="warning"
                          showIcon
                          message="真实数据模式已固定"
                          description="业务页面默认使用真实 QMT 数据；测试隔离数据源只允许自动化测试和排障使用。实际下单仍必须进入交易执行中心并经过确认弹窗。"
                        />
                        <div className="system-setting-checklist">
                          <div><span>真实数据</span><strong>业务视图不显示测试入口</strong></div>
                          <div><span>交易确认</span><strong>确认弹窗默认开启</strong></div>
                          <div><span>状态追踪</span><strong>委托/成交/日志全链路记录</strong></div>
                        </div>
                      </div>
                    </Col>
                    <Col xs={24} xl={8}>
                      <div className="system-form-block system-form-block--evidence">
                        <Typography.Text strong>下单边界核对</Typography.Text>
                        <div className="system-setting-checklist">
                          <div><span>下单入口</span><strong>仅交易执行中心</strong></div>
                          <div><span>人工确认</span><strong>默认开启</strong></div>
                          <div><span>策略权限</span><strong>只生成信号</strong></div>
                          <div><span>重复提交</span><strong>按钮锁定 + 幂等保护</strong></div>
                          <div><span>真实模式</span><strong>不自动开启实盘交易</strong></div>
                          <div><span>订单编号</span><strong>local_order_id 先于 QMT 调用</strong></div>
                          <div><span>失败诊断</span><strong>中文原因 + 技术详情</strong></div>
                        </div>
                      </div>
                    </Col>
                  </Row>
                  <Space wrap className="system-form-actions">
                    <Button aria-label="保存交易设置" title="保存交易设置" type="primary" onClick={saveConfig}>保存设置</Button>
                  </Space>
                  <div className="system-config-evidence-grid" data-testid="system-trade-evidence-grid">
                    <div>
                      <span>配置读取</span>
                      <strong>交易执行面板读取默认金额、委托方式和确认开关</strong>
                    </div>
                    <div>
                      <span>安全提交</span>
                      <strong>点击后进入确认弹窗，按钮锁定并执行幂等保护</strong>
                    </div>
                    <div>
                      <span>订单链路</span>
                      <strong>local_order_id 先创建，QMT 返回后记录 qmt_order_id</strong>
                    </div>
                    <div>
                      <span>失败诊断</span>
                      <strong>下单失败进入执行日志，保留中文原因和技术详情</strong>
                    </div>
                  </div>
                </Form>
              </SectionCard>
            ),
          },
          {
            key: '策略设置',
            label: '策略设置',
            children: (
              <SectionCard title="策略设置" description="策略运行超时、间隔、日志级别和保留策略。" className="system-config-workbench-card system-config-workbench-card--strategy">
                <Form form={form} layout="vertical">
                  <Row gutter={[8, 8]} className="system-setting-grid system-setting-grid--strategy">
                    <Col xs={24} xl={8}>
                      <div className="system-form-block">
                        <Typography.Text strong>策略运行</Typography.Text>
                        <Row gutter={16}>
                          <Col xs={24} md={12}>
                            <Form.Item name="strategy_timeout_seconds" label="策略默认超时">
                              <InputNumber min={1} style={{ width: '100%' }} suffix="秒" />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={12}>
                            <Form.Item name="strategy_run_interval_seconds" label="策略运行间隔">
                              <InputNumber min={5} style={{ width: '100%' }} suffix="秒" />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={12}>
                            <Form.Item name="strategy_log_level" label="默认日志级别">
                              <Select options={[{ label: 'info', value: 'info' }, { label: 'warning', value: 'warning' }, { label: 'error', value: 'error' }]} />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={12}>
                            <Form.Item name="intraday_auto_run" label="盘中自动运行" valuePropName="checked">
                              <Switch />
                            </Form.Item>
                          </Col>
                        </Row>
                        <div className="system-setting-checklist">
                          <div><span>运行方式</span><strong>长任务 task_id 轮询</strong></div>
                          <div><span>失败处理</span><strong>错误可复制给 AI 排查</strong></div>
                          <div><span>数据边界</span><strong>策略只能读取受控上下文</strong></div>
                        </div>
                      </div>
                    </Col>
                    <Col xs={24} xl={8}>
                      <div className="system-form-block">
                        <Typography.Text strong>日志与保留</Typography.Text>
                        <Row gutter={16}>
                          <Col xs={24} md={12}>
                            <Form.Item name="strategy_max_log_mb" label="策略最大日志大小">
                              <InputNumber min={1} style={{ width: '100%' }} suffix="MB" />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={12}>
                            <Form.Item name="log_retention_days" label="日志保留天数">
                              <InputNumber min={1} style={{ width: '100%' }} suffix="天" />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={12}>
                            <Form.Item name="task_retention_days" label="任务保留天数">
                              <InputNumber min={1} style={{ width: '100%' }} suffix="天" />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Alert type="info" showIcon message="自动运行说明" description="第一版仅保留配置开关，不新增复杂调度平台；策略仍只生成信号，不直接下单。" />
                        <div className="system-setting-checklist">
                          <div><span>日志限制</span><strong>按大小和保留天数清理</strong></div>
                          <div><span>任务保留</span><strong>保留周期避免无限增长</strong></div>
                          <div><span>自动运行</span><strong>不会绕过交易确认</strong></div>
                        </div>
                      </div>
                    </Col>
                    <Col xs={24} xl={8}>
                      <div className="system-form-block system-form-block--evidence">
                        <Typography.Text strong>策略运行边界</Typography.Text>
                        <div className="system-setting-checklist">
                          <div><span>接口要求</span><strong>统一 Strategy 类</strong></div>
                          <div><span>数据读取</span><strong>StrategyContext 受控读取</strong></div>
                          <div><span>交易权限</span><strong>不得直接调用 QMT</strong></div>
                          <div><span>用户策略</span><strong>不覆盖 strategies/user/</strong></div>
                          <div><span>运行结果</span><strong>信号进入交易确认流程</strong></div>
                          <div><span>回测边界</span><strong>只读取本地 SQLite 历史数据</strong></div>
                          <div><span>实盘边界</span><strong>策略不得直接下单</strong></div>
                        </div>
                      </div>
                    </Col>
                  </Row>
                  <Space wrap className="system-form-actions">
                    <Button aria-label="保存策略设置" title="保存策略设置" type="primary" onClick={saveConfig}>保存设置</Button>
                  </Space>
                  <div className="system-config-evidence-grid" data-testid="system-strategy-evidence-grid">
                    <div>
                      <span>运行入口</span>
                      <strong>策略开发中心创建任务并返回 task_id，前端轮询状态</strong>
                    </div>
                    <div>
                      <span>数据边界</span>
                      <strong>策略只能通过 StrategyContext 读取本地 SQLite 数据</strong>
                    </div>
                    <div>
                      <span>回测边界</span>
                      <strong>回测读取历史行情，不调用真实 QMT 下单接口</strong>
                    </div>
                    <div>
                      <span>交易边界</span>
                      <strong>策略只生成信号，信号进入人工确认下单流程</strong>
                    </div>
                  </div>
                </Form>
              </SectionCard>
            ),
          },
          {
            key: '日志中心',
            label: '日志中心',
            children: (
              <SectionCard
                title="日志中心"
                description="系统日志分页展示，可导出本地日志压缩包。"
                extra={<Button aria-label="导出系统日志" title="导出系统日志" icon={<DownloadOutlined />} loading={loading} disabled={loading} onClick={exportLogs}>导出日志</Button>}
                className="system-audit-workbench-card system-audit-workbench-card--logs"
              >
                <div className="system-audit-summary-strip" data-testid="system-log-audit-strip">
                  <div>
                    <span>日志保留</span>
                    <strong>{config?.log_retention_days ?? '--'} 天</strong>
                  </div>
                  <div>
                    <span>日志大小</span>
                    <strong>{formatBytes(monitor?.log_size_bytes ?? 0)}</strong>
                  </div>
                  <div>
                    <span>错误线索</span>
                    <strong>{monitor?.recent_errors?.length ?? 0} 条</strong>
                  </div>
                  <div>
                    <span>导出用途</span>
                    <strong>排障包 / AI 诊断</strong>
                  </div>
                </div>
                <DataTable<SystemLogRecord>
                  rowKey="id"
                  columns={logColumns}
                  dataSource={logs}
                  loading={loading}
                  updatedAt={updatedAt}
                  onRefresh={loadAll}
                  pagination={logPagination}
                  data-testid="table-system-logs"
                  className="system-logs-table data-table--system-logs"
                  tableLayout="fixed"
                  scroll={{ x: TABLE_SCROLL_X.systemLogs }}
                  quickSearch={{ placeholder: '搜索模块/日志/trace_id/task_id', fields: ['module', 'message', 'technical_detail', 'related_id'], width: 300 }}
                  quickFilters={[
                    { label: '模块', options: logModuleOptions, getValue: (record) => record.module, width: 150 },
                    { label: '日志级别', options: ['info', 'warning', 'error'].map((value) => ({ label: value, value })), getValue: (record) => record.level },
                    { label: '时间范围', options: ['今天', '近7天', '更早'].map((value) => ({ label: value, value })), getValue: (record) => getTimeBucket(record.created_at) },
                  ]}
                  emptyDescription="暂无系统日志。运行同步、策略、回测或交易操作后会记录在这里。"
                />
              </SectionCard>
            ),
          },
          {
            key: '运行监控',
            label: '运行监控',
            children: (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <SectionCard
                  title="运行监控"
                  description="观察任务、数据库、日志大小和最近错误。"
                  extra={<Button aria-label="清理并归档历史日志和任务" title="清理并归档历史日志和任务" onClick={createCleanupTask} loading={loading} disabled={loading} data-testid="btn-maintenance-cleanup">清理归档</Button>}
                >
                  <Row gutter={[8, 8]}>
                    <Col xs={24} sm={12} lg={6}><MetricCard label="运行中任务" value={monitor?.running_task_count ?? 0} tone="blue" /></Col>
                    <Col xs={24} sm={12} lg={6}>
                      <MetricCard
                        label="今日失败任务"
                        value={monitor?.failed_task_count ?? 0}
                        subValue={monitorFailedHint}
                        tone={(monitor?.failed_task_count ?? 0) > 0 ? 'red' : 'default'}
                      />
                    </Col>
                    <Col xs={24} sm={12} lg={6}><MetricCard label="数据库大小" value={formatBytes(monitor?.database_size_bytes ?? 0)} /></Col>
                    <Col xs={24} sm={12} lg={6}><MetricCard label="日志大小" value={formatBytes(monitor?.log_size_bytes ?? 0)} /></Col>
                  </Row>
                  {restartInterruptedCount > 0 ? (
                    <Alert
                      className="system-restart-task-alert"
                      type="warning"
                      showIcon
                      message={`检测到 ${restartInterruptedCount} 条服务重启导致的任务中断记录`}
                      description="系统已自动把遗留的运行中任务标记为失败，避免页面长期卡在运行中。请根据任务类型重新发起同步、回测、策略运行或备份操作。"
                    />
                  ) : null}
                  <div className="monitor-health-grid">
                    {monitorHealthItems.map((item) => (
                      <div className={`monitor-health-card monitor-health-card--${item.tone}`} key={item.label}>
                        <Typography.Text type="secondary">{item.label}</Typography.Text>
                        <Typography.Text strong>{item.value}</Typography.Text>
                        <Typography.Text type="secondary">{item.hint}</Typography.Text>
                      </div>
                    ))}
                  </div>
                  <DataTable<RuntimeTaskRecord>
                    rowKey="task_id"
                    columns={monitorTaskColumns}
                    dataSource={monitor?.slow_tasks ?? []}
                    loading={loading}
                    pagination={false}
                    data-testid="table-monitor-tasks"
                    className="system-monitor-task-table data-table--system-monitor-tasks"
                    tableLayout="fixed"
                    scroll={{ x: TABLE_SCROLL_X.systemTasks }}
                    quickSearch={{ placeholder: '当前页搜索任务ID/类型/说明', fields: ['task_id', 'task_type', 'message', 'technical_detail'], width: 280 }}
                    emptyDescription="暂无慢任务或需关注的运行任务。若数据同步、回测或备份正在执行，系统会在这里显示可定位的任务记录。"
                  />
                </SectionCard>
                <SectionCard title="最近错误" description="用于快速定位长期运行中的异常。">
                  {(monitor?.recent_errors ?? []).length === 0 ? (
                    <EmptyGuide description="暂无错误日志。系统当前未记录失败或异常；如页面异常，请先运行环境检测，或到“日志中心”导出日志给 AI 排查。" />
                  ) : (
                    <div className="recent-error-list">
                      {monitor?.recent_errors.map((item) => (
                        <div className="recent-error-item" key={item.id}>
                          <Typography.Text type="secondary">{item.created_at}</Typography.Text>
                          <Typography.Text>{item.message}</Typography.Text>
                        </div>
                      ))}
                    </div>
                  )}
                </SectionCard>
                <SectionCard
                  title={`启动健康检查：${startupCheck?.checked_at ?? '暂无'}`}
                  description={`${startupStats.success} 正常 / ${startupStats.warning} 警告 / ${startupStats.failed} 失败`}
                >
                  <DataTable<StartupCheckItem>
                    rowKey="check_item"
                    columns={startupColumns}
                    dataSource={startupCheck?.items ?? []}
                    loading={loading}
                    updatedAt={startupCheck?.checked_at ?? updatedAt}
                    onRefresh={loadAll}
                    pagination={false}
                    data-testid="table-startup-check"
                    className="system-startup-table data-table--system-startup"
                    tableLayout="fixed"
                    scroll={{ x: TABLE_SCROLL_X.systemStartup }}
                    quickSearch={{ placeholder: '当前页搜索检查项/说明/建议', fields: ['check_item', 'message', 'suggestion', 'technical_detail'], width: 280 }}
                    quickFilters={[{ label: '健康状态', options: [{ label: '正常', value: 'success' }, { label: '警告', value: 'warning' }, { label: '失败', value: 'failed' }], getValue: (record) => record.status }]}
                    emptyDescription="暂无启动健康检查结果。请点击页面右上“刷新”，或重新打开系统后再查看后端、前端、数据库和 xtquant 状态。"
                  />
                </SectionCard>
              </Space>
            ),
          },
          {
            key: '备份恢复',
            label: '备份恢复',
            children: (
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <div className="backup-guard-panel" data-testid="backup-guard-panel">
                  <div>
                    <Typography.Text strong>备份恢复护栏</Typography.Text>
                    <Typography.Paragraph type="secondary" className="backup-guard-panel__description">
                      创建备份覆盖数据库、配置、用户策略和重要日志；恢复前自动生成当前快照，且不会覆盖 strategies/user。
                    </Typography.Paragraph>
                  </div>
                  <div className="backup-guard-panel__items">
                    <Tag color="blue">恢复前快照</Tag>
                    <Tag color="green">策略目录保护</Tag>
                    <Tag color="orange">人工确认</Tag>
                    <Tag color="purple">操作日志记录</Tag>
                  </div>
                </div>
                <Alert
                  type="warning"
                  showIcon
                  message="恢复备份前请停止同步、回测和交易操作"
                  description="恢复任务会先生成当前快照；用户策略只提取到备份目录，不覆盖 strategies/user。"
                />
                <SectionCard
                  title="备份恢复"
                  description="备份数据库、配置、用户策略和重要日志。"
                  extra={<Button aria-label="创建本地系统备份" title="创建本地系统备份" type="primary" loading={loading} disabled={loading} onClick={createBackupRecord} data-testid="btn-create-backup">创建备份</Button>}
                >
                  {backups.length > 0 ? (
                    <div className="backup-timeline">
                      {backups.slice(0, 5).map((backup) => (
                        <div className="backup-timeline__item" key={backup.id}>
                          <div className="backup-timeline__dot" />
                          <div className="backup-timeline__content">
                            <Space wrap className="backup-timeline__head">
                              <Typography.Text strong>{backup.backup_name}</Typography.Text>
                              <Tag color="green">{backup.status}</Tag>
                            </Space>
                            <Typography.Text type="secondary">
                              {backup.created_at} / {formatBytes(backup.backup_size)}
                            </Typography.Text>
                            <Space size={8} className="backup-timeline__actions">
                              <TableActionGroup
                                primary={<Button aria-label={`查看备份详情 ${backup.backup_name}`} title={`查看备份详情 ${backup.backup_name}`} size="small" onClick={() => showBackupDetail(backup)}>详情</Button>}
                                actions={[
                                  { key: 'restore', label: '恢复备份', type: 'restore', danger: true, onClick: () => confirmRestore(backup) },
                                  { key: 'delete', label: '删除备份', type: 'delete', danger: true, onClick: () => confirmDeleteBackup(backup) },
                                ]}
                              />
                            </Space>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <DataTable<BackupRecord>
                    rowKey="id"
                    columns={backupColumns}
                    dataSource={backups}
                    loading={loading}
                    updatedAt={updatedAt}
                    onRefresh={loadAll}
                    pagination={backupPagination}
                    data-testid="table-backups"
                    className="system-backups-table data-table--system-backups"
                    tableLayout="fixed"
                    scroll={{ x: TABLE_SCROLL_X.systemBackups }}
                    quickSearch={{ placeholder: '当前页搜索备份名称/路径/状态', fields: ['backup_name', 'backup_path', 'status'], width: 280 }}
                    quickFilters={[{ label: '备份状态', options: ['success', 'failed', 'running'].map((value) => ({ label: value, value })), getValue: (record) => record.status }]}
                    emptyDescription="暂无备份记录。点击“创建备份”后会生成数据库、配置和策略目录备份。"
                  />
                </SectionCard>
              </Space>
            ),
          },
          {
            key: '操作记录',
            label: '操作记录',
            children: (
              <SectionCard
                title="操作记录"
                description="保存配置、环境检测、同步、回测和交易操作都会写入这里。"
                className="system-audit-workbench-card system-audit-workbench-card--operations"
              >
                <div className="system-audit-summary-strip" data-testid="system-operation-audit-strip">
                  <div>
                    <span>记录总数</span>
                    <strong>{operationsTotal} 条</strong>
                  </div>
                  <div>
                    <span>写入范围</span>
                    <strong>配置 / 同步 / 回测 / 交易</strong>
                  </div>
                  <div>
                    <span>失败定位</span>
                    <strong>中文原因 + 技术详情</strong>
                  </div>
                  <div>
                    <span>审计边界</span>
                    <strong>写操作必须留痕</strong>
                  </div>
                </div>
                <DataTable<OperationLogRecord>
                  rowKey="id"
                  columns={operationColumns}
                  dataSource={operations}
                  loading={loading}
                  updatedAt={updatedAt}
                  onRefresh={loadAll}
                  pagination={operationPagination}
                  data-testid="table-operations"
                  className="system-operations-table data-table--system-operations"
                  tableLayout="fixed"
                  scroll={{ x: TABLE_SCROLL_X.systemOperations }}
                  quickSearch={{ placeholder: '当前页搜索模块/操作/说明', fields: ['module', 'action', 'message', 'target_id', 'technical_detail'], width: 280 }}
                  quickFilters={[{ label: '操作结果', options: [{ label: '成功', value: '成功' }, { label: '失败', value: '失败' }], getValue: (record) => record.result }]}
                  emptyDescription="暂无操作记录。保存配置、环境检测、同步数据和交易操作都会写入记录。"
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
