import type { ReactNode } from 'react';
import { Tag, Tooltip, Typography } from 'antd';
import type { LogDrawerField } from '../../components/LogDrawer';
import type { RequestError } from '../../services/request';
import type { ApiError } from '../../types/api';
import type {
  DataCoverageRecord,
  DataDictionaryRecord,
  DataFreshnessItem,
  QmtStatus,
  SyncTaskSummary,
} from '../../types/dataCenter';
import type { RuntimeTaskRecord } from '../../types/system';
import { formatQuantity, formatStatusLabel, getStatusColor } from '../../utils/format';
import { isRealQmtMode, isTestIsolationAccountId, isTestIsolationMode, normalizeSyncSource } from '../../utils/sourceLabels';
import { formatNow } from '../../utils/time';

export interface ErrorState {
  message: string;
  error?: ApiError | null;
  traceId?: string;
}

export interface LogDrawerState {
  title: string;
  subtitle?: string;
  status?: string;
  statusTone?: string;
  message?: string;
  technicalDetail?: string;
  fields?: LogDrawerField[];
  width?: number;
  fieldColumns?: number;
  className?: string;
}

export interface DictionaryTableGroup {
  tableName: string;
  fields: DataDictionaryRecord[];
}

export const dataCenterTabKeys = ['数据概览', '数据来源', '账户数据', '行情数据', '基础资料', '数据同步', '数据质量', '数据字典'] as const;
export type DataCenterTabKey = (typeof dataCenterTabKeys)[number];
export type MarketPeriod = 'daily' | 'minute';

export const DATA_DETAIL_DRAWER_WIDTH = 720;
export const DATA_DETAIL_FIELD_COLUMNS = 2;

export function dataCenterDrawerClassName(name: string) {
  return `data-center-inspection-drawer ${name}`;
}

export function buildDictionaryTableText(group: DictionaryTableGroup) {
  const indexedCount = group.fields.filter((field) => field.is_indexed).length;
  return [
    `表名：${group.tableName}`,
    `字段数量：${group.fields.length}`,
    `已索引字段：${indexedCount}`,
    '字段说明：',
    ...group.fields.map((field) => `- ${field.field_name} (${field.field_type})：${field.description}；单位：${field.unit || '无'}；示例：${field.example_value ?? '暂无'}；策略使用：${field.strategy_usage || '暂无'}；索引：${field.is_indexed ? '是' : '否'}`),
    '使用约束：策略只能通过 StrategyContext 读取这些已落库字段，只生成信号，不直接下单。',
  ].join('\n');
}

export function renderTableCount(value?: number | null, unit = '条') {
  return (
    <Typography.Text className="data-table-number">
      {typeof value === 'number' && !Number.isNaN(value) ? formatQuantity(value, unit) : '暂无'}
    </Typography.Text>
  );
}

export function coverageUnit(record: DataCoverageRecord) {
  return record.coverage_unit || (record.data_type === 'minute_kline' ? '覆盖单元' : '行');
}

export function coverageUnitHint(record: DataCoverageRecord) {
  return record.coverage_unit_note || (record.data_type === 'minute_kline'
    ? '分钟K覆盖单元=股票-交易日，用来判断是否每只股票每天都有分钟数据，不等于1分钟bar原始行数。'
    : '日K按实际落库K线行数统计。');
}

export function freshnessCoverageUnit(record: DataFreshnessItem) {
  return record.coverage_unit || (record.key === 'minute_kline' ? '覆盖单元' : '行');
}

export function freshnessCoverageUnitHint(record: DataFreshnessItem) {
  return record.coverage_unit_note || (record.key === 'minute_kline'
    ? '分钟K覆盖单元=股票-交易日，用来判断是否每只股票每天都有分钟数据，不等于1分钟bar原始行数。'
    : '日K按实际落库K线行数统计。');
}

export const qualityDefinitions = [
  { key: 'empty', title: '空数据', keywords: ['空', 'empty'], nextStep: '先到数据同步页执行对应数据同步，再重新检查。' },
  { key: 'freshness', title: '最近更新时间', keywords: ['更新', '过期', 'fresh'], nextStep: '确认同步任务是否完成，必要时做小范围增量同步。' },
  { key: 'kline', title: 'K 线缺失', keywords: ['K线', 'K 线', 'kline', '缺失'], nextStep: '先同步指定股票和周期，不要直接全市场多年同步。' },
  { key: 'duplicate', title: '重复数据', keywords: ['重复', 'duplicate'], nextStep: '保留现有数据，记录任务 ID 后检查唯一索引和同步游标。' },
  { key: 'cursor', title: '游标格式', keywords: ['游标', 'sync_cursor', '逗号拼接'], nextStep: '点击清理旧游标；系统会先归档到操作日志，再重新检查数据质量。' },
  { key: 'symbol', title: '代码格式', keywords: ['代码', 'symbol'], nextStep: '检查股票代码是否为 600000.SH / 000001.SZ 格式。' },
  { key: 'order-trade', title: '委托成交', keywords: ['委托成交', '成交记录'], nextStep: '重新同步委托与成交，确认二者来自同一账户。' },
  { key: 'sync', title: '同步失败', keywords: ['同步失败', 'failed', '失败'], nextStep: '查看同步失败详情，复制 task_id 到系统日志检索。' },
];

