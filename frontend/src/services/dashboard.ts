import { request } from './request';
import type { DashboardBundle, DashboardSummary, TodayTradeSummary } from '../types/dashboard';
import type { RuntimeTaskRecord } from '../types/system';
import type { TradingSignalRecord } from '../types/trading';

const emptyAsset = {
  total_asset: 0,
  available_cash: 0,
  frozen_cash: 0,
  market_value: 0,
  today_pnl: 0,
  position_count: 0,
  updated_at: null,
  snapshot_time: null,
  has_account: false,
};

const emptyTradeSummary = {
  submitted_count: 0,
  filled_count: 0,
  cancelled_count: 0,
  failed_count: 0,
  trade_amount: 0,
  order_count: 0,
  trade_count: 0,
};

function normalizeDashboardBundle(bundle: DashboardBundle): DashboardBundle {
  return {
    summary: {
      ...bundle.summary,
      asset: { ...emptyAsset, ...bundle.summary.asset },
    },
    tasks: bundle.tasks ?? [],
    today_signals: bundle.today_signals ?? [],
    today_trades: { ...emptyTradeSummary, ...bundle.today_trades },
    latest_orders: bundle.latest_orders ?? [],
    latest_trades: bundle.latest_trades ?? [],
  };
}

export function getDashboardSummary() {
  return request<DashboardSummary>('/api/dashboard/summary');
}

export function getDashboardTasks() {
  return request<RuntimeTaskRecord[]>('/api/dashboard/tasks');
}

export function getDashboardTodaySignals() {
  return request<TradingSignalRecord[]>('/api/dashboard/today-signals');
}

export function getDashboardTodayTrades() {
  return request<TodayTradeSummary>('/api/dashboard/today-trades');
}

export async function getDashboardBundle() {
  const bundle = await request<DashboardBundle>('/api/dashboard/bundle');
  return normalizeDashboardBundle(bundle);
}
