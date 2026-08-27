/**
 * The shared stale-while-revalidate cache, driven through a real React render.
 *
 * Every number on the Inbox Health page — the score card, the recommendations, the
 * sender clusters — reads from this cache, so a staleness bug here shows up as
 * "the cards do not update" everywhere at once, which is exactly what happened.
 * The bug was invisible to any test that called the module directly: it lived in
 * the interaction between `notify` and React's effect scheduling, so it needs a
 * mounted component to catch.
 */
import './helpers/browserEnv';
import React from 'react';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost' });
(globalThis as any).window = dom.window as any;
(globalThis as any).document = dom.window.document;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const { useCachedResource, invalidateInboxCache, mutateCachedResource, clearInboxCache } =
  await import('../src/lib/useCachedResource');
const { createRoot } = await import('react-dom/client');
const { act } = await import('react');

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string, detail?: string) {
  if (condition) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.error(`  FAIL: ${label}${detail ? ` — ${detail}` : ''}`); }
}

console.log('=== Cached Resource — staleness and optimistic updates ===\n');

const settle = () => act(async () => { await new Promise(r => setTimeout(r, 30)); });

// ---------------------------------------------------------------------------
{
  let fetches = 0;
  function Probe() {
    const r = useCachedResource('probe', async () => { fetches++; return { n: fetches }; });
    return <span>{r.data ? String((r.data as any).n) : 'null'}</span>;
  }

  const container = dom.window.document.getElementById('root')!;
  const root = createRoot(container);

  await act(async () => { root.render(<Probe />); });
  assert(fetches === 1, 'A fresh key fetches once on mount', `fetches=${fetches}`);
  assert(container.textContent === '1', 'The fetched value renders', container.textContent || '');

  // The regression: invalidation marked entries stale and notified, which
  // re-rendered subscribers — but a re-render does not re-run the mount effect, so
  // nothing called revalidate and the view kept its old data until it unmounted.
  await act(async () => { invalidateInboxCache(); });
  await settle();
  assert(fetches === 2, 'Going stale while mounted triggers a refetch', `fetches=${fetches}`);
  assert(container.textContent === '2', 'The refetched value reaches the screen', container.textContent || '');

  // Idempotence: a stale entry must not spin. Several notifies in a row are one
  // refetch, because `inFlight` gates it and `stale` clears when the fetch settles.
  const before = fetches;
  await act(async () => { invalidateInboxCache(); invalidateInboxCache(); invalidateInboxCache(); });
  await settle();
  assert(fetches === before + 1, 'Repeated invalidation collapses into a single refetch',
    `fetches went ${before} -> ${fetches}`);

  // A settled entry is left alone; nothing should refetch on an ordinary re-render.
  const steady = fetches;
  await act(async () => { root.render(<Probe />); });
  await settle();
  assert(fetches === steady, 'A warm entry is not refetched on re-render', `fetches=${fetches}`);

  // Optimistic writes must reach the screen without a network round trip — this is
  // what makes an action feel instant before the revalidation lands.
  const beforeMutate = fetches;
  await act(async () => {
    mutateCachedResource<{ n: number }>('probe', prev => (prev ? { n: 99 } : prev));
  });
  assert(container.textContent === '99', 'An optimistic write renders immediately',
    container.textContent || '');
  assert(fetches === beforeMutate, 'An optimistic write costs no fetch', `fetches=${fetches}`);

  await act(async () => { root.unmount(); });
  clearInboxCache();
}

// ---------------------------------------------------------------------------
{
  // Two views on one key are one request, not two — the case that matters is the
  // Inbox Health page and the navbar widget mounting together.
  let fetches = 0;
  const fetcher = async () => { fetches++; return { v: fetches }; };
  function A() { const r = useCachedResource('shared', fetcher); return <i>{r.data ? 'a' : ''}</i>; }
  function B() { const r = useCachedResource('shared', fetcher); return <b>{r.data ? 'b' : ''}</b>; }

  const host = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(<><A /><B /></>); });
  await settle();
  assert(fetches === 1, 'Two views sharing a key cost one fetch', `fetches=${fetches}`);

  await act(async () => { invalidateInboxCache(); });
  await settle();
  assert(fetches === 2, 'Both views revalidate through a single shared request', `fetches=${fetches}`);

  await act(async () => { root.unmount(); });
  clearInboxCache();
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
