# MailFlow: Complete System Architecture & Engineering Specification

> **Target Audience**: Antigravity Agent & Core Engineering Team  
> **Application Name**: MailFlow  
> **Status**: Live / Production Full-Stack Application  
> **Primary Purpose**: AI-Driven Gmail Management, Natural Language Query Translation, Behavioral Pattern Clustering & High-Throughput Bulk Operations.

---

## 1. System Overview & Tech Stack

MailFlow is an enterprise-grade full-stack web application that pairs client-side Google OAuth 2.0 / Gmail REST API integration with a multi-model server-side AI router.

### 1.1 Core Technologies
* **Frontend Framework**: React 19 / TypeScript, Vite 6.
* **Styling**: Tailwind CSS v4, Motion (for transitions & layout animations), Lucide React (standardized iconography).
* **Backend Gateway**: Node.js / Express 4.x, TypeScript, bundled with `esbuild` to CommonJS (`dist/server.cjs`).
* **Authentication**: Firebase Authentication + Google OAuth 2.0 (Client-side token flow with Gmail scopes `https://mail.google.com/`).
* **AI Orchestration**: Multi-provider LLM gateway supporting `@google/genai` (Gemini 2.5 Flash, 2.0 Flash, 1.5 Pro) and standard OpenAI/Anthropic/DeepSeek/Groq/Mistral chat completion interfaces.

---

## 2. Directory Structure & Key Files

```
├── .env.example              # Environment secret templates
├── metadata.json             # App metadata & major capabilities
├── package.json              # App dependencies, build & start scripts
├── server.ts                 # Express AI Gateway, dynamic model discovery & proxy
├── vite.config.ts            # Vite & Tailwind configuration
├── src/
│   ├── main.tsx              # React entry point
│   ├── App.tsx               # Root auth state router & session provider
│   ├── index.css             # Tailwind base imports
│   ├── lib/
│   │   ├── gmail.ts          # Gmail REST API clients, batch deletion, chunking logic
│   │   ├── firebase.ts       # Firebase app initialization & Google Auth Provider
│   │   └── utils.ts          # Class helper utilities (`cn`)
│   └── components/
│       ├── LoginScreen.tsx   # Google OAuth login & permission explanation UI
│       ├── Dashboard.tsx     # Primary search, quick filters, email table, bulk actions, settings
│       └── InboxHealth.tsx   # Analytics, health metric cards, AI behavioral clusters, top senders/domains
```

---

## 3. Architecture & Data Flow

### 3.1 Authentication & Token Flow
1. User logs in via `LoginScreen.tsx` with Google Auth (`signInWithPopup`).
2. Scopes requested: `https://mail.google.com/` (full mailbox management).
3. Access token is stored in memory / local session and injected into all Gmail REST API calls via `Authorization: Bearer <token>`.

### 3.2 Gmail API Integration (`src/lib/gmail.ts`)
* **Endpoint Base**: `https://gmail.googleapis.com/gmail/v1/users/me`
* **Batch Operations (`processInChunks`)**:
  * Chunks operations into concurrent batches of 15–20 items to avoid HTTP 429 rate limits from Google APIs.
  * `batchTrashEmails(ids)`: Soft deletes messages to Trash (`/messages/{id}/trash`).
  * `batchDeleteEmails(ids)`: Permanently deletes messages (`/messages/batchDelete`).
  * `batchArchiveEmails(ids)`: Removes `INBOX` label from messages (`/messages/batchModify`).
  * `batchMarkAsRead(ids)`: Removes `UNREAD` label from messages.
* **Accurate In-Depth Counting (`countEmails`)**:
  * Pages Gmail search endpoints until the query is exhausted, so the count is exact at any mailbox size. `maxPages` remains available for a caller that deliberately wants a bounded probe rather than an answer.

### 3.3 Server AI Gateway (`server.ts`)
The server provides three critical endpoints:
1. `POST /api/parse-query`:
   * Accepts user natural language (e.g. *"huge receipts older than a year"*).
   * Transforms input into valid Gmail search syntax (`has:attachment larger:5M before:YYYY/MM/DD`).
   * Suggests appropriate folder targeting (`INBOX`, `SPAM`, `TRASH`, `CATEGORY_PROMOTIONS`, etc.).
2. `POST /api/analyze-inbox`:
   * Accepts structured email metadata (`id`, `sender`, `subject`, `labelIds`).
   * Detects recurring behavioral bundles (e.g., *Ignored Promotions*, *Newsletters*, *Delivery Receipts*, *SaaS Expirations*).
   * Emits actionable cluster items with exact Gmail search queries and estimated volume.
3. `POST /api/models`:
   * Dynamically queries the configured AI provider to list supported models.

---

## 4. Error Handling & Quota Resilience
* Backend catches and classifies provider failures:
  * `429`: Rate limit / quota exhausted → triggers fallback to raw Gmail search with a notification to add an API key.
  * `503`: High demand / overloaded → alerts the user and suggests selecting an alternative model in Settings.
  * Graceful degradation: If AI features fail or are disabled, native Gmail search operates uninterrupted.

---

## 5. Antigravity Implementation Roadmap & Next Steps

When continuing development, prioritize the following modules:

1. **Pagination & Infinite Scroll in Dashboard**:
   * Add a `Load More` button or cursor pagination using Gmail's `nextPageToken` when search results exceed 100 emails.
   * Display total matching count in the search header (e.g., `Showing 100 of 428 matching emails`).
2. **Interactive Inbox Distribution Modal / Chart**:
   * Add an on-demand modal in `InboxHealth.tsx` showing category breakdown (Primary, Promotions, Social, Updates, Forums) and read vs. unread ratios using SVG / CSS bar charts or Recharts.
   * Lazy-fetch category counts on modal open so the main health view loads instantly.
3. **Automated Rule / Filter Creation**:
   * Allow users to save cluster queries as Gmail automated filters (`users.me.settings.filters.create`).
4. **Export & Audit Logs**:
   * Export cleaned email logs (sender, subject, date, size) to CSV / JSON for compliance and record-keeping before bulk purge.
