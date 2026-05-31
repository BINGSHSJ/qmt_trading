import { Card, Space } from 'antd';
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  createChart,
  type CandlestickData,
  type HistogramData,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DailyKline, MinuteKline } from '../../types/dataCenter';
import EmptyGuide from '../EmptyGuide';
import { useThemeMode } from '../../theme/ThemeModeContext';
import { getLocalQuantChartPalette, type LocalQuantChartPalette } from '../../theme/chartTheme';
import './KLineChart.css';

interface KLineChartProps {
  rows: Array<DailyKline | MinuteKline>;
  title: string;
  height?: number;
  framed?: boolean;
}

interface KLineHoverMetric {
  label: string;
  value: string;
  tone?: 'price' | 'volume' | 'neutral';
}

interface KLineHoverState {
  label: string;
  metrics: KLineHoverMetric[];
  idle?: boolean;
}

const idleHoverState: KLineHoverState = {
  label: '悬停查看 OHLC',
  idle: true,
  metrics: [
    { label: '开盘', value: '--', tone: 'price' },
    { label: '最高', value: '--', tone: 'price' },
    { label: '最低', value: '--', tone: 'price' },
    { label: '收盘', value: '--', tone: 'price' },
    { label: '成交量', value: '--', tone: 'volume' },
  ],
};

export default function KLineChart({ rows, title, height = 260, framed = true }: KLineChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoverState, setHoverState] = useState<KLineHoverState>(idleHoverState);
  const { mode: themeMode } = useThemeMode();
  const chartTheme = useMemo(() => getLocalQuantChartPalette(themeMode), [themeMode]);
  const data = useMemo(() => normalizeKline(rows, chartTheme), [chartTheme, rows]);

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;
    const chart = createChart(containerRef.current, {
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
      timeScale: { borderColor: chartTheme.border, timeVisible: title.includes('分钟') },
      crosshair: { horzLine: { labelBackgroundColor: chartTheme.crosshair }, vertLine: { labelBackgroundColor: chartTheme.crosshair } },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: chartTheme.profit,
      downColor: chartTheme.loss,
      borderUpColor: chartTheme.profit,
      borderDownColor: chartTheme.loss,
      wickUpColor: chartTheme.profit,
      wickDownColor: chartTheme.loss,
    });
    candleSeries.setData(data.map((item) => item.candle));

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      color: chartTheme.muted,
    });
    volumeSeries.setData(data.map((item) => item.volume));
    chart.priceScale('').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chart.timeScale().fitContent();

    chart.subscribeCrosshairMove((param) => {
      if (!param.time) {
        setHoverState(idleHoverState);
        return;
      }
      const item = data.find((entry) => entry.candle.time === param.time);
      if (!item) return;
      setHoverState({
        label: item.label,
        metrics: [
          { label: '开盘', value: item.raw.open.toFixed(2), tone: 'price' },
          { label: '最高', value: item.raw.high.toFixed(2), tone: 'price' },
          { label: '最低', value: item.raw.low.toFixed(2), tone: 'price' },
          { label: '收盘', value: item.raw.close.toFixed(2), tone: 'price' },
          { label: '成交量', value: Math.round(item.raw.volume).toLocaleString('zh-CN'), tone: 'volume' },
        ],
      });
    });

    const resizeObserver = new ResizeObserver(([entry]) => {
      chart.applyOptions({ width: Math.floor(entry.contentRect.width) });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [chartTheme, data, height, title]);

  if (data.length === 0) {
    const emptyContent = (
      <div className="kline-chart kline-chart--empty">
        <EmptyGuide description="暂无 K 线数据，请先在数据中心同步对应周期，并确认查询区间内有行情。" />
      </div>
    );
    return framed ? (
      <Card className="kline-chart-card" title={title}>
        {emptyContent}
      </Card>
    ) : emptyContent;
  }

  const chartContent = (
    <Space className="kline-chart" direction="vertical" size={8} style={{ width: '100%' }}>
      <div className="kline-chart__canvas" ref={containerRef} style={{ width: '100%', height }} />
      <div className={`kline-chart-hover-strip ${hoverState.idle ? 'kline-chart-hover-strip--idle' : ''}`} aria-label="K线悬停信息">
        <div className="kline-chart-hover-strip__head">
          <span>{hoverState.label}</span>
          <small>{title.includes('分钟') ? '分钟K' : '日K'}</small>
        </div>
        <div className="kline-chart-hover-strip__grid">
          {hoverState.metrics.map((item) => (
            <div className={`kline-chart-hover-strip__cell kline-chart-hover-strip__cell--${item.tone ?? 'neutral'}`} key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </div>
    </Space>
  );

  return framed ? (
    <Card className="kline-chart-card" title={title}>
      {chartContent}
    </Card>
  ) : chartContent;
}

function normalizeKline(rows: Array<DailyKline | MinuteKline>, chartTheme: LocalQuantChartPalette) {
  const seen = new Set<number>();
  return rows
    .map((row, index) => {
      const label = 'trade_date' in row ? row.trade_date : row.datetime;
      return {
        raw: row,
        label,
        time: toChartTime(label, index),
      };
    })
    .sort((left, right) => left.time - right.time)
    .filter((item) => {
      if (seen.has(item.time)) return false;
      seen.add(item.time);
      return true;
    })
    .map((item) => {
      const candle: CandlestickData<UTCTimestamp> = {
        time: item.time as UTCTimestamp,
        open: item.raw.open,
        high: item.raw.high,
        low: item.raw.low,
        close: item.raw.close,
      };
      const volume: HistogramData<UTCTimestamp> = {
        time: item.time as UTCTimestamp,
        value: item.raw.volume,
        color: item.raw.close >= item.raw.open ? chartTheme.volumeUp : chartTheme.volumeDown,
      };
      return { ...item, candle, volume };
    });
}

function toChartTime(value: string, index: number): UTCTimestamp {
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const withTimezone = normalized.length === 10 || !/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized) ? `${normalized}${normalized.length === 10 ? 'T00:00:00' : ''}+08:00` : normalized;
  const parsed = Math.floor(Date.parse(withTimezone) / 1000);
  return (Number.isFinite(parsed) ? parsed : 1_700_000_000 + index) as UTCTimestamp;
}
