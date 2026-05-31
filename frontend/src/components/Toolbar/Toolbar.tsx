import { Button, Space, Typography } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import DataFreshnessTag from '../DataFreshnessTag';
import './Toolbar.css';

const MIN_REFRESH_LOADING_MS = 300;

interface ToolbarProps {
  title?: ReactNode;
  description?: ReactNode;
  updatedAt?: string | null;
  loading?: boolean;
  onRefresh?: () => void | Promise<void>;
  left?: ReactNode;
  right?: ReactNode;
}

export default function Toolbar({ title, description, updatedAt, loading, onRefresh, left, right }: ToolbarProps) {
  const [refreshing, setRefreshing] = useState(false);
  const refreshTimerRef = useRef<number | null>(null);
  const refreshLoading = Boolean(loading || refreshing);

  useEffect(() => () => {
    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current);
    }
  }, []);

  const handleRefresh = useCallback(() => {
    if (!onRefresh || refreshLoading) return;
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
    <div className="toolbar">
      <Space direction="vertical" size={2} className="toolbar__copy">
        {title ? <Typography.Text strong>{title}</Typography.Text> : null}
        {description ? <Typography.Text type="secondary">{description}</Typography.Text> : null}
        {left}
      </Space>
      <Space wrap className="toolbar__actions">
        {updatedAt !== undefined ? <DataFreshnessTag updatedAt={updatedAt} loading={refreshLoading} /> : null}
        {right}
        {onRefresh ? (
          <Button aria-label="刷新当前列表" title="刷新当前列表" icon={<ReloadOutlined />} loading={refreshLoading} disabled={refreshLoading} onClick={handleRefresh}>
            刷新
          </Button>
        ) : null}
      </Space>
    </div>
  );
}
