import { Card, Segmented, Select, Space, Typography } from 'antd';
import {
  ColorType,
  HistogramSeries,
  LineStyle,
  LineSeries,
  createChart,
  createSeriesMarkers,
  type HistogramData,
  type LineData,
  type SeriesMarker,
  type UTCTimestamp,
} from 'lightweight-charts';
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BacktestEquityRecord, BacktestTradeRecord } from '../../types/backtest';
import EmptyGuide from '../EmptyGuide';
import { useThemeMode } from '../../theme/ThemeModeContext';
import { getLocalQuantChartPalette, type LocalQuantChartPalette } from '../../theme/chartTheme';
import './BacktestChart.css';

interface BacktestChartProps {
  rows: BacktestEquityRecord[];
  trades?: BacktestTradeRecord[];
  height?: number;
  selectedTradeId?: number | null;
  selectedEquityDate?: string | null;
  onSelectTrade?: (trade: BacktestTradeRecord) => void;
  onPreviewTrade?: (trade: BacktestTradeRecord | null) => void;
  onPreviewEquity?: (record: BacktestEquityRecord | null) => void;
  onSelectEquityDate?: (record: BacktestEquityRecord) => void;
}

type ChartMode = '资金/回撤' | '资金曲线' | '回撤曲线' | '日盈亏';
type TradeSideFilter = '全部' | '买入' | '卖出';
type TradePnlFilter = '全部盈亏' | '盈利' | '亏损' | '持平';
const MAX_CHART_POINTS = 2000;
const ALL_TRADE_SYMBOLS = '__ALL_TRADE_SYMBOLS__';

interface ChartHoverMetric {
  label: string;
  value: string;
  tone?: 'blue' | 'green' | 'orange' | 'red' | 'neutral';
}

interface ChartHoverState {
  date: string;
  metrics: ChartHoverMetric[];
}

interface ChartAnchorState {
  date: string;
  xPercent: number;
  mainYPercent: number;
  drawdownYPercent: number;
  mainLabel: string;
  mainValue: string;
  drawdownValue: string;
  tradeCount: number;
  edge: 'left' | 'middle' | 'right';
}

interface HighlightPoint {
  key: 'highest-equity' | 'lowest-equity' | 'max-drawdown';
  label: string;
  value: string;
  date: string;
  detail: string;
  tone: 'blue' | 'green' | 'orange';
  time: UTCTimestamp;
  equity: number;
  cash: number;
  marketValue: number;
  drawdown: number;
}

interface DrawdownRangePoint {
  label: string;
  date: string;
  time: UTCTimestamp;
  equity: number;
  drawdown: number;
  index: number;
}

interface MaxDrawdownRange {
  start: DrawdownRangePoint;
  trough: DrawdownRangePoint;
  recovery?: DrawdownRangePoint;
  drawdownPercent: number;
  equityLoss: number;
  daysToTrough: number;
  daysToRecovery?: number;
  recovered: boolean;
}

