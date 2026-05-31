import { buildPageQuery, downloadFile, request } from './request';
import type { PageQueryParams } from '../types/api';
import type {
  BackupPage,
  EnvironmentCheckResult,
  OperationLogPage,
  PathTestResult,
  RuntimeTaskRecord,
  StartupCheckResult,
  SystemConfig,
  SystemLogPage,
  SystemMonitor,
  TaskCreated,
} from '../types/system';

export function getSystemConfig() {
  return request<SystemConfig>('/api/system/config');
}

export function saveSystemConfig(config: SystemConfig) {
  return request<SystemConfig>('/api/system/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

export function testSystemPath(path: string, expectDirectory = true) {
  return request<PathTestResult>('/api/system/config/test-path', {
    method: 'POST',
    body: JSON.stringify({ path, expect_directory: expectDirectory }),
  });
}

export function createEnvironmentCheck() {
  return request<TaskCreated>('/api/system/env/check', { method: 'POST' });
}

export function getEnvironmentResults(taskId?: string) {
  const query = taskId ? `?task_id=${encodeURIComponent(taskId)}` : '';
  return request<EnvironmentCheckResult[]>(`/api/system/env/results${query}`);
}

export function getTask(taskId: string) {
  return request<RuntimeTaskRecord>(`/api/tasks/${encodeURIComponent(taskId)}`);
}

export function getSystemLogs(params: PageQueryParams = {}, module?: string, level?: string) {
  const query = new URLSearchParams(buildPageQuery(params));
  if (module) query.set('module', module);
  if (level) query.set('level', level);
  return request<SystemLogPage>(`/api/system/logs?${query.toString()}`);
}

export function getSystemMonitor() {
  return request<SystemMonitor>('/api/system/monitor');
}

export function getStartupCheck() {
  return request<StartupCheckResult>('/api/system/startup-check');
}

export function createBackup() {
  return request<TaskCreated>('/api/system/backups', { method: 'POST' });
}

export function getBackups(params?: PageQueryParams) {
  return request<BackupPage>(`/api/system/backups?${buildPageQuery(params)}`);
}

export function restoreBackup(backupId: number) {
  return request<TaskCreated>(`/api/system/backups/${backupId}/restore`, { method: 'POST' });
}

export function deleteBackup(backupId: number) {
  return request<null>(`/api/system/backups/${backupId}`, { method: 'DELETE' });
}

export function getOperations(params?: PageQueryParams) {
  return request<OperationLogPage>(`/api/system/operations?${buildPageQuery(params)}`);
}

export function createMaintenanceCleanup() {
  return request<TaskCreated>('/api/system/maintenance/cleanup', { method: 'POST' });
}

export function exportSystemLogs() {
  return downloadFile('/api/system/logs/export', 'system_logs.zip');
}

export function exportSystemConfig() {
  return downloadFile('/api/system/config/export', 'system_config.json');
}
