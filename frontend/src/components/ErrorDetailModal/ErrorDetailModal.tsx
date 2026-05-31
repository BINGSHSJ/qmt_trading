import { Modal } from 'antd';
import type { ApiError } from '../../types/api';
import ErrorPanel from '../ErrorPanel';
import './ErrorDetailModal.css';

interface ErrorDetailModalProps {
  open: boolean;
  message: string;
  error?: ApiError | null;
  traceId?: string;
  onClose: () => void;
}

export default function ErrorDetailModal({ open, message, error, traceId, onClose }: ErrorDetailModalProps) {
  return (
    <Modal
      className="error-detail-modal"
      title="错误详情"
      open={open}
      onCancel={onClose}
      footer={null}
      width={720}
      centered
      maskClosable={false}
      data-testid="modal-error-detail"
    >
      <ErrorPanel
        message={message}
        code={error?.code}
        traceId={traceId}
        suggestion={error?.suggestion ?? undefined}
        technicalDetail={error?.detail ?? undefined}
      />
    </Modal>
  );
}