export default function BacktestChart({
  rows,
  trades = [],
  height = 380,
  selectedTradeId = null,
  selectedEquityDate = null,
  onSelectTrade,
  onPreviewTrade,
  onPreviewEquity,
  onSelectEquityDate,
}: BacktestChartProps) {
  const [mode, setMode] = useState<ChartMode>('资金/回撤');
  const containerRef = useRef<HTMLDivElement | null>(null);
  const drawdownContainerRef = useRef<HTMLDivElement | null>(null);
  const [hoverState, setHoverState] = useState<ChartHoverState | null>(null);
  const [selectedKeyPoint, setSelectedKeyPoint] = useState<HighlightPoint['key'] | null>(null);
  const [tradeSideFilter, setTradeSideFilter] = useState<TradeSideFilter>('全部');
  const [tradeSymbolFilter, setTradeSymbolFilter] = useState(ALL_TRADE_SYMBOLS);
  const [tradePnlFilter, setTradePnlFilter] = useState<TradePnlFilter>('全部盈亏');
  const [previewTrade, setPreviewTrade] = useState<BacktestTradeRecord | null>(null);
  const [previewEquity, setPreviewEquity] = useState<BacktestEquityRecord | null>(null);
  const { mode: themeMode } = useThemeMode();
  const chartPalette = useMemo(() => getLocalQuantChartPalette(themeMode), [themeMode]);
  const chartData = useMemo(() => buildSeries(rows, mode, chartPalette), [chartPalette, rows, mode]);
  const equityData = useMemo(() => buildSeries(rows, '资金曲线', chartPalette), [chartPalette, rows]);
  const drawdownData = useMemo(() => buildSeries(rows, '回撤曲线', chartPalette), [chartPalette, rows]);
  const drawdownRange = useMemo(() => buildMaxDrawdownRange(rows), [rows]);
  const highlightPoints = useMemo(() => buildHighlightPoints(rows, drawdownRange), [drawdownRange, rows]);
  const selectedTrade = useMemo(() => trades.find((item) => item.id === selectedTradeId) ?? null, [selectedTradeId, trades]);
  const activeTradePreview = previewTrade ?? selectedTrade;
  const selectedEquity = useMemo(() => rows.find((item) => item.trade_date === selectedEquityDate) ?? null, [rows, selectedEquityDate]);
  const activeEquityPreview = previewEquity ?? selectedEquity;
  const activeEquityPreviewTrades = useMemo(
    () => activeEquityPreview ? trades.filter((trade) => trade.trade_time.slice(0, 10) === activeEquityPreview.trade_date) : [],
    [activeEquityPreview, trades],
  );
  const activeEquityDailyPnl = useMemo(
    () => activeEquityPreview ? getEquityDailyPnl(rows, activeEquityPreview) : 0,
    [activeEquityPreview, rows],
  );
  const chartAnchor = useMemo(
    () => activeEquityPreview ? buildChartAnchor(rows, activeEquityPreview, mode, activeEquityPreviewTrades.length) : null,
    [activeEquityPreview, activeEquityPreviewTrades.length, mode, rows],
  );
  const tradeSymbolOptions = useMemo(() => buildTradeSymbolOptions(trades), [trades]);
  const tradeMarkers = useMemo(
    () => buildTradeMarkers(trades, tradeSideFilter, tradeSymbolFilter, tradePnlFilter),
    [tradePnlFilter, tradeSideFilter, tradeSymbolFilter, trades],
  );
  const chartSummary = useMemo(() => buildChartSummary(rows, trades, drawdownRange), [drawdownRange, rows, trades]);
  const hoverMetrics = hoverState?.metrics ?? buildEmptyHoverMetrics();
  const selectedHighlightPoint = useMemo(
    () => highlightPoints.find((item) => item.key === selectedKeyPoint) ?? null,
    [highlightPoints, selectedKeyPoint],
  );
  const previewEquityPoint = useCallback((record: BacktestEquityRecord | null) => {
    setPreviewEquity(record);
    onPreviewEquity?.(record);
  }, [onPreviewEquity]);
  const previewEquityByDate = useCallback((date: string | undefined | null) => {
    if (!date) return null;
    const record = rows.find((item) => item.trade_date === date) ?? null;
    if (record) {
      previewEquityPoint(record);
    }
    return record;
  }, [previewEquityPoint, rows]);

  useEffect(() => {
    setHoverState(null);
    setSelectedKeyPoint(null);
    setPreviewEquity(null);
    onPreviewEquity?.(null);
  }, [onPreviewEquity, rows]);

  useEffect(() => {
    if (selectedEquityDate !== null) return;
    setPreviewEquity(null);
    onPreviewEquity?.(null);
  }, [onPreviewEquity, selectedEquityDate]);

  useEffect(() => {
    if (!selectedEquity) return;
    setPreviewEquity(selectedEquity);
    onPreviewEquity?.(selectedEquity);
    setHoverState(buildHoverStateFromEquityRecord(selectedEquity, rows, mode));
  }, [mode, onPreviewEquity, rows, selectedEquity]);

  useEffect(() => {
    setTradeSideFilter('全部');
    setTradeSymbolFilter(ALL_TRADE_SYMBOLS);
    setTradePnlFilter('全部盈亏');
    setPreviewTrade(null);
    onPreviewTrade?.(null);
  }, [onPreviewTrade, trades]);

  useEffect(() => {
    if (selectedTradeId !== null) return;
    setPreviewTrade(null);
    onPreviewTrade?.(null);
  }, [onPreviewTrade, selectedTradeId]);

  useEffect(() => {
    if (!selectedTrade) return;
    setPreviewTrade(selectedTrade);
    onPreviewTrade?.(selectedTrade);
    previewEquityByDate(selectedTrade.trade_time.slice(0, 10));
    setHoverState(buildHoverStateFromTrade(selectedTrade));
    setTradeSideFilter(selectedTrade.side === 'BUY' ? '买入' : selectedTrade.side === 'SELL' ? '卖出' : '全部');
    setTradeSymbolFilter(selectedTrade.symbol);
    setTradePnlFilter(getTradePnlBucket(selectedTrade));
  }, [onPreviewTrade, previewEquityByDate, selectedTrade]);

  useEffect(() => {
    if (!containerRef.current || chartData.length === 0 || mode === '资金/回撤') return;
    const chart = createWorkbenchChart(containerRef.current, height, chartPalette);

    if (mode === '日盈亏') {
      const series = chart.addSeries(HistogramSeries, { priceFormat: { type: 'price', precision: 2, minMove: 0.01 } });
      series.setData(chartData.map((item) => item.point as HistogramData<UTCTimestamp>));
    } else {
      const series = chart.addSeries(LineSeries, {
        color: mode === '回撤曲线' ? chartPalette.drawdown : chartPalette.equity,
        lineWidth: 2,
        priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
      });
      series.setData(chartData.map((item) => item.point as LineData<UTCTimestamp>));
      if (mode === '资金曲线') {
        addEquityOverlays(series, highlightPoints, drawdownRange, chartPalette);
      }
      if (mode === '回撤曲线') {
        addDrawdownOverlays(series, highlightPoints, drawdownRange, chartPalette);
      }
    }
    chart.timeScale().fitContent();

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        setHoverState(null);
        return;
      }
      const item = chartData.find((entry) => entry.point.time === param.time);
      if (!item) return;
      previewEquityPoint(item.raw);
      setHoverState(buildHoverState(item, mode));
    });

    const resizeObserver = new ResizeObserver(([entry]) => {
      chart.applyOptions({ width: Math.floor(entry.contentRect.width) });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [chartData, chartPalette, drawdownRange, height, highlightPoints, mode, previewEquityPoint]);

  useEffect(() => {
    if (!containerRef.current || !drawdownContainerRef.current || equityData.length === 0 || mode !== '资金/回撤') return;
    const equityChart = createWorkbenchChart(containerRef.current, Math.max(Math.floor(height * 0.58), 180), chartPalette);
    const drawdownChart = createWorkbenchChart(drawdownContainerRef.current, Math.max(Math.floor(height * 0.32), 110), chartPalette);
    const equitySeries = equityChart.addSeries(LineSeries, {
      color: chartPalette.equity,
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
    });
    const drawdownSeries = drawdownChart.addSeries(LineSeries, {
      color: chartPalette.drawdown,
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
    });

    equitySeries.setData(equityData.map((item) => item.point as LineData<UTCTimestamp>));
    drawdownSeries.setData(drawdownData.map((item) => item.point as LineData<UTCTimestamp>));
    addEquityOverlays(equitySeries, highlightPoints, drawdownRange, chartPalette);
    addDrawdownOverlays(drawdownSeries, highlightPoints, drawdownRange, chartPalette);
    equityChart.timeScale().fitContent();
    drawdownChart.timeScale().fitContent();

    const handleHover = (time?: unknown) => {
      if (!time) {
        setHoverState(null);
        return;
      }
      const item = equityData.find((entry) => entry.point.time === time);
      if (!item) return;
      previewEquityPoint(item.raw);
      setHoverState(buildHoverState(item, '资金/回撤'));
    };
    equityChart.subscribeCrosshairMove((param) => handleHover(param.time));
    drawdownChart.subscribeCrosshairMove((param) => handleHover(param.time));

    const resizeObserver = new ResizeObserver(([entry]) => {
      const width = Math.floor(entry.contentRect.width);
      equityChart.applyOptions({ width });
      drawdownChart.applyOptions({ width });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      equityChart.remove();
      drawdownChart.remove();
    };
  }, [chartPalette, drawdownData, drawdownRange, equityData, height, highlightPoints, mode, previewEquityPoint]);

  if (rows.length === 0) {
    return (
      <Card className="backtest-chart-card" title="回测曲线">
        <EmptyGuide description="暂无回测曲线。请先选择一个成功完成的回测任务，或等待当前回测任务完成。" />
      </Card>
    );
  }

  const selectHighlightPoint = (item: HighlightPoint) => {
    setSelectedKeyPoint(item.key);
    setMode(item.key === 'max-drawdown' ? '回撤曲线' : '资金曲线');
    setHoverState(buildHoverStateFromHighlightPoint(item));
    previewEquityByDate(item.date);
  };
  const previewTradeMarker = (trade: BacktestTradeRecord) => {
    setPreviewTrade(trade);
    setHoverState(buildHoverStateFromTrade(trade));
    onPreviewTrade?.(trade);
    previewEquityByDate(trade.trade_time.slice(0, 10));
  };
  return (
    <Card
      className="backtest-chart-card"
      title="曲线分析"
      extra={<Segmented size="small" value={mode} onChange={(value) => setMode(value as ChartMode)} options={['资金/回撤', '资金曲线', '回撤曲线', '日盈亏']} />}
    >
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <div className="backtest-chart-legend" aria-label="回测曲线图例">
          {mode === '资金/回撤' || mode === '资金曲线' ? <span className="backtest-chart-legend__item backtest-chart-legend__item--equity">资金曲线</span> : null}
          {mode === '资金/回撤' || mode === '回撤曲线' ? <span className="backtest-chart-legend__item backtest-chart-legend__item--drawdown">回撤曲线</span> : null}
          {mode === '日盈亏' ? <span className="backtest-chart-legend__item backtest-chart-legend__item--pnl">日盈亏</span> : null}
          {mode !== '日盈亏' ? <span className="backtest-chart-legend__item backtest-chart-legend__item--checkpoint">关键点</span> : null}
          {mode === '资金/回撤' ? <span className="backtest-chart-legend__sync">双图悬停联动</span> : null}
          <span className="backtest-chart-legend__meta">点数 {rows.length} / 抽样上限 {MAX_CHART_POINTS}</span>
        </div>
        <div className="backtest-chart-workbench">
          <div className="backtest-chart-main">
            <div className="backtest-chart-floating-metrics" aria-label="图表关键指标浮层" data-testid="backtest-chart-floating-metrics">
              <div className="backtest-chart-floating-metrics__head">
                <span>关键点浮层</span>
                <strong>最高 / 最低 / 回撤</strong>
              </div>
              {highlightPoints.map((item) => (
                <button
                  type="button"
                  className={[
                    'backtest-chart-floating-metric',
                    `backtest-chart-floating-metric--${item.tone}`,
                    selectedKeyPoint === item.key ? 'backtest-chart-floating-metric--active' : '',
                  ].filter(Boolean).join(' ')}
                  data-testid={`backtest-chart-floating-keypoint-${item.key}`}
                  aria-label={`${item.label}：${item.value}，日期 ${item.date}，${item.detail}`}
                  aria-pressed={selectedKeyPoint === item.key}
                  key={item.key}
                  onClick={() => selectHighlightPoint(item)}
                  onFocus={() => {
                    setHoverState(buildHoverStateFromHighlightPoint(item));
                    previewEquityByDate(item.date);
                  }}
                  onMouseEnter={() => {
                    setHoverState(buildHoverStateFromHighlightPoint(item));
                    previewEquityByDate(item.date);
                  }}
                  title={`定位${item.label}：${item.date} / ${item.detail}`}
                >
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                  <small title={`${item.date} / ${item.detail}`}>{item.date}</small>
                  <em title={`${item.detail}，点击定位到曲线关键点`}>{item.detail} / 点击定位</em>
                </button>
              ))}
              {drawdownRange ? (
                <div
                  className="backtest-chart-drawdown-range"
                  data-testid="backtest-chart-drawdown-range"
                  aria-label={`最大回撤区间：${drawdownRange.start.date} 到 ${drawdownRange.trough.date}${drawdownRange.recovery ? `，恢复于 ${drawdownRange.recovery.date}` : '，尚未恢复'}`}
                >
                  <span>最大回撤区间</span>
                  <strong>{drawdownRange.start.date} → {drawdownRange.trough.date}</strong>
                  <small>
                    深度 {formatValue(drawdownRange.drawdownPercent, '回撤曲线')} / 用时 {drawdownRange.daysToTrough} 交易日 /
                    {drawdownRange.recovery ? ` 恢复 ${drawdownRange.daysToRecovery} 交易日` : ' 未恢复'}
                  </small>
                </div>
              ) : null}
            </div>
            <div
              className="backtest-chart-plot"
              data-testid="backtest-chart-main-plot"
              style={{ height: mode === '资金/回撤' ? Math.max(Math.floor(height * 0.58), 180) : height }}
            >
              <div ref={containerRef} className="backtest-chart-canvas" style={{ width: '100%', height: '100%' }} />
              {chartAnchor ? <ChartAnchorOverlay anchor={chartAnchor} kind="main" /> : null}
            </div>
            {mode === '资金/回撤' ? (
              <div
                className="backtest-chart-plot backtest-chart-plot--drawdown"
                data-testid="backtest-chart-drawdown-plot"
                style={{ height: Math.max(Math.floor(height * 0.32), 110) }}
              >
                <div ref={drawdownContainerRef} className="backtest-chart-canvas backtest-chart-canvas--drawdown" style={{ width: '100%', height: '100%' }} />
                {chartAnchor ? <ChartAnchorOverlay anchor={chartAnchor} kind="drawdown" /> : null}
              </div>
            ) : null}
            <div className="backtest-chart-hover-panel" aria-label="图表悬停核对指标">
              <div className="backtest-chart-hover-panel__title">
                <span>{hoverState?.date ?? '悬停查看数值'}</span>
                <small>{mode === '资金/回撤' ? '资金 / 回撤同步核对' : mode}</small>
              </div>
              <div className="backtest-chart-hover-panel__grid">
                {hoverMetrics.map((item) => (
                  <div className={`backtest-chart-hover-cell backtest-chart-hover-cell--${item.tone ?? 'neutral'}`} key={item.label}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                ))}
              </div>
            </div>
            <Typography.Text type="secondary" className="backtest-chart-footnote">
              时间区间：{rows[0]?.trade_date} 至 {rows[rows.length - 1]?.trade_date}；虚线和标记点表示最高权益、最低权益与最大回撤发生日，图表超过 {MAX_CHART_POINTS} 点会自动抽样但保留关键点。
            </Typography.Text>
          </div>
          <aside className="backtest-chart-side" aria-label="回测指标与买卖点">
            <div className="backtest-chart-side__title">买卖点标记</div>
            <div className="backtest-chart-side-summary" aria-label="曲线区间摘要">
              {chartSummary.map((item) => (
                <div className={`backtest-chart-side-summary__item backtest-chart-side-summary__item--${item.tone}`} key={item.label}>
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
            <div className="backtest-chart-equity-preview" data-testid="backtest-chart-equity-preview" aria-label="曲线日期核对">
              {activeEquityPreview ? (
                <>
                  <div>
                    <span>{activeEquityPreview.trade_date === selectedEquityDate ? '已定位曲线日期' : '当前曲线日期'}</span>
                    <strong>{activeEquityPreview.trade_date}</strong>
                    <small>当日成交 {activeEquityPreviewTrades.length} 条</small>
                  </div>
                  <div>
                    <span>权益 / 当日变化</span>
                    <strong>{formatValue(activeEquityPreview.equity, '资金曲线')}</strong>
                    <small className={activeEquityDailyPnl >= 0 ? 'is-profit' : 'is-loss'}>
                      {formatValue(activeEquityDailyPnl, '资金曲线')}
                    </small>
                  </div>
                  <div>
                    <span>现金 / 回撤</span>
                    <strong>{formatValue(activeEquityPreview.cash, '资金曲线')}</strong>
                    <small>{formatValue(activeEquityPreview.drawdown, '回撤曲线')}</small>
                  </div>
                  <button
                    type="button"
                    className="backtest-chart-equity-preview__action"
                    data-testid="backtest-chart-equity-preview-locate"
                    disabled={!onSelectEquityDate}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      onSelectEquityDate?.(activeEquityPreview);
                    }}
                    onClick={() => onSelectEquityDate?.(activeEquityPreview)}
                  >
                    定位当日
                  </button>
                </>
              ) : (
                <div className="backtest-chart-equity-preview__empty">
                  hover 曲线或点击关键点后显示当日资金、回撤和成交背景。
                </div>
              )}
            </div>
            <div className="backtest-chart-keypoints" aria-label="曲线关键点定位">
              <div className="backtest-chart-keypoints__head">
                <span>关键点定位</span>
                <strong>{highlightPoints.length} 个</strong>
              </div>
              <div className="backtest-chart-keypoints__list">
                {highlightPoints.map((item) => (
                  <button
                    type="button"
                    className={[
                      'backtest-chart-keypoint',
                      `backtest-chart-keypoint--${item.tone}`,
                      selectedKeyPoint === item.key ? 'backtest-chart-keypoint--active' : '',
                    ].filter(Boolean).join(' ')}
                    key={item.key}
                    data-testid={`backtest-chart-keypoint-${item.key}`}
                    onClick={() => selectHighlightPoint(item)}
                    aria-pressed={selectedKeyPoint === item.key}
                    title={`定位${item.label}：${item.date} / ${item.detail}`}
                  >
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    <small title={`${item.date} / ${item.detail}`}>{item.date} / {item.detail}</small>
                  </button>
                ))}
              </div>
              {selectedHighlightPoint ? (
                <div className={`backtest-chart-keypoint-detail backtest-chart-keypoint-detail--${selectedHighlightPoint.tone}`}>
                  <span>当前定位</span>
                  <strong>{selectedHighlightPoint.label} / {selectedHighlightPoint.value}</strong>
                  <small>
                    {selectedHighlightPoint.date} | 现金 {formatValue(selectedHighlightPoint.cash, '资金曲线')} |
                    持仓 {formatValue(selectedHighlightPoint.marketValue, '资金曲线')} |
                    回撤 {formatValue(selectedHighlightPoint.drawdown, '回撤曲线')}
                  </small>
                </div>
              ) : (
                <div className="backtest-chart-keypoint-detail backtest-chart-keypoint-detail--empty">
                  <span>关键点可点击定位</span>
                  <strong>最高 / 最低 / 最大回撤</strong>
                  <small>点击后切换曲线视图，并在下方 hover 面板展示该点明细。</small>
                </div>
              )}
            </div>
            {drawdownRange ? (
              <div className="backtest-chart-drawdown-card" aria-label="最大回撤区间核对">
                <div className="backtest-chart-drawdown-card__head">
                  <span>最大回撤区间</span>
                  <strong>{formatValue(drawdownRange.drawdownPercent, '回撤曲线')}</strong>
                </div>
                <div className="backtest-chart-drawdown-card__grid">
                  <div>
                    <span>峰值起点</span>
                    <strong>{drawdownRange.start.date}</strong>
                    <small>{formatValue(drawdownRange.start.equity, '资金曲线')}</small>
                  </div>
                  <div>
                    <span>回撤低点</span>
                    <strong>{drawdownRange.trough.date}</strong>
                    <small>{formatValue(drawdownRange.trough.equity, '资金曲线')}</small>
                  </div>
                  <div>
                    <span>恢复日期</span>
                    <strong>{drawdownRange.recovery?.date ?? '未恢复'}</strong>
                    <small>{drawdownRange.recovery ? formatValue(drawdownRange.recovery.equity, '资金曲线') : '截至区间结束仍低于峰值'}</small>
                  </div>
                  <div>
                    <span>权益损失</span>
                    <strong>{formatValue(drawdownRange.equityLoss, '资金曲线')}</strong>
                    <small>峰值到低点差额</small>
                  </div>
                </div>
                <Typography.Text type="secondary" className="backtest-chart-drawdown-card__note">
                  回撤区间由前端按权益曲线逐日推演，仅用于报告核对；不改变后端回测结果。
                </Typography.Text>
              </div>
            ) : null}
            {tradeMarkers.total > 0 ? (
              <div className="backtest-chart-trade-markers" aria-label="回测买卖点标记">
                <div className="backtest-chart-trade-markers__head">
                  <span>买卖点标记</span>
                  <strong>买 {tradeMarkers.buyCount} / 卖 {tradeMarkers.sellCount}</strong>
                </div>
                <div className="backtest-chart-trade-markers__filter" aria-label="买卖点方向筛选">
                  <Segmented
                    size="small"
                    value={tradeSideFilter}
                    onChange={(value) => setTradeSideFilter(value as TradeSideFilter)}
                    options={['全部', '买入', '卖出']}
                  />
                  <span>{tradeMarkers.filteredTotal} / {tradeMarkers.total}</span>
                </div>
                <div className="backtest-chart-trade-markers__advanced-filter" aria-label="买卖点股票和盈亏筛选">
                  <Select
                    aria-label="按股票筛选买卖点"
                    size="small"
                    value={tradeSymbolFilter}
                    options={tradeSymbolOptions}
                    onChange={setTradeSymbolFilter}
                    popupMatchSelectWidth={260}
                  />
                  <Segmented
                    size="small"
                    value={tradePnlFilter}
                    onChange={(value) => setTradePnlFilter(value as TradePnlFilter)}
                    options={['全部盈亏', '盈利', '亏损', '持平']}
                  />
                </div>
                <div className="backtest-chart-trade-markers__hint">
                  hover 预览买卖点；点击后跳转到交易明细并高亮同日同股成交。当前筛选最多显示前 {tradeMarkers.limit} 条。
                </div>
                {activeTradePreview ? (
                  <div className="backtest-chart-trade-preview" data-testid="backtest-chart-trade-preview" aria-label="当前预览买卖点">
                    <div>
                      <span>{activeTradePreview.id === selectedTradeId ? '当前定位' : '当前预览'}</span>
                      <strong>{formatStockLabel(activeTradePreview.symbol, activeTradePreview.name)}</strong>
                      <small>{activeTradePreview.trade_time}</small>
                    </div>
                    <div>
                      <span>{formatSideLabel(activeTradePreview.side)}</span>
                      <strong>{formatValue(activeTradePreview.price, '资金曲线')}</strong>
                      <small>盈亏 {formatValue(activeTradePreview.pnl, '资金曲线')}</small>
                    </div>
                    <button
                      type="button"
                      className="backtest-chart-trade-preview__action"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        onSelectTrade?.(activeTradePreview);
                      }}
                      onClick={() => onSelectTrade?.(activeTradePreview)}
                      disabled={!onSelectTrade}
                      data-testid="backtest-chart-trade-preview-locate"
                    >
                      定位明细
                    </button>
                  </div>
                ) : (
                  <div className="backtest-chart-trade-preview backtest-chart-trade-preview--empty" data-testid="backtest-chart-trade-preview">
                    hover 买卖点后显示价格、时间、盈亏，并可定位到底部交易明细。
                  </div>
                )}
                <div className="backtest-chart-trade-markers__list">
                  {tradeMarkers.items.length > 0 ? tradeMarkers.items.map((item) => (
                    <button
                      type="button"
                      className={[
                        'backtest-chart-trade-marker',
                        `backtest-chart-trade-marker--${item.side === 'BUY' ? 'buy' : 'sell'}`,
                        selectedTradeId === item.id || previewTrade?.id === item.id ? 'backtest-chart-trade-marker--active' : '',
                      ].filter(Boolean).join(' ')}
                      key={item.id}
                      data-testid={`backtest-chart-trade-marker-${item.id}`}
                      onClick={() => onSelectTrade?.(item.raw)}
                      onMouseEnter={() => previewTradeMarker(item.raw)}
                      onFocus={() => previewTradeMarker(item.raw)}
                      disabled={!onSelectTrade}
                      aria-pressed={selectedTradeId === item.id || previewTrade?.id === item.id}
                      title={`${formatSideLabel(item.side)} ${item.symbol} ${item.time} / ${item.price}`}
                    >
                      <b>{item.side === 'BUY' ? '买' : '卖'}</b>
                      <em>{item.time}</em>
                      <small>{item.symbol} {item.name ? `/${item.name}` : ''} {item.price}</small>
                    </button>
                  )) : (
                    <div className="backtest-chart-trade-markers__empty-filter">
                      当前筛选条件暂无买卖点
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="backtest-chart-trade-markers backtest-chart-trade-markers--empty">暂无买卖点标记</div>
            )}
          </aside>
        </div>
      </Space>
    </Card>
  );
}

function ChartAnchorOverlay({ anchor, kind }: { anchor: ChartAnchorState; kind: 'main' | 'drawdown' }) {
  const yPercent = kind === 'drawdown' ? anchor.drawdownYPercent : anchor.mainYPercent;
  const style = {
    '--anchor-x': `${anchor.xPercent}%`,
    '--anchor-y': `${yPercent}%`,
  } as CSSProperties;
  return (
    <div
      className={`backtest-chart-anchor backtest-chart-anchor--${kind} backtest-chart-anchor--edge-${anchor.edge}`}
      data-testid={`backtest-chart-hover-anchor-${kind}`}
      aria-label={`${kind === 'drawdown' ? '回撤曲线' : '主图'}当前日期锚点：${anchor.date}`}
      style={style}
    >
      <span className="backtest-chart-anchor__vertical" />
      <span className="backtest-chart-anchor__horizontal" />
      <span className="backtest-chart-anchor__dot" />
      <span className="backtest-chart-anchor__label">
        <strong>{anchor.date}</strong>
        <small>{kind === 'drawdown' ? `回撤 ${anchor.drawdownValue}` : `${anchor.mainLabel} ${anchor.mainValue}`}</small>
        <em>当日成交 {anchor.tradeCount} 条</em>
      </span>
    </div>
  );
}

function buildChartAnchor(rows: BacktestEquityRecord[], record: BacktestEquityRecord, mode: ChartMode, tradeCount: number): ChartAnchorState {
  const index = Math.max(rows.findIndex((item) => item.trade_date === record.trade_date), 0);
  const mainMode: ChartMode = mode === '资金/回撤' ? '资金曲线' : mode;
  const mainValue = getValue(rows, record, index, mainMode);
  const mainRange = getValueRange(rows, mainMode);
  const drawdownRange = getValueRange(rows, '回撤曲线');
  const xPercent = rows.length <= 1 ? 50 : clampPercent((index / (rows.length - 1)) * 100);
  const edge = xPercent < 18 ? 'left' : xPercent > 82 ? 'right' : 'middle';
  return {
    date: record.trade_date,
    xPercent,
    mainYPercent: getYPercent(mainValue, mainRange),
    drawdownYPercent: getYPercent(record.drawdown, drawdownRange),
    mainLabel: mainMode === '资金曲线' ? '权益' : mainMode,
    mainValue: formatValue(mainValue, mainMode),
    drawdownValue: formatValue(record.drawdown, '回撤曲线'),
    tradeCount,
    edge,
  };
}

function getValueRange(rows: BacktestEquityRecord[], mode: ChartMode) {
  if (rows.length === 0) return { min: 0, max: 1 };
  const values = rows.map((row, index) => getValue(rows, row, index, mode));
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return { min: min - 1, max: max + 1 };
  return { min, max };
}

function getYPercent(value: number, range: { min: number; max: number }) {
  const ratio = (range.max - value) / (range.max - range.min);
  return clampPercent(ratio * 100, 7, 93);
}

function clampPercent(value: number, min = 0, max = 100) {
  return Math.min(Math.max(value, min), max);
}

function createWorkbenchChart(container: HTMLDivElement, height: number, chartTheme: LocalQuantChartPalette) {
  return createChart(container, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: chartTheme.background },
        textColor: chartTheme.text,
      },
      grid: {
        vertLines: { color: chartTheme.grid },
        horzLines: { color: chartTheme.grid },
      },
      rightPriceScale: { borderColor: chartTheme.border },
      timeScale: { borderColor: chartTheme.border },
      crosshair: { horzLine: { labelBackgroundColor: chartTheme.crosshair }, vertLine: { labelBackgroundColor: chartTheme.crosshair } },
    });
}

