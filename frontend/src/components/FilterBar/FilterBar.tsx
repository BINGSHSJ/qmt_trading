import { Space } from 'antd';
import type { ReactNode } from 'react';
import './FilterBar.css';

interface FilterBarProps {
  children?: ReactNode;
  right?: ReactNode;
  className?: string;
  ariaLabel?: string;
}

export default function FilterBar({ children, right, className, ariaLabel = '列表筛选条件' }: FilterBarProps) {
  if (!children && !right) return null;

  return (
    <div className={['filter-bar', className].filter(Boolean).join(' ')} aria-label={ariaLabel}>
      <Space wrap className="filter-bar__main">
        {children}
      </Space>
      {right ? (
        <Space wrap className="filter-bar__right">
          {right}
        </Space>
      ) : null}
    </div>
  );
}
