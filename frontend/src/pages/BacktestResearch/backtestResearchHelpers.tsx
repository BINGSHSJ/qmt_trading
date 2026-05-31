import { Typography } from 'antd';
import type { LogDrawerField } from '../../components/LogDrawer';
import type { ApiError } from '../../types/api';
import type {
  BacktestCreateRequest,
  BacktestDataCheckResult,
  BacktestSignalRecord,
  BacktestTradeRecord,
} from '../../types/backtest';
import type { StrategyFileRecord } from '../../types/strategyDev';
import { normalizeQmtMode } from '../../utils/sourceLabels';

export interface ErrorState {
  message: string;
  error?: ApiError | null;
  traceId?: string;
}

export interface LogDrawerState {
  title: string;
  subtitle?: string;
  status?: string;
  statusTone?: string;
  message?: string;
  technicalDetail?: string | null;
  fields?: LogDrawerField[];
  width?: number;
  fieldColumns?: number;
  className?: string;
}

export interface StockTradeChainState {
  symbol: string;
  name: string;
  rows: BacktestTradeRecord[];
  total: number;
  hasMore: boolean;
  signalRows: BacktestSignalRecord[];
  signalTotal: number;
  signalHasMore: boolean;
  loading: boolean;
  error?: string | null;
}

export type BacktestTabKey = '新建回测' | '回测任务' | '绩效结果' | '交易明细' | '回测日志';
export const backtestTabKeys: readonly BacktestTabKey[] = ['新建回测', '回测任务', '绩效结果', '交易明细', '回测日志'];

export function parseManifestJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export const initialFormValues: BacktestCreateRequest = {
  strategy_id: 0,
  backtest_name: '单策略本地撮合回测',
  start_date: '2026-05-04',
  end_date: '2026-05-08',
  initial_cash: 1000000,
  single_order_amount: 100000,
  data_frequency: '日K',
  fill_mode: '下一日开盘',
  fee_rate: 0.0003,
  stamp_tax_rate: 0.001,
  slippage: 0,
};

export function isMinuteStrategy(strategy: StrategyFileRecord): boolean {
  const text = `${strategy.strategy_name} ${strategy.file_name} ${strategy.description ?? ''}`.toLowerCase();
  return text.includes('minute') || text.includes('分钟') || text.includes('1m') || text.includes('盘中');
}

export function pickDefaultStrategy(items: StrategyFileRecord[], frequency?: string): StrategyFileRecord | undefined {
  if (items.length === 0) return undefined;
  if (frequency === '分钟K') {
    return items.find(isMinuteStrategy) ?? items[0];
  }
  return items.find((item) => !isMinuteStrategy(item)) ?? items[0];
}

export function buildBacktestName(strategyName?: string, startDate?: string, endDate?: string, frequency?: string) {
  const name = (strategyName || '未选策略').replace(/\s+/g, '');
  const start = (startDate || '开始日期').replaceAll('-', '').slice(4) || '开始';
  const end = (endDate || '结束日期').replaceAll('-', '').slice(4) || '结束';
  return `${name}_${start}-${end}_${frequency || '日K'}`;
}

export function formatStrategySelectLabel(strategy: StrategyFileRecord) {
  return `${strategy.strategy_name} · v${strategy.version} · ${strategy.file_name}`;
}

export function formatBacktestQmtMode(mode: string | null | undefined, detail = false) {
  const normalized = normalizeQmtMode(mode);
  if (normalized === 'real') {
    return detail ? '真实QMT落库数据' : '真实QMT落库';
  }
  if (normalized === 'test_isolation') {
    return '测试隔离';
  }
  return '未检测';
}

export function getLowCoverageWarning(check: BacktestDataCheckResult | null): string | null {
  if (!check) return null;
  const candidates = [
    check.technical_detail,
    ...(check.steps ?? []).map((step) => step.technical_detail),
  ].filter(Boolean) as string[];
  for (const item of candidates) {
    try {
      const payload = JSON.parse(item) as { coverage_rate?: number; data_type?: string; status?: string };
      if (typeof payload.coverage_rate === 'number' && payload.coverage_rate < 80) {
        const label = payload.data_type === 'minute_kline' ? '分钟K' : payload.data_type === 'daily_kline' ? '日K' : '行情';
        return `${label}覆盖率 ${payload.coverage_rate.toFixed(2)}%，低于 80%，本次结果可能失真。`;
      }
    } catch {
      // Non-JSON technical detail is ignored here; it is still displayed elsewhere.
    }
  }
  return null;
}

