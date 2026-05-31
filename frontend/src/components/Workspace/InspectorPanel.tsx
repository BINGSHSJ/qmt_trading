import { Button, Space, Tag, Typography } from 'antd';
import { CloseOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';
import './Workspace.css';

export interface InspectorPanelField {
  label: ReactNode;
  value: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  span?: 1 | 2;
}

export interface InspectorPanelSection {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  dense?: boolean;
  testId?: string;
}

interface InspectorPanelProps {
  title: ReactNode;
  subtitle?: ReactNode;
  status?: ReactNode;
  fields?: InspectorPanelField[];
  sections?: InspectorPanelSection[];
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  onClose?: () => void;
  testId?: string;
}

const toneClass = {
  neutral: 'inspector-panel__field--neutral',
  success: 'inspector-panel__field--success',
  warning: 'inspector-panel__field--warning',
  danger: 'inspector-panel__field--danger',
  info: 'inspector-panel__field--info',
} as const;

export default function InspectorPanel({
  title,
  subtitle,
  status,
  fields = [],
  sections = [],
  actions,
  children,
  className,
  onClose,
  testId,
}: InspectorPanelProps) {
  const hasBody = Boolean(children || sections.length > 0);

  return (
    <section className={['inspector-panel', !hasBody ? 'inspector-panel--empty' : '', className].filter(Boolean).join(' ')} data-testid={testId} data-workbench-role="inspector">
      <header className="inspector-panel__header">
        <div className="inspector-panel__title-block">
          <Space size={6} wrap className="inspector-panel__title-row">
            <Typography.Text strong className="inspector-panel__title">{title}</Typography.Text>
            {status ? <Tag className="inspector-panel__status">{status}</Tag> : null}
          </Space>
          {subtitle ? <Typography.Text type="secondary" className="inspector-panel__subtitle">{subtitle}</Typography.Text> : null}
        </div>
        {onClose ? <Button aria-label="关闭检查器" title="关闭检查器" size="small" type="text" icon={<CloseOutlined />} onClick={onClose} /> : null}
      </header>
      {fields.length > 0 ? (
        <div className="inspector-panel__fields">
          {fields.map((field, index) => (
            <div
              key={index}
              className={[
                'inspector-panel__field',
                field.span === 2 ? 'inspector-panel__field--wide' : '',
                toneClass[field.tone ?? 'neutral'],
              ].filter(Boolean).join(' ')}
            >
              <Typography.Text type="secondary" className="inspector-panel__field-label">{field.label}</Typography.Text>
              <Typography.Text strong className="inspector-panel__field-value">{field.value}</Typography.Text>
            </div>
          ))}
        </div>
      ) : null}
      {hasBody ? (
        <div className="inspector-panel__body">
          {sections.map((section, index) => (
            <section
              key={section.testId ?? index}
              className={['inspector-panel__section', section.dense ? 'inspector-panel__section--dense' : ''].filter(Boolean).join(' ')}
              data-testid={section.testId}
            >
              {section.title || section.description ? (
                <header className="inspector-panel__section-head">
                  {section.title ? <Typography.Text strong>{section.title}</Typography.Text> : null}
                  {section.description ? <Typography.Text type="secondary">{section.description}</Typography.Text> : null}
                </header>
              ) : null}
              <div className="inspector-panel__section-body">{section.children}</div>
            </section>
          ))}
          {children}
        </div>
      ) : null}
      {actions ? <footer className="inspector-panel__actions">{actions}</footer> : null}
    </section>
  );
}
