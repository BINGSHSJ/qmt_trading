import { buildPageQuery, request } from './request';
import type { PageQueryParams } from '../types/api';
import type { TaskCreated } from '../types/system';
import type {
  ExecutionLogPage,
  ManualOrderRequest,
  OrderSubmitResult,
  SignalOrderRequest,
  TradingOrderPage,
  TradingOrderRecord,
  TradingPositionPage,
  TradingSignalPage,
  TradingSignalRecord,
  TradingTradePage,
} from '../types/trading';

export function submitManualOrder(payload: ManualOrderRequest) {
  return request<OrderSubmitResult>('/api/trading/orders/manual', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function submitSignalOrder(signalId: number, payload: SignalOrderRequest = {}) {
  return request<OrderSubmitResult>(`/api/trading/orders/from-signal/${signalId}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function ignoreTradingSignal(signalId: number) {
  return request<TradingSignalRecord>(`/api/trading/signals/${signalId}/ignore`, { method: 'POST' });
}

export function cancelTradingOrder(localOrderId: string) {
  return request<TradingOrderRecord>(`/api/trading/orders/${encodeURIComponent(localOrderId)}/cancel`, { method: 'POST' });
}

export function getTradingPositions(params?: PageQueryParams) {
  return request<TradingPositionPage>(`/api/trading/positions?${buildPageQuery(params)}`);
}

export function getTradingOrders(params?: PageQueryParams) {
  return request<TradingOrderPage>(`/api/trading/orders?${buildPageQuery(params)}`);
}

export function getTradingTrades(params?: PageQueryParams) {
  return request<TradingTradePage>(`/api/trading/trades?${buildPageQuery(params)}`);
}

export function getTradingSignals(params?: PageQueryParams) {
  return request<TradingSignalPage>(`/api/trading/signals?${buildPageQuery(params)}`);
}

export function getExecutionLogs(params?: PageQueryParams) {
  return request<ExecutionLogPage>(`/api/trading/logs?${buildPageQuery(params)}`);
}

export function syncTradingOrders() {
  return request<TaskCreated>('/api/trading/orders/sync', { method: 'POST' });
}

export function syncTradingTrades() {
  return request<TaskCreated>('/api/trading/trades/sync', { method: 'POST' });
}