export function renderAuditText(value?: string | null) {
  const text = value || '暂无';
  return (
    <Typography.Text className="backtest-audit-cell-text" title={text}>
      {text}
    </Typography.Text>
  );
}

export function buildTradeAuditStats(rows: BacktestTradeRecord[]) {
  const buyTrades = rows.filter((trade) => trade.side === 'BUY');
  const sellTrades = rows.filter((trade) => trade.side === 'SELL');
  const positiveTrades = rows.filter((trade) => trade.pnl > 0);
  const symbols = Array.from(new Set(rows.map((trade) => trade.symbol)));
  const pairedSymbols = symbols.filter((symbol) => {
    const symbolTrades = rows.filter((trade) => trade.symbol === symbol);
    return symbolTrades.some((trade) => trade.side === 'BUY') && symbolTrades.some((trade) => trade.side === 'SELL');
  });
  const totalAmount = rows.reduce((sum, trade) => sum + trade.amount, 0);
  const pagePnl = rows.reduce((sum, trade) => sum + trade.pnl, 0);
  return {
    buyCount: buyTrades.length,
    sellCount: sellTrades.length,
    symbolCount: symbols.length,
    pairedSymbolCount: pairedSymbols.length,
    winRate: rows.length ? positiveTrades.length / rows.length : 0,
    totalAmount,
    pagePnl,
    avgAmount: rows.length ? totalAmount / rows.length : 0,
  };
}

export function sortTradesByTime(rows: BacktestTradeRecord[]) {
  return [...rows].sort((left, right) => {
    const byTime = left.trade_time.localeCompare(right.trade_time);
    return byTime !== 0 ? byTime : left.id - right.id;
  });
}

export function sortSignalsByTime(rows: BacktestSignalRecord[]) {
  return [...rows].sort((left, right) => {
    const byTime = left.signal_time.localeCompare(right.signal_time);
    return byTime !== 0 ? byTime : left.id - right.id;
  });
}

export function buildStockTradeChainStats(rows: BacktestTradeRecord[]) {
  const buyTrades = rows.filter((trade) => trade.side === 'BUY');
  const sellTrades = rows.filter((trade) => trade.side === 'SELL');
  const totalBuyAmount = buyTrades.reduce((sum, trade) => sum + trade.amount, 0);
  const totalSellAmount = sellTrades.reduce((sum, trade) => sum + trade.amount, 0);
  const totalFee = rows.reduce((sum, trade) => sum + trade.fee, 0);
  const totalPnl = rows.reduce((sum, trade) => sum + trade.pnl, 0);
  const buyQuantity = buyTrades.reduce((sum, trade) => sum + trade.quantity, 0);
  const sellQuantity = sellTrades.reduce((sum, trade) => sum + trade.quantity, 0);
  return {
    buyCount: buyTrades.length,
    sellCount: sellTrades.length,
    totalBuyAmount,
    totalSellAmount,
    totalFee,
    totalPnl,
    netQuantity: buyQuantity - sellQuantity,
    firstTradeTime: rows[0]?.trade_time ?? '暂无',
    lastTradeTime: rows[rows.length - 1]?.trade_time ?? '暂无',
  };
}

export function buildStockSignalChainStats(rows: BacktestSignalRecord[]) {
  const tradedSignals = rows.filter((signal) => signal.status === '已成交' || Boolean(signal.execution_time));
  const skippedSignals = rows.filter((signal) => signal.status === '跳过' || Boolean(signal.skip_reason));
  const buySignals = rows.filter((signal) => signal.action === 'BUY');
  const sellSignals = rows.filter((signal) => signal.action === 'SELL');
  return {
    signalCount: rows.length,
    tradedCount: tradedSignals.length,
    skippedCount: skippedSignals.length,
    buySignalCount: buySignals.length,
    sellSignalCount: sellSignals.length,
  };
}
