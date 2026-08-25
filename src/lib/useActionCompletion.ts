import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Standard behaviour for "I did that, now get out of my way".
 *
 * A finished recommendation should confirm briefly and then leave the list. Keeping
 * completed cards around greys out rows the user can no longer act on, so a list
 * they are working down keeps growing instead of shrinking — the opposite of the
 * feedback a cleanup task should give.
 *
 * Every panel that actions items uses this so the timing and wording match, rather
 * than each inventing its own.
 */

const CONFIRM_MS = 1400;

/** What an action actually achieved, so the confirmation can say more than "done". */
export interface ActionImpact {
  messages?: number;
  bytes?: number;
  /** e.g. "kept out of your inbox from now on" — the lasting effect, not the count. */
  effect?: string;
}

export interface CompletionState {
  /** Item finished and is showing its confirmation. */
  isCompleting: (id: string) => boolean;
  /** Item has finished confirming and should no longer be rendered. */
  isCleared: (id: string) => boolean;
  /** Filters a list down to what the user can still act on. */
  visible: <T extends { id: string }>(items: T[]) => T[];
  /** Confirmation text, e.g. "Filed 42". */
  labelFor: (id: string) => string | undefined;
  impactFor: (id: string) => ActionImpact | undefined;
  complete: (id: string, label?: string, impact?: ActionImpact) => void;
  /** Number cleared so far, for a running total. */
  clearedCount: number;
  /** Everything this session's actions have achieved, for a summary line. */
  totalImpact: ActionImpact;
}

export function useActionCompletion(confirmMs: number = CONFIRM_MS): CompletionState {
  const [completing, setCompleting] = useState<Map<string, string>>(new Map());
  const [impacts, setImpacts] = useState<Map<string, ActionImpact>>(new Map());
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const timers = useRef<number[]>([]);

  // Panels unmount on navigation; a pending timer firing into a dead component is a
  // React warning at best and a stale write at worst.
  useEffect(() => {
    const pending = timers.current;
    return () => { pending.forEach(t => clearTimeout(t)); };
  }, []);

  const complete = useCallback((id: string, label: string = 'Done', impact?: ActionImpact) => {
    setCompleting(prev => new Map(prev).set(id, label));
    if (impact) setImpacts(prev => new Map(prev).set(id, impact));
    const timer = window.setTimeout(() => {
      setCleared(prev => new Set(prev).add(id));
      setCompleting(prev => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    }, confirmMs);
    timers.current.push(timer);
  }, [confirmMs]);

  // Running total across everything actioned in this session.
  const totalImpact: ActionImpact = { messages: 0, bytes: 0 };
  impacts.forEach(i => {
    totalImpact.messages = (totalImpact.messages || 0) + (i.messages || 0);
    totalImpact.bytes = (totalImpact.bytes || 0) + (i.bytes || 0);
  });

  return {
    isCompleting: (id: string) => completing.has(id),
    isCleared: (id: string) => cleared.has(id),
    visible: <T extends { id: string }>(items: T[]) => items.filter(i => !cleared.has(i.id)),
    labelFor: (id: string) => completing.get(id),
    impactFor: (id: string) => impacts.get(id),
    complete,
    clearedCount: cleared.size,
    totalImpact,
  };
}
