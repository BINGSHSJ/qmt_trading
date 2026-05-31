import './FinancialNumber.css';

type FinancialTone = 'neutral' | 'primary' | 'profit' | 'loss' | 'auto-pnl';

interface FinancialNumberProps {
  value?: number | null;
  precision?: number;
  suffix?: string;
  prefix?: string;
  tone?: FinancialTone;
  showSign?: boolean;
  compact?: boolean;
}

function formatValue(value: number, precision: number, compact: boolean) {
  const displayValue = compact && Math.abs(value) >= 10000 ? value / 10000 : value;
  return displayValue.toLocaleString('zh-CN', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

export default function FinancialNumber({
  value,
  precision = 2,
  suffix = '元',
  prefix = '',
  tone = 'neutral',
  showSign = false,
  compact = false,
}: FinancialNumberProps) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return <span className="financial-number financial-number--muted">暂无</span>;
  }

  const actualTone = tone === 'auto-pnl' ? (value >= 0 ? 'profit' : 'loss') : tone;
  const compactSuffix = compact && Math.abs(value) >= 10000 ? `万${suffix}` : suffix;
  const sign = showSign && value > 0 ? '+' : '';

  return (
    <span className={`financial-number financial-number--${actualTone}`}>
      {prefix}
      {sign}
      {formatValue(value, precision, compact)}
      {compactSuffix ? <span className="financial-number__suffix">{compactSuffix}</span> : null}
    </span>
  );
}
