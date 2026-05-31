import type { PageResult } from './api';
import type { TaskCreated } from './system';

export interface QmtStatus {
  source_code: string;
  source_name: string;
  mode: string;
  connected: boolean;
  account_id: string;
  qmt_path: string;
  xtquant_installed: boolean;
  last_connected_at?: string | null;
  message: string;
}

export interface AccountSnapshot {
  id: number;
  account_id: string;
  total_asset: number;
  available_cash: number;
  frozen_cash: number;
  market_value: number;
  today_pnl: number;
  snapshot_time: string;
}

export interface PositionSnapshot {
  id: number;
  account_id: string;
  symbol: string;
  name: string;
  quantity: number;
  available_quantity: number;
  cost_price: number;
  last_price: number;
  market_value: number;
  pnl: number;
  pnl_ratio: number;
  snapshot_time: string;
}

export interface OrderRecord {
  id: number;
  local_order_id: string;
  qmt_order_id?: string | null;
  account_id: string;
  symbol: string;
  name: string;
  side: string;
  price: number;
  quantity: number;
  filled_quantity: number;
  status: string;
  qmt_status?: string | null;
  source: string;
  order_time: string;
  updated_at: string;
}

export interface TradeRecord {
  id: number;
  trade_id: string;
  account_id: string;
  symbol: string;
  name: string;
  side: string;
  price: number;
  quantity: number;
  amount: number;
  fee: number;
  source: string;
  trade_time: string;
}

export interface StockBasic {
  id: number;
  symbol: string;
  name: string;
  market: string;
  security_type: string;
  list_status: string;
  is_st: boolean;
  updated_at: string;
}

export interface InstrumentDetail {
  id: number;
  symbol: string;
  exchange_id: string;
  instrument_id: string;
  instrument_name: string;
  exchange_code: string;
  open_date?: string | null;
  expire_date?: string | null;
  pre_close: number;
  up_stop_price: number;
  down_stop_price: number;
  is_trading: boolean;
  instrument_status: string;
  total_volume: number;
  float_volume: number;
  trading_day?: string | null;
  raw_json: string;
  sync_time: string;
}

export interface TradingCalendarRecord {
  id: number;
  market: string;
  trade_date: string;
  is_trading_day: boolean;
  source: string;
  sync_time: string;
}

export interface OfficialDataCatalogItem {
  data_type: string;
  name: string;
  category: string;
  source_module: string;
  official_interface: string;
  local_table: string;
  enabled: boolean;
  required_for_backtest: boolean;
  priority: string;
  account_boundary: string;
  sync_frequency: string;
  notes: string;
}

export interface OfficialDataCatalog {
  source: string;
  account_type: string;
  account_type_label: string;
  has_l2: boolean;
  has_credit: boolean;
  limitation_note: string;
  items: OfficialDataCatalogItem[];
  unsupported_items: string[];
}

export interface Prepare2026Request {
  start_date?: string;
  end_date?: string;
  stock_scope?: string;
  symbols?: string[];
  include_daily_kline?: boolean;
  daily_batch_size?: number;
  include_minute_kline?: boolean;
  minute_batch_size?: number;
  minute_window_days?: number;
  include_full_market_minute?: boolean;
  include_financial?: boolean;
  period?: string;
  overwrite_existing?: boolean;
  retry_failed?: boolean;
}

export interface LatestDataSyncRequest {
  start_date?: string;
  end_date?: string;
  include_account?: boolean;
  include_positions?: boolean;
  include_orders?: boolean;
  include_trades?: boolean;
  include_daily_kline?: boolean;
  daily_batch_size?: number;
  include_minute_kline?: boolean;
  include_full_market_minute?: boolean;
  minute_batch_size?: number;
  minute_window_days?: number;
  period?: string;
  symbols?: string[];
  overwrite_existing?: boolean;
}

export interface Prepare2026Step {
  step_no: number;
  data_type: string;
  name: string;
  scope: string;
  required: boolean;
  long_task: boolean;
  default_enabled: boolean;
  warning?: string | null;
}