function buildSeries(rows: BacktestEquityRecord[], mode: ChartMode, chartPalette: LocalQuantChartPalette) {
  const sampledRows = sampleRows(rows, MAX_CHART_POINTS);
  return sampledRows
    .map((row, index) => {
      const value = getValue(sampledRows, row, index, mode);
      const dailyPnl = index === 0 ? 0 : row.equity - sampledRows[index - 1].equity;
      const time = toChartTime(row.trade_date, index);
      const point =
        mode === '日盈亏'
          ? ({
              time,
              value,
              color: value >= 0 ? chartPalette.positiveBar : chartPalette.negativeBar,
            } satisfies HistogramData<UTCTimestamp>)
          : ({
              time,
              value,
            } satisfies LineData<UTCTimestamp>);
      return { date: row.trade_date, point, value, dailyPnl, raw: row };
    })
    .sort((left, right) => Number(left.point.time) - Number(right.point.time));
}

function sampleRows(rows: BacktestEquityRecord[], maxPoints: number) {
  if (rows.length <= maxPoints) return rows;
  const criticalDates = getCriticalDates(rows);
  const step = Math.max(Math.floor(rows.length / Math.max(maxPoints - criticalDates.size, 1)), 1);
  const sampled = rows.filter((row, index) => index === 0 || index === rows.length - 1 || criticalDates.has(row.trade_date) || index % step === 0);
  if (sampled.length <= maxPoints) return sampled;
  const criticalRows = sampled.filter((row) => criticalDates.has(row.trade_date) || row === rows[0] || row === rows[rows.length - 1]);
  const regularRows = sampled.filter((row) => !criticalRows.includes(row));
  const regularLimit = Math.max(maxPoints - criticalRows.length, 0);
  const regularStep = Math.max(Math.ceil(regularRows.length / Math.max(regularLimit, 1)), 1);
  const limited = [...criticalRows, ...regularRows.filter((_, index) => index % regularStep === 0).slice(0, regularLimit)]
    .sort((left, right) => rows.indexOf(left) - rows.indexOf(right));
  if (!limited.includes(rows[rows.length - 1])) {
    limited[limited.length - 1] = rows[rows.length - 1];
  }
  return limited;
}

