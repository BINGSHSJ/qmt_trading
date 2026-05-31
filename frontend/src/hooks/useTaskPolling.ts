import { useEffect } from 'react';
import { RequestError } from '../services/request';
import { getTask } from '../services/system';
import type { RuntimeTaskRecord } from '../types/system';

const ACTIVE_STATUSES = new Set(['running', 'pending']);

interface UseTaskPollingOptions {
  task: RuntimeTaskRecord | null;
  onTaskChange: (task: RuntimeTaskRecord) => void;
  onFinished?: (task: RuntimeTaskRecord) => Promise<void> | void;
  onError?: (error: unknown) => void;
  intervalMs?: number;
}

export function useTaskPolling({ task, onTaskChange, onFinished, onError, intervalMs = 5000 }: UseTaskPollingOptions) {
  const taskId = task?.task_id;
  const taskStatus = task?.status;

  useEffect(() => {
    if (!taskId || !taskStatus || !ACTIVE_STATUSES.has(taskStatus)) return undefined;

    let disposed = false;
    let inFlight = false;
    let consecutiveErrors = 0;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const nextTask = await getTask(taskId);
        if (disposed) return;
        consecutiveErrors = 0;
        onTaskChange(nextTask);
        if (!ACTIVE_STATUSES.has(nextTask.status)) {
          await onFinished?.(nextTask);
        }
      } catch (error) {
        consecutiveErrors += 1;
        const isTransientNetworkError = error instanceof RequestError && error.apiError?.code === 'NETWORK_ERROR';
        if (!disposed && (!isTransientNetworkError || consecutiveErrors >= 3)) {
          onError?.(error);
        }
      } finally {
        inFlight = false;
      }
    };

    const timer = window.setInterval(() => {
      void poll();
    }, intervalMs);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [taskId, taskStatus, onTaskChange, onFinished, onError, intervalMs]);
}
