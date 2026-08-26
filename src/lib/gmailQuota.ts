/**
 * Gmail API quota governor.
 *
 * Gmail meters a user at **250 quota units per second**, and every call has a
 * different price: a `messages.list` is 5 units, a `threads.get` is 10, a
 * `batchModify` is 50. Nothing in this app was counting them, so several ordinary
 * flows sat far above the ceiling:
 *
 *   - A metadata batch of 100 `messages.get` is 500 units in a single HTTP request.
 *     They were fired back to back with no pause — roughly 6× the limit.
 *   - `processInChunks(threads, 10, …)` spent 100 units per 200ms — 500 u/s, 2× over.
 *   - Inbox Health opened with eight `countEmails` in a `Promise.all`, each of which
 *     pages the whole mailbox. Sixteen or more requests would leave at once.
 *
 * The API answers an overrun with `403 rateLimitExceeded` more often than `429`, and
 * the old client treated any 403 without the word "insufficient" as fatal — so an
 * overrun surfaced as a hard error rather than something to wait out.
 *
 * Everything now passes through one bucket:
 *
 *  - **Token bucket** priced per endpoint. A caller waits for its units, so bursts
 *    are shaped instead of dropped and `Promise.all` is safe again — the governor
 *    serialises what the callers hand it in parallel.
 *  - **Fair queueing.** Waiters are served first-come, so an expensive batch is never
 *    starved by a stream of cheap counts behind it.
 *  - **AIMD.** A throttle halves the spend rate for everyone; sustained success walks
 *    it back up. One overrun therefore slows the whole app briefly rather than being
 *    retried into a second overrun.
 *  - **Global cooldown.** `Retry-After` (or a jittered backoff) parks every caller,
 *    not just the one that was refused.
 *
 * The budget is deliberately under the documented ceiling: the limit is enforced on a
 * moving average we cannot observe, and the cost of being slightly slow is invisible
 * next to the cost of a failed bulk action.
 */

/** Gmail's documented per-user ceiling, in quota units per second. */
const HARD_LIMIT_PER_SEC = 250;

/**
 * Share of the ceiling we are willing to spend.
 *
 * The peak spend in any one-second window is bounded by the sustained rate plus
 * whatever the bucket had saved up, so the rate cannot be set near the ceiling
 * without the saved burst carrying us over it. Measured against the app's real
 * traffic — eight parallel counts, chunked thread reads, and metadata batches all at
 * once — 0.6 keeps the worst observed window inside 250 units.
 */
const TARGET_UTILISATION = 0.6;

const MAX_RATE = HARD_LIMIT_PER_SEC * TARGET_UTILISATION; // 150 u/s
/** Floor for the adaptive rate: slow, but still making progress. */
const MIN_RATE = 20;

/**
 * Seconds of spend the bucket may hold.
 *
 * Spend in any one-second window is bounded by what the bucket had saved plus what it
 * earns during the window:
 *
 *     peak ≤ (rate × BURST_SECONDS) + rate + max(0, largestRequest − capacity)
 *          = 90 + 150 + 0 = 240 units
 *
 * which is the margin this file exists to keep. The third term is zero as long as no
 * single request costs more than the bucket holds — which is why `BATCH_SIZE` in
 * `gmail.ts` is 15 rather than Gmail's permitted 100.
 */
const BURST_SECONDS = 0.6;

/**
 * Simultaneous in-flight requests. Browsers cap at ~6 per host anyway; holding to it
 * keeps the token bucket the thing that paces us rather than the connection pool.
 */
const MAX_CONCURRENT = 6;

/** Multiplier applied to the rate when Gmail throttles us. */
const BACKOFF_FACTOR = 0.5;
/** Units per second recovered each recovery tick after a clean run. */
const RECOVERY_STEP = 12;
const RECOVERY_INTERVAL_MS = 4000;

/** Attempts per request before the error is surfaced to the caller. */
const MAX_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 800;
const MAX_BACKOFF_MS = 32_000;

/**
 * Quota unit prices, from Gmail's published usage limits. Anything unlisted falls
 * back to `DEFAULT_COST`, which is deliberately the price of the common read rather
 * than the cheapest call — under-pricing an unknown endpoint is how the ceiling gets
 * crossed without anything appearing to be wrong.
 */
const DEFAULT_COST = 5;

