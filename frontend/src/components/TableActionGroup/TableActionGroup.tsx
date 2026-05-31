import { Space } from 'antd';
import type { ReactNode } from 'react';
import DangerActionMenu, { type DangerAction } from '../DangerActionMenu';
import './TableActionGroup.css';

interface TableActionGroupProps {
  primary?: ReactNode;
  actions?: DangerAction[];
  moreLabel?: string;
}

export default function TableActionGroup({ primary, actions = [], moreLabel = '更多' }: TableActionGroupProps) {
  return (
    <Space size={6} className="table-action-group">
      {primary ? <span className="table-action-group__primary">{primary}</span> : null}
      {actions.length > 0 ? <DangerActionMenu label={moreLabel} actions={actions} /> : null}
    </Space>
  );
}
