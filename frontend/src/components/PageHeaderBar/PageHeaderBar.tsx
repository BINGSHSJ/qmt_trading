import { Button, Space, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

const MIN_REFRESH_LOADING_MS = 300;

interface PageHeaderBarProps {
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

export default function PageHeaderBar({
  title,
  description,
  updatedAt,
  loading,
  onRefresh,
  extra,
  secondaryActions,
  primaryAction,
}: PageHeaderBarProps) {
  const [refreshing, setRefreshing] = useState(false);
  const refreshTimerRef = useRef<number | null>(null);
  const refreshLoading = Boolean(loading || refreshing);

  useEffect(() => () => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }
  }, []);

  const handleRefresh = useCallback(() => {
    if (refreshLoading) return;
    const startedAt = Date.now();
    const finish = () => {
      const delay = Math.max(0, MIN_REFRESH_LOADING_MS - (Date.now() - startedAt));
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        setRefreshing(false);
      }, delay);
    };
    setRefreshing(true);
    try {
      void Promise.resolve(onRefresh()).catch(() => undefined).finally(finish);
    } catch {
      finish();
    }
  }, [onRefresh, refreshLoading]);

  return (
    <section className="page-header-panel">
      <div className="page-header-main">
        <div className="page-header-copy">
          <Typography.Title level={3} className="page-header-title">
            {title}
          </Typography.Title>
          <Typography.Text className="page-header-description">{description}</Typography.Text>
        </div>
        <Space className="page-header-actions">
          {extra ? <span className="page-header-actions__status">{extra}</span> : null}
          {secondaryActions ? <span className="page-header-actions__secondary">{secondaryActions}</span> : null}
          {primaryAction ? (
            <Button
              type="primary"
              data-testid={primaryAction.testId}
              disabled={primaryAction.disabled}
              aria-label={primaryAction.label}
              title={primaryAction.label}
              onClick={primaryAction.onClick}
            >
              {primaryAction.label}
            </Button>
          ) : null}
          <Button aria-label="刷新当前页面数据" title="刷新当前页面数据" icon={<ReloadOutlined />} loading={refreshLoading} disabled={refreshLoading} onClick={handleRefresh} data-testid="btn-refresh">
            刷新
          </Button>
        </Space>
      </div>
      <div className="page-header-meta">
        <Typography.Text type="secondary">最近更新时间：{updatedAt}</Typography.Text>
      </div>
    </section>
  );
}