export interface Prepare2026Plan {
  start_date: string;
  end_date: string;
  stock_scope: string;
  period: string;
  steps: Prepare2026Step[];
  warnings: string[];
  test_isolation: boolean;
  /** @deprecated 兼容旧接口字段，新代码请读取 test_isolation。 */
  mock_safe?: boolean;
}

export interface DataCoverageRecord {
  id: number;
  data_type: string;
  symbol: string;
  period: string;
  start_date: string;
  end_date: string;
  expected_trading_days: number;
  actual_trading_days: number;
  expected_rows?: number | null;
  actual_rows: number;
  coverage_unit?: string;
  coverage_unit_note?: string;
  expected_coverage_units?: number | null;
  actual_coverage_units?: number;
  missing_days: string;
  duplicate_rows: number;
  coverage_rate: number;
  status: string;
  checked_at: string;
}

export interface DailyKline {
  id: number;
  symbol: string;
  trade_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
  created_at: string;
}

export interface MinuteKline {
  id: number;
  symbol: string;
  datetime: string;
  period: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  amount: number;
  created_at: string;
}

export interface SyncTaskSummary {
  task_id: string;
  sync_type: string;
  status: string;
  total_count: number;
  success_count: number;
  failed_count: number;
  progress: number;
  message: string;
  technical_detail?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface SyncLogRecord {
  id: number;
  task_id: string;
  sync_type: string;
  level: string;
  message: string;
  technical_detail?: string | null;
  created_at: string;
}

export interface DataQualityRecord {
  id: number;
  check_type: string;
  target_table: string;
  status: string;
  message: string;
  suggestion?: string | null;
  created_at: string;
}

export interface DataQualitySummary {
  success_count: number;
  warning_count: number;
  failed_count: number;
  latest_check_time?: string | null;
  is_stale?: boolean;
  stale_reason?: string | null;
}

export interface DataFreshnessItem {
  key: string;
  name: string;
  table_name: string;
  latest_time?: string | null;
  latest_date?: string | null;
  target_date?: string | null;
  lag_days?: number | null;
  status: string;
  message: string;
  suggestion: string;
  coverage_status?: string | null;
  coverage_rate?: number | null;
  coverage_checked_at?: string | null;
  actual_rows?: number | null;
  coverage_unit?: string | null;
  coverage_unit_note?: string | null;
  actual_coverage_units?: number | null;
  technical_detail?: string | null;
}

export interface DataFreshnessSummary {
  target_trade_date: string;
  generated_at: string;
  overall_status: string;
  stale_count: number;
  warning_count: number;
  items: DataFreshnessItem[];
  next_actions: string[];
}

export interface AccountSnapshotDuplicateRecord {
  account_id: string;
  snapshot_time: string;
  duplicate_count: number;
  min_id: number;
  max_id: number;
  min_total_asset: number;
  max_total_asset: number;
  min_available_cash: number;
  max_available_cash: number;
}

export interface LegacyCursorCleanupResult {
  cleaned_count: number;
  archived_count: number;
  message: string;
  technical_detail?: string | null;
}

export interface DataDictionaryRecord {
  id: number;
  table_name: string;
  field_name: string;
  field_type: string;
  description: string;
  example_value?: string | null;
  unit?: string | null;
  strategy_usage?: string | null;
  is_indexed: boolean;
}

export type PositionPage = PageResult<PositionSnapshot>;
export type OrderPage = PageResult<OrderRecord>;
export type TradePage = PageResult<TradeRecord>;
export type StockPage = PageResult<StockBasic>;
export type InstrumentDetailPage = PageResult<InstrumentDetail>;
export type TradingCalendarPage = PageResult<TradingCalendarRecord>;
export type DataCoveragePage = PageResult<DataCoverageRecord>;
export type DailyKlinePage = PageResult<DailyKline>;
export type MinuteKlinePage = PageResult<MinuteKline>;
export type SyncTaskPage = PageResult<SyncTaskSummary>;
export type SyncLogPage = PageResult<SyncLogRecord>;
export type DataQualityPage = PageResult<DataQualityRecord>;
export type AccountSnapshotDuplicatePage = PageResult<AccountSnapshotDuplicateRecord>;
export type DataDictionaryPage = PageResult<DataDictionaryRecord>;
export type { TaskCreated };
