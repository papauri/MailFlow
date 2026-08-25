/**
 * Background work scheduler.
 *
 * Analysis in this app is bounded by what one blocking fetch can reasonably load, so
 * a category holding thousands of messages gets judged on a few hundred. Rather than
 * make the user wait longer up front, work continues quietly after the page is
 * usable and the findings sharpen as more arrives.
 *
 * Everything here is deliberately conservative, because this is unattended work
 * against someone's real mailbox on their quota:
 *
 *  - One task at a time, never parallel. Quota is shared with whatever the user is
 *    actively doing, and their click must always win.
 *  - Paused whenever the tab is hidden. Nobody should be spending API budget on a
 *    tab they forgot about.
 *  - A deliberate gap between steps, and idle time preferred, so it never competes
 *    with rendering.
 *  - Every task is abortable and is dropped on unmount.
 *  - Failures back off and then give up rather than retrying forever.
 */

export interface BackgroundTask {
  id: string;
  label: string;
  /** Lower runs first. */
  priority: number;
  /** Perform one unit of work. Return true if there is more to do. */
  step: (signal: AbortSignal) => Promise<boolean>;
}

interface Running {
  task: BackgroundTask;
  controller: AbortController;
}

const STEP_GAP_MS = 1200;
const MAX_CONSECUTIVE_FAILURES = 3;

class BackgroundScheduler {
  private queue: BackgroundTask[] = [];
  private current: Running | null = null;
  private timer: number | null = null;
  private failures = new Map<string, number>();
  private listeners = new Set<() => void>();
  private activeLabel: string | null = null;

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') this.kick();
        else this.pause();
      });
    }
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private notify() {
    this.listeners.forEach(fn => fn());
  }

  /** Human-readable description of what is running, or null when idle. */
  get status(): string | null {
    return this.activeLabel;
  }

  add(task: BackgroundTask) {
    if (this.queue.some(t => t.id === task.id) || this.current?.task.id === task.id) return;
    this.queue.push(task);
    this.queue.sort((a, b) => a.priority - b.priority);
    this.kick();
  }

  remove(id: string) {
    this.queue = this.queue.filter(t => t.id !== id);
    if (this.current?.task.id === id) {
      this.current.controller.abort();
      this.current = null;
      this.activeLabel = null;
      this.notify();
    }
  }

  private pause() {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private kick() {
    if (this.timer !== null || this.current) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    if (this.queue.length === 0) return;

    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.runNext();
    }, STEP_GAP_MS);
  }

  private runNext() {
    if (this.current || this.queue.length === 0) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

    const task = this.queue[0];
    const controller = new AbortController();
    this.current = { task, controller };
    this.activeLabel = task.label;
    this.notify();

    const finish = (hasMore: boolean, failed: boolean) => {
      this.current = null;
      this.activeLabel = null;

      if (failed) {
        const count = (this.failures.get(task.id) || 0) + 1;
        this.failures.set(task.id, count);
        // Something is persistently wrong — stop rather than burn quota on retries.
        if (count >= MAX_CONSECUTIVE_FAILURES) {
          this.queue = this.queue.filter(t => t.id !== task.id);
        }
      } else {
        this.failures.delete(task.id);
        if (!hasMore) this.queue = this.queue.filter(t => t.id !== task.id);
      }

      this.notify();
      this.kick();
    };

    const start = () => {
      task.step(controller.signal)
        .then(hasMore => {
          if (controller.signal.aborted) { finish(false, false); return; }
          finish(hasMore, false);
        })
        .catch(() => {
          if (controller.signal.aborted) { finish(false, false); return; }
          finish(true, true);
        });
    };

    // Prefer genuine idle time so background work never competes with a render.
    const ric = (window as any).requestIdleCallback;
    if (typeof ric === 'function') ric(start, { timeout: 2000 });
    else start();
  }
}

export const backgroundScheduler = new BackgroundScheduler();