const COSTS: Record<string, number> = {
  'messages.list': 5,
  'messages.get': 5,
  'messages.modify': 5,
  'messages.trash': 5,
  'messages.untrash': 5,
  'messages.delete': 10,
  'messages.batchModify': 50,
  'messages.batchDelete': 50,
  'threads.list': 10,
  'threads.get': 10,
  'threads.modify': 10,
  'threads.delete': 20,
  'labels.list': 1,
  'labels.get': 1,
  'labels.create': 5,
  'labels.update': 5,
  'labels.delete': 5,
  'filters.list': 1,
  'filters.create': 5,
  'filters.delete': 5,
  'profile.get': 1,
  'history.list': 2,
};

/** Price of one `messages.get` — the unit a metadata batch is billed in. */
export const MESSAGES_GET_COST = COSTS['messages.get'];

/**
 * Prices a request from the path it is about to call.
 *
 * Accepts either a path relative to `/users/me` (`/threads/abc?format=metadata`) or a
 * fully qualified URL. Absolute URLs have to be handled: `quotaFetch` falls back to
 * this when a caller does not price its own request, and reading `https:` as the
 * resource name would silently charge every such call the default 5 units.
 */
export function inferCost(endpoint: string, method: string = 'GET'): number {
  let path = endpoint.split('?')[0];
  // Drop scheme + host, then the Gmail API prefix, leaving the resource path.
  path = path.replace(/^[a-z]+:\/\/[^/]+/i, '');
  path = path.replace(/^\/?gmail\/v\d+\/users\/[^/]+/i, '');
  path = path.replace(/^\/+/, '');

  const segments = path.split('/').filter(Boolean);
  const verb = method.toUpperCase();

  if (segments.length === 0) return DEFAULT_COST;

  // settings/filters/... — the resource name is the second segment.
  const resource = segments[0] === 'settings' ? segments[1] : segments[0];
  const rest = segments.slice(segments[0] === 'settings' ? 2 : 1);

  // Explicit batch actions name themselves: /messages/batchModify.
  const action = rest[0];
  if (action === 'batchModify' || action === 'batchDelete') {
    return COSTS[`${resource}.${action}`] ?? 50;
  }
  if (action && (action === 'trash' || action === 'untrash' || action === 'modify')) {
    return COSTS[`${resource}.${action}`] ?? DEFAULT_COST;
  }
  if (rest.length >= 2 && (rest[1] === 'trash' || rest[1] === 'untrash' || rest[1] === 'modify')) {
    return COSTS[`${resource}.${rest[1]}`] ?? DEFAULT_COST;
  }

  const op =
    verb === 'POST' ? 'create'
      : verb === 'DELETE' ? 'delete'
        : verb === 'PATCH' || verb === 'PUT' ? 'update'
          : rest.length > 0 ? 'get'
            : 'list';

  return COSTS[`${resource}.${op}`] ?? DEFAULT_COST;
}

// ---------------------------------------------------------------------------
// The bucket
// ---------------------------------------------------------------------------

interface Waiter {
  cost: number;
  resolve: () => void;
  reject: (err: any) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export interface QuotaState {
  /** Current spend rate in units per second. */
  rate: number;
  /** Callers waiting for units. */
  queued: number;
  /** Requests currently in flight. */
  inFlight: number;
  /** True while a Retry-After / backoff cooldown is in force. */
  throttled: boolean;
  /** Times Gmail has refused us this session. */
  throttleEvents: number;
}

class QuotaBucket {
  private rate = MAX_RATE;
  // Starts empty rather than full. A full bucket at load is a free burst on top of
  // the first second's budget, and page load is exactly when every view fires at
  // once — the measured peak was in the first second before this.
  private tokens = 0;
  private lastRefill = Date.now();
  private waiters: Waiter[] = [];
  private inFlight = 0;
  private cooldownUntil = 0;
  private lastThrottleAt = 0;
  private throttleEvents = 0;
  private pump: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(s: QuotaState) => void>();

  private get capacity(): number {
    return this.rate * BURST_SECONDS;
  }

