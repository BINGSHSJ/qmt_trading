import { DeleteOutlined, LoadingOutlined, MoreOutlined, RollbackOutlined } from '@ant-design/icons';
import { Button, Dropdown } from 'antd';
import type { MenuProps } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface DangerAction {
  key: string;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  type?: 'restore' | 'delete';
  onClick: () => void | Promise<void>;
}

interface DangerActionMenuProps {
  actions: DangerAction[];
  label?: string;
}

export default function DangerActionMenu({ actions, label = '更多' }: DangerActionMenuProps) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const items: MenuProps['items'] = useMemo(() => actions.map((action) => {
    const busy = busyKey === action.key;
    return {
      key: action.key,
      label: action.label,
      danger: action.danger,
      disabled: Boolean(action.disabled || busyKey),
      icon: busy ? <LoadingOutlined /> : action.type === 'delete' ? <DeleteOutlined /> : action.type === 'restore' ? <RollbackOutlined /> : undefined,
    };
  }), [actions, busyKey]);

  const handleClick: NonNullable<MenuProps['onClick']> = useCallback(({ key, domEvent }) => {
    domEvent.stopPropagation();
    if (busyKey) return;
    const action = actions.find((item) => item.key === key);
    if (!action || action.disabled) return;
    const finish = () => {
      if (mountedRef.current) {
        setBusyKey(null);
      }
    };
    try {
      const result = action.onClick();
      if (isNativePromiseLike(result)) {
        setBusyKey(String(key));
        void result.finally(finish);
      }
    } catch (error) {
      finish();
      throw error;
    }
  }, [actions, busyKey]);

  return (
    <Dropdown
      autoAdjustOverflow={false}
      destroyOnHidden
      getPopupContainer={(triggerNode) => triggerNode.parentElement ?? document.body}
      menu={{
        items,
        onClick: handleClick,
      }}
      overlayClassName="danger-action-menu__overlay"
      placement="bottomRight"
      transitionName=""
      trigger={['click']}
    >
      <Button aria-label={label} title={label} size="small" icon={busyKey ? <LoadingOutlined /> : <MoreOutlined />} loading={Boolean(busyKey)} disabled={Boolean(busyKey)} onClick={(event) => event.stopPropagation()}>
        {label}
      </Button>
    </Dropdown>
  );
}

function isNativePromiseLike(value: unknown): value is Promise<unknown> {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as Promise<unknown>).then === 'function'
    && typeof (value as Promise<unknown>).finally === 'function',
  );
}
