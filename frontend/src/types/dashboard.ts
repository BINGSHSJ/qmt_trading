import type { RuntimeTaskRecord } from './system';
import type { TradingOrderRecord, TradingSignalRecord, TradingTradeRecord } from './trading';

export interface AssetOverview {
  total_asset: number;
  available_cash: number;
  frozen_cash: number;
  market_value: number;
  today_pnl: number;
  position_count: number;
  updated_at?: string | null;
  snapshot_time?: string | null;
  has_account: boolean;
}

export interface TodayTradeSummary {
  submitted_count: number;
  filled_count: number;
  cancelled_count: number;
  failed_count: number;
  trade_amount: number;
  order_count: number;
  trade_count: number;
}

export interface DashboardSummary {
  asset: AssetOverview;
  running_task_count: number;
  failed_task_count: number;
  historical_failed_task_count: number;
  today_signal_count: number;
  today_order_count: number;
  today_trade_amount: number;
  qmt_mode: string;
  qmt_connected: boolean;
  trading_mode: string;
}

export interface DashboardBundle {
  summary: DashboardSummary;
  tasks: RuntimeTaskRecord[];
  today_signals: TradingSignalRecord[];
  today_trades: TodayTradeSummary;
  latest_orders: TradingOrderRecord[];
  latest_trades: TradingTradeRecord[];
}
