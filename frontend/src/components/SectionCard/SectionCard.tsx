import { Card, Space, Typography } from 'antd';
import type { ReactNode } from 'react';
import './SectionCard.css';

interface SectionCardProps {
  title: ReactNode;
  description?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
}

export default function SectionCard({ title, description, extra, children, className }: SectionCardProps) {
  return (
    <Card
      className={['section-card', className].filter(Boolean).join(' ')}
      title={
        <Space direction="vertical" size={2}>
          <Typography.Text strong className="section-card__title">
            {title}
          </Typography.Text>
          {description ? (
            <Typography.Text type="secondary" className="section-card__description">
              {description}
            </Typography.Text>
          ) : null}
        </Space>
      }
      extra={extra}
    >
      {children}
    </Card>
  );
}
