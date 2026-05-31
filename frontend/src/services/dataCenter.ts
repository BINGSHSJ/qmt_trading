import { buildPageQuery, downloadFile, request } from './request';
import type { PageQueryParams } from '../types/api';
import type {
  AccountSnapshot,
  AccountSnapshotDuplicatePage,
  DataCoveragePage,
  DataFreshnessSummary,
  DailyKlinePage,
  DataDictionaryPage,
  DataQualityPage,
  DataQualitySummary,
  InstrumentDetailPage,
  LatestDataSyncRequest,
  LegacyCursorCleanupResult,
  MinuteKlinePage,
  OrderPage,
  OfficialDataCatalog,
  PositionPage,
  Prepare2026Plan,
  Prepare2026Request,
  QmtStatus,
  StockPage,
  SyncTaskPage,
  SyncLogPage,
  TaskCreated,
  TradePage,
  TradingCalendarPage,
} from '../types/dataCenter';

export type AccountDataScope = 'current' | 'account_history' | 'all_history';

export function getQmtStatus() {
  return request<QmtStatus>('/api/data/sources/qmt/status');
}

export function getOfficialCatalog() {
  return request<OfficialDataCatalog>('/api/data/catalog/official');
}

export function connectQmt() {
  return request<QmtStatus>('/api/data/sources/qmt/connect', { method: 'POST' });
}

export function disconnectQmt() {
  return request<QmtStatus>('/api/data/sources/qmt/disconnect', { method: 'POST' });
}

export function testQmt() {
  return request<QmtStatus>('/api/data/sources/qmt/test', { method: 'POST' });
}

export function getLatestAccount() {
  return request<AccountSnapshot | null>('/api/data/account/latest');
}

export function getPositions(params?: PageQueryParams, scope: AccountDataScope = 'current') {
  return request<PositionPage>(`/api/data/positions?${buildPageQuery({ ...params, scope })}`);
}

export function getOrders(params?: PageQueryParams, scope: AccountDataScope = 'current') {
  return request<OrderPage>(`/api/data/orders?${buildPageQuery({ ...params, scope })}`);
}

export function getTrades(params?: PageQueryParams, scope: AccountDataScope = 'current') {
  return request<TradePage>(`/api/data/trades?${buildPageQuery({ ...params, scope })}`);
}

export function getStocks(params?: PageQueryParams) {
  return request<StockPage>(`/api/data/stocks?${buildPageQuery(params)}`);
}

export function getInstrumentDetails(params?: PageQueryParams) {
  return request<InstrumentDetailPage>(`/api/data/basic/instruments?${buildPageQuery({ pageSize: 50, ...params })}`);
}

export function getTradingCalendar(params?: PageQueryParams) {
  return request<TradingCalendarPage>(`/api/data/basic/trading-calendar?${buildPageQuery({ pageSize: 50, ...params })}`);
}

export function getDailyKline(symbol = '600000.SH', params: PageQueryParams = { pageSize: 50 }) {
  return request<DailyKlinePage>(`/api/data/kline/daily?${buildPageQuery({ pageSize: 50, ...params })}&symbol=${encodeURIComponent(symbol)}`);
}

export function getMinuteKline(symbol = '600000.SH', params: PageQueryParams = { pageSize: 50 }) {
  return request<MinuteKlinePage>(`/api/data/kline/minute?${buildPageQuery({ pageSize: 50, ...params })}&symbol=${encodeURIComponent(symbol)}&period=1m`);
}

export function createSync(syncType: string) {
  const map: Record<string, string> = {
    stock_basic: 'stock-basic',
    instrument_detail: 'instrument-detail',
    trading_calendar: 'trading-calendar',
    account: 'account',
    positions: 'positions',
    orders: 'orders',
    trades: 'trades',
    all: 'all',
  };
  return request<TaskCreated>(`/api/data/sync/${map[syncType]}`, { method: 'POST' });
}

export function prepare2026Sync(payload: Prepare2026Request = {}) {
  return request<Prepare2026Plan>('/api/data/sync/prepare-2026', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function run2026Sync(payload: Prepare2026Request = {}) {
  return request<TaskCreated>('/api/data/sync/run-2026', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function runLatestDataSync(payload: LatestDataSyncRequest = {}) {
  return request<TaskCreated>('/api/data/sync/latest', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function getCoverage2026(params?: PageQueryParams) {
  return request<DataCoveragePage>(`/api/data/sync/coverage-2026?${buildPageQuery({ pageSize: 50, ...params })}`);
}

export function getDataFreshnessSummary() {
  return request<DataFreshnessSummary>('/api/data/freshness/summary');
}

export function exportCoverage2026Missing(dataType?: string) {
  const params = new URLSearchParams({ period: '1m' });
  if (dataType) {
    params.set('data_type', dataType);
  }
  return downloadFile(`/api/data/sync/coverage-2026/missing-export?${params.toString()}`, 'data_coverage_missing_2026.csv');
}

export function getSyncTasks(params?: PageQueryParams) {
  return request<SyncTaskPage>(`/api/data/sync/tasks?${buildPageQuery(params)}`);
}

export function getSyncLogs(params?: PageQueryParams) {
  return request<SyncLogPage>(`/api/data/sync/logs?${buildPageQuery({ pageSize: 20, ...params })}`);
}

export function createQualityCheck() {
  return request<TaskCreated>('/api/data/quality/check', { method: 'POST' });
}

export function getQualityResults(params?: PageQueryParams) {
  return request<DataQualityPage>(`/api/data/quality/results?${buildPageQuery(params)}`);
}

export function getQualitySummary() {
  return request<DataQualitySummary>('/api/data/quality/summary');
}

export function getAccountSnapshotDuplicates(params?: PageQueryParams) {
  return request<AccountSnapshotDuplicatePage>(
    `/api/data/quality/account-snapshot-duplicates?${buildPageQuery({ pageSize: 20, sortField: 'snapshot_time', sortOrder: 'desc', ...params })}`,
  );
}

export function cleanupLegacySyncCursors() {
  return request<LegacyCursorCleanupResult>('/api/data/sync/cursors/legacy/cleanup', { method: 'POST' });
}

export function getDictionary(tableName?: string, params?: PageQueryParams) {
  const query = buildPageQuery({ pageSize: 200, sortField: 'table_name', sortOrder: 'asc', ...params });
  return request<DataDictionaryPage>(tableName ? `/api/data/dictionary/${tableName}?${query}` : `/api/data/dictionary?${query}`);
}
