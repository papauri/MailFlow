# MailFlow Agent Instructions

This file contains critical context, UI/UX paradigms, and architectural rules for AI agents working on the **MailFlow** codebase.

## 1. App Context & Purpose
**MailFlow** is an intelligent, high-throughput Gmail inbox organizer, bulk cleaner, and subscription manager.
It uses Google OAuth (Firebase Auth) to acquire Gmail API scopes, and queries the Gmail REST API directly from the client.
An Express server (`server.ts`) acts as an AI Gateway, proxying prompts to multi-provider LLMs (Gemini, OpenAI, Claude, etc.) via `@google/genai` and `fetch`.

## 2. Strict UI / UX Paradigms
- **Unified Inline Reviews (No Modals *and No Navigation* for Email Lists):** Throughout the app (Sender Analytics, Folder Optimizer, Automated Sorting Rules, Batch Organizer, Bulk Organize Dropdown), whenever the user needs to "review" emails associated with a cluster/sender, **we use an inline expandable accordion (dropdown)**. We do *not* use full-screen modals (`EmailReviewView` was deleted), and we do *not* navigate to `#filter-view` — sending someone to another page to see what a button will do, and making them find their way back, is the same failure as a modal. Always use `AnimatePresence` and `motion.div` to smoothly expand the list inline. In Smart Automations use `ReviewToggle` / `ReviewPanel` from `AutomationShell`.
- **A review must bind the action:** if the user unticks messages in an inline review, the action runs on what is still ticked and the button says so. Never show a review and then act on something wider.
- **Subtle, Modern Cards:** Avoid heavy color gradients (e.g., `from-indigo-50`, `bg-emerald-600`) for primary cards. Use crisp, modern white cards with clean borders (`bg-white border border-slate-200 shadow-xs hover:border-slate-300`). Icons can have soft background tints (`bg-slate-50 text-slate-700`).
- **Interactive Toggles:** Deselecting emails within inline lists should toggle opacity (`opacity-50`) and strikethrough styling to indicate they are excluded from the batch action.
- **Action Buttons:** Keep them clear, utilizing icons (`lucide-react`), and ensure loading states (`Loader2 animate-spin`) prevent double-clicks.

## 2b. Smart Automations Shell
The three Smart Automations tools (Batch Organizer, Folder Optimizer, Automated Rules) render through
one set of primitives in `src/components/AutomationShell.tsx`. **Do not hand-roll a card, a toolbar, or
an empty state in these modules** — they drifted into three different layouts once already.
- `AutomationToolbar` — filter chips (+ an optional `leadingChips` view switch), search, primary action.
  One toolbar per view; never stack two chip bars.
- `AutomationGrid` — `1 / 2 / 3` responsive columns, `items-start`. Cards are compact by design.
- `AutomationCard` — icon, title, tags, clamped description, footer. An expanded card takes the full row.
- `ReviewToggle` + `ReviewPanel` — the review affordance. Labels are terse (`Review 12`, not
  `Review 12 messages`) because a 3-column card is ~360px and a longer label wraps the footer.
- `AutomationState` — loading / empty / error / done.

`SmartAutomationsPortal` owns the panel, the tab strip and the description line. Each tool takes
`embedded` and draws **no panel of its own** when it is set.

## 2c. Gmail Quota (read before touching `src/lib/gmail.ts`)
Gmail meters at **250 quota units per user per second**, and prices vary per call (`threads.get` is 10,
`batchModify` is 50, a metadata batch is 5 × its sub-requests). Every request goes through the governor
in `src/lib/gmailQuota.ts`, which prices, paces, queues and retries it.
- **Never call `fetch` against a Gmail endpoint directly.** Use `fetchGmailAPI`, or `withQuota(cost, …)`
  for the multipart batch endpoint.
- **Do not add your own sleeps, chunk delays or retry loops.** They cannot see other callers, which is
  exactly how the old fixed 200ms chunk pause ended up spending 500 u/s. `Promise.all` is safe — the
  governor serialises it.
- Gmail reports overruns as **403 `rateLimitExceeded`** more often than 429. A 403 is only terminal when
  the body says `insufficient`.
- No single request may cost more than the bucket holds (~90 units), or its overdraft lands on top of
  the sustained rate. That is why `BATCH_SIZE` is 15, not Gmail's permitted 100.
- Anything that pages the whole mailbox needs a bound (`COUNT_MAX_PAGES`, `CATEGORY_SCAN_LIMIT`).
- `tests/quota_governor_test.ts` asserts the ceiling holds under realistic concurrent load. Run it after
  changing pricing, batch sizes, or the bucket constants.

## 3. Tech Stack & Execution
- **Frontend:** React 19, Vite, Tailwind CSS v4, `lucide-react`, `motion` (Framer Motion).
- **Backend:** Express (`server.ts`) bundled by `esbuild` to `dist/server.cjs`.
- **Firebase:** Client-side Firebase Auth handles Google OAuth (Gmail API scope `https://mail.google.com/`).
- **Data Fetching:** Direct REST calls to `https://gmail.googleapis.com/gmail/v1/users/me/...` from the client (`src/lib/gmail.ts`).

## 4. Key Component Map
- `Dashboard.tsx`: Main email list, search bar, smart query translator, pagination.
- `InboxHealth.tsx`: High-level metrics, storage breakdown, unread counts.
- `SenderAnalyticsModal.tsx`: Displays Top Senders and Domains. Uses inline dropdowns to view specific emails.
- `FolderOptimizer.tsx`: Scans specific folders and uses AI/local heuristics to group unorganized emails. Uses inline dropdowns for review.
- `RuleSuggester.tsx`: Analyzes inbox patterns to suggest permanent Gmail Filter Rules.
- `UnsubscribeManager.tsx`: Parses `List-Unsubscribe` headers, enables 1-click unsubscribe and Ghost Blocking (automatic trash routing).
- `BulkOrganizeDropdown.tsx`: Dropdown for manual labeling, smart local grouping, and AI categorization.
- `LabelManagerModal.tsx`: Two-pane interface for managing Gmail labels safely.

## 5. Coding Guidelines
- **Component props are type-checked — keep them that way.** `@types/react` is installed, so a missing,
  misspelled or wrongly-typed prop is a build error. Declare components as
  `function Foo({ ... }: Props)`. **Do not write `React.FC<Props>`**: it adds nothing, and while the
  types were missing it silently resolved to `any` and disabled prop checking on the components that
  used it. `key` is handled by the JSX types — never declare it on a props interface.
- **Always preserve imports:** When modifying files, do not accidentally remove `motion`, `lucide-react` icons, or core React hooks.
- **Client-Side Gmail API:** Do not move Gmail API execution to the Node.js backend. User tokens live in the browser memory for security; the backend only handles AI.
- **Backend API Handling:** The Express server handles `/api/*` endpoints. If you add a new endpoint, update `server.ts` and ensure it handles CORS/JSON parsing correctly.
