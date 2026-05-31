import { Space, Typography } from 'antd';
import type { ReactNode } from 'react';
import './CommandPanel.css';

export type CommandPanelTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface CommandPanelItem {
  label: ReactNode;
  value: ReactNode;
  helper?: ReactNode;
  tone?: CommandPanelTone;
}

interface CommandPanelProps {
  eyebrow: string;
  title: ReactNode;
  description: ReactNode;
  items: CommandPanelItem[];
  actions?: ReactNode;
  className?: string;
  dataTestId?: string;
}

export default function CommandPanel({ eyebrow, title, description, items, actions, className, dataTestId }: CommandPanelProps) {
  return (
    <section className={['command-panel', className].filter(Boolean).join(' ')} data-testid={dataTestId}>
      <div className="command-panel__copy">
        <Typography.Text className="command-panel__eyebrow">{eyebrow}</Typography.Text>
        <Typography.Title level={4} className="command-panel__title">
          {title}
        </Typography.Title>
        <Typography.Text className="command-panel__description">{description}</Typography.Text>
        {actions ? (
          <Space wrap size={8} className="command-panel__actions">
            {actions}
          </Space>
        ) : null}
      </div>
      <div className="command-panel__items">
        {items.map((item, index) => (
          <div className={`command-panel__item command-panel__item--${item.tone ?? 'neutral'}`} key={index}>
            <Typography.Text className="command-panel__item-label">{item.label}</Typography.Text>
            <strong className="command-panel__item-value">{item.value}</strong>
            {item.helper ? <span className="command-panel__item-helper">{item.helper}</span> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
