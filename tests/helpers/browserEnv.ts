/**
 * Browser globals and a Gmail transport stub, for tests that need to run the real
 * code paths under Node.
 *
 * The suites in this directory used to assert on source-code substrings —
 * `gmailCode.includes('pages < 10')` — which proves only that a particular
 * character sequence exists in a file. That style breaks on every refactor while
 * catching no behavioural regression, and it cannot distinguish a working
 * implementation from a comment mentioning the same words.
 *
 * With these helpers a test can drive `countEmails`, `searchEmails` and the quota
 * governor for real against a scripted transport, and assert what they actually do.
 *
 * The globals are installed as a side effect of importing this module, not by a
 * call the test makes. ESM hoists every import and evaluates it before the first
 * statement of the importing file runs, so a call could never win the race:
 * `firebase.ts` reads its cached token from `sessionStorage` at module scope and
 * would already have seen nothing. Import this module first and the stub is in
 * place before any app module is evaluated.
 */

function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
  } as Storage;
}

/**
 * Installs localStorage/sessionStorage and seeds a Gmail access token.
 *
 * The token matters: `getAccessToken()` returns whatever was in sessionStorage when
 * firebase.ts was first evaluated, and `fetchGmailAPI` throws without one — so a
 * test that skips this measures the error path rather than the code it means to.
 */
export function installBrowserGlobals(accessToken = 'test-token') {
  const g = globalThis as any;
  if (typeof g.localStorage === 'undefined') g.localStorage = memoryStorage();
  if (typeof g.sessionStorage === 'undefined') g.sessionStorage = memoryStorage();
  g.sessionStorage.setItem('gmail_access_token', accessToken);
}

// Run on import, for the reason given in the module comment above.
installBrowserGlobals();

export interface StubRequest {
  url: string;
  method: string;
  /** Parsed `q` search param, when present. */
  query: string | null;
  /** Parsed `pageToken` search param, when present. */
  pageToken: string | null;
  body?: string;
}

export interface GmailStub {
  /** Every request the code under test issued, in order. */
  requests: StubRequest[];
  restore: () => void;
}

type Handler = (req: StubRequest) => { status?: number; body: any } | undefined;

/**
 * Replaces global fetch with a scripted Gmail transport.
 *
 * `handler` returns the payload for a request, or undefined to fall through to an
 * empty result. Anything the handler does not model comes back as `{}` rather than
 * throwing, so a test asserts on the one behaviour it cares about without having to
 * script the whole API surface.
 */
export function stubGmail(handler: Handler): GmailStub {
  const g = globalThis as any;
  const original = g.fetch;
  const requests: StubRequest[] = [];

  g.fetch = async (input: any, init: any = {}) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input);
    let query: string | null = null;
    let pageToken: string | null = null;
    try {
      const parsed = new URL(url);
      query = parsed.searchParams.get('q');
      pageToken = parsed.searchParams.get('pageToken');
    } catch { /* non-absolute URL; leave both null */ }

    const req: StubRequest = {
      url,
      method: (init?.method as string) || 'GET',
      query,
      pageToken,
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
    requests.push(req);

    const result = handler(req) ?? { body: {} };
    const status = result.status ?? 200;
    const text = typeof result.body === 'string' ? result.body : JSON.stringify(result.body);

    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
      text: async () => text,
      json: async () => JSON.parse(text),
    } as any;
  };

  return {
    requests,
    restore: () => { g.fetch = original; },
  };
}

/** A page of `messages.list`, shaped the way Gmail returns it. */
export function messagePage(count: number, nextPageToken?: string, resultSizeEstimate?: number) {
  return {
    messages: Array.from({ length: count }, (_, i) => ({ id: `m${i}-${nextPageToken || 'last'}` })),
    ...(nextPageToken ? { nextPageToken } : {}),
    ...(resultSizeEstimate !== undefined ? { resultSizeEstimate } : {}),
  };
}
