import type { CSSProperties, ReactNode } from 'react';
import MetricCard from '../MetricCard';
import './Workspace.css';

export interface MetricStripItem {
  label: string;
  value: ReactNode;
  subValue?: ReactNode;
  icon?: ReactNode;
  footer?: ReactNode;
  loading?: boolean;
  tone?: 'default' | 'red' | 'green' | 'blue' | 'orange' | 'neutral';
  accent?: boolean;
}

interface MetricStripProps {
  items: MetricStripItem[];
  minItemWidth?: number;
  className?: string;
  testId?: string;
}

export default function MetricStrip({ items, minItemWidth = 168, className, testId }: MetricStripProps) {
  return (
    <div
      className={['metric-strip', className].filter(Boolean).join(' ')}
      style={{ '--metric-strip-min': `${minItemWidth}px` } as CSSProperties}
      data-testid={testId}
    >
      {items.map((item, index) => (
        <MetricCard
          key={`${item.label}-${index}`}
          label={item.label}
          value={item.value}
          subValue={item.subValue}
          icon={item.icon}
          footer={item.footer}
          loading={item.loading}
          tone={item.tone}
          accent={item.accent}
        />
      ))}
    </div>
  );
}
