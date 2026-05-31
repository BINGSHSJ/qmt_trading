import {
  ApiOutlined,
  CodeOutlined,
  FolderOpenOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { Tag, Typography } from 'antd';
import type { LogDrawerField } from '../../components/LogDrawer';
import type { ApiError } from '../../types/api';
import type { EnvironmentCheckResult } from '../../types/system';

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
  technicalDetail?: string | null;
  fields?: LogDrawerField[];
  width?: number;
  fieldColumns?: number;
  className?: string;
}

export const statusColor: Record<string, string> = {
  success: 'green',
  warning: 'orange',
  failed: 'red',
  running: 'blue',
  cancelled: 'orange',
};

export const statusLabel: Record<string, string> = {
  success: '正常',
  warning: '警告',
  failed: '失败',
  running: '运行中',
  cancelled: '已取消',
};

export const systemTabKeys = ['基础设置', '环境检测', '交易设置', '策略设置', '日志中心', '运行监控', '备份恢复', '操作记录'] as const;
export type SystemTabKey = (typeof systemTabKeys)[number];

export function readSystemTab(value: string | null): SystemTabKey {
  return systemTabKeys.includes(value as SystemTabKey) ? (value as SystemTabKey) : '基础设置';
}

export function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function renderStatus(status: string) {
  return <Tag color={statusColor[status] ?? 'default'}>{statusLabel[status] ?? status}</Tag>;
}

export function renderAuditText(value?: string | null) {
  const text = value?.trim() || '暂无';
  return (
    <Typography.Text className="system-audit-cell-text" title={text}>
      {text}
    </Typography.Text>
  );
}

export function renderAuditCode(value?: string | null) {
  const text = value?.trim() || '暂无';
  return (
    <Typography.Text className="system-audit-cell-code" title={text}>
      {text}
    </Typography.Text>
  );
}

export function buildSystemQaDetail(qaType: string, payload: Record<string, unknown>) {
  return JSON.stringify(
    {
      qa_type: qaType,
      ai_copy_version: '1.0',
      module: '系统管理',
      ...payload,
    },
    null,
    2,
  );
}

export const envGroupDefinitions = [
  {
    key: 'qmt',
    title: 'QMT 环境',
    icon: <ApiOutlined />,
    keywords: ['qmt', 'miniqmt', 'xtquant', '账户', '行情', '连接', '路径'],
    nextStep: '确认 MiniQMT 已启动并登录账户；若券商维护，请等待真实 QMT 恢复后再检测。',
  },
  {
    key: 'python',
    title: 'Python 环境',
    icon: <CodeOutlined />,
    keywords: ['python', '依赖', 'package', '版本', '解释器'],
    nextStep: '确认 Python 版本和依赖包可用，优先使用项目已有虚拟环境和 requirements。',
  },
  {
    key: 'local',
    title: '本地系统',
    icon: <FolderOpenOutlined />,
    keywords: ['sqlite', '数据库', '目录', '权限', 'logs', 'backups', 'strategies', '可写', '路径'],
    nextStep: '检查数据库、日志、备份和 strategies/user 目录权限，必要时重新运行 start.bat。',
  },
  {
    key: 'trade',
    title: '交易能力',
    icon: <WalletOutlined />,
    keywords: ['资产', '持仓', '下单', '委托', '成交', '交易', '只读'],
    nextStep: '只读查询通过后再做人工确认的小范围交易验收，不能默认开启自动实盘交易。',
  },
];

export function matchEnvGroup(record: EnvironmentCheckResult, keywords: string[]) {
  const source = `${record.check_item} ${record.message} ${record.suggestion ?? ''} ${record.technical_detail ?? ''}`.toLowerCase();
  return keywords.some((keyword) => source.includes(keyword.toLowerCase()));
}

export function getTimeBucket(value: string) {
  const timestamp = Date.parse(value.replace(' ', 'T'));
  if (!Number.isFinite(timestamp)) return '更早';
  const diff = Date.now() - timestamp;
  if (diff <= 24 * 60 * 60 * 1000) return '今天';
  if (diff <= 7 * 24 * 60 * 60 * 1000) return '近7天';
  return '更早';
}