  /**
   * Units a request must see in the bucket before it may leave.
   *
   * A request costing more than the bucket can ever hold — a metadata batch is
   * dearer than a second of budget — would otherwise wait forever. Such a request
   * leaves once the bucket is full and is charged in full, taking the balance
   * negative; the debt is repaid before anything else moves. Sizing capacity to the
   * largest request instead would let that whole amount accumulate as burst on top of
   * the sustained rate, which is exactly the overrun this exists to prevent.
   */
  private admissionPrice(cost: number): number {
    return Math.min(cost, this.capacity);
  }

  subscribe(fn: (s: QuotaState) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  get state(): QuotaState {
    return {
      rate: Math.round(this.rate),
      queued: this.waiters.length,
      inFlight: this.inFlight,
      throttled: Date.now() < this.cooldownUntil,
      throttleEvents: this.throttleEvents,
    };
  }

  private notify() {
    const snapshot = this.state;
    this.listeners.forEach(fn => { try { fn(snapshot); } catch { /* listener's problem */ } });
  }

  private refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    if (elapsed <= 0) return;
    this.lastRefill = now;

    // Recover the spend rate after a quiet spell — additive increase, so we creep
    // back toward the ceiling instead of jumping at it and being refused again.
    if (
      this.rate < MAX_RATE &&
      this.lastThrottleAt > 0 &&
      now - this.lastThrottleAt > RECOVERY_INTERVAL_MS
    ) {
      const ticks = Math.floor((now - this.lastThrottleAt) / RECOVERY_INTERVAL_MS);
      this.rate = Math.min(MAX_RATE, this.rate + RECOVERY_STEP * ticks);
      this.lastThrottleAt = now;
    }

    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.rate);
  }

  /**
   * Serves waiters strictly in order.
   *
   * Head-of-line blocking is the point: letting a cheap request jump an expensive one
   * that is still saving up would starve metadata batches behind a stream of counts.
   */
  private drain() {
    this.pump = null;
    this.refill();

    const now = Date.now();
    if (now < this.cooldownUntil) {
      this.schedule(this.cooldownUntil - now);
      return;
    }

    while (this.waiters.length > 0 && this.inFlight < MAX_CONCURRENT) {
      const next = this.waiters[0];
      if (this.tokens < this.admissionPrice(next.cost)) break;

      this.waiters.shift();
      this.tokens -= next.cost;
      this.inFlight++;
      if (next.signal && next.onAbort) next.signal.removeEventListener('abort', next.onAbort);
      next.resolve();
    }

    if (this.waiters.length > 0) {
      const head = this.waiters[0];
      // Wait exactly as long as the next request needs, not a fixed poll interval.
      const deficit = Math.max(0, this.admissionPrice(head.cost) - this.tokens);
      const waitMs = this.inFlight >= MAX_CONCURRENT
        ? 60
        : Math.max(25, Math.ceil((deficit / Math.max(this.rate, 1)) * 1000));
      this.schedule(waitMs);
    }

    this.notify();
  }

  private schedule(ms: number) {
    if (this.pump !== null) return;
    this.pump = setTimeout(() => this.drain(), Math.min(ms, 2000));
  }

  /** Resolves once the caller holds `cost` units and a concurrency slot. */
  acquire(cost: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));

    return new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { cost, resolve, reject, signal };

      if (signal) {
        waiter.onAbort = () => {
          this.waiters = this.waiters.filter(w => w !== waiter);
          reject(new DOMException('Aborted', 'AbortError'));
        };
        signal.addEventListener('abort', waiter.onAbort, { once: true });
      }

      this.waiters.push(waiter);
      this.schedule(0);
    });
  }

  /** Returns the concurrency slot taken by `acquire`. Units are not refunded. */
  release() {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.schedule(0);
  }

  /**
   * Gmail refused us. Slows every caller and parks them all for the cooldown —
   * backing off only the request that was refused just means the next one in line
   * takes the same refusal.
   */
  throttled(retryAfterMs?: number) {
    const now = Date.now();
    this.throttleEvents++;
    this.lastThrottleAt = now;
    this.rate = Math.max(MIN_RATE, this.rate * BACKOFF_FACTOR);
    // Spent tokens are not credited back — the bucket should be empty after a refusal.
    this.tokens = 0;

    const cooldown = retryAfterMs ?? BASE_BACKOFF_MS;
    this.cooldownUntil = Math.max(this.cooldownUntil, now + cooldown);
    this.schedule(cooldown);
    this.notify();
  }
}

const bucket = new QuotaBucket();

