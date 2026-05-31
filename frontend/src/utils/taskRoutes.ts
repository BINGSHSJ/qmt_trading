interface TaskSourceLike {
  task_type?: string | null;
  source_route?: string | null;
  source_label?: string | null;
}

type TaskSourceInput = string | null | undefined | TaskSourceLike;

function taskTypeOf(input?: TaskSourceInput) {
  return typeof input === 'string' ? input : input?.task_type;
}

export function getTaskSourceRoute(input?: TaskSourceInput) {
  if (typeof input === 'object' && input?.source_route) {
    return input.source_route;
  }
  const normalized = String(taskTypeOf(input) || '').toLowerCase();
  if (normalized.startsWith('sync_')) return '/data-center?tab=数据同步';
  if (normalized.startsWith('backtest')) return '/backtest?tab=回测任务';
  if (normalized.startsWith('strategy')) return '/strategy-dev?tab=运行调试';
  if (normalized.startsWith('trading')) return '/trading?tab=委托记录';
  if (normalized === 'environment_check') return '/system?tab=环境检测';
  if (normalized.startsWith('backup')) return '/system?tab=备份恢复';
  return '/system?tab=运行监控';
}

export function getTaskSourceLabel(input?: TaskSourceInput) {
  if (typeof input === 'object' && input?.source_label) {
    return input.source_label;
  }
  const normalized = String(taskTypeOf(input) || '').toLowerCase();
  if (normalized.startsWith('sync_')) return '数据中心 / 数据同步';
  if (normalized.startsWith('backtest')) return '回测研究 / 回测任务';
  if (normalized.startsWith('strategy')) return '策略开发 / 运行调试';
  if (normalized.startsWith('trading')) return '交易执行 / 委托记录';
  if (normalized === 'environment_check') return '系统管理 / 环境检测';
  if (normalized.startsWith('backup')) return '系统管理 / 备份恢复';
  return '系统管理 / 运行监控';
}
