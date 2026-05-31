import type { ReactNode } from 'react';
import PageHeaderBar from '../PageHeaderBar';
import './Workspace.css';

interface WorkbenchPageProps {
  title?: string;
  description?: string;
  updatedAt?: string;
  loading?: boolean;
  onRefresh?: () => void | Promise<void>;
  extra?: ReactNode;
  secondaryActions?: ReactNode;
  primaryAction?: {
    label: string;
    testId: string;
    disabled?: boolean;
    onClick: () => void;
  };
  commandBar?: ReactNode;
  metrics?: ReactNode;
  children: ReactNode;
  inspector?: ReactNode;
  className?: string;
  testId?: string;
}

export default function WorkbenchPage({
  title,
  description,
  updatedAt = '暂无',
  loading,
  onRefresh,
  extra,
  secondaryActions,
  primaryAction,
  commandBar,
  metrics,
  children,
  inspector,
  className,
  testId,
}: WorkbenchPageProps) {
  const showHeader = Boolean(title && description && onRefresh);

  return (
    <section className={['workbench-page', className].filter(Boolean).join(' ')} data-testid={testId}>
      {showHeader && title && description && onRefresh ? (
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
      ) : null}
      {commandBar ? <div className="workbench-page__command">{commandBar}</div> : null}
      {metrics ? <div className="workbench-page__metrics">{metrics}</div> : null}
      <div className={['workbench-page__body', inspector ? 'workbench-page__body--with-inspector' : ''].filter(Boolean).join(' ')}>
        <main className="workbench-page__main">{children}</main>
        {inspector ? <aside className="workbench-page__inspector">{inspector}</aside> : null}
      </div>
    </section>
  );
}
