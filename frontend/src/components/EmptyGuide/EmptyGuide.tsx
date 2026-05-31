import { InboxOutlined } from '@ant-design/icons';
import { Typography } from 'antd';
import type { ReactNode } from 'react';
import './EmptyGuide.css';

interface EmptyGuideProps {
  description: string;
  title?: string;
  reason?: string;
  action?: ReactNode;
}

export default function EmptyGuide({ title = '暂无数据', description, reason, action }: EmptyGuideProps) {
  return (
    <div className="empty-guide" role="status" aria-label={title}>
      <span className="empty-guide__icon" aria-hidden="true">
        <InboxOutlined />
      </span>
      <div className="empty-guide__body">
        <Typography.Text strong className="empty-guide__title">{title}</Typography.Text>
        {reason ? <Typography.Text className="empty-guide__reason">{reason}</Typography.Text> : null}
        <Typography.Text type="secondary" className="empty-guide__description">{description}</Typography.Text>
        {action ? <div className="empty-guide__action">{action}</div> : null}
      </div>
    </div>
  );
}
