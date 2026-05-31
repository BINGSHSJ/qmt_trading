import { Card, Skeleton, Typography } from 'antd';
import type { ReactNode } from 'react';
import './MetricCard.css';

type MetricTone = 'default' | 'red' | 'green' | 'blue' | 'orange' | 'neutral';

interface MetricCardProps {
  label: string;
  value: ReactNode;
  subValue?: ReactNode;
  icon?: ReactNode;
  footer?: ReactNode;
  loading?: boolean;
  tone?: MetricTone;
  accent?: boolean;
}

const toneColor: Record<MetricTone, string | undefined> = {
  default: undefined,
  red: 'var(--lqc-profit-a)',
  green: 'var(--lqc-loss-a)',
  blue: 'var(--lqc-primary)',
  orange: 'var(--lqc-warning)',
  neutral: 'var(--lqc-text-primary)',
};

export default function MetricCard({ label, value, subValue, icon, footer, loading = false, tone = 'default', accent = false }: MetricCardProps) {
  const className = ['metric-card', `metric-card--${tone}`, accent ? 'metric-card--accent' : ''].filter(Boolean).join(' ');

  return (
    <Card size="small" className={className}>
      {loading ? (
        <Skeleton active paragraph={false} title={{ width: '80%' }} />
      ) : (
        <>
          <div className="metric-card__topline">
            <Typography.Text type="secondary" className="metric-card-label">
              {label}
            </Typography.Text>
            {icon ? <span className="metric-card__icon">{icon}</span> : null}
          </div>
          <Typography.Title level={4} className="metric-card-value" style={{ color: toneColor[tone] }}>
            {value}
          </Typography.Title>
          {subValue ? (
            <Typography.Text type="secondary" className="metric-card-subvalue">
              {subValue}
            </Typography.Text>
          ) : null}
          {footer ? <div className="metric-card__footer">{footer}</div> : null}
        </>
      )}
    </Card>
  );
}
