import { MoreOutlined, LinkOutlined } from '@ant-design/icons';
import { Button, Space, Typography } from 'antd';
import type { ReactNode } from 'react';
import './Workspace.css';

interface WorkspacePanelProps {
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
  showWindowTools?: boolean;
}

export default function WorkspacePanel({ title, description, status, extra, children, className, showWindowTools = false }: WorkspacePanelProps) {
  return (
    <section className={['workspace-panel', className].filter(Boolean).join(' ')}>
      <header className="workspace-panel__header">
        <div className="workspace-panel__title-block">
          <Space size={6} className="workspace-panel__title-line">
            {status ? <span className="workspace-panel__status">{status}</span> : null}
            <Typography.Text className="workspace-panel__title">{title}</Typography.Text>
          </Space>
          {description ? <Typography.Text className="workspace-panel__description">{description}</Typography.Text> : null}
        </div>
        <Space size={4} className="workspace-panel__tools">
          {extra}
          {showWindowTools ? (
            <>
              <Button size="small" type="text" icon={<LinkOutlined />} aria-label="联动窗口" title="联动窗口" />
              <Button size="small" type="text" icon={<MoreOutlined />} aria-label="更多面板操作" title="更多面板操作" />
            </>
          ) : null}
        </Space>
      </header>
      <div className="workspace-panel__body">{children}</div>
    </section>
  );
}