function getCriticalDates(rows: BacktestEquityRecord[]) {
  if (rows.length === 0) return new Set<string>();
  const highestEquity = rows.reduce((best, row) => (row.equity > best.equity ? row : best), rows[0]);
  const lowestEquity = rows.reduce((best, row) => (row.equity < best.equity ? row : best), rows[0]);
  const maxDrawdown = rows.reduce((best, row) => (Math.abs(row.drawdown) > Math.abs(best.drawdown) ? row : best), rows[0]);
  const drawdownRange = buildMaxDrawdownRange(rows);
  return new Set([
    rows[0].trade_date,
    rows[rows.length - 1].trade_date,
    highestEquity.trade_date,
    lowestEquity.trade_date,
    maxDrawdown.trade_date,
    drawdownRange?.start.date,
    drawdownRange?.trough.date,
    drawdownRange?.recovery?.date,
  ].filter(Boolean) as string[]);
}

function getValue(rows: BacktestEquityRecord[], row: BacktestEquityRecord, index: number, mode: ChartMode) {
  if (mode === '回撤曲线') return row.drawdown;
  if (mode === '日盈亏') return index === 0 ? 0 : row.equity - rows[index - 1].equity;
  return row.equity;
}

function buildHighlightPoints(rows: BacktestEquityRecord[], drawdownRange: MaxDrawdownRange | null): HighlightPoint[] {
  if (rows.length === 0) return [];
  const highestEquity = rows.reduce((best, row) => (row.equity > best.equity ? row : best), rows[0]);
  const lowestEquity = rows.reduce((best, row) => (row.equity < best.equity ? row : best), rows[0]);
  const maxDrawdown = drawdownRange?.trough ?? rows.reduce((best, row) => (Math.abs(row.drawdown) > Math.abs(best.drawdown) ? row : best), rows[0]);
  const maxDrawdownRow = 'trade_date' in maxDrawdown
    ? maxDrawdown
    : rows[Math.min(maxDrawdown.index, rows.length - 1)];
  const maxDrawdownDetail = drawdownRange
    ? `峰值 ${drawdownRange.start.date}，${drawdownRange.recovery ? `恢复 ${drawdownRange.recovery.date}` : '未恢复'}`
    : `权益 ${formatValue(maxDrawdownRow.equity, '资金曲线')}`;

  return [
    {
      key: 'highest-equity',
      label: '最高权益点',
      value: formatValue(highestEquity.equity, '资金曲线'),
      date: highestEquity.trade_date,
      detail: `现金 ${formatValue(highestEquity.cash, '资金曲线')}`,
      tone: 'blue',
      time: toChartTime(highestEquity.trade_date, 0),
      equity: highestEquity.equity,
      cash: highestEquity.cash,
      marketValue: highestEquity.market_value,
      drawdown: highestEquity.drawdown,
    },
    {
      key: 'lowest-equity',
      label: '最低权益点',
      value: formatValue(lowestEquity.equity, '资金曲线'),
      date: lowestEquity.trade_date,
      detail: `市值 ${formatValue(lowestEquity.market_value, '资金曲线')}`,
      tone: 'green',
      time: toChartTime(lowestEquity.trade_date, 0),
      equity: lowestEquity.equity,
      cash: lowestEquity.cash,
      marketValue: lowestEquity.market_value,
      drawdown: lowestEquity.drawdown,
    },
    {
      key: 'max-drawdown',
      label: '最大回撤低点',
      value: formatValue(drawdownRange?.drawdownPercent ?? maxDrawdownRow.drawdown, '回撤曲线'),
      date: maxDrawdownRow.trade_date,
      detail: maxDrawdownDetail,
      tone: 'orange',
      time: toChartTime(maxDrawdownRow.trade_date, 0),
      equity: maxDrawdownRow.equity,
      cash: maxDrawdownRow.cash,
      marketValue: maxDrawdownRow.market_value,
      drawdown: drawdownRange?.drawdownPercent ?? maxDrawdownRow.drawdown,
    },
  ];
}

