import type { ThemeMode } from './themeMode';

export interface LocalQuantChartPalette {
  background: string;
  text: string;
  muted: string;
  grid: string;
  border: string;
  crosshair: string;
  equity: string;
  equityAccent: string;
  drawdown: string;
  success: string;
  profit: string;
  loss: string;
  volumeUp: string;
  volumeDown: string;
  positiveBar: string;
  negativeBar: string;
}

const chartPalettes: Record<ThemeMode, LocalQuantChartPalette> = {
  dark: {
    background: '#11131b',
    text: '#d8dee9',
    muted: '#9aa8bc',
    grid: 'rgba(154, 168, 188, 0.14)',
    border: '#303746',
    crosshair: '#1e3a5f',
    equity: '#58a6ff',
    equityAccent: '#7bb8ff',
    drawdown: '#f59e0b',
    success: '#22c55e',
    profit: '#e11d48',
    loss: '#16a34a',
    volumeUp: 'rgba(225, 29, 72, 0.35)',
    volumeDown: 'rgba(22, 163, 74, 0.35)',
    positiveBar: 'rgba(255, 77, 109, 0.72)',
    negativeBar: 'rgba(34, 197, 94, 0.72)',
  },
  light: {
    background: '#ffffff',
    text: '#172033',
    muted: '#5f6f83',
    grid: 'rgba(95, 111, 131, 0.18)',
    border: '#c8d3e1',
    crosshair: '#dbeafe',
    equity: '#0a58ca',
    equityAccent: '#084db4',
    drawdown: '#b45309',
    success: '#0f7a3b',
    profit: '#c41543',
    loss: '#0f7a3b',
    volumeUp: 'rgba(196, 21, 67, 0.28)',
    volumeDown: 'rgba(15, 122, 59, 0.28)',
    positiveBar: 'rgba(196, 21, 67, 0.68)',
    negativeBar: 'rgba(15, 122, 59, 0.68)',
  },
};

export function getLocalQuantChartPalette(mode: ThemeMode): LocalQuantChartPalette {
  return chartPalettes[mode];
}
