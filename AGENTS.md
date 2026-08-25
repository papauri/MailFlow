# MailFlow Agent Instructions

This file contains critical context, UI/UX paradigms, and architectural rules for AI agents working on the **MailFlow** codebase.

## 1. App Context & Purpose
**MailFlow** is an intelligent, high-throughput Gmail inbox organizer, bulk cleaner, and subscription manager.
It uses Google OAuth (Firebase Auth) to acquire Gmail API scopes, and queries the Gmail REST API directly from the client.
An Express server (`server.ts`) acts as an AI Gateway, proxying prompts to multi-provider LLMs (Gemini, OpenAI, Claude, etc.) via `@google/genai` and `fetch`.

## 2. Strict UI / UX Paradigms
- **Unified Inline Reviews (No Modals for Email Lists):** Throughout the app (Sender Analytics, Folder Optimizer, Automated Sorting Rules, Bulk Organize Dropdown), whenever the user needs to "review" emails associated with a cluster/sender, **we use an inline expandable accordion (dropdown)**. We do *not* use full-screen modals (`EmailReviewView` was deleted). Always use `AnimatePresence` and `motion.div` to smoothly expand the list inline.
- **Subtle, Modern Cards:** Avoid heavy color gradients (e.g., `from-indigo-50`, `bg-emerald-600`) for primary cards. Use crisp, modern white cards with clean borders (`bg-white border border-slate-200 shadow-xs hover:border-slate-300`). Icons can have soft background tints (`bg-slate-50 text-slate-700`).
- **Interactive Toggles:** Deselecting emails within inline lists should toggle opacity (`opacity-50`) and strikethrough styling to indicate they are excluded from the batch action.
- **Action Buttons:** Keep them clear, utilizing icons (`lucide-react`), and ensure loading states (`Loader2 animate-spin`) prevent double-clicks.

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
- **Always preserve imports:** When modifying files, do not accidentally remove `motion`, `lucide-react` icons, or core React hooks.
- **Client-Side Gmail API:** Do not move Gmail API execution to the Node.js backend. User tokens live in the browser memory for security; the backend only handles AI.
- **Backend API Handling:** The Express server handles `/api/*` endpoints. If you add a new endpoint, update `server.ts` and ensure it handles CORS/JSON parsing correctly.