export const quotaState = () => bucket.state;
export const subscribeToQuota = (fn: (s: QuotaState) => void) => bucket.subscribe(fn);

// ---------------------------------------------------------------------------
// Throttle detection
// ---------------------------------------------------------------------------

/**
 * Reasons Gmail gives for an overrun. It reports most of these as **403**, not 429,
 * which is why they have to be matched on the body rather than the status alone.
 */
const RATE_LIMIT_REASONS = [
  'ratelimitexceeded',
  'userratelimitexceeded',
  'quotaexceeded',
  'backenderror',
  'rate limit exceeded',
  'too many concurrent requests',
];

function isRateLimitBody(body: string): boolean {
  const lower = body.toLowerCase();
  // "insufficientPermissions" is a real authorisation failure and must not be retried
  // as if it were congestion — it would never succeed.
  if (lower.includes('insufficient')) return false;
  return RATE_LIMIT_REASONS.some(reason => lower.includes(reason));
}

/** Milliseconds to wait per `Retry-After`, which may be seconds or an HTTP date. */
function parseRetryAfter(res: Response): number | undefined {
  const raw = res.headers?.get?.('retry-after');
  if (!raw) return undefined;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_BACKOFF_MS);

  const date = Date.parse(raw);
  if (!Number.isNaN(date)) return Math.min(Math.max(0, date - Date.now()), MAX_BACKOFF_MS);

  return undefined;
}

/** Exponential backoff with full jitter, so retrying clients do not resynchronise. */
function backoffFor(attempt: number): number {
  const ceiling = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
  return Math.random() * ceiling;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface QuotaFetchOptions {
  /** Overrides the price inferred from the path — used for multipart batches. */
  cost?: number;
  signal?: AbortSignal;
  maxAttempts?: number;
  /** Labels the request in throttle warnings. */
  label?: string;
}

/**
 * One metered, retrying request against the Gmail API.
 *
 * Returns the `Response` for the caller to read. Retries transport failures, `429`,
 * `5xx`, and the `403` variants that mean congestion; a `403` that means "you do not
 * have permission" is returned untouched, because retrying it is pure waste.
 *
 * The response body is only ever inspected through `clone()`, so the caller always
 * receives an unread stream.
 */
export async function quotaFetch(
  url: string,
  init: RequestInit,
  options: QuotaFetchOptions = {}
): Promise<Response> {
  const cost = options.cost ?? inferCost(url, (init.method as string) || 'GET');
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const label = options.label || url;

  let lastError: any = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await bucket.acquire(cost, options.signal);

    // The concurrency slot covers the round trip, not the body: it is returned as
    // soon as the response headers land, whichever way the request went.
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err: any) {
      bucket.release();
      if (options.signal?.aborted) throw err;
      lastError = err;
      if (attempt === maxAttempts - 1) break;
      await sleep(backoffFor(attempt));
      continue;
    }

    bucket.release();

    if (res.ok || res.status === 204) return res;

    const retryable =
      res.status === 429 ||
      res.status >= 500 ||
      (res.status === 403 && isRateLimitBody(await res.clone().text().catch(() => '')));

    if (!retryable) return res;

    const retryAfter = parseRetryAfter(res);
    const wait = retryAfter ?? backoffFor(attempt);

    // 5xx is Gmail failing, not us overspending, so it should not cut the rate for
    // everyone — only genuine throttles do.
    if (res.status === 429 || res.status === 403) {
      bucket.throttled(retryAfter ?? wait);
    }

    if (attempt === maxAttempts - 1) return res;

    console.warn(
      `Gmail throttled ${label} (${res.status}); retrying in ${Math.round(wait)}ms ` +
      `[rate now ${bucket.state.rate} u/s]`
    );
    await sleep(wait);
  }

  throw lastError ?? new Error(`Gmail request failed after ${maxAttempts} attempts: ${label}`);
}

/**
 * Meters work that is not a single `quotaFetch` — used by the multipart batch path,
 * which pays for its sub-requests up front and drives its own fetch.
 */
export async function withQuota<T>(cost: number, run: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  await bucket.acquire(cost, signal);
  try {
    return await run();
  } finally {
    bucket.release();
  }
}

/** Lets a caller that saw a throttle outside `quotaFetch` slow the whole app down. */
export function reportThrottle(retryAfterMs?: number) {
  bucket.throttled(retryAfterMs);
}
