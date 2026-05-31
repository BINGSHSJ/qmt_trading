import type { ReactNode } from 'react';

export type StatusChipTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

interface StatusChipProps {
  label: string;
  value: ReactNode;
  tone?: StatusChipTone;
  testId?: string;
}

export default function StatusChip({ label, value, tone = 'neutral', testId }: StatusChipProps) {
  return (
    <span className={`status-chip status-chip--${tone}`} data-testid={testId}>
      <span className="status-chip__dot" />
      <span className="status-chip__label">{label}</span>
      <span className="status-chip__value">{value}</span>
    </span>
  );
}
