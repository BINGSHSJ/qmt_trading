import type { ReactNode } from 'react';
import './Workspace.css';

interface WorkspaceGridProps {
  children: ReactNode;
  layout?: 'two-column' | 'three-column' | 'trading' | 'research';
  className?: string;
}

export default function WorkspaceGrid({ children, layout = 'three-column', className }: WorkspaceGridProps) {
  return <div className={['workspace-grid', `workspace-grid--${layout}`, className].filter(Boolean).join(' ')}>{children}</div>;
}
