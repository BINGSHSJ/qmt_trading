import type { ReactNode } from 'react';
import WorkspacePanel from './WorkspacePanel';
import './Workspace.css';

interface WorkbenchPaneProps {
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
  dense?: boolean;
  scroll?: boolean;
  testId?: string;
}

export default function WorkbenchPane({
  title,
  description,
  status,
  extra,
  children,
  className,
  dense = false,
  scroll = true,
  testId,
}: WorkbenchPaneProps) {
  return (
    <div
      className={[
        'workbench-pane',
        dense ? 'workbench-pane--dense' : '',
        scroll ? 'workbench-pane--scroll' : 'workbench-pane--static',
        className,
      ].filter(Boolean).join(' ')}
      data-testid={testId}
    >
      <WorkspacePanel title={title} description={description} status={status} extra={extra}>
        {children}
      </WorkspacePanel>
    </div>
  );
}
