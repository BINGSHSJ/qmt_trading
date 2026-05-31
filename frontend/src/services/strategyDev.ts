import { buildPageQuery, request } from './request';
import type { PageQueryParams } from '../types/api';
import type { TaskCreated } from '../types/system';
import type {
  StrategyContent,
  StrategyFilePage,
  StrategyFileRecord,
  StrategyRunPage,
  StrategySignalPage,
  StrategySignalRecord,
  StrategyValidationResult,
  StrategyVersionDetail,
  StrategyVersionPage,
} from '../types/strategyDev';

export function getStrategyFiles(params?: PageQueryParams) {
  return request<StrategyFilePage>(`/api/strategies/files?${buildPageQuery(params)}`);
}

export function createStrategyFile(fileName: string, strategyName: string) {
  return request<StrategyFileRecord>('/api/strategies/files', {
    method: 'POST',
    body: JSON.stringify({ file_name: fileName, strategy_name: strategyName, description: '页面新建策略' }),
  });
}

export function copyExampleStrategy() {
  return request<StrategyFileRecord>('/api/strategies/copy-example', { method: 'POST' });
}

export function getStrategyContent(strategyId: number) {
  return request<StrategyContent>(`/api/strategies/files/${strategyId}/content`);
}

export function saveStrategyContent(strategyId: number, codeContent: string) {
  return request<StrategyContent>(`/api/strategies/files/${strategyId}/content`, {
    method: 'PUT',
    body: JSON.stringify({ code_content: codeContent, remark: '页面保存' }),
  });
}

export function validateStrategy(strategyId: number) {
  return request<StrategyValidationResult>(`/api/strategies/files/${strategyId}/validate`, { method: 'POST' });
}

export function runStrategy(strategyId: number) {
  return request<TaskCreated>(`/api/strategies/${strategyId}/run`, { method: 'POST' });
}

export function stopStrategyRun(runId: string) {
  return request<StrategyRunPage['items'][number]>(`/api/strategies/runs/${encodeURIComponent(runId)}/stop`, { method: 'POST' });
}

export function updateStrategyStatus(strategyId: number, status: 'enabled' | 'disabled') {
  return request<StrategyFileRecord>(`/api/strategies/files/${strategyId}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function deleteStrategy(strategyId: number) {
  return request<null>(`/api/strategies/files/${strategyId}`, { method: 'DELETE' });
}

export function getStrategyRuns(params?: PageQueryParams) {
  return request<StrategyRunPage>(`/api/strategies/runs?${buildPageQuery(params)}`);
}

export function getStrategySignals(params?: PageQueryParams) {
  return request<StrategySignalPage>(`/api/strategies/signals?${buildPageQuery(params)}`);
}

export function ignoreSignal(signalId: number) {
  return request<StrategySignalRecord>(`/api/strategies/signals/${signalId}/ignore`, { method: 'PATCH' });
}

export function getStrategyVersions(strategyId: number, params?: PageQueryParams) {
  return request<StrategyVersionPage>(`/api/strategies/${strategyId}/versions?${buildPageQuery(params)}`);
}

export function getStrategyVersion(versionId: number) {
  return request<StrategyVersionDetail>(`/api/strategies/versions/${versionId}`);
}

export function restoreStrategyVersion(versionId: number) {
  return request<StrategyContent>(`/api/strategies/versions/${versionId}/restore`, { method: 'POST' });
}
