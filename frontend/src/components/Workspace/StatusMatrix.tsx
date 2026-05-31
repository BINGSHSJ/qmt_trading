import { Typography } from 'antd';
import type { ReactNode } from 'react';
import './Workspace.css';

export interface StatusMatrixItem {
  label: ReactNode;
  value: ReactNode;
  helper?: ReactNode;
  index?: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
}

interface StatusMatrixProps {
  items: StatusMatrixItem[];
  className?: string;
  testId?: string;
}

const toneClass = {
  neutral: 'status-matrix__item--neutral',
  success: 'status-matrix__item--success',
  warning: 'status-matrix__item--warning',
  danger: 'status-matrix__item--danger',
  info: 'status-matrix__item--info',
} as const;

export default function StatusMatrix({ items, className, testId }: StatusMatrixProps) {
  return (
    <div className={['status-matrix', className].filter(Boolean).join(' ')} data-testid={testId}>
      {items.map((item, index) => (
        <div key={index} className={['status-matrix__item', toneClass[item.tone ?? 'neutral']].join(' ')}>
          <span className="status-matrix__index">{item.index ?? String(index + 1).padStart(2, '0')}</span>
          <span className="status-matrix__copy">
            <Typography.Text strong className="status-matrix__label">{item.label}</Typography.Text>
            <Typography.Text type="secondary" className="status-matrix__value">{item.value}</Typography.Text>
            {item.helper ? <Typography.Text type="secondary" className="status-matrix__helper">{item.helper}</Typography.Text> : null}
          </span>
        </div>
      ))}
    </div>
  );
}
