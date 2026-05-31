import type { PageResult } from './api';

export interface BacktestCreateRequest {
  strategy_id: number;
  backtest_name: string;
  start_date: string;
  end_date: string;
  initial_cash: number;
  single_order_amount: number;
  data_frequency: string;
  fill_mode: string;
  fee_rate: number;
  stamp_tax_rate: number;
  slippage: number;
}

export interface BacktestDataCheckResult {
  ok: boolean;
  message: string;
  suggestion?: string | null;
  technical_detail?: string | null;
  steps?: BacktestValidationStep[];
}

export interface BacktestValidationStep {
  title: string;
  status: string;
  message: string;
  technical_detail?: string | null;
}

export interface BacktestTaskRecord extends BacktestCreateRequest {
  id: number;
  task_id: string;
  strategy_name: string;
  status: string;
  created_at: string;
}

export interface BacktestResultRecord {
  id: number;
  backtest_id: number;
  total_return: number;
  annual_return: number;
  max_drawdown: number;
  win_rate: number;
  trade_count: number;
  buy_count: number;
  sell_count: number;
  profit_loss_ratio: number;
  average_holding_days: number;
  ending_cash: number;
  open_position_count: number;
  open_market_value: number;
  total_fee: number;
  realized_pnl: number;
  final_cash: number;
  created_at: string;
}

export interface BacktestManifestRecord {
  id: number;
  backtest_id: number;
  strategy_file_name: string;
  strategy_code_hash: string;
  strategy_name: string;
  strategy_version: string;
  data_frequency: string;
  fill_mode: string;
  qmt_mode: string;
  qmt_path: string;
  account_id: string;
  data_coverage_snapshot: string;
  universe_summary: string;
  rule_snapshot: string;
  engine_version: string;
  trust_level: string;
  trust_message: string;
  created_at: string;
}

export interface BacktestStrategySnapshotCheck {
  status: string;
  message: string;
  manifest_hash: string;
  latest_code_hash?: string | null;
  matched_run_id?: string | null;
  matched_task_id?: string | null;
  matched_run_status?: string | null;
  matched_started_at?: string | null;
  matched_finished_at?: string | null;
  latest_run_id?: string | null;
  latest_task_id?: string | null;
  latest_run_status?: string | null;
  latest_started_at?: string | null;
  latest_finished_at?: string | null;
  latest_strategy_file_name?: string | null;
  latest_strategy_version?: string | null;
  technical_detail?: string | null;
}

export interface BacktestTradeRecord {
  id: number;
  backtest_id: number;
  symbol: string;
  name: string;
  side: string;
  price: number;
  quantity: number;
  amount: number;
  fee: number;
  trade_time: string;
  reason: string;
  pnl: number;
}

export interface BacktestSignalRecord {
  id: number;
  backtest_id: number;
  signal_time: string;
  symbol: string;
  name: string;
  action: string;
  price: number;
  amount?: number | null;
  reason: string;
  status: string;
  execution_time?: string | null;
  execution_price?: number | null;
  quantity: number;
  skip_reason?: string | null;
  is_auto_exit: number;
  created_at: string;
}

export interface BacktestEquityRecord {
  id: number;
  backtest_id: number;
  trade_date: string;
  equity: number;
  cash: number;
  market_value: number;
  drawdown: number;
}

export interface BacktestLogRecord {
  id: number;
  backtest_id: number;
  level: string;
  message: string;
  technical_detail?: string | null;
  created_at: string;
}

export interface BacktestReport {
  task: BacktestTaskRecord;
  result?: BacktestResultRecord | null;
  manifest?: BacktestManifestRecord | null;
  strategy_snapshot_check?: BacktestStrategySnapshotCheck | null;
  trades: BacktestTradeRecord[];
  signals: BacktestSignalRecord[];
  equity: BacktestEquityRecord[];
  logs: BacktestLogRecord[];
}

export type BacktestTaskPage = PageResult<BacktestTaskRecord>;
export type BacktestTradePage = PageResult<BacktestTradeRecord>;
export type BacktestSignalPage = PageResult<BacktestSignalRecord>;
export type BacktestLogPage = PageResult<BacktestLogRecord>;