export function statusTag(value: string) {
  return <Tag color={getStatusColor(value)}>{formatStatusLabel(value)}</Tag>;
}

export function wrapLongText(value?: string | null) {
  const text = value || '暂无';
  return (
    <Tooltip
      title={text === '暂无' ? undefined : text}
      placement="topLeft"
      mouseEnterDelay={0.2}
      classNames={{ root: 'data-center-long-text-tooltip' }}
    >
      <Typography.Text className="data-center-long-text" title={text}>
        {text}
      </Typography.Text>
    </Tooltip>
  );
}

export function renderTraceText(value?: string | null) {
  const text = value || '暂无';
  return (
    <Typography.Text className="data-table-number" title={text} ellipsis>
      {text}
    </Typography.Text>
  );
}

export function accountSourceMeta(accountId: string | null | undefined, status: QmtStatus | null) {
  const value = String(accountId || '').trim();
  if (!value) {
    return { label: '未识别账户', color: 'default', hint: '记录缺少 account_id。' };
  }
  if (isTestIsolationAccountId(value)) {
    return { label: '测试历史', color: 'default', hint: '这条记录来自测试隔离或历史联调数据，不属于当前真实账户。' };
  }
  if (isRealQmtMode(status?.mode) && value === status?.account_id) {
    return { label: '真实 QMT', color: 'blue', hint: '这条记录属于当前真实 QMT 账户。' };
  }
  if (isTestIsolationMode(status?.mode) && value === status?.account_id) {
    return { label: '测试隔离', color: 'default', hint: '这条记录属于测试隔离账户，不作为业务数据。' };
  }
  return { label: '历史账户', color: 'orange', hint: '这条记录属于本地历史账户，仅用于排查。' };
}

export function syncSourceMeta(source: string | null | undefined) {
  const normalized = normalizeSyncSource(source);
  if (normalized === 'real_sync') {
    return { label: '真实同步', color: 'blue', hint: '真实 QMT 只读同步，未提交委托。' };
  }
  if (normalized === 'test_sync') {
    return { label: '测试同步', color: 'default', hint: '测试隔离数据，不代表真实账户。' };
  }
  if (!normalized) {
    return { label: '未标记', color: 'default', hint: '历史记录缺少 source 字段。' };
  }
  return { label: source || '其他来源', color: 'orange', hint: '非当前标准来源，请结合账户和时间核对。' };
}

export function parseTaskDetail(detail?: string | null): Record<string, unknown> | null {
  if (!detail) return null;
  try {
    const parsed = JSON.parse(detail);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function parseSemicolonDetail(detail?: string | null): Record<string, string> {
  if (!detail) return {};
  return detail.split(';').reduce<Record<string, string>>((result, part) => {
    const [rawKey, ...rest] = part.split('=');
    const key = rawKey?.trim();
    const value = rest.join('=').trim();
    if (key && value) {
      result[key] = value;
    }
    return result;
  }, {});
}

export function extractActiveTaskMeta(error: RequestError): { taskId?: string; taskType?: string; status?: string } {
  if (error.apiError?.code !== 'TASK_ALREADY_RUNNING') return {};
  const detail = parseSemicolonDetail(error.apiError.detail);
  return {
    taskId: detail.active_task_id,
    taskType: detail.task_type,
    status: detail.status,
  };
}

function taskDetailText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'number') return value.toLocaleString('zh-CN');
  if (Array.isArray(value)) return value.join('、');
  return String(value);
}

function parseBatchFromTaskMessage(message?: string | null): { batch: number; totalBatches: number } | null {
  const match = message?.match(/(\d+)\s*\/\s*([\d,]+)/);
  if (!match) return null;
  const batch = Number(match[1].replace(/,/g, ''));
  const totalBatches = Number(match[2].replace(/,/g, ''));
  return Number.isFinite(batch) && Number.isFinite(totalBatches) ? { batch, totalBatches } : null;
}

function resumeRuleText(value: unknown): string {
  if (value === 'coverage_first') return '覆盖率优先';
  if (value === 'minute_coverage_first') return '分钟 K 覆盖率优先';
  return taskDetailText(value);
}

type TaskDetailItem = [string, string];