function buildMaxDrawdownRange(rows: BacktestEquityRecord[]): MaxDrawdownRange | null {
  if (rows.length < 2) return null;
  const ordered = [...rows].sort((left, right) => left.trade_date.localeCompare(right.trade_date));
  let peakIndex = 0;
  let peak = ordered[0];
  let bestStartIndex = 0;
  let bestTroughIndex = 0;
  let bestDrawdownPercent = 0;

  ordered.forEach((row, index) => {
    if (row.equity >= peak.equity) {
      peak = row;
      peakIndex = index;
    }
    const drawdownPercent = peak.equity === 0 ? row.drawdown : ((row.equity - peak.equity) / peak.equity) * 100;
    if (drawdownPercent < bestDrawdownPercent) {
      bestDrawdownPercent = drawdownPercent;
      bestStartIndex = peakIndex;
      bestTroughIndex = index;
    }
  });

  const startRow = ordered[bestStartIndex];
  const troughRow = ordered[bestTroughIndex];
  if (!startRow || !troughRow || bestStartIndex === bestTroughIndex) return null;

  const recoveryIndex = ordered.findIndex((row, index) => index > bestTroughIndex && row.equity >= startRow.equity);
  const recoveryRow = recoveryIndex >= 0 ? ordered[recoveryIndex] : undefined;
  const makePoint = (label: string, row: BacktestEquityRecord, index: number): DrawdownRangePoint => ({
    label,
    date: row.trade_date,
    time: toChartTime(row.trade_date, index),
    equity: row.equity,
    drawdown: row.drawdown,
    index,
  });

  return {
    start: makePoint('峰值起点', startRow, bestStartIndex),
    trough: makePoint('回撤低点', troughRow, bestTroughIndex),
    recovery: recoveryRow ? makePoint('恢复点', recoveryRow, recoveryIndex) : undefined,
    drawdownPercent: bestDrawdownPercent,
    equityLoss: startRow.equity - troughRow.equity,
    daysToTrough: bestTroughIndex - bestStartIndex,
    daysToRecovery: recoveryIndex >= 0 ? recoveryIndex - bestStartIndex : undefined,
    recovered: Boolean(recoveryRow),
  };
}

