import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  CodeOutlined,
  CopyOutlined,
  ExperimentOutlined,
  FileAddOutlined,
  FileTextOutlined,
  PlayCircleOutlined,
  SaveOutlined,
  ToolOutlined,
} from '@ant-design/icons';
import { Alert, App, Button, Col, Form, Input, Modal, Row, Skeleton, Space, Tabs, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { Link } from 'react-router-dom';
import DataTable from '../../components/DataTable';
import DataFreshnessTag from '../../components/DataFreshnessTag';
import ErrorDetailModal from '../../components/ErrorDetailModal';
import EmptyGuide from '../../components/EmptyGuide';
import LogDrawer, { type LogDrawerField } from '../../components/LogDrawer';
import MetricCard from '../../components/MetricCard';
import PageHeader from '../../components/PageHeader';
import RiskConfirmContent from '../../components/RiskConfirmContent';
import SectionCard from '../../components/SectionCard';
import SignalTable from '../../components/SignalTable';
import TableActionGroup from '../../components/TableActionGroup';
import TaskProgress from '../../components/TaskProgress';
import { useTaskPolling } from '../../hooks/useTaskPolling';
import { useUrlSyncedTab } from '../../hooks/useUrlSyncedTab';
import { RequestError } from '../../services/request';
import {
  copyExampleStrategy,
  createStrategyFile,
  deleteStrategy,
  getStrategyContent,
  getStrategyFiles,
  getStrategyRuns,
  getStrategySignals,
  getStrategyVersion,
  getStrategyVersions,
  ignoreSignal,
  restoreStrategyVersion,
  runStrategy,
  saveStrategyContent,
  stopStrategyRun,
  updateStrategyStatus,
  validateStrategy,
} from '../../services/strategyDev';
import { defaultPageState, type ApiError, type PageState } from '../../types/api';
import type { StrategyFileRecord, StrategyRunRecord, StrategySignalRecord, StrategyVersionPage, StrategyVersionRecord } from '../../types/strategyDev';
import type { RuntimeTaskRecord } from '../../types/system';
import { writeTextToClipboard } from '../../utils/clipboard';
import { formatMaybe } from '../../utils/format';
import { TABLE_COL } from '../../utils/tableColumns';
import { formatNow } from '../../utils/time';
import './StrategyDev.css';

const CodeEditor = lazy(() => import('../../components/CodeEditor'));

function CodeEditorSkeleton() {
  return (
    <div className="strategy-editor-skeleton" data-testid="strategy-editor-skeleton">
      <div className="strategy-editor-skeleton__bar">
        <Skeleton.Input active size="small" style={{ width: 180 }} />
        <Skeleton.Input active size="small" style={{ width: 96 }} />
      </div>
      <Skeleton active paragraph={{ rows: 10 }} title={false} />
      <Typography.Text type="secondary">正在加载代码编辑器...</Typography.Text>
    </div>
  );
}

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
  message?: ReactNode;
  messageCopyText?: string;
  technicalDetail?: ReactNode;
  technicalCopyText?: string;
  fields?: LogDrawerField[];
  width?: number;
  fieldColumns?: number;
  className?: string;
}

const statusColor: Record<string, string> = {
  enabled: 'green',
  disabled: 'default',
  running: 'blue',
  success: 'green',
  failed: 'red',
  cancelled: 'orange',
};

const statusLabel: Record<string, string> = {
  enabled: '启用',
  disabled: '停用',
  running: '运行中',
  success: '成功',
  failed: '失败',
  cancelled: '已取消',
};

function buildStrategyQaDetail(qaType: string, payload: Record<string, unknown>) {
  return JSON.stringify(
    {
      qa_type: qaType,
      ai_copy_version: '1.0',
      module: '策略开发',
      constraints: {
        strategy_only_generates_signals: true,
        qmt_direct_call_forbidden: true,
        direct_order_forbidden: true,
        use_strategy_context_only: true,
      },
      ...payload,
    },
    null,
    2,
  );
}

const strategyTabKeys = ['策略文件', '代码编辑', '运行调试', '策略信号', '版本记录'] as const;
type StrategyTabKey = (typeof strategyTabKeys)[number];

function renderStrategyAuditText(value?: string | null, strong = false) {
  const text = value || '暂无';
  return (
    <Typography.Text strong={strong} className="strategy-audit-cell-text" title={text}>
      {text}
    </Typography.Text>
  );
}

function renderStrategyFileName(value?: string | null) {
  const text = value || '暂无';
  return (
    <Typography.Text className="strategy-audit-cell-code strategy-file-code-cell" title={text}>
      {text}
    </Typography.Text>
  );
}

function runStrategyName(record: StrategyRunRecord) {
  return record.strategy_name || `策略ID ${record.strategy_id}`;
}

function shortHash(value?: string | null) {
  return value ? value.slice(0, 12) : '暂无';
}