export function buildTaskDetailItems(detail?: string | null, message?: string | null): TaskDetailItem[] {
  const parsed = parseTaskDetail(detail);
  if (!parsed) {
    return [];
  }
  const fallbackBatch = parseBatchFromTaskMessage(message);
  const batch = parsed.batch ?? parsed.current_batch ?? parsed.completed_batches ?? fallbackBatch?.batch;
  const totalBatches = parsed.total_batches ?? fallbackBatch?.totalBatches;
  const fullRange = parsed.full_range ?? parsed.target_range ?? (
    parsed.start_date && parsed.target_end_date ? `${taskDetailText(parsed.start_date)}~${taskDetailText(parsed.target_end_date)}` : null
  );
  const windowIndexText = parsed.window_index && parsed.total_windows
    ? `${taskDetailText(parsed.window_index)}/${taskDetailText(parsed.total_windows)}`
    : null;
  const items = [
    batch !== undefined || totalBatches !== undefined ? ['当前批次', `${taskDetailText(batch)}/${taskDetailText(totalBatches)}`] : null,
    fullRange ? ['完整目标范围', taskDetailText(fullRange)] : null,
    parsed.target_end_date && !fullRange ? ['目标截止日', taskDetailText(parsed.target_end_date)] : null,
    parsed.window ? ['当前时间窗口', taskDetailText(parsed.window)] : null,
    windowIndexText ? ['当前窗口序号', windowIndexText] : null,
    parsed.period ? ['周期', taskDetailText(parsed.period)] : null,
    parsed.rows !== undefined ? ['已写入行数', taskDetailText(parsed.rows)] : null,
    parsed.success_symbols !== undefined ? ['成功股票', taskDetailText(parsed.success_symbols)] : null,
    parsed.failed_symbols !== undefined ? ['失败股票', taskDetailText(parsed.failed_symbols)] : null,
    parsed.skipped_symbols !== undefined ? ['已跳过', taskDetailText(parsed.skipped_symbols)] : null,
    parsed.no_data_symbols !== undefined ? ['无数据', taskDetailText(parsed.no_data_symbols)] : null,
    parsed.coverage_retry_symbols !== undefined ? ['待补股票', taskDetailText(parsed.coverage_retry_symbols)] : null,
    parsed.resume_rule ? ['续跑规则', resumeRuleText(parsed.resume_rule)] : null,
    parsed.window ? ['窗口说明', '当前时间窗口只是本批分片，任务会继续推进到完整目标范围。'] : null,
  ].filter(Boolean) as TaskDetailItem[];
  return items;
}

export function renderTaskDownloadDetail(detail?: string | null, message?: string | null): ReactNode {
  const parsed = parseTaskDetail(detail);
  if (!parsed) {
    return detail ? <Typography.Text type="secondary">技术详情：{detail}</Typography.Text> : null;
  }
  const items = buildTaskDetailItems(detail, message);
  if (items.length === 0) {
    return <Typography.Text type="secondary">技术详情：{JSON.stringify(parsed)}</Typography.Text>;
  }
  return (
    <div className="data-task-detail-grid" data-testid="data-task-detail-grid">
      {items.map(([label, value]) => (
        <div className="data-task-detail-item" key={label}>
          <Typography.Text type="secondary">{label}</Typography.Text>
          <Typography.Text strong>{value}</Typography.Text>
        </div>
      ))}
    </div>
  );
}

export function sourceTag(meta: { label: string; color: string; hint: string }) {
  return (
    <Tag color={meta.color} title={meta.hint}>
      {meta.label}
    </Tag>
  );
}

export function coverageStatusText(value: string) {
  const labels: Record<string, string> = {
    complete: '完整',
    partial: '部分',
    missing: '缺失',
    failed: '异常',
  };
  return <Tag color={getStatusColor(value)}>{labels[value] ?? formatStatusLabel(value)}</Tag>;
}

export function freshnessStatusText(value: string) {
  const labels: Record<string, string> = {
    fresh: '最新',
    stale: '过期',
    partial: '不完整',
    missing: '缺失',
    unknown: '需核对',
  };
  return <Tag color={getStatusColor(value)}>{labels[value] ?? formatStatusLabel(value)}</Tag>;
}

export function priorityColor(value: string) {
  if (value === 'P0') return 'red';
  if (value === 'P1') return 'orange';
  if (value === 'P2') return 'blue';
  return 'default';
}

export function hasSyncFailure(record: SyncTaskSummary) {
  return record.failed_count > 0 || record.status === 'failed' || record.status === '失败';
}

export function isSyncRunning(record: SyncTaskSummary) {
  return record.status === 'running' || record.status === 'pending' || record.status === '运行中';
}

export function syncTaskToRuntimeTask(record: SyncTaskSummary): RuntimeTaskRecord {
  return {
    task_id: record.task_id,
    task_type: record.sync_type,
    status: record.status,
    progress: record.progress ?? 0,
    message: record.message || '同步任务正在执行，请等待进度刷新。',
    technical_detail: record.technical_detail,
    started_at: record.started_at,
    finished_at: record.finished_at,
    created_at: record.started_at || formatNow(),
  };
}
