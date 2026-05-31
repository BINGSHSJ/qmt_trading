import type { PageResult } from './api';

export interface ManualOrderRequest {
  symbol: string;
  name?: string | null;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  order_type?: string;
}

export interface SignalOrderRequest {
  price?: number | null;
  quantity?: number | null;
}

export interface TradingPosition {
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

export interface TradingOrderRecord {
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
  strategy_id?: string | null;
  strategy_name?: string | null;
  signal_id?: string | null;
  idempotency_key?: string | null;
  order_time: string;
  updated_at: string;
}

export interface TradingTradeRecord {
  id: number;
  trade_id: string;
  local_order_id?: string | null;
  qmt_order_id?: string | null;
  account_id: string;
  symbol: string;
  name: string;
  side: string;
  price: number;
  quantity: number;
  amount: number;
  fee: number;
  source: string;
  strategy_name?: string | null;
  trade_time: string;
}

export interface TradingSignalRecord {
  id: number;
  strategy_id: number;
  strategy_name: string;
  run_id: string;
  symbol: string;
  name: string;
  action: string;
  price: number;
  amount?: number | null;
  reason: string;
  status: string;
  signal_time: string;
  order_id?: string | null;
  created_at: string;
}

export interface ExecutionLogRecord {
  id: number;
  local_order_id?: string | null;
  level: string;
  message: string;
  technical_detail?: string | null;
  created_at: string;
}

export interface OrderSubmitResult {
  order: TradingOrderRecord;
  message: string;
  duplicate: boolean;
}

export type TradingPositionPage = PageResult<TradingPosition>;
export type TradingOrderPage = PageResult<TradingOrderRecord>;
export type TradingTradePage = PageResult<TradingTradeRecord>;
export type TradingSignalPage = PageResult<TradingSignalRecord>;
export type ExecutionLogPage = PageResult<ExecutionLogRecord>;
