import { Alert, Progress, Space, Tag, Typography } from 'antd';
import SectionCard from '../SectionCard';
import EmptyGuide from '../EmptyGuide';
import TaskActionGroup from '../TaskActionGroup';
import type { RuntimeTaskRecord } from '../../types/system';
import './TaskProgressCard.css';

interface TaskProgressCardProps {
  tasks: RuntimeTaskRecord[];
  activeTask?: RuntimeTaskRecord | null;
  loading?: boolean;
  runningCount: number;
  failedCount: number;
  historicalFailedCount?: number;
}

const statusColor: Record<string, string> = {
  pending: 'default',
  running: 'processing',
  success: 'success',
  failed: 'error',
  cancelled: 'warning',
};

const statusLabel: Record<string, string> = {
  pending: '等待中',
  running: '运行中',
  success: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

export default function TaskProgressCard({ tasks, activeTask, loading, runningCount, failedCount, historicalFailedCount = 0 }: TaskProgressCardProps) {
  const allTasks = [activeTask, ...tasks].filter((task): task is RuntimeTaskRecord => Boolean(task));
  const visibleTasks = allTasks.reduce<RuntimeTaskRecord[]>((items, task) => {
    if (!items.some((item) => item.task_id === task.task_id)) {
      items.push(task);
    }
    return items;
  }, []).slice(0, 4);
  const primaryTask = activeTask ?? tasks.find((task) => task.status === 'running' || task.status === 'pending') ?? null;

  return (
    <SectionCard
      className="task-progress-card"
      title="任务状态"
      description="同步、策略、回测等长任务进度"
      extra={
        <Space size={6}>
          <Tag color={runningCount > 0 ? 'processing' : 'default'}>{runningCount} 运行</Tag>
          <Tag color={failedCount > 0 ? 'error' : 'default'}>{failedCount} 今日失败</Tag>
          {historicalFailedCount > 0 ? <Tag color="warning">{historicalFailedCount} 历史失败</Tag> : null}
        </Space>
      }
    >
      {primaryTask ? (
        <div className="task-progress-card__primary">
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Space wrap>
              <Typography.Text strong>{primaryTask.task_type}</Typography.Text>
              <Tag color={statusColor[primaryTask.status] ?? 'default'}>
                {statusLabel[primaryTask.status] ?? primaryTask.status}
              </Tag>
              <TaskActionGroup task={primaryTask} mode="inline" detailTitle="主任务详情" />
            </Space>
            <Progress percent={primaryTask.progress} status={primaryTask.status === 'failed' ? 'exception' : undefined} />
            <Typography.Text type="secondary">{primaryTask.message}</Typography.Text>
          </Space>
        </div>
      ) : null}

      {visibleTasks.length > 0 ? (
        <div className="task-progress-card__list">
          {visibleTasks.map((task) => (
            <div className="task-progress-card__item" key={task.task_id}>
              <div>
                <Typography.Text strong>{task.task_type}</Typography.Text>
                <Typography.Text type="secondary" className="task-progress-card__time">
                  {task.created_at}
                </Typography.Text>
              </div>
              <Space size={6} wrap className="task-progress-card__actions">
                <Tag color={statusColor[task.status] ?? 'default'}>{statusLabel[task.status] ?? task.status}</Tag>
                <TaskActionGroup task={task} mode="inline" detailTitle="任务状态详情" />
              </Space>
            </div>
          ))}
        </div>
      ) : (
        <EmptyGuide
          title={loading ? '正在加载任务状态' : '暂无运行任务'}
          description={loading ? '正在读取同步、策略、回测等长任务状态。' : '当前没有运行中任务；启动同步、策略运行或回测后会在这里显示进度。'}
        />
      )}

      {failedCount > 0 ? (
        <Alert className="task-progress-card__alert" type="warning" showIcon message="今日存在失败任务，请到系统管理或对应模块查看技术详情。" />
      ) : historicalFailedCount > 0 ? (
        <Alert className="task-progress-card__alert" type="info" showIcon message="存在历史失败任务，不计入今日健康状态；需要时可到系统管理运行清理归档。" />
      ) : null}
    </SectionCard>
  );
}
