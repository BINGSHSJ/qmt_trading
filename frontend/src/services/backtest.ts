import { buildPageQuery, downloadFile, request } from './request';
import type { PageQueryParams } from '../types/api';
import type { TaskCreated } from '../types/system';
import type {
  BacktestCreateRequest,
  BacktestDataCheckResult,
  BacktestEquityRecord,
  BacktestLogPage,
  BacktestReport,
  BacktestResultRecord,
  BacktestSignalPage,
  BacktestTaskPage,
  BacktestTaskRecord,
  BacktestTradePage,
} from '../types/backtest';

export function createBacktest(payload: BacktestCreateRequest) {
  return request<TaskCreated>('/api/backtests', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function checkBacktestData(payload: Pick<BacktestCreateRequest, 'strategy_id' | 'start_date' | 'end_date' | 'data_frequency' | 'fill_mode'>) {
  return request<BacktestDataCheckResult>('/api/backtests/check-data', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getBacktests(params?: PageQueryParams) {
  return request<BacktestTaskPage>(`/api/backtests?${buildPageQuery(params)}`);
}

export function getBacktest(taskId: string) {
  return request<BacktestTaskRecord>(`/api/backtests/${encodeURIComponent(taskId)}`);
}

export function deleteBacktest(taskId: string) {
  return request<null>(`/api/backtests/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
}

export function cancelBacktest(taskId: string) {
  return request<BacktestTaskRecord>(`/api/backtests/${encodeURIComponent(taskId)}/cancel`, { method: 'POST' });
}

export function getBacktestResult(taskId: string) {
  return request<BacktestResultRecord | null>(`/api/backtests/${encodeURIComponent(taskId)}/result`);
}

export function getBacktestEquity(taskId: string) {
  return request<BacktestEquityRecord[]>(`/api/backtests/${encodeURIComponent(taskId)}/equity?max_points=2000`);
}

export function getBacktestDrawdown(taskId: string) {
  return request<BacktestEquityRecord[]>(`/api/backtests/${encodeURIComponent(taskId)}/drawdown?max_points=2000`);
}

export function getBacktestTrades(taskId: string, params?: PageQueryParams) {
  return request<BacktestTradePage>(`/api/backtests/${encodeURIComponent(taskId)}/trades?${buildPageQuery(params)}`);
}

export function getBacktestSignals(taskId: string, params?: PageQueryParams) {
  return request<BacktestSignalPage>(`/api/backtests/${encodeURIComponent(taskId)}/signals?${buildPageQuery(params)}`);
}

export function getBacktestLogs(taskId: string, params?: PageQueryParams) {
  return request<BacktestLogPage>(`/api/backtests/${encodeURIComponent(taskId)}/logs?${buildPageQuery(params)}`);
}

export function getBacktestReport(taskId: string) {
  return request<BacktestReport>(`/api/backtests/${encodeURIComponent(taskId)}/report`);
}

export function exportBacktestWorkbook(taskId: string) {
  return downloadFile(`/api/backtests/${encodeURIComponent(taskId)}/export`, `backtest_${taskId}_完整记录.xlsx`);
}
