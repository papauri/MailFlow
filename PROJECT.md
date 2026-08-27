# Project: MailFlow Enhancements

## Architecture
MailFlow is a modern web application built on React 19, TypeScript 5.8, Tailwind CSS v4, and Vite 6 with an Express backend proxy for AI models and Firebase Google OAuth authentication with direct Gmail REST API integration.

### Module Boundaries & Data Flow
1. **Frontend UI Tier**:
   - `src/App.tsx`: Authentication state gate, router controller (LoginScreen vs Dashboard).
   - `src/components/Dashboard.tsx`: Top header, natural language search & filter bar, email listing table with toolbar (sort/selection/bulk actions), pagination controls, and BYOK settings modal.
   - `src/components/InboxHealth.tsx`: Inbox health metrics, storage hogs, quick filter badges, top senders/domain aggregations, AI pattern insights, and Category Distribution Recharts Modal.
   - `src/components/FolderMultiSelect.tsx`: Multi-select dropdown for Gmail system and user labels.
   - `src/components/LoginScreen.tsx`: Google OAuth login landing view.
   - `src/components/CategoryDistributionModal.tsx`: On-demand Recharts-based email category distribution modal with legends and filtering.
2. **Services & Utilities**:
   - `src/lib/gmail.ts`: Gmail REST API client with OAuth bearer token injection, rate limit handling with exponential backoff (HTTP 429), chunked message fetching, bounded exact email counting (`countEmails`, 10,000 then estimate), and bulk actions (trash, archive, mark read).
   - `src/lib/firebase.ts`: Firebase Google Auth popup integration and OAuth token caching.
   - `src/lib/ai.ts`: AI query translator and natural language inbox pattern recognition.
   - `src/lib/utils.ts`: Tailwind class merger (`cn`).

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Global Header Mobile Responsiveness | Responsive padding, scalable logo, icon-only mobile Inbox Health button, responsive profile display | M1 | Survey 1 / R1 |
| 2 | Search & Filter Bar Mobile Adaptability | Flexible search button width, horizontal scrollable filter strip with shrink-0 badges and non-wrapping inputs | M1 | Survey 1 / R1 |
| 3 | Email List Toolbar Responsiveness | Structured two-row mobile toolbar for sort dropdown and bulk action buttons without horizontal clipping | M1 | Survey 1 / R1 |
| 4 | Email Row Item Mobile Layout | Responsive padding, compact size/date badges, and maximized sender name truncation area | M1 | Survey 1 / R1 |
| 5 | BYOK Modal Viewport Scaling | Max-height scaling (`max-h-[85vh]` / `max-h-[90dvh]`), responsive grid for AI provider buttons | M1 | Survey 1 / R1 |
| 6 | Inbox Health Aggregations Responsiveness | Responsive metric cards, non-wrapping quick filter badges, and compact sender/domain rows | M1 | Survey 1 / R1 |
| 7 | Search Result Pagination (`nextPageToken`) | Capture `nextPageToken` from Gmail API results and provide "Load More" / "Next Page" functionality | M2 | Survey 2 / R2 |
| 8 | Accurate Total Matching Count | Concurrently trigger `countEmails(query)` on search to display the total; exact to 10,000 (`COUNT_MAX_PAGES`), Gmail's estimate beyond | M2 | Survey 2 / R2 |
| 9 | In-Memory Safe Sorting on Loaded Page | Sort visible loaded emails by Date, Size, or Sender using memoized null-safe comparators | M2 | Survey 2 / R2 |
| 10 | Recharts Package Integration | Install `recharts` (^3.x) in `package.json` compatible with React 19 | M3 | Survey 3 / R3 |
| 11 | Inbox Health Chart Trigger Button | Add visible "Category Breakdown" button in `InboxHealth.tsx` top banner | M3 | Survey 3 / R3 |
| 12 | Category Distribution Recharts Modal | Interactive Donut/Pie chart with Recharts, Tooltips, Custom Color Palette, and Legends | M3 | Survey 3 / R3 |
| 13 | Modal State & Dismissal | Open on trigger, close on Close button, backdrop click, or Escape key, with lazy data fetching | M3 | Survey 3 / R3 |
| 14 | Full E2E & Integration Verification | Comprehensive verification of R1, R2, R3 across mobile viewports, large datasets, and Recharts rendering | M4 | Survey 1,2,3 / AC |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Mobile Responsive Design (R1) | Tailwind CSS mobile layout optimizations across Dashboard, EmailList, Toolbar, Filters, Modals, and InboxHealth (< 768px and < 480px) | none | DONE |
| M2 | Pagination, Counts, and Sorting (R2) | `nextPageToken` pagination, "Load More" button, exact matching count calculation up to 5,000 cap, and crash-proof in-memory sorting | none | DONE |
| M3 | Inbox Health Chart Modal with Recharts (R3) | `recharts` package installation, `CategoryDistributionModal` component, trigger button in `InboxHealth.tsx`, lazy category counts fetching, and modal dismiss controls | none | DONE |
| M4 | Integration & E2E Verification | Automated test runner setup (Vitest + RTL + JSDOM), E2E verification across all acceptance criteria for R1, R2, and R3 | M1, M2, M3 | DONE |

---

## Interface Contracts

### `Dashboard.tsx` ↔ `gmail.ts`
- `fetchGmailAPI(endpoint: string, options?: RequestInit)` -> returns `{ messages?: Array<{ id: string, threadId: string }>, nextPageToken?: string, resultSizeEstimate?: number }`
- `countEmails(query: string, maxPages?: number)` -> returns `Promise<number>` (exact to 10,000; Gmail's estimate beyond, never below what was counted)
- `processInChunks<T, R>(items: T[], chunkSize: number, processor: (item: T) => Promise<R>)` -> returns `Promise<R[]>`

### `Dashboard.tsx` ↔ `InboxHealth.tsx`
- Props: `{ onApplyQuery: (q: string, filter?: string) => void, aiSettings?: any }`

### `InboxHealth.tsx` ↔ `CategoryDistributionModal.tsx`
- Props:
  ```ts
  interface CategoryDistributionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onApplyCategory?: (query: string, filter: string) => void;
  }
  ```
- Categories (`CATEGORY_CONFIG`): the five live buckets are scoped `-in:trash -in:spam -in:sent` so their slices are shares of the same mailbox — e.g. `category:primary -in:trash -in:spam -in:sent`. `Spam & Trash` (`in:spam OR in:trash`) is the exception, since it exists to count exactly what the others exclude. They previously used `in:anywhere`, which pulled discarded and sent mail into a chart of the live mailbox.

---

## Code Layout
- `src/App.tsx`: Top application entry and authentication state container
- `src/components/Dashboard.tsx`: Main dashboard container, search bar, email list table, toolbar, pagination
- `src/components/InboxHealth.tsx`: Inbox health analytics and category chart trigger
- `src/components/CategoryDistributionModal.tsx`: Recharts-based category distribution modal dialog
- `src/components/FolderMultiSelect.tsx`: Multi-select dropdown for folders
- `src/components/LoginScreen.tsx`: Google OAuth login landing view
- `src/lib/gmail.ts`: Gmail REST API client, batch fetching, countEmails
- `src/lib/firebase.ts`: Firebase Auth & token handling
- `src/lib/ai.ts`: AI query processing
- `src/lib/utils.ts`: Tailwind class utility (`cn`)
- `package.json`: Dependencies (`recharts`, etc.) and scripts