function addEquityOverlays(
  series: ReturnType<ReturnType<typeof createChart>['addSeries']>,
  points: HighlightPoint[],
  drawdownRange: MaxDrawdownRange | null,
  chartPalette: LocalQuantChartPalette,
) {
  if (points.length === 0) return;
  const highest = points.find((item) => item.key === 'highest-equity');
  const lowest = points.find((item) => item.key === 'lowest-equity');
  const maxDrawdown = points.find((item) => item.key === 'max-drawdown');
  const markers: SeriesMarker<UTCTimestamp>[] = points.map((item) => ({
    id: item.key,
    time: item.time,
    position: item.key === 'lowest-equity' ? 'atPriceBottom' : 'atPriceTop',
    price: item.equity,
    shape: item.key === 'highest-equity' ? 'arrowUp' : item.key === 'lowest-equity' ? 'arrowDown' : 'circle',
    color: item.key === 'highest-equity' ? chartPalette.equity : item.key === 'lowest-equity' ? chartPalette.success : chartPalette.drawdown,
    text: item.key === 'highest-equity' ? '最高权益' : item.key === 'lowest-equity' ? '最低权益' : '最大回撤日',
    size: 1.18,
  }));
  if (drawdownRange) {
    markers.push({
      id: 'max-drawdown-start',
      time: drawdownRange.start.time,
      position: 'atPriceTop',
      price: drawdownRange.start.equity,
      shape: 'circle',
      color: chartPalette.drawdown,
      text: '回撤起点',
      size: 1.12,
    });
    if (drawdownRange.recovery) {
      markers.push({
        id: 'max-drawdown-recovery',
        time: drawdownRange.recovery.time,
        position: 'atPriceTop',
        price: drawdownRange.recovery.equity,
        shape: 'arrowUp',
        color: chartPalette.equityAccent,
        text: '回撤恢复',
        size: 1.12,
      });
    }
  }
  createSeriesMarkers(series, markers, { autoScale: true, zOrder: 'top' });
  if (highest) {
    series.createPriceLine({
      price: highest.equity,
      color: chartPalette.equity,
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: true,
      title: '最高权益',
    });
  }
  if (lowest && lowest.equity !== highest?.equity) {
    series.createPriceLine({
      price: lowest.equity,
      color: chartPalette.success,
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      axisLabelVisible: true,
      title: '最低权益',
    });
  }
  if (maxDrawdown && maxDrawdown.equity !== highest?.equity && maxDrawdown.equity !== lowest?.equity) {
    series.createPriceLine({
      price: maxDrawdown.equity,
      color: chartPalette.drawdown,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: '最大回撤日权益',
    });
  }
}

