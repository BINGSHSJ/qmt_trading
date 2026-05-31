import type { ReactNode } from 'react';
import './WorkbenchNav.css';

export type WorkbenchNavTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface WorkbenchNavItem<Key extends string> {
  key: Key;
  title: ReactNode;
  description: ReactNode;
  tone?: WorkbenchNavTone;
  badge?: ReactNode;
}

interface WorkbenchNavProps<Key extends string> {
  ariaLabel: string;
  items: WorkbenchNavItem<Key>[];
  activeKey: Key;
  onChange: (key: Key) => void;
}

export default function WorkbenchNav<Key extends string>({ ariaLabel, items, activeKey, onChange }: WorkbenchNavProps<Key>) {
  return (
    <section className="workbench-nav" aria-label={ariaLabel}>
      {items.map((item, index) => {
        const tone = item.tone ?? 'neutral';
        const active = item.key === activeKey;
        return (
          <button
            type="button"
            key={item.key}
            className={`workbench-nav__item workbench-nav__item--${tone}${active ? ' workbench-nav__item--active' : ''}`}
            onClick={() => onChange(item.key)}
          >
            <span className="workbench-nav__index">{String(index + 1).padStart(2, '0')}</span>
            <span className="workbench-nav__copy">
              <strong>{item.title}</strong>
              <span>{item.description}</span>
            </span>
            {item.badge ? <span className="workbench-nav__badge">{item.badge}</span> : null}
          </button>
        );
      })}
    </section>
  );
}