export default function StrategyDev() {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<{ fileName: string; strategyName: string }>();
  const [files, setFiles] = useState<StrategyFileRecord[]>([]);
  const [runs, setRuns] = useState<StrategyRunRecord[]>([]);
  const [signals, setSignals] = useState<StrategySignalRecord[]>([]);
  const [versions, setVersions] = useState<StrategyVersionRecord[]>([]);
  const [filePage, setFilePage] = useState<PageState>(defaultPageState);
  const [runPage, setRunPage] = useState<PageState>(defaultPageState);
  const [signalPage, setSignalPage] = useState<PageState>(defaultPageState);
  const [versionPage, setVersionPage] = useState<PageState>(defaultPageState);
  const [selected, setSelected] = useState<StrategyFileRecord | null>(null);
  const [code, setCode] = useState('');
  const [activeTab, setActiveTab] = useUrlSyncedTab<StrategyTabKey>(strategyTabKeys, '策略文件');
  const [activeTask, setActiveTask] = useState<RuntimeTaskRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionBusyKey, setActionBusyKey] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
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

  const applyVersionPage = useCallback((result: StrategyVersionPage) => {
    setVersions(result.items);
    setVersionPage((previous) =>
      previous.page === result.page && previous.pageSize === result.page_size && previous.total === result.total
        ? previous
        : { page: result.page, pageSize: result.page_size, total: result.total },
    );
  }, []);

  const selectStrategy = useCallback((record: StrategyFileRecord | null) => {
    setSelected(record);
    setVersions([]);
    setVersionPage({ ...defaultPageState });
    if (!record) {
      setCode('');
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [filesResult, runsResult, signalsResult] = await Promise.all([
        getStrategyFiles(filePage),
        getStrategyRuns(runPage),
        getStrategySignals(signalPage),
      ]);
      setFiles(filesResult.items);
      setRuns(runsResult.items);
      setSignals(signalsResult.items);
      setFilePage((previous) => (previous.total === filesResult.total ? previous : { ...previous, total: filesResult.total }));
      setRunPage((previous) => (previous.total === runsResult.total ? previous : { ...previous, total: runsResult.total }));
      setSignalPage((previous) => (previous.total === signalsResult.total ? previous : { ...previous, total: signalsResult.total }));
      if (!selected && filesResult.items.length > 0) {
        selectStrategy(filesResult.items[0]);
      }
      setUpdatedAt(formatNow());
    } catch (error) {
      showError('加载策略开发数据失败', error);
    } finally {
      setLoading(false);
    }
  }, [filePage, runPage, selected, selectStrategy, showError, signalPage]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (!selected) return;
    void (async () => {
      try {
        const [content, versionResult] = await Promise.all([getStrategyContent(selected.id), getStrategyVersions(selected.id, versionPage)]);
        setCode(content.code_content);
        applyVersionPage(versionResult);
      } catch (error) {
        showError('读取策略代码失败', error);
      }
    })();
  }, [applyVersionPage, selected, showError, versionPage]);

  useTaskPolling({
    task: activeTask,
    onTaskChange: setActiveTask,
    onFinished: loadAll,
    onError: (error) => showError('刷新策略任务失败', error),
  });

  const createFile = async () => {
    try {
      const values = await form.validateFields();
      const record = await createStrategyFile(values.fileName, values.strategyName);
      message.success('策略已新建');
      selectStrategy(record);
      setCreateOpen(false);
      form.resetFields();
      await loadAll();
    } catch (error) {
      showError('新建策略失败', error);
    }
  };

  const copyExample = async () => {
    try {
      const record = await copyExampleStrategy();
      message.success('示例策略已复制');
      selectStrategy(record);
      await loadAll();
    } catch (error) {
      showError('复制示例失败', error);
    }
  };

  const saveCode = async () => {
    if (!selected) return;
    const busyKey = `save:${selected.id}`;
    if (actionBusyKey) return;
    setActionBusyKey(busyKey);
    try {
      await saveStrategyContent(selected.id, code);
      message.success('策略代码已保存，并生成版本快照');
      await loadAll();
      applyVersionPage(await getStrategyVersions(selected.id, { page: 1, pageSize: versionPage.pageSize }));
    } catch (error) {
      showError('保存策略失败', error);
    } finally {
      setActionBusyKey(null);
    }
  };

  const checkStrategy = async () => {
    if (!selected) return;
    const busyKey = `check:${selected.id}`;
    if (actionBusyKey) return;
    setActionBusyKey(busyKey);
    try {
      const result = await validateStrategy(selected.id);
      message.success(result.message);
    } catch (error) {
      showError('接口检查失败', error);
    } finally {
      setActionBusyKey(null);
    }
  };

  const runSelected = async (record = selected) => {
    if (!record) return;
    const busyKey = `run:${record.id}`;
    if (actionBusyKey) return;
    setActionBusyKey(busyKey);
    try {
      const task = await runStrategy(record.id);
      setActiveTask({ ...task, created_at: formatNow() });
      message.success('策略运行任务已创建');
      await loadAll();
    } catch (error) {
      showError('运行策略失败', error);
    } finally {
      setActionBusyKey(null);
    }
  };

  const stopRun = async (record: StrategyRunRecord) => {
    const busyKey = `stop:${record.run_id}`;
    if (actionBusyKey) return;
    setActionBusyKey(busyKey);
    try {
      await stopStrategyRun(record.run_id);
      message.success('策略停止请求已提交');
      await loadAll();
    } catch (error) {
      showError('停止策略运行失败', error);
    } finally {
      setActionBusyKey(null);
    }
  };

  const openStrategyInEditor = (record: StrategyFileRecord) => {
    selectStrategy(record);
    setActiveTab('代码编辑');
  };

  const locateRunStrategy = (record: StrategyRunRecord) => {
    const target = files.find((item) => item.id === record.strategy_id);
    if (!target) {
      message.warning(`未在当前策略列表中找到策略 ID ${record.strategy_id}，请刷新策略文件后重试。`);
      return;
    }
    openStrategyInEditor(target);
    message.info(`已定位到策略：${target.strategy_name} / ${target.file_name}`);
  };

  const copyRunErrorForAi = async (record: StrategyRunRecord) => {
    const text = [
      'qa_type：strategy_run_detail',
      `策略运行ID：${record.run_id}`,
      `策略ID：${record.strategy_id}`,
      `策略名称：${runStrategyName(record)}`,
      `策略文件：${record.strategy_file_name || '旧记录未保存文件名'}`,
      `策略版本：${record.strategy_version || '旧记录未保存版本'}`,
      `代码哈希：${record.strategy_code_hash || '旧记录未保存代码哈希'}`,
      `运行状态：${statusLabel[record.status] ?? record.status}`,
      `中文说明：${record.message || '暂无'}`,
      `技术详情：${buildStrategyQaDetail('strategy_run_detail', {
        run: {
          id: record.id,
          run_id: record.run_id,
          strategy_id: record.strategy_id,
          strategy_name: record.strategy_name,
          strategy_file_name: record.strategy_file_name,
          strategy_version: record.strategy_version,
          strategy_code_hash: record.strategy_code_hash,
          task_id: record.task_id,
          status_raw: record.status,
          status_text: statusLabel[record.status] ?? record.status,
          signal_count: record.signal_count,
          message: record.message,
          technical_detail: record.technical_detail,
          started_at: record.started_at,
          finished_at: record.finished_at,
        },
        next_steps: [
          '检查 Strategy(context).run() 是否返回 list',
          '检查信号字段 symbol/action/price/reason/signal_time 是否齐全',
          '检查策略是否只通过 StrategyContext 读取数据',
          '策略不得直接调用 QMT 或直接下单',
        ],
        raw: record,
      })}`,
    ].join('\n');
    await writeTextToClipboard(text);
    message.success('已复制策略错误给 AI');
  };

  const copyRunSummary = async (record: StrategyRunRecord) => {
    try {
      await writeTextToClipboard(JSON.stringify({
        module: '策略开发',
        source_page: '策略开发 / 运行调试',
        run_id: record.run_id,
        task_id: record.task_id,
        strategy_id: record.strategy_id,
        strategy_name: record.strategy_name || null,
        strategy_file_name: record.strategy_file_name || null,
        strategy_version: record.strategy_version || null,
        strategy_code_hash: record.strategy_code_hash || null,
        status: record.status,
        signal_count: record.signal_count,
        message: record.message,
        technical_detail: record.technical_detail ?? null,
        started_at: record.started_at ?? null,
        finished_at: record.finished_at ?? null,
      }, null, 2));
      message.success('策略运行摘要已复制');
    } catch {
      message.error('策略运行摘要复制失败，请手动复制运行 ID。');
    }
  };

  const openRunLog = (record: StrategyRunRecord) => {
    const isFailed = record.status === 'failed';
    setLogDrawer({
      title: isFailed ? '策略运行失败详情' : '策略运行详情',
      subtitle: `${record.run_id} / 策略ID ${record.strategy_id}`,
      status: statusLabel[record.status] ?? record.status,
      statusTone: isFailed ? 'red' : record.status === 'running' ? 'blue' : record.status === 'success' ? 'green' : 'default',
      width: 720,
      fieldColumns: 2,
      className: 'strategy-run-detail-drawer',
      message: record.message || (isFailed ? '策略运行失败，但后端未返回中文说明。' : '暂无中文说明。'),
      technicalDetail: buildStrategyQaDetail('strategy_run_detail', {
        run: {
          id: record.id,
          run_id: record.run_id,
          strategy_id: record.strategy_id,
          strategy_name: record.strategy_name,
          strategy_file_name: record.strategy_file_name,
          strategy_version: record.strategy_version,
          strategy_code_hash: record.strategy_code_hash,
          task_id: record.task_id,
          status_raw: record.status,
          status_text: statusLabel[record.status] ?? record.status,
          signal_count: record.signal_count,
          message: record.message,
          technical_detail: record.technical_detail,
          started_at: record.started_at,
          finished_at: record.finished_at,
        },
        ui_next_steps: isFailed
            ? [
                '检查 Strategy(context).run() 接口是否返回 list',
                '检查信号字段是否包含 symbol/action/price/reason/signal_time',
                '检查策略是否只通过 StrategyContext 读取数据',
                '不要在策略里直接调用 QMT 或直接下单',
              ]
            : ['确认信号数量符合预期', '如需下单，请进入交易执行中心人工确认'],
        raw: record,
      }),
      fields: [
        { label: '运行 ID', value: record.run_id },
        { label: '策略 ID', value: record.strategy_id },
        { label: '策略名称', value: runStrategyName(record) },
        { label: '策略文件', value: record.strategy_file_name || '旧记录未保存文件名' },
        { label: '策略版本', value: record.strategy_version || '旧记录未保存版本' },
        { label: '代码哈希', value: shortHash(record.strategy_code_hash), copyValue: record.strategy_code_hash || '' },
        { label: '任务 ID', value: record.task_id },
        { label: '状态', value: <Tag color={statusColor[record.status] ?? 'default'}>{statusLabel[record.status] ?? record.status}</Tag>, copyValue: statusLabel[record.status] ?? record.status },
        { label: '信号数', value: record.signal_count },
        { label: '开始时间', value: record.started_at },
        { label: '结束时间', value: record.finished_at },
      ],
    });
  };

  const copyStrategyContextForAi = async () => {
    const text = [
      `策略名称：${selected?.strategy_name ?? '未选择'}`,
      `文件名：${selected?.file_name ?? '未选择'}`,
      `接口要求：Strategy(context).run() 只生成信号，不直接调用 QMT，不直接下单。`,
      '请根据以下代码和运行错误，检查策略接口、字段读取、信号格式和中文错误原因。',
      '',
      code,
    ].join('\n');
    try {
      await writeTextToClipboard(text);
      message.success('已复制策略上下文给 AI');
    } catch {
      message.error('复制失败，请手动选择策略代码复制。');
    }
  };

  const openVersionDetail = async (record: StrategyVersionRecord) => {
    try {
      const detail = await getStrategyVersion(record.id);
      setLogDrawer({
        title: '策略版本详情',
        subtitle: `${record.version_no} / ${record.created_at}`,
        status: '版本快照',
        statusTone: 'blue',
        width: 720,
        fieldColumns: 2,
        className: 'strategy-version-detail-drawer',
        message: (
          <div className="strategy-version-code-panel" data-testid="strategy-version-code-panel">
            <div className="strategy-version-code-panel__head">
              <Typography.Text strong>只读版本快照代码</Typography.Text>
              <Typography.Text type="secondary">
                Python / {detail.code_content.length.toLocaleString()} 字符 / 恢复前请先核对版本号和代码摘要
              </Typography.Text>
            </div>
            <Suspense fallback={<CodeEditorSkeleton />}>
              <CodeEditor value={detail.code_content} readOnly height="360px" />
            </Suspense>
          </div>
        ),
        messageCopyText: detail.code_content,
        technicalDetail: buildStrategyQaDetail('strategy_version_detail', {
          version: {
            id: detail.id,
            strategy_id: detail.strategy_id,
            version_no: detail.version_no,
            code_hash: detail.code_hash,
            remark: detail.remark,
            created_at: detail.created_at,
          },
          code: {
            file_scope: 'strategies/user 版本快照',
            code_hash: detail.code_hash,
            code_length: detail.code_content.length,
            code_preview: detail.code_content.slice(0, 1600),
            full_code_copy_source: '点击抽屉右上角“复制中文说明”可复制完整快照代码',
          },
          next_steps: ['恢复版本后先检查接口', '再小范围试运行策略', '确认信号后再进入回测或交易执行人工确认流程'],
          raw: { ...detail, code_content: undefined },
        }),
        fields: [
          { label: '策略 ID', value: detail.strategy_id },
          { label: '版本号', value: detail.version_no },
          { label: '代码摘要', value: detail.code_hash },
          { label: '备注', value: detail.remark ?? '暂无' },
          { label: '保存时间', value: detail.created_at },
        ],
      });
    } catch (error) {
      showError('读取版本详情失败', error);
    }
  };

  const copyVersionCode = async (record: StrategyVersionRecord) => {
    try {
      const detail = await getStrategyVersion(record.id);
      await writeTextToClipboard(detail.code_content);
      message.success('已复制版本代码');
    } catch (error) {
      showError('复制版本代码失败', error);
    }
  };

  const confirmRestoreVersion = (record: StrategyVersionRecord) => {
    modal.confirm({
      className: 'strategy-confirm-modal',
      width: 720,
      centered: true,
      maskClosable: false,
      title: '恢复策略版本',
      content: (
        <RiskConfirmContent
          level="warning"
          summary={`即将恢复版本：${record.version_no}`}
          objectLabel={`版本 ${record.version_no}`}
          riskItems={[
            '恢复会把当前策略代码替换为该版本快照。',
            '系统会通过已有版本恢复接口保存，不会修改策略接口和交易逻辑。',
            '恢复后建议先检查接口，再试运行策略。',
          ]}
          details={[
            { label: '策略 ID', value: record.strategy_id },
            { label: '版本号', value: record.version_no },
            { label: '保存时间', value: record.created_at },
            { label: '备注', value: record.remark ?? '暂无' },
          ]}
          nextStep="恢复后先点击检查接口，再用小范围策略运行验证信号，确认无误后再进入回测。"
        />
      ),
      okText: '确认恢复',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const restored = await restoreStrategyVersion(record.id);
          setCode(restored.code_content);
          if (selected) {
            applyVersionPage(await getStrategyVersions(selected.id, { page: 1, pageSize: versionPage.pageSize }));
          }
          message.success('策略版本已恢复，请先检查接口再运行');
        } catch (error) {
          showError('恢复策略版本失败', error);
        }
      },
    });
  };

  const deleteSelected = (record: StrategyFileRecord) => {
    modal.confirm({
      className: 'strategy-confirm-modal',
      width: 720,
      centered: true,
      maskClosable: false,
      title: '删除策略',
      content: (
        <RiskConfirmContent
          level="error"
          summary={`即将删除策略：${record.strategy_name}`}
          objectLabel={record.strategy_name}
          riskItems={[
            '此操作会删除该策略文件和策略记录。',
            '删除后页面不会再展示该策略，也无法直接运行或进入回测。',
            '不会改动交易订单、成交记录和已生成的信号状态。',
          ]}
          details={[
            { label: '策略 ID', value: record.id },
            { label: '文件名', value: record.file_name },
            { label: '状态', value: statusLabel[record.status] ?? record.status },
          ]}
          nextStep="删除前请确认该策略代码已经备份或不再使用；删除后如需恢复，需要重新导入或重建策略文件。"
        />
      ),
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteStrategy(record.id);
          message.success('策略已删除');
          if (selected?.id === record.id) {
            selectStrategy(null);
          }
          await loadAll();
        } catch (error) {
          showError('删除策略失败', error);
        }
      },
    });
  };

  const enabledCount = files.filter((item) => item.status === 'enabled').length;
  const todaySignalCount = files.reduce((sum, item) => sum + item.today_signal_count, 0);
  const failedRunCount = runs.filter((item) => item.status === 'failed').length;
  const latestFailedRun = runs.find((item) => item.status === 'failed' && (item.technical_detail || item.message));
  const selectedLatestRun = useMemo(
    () => runs.find((item) => item.strategy_id === selected?.id) ?? null,
    [runs, selected?.id],
  );
  const latestVersion = versions[0] ?? null;

  const fileColumns: ColumnsType<StrategyFileRecord> = [
    { title: '策略ID', dataIndex: 'id', width: TABLE_COL.id, fixed: 'left' },
    {
      title: '策略名称',
      dataIndex: 'strategy_name',
      width: TABLE_COL.strategyWide,
      render: (value: string) => renderStrategyAuditText(value, true),
    },
    {
      title: '文件名',
      dataIndex: 'file_name',
      width: TABLE_COL.fileNameWide,
      render: (value: string) => renderStrategyFileName(value),
    },
    { title: '版本', dataIndex: 'version', width: TABLE_COL.version },
    { title: '状态', dataIndex: 'status', width: TABLE_COL.status, render: (v: string) => <Tag color={statusColor[v] ?? 'default'}>{statusLabel[v] ?? v}</Tag> },
    { title: '最近修改', dataIndex: 'last_modified_at', width: TABLE_COL.time, responsive: ['xxl'] },
    { title: '最近运行', dataIndex: 'last_run_at', width: TABLE_COL.time, responsive: ['xxl'] },
    { title: '今日信号', dataIndex: 'today_signal_count', width: TABLE_COL.quantity },
    {
      title: '操作',
      width: TABLE_COL.type,
      fixed: 'right',
      render: (_, record) => (
        <TableActionGroup
          primary={<Button aria-label={`编辑策略 ${record.strategy_name}`} title={`编辑策略 ${record.strategy_name}`} size="small" type="primary" icon={<CodeOutlined />} onClick={() => openStrategyInEditor(record)}>编辑</Button>}
          actions={[
              { key: 'run', label: '试运行策略', disabled: Boolean(actionBusyKey), onClick: () => runSelected(record) },
              {
                key: 'status',
                label: record.status === 'enabled' ? '停用策略' : '启用策略',
                onClick: () => updateStrategyStatus(record.id, record.status === 'enabled' ? 'disabled' : 'enabled').then(loadAll),
              },
              { key: 'delete', label: '删除策略', type: 'delete', danger: true, onClick: () => deleteSelected(record) },
            ]}
        />
      ),
    },
  ];

  const runColumns: ColumnsType<StrategyRunRecord> = [
    { title: '运行ID', dataIndex: 'run_id', width: TABLE_COL.taskId, fixed: 'left', render: (value: string) => renderStrategyAuditText(value) },
    {
      title: '策略快照',
      width: TABLE_COL.strategyWide,
      render: (_, record) => (
        <Space className="strategy-run-snapshot" direction="vertical" size={0}>
          {renderStrategyAuditText(runStrategyName(record), true)}
          <Typography.Text type="secondary">ID {record.strategy_id}</Typography.Text>
          <Typography.Text className="strategy-run-snapshot__file" title={record.strategy_file_name || '旧记录未保存文件名'}>
            {record.strategy_file_name || '旧记录未保存文件名'}
          </Typography.Text>
          <Typography.Text className="strategy-run-snapshot__hash" title={record.strategy_code_hash || '旧记录未保存代码哈希'}>
            哈希 {shortHash(record.strategy_code_hash)}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '文件/版本',
      width: TABLE_COL.fileNameWide,
      responsive: ['xxl'],
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          {renderStrategyFileName(record.strategy_file_name || '旧记录未保存文件名')}
          <Typography.Text type="secondary">版本 {record.strategy_version || '旧记录未保存'} / 哈希 {shortHash(record.strategy_code_hash)}</Typography.Text>
        </Space>
      ),
    },
    { title: '状态', dataIndex: 'status', width: TABLE_COL.status, render: (value: string) => <Tag color={statusColor[value] ?? 'default'}>{statusLabel[value] ?? value}</Tag> },
    { title: '信号数', dataIndex: 'signal_count', width: TABLE_COL.status },
    { title: '开始时间', dataIndex: 'started_at', width: TABLE_COL.time, responsive: ['xxl'] },
    { title: '结束时间', dataIndex: 'finished_at', width: TABLE_COL.time, responsive: ['xxl'] },
    { title: '说明', dataIndex: 'message', width: TABLE_COL.messageWide, responsive: ['xxl'], render: (value: string) => renderStrategyAuditText(formatMaybe(value)) },
    {
      title: '诊断',
      width: TABLE_COL.detailAction,
      fixed: 'right',
      render: (_, record) => (
        <TableActionGroup
          primary={(
            <Button aria-label={record.status === 'failed' ? '看失败' : '详情'} title={record.status === 'failed' ? '查看策略运行失败详情' : '查看策略运行详情'} size="small" type={record.status === 'failed' ? 'primary' : 'default'} danger={record.status === 'failed'} onClick={() => openRunLog(record)}>
              {record.status === 'failed' ? '看失败' : '详情'}
            </Button>
          )}
          actions={[
            { key: 'locate-strategy', label: '定位策略', onClick: () => locateRunStrategy(record) },
            { key: 'copy', label: '复制给 AI', disabled: record.status !== 'failed' && !record.technical_detail, onClick: () => copyRunErrorForAi(record) },
            { key: 'copy-summary', label: '复制运行摘要', onClick: () => { void copyRunSummary(record); } },
            ...(record.status === 'running' || record.status === 'pending'
              ? [{ key: 'stop', label: '停止运行', danger: true, disabled: Boolean(actionBusyKey), onClick: () => stopRun(record) }]
              : []),
          ]}
        />
      ),
    },
  ];

  const versionColumns: ColumnsType<StrategyVersionRecord> = [
    { title: '版本号', dataIndex: 'version_no', width: TABLE_COL.versionNo, fixed: 'left' },
    { title: '保存时间', dataIndex: 'created_at', width: TABLE_COL.time },
    { title: '备注', dataIndex: 'remark', width: TABLE_COL.reasonWide, render: (value?: string | null) => renderStrategyAuditText(value) },
    { title: '代码摘要', dataIndex: 'code_hash', width: TABLE_COL.textWide, render: (value: string) => renderStrategyAuditText(value) },
    {
      title: '操作',
      width: TABLE_COL.detailAction,
      fixed: 'right',
      render: (_, record) => (
        <TableActionGroup
          primary={<Button aria-label={`查看策略版本 ${record.version_no}`} title={`查看策略版本 ${record.version_no}`} size="small" onClick={() => openVersionDetail(record)}>查看</Button>}
          actions={[
            { key: 'copy', label: '复制代码', onClick: () => copyVersionCode(record) },
            { key: 'restore', label: '恢复版本', type: 'restore', danger: true, onClick: () => confirmRestoreVersion(record) },
          ]}
        />
      ),
    },
  ];

  return (
    <div className="module-page strategy-page">
      <PageHeader
        title="策略开发"
        description="Python 策略文件管理、代码编辑、接口检查、运行调试、信号和版本记录。"
        updatedAt={updatedAt}
        loading={loading}
        onRefresh={loadAll}
        extra={
          <Space wrap>
            <DataFreshnessTag label="策略数据" updatedAt={updatedAt} loading={loading} />
            <Button
              aria-label="打开当前策略代码编辑"
              title={selected ? `编辑当前策略：${selected.strategy_name}` : '请先选择策略文件'}
              icon={<CodeOutlined />}
              disabled={!selected}
              onClick={() => setActiveTab('代码编辑')}
            >
              编辑当前
            </Button>
          </Space>
        }
        primaryAction={{ label: '新建策略', testId: 'btn-create-strategy', onClick: () => setCreateOpen(true) }}
      />

      <Row gutter={[8, 8]} className="strategy-overview">
        <Col xs={24} sm={12} xl={6}>
          <MetricCard label="策略文件" value={`${filePage.total || files.length} 个`} subValue={`${enabledCount} 个启用`} icon={<FileTextOutlined />} tone="blue" />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <MetricCard label="今日信号" value={`${todaySignalCount} 条`} subValue="只生成信号，不自动下单" icon={<PlayCircleOutlined />} tone="orange" />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <MetricCard label="运行记录" value={`${runPage.total || runs.length} 条`} subValue={`${failedRunCount} 条失败`} icon={<ExperimentOutlined />} tone={failedRunCount > 0 ? 'red' : 'green'} />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <MetricCard label="当前编辑" value={selected?.strategy_name ?? '未选择'} subValue={selected?.file_name ?? '请选择策略文件'} icon={<CodeOutlined />} tone="neutral" />
        </Col>
      </Row>

      <TaskProgress task={activeTask} />

      {latestFailedRun ? (
        <Alert
          className="strategy-ai-alert"
          type="warning"
          showIcon
          message="最近有策略运行失败"
          description="可以复制中文说明和技术详情给 AI，优先检查 Strategy 接口、字段名和信号格式。"
          action={
            <Button aria-label="复制最近策略失败详情给 AI" title="复制最近策略失败详情给 AI" size="small" icon={<CopyOutlined />} onClick={() => copyRunErrorForAi(latestFailedRun)}>
              复制给 AI
            </Button>
          }
        />
      ) : null}

      <Tabs
        className="strategy-tabs"
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as StrategyTabKey)}
        items={[
          {
            key: '策略文件',
            label: '策略文件',
            children: (
              <SectionCard
                title="策略文件"
                description="用户策略文件只放在 strategies/user/，策略只生成信号。"
                extra={
                  <Space wrap>
                    <Button aria-label="新建 Python 策略文件" title="新建 Python 策略文件" type="primary" icon={<FileAddOutlined />} onClick={() => setCreateOpen(true)}>新建策略</Button>
                    <Button aria-label="复制策略示例代码" title="复制策略示例代码" icon={<CopyOutlined />} onClick={copyExample}>复制示例</Button>
                  </Space>
                }
              >
                <div className="strategy-file-layout" data-testid="strategy-file-layout">
                  <div className="strategy-file-layout__table">
                    <DataTable<StrategyFileRecord>
                      className="strategy-files-table data-table--strategy-files"
                      rowKey="id"
                      columns={fileColumns}
                      dataSource={files}
                      loading={loading}
                      toolbarTitle="策略文件列表"
                      toolbarDescription="统一管理用户策略文件、启停状态和今日信号数量。"
                      updatedAt={updatedAt}
                      onRefresh={loadAll}
                      pagination={{ current: filePage.page, pageSize: filePage.pageSize, total: filePage.total, showSizeChanger: true }}
                      onChange={(pagination) => setFilePage({ page: pagination.current ?? 1, pageSize: pagination.pageSize ?? 20, total: filePage.total })}
                      data-testid="table-strategy-files"
                      tableLayout="fixed"
                      scroll={{ x: 'max-content' }}
                      quickSearch={{ placeholder: '当前页搜索策略名/文件名', fields: ['strategy_name', 'file_name', 'description'], width: 260 }}
                      quickFilters={[{ label: '策略状态', options: [{ label: '启用', value: 'enabled' }, { label: '停用', value: 'disabled' }], getValue: (record) => record.status }]}
                      emptyDescription="暂无策略文件，请点击“新建策略”或“复制示例”。"
                      emptyAction={
                        <Button aria-label="从空状态新建 Python 策略文件" title="新建 Python 策略文件" type="primary" icon={<FileAddOutlined />} onClick={() => setCreateOpen(true)}>
                          新建策略
                        </Button>
                      }
                    />
                  </div>
                  <aside className="strategy-file-layout__rail" data-testid="strategy-workflow-rail" aria-label="策略开发工作流">
                    <div className="strategy-workflow-head">
                      <Typography.Text className="strategy-workflow-head__eyebrow">STRATEGY FLOW</Typography.Text>
                      <Typography.Text strong className="strategy-workflow-head__title">策略开发工作流</Typography.Text>
                      <Typography.Text type="secondary" className="strategy-workflow-head__desc">
                        只生成信号，交易仍进入交易执行人工确认。
                      </Typography.Text>
                    </div>
                    <div className="strategy-workflow-list">
                      {[
                        ['01', '新建或复制', '文件只放在 strategies/user/，不覆盖已有策略。'],
                        ['02', '保存并检查', '统一 Strategy 接口、字段依赖和信号格式。'],
                        ['03', '试运行', '只读取 StrategyContext，不直接访问 QMT 或下单。'],
                        ['04', '回测验收', '通过后再进入信号下单流程，默认不自动实盘。'],
                      ].map(([step, title, desc]) => (
                        <div className="strategy-workflow-step" key={step}>
                          <span className="strategy-workflow-step__index">{step}</span>
                          <span className="strategy-workflow-step__body">
                            <Typography.Text strong>{title}</Typography.Text>
                            <Typography.Text type="secondary">{desc}</Typography.Text>
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="strategy-workflow-actions">
                      <Button aria-label="工作流新建 Python 策略文件" title="新建 Python 策略文件" type="primary" icon={<FileAddOutlined />} onClick={() => setCreateOpen(true)}>
                        新建策略
                      </Button>
                      <Button aria-label="工作流复制策略示例代码" title="复制策略示例代码" icon={<CopyOutlined />} onClick={copyExample}>
                        复制示例
                      </Button>
                      <Button
                        aria-label="工作流打开代码编辑"
                        title={selected ? `编辑当前策略：${selected.strategy_name}` : '请先选择策略文件'}
                        icon={<CodeOutlined />}
                        disabled={!selected}
                        onClick={() => setActiveTab('代码编辑')}
                      >
                        代码编辑
                      </Button>
                    </div>
                  </aside>
                </div>
              </SectionCard>
            ),
          },
          {
            key: '代码编辑',
            label: '代码编辑',
            children: (
              <Row gutter={[8, 8]} align="stretch" className="strategy-workbench" data-testid="strategy-editor-workbench">
                <Col xs={24} xl={5}>
                  <SectionCard title="策略文件区" description="选择策略后在中间编辑。" className="strategy-file-card">
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      <Space wrap>
                        <Button aria-label="新建 Python 策略文件" title="新建 Python 策略文件" type="primary" size="small" icon={<FileAddOutlined />} onClick={() => setCreateOpen(true)}>新建</Button>
                        <Button aria-label="复制策略示例代码" title="复制策略示例代码" size="small" icon={<CopyOutlined />} onClick={copyExample}>示例</Button>
                      </Space>
                      {files.length > 0 ? (
                        <div className="strategy-file-rail" data-testid="strategy-file-rail">
                          {files.map((record) => (
                            <button
                              className={`strategy-file-item${selected?.id === record.id ? ' strategy-file-item--active' : ''}`}
                              key={record.id}
                              onClick={() => selectStrategy(record)}
                              title={`打开策略 ${record.strategy_name}`}
                              type="button"
                            >
                              <span className="strategy-file-item__name">{record.strategy_name}</span>
                              <span className="strategy-file-item__meta">{record.file_name}</span>
                              <span className="strategy-file-item__foot">
                                <Tag color={statusColor[record.status] ?? 'default'}>{statusLabel[record.status] ?? record.status}</Tag>
                                <Typography.Text type="secondary">{record.today_signal_count} 信号</Typography.Text>
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <EmptyGuide description="暂无策略文件，请先新建策略或复制示例。" />
                      )}
                    </Space>
                  </SectionCard>
                </Col>
                <Col xs={24} xl={13}>
                  <SectionCard
                    title={selected ? `${selected.strategy_name} / ${selected.file_name}` : '请选择策略'}
                    description="保存、检查、试运行、回测入口顺序固定。"
                    className="strategy-editor-card"
                    extra={
                      <Space wrap>
                        <Button aria-label="保存当前策略代码" title="保存当前策略代码" icon={<SaveOutlined />} loading={actionBusyKey === `save:${selected?.id}`} disabled={!selected || Boolean(actionBusyKey)} onClick={saveCode}>保存代码</Button>
                        <Button aria-label="检查当前策略接口" title="检查当前策略接口" icon={<ToolOutlined />} loading={actionBusyKey === `check:${selected?.id}`} disabled={!selected || Boolean(actionBusyKey)} onClick={checkStrategy}>检查接口</Button>
                        <Button aria-label="试运行当前策略" title="试运行当前策略" type="primary" icon={<PlayCircleOutlined />} loading={actionBusyKey === `run:${selected?.id}`} disabled={!selected || Boolean(actionBusyKey)} onClick={() => runSelected()}>试运行</Button>
                        <Link to={selected ? `/backtest?tab=${encodeURIComponent('新建回测')}&strategy_id=${selected.id}` : '/backtest'}>
                          <Button aria-label="打开回测研究页面" title={selected ? `用当前策略进入回测：${selected.strategy_name}` : '请先选择策略文件'} icon={<ExperimentOutlined />} disabled={!selected}>去回测</Button>
                        </Link>
                      </Space>
                    }
                  >
                    {selected ? (
                      <Suspense fallback={<CodeEditorSkeleton />}>
                        <div className="strategy-editor-shell" data-testid="strategy-editor-shell">
                          <div className="strategy-editor-toolbar" data-testid="strategy-editor-toolbar">
                            <span><b>策略ID</b>{selected.id}</span>
                            <span><b>状态</b>{statusLabel[selected.status] ?? selected.status}</span>
                            <span><b>版本</b>{latestVersion?.version_no ?? selected.version}</span>
                            <span><b>接口</b>StrategyContext</span>
                            <span className="strategy-editor-toolbar__guard">只生成信号</span>
                          </div>
                          <CodeEditor value={code} onChange={setCode} />
                          <div className="strategy-editor-terminal" data-testid="strategy-editor-terminal">
                            <div className="strategy-editor-terminal__head">
                              <Typography.Text strong>运行终端</Typography.Text>
                              <Tag color={selectedLatestRun ? statusColor[selectedLatestRun.status] ?? 'default' : 'default'}>
                                {selectedLatestRun ? statusLabel[selectedLatestRun.status] ?? selectedLatestRun.status : '暂无运行'}
                              </Tag>
                            </div>
                            <div className="strategy-editor-terminal__body">
                              <Typography.Text>
                                {selectedLatestRun
                                  ? selectedLatestRun.message || `最近运行 ${selectedLatestRun.run_id}，生成 ${selectedLatestRun.signal_count} 条信号。`
                                  : '保存代码后可先检查接口，再试运行策略；错误会在这里和运行调试页显示。'}
                              </Typography.Text>
                              {selectedLatestRun?.technical_detail ? (
                                <Button size="small" type="link" onClick={() => openRunLog(selectedLatestRun)}>
                                  查看技术详情
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      </Suspense>
                    ) : (
                      <EmptyGuide description="暂无策略文件，请先新建策略或复制示例，然后再进入代码编辑。" />
                    )}
                  </SectionCard>
                </Col>
                <Col xs={24} xl={6}>
                  <SectionCard title="运行面板" description="确认接口、安全边界和最近运行。" className="strategy-context-card">
                    {selected ? (
                      <Space direction="vertical" size={10} style={{ width: '100%' }}>
                        <div className="strategy-context-grid">
                          <div className="strategy-context-row">
                            <Typography.Text type="secondary">当前策略</Typography.Text>
                            <Typography.Text strong ellipsis={{ tooltip: selected.strategy_name }}>{selected.strategy_name}</Typography.Text>
                          </div>
                          <div className="strategy-context-row">
                            <Typography.Text type="secondary">最近运行</Typography.Text>
                            <Typography.Text>
                              {selectedLatestRun ? `${statusLabel[selectedLatestRun.status] ?? selectedLatestRun.status} / ${selectedLatestRun.signal_count} 信号` : '暂无运行'}
                            </Typography.Text>
                          </div>
                          <div className="strategy-context-row">
                            <Typography.Text type="secondary">最新版本</Typography.Text>
                            <Typography.Text>{latestVersion ? `${latestVersion.version_no} / ${latestVersion.created_at}` : '暂无版本快照'}</Typography.Text>
                          </div>
                        </div>
                        <Alert
                          className="strategy-boundary-alert"
                          type="info"
                          showIcon
                          message="策略安全边界"
                          description="策略只能读取 StrategyContext 并生成信号，不能直接调用 QMT 或直接下单。"
                        />
                        <Space direction="vertical" size={8} style={{ width: '100%' }}>
                          <Button aria-label="复制当前策略代码给 AI" title="复制当前策略代码给 AI" block icon={<CopyOutlined />} onClick={copyStrategyContextForAi}>
                            复制代码给 AI
                          </Button>
                          <Button aria-label="查看当前策略运行调试" title="查看当前策略运行调试" block onClick={() => setActiveTab('运行调试')}>
                            查看运行记录
                          </Button>
                          <Button aria-label="查看当前策略版本记录" title="查看当前策略版本记录" block onClick={() => setActiveTab('版本记录')}>
                            查看版本快照
                          </Button>
                        </Space>
                      </Space>
                    ) : (
                      <EmptyGuide description="暂无策略文件，请先新建策略或复制示例，然后再进入代码编辑。" />
                    )}
                  </SectionCard>
                </Col>
              </Row>
            ),
          },
          {
            key: '运行调试',
            label: '运行调试',
            children: (
              <SectionCard
                title="运行调试"
                description="策略运行失败时，复制中文说明和技术详情给 AI 排查。"
                extra={<Tag color={failedRunCount > 0 ? 'red' : 'green'}>{failedRunCount} 条失败</Tag>}
              >
                <DataTable<StrategyRunRecord>
                  rowKey="run_id"
                  columns={runColumns}
                  dataSource={runs}
                  loading={loading}
                  toolbarTitle="运行记录"
                  toolbarDescription="查看策略试运行状态、信号数量、错误说明和可复制的技术详情。"
                  updatedAt={updatedAt}
                  onRefresh={loadAll}
                  pagination={{ current: runPage.page, pageSize: runPage.pageSize, total: runPage.total, showSizeChanger: true }}
                  onChange={(pagination) => setRunPage({ page: pagination.current ?? 1, pageSize: pagination.pageSize ?? 20, total: runPage.total })}
                  data-testid="table-strategy-runs"
                  className="strategy-runs-table data-table--strategy-runs"
                  tableLayout="fixed"
                  scroll={{ x: 'max-content' }}
                  quickSearch={{ placeholder: '当前页搜索运行ID/策略/文件/说明', fields: ['run_id', 'strategy_name', 'strategy_file_name', 'strategy_version', 'strategy_code_hash', 'message', 'technical_detail'], width: 300 }}
                  quickFilters={[{ label: '运行状态', options: ['success', 'failed', 'running', 'pending'].map((value) => ({ label: statusLabel[value] ?? value, value })), getValue: (record) => record.status }]}
                  emptyDescription="暂无运行记录。选择策略后点击“试运行”，结果和错误会显示在这里。"
                />
              </SectionCard>
            ),
          },
          {
            key: '策略信号',
            label: '策略信号',
            children: (
              <SectionCard title="策略信号" description="策略信号可进入交易执行中心，但不会自动下单。">
                <SignalTable
                  rows={signals}
                  loading={loading}
                  pagination={{ current: signalPage.page, pageSize: signalPage.pageSize, total: signalPage.total, showSizeChanger: true }}
                  onPageChange={(page, pageSize) => setSignalPage({ page, pageSize, total: signalPage.total })}
                  onIgnore={(id) => ignoreSignal(id).then(loadAll).catch((error) => showError('忽略信号失败', error))}
                />
              </SectionCard>
            ),
          },
          {
            key: '版本记录',
            label: '版本记录',
            children: (
              <SectionCard title="版本记录" description="保存代码会自动生成快照，便于追溯。">
                <DataTable<StrategyVersionRecord>
                  rowKey="id"
                  columns={versionColumns}
                  dataSource={versions}
                  loading={loading}
                  toolbarTitle="版本快照"
                  toolbarDescription="保存策略代码时自动生成快照，便于追溯和恢复思路。"
                  updatedAt={updatedAt}
                  toolbarRight={<Tag>{versionPage.total} 个快照</Tag>}
                  pagination={{ current: versionPage.page, pageSize: versionPage.pageSize, total: versionPage.total, showSizeChanger: true }}
                  onChange={(pagination) => setVersionPage({ page: pagination.current ?? 1, pageSize: pagination.pageSize ?? 20, total: versionPage.total })}
                  data-testid="table-strategy-versions"
                  className="strategy-versions-table data-table--strategy-versions"
                  tableLayout="fixed"
                  scroll={{ x: 'max-content' }}
                  quickSearch={{ placeholder: '当前页搜索版本/备注/摘要', fields: ['version_no', 'remark', 'code_hash'], width: 260 }}
                  emptyDescription="暂无版本记录。保存策略代码后会自动生成版本快照。"
                />
              </SectionCard>
            ),
          },
        ]}
      />

      <Modal
        className="strategy-create-modal"
        title="新建策略"
        open={createOpen}
        width={560}
        centered
        maskClosable={false}
        onOk={createFile}
        onCancel={() => setCreateOpen(false)}
        okText="创建"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item name="fileName" label="文件名" rules={[{ required: true, message: '请输入策略文件名' }]}>
            <Input placeholder="my_strategy.py" />
          </Form.Item>
          <Form.Item name="strategyName" label="策略名称" rules={[{ required: true, message: '请输入策略名称' }]}>
            <Input placeholder="我的策略" />
          </Form.Item>
        </Form>
      </Modal>

      <ErrorDetailModal
        open={Boolean(errorState)}
        message={errorState?.message ?? ''}
        error={errorState?.error}
        traceId={errorState?.traceId}
        onClose={() => setErrorState(null)}
      />
      <LogDrawer
        open={Boolean(logDrawer)}
        title={logDrawer?.title ?? '策略运行详情'}
        subtitle={logDrawer?.subtitle}
        status={logDrawer?.status}
        statusTone={logDrawer?.statusTone}
        message={logDrawer?.message}
        messageCopyText={logDrawer?.messageCopyText}
        technicalDetail={logDrawer?.technicalDetail}
        technicalCopyText={logDrawer?.technicalCopyText}
        fields={logDrawer?.fields}
        width={logDrawer?.width}
        fieldColumns={logDrawer?.fieldColumns}
        className={logDrawer?.className}
        onClose={() => setLogDrawer(null)}
      />
    </div>
  );
}