function addDrawdownOverlays(
  series: ReturnType<ReturnType<typeof createChart>['addSeries']>,
  points: HighlightPoint[],
  drawdownRange: MaxDrawdownRange | null,
  chartPalette: LocalQuantChartPalette,
) {
  const maxDrawdown = points.find((item) => item.key === 'max-drawdown');
  if (!maxDrawdown) return;
  const markers: SeriesMarker<UTCTimestamp>[] = [{
    id: 'max-drawdown',
    time: maxDrawdown.time,
    position: 'atPriceBottom',
    price: maxDrawdown.drawdown,
    shape: 'square',
    color: chartPalette.drawdown,
    text: '最大回撤',
    size: 1.25,
  }];
  if (drawdownRange) {
    markers.unshift({
      id: 'max-drawdown-start',
      time: drawdownRange.start.time,
      position: 'atPriceTop',
      price: drawdownRange.start.drawdown,
      shape: 'circle',
      color: chartPalette.drawdown,
      text: '回撤起点',
      size: 1.05,
    });
    if (drawdownRange.recovery) {
      markers.push({
        id: 'max-drawdown-recovery',
        time: drawdownRange.recovery.time,
        position: 'atPriceTop',
        price: drawdownRange.recovery.drawdown,
        shape: 'arrowUp',
        color: chartPalette.equityAccent,
        text: '恢复',
        size: 1.05,
      });
    }
  }
  createSeriesMarkers(series, markers, { autoScale: true, zOrder: 'top' });
  series.createPriceLine({
    price: maxDrawdown.drawdown,
    color: chartPalette.drawdown,
    lineWidth: 1,
    lineStyle: LineStyle.Dashed,
    axisLabelVisible: true,
    title: '最大回撤',
  });
}

function buildTradeMarkers(
  trades: BacktestTradeRecord[],
  sideFilter: TradeSideFilter,
  symbolFilter: string,
  pnlFilter: TradePnlFilter,
) {
  const ordered = [...trades].sort((left, right) => left.trade_time.localeCompare(right.trade_time));
  const filtered = ordered.filter((item) => {
    if (sideFilter === '买入' && item.side !== 'BUY') return false;
    if (sideFilter === '卖出' && item.side !== 'SELL') return false;
    if (symbolFilter !== ALL_TRADE_SYMBOLS && item.symbol !== symbolFilter) return false;
    if (pnlFilter !== '全部盈亏' && getTradePnlBucket(item) !== pnlFilter) return false;
    return true;
  });
  const buyCount = ordered.filter((item) => item.side === 'BUY').length;
  const sellCount = ordered.filter((item) => item.side === 'SELL').length;
  const limit = 10;
  return {
    total: ordered.length,
    filteredTotal: filtered.length,
    limit,
    buyCount,
    sellCount,
    items: filtered.slice(0, limit).map((item) => ({
      id: item.id,
      side: item.side,
      time: item.trade_time,
      symbol: item.symbol,
      name: item.name,
      price: formatValue(item.price, '资金曲线'),
      raw: item,
    })),
  };
}

function buildTradeSymbolOptions(trades: BacktestTradeRecord[]) {
  const counter = new Map<string, { symbol: string; name: string; count: number }>();
  for (const trade of trades) {
    const previous = counter.get(trade.symbol);
    counter.set(trade.symbol, {
      symbol: trade.symbol,
      name: previous?.name || trade.name,
      count: (previous?.count ?? 0) + 1,
    });
  }
  const options = [...counter.values()]
    .sort((left, right) => right.count - left.count || left.symbol.localeCompare(right.symbol))
    .map((item) => ({
      label: `${item.symbol}${item.name ? ` / ${item.name}` : ''} (${item.count})`,
      value: item.symbol,
    }));
  return [{ label: `全部股票 (${trades.length})`, value: ALL_TRADE_SYMBOLS }, ...options];
}

