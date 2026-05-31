import { useState } from 'react';
import { CopyOutlined, ExportOutlined, FileSearchOutlined } from '@ant-design/icons';
import { App, Button, Card, Progress, Space, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import DetailDrawer, { type DetailDrawerField } from '../DetailDrawer';
import type { RuntimeTaskRecord } from '../../types/system';
import { writeTextToClipboard } from '../../utils/clipboard';
import { getTaskSourceLabel, getTaskSourceRoute } from '../../utils/taskRoutes';
import './TaskProgress.css';

const statusColor: Record<string, string> = {
  pending: 'default',
  running: 'blue',
  success: 'green',
  failed: 'red',
  cancelled: 'orange',
};

const statusLabel: Record<string, string> = {
  pending: '等待中',
  running: '运行中',
  success: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

interface TaskProgressProps {
  task?: RuntimeTaskRecord | null;
}

const detailLabels: Record<string, string> = {
  stage: '阶段',
  processed: '已处理',
  total: '总数',
  current_date: '当前交易日',
  signal_count: '累计信号',
  trade_count: '成交',
  skipped_signal_count: '跳过',
  current_symbol: '当前股票',
  progress_range: '进度区间',
  range: '区间',
  symbols: '股票数',
  fill_mode: '成交模式',
  data_frequency: '数据频率',
};

function parseTaskDetail(detail?: string | null): Record<string, unknown> | null {
  if (!detail) {
    return null;
  }
  try {
    const parsed = JSON.parse(detail) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }
  return null;
}

function formatDetailValue(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return '暂无';
  }
  if (typeof value === 'boolean') {
    return value ? '是' : '否';
  }
  return String(value);
}

function formatTechnicalDetail(detail?: string | null, structuredDetail?: Record<string, unknown> | null) {
  if (structuredDetail) {
    return JSON.stringify(structuredDetail, null, 2);
  }
  return detail || '暂无技术详情';
}

export default function TaskProgress({ task }: TaskProgressProps) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  if (!task) {
    return null;
  }
  const structuredDetail = parseTaskDetail(task.technical_detail);
  const sourceLabel = getTaskSourceLabel(task);
  const sourceRoute = getTaskSourceRoute(task);
  const detailFields: DetailDrawerField[] = [
    { label: '任务ID', value: task.task_id },
    { label: '任务类型', value: task.task_type },
    { label: '来源页面', value: sourceLabel },
    { label: '状态', value: statusLabel[task.status] ?? task.status },
    { label: '进度', value: `${Math.round(task.progress ?? 0)}%` },
    { label: '创建时间', value: task.created_at },
    { label: '开始时间', value: task.started_at || '暂无' },
    { label: '结束时间', value: task.finished_at || '暂无' },
    ...Object.entries(structuredDetail ?? {}).map(([key, value]) => ({
      label: detailLabels[key] ?? key,
      value: formatDetailValue(value),
    })),
  ];
  const copyTaskId = async () => {
    try {
      await writeTextToClipboard(task.task_id);
      message.success('任务 ID 已复制');
    } catch {
      message.error('复制任务 ID 失败，请手动选中复制。');
    }
  };
  const copyTaskDetail = async () => {
    const payload = {
      task_id: task.task_id,
      task_type: task.task_type,
      source: sourceLabel,
      status: statusLabel[task.status] ?? task.status,
      progress: task.progress,
      message: task.message,
      technical_detail: structuredDetail ?? task.technical_detail ?? null,
      created_at: task.created_at,
      started_at: task.started_at ?? null,
      finished_at: task.finished_at ?? null,
    };
    try {
      await writeTextToClipboard(JSON.stringify(payload, null, 2));
      message.success('任务详情已复制，可粘贴给 AI 排查');
    } catch {
      message.error('复制任务详情失败，请打开详情后手动复制。');
    }
  };

  return (
    <>
      <Card size="small" className="task-progress-inline">
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <div className="task-progress-inline__head">
            <Space wrap size={8}>
              <Typography.Text strong>{task.task_type}</Typography.Text>
              <Tag color={statusColor[task.status] ?? 'default'}>{statusLabel[task.status] ?? task.status}</Tag>
              <Typography.Text copyable type="secondary">{task.task_id}</Typography.Text>
            </Space>
            <Space size={6} wrap className="task-progress-inline__actions">
              <Button aria-label={`复制任务ID ${task.task_id}`} title="复制任务 ID" size="small" icon={<CopyOutlined />} onClick={copyTaskId}>
                复制ID
              </Button>
              <Button aria-label={`查看任务详情 ${task.task_id}`} title="查看任务详情" size="small" icon={<FileSearchOutlined />} onClick={() => setDrawerOpen(true)}>
                查看详情
              </Button>
              <Button aria-label={`复制任务详情 ${task.task_id}`} title="复制完整任务详情给 AI" size="small" onClick={copyTaskDetail}>
                复制详情
              </Button>
              <Button aria-label={`跳转任务来源 ${task.task_id}`} title={`跳转到${sourceLabel}`} size="small" icon={<ExportOutlined />} onClick={() => navigate(sourceRoute)}>
                去来源页
              </Button>
            </Space>
          </div>
          <Progress percent={Math.round(task.progress ?? 0)} status={task.status === 'failed' ? 'exception' : undefined} />
          <Typography.Text>{task.message}</Typography.Text>
          {structuredDetail ? (
            <div className="task-progress-inline__detail" aria-label="任务技术详情">
              {Object.entries(structuredDetail).map(([key, value]) => (
                <span key={key} className="task-progress-inline__detail-item">
                  <Typography.Text type="secondary">{detailLabels[key] ?? key}</Typography.Text>
                  <Typography.Text strong>{formatDetailValue(value)}</Typography.Text>
                </span>
              ))}
            </div>
          ) : task.technical_detail ? (
            <Typography.Text type="secondary" className="task-progress-inline__raw-detail">技术详情：{task.technical_detail}</Typography.Text>
          ) : null}
        </Space>
      </Card>
      <DetailDrawer
        open={drawerOpen}
        title="任务详情"
        subtitle={task.task_type}
        status={statusLabel[task.status] ?? task.status}
        statusTone={statusColor[task.status] ?? 'default'}
        message={task.message || '暂无中文说明'}
        technicalDetail={formatTechnicalDetail(task.technical_detail, structuredDetail)}
        fields={detailFields}
        width={720}
        fieldColumns={2}
        className="task-progress-detail-drawer"
        onClose={() => setDrawerOpen(false)}
      />
    </>
  );
}
