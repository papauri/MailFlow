import { useEffect, useState } from 'react';
import { backgroundScheduler, BackgroundTask } from './backgroundWorker';

/**
 * Registers a background task for as long as the component is mounted.
 *
 * The task is removed and aborted on unmount, so navigating away stops the work
 * rather than leaving it running against a view nobody is looking at.
 */
export function useBackgroundTask(task: BackgroundTask | null) {
  useEffect(() => {
    if (!task) return;
    backgroundScheduler.add(task);
    return () => backgroundScheduler.remove(task.id);
    // Identity is the id: the step closure changes every render, and re-registering
    // on each one would restart the work continuously.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);
}

/** Current background activity, for an unobtrusive status line. */
export function useBackgroundStatus(): string | null {
  const [status, setStatus] = useState<string | null>(backgroundScheduler.status);
  useEffect(() => backgroundScheduler.subscribe(() => setStatus(backgroundScheduler.status)), []);
  return status;
}
