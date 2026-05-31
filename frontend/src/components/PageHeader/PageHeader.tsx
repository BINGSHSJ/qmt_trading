import type { ReactNode } from 'react';
import PageHeaderBar from '../PageHeaderBar';

interface PageHeaderProps {
  title: string;
  description: string;
  updatedAt: string;
  loading?: boolean;
  onRefresh: () => void | Promise<void>;
  extra?: ReactNode;
  secondaryActions?: ReactNode;
  primaryAction?: {
    label: string;
    testId: string;
    disabled?: boolean;
    onClick: () => void;
  };
}

export default function PageHeader({
  title,
  description,
  updatedAt,
  loading,
  onRefresh,
  extra,
  secondaryActions,
  primaryAction,
}: PageHeaderProps) {
  return (
    <PageHeaderBar
      title={title}
      description={description}
      updatedAt={updatedAt}
      loading={loading}
      onRefresh={onRefresh}
      extra={extra}
      secondaryActions={secondaryActions}
      primaryAction={primaryAction}
    />
  );
}
