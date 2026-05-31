import type { PageResult } from './api';

export interface SystemConfig {
  qmt_path: string;
  account_id: string;
  database_path: string;
  strategy_dir: string;
  backup_dir: string;
  auto_connect: boolean;
  auto_sync: boolean;
  default_order_amount: number;
  max_order_amount: number;
  order_confirm_required: boolean;
  default_order_type: string;
  price_offset: number;
  simulation_mode: boolean;
  strategy_timeout_seconds: number;
  strategy_run_interval_seconds: number;
  intraday_auto_run: boolean;
  strategy_log_level: string;
  strategy_max_log_mb: number;
  log_retention_days: number;
  task_retention_days: number;
}

export interface PathTestResult {
  path: string;
  exists: boolean;
  is_directory: boolean;
  message: string;
  suggestion?: string | null;
}

export interface TaskCreated {
  task_id: string;
  task_type: string;
  status: string;
  progress: number;
  message: string;
  source_module?: string | null;
  source_route?: string | null;
  source_label?: string | null;
}

export interface RuntimeTaskRecord extends TaskCreated {
  technical_detail?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  created_at: string;
}

export interface EnvironmentCheckResult {
  id: number;
  task_id: string;
  check_item: string;
  status: string;
  message: string;
  suggestion?: string | null;
  technical_detail?: string | null;
  created_at: string;
}

export interface SystemLogRecord {
  id: number;
  module: string;
  level: string;
  message: string;
  technical_detail?: string | null;
  related_id?: string | null;
  created_at: string;
}

export interface BackupRecord {
  id: number;
  backup_name: string;
  backup_path: string;
  backup_size: number;
  status: string;
  created_at: string;
}

export interface OperationLogRecord {
  id: number;
  module: string;
  action: string;
  target_type: string;
  target_id?: string | null;
  result: string;
  message: string;
  technical_detail?: string | null;
  created_at: string;
}

export interface SystemMonitor {
  running_task_count: number;
  failed_task_count: number;
  historical_failed_task_count: number;
  database_size_bytes: number;
  log_size_bytes: number;
  backup_count: number;
  recent_errors: SystemLogRecord[];
  slow_tasks: RuntimeTaskRecord[];
}

export interface StartupCheckItem {
  check_item: string;
  status: string;
  message: string;
  suggestion?: string | null;
  technical_detail?: string | null;
}

export interface StartupCheckResult {
  app_name: string;
  version: string;
  checked_at: string;
  overall_status: string;
  items: StartupCheckItem[];
}

export type SystemLogPage = PageResult<SystemLogRecord>;
export type OperationLogPage = PageResult<OperationLogRecord>;
export type BackupPage = PageResult<BackupRecord>;