function getTradePnlBucket(trade: BacktestTradeRecord): Exclude<TradePnlFilter, '全部盈亏'> {
  if (trade.pnl > 0) return '盈利';
  if (trade.pnl < 0) return '亏损';
  return '持平';
}

function buildChartSummary(rows: BacktestEquityRecord[], trades: BacktestTradeRecord[], drawdownRange: MaxDrawdownRange | null) {
  if (rows.length === 0) return [];
  const first = rows[0];
  const last = rows[rows.length - 1];
  const netChange = last.equity - first.equity;
  const maxDrawdown = rows.reduce((best, row) => (Math.abs(row.drawdown) > Math.abs(best.drawdown) ? row : best), rows[0]);
  const drawdownValue = drawdownRange?.drawdownPercent ?? maxDrawdown.drawdown;
  const drawdownLabel = drawdownRange
    ? `${drawdownRange.start.date} → ${drawdownRange.trough.date} / ${formatValue(drawdownValue, '回撤曲线')}`
    : `${maxDrawdown.trade_date} / ${formatValue(drawdownValue, '回撤曲线')}`;
  return [
    { label: '区间', value: `${first.trade_date} ~ ${last.trade_date}`, tone: 'blue' },
    { label: '权益变化', value: formatValue(netChange, '资金曲线'), tone: netChange >= 0 ? 'red' : 'green' },
    { label: '最大回撤区间', value: drawdownLabel, tone: 'orange' },
    { label: '买卖点', value: `${trades.length} 条`, tone: 'neutral' },
  ];
}

function buildHoverState(item: ReturnType<typeof buildSeries>[number], mode: ChartMode): ChartHoverState {
  return {
    date: item.date,
    metrics: [
      { label: mode === '日盈亏' ? '日盈亏' : '当前值', value: formatValue(item.value, mode), tone: item.value >= 0 ? 'red' : 'green' },
      { label: '权益', value: formatValue(item.raw.equity, '资金曲线'), tone: 'blue' },
      { label: '现金', value: formatValue(item.raw.cash, '资金曲线'), tone: 'neutral' },
      { label: '持仓市值', value: formatValue(item.raw.market_value, '资金曲线'), tone: 'blue' },
      { label: '回撤', value: formatValue(item.raw.drawdown, '回撤曲线'), tone: 'orange' },
      { label: '当日变化', value: formatValue(item.dailyPnl, '资金曲线'), tone: item.dailyPnl >= 0 ? 'red' : 'green' },
    ],
  };
}

function buildHoverStateFromEquityRecord(record: BacktestEquityRecord, rows: BacktestEquityRecord[], mode: ChartMode): ChartHoverState {
  const dailyPnl = getEquityDailyPnl(rows, record);
  const rowIndex = Math.max(rows.findIndex((item) => item.trade_date === record.trade_date), 0);
  const value = getValue(rows, record, rowIndex, mode);
  return {
    date: record.trade_date,
    metrics: [
      { label: mode === '日盈亏' ? '日盈亏' : '当前值', value: formatValue(value, mode), tone: value >= 0 ? 'red' : 'green' },
      { label: '权益', value: formatValue(record.equity, '资金曲线'), tone: 'blue' },
      { label: '现金', value: formatValue(record.cash, '资金曲线'), tone: 'neutral' },
      { label: '持仓市值', value: formatValue(record.market_value, '资金曲线'), tone: 'blue' },
      { label: '回撤', value: formatValue(record.drawdown, '回撤曲线'), tone: 'orange' },
      { label: '当日变化', value: formatValue(dailyPnl, '资金曲线'), tone: dailyPnl >= 0 ? 'red' : 'green' },
    ],
  };
}

function getEquityDailyPnl(rows: BacktestEquityRecord[], record: BacktestEquityRecord) {
  const index = rows.findIndex((item) => item.trade_date === record.trade_date);
  if (index <= 0) return 0;
  return record.equity - rows[index - 1].equity;
}

function buildHoverStateFromHighlightPoint(point: HighlightPoint): ChartHoverState {
  return {
    date: point.date,
    metrics: [
      { label: '定位点', value: point.label, tone: point.tone },
      { label: '权益', value: formatValue(point.equity, '资金曲线'), tone: 'blue' },
      { label: '现金', value: formatValue(point.cash, '资金曲线'), tone: 'neutral' },
      { label: '持仓市值', value: formatValue(point.marketValue, '资金曲线'), tone: 'blue' },
      { label: '回撤', value: formatValue(point.drawdown, '回撤曲线'), tone: 'orange' },
      { label: '说明', value: point.detail, tone: 'neutral' },
    ],
  };
}

function buildHoverStateFromTrade(trade: BacktestTradeRecord): ChartHoverState {
  return {
    date: trade.trade_time,
    metrics: [
      { label: '成交方向', value: formatSideLabel(trade.side), tone: trade.side === 'BUY' ? 'red' : 'green' },
      { label: '股票', value: trade.symbol, tone: 'blue' },
      { label: '成交价', value: formatValue(trade.price, '资金曲线'), tone: 'neutral' },
      { label: '成交数量', value: formatCount(trade.quantity), tone: 'neutral' },
      { label: '成交金额', value: formatValue(trade.amount, '资金曲线'), tone: 'blue' },
      { label: '盈亏', value: formatValue(trade.pnl, '资金曲线'), tone: trade.pnl >= 0 ? 'red' : 'green' },
    ],
  };
}

function buildEmptyHoverMetrics(): ChartHoverMetric[] {
  return [
    { label: '当前值', value: '--', tone: 'neutral' },
    { label: '权益', value: '--', tone: 'blue' },
    { label: '现金', value: '--', tone: 'neutral' },
    { label: '持仓市值', value: '--', tone: 'blue' },
    { label: '回撤', value: '--', tone: 'orange' },
    { label: '当日变化', value: '--', tone: 'neutral' },
  ];
}

function toChartTime(value: string, index: number): UTCTimestamp {
  const parsed = Math.floor(Date.parse(`${value}T00:00:00+08:00`) / 1000);
  return (Number.isFinite(parsed) ? parsed : 1_700_000_000 + index) as UTCTimestamp;
}

function formatSideLabel(value: string) {
  return value === 'BUY' ? '买入' : value === 'SELL' ? '卖出' : value;
}

function formatStockLabel(symbol: string, name?: string | null) {
  return name ? `${symbol} / ${name}` : symbol;
}

function formatCount(value: number) {
  return Number.isFinite(value) ? value.toLocaleString('zh-CN') : '--';
}

function formatValue(value: number, mode: ChartMode) {
  if (mode === '回撤曲线') return `${value.toFixed(2)}%`;
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
