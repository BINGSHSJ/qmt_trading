import { useState } from 'react';
import { CopyOutlined, ExportOutlined, FileSearchOutlined } from '@ant-design/icons';
import { App, Button, Space, Tag } from 'antd';
import { useNavigate } from 'react-router-dom';
import DetailDrawer, { type DetailDrawerField } from '../DetailDrawer';
import TableActionGroup from '../TableActionGroup';
import type { RuntimeTaskRecord } from '../../types/system';
import { writeTextToClipboard } from '../../utils/clipboard';
import { getTaskSourceLabel, getTaskSourceRoute } from '../../utils/taskRoutes';
import './TaskActionGroup.css';

interface TaskActionGroupProps {
  task: RuntimeTaskRecord;
  mode?: 'table' | 'inline';
  detailTitle?: string;
  detailSubtitle?: string;
  ariaPrefix?: string;
  primaryAction?: 'detail' | 'source';
}

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

function parseTechnicalDetail(detail?: string | null): unknown {
  if (!detail) return null;
  try {
    return JSON.parse(detail) as unknown;
  } catch {
    return detail;
  }
}

function stringifyTechnicalDetail(detail?: string | null) {
  const parsed = parseTechnicalDetail(detail);
  if (parsed === null || parsed === undefined || parsed === '') return '暂无技术详情';
  if (typeof parsed === 'string') return parsed;
  return JSON.stringify(parsed, null, 2);
}

function buildTaskPayload(task: RuntimeTaskRecord) {
  const sourceLabel = getTaskSourceLabel(task);
  const sourceRoute = getTaskSourceRoute(task);
  return {
    task_id: task.task_id,
    task_type: task.task_type,
    source_label: sourceLabel,
    source_route: sourceRoute,
    status: statusLabel[task.status] ?? task.status,
    progress: task.progress,
    message: task.message,
    technical_detail: parseTechnicalDetail(task.technical_detail),
    created_at: task.created_at,
    started_at: task.started_at ?? null,
    finished_at: task.finished_at ?? null,
  };
}

export default function TaskActionGroup({
  task,
  mode = 'table',
  detailTitle = '任务详情',
  detailSubtitle,
  ariaPrefix,
  primaryAction = 'detail',
}: TaskActionGroupProps) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const sourceLabel = getTaskSourceLabel(task);
  const sourceRoute = getTaskSourceRoute(task);
  const normalizedStatus = statusLabel[task.status] ?? task.status;
  const progressText = `${Math.round(Number(task.progress) || 0)}%`;
  const technicalText = stringifyTechnicalDetail(task.technical_detail);
  const fields: DetailDrawerField[] = [
    { label: '任务ID', value: task.task_id, copyValue: task.task_id },
    { label: '任务类型', value: task.task_type, copyValue: task.task_type },
    { label: '来源页面', value: sourceLabel, copyValue: sourceLabel },
    { label: '来源路径', value: sourceRoute, copyValue: sourceRoute },
    { label: '状态', value: <Tag color={statusColor[task.status] ?? 'default'}>{normalizedStatus}</Tag>, copyValue: normalizedStatus },
    { label: '进度', value: progressText, copyValue: progressText },
    { label: '创建时间', value: task.created_at || '暂无' },
    { label: '开始时间', value: task.started_at || '暂无' },
    { label: '结束时间', value: task.finished_at || '暂无' },
  ];

  const copyText = async (label: string, text: string) => {
    try {
      await writeTextToClipboard(text);
      message.success(`${label}已复制`);
    } catch {
      message.error(`${label}复制失败，请手动选择文本复制。`);
    }
  };

  const copyTaskId = () => copyText('任务ID', task.task_id);
  const copyTaskSummary = () => copyText('任务摘要', JSON.stringify(buildTaskPayload(task), null, 2));
  const openSource = () => navigate(sourceRoute);
  const scopedAria = (label: string) => {
    if (!ariaPrefix) return `${label} ${task.task_id}`;
    const scopedLabel = label
      .replace('查看任务详情', '查看详情')
      .replace('复制任务ID', '复制ID')
      .replace('复制任务摘要', '复制摘要')
      .replace('跳转任务来源', '跳转来源');
    return `${ariaPrefix}${scopedLabel} ${task.task_id}`;
  };

  const detailButton = (
    <Button aria-label={scopedAria('查看任务详情')} title="查看任务详情" size="small" icon={<FileSearchOutlined />} onClick={() => setDrawerOpen(true)}>
      详情
    </Button>
  );
  const sourceButton = (
    <Button
      aria-label={primaryAction === 'source' ? `定位任务 ${task.task_id}` : scopedAria('跳转任务来源')}
      title={`跳转到${sourceLabel}`}
      size="small"
      icon={<ExportOutlined />}
      onClick={openSource}
    >
      去来源页
    </Button>
  );

  return (
    <>
      {mode === 'inline' ? (
        <Space size={6} wrap className="task-action-group task-action-group--inline">
          {detailButton}
          <Button aria-label={scopedAria('复制任务ID')} title="复制任务 ID" size="small" icon={<CopyOutlined />} onClick={copyTaskId}>
            复制ID
          </Button>
          <Button aria-label={scopedAria('复制任务摘要')} title="复制完整任务摘要给 AI" size="small" onClick={copyTaskSummary}>
            复制摘要
          </Button>
          {sourceButton}
        </Space>
      ) : (
        <TableActionGroup
          primary={primaryAction === 'source' ? sourceButton : detailButton}
          actions={primaryAction === 'source' ? [
            { key: 'show-task-detail', label: '查看任务详情', onClick: () => setDrawerOpen(true) },
            { key: 'copy-task-id', label: '复制任务ID', onClick: copyTaskId },
            { key: 'copy-task-summary', label: '复制任务摘要', onClick: copyTaskSummary },
          ] : [
            { key: 'copy-task-id', label: '复制任务ID', onClick: copyTaskId },
            { key: 'copy-task-summary', label: '复制任务摘要', onClick: copyTaskSummary },
            { key: 'go-task-source', label: `去来源页：${sourceLabel}`, onClick: openSource },
          ]}
        />
      )}
      <DetailDrawer
        open={drawerOpen}
        title={detailTitle}
        subtitle={detailSubtitle ?? `${task.task_type} / ${task.task_id}`}
        status={normalizedStatus}
        statusTone={statusColor[task.status] ?? 'default'}
        message={task.message || '暂无中文说明。'}
        technicalDetail={technicalText}
        fields={fields}
        width={720}
        fieldColumns={2}
        className="task-action-detail-drawer"
        onClose={() => setDrawerOpen(false)}
      />
    </>
  );
}
