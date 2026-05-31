import type { ReactNode } from 'react';
import DetailDrawer from '../DetailDrawer';
import type { DetailDrawerField } from '../DetailDrawer';
import './LogDrawer.css';

export type LogDrawerField = DetailDrawerField;

interface LogDrawerProps {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  status?: ReactNode;
  statusTone?: string;
  message?: ReactNode;
  messageCopyText?: string;
  technicalDetail?: ReactNode;
  technicalCopyText?: string;
  fields?: LogDrawerField[];
  width?: number;
  fieldColumns?: number;
  className?: string;
  onClose: () => void;
}

export default function LogDrawer({
  open,
  title,
  subtitle,
  status,
  statusTone,
  message,
  messageCopyText,
  technicalDetail,
  technicalCopyText,
  fields = [],
  width = 720,
  fieldColumns = 2,
  className,
  onClose,
}: LogDrawerProps) {
  return (
    <DetailDrawer
      open={open}
      title={title}
      subtitle={subtitle}
      status={status}
      statusTone={statusTone}
      message={message}
      messageCopyText={messageCopyText}
      technicalDetail={technicalDetail}
      technicalCopyText={technicalCopyText}
      fields={fields}
      width={width}
      fieldColumns={fieldColumns}
      className={['log-drawer', className].filter(Boolean).join(' ')}
      onClose={onClose}
    />
  );
}
