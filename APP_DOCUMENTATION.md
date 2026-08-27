# MailFlow: Comprehensive System Architecture & Feature Documentation

> **Document Type**: Technical Reference & AI Model Knowledge Base  
> **Application Name**: MailFlow  
> **Status**: Live Full-Stack Application  
> **Primary Purpose**: AI-Driven Gmail Inbox Router, Behavioral Pattern Analyzer, Automated Subscription Manager, and High-Throughput Bulk Cleaner.

---

## Table of Contents
1. [Executive Summary & Purpose](#1-executive-summary--purpose)
2. [High-Level Architecture & Tech Stack](#2-high-level-architecture--tech-stack)
3. [Authentication & Security Model](#3-authentication--security-model)
4. [Gmail REST API Integration & Optimization Engine](#4-gmail-rest-api-integration--optimization-engine)
5. [Backend AI Gateway & Multi-Provider Router](#5-backend-ai-gateway--multi-provider-router)
6. [Complete Feature Inventory & Modules](#6-complete-feature-inventory--modules)
   - 6.1 [Dashboard & Cockpit Command Center](#61-dashboard--cockpit-command-center)
   - 6.2 [Natural Language Search & Smart Query Translator](#62-natural-language-search--smart-query-translator)
   - 6.3 [Folder & Category Multi-Filtering](#63-folder--category-multi-filtering)
   - 6.4 [High-Throughput Bulk Actions & Purge Engines](#64-high-throughput-bulk-actions--purge-engines)
   - 6.5 [Thread Viewer & In-Memory Safe Sorting](#65-thread-viewer--in-memory-safe-sorting)
   - 6.6 [Pagination & Accurate Mailbox Counting](#66-pagination--accurate-mailbox-counting)
   - 6.7 [Inbox Health Analytics & Aggregations](#67-inbox-health-analytics--aggregations)
   - 6.8 [Category Distribution Donut Modal (Recharts)](#68-category-distribution-donut-modal-recharts)
   - 6.9 [Subscription Manager (1-Click Unsubscribe & Ghost Block)](#69-subscription-manager-1-click-unsubscribe--ghost-block)
   - 6.10 [Smart Folder Optimizer & Outlier Detector](#610-smart-folder-optimizer--outlier-detector)
   - 6.11 [Label Manager & Interactive Drag-and-Drop](#611-label-manager--interactive-drag-and-drop)
   - 6.12 [Bulk Organize Engine (AI + Local Analytics)](#612-bulk-organize-engine-ai--local-analytics)
   - 6.13 [Inbox Health Score Widget](#613-inbox-health-score-widget)
   - 6.14 [BYOK (Bring Your Own Key) Multi-LLM Settings](#614-byok-bring-your-own-key-multi-llm-settings)
   - 6.15 [Onboarding Walkthrough & Contextual Tips](#615-onboarding-walkthrough--contextual-tips)
7. [Data Models & TypeScript Interfaces](#7-data-models--typescript-interfaces)
8. [Backend API Specification](#8-backend-api-specification)
9. [Error Handling, Quotas, & Resilience Strategies](#9-error-handling-quotas--resilience-strategies)
10. [Directory Structure & Code Layout](#10-directory-structure--code-layout)

---

## 1. Executive Summary & Purpose

### What MailFlow Is
**MailFlow** is an intelligent, high-throughput email management platform and Gmail cleaner built with React 19, TypeScript, Tailwind CSS v4, and an Express backend AI gateway.

### The Problem It Solves
1. **Inbox Overload & Email Debt**: Users accumulate tens of thousands of unread promotional emails, automated newsletters, transactional receipts, and cold outreach emails.
2. **Rigid Search Syntax**: Standard Gmail search requires memorizing arcane search syntax (`has:attachment larger:5M before:2024/01/01 category:promotions`).
3. **Storage Quota Depletion**: Large attachments and obsolete media files silently consume Google One / Google Drive storage quotas.
4. **Tedious Unsubscribing**: Unsubscribing from hundreds of marketing lists manually is painfully slow, and many senders omit or obscure unsubscribe links.
5. **Slow Manual Organization**: Sorting emails into labels, archiving read items, or clearing trash in Gmail's native UI is constrained by 50-item page limits and rate throttles.

### Target Audience & Core Value Proposition
- **Target Audience**: Professionals, power users, entrepreneurs, and teams seeking zero-inbox clarity.
- **Core Value Proposition**: 
  - **Natural Language Search**: Type queries like *"receipts older than 6 months over 5MB"* or *"newsletters I never opened"*, and MailFlow instantly translates them into valid Gmail search queries.
  - **1-Click Bulk Purge**: Trash, permanently delete, or archive hundreds or thousands of matching messages in seconds with progress tracking.
  - **Automated Subscription Audit**: Automatically scans `List-Unsubscribe` headers and lets users unsubscribe or "Ghost Block" noisy senders with undo capability.
  - **Storage Reclamation**: Identifies storage hogs and stale promotions for safe cleanup.
  - **Interactive Analytics**: Visualizes mailbox category distribution with interactive Recharts donut graphs and real-time health scores.

---

## 2. High-Level Architecture & Tech Stack

```
┌────────────────────────────────────────────────────────────────────────┐
│                          CLIENT TIER (Browser)                         │
│  React 19 • TypeScript 5.8 • Vite 6 • Tailwind CSS v4 • Recharts • Motion │
│                                                                        │
│  ┌─────────────────────────┐  ┌─────────────────────────────────────┐  │
│  │   Firebase Auth Popup   │  │       UI Components & Views         │  │
│  │  (Google OAuth 2.0)     │  │  • Dashboard.tsx   • InboxHealth.tsx│  │
│  │  Scope: mail.google.com │  │  • UnsubManager    • LabelManager   │  │
│  └───────────┬─────────────┘  │  • FolderOptimizer • HealthWidget   │  │
│              │ Bearer Token   │  • CategoryModal   • BulkOrganize   │  │
│              ▼                └──────────────────┬──────────────────┘  │
│   Direct Gmail REST API Calls                    │ AI Prompts / Req    │
└──────────────┬───────────────────────────────────┼─────────────────────┘
               │                                   │
               ▼                                   ▼
┌──────────────────────────────┐   ┌─────────────────────────────────────┐
│    GOOGLE GMAIL REST API     │   │     EXPRESS BACKEND AI GATEWAY      │
│  https://gmail.googleapis.com│   │            (server.ts)              │
│  • /threads (metadata/list)  │   │  • POST /api/parse-query            │
│  • /messages/batchModify     │   │  • POST /api/analyze-inbox          │
│  • /messages/batchDelete     │   │  • POST /api/analyze-subscriptions  │
│  • /labels (CRUD)            │   │  • POST /api/suggest-labels         │
│  • /messages/{id}/trash      │   │  • POST /api/check-quota            │
└──────────────────────────────┘   │  • POST /api/models                 │
                                   └──────────────────┬──────────────────┘
                                                      │
                                                      ▼
                                   ┌─────────────────────────────────────┐
                                   │     MULTI-PROVIDER LLM SERVICES     │
                                   │  • Google Gemini (@google/genai)    │
                                   │  • OpenAI (GPT-4o, o1, o3-mini)     │
                                   │  • Anthropic Claude (3.7 Sonnet)    │
                                   │  • DeepSeek, Groq, Mistral, Zhipu   │
                                   └─────────────────────────────────────┘
```

### Key Technologies
- **Frontend Core**: React 19, TypeScript 5.8, Vite 6.
- **Styling & Animation**: Tailwind CSS v4 (`@tailwindcss/vite`), Motion (`motion/react`), Lucide React icons.
- **Data Visualization**: Recharts 3.x for category breakdown donut charts.
- **Backend Server**: Node.js, Express 4.21, bundled with `esbuild` to CommonJS (`dist/server.cjs`).
- **AI SDK**: `@google/genai` (official modern SDK for Gemini 2.5 Flash, 2.5 Pro, 2.0 Flash) + REST fallback proxy for OpenAI, Anthropic, DeepSeek, Groq, Mistral, and Zhipu AI.
- **Authentication**: Firebase Auth 12.x (`signInWithPopup`, `GoogleAuthProvider`).

---

## 3. Authentication & Security Model

1. **Client-Side OAuth 2.0 Flow**:
   - Authentication is handled exclusively in the client via Firebase Auth using Google Identity Services popup (`signInWithPopup`).
   - Requested Scope: `https://mail.google.com/` (full mailbox management required for reading headers, modifying labels, trashing, and batch deleting).
2. **Zero-Server Token Storage**:
   - Access tokens are kept in browser memory / local session and passed directly to `https://gmail.googleapis.com/` in `Authorization: Bearer <token>` headers.
   - The Express backend **never** receives or stores user OAuth tokens or email bodies, ensuring complete user data privacy.
3. **Bring Your Own Key (BYOK) AI Architecture**:
   - Users can either use the default server-side Gemini configuration or provide their own API key for Gemini, OpenAI, Claude, DeepSeek, Groq, Mistral, or Zhipu.
   - User keys are stored in `localStorage` (`adminAiSettings`) and forwarded per-request over HTTPS to the backend proxy.

---

## 4. Gmail REST API Integration & Optimization Engine

Located in `src/lib/gmail.ts`, this module powers high-speed communication with Gmail:

### 4.1 Quota Optimization & Batching (`processInChunks`)
- Gmail enforces strict per-user rate limits (250 quota units / second). A `threads.get` call costs 5 units.
- `processInChunks<T, R>` divides thread fetching into concurrent batches of 10 items with a 200ms throttle between chunks to guarantee zero HTTP 429 errors during heavy scans.

### 4.2 Exponential Backoff & Session Recovery
- `fetchGmailAPI` intercepts HTTP 429 status codes and retries up to 3 times with exponential backoff (`backoff * 1.5`).
- Intercepts HTTP 401 / 403 (expired token or revoked permissions), automatically clears session, and prompts user to re-authenticate cleanly.

### 4.3 High-Throughput Batch Operations
- **`batchModifyEmails(ids, addLabelIds, removeLabelIds)`**: Modifies labels for hundreds of messages in a single network request (`POST /messages/batchModify`).
- **`batchTrashEmails(ids)`**: Moves messages to trash by applying `TRASH` and removing `INBOX`.
- **`batchDeleteEmails(ids)`**: Permanently purges messages (`POST /messages/batchDelete`).
- **`batchArchiveEmails(ids)`**: Archives messages by removing the `INBOX` label.
- **`batchMarkAsRead(ids)`**: Removes `UNREAD` label across messages.
- **`emptyAllTrash(onProgress)`**: Iteratively scans `in:trash` in 1,000-message pages and permanently purges them with live progress callback.
- **`markAllAsReadByQuery(query, onProgress)`**: Finds all unread emails matching a query and removes `UNREAD` in 1,000-message batches.
- **`countEmails(query, maxPages?)`**: Pages a query until it is exhausted and returns an exact `number`, at any mailbox size. `maxPages` is optional and unset by default; pass it only for a deliberately bounded probe. Gmail's `resultSizeEstimate` is used only as a floor when a bounded probe stops early.

---

## 5. Backend AI Gateway & Multi-Provider Router

Located in `server.ts`, the Express backend serves as a universal AI router:

### Multi-Provider Support
1. **Google Gemini**: Via `@google/genai` with native JSON Schema output validation (`responseSchema`).
2. **OpenAI**: Via `https://api.openai.com/v1/chat/completions` with `response_format: { type: "json_object" }`.
3. **Anthropic Claude**: Via `https://api.anthropic.com/v1/messages` with schema-enforced prompt engineering and Markdown codeblock stripping.
4. **DeepSeek**: Via `https://api.deepseek.com`.
5. **Groq**: Via `https://api.groq.com/openai/v1` (ultra-fast Llama-3 inference).
6. **Mistral**: Via `https://api.mistral.ai/v1`.
7. **Zhipu AI**: Via `https://open.bigmodel.cn/api/paas/v4`.

### Server Endpoints
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/parse-query` | Translates natural language into structured Gmail search operators. |
| `POST` | `/api/analyze-inbox` | Analyzes email header samples to detect behavioral clusters. |
| `POST` | `/api/analyze-subscriptions` | Audits mailing lists, assigns spam scores (1-100), and recommends actions. |
| `POST` | `/api/suggest-labels` | Groups selected email batches into organized label recommendations. |
| `POST` | `/api/check-quota` | Validates API key and checks quota health. |
| `POST` | `/api/models` | Dynamically fetches available models from the selected provider. |

---

## 6. Complete Feature Inventory & Modules

### 6.1 Dashboard & Cockpit Command Center (`src/components/Dashboard.tsx`)
- **Global Header**: Logo, title, real-time circular health score gauge, contextual walkthrough trigger, manual refresh button, Inbox Health toggle, and AI Settings modal button.
- **Dynamic View Routing**: Instant switching between the primary Email Management view and the Inbox Health Analytics view.

### 6.2 Natural Language Search & Smart Query Translator
- **Dual Search Modes**:
  - **AI Natural Language Mode**: Converts phrases like *"emails from uber over $50 last year"* into `from:uber.com (receipt OR ride OR trip OR $) after:2024/01/01 before:2025/01/01`.
  - **Raw Gmail Operator Mode**: Direct support for all native Gmail operators (`from:`, `to:`, `subject:`, `has:attachment`, `larger:`, `smaller:`, `older_than:`, `newer_than:`, `is:starred`, `is:unread`, `label:`, `category:`).
- **AI Explanation Card**: Displays an interactive badge breaking down what the query does, the suggested smart folder name, and suggested category.

### 6.3 Folder & Category Multi-Filtering
- **Folder Multi-Select**: Filter across All Mail, Inbox, Primary, Promotions, Social, Updates, Forums, Custom User Labels, Spam, and Trash.
- **Date Range Picker**: Quick presets (Last 7 days, Last 30 days, Last year, Any time) + custom Start and End date calendar pickers.
- **Quick Modifiers**:
  - *"Exclude Sent Mail"* checkbox (injects `-in:sent`).
  - *"Only Unread"* checkbox (injects `is:unread`).

### 6.4 High-Throughput Bulk Actions & Purge Engines
- **Multi-Select Controls**: Select all visible items, select all within a category group, or select individual threads.
- **Bulk Action Toolbar**:
  - **Bulk Trash**: Moves selected threads to Trash.
  - **Bulk Permanent Delete**: Completely removes messages (`batchDelete`) with a safety confirmation modal.
  - **Bulk Archive**: Removes threads from Inbox without deleting.
  - **Bulk Mark as Read / Unread**: Toggles unread state for selected messages.
  - **1-Click "Empty All Trash"**: Streams progress as it drains thousands of trashed messages.
  - **1-Click "Mark All Matching as Read"**: Marks all matching unread messages as read across the entire mailbox.

### 6.5 Thread Viewer & In-Memory Safe Sorting
- **Expandable Thread Preview**: Clicking any row expands the complete message thread, revealing individual message dates, senders, subject lines, and snippet previews.
- **Folder/Category Grouping**: Visually partitions loaded emails by category (Primary Inbox, Promotions, Updates, Social, Forums, Spam, Trash) with collapsible group headers.
- **Crash-Proof In-Memory Sorting**: Sort loaded emails by:
  - **Date** (newest to oldest / oldest to newest)
  - **Size** (largest to smallest / smallest to largest)
  - **Sender** (alphabetical A-Z / Z-A)
  - Utilizes null-safe, memoized comparators that handle missing dates or sizes gracefully.

### 6.6 Pagination & Accurate Mailbox Counting
- **Cursor Pagination (`nextPageToken`)**: Seamlessly fetches subsequent pages of 50–100 threads via "Load More Emails".
- **Accurate Count Calculation**: Concurrently runs `countEmails(query)` on search execution to display the exact total, however large.

### 6.7 Inbox Health Analytics & Aggregations (`src/components/InboxHealth.tsx`)
- **Key Metric Cards**:
  - *Unread in Inbox* (`is:unread in:inbox`)
  - *Stale Promotions* (`category:promotions older_than:6m`)
  - *Large Attachments* (`larger:5M -in:trash`)
  - *Spam & Trash Backlog* (`in:spam OR in:trash`)
- **Top Senders Aggregation**: Extracts top email senders from the last 250 threads, excludes the user's own email, filters out generic webmail providers, and calculates exact mailbox volume with 1-click filter buttons.
- **Domain Clusters**: Groups emails by organization domain (e.g. `github.com`, `stripe.com`, `nytimes.com`) to help users identify company-wide spam.

### 6.8 Category Distribution Donut Modal (`src/components/CategoryDistributionModal.tsx`)
- Built with **Recharts 3.x**.
- Visualizes volume across Primary, Promotions, Updates, Social, Forums, and Spam & Trash.
- Interactive donut chart with custom color-coded slices, hover tooltips showing count and percentage, center total display, and 1-click "Filter by Category" action buttons.
- Lazy-fetches data on modal open to keep initial page loads instantaneous.

### 6.9 Subscription Manager (`src/components/UnsubscribeManager.tsx`)
- **3 Management Tabs**:
  1. **Active Senders**: Lists all detected newsletter and recurring senders.
  2. **Unsubscribed**: Historical record of unsubscribed senders.
  3. **Blocked**: Senders subjected to Ghost Blocking.
- **1-Click Unsubscribe**: Parses `List-Unsubscribe` headers (HTTP URL or `mailto:`), triggers the unsubscribe action, and trashes local copies.
- **Ghost Block (Block Senders)**: For senders hiding unsubscribe links, automatically moves all existing emails to Trash and records the block.
- **AI Intent Audit (`/api/analyze-subscriptions`)**: Evaluates sender lists, identifies marketing vs. transactional intent, assigns a noise score (1-100), and recommends Unsubscribe, Block, or Keep.
- **Undo & Restore**: Every unsubscribe or block action includes an "Undo & Restore" button that immediately restores trashed messages back to `INBOX`.
- **Persistent Local Storage**: Action logs are saved to `localStorage` (`ais_unsub_log`) and broadcast events to update the global Health Score.

### 6.10 Smart Folder Optimizer (`src/components/FolderOptimizer.tsx`)
- **Outlier & Cluster Detection**: Scans recent emails for unorganized items and outliers.
- **Dual Engine Architecture**:
  - **AI Mode**: Sends subject headers to `/api/suggest-labels` to generate semantic label recommendations.
  - **Local Heuristics Fallback**: Detects sender clusters and keyword topics (Promotions, Purchases, Finance, Alerts, Newsletters) locally without AI API dependencies.
- **Interactive Review Cards**: Expandable email checklists allowing users to select/deselect specific emails before executing "Move to Label", "Archive", or "Trash".

### 6.11 Label Manager & Interactive Drag-and-Drop (`src/components/LabelManagerModal.tsx`)
- **Two-Pane Explorer**: Sidebar listing all custom Gmail labels with live message count and unread count badges.
- **Inline Label Creation & Safe Deletion**: Deleting a label automatically moves all contained messages back to `INBOX` first, preventing accidental message loss.
- **Drag-and-Drop Organization**: Drag emails from the message list and drop them onto sidebar labels to move them instantly.
- **AI Label Insights**: Summarizes what kinds of emails are filed under a label and suggests optimization rules.

### 6.12 Bulk Organize Engine (`src/components/BulkOrganizeDropdown.tsx`)
- Dropdown component allowing users to organize any selected set of emails from the main table:
  - Categorize with existing user label.
  - Smart Organize (local sender aggregation).
  - AI Deep Organize (semantic categorization).

### 6.12b Scan Completeness

- **No scan is capped.** Listing, counting, category scans, the newsletter audit,
  sender purges, folder browsing and CSV exports all run until the query is
  exhausted. Caps used to sit as bare numbers at each call site — 1,500 behind a
  label reading "Auditing newsletters", 300 behind a purge that reported the sender
  cleared, 5,000 behind a scope option named "Entire Folder" — and each presented a
  partial result as a complete one.
- `listMessageIds`, `scanFolderMetadata` and `countEmails` take an **optional**
  limit. Omitted, they return everything; passed, they sample deliberately.
- 500 (page size), 15 (metadata batch size) and the drain-loop round guards are
  mechanical constants of the Gmail API and the quota governor, not result caps.
- A large mailbox therefore takes longer rather than returning less. Progress is
  reported during both the id sweep and the metadata fetch so a long scan is
  visible rather than looking hung.

### 6.13 Inbox Health Score Widget (`src/components/HealthScoreWidget.tsx`)
- Circular SVG progress dial displayed in the main navigation bar.
- **Scoring is relative to the mailbox, not to fixed targets.** Both denominators
  are read from Gmail — `users.getProfile` for the mailbox total and the `INBOX`
  label for the inbox total, one quota unit each and exact.
  - Starts at 100.
  - **Attention** (`ATTENTION_SHARE_OF_SCORE`, currently 30% of the score):
    deducts in proportion to `unread in inbox / messages in inbox`.
  - **Storage** (the remaining 70%): deducts in proportion to
    `clearable messages / all messages`, where clearable means spam and trash,
    stale promotions, large attachments and mail over a year old. Every clutter
    message counts the same; there are no per-category weights.
  - **Hygiene bonus**: +1.5 per unsubscribe (max +8) and +2 per filter rule
    (max +7), capped at +15 combined.
  - A mailbox whose size is not yet known deducts nothing rather than falling back
    to an invented reference.
- Earlier revisions used fixed reference counts (full penalty at 600 unread, 400
  spam) and then fixed shares. Both pinned any real mailbox to the score floor,
  because every penalty saturated at once and cleanup stopped registering.
- Score bands (`healthBand()`, shared with the Inbox Score page so the ring and the
  panel never disagree): 85+ Optimal, 70+ Good, 50+ Needs Attention, below 50
  Action Required.
- Updates optimistically from `inbox_metrics_updated` (carrying the changed metric)
  and recomputes the bonus in place on `health-score-update`.

### 6.14 BYOK Multi-LLM Settings
- Accessible via the gear icon in the header.
- Allows users to switch between Gemini, OpenAI, Claude, DeepSeek, Groq, Mistral, and Zhipu.
- Features dynamic model listing (`/api/models`), real-time key testing (`/api/check-quota`), and status indicators.

### 6.15 Onboarding Walkthrough & Contextual Tips
- **5-Step Onboarding Modal (`OnboardingWalkthrough.tsx`)**: Introduces new users to Smart Search, Inbox Health, Bulk Cleanup, Smart Organization, and Safety features.
- **Contextual Tips (`WalkthroughTip.tsx`)**: Inline educational banners across Dashboard, Unsubscribe Manager, and Folder Optimizer with 1-click dismissal and reset support.

---

## 7. Data Models & TypeScript Interfaces

### Email Thread Interface (`src/lib/gmail.ts`)
```typescript
export interface EmailData {
  id: string;                                // Thread ID
  threadId: string;                          // Gmail Thread ID
  messageIds?: string[];                     // Array of all Message IDs in this thread
  snippet: string;                           // Latest snippet preview
  date: Date;                                // Parsed timestamp of the most recent message
  sender: string;                            // Extracted From header
  subject: string;                           // Extracted Subject header
  labelIds: string[];                        // Union of all label IDs across messages in thread
  sizeEstimate?: number;                     // Total estimated byte size of the thread
  listUnsubscribe?: string;                  // Raw List-Unsubscribe header string
  messages?: {                               // Individual message details (when expanded)
    id: string;
    sender: string;
    snippet: string;
    date: Date;
    subject: string;
    labelIds: string[];
    listUnsubscribe?: string;
  }[];
}
```

### AI Parsed Query Schema
```typescript
export interface ParsedQueryResponse {
  operators: {
    from?: string;                           // Sender or domain
    subject?: string;                        // Subject keywords
    after?: string;                          // YYYY/MM/DD date string
    before?: string;                         // YYYY/MM/DD date string
    folder?: string;                         // e.g. "in:inbox", "in:spam"
    general?: string;                        // Other keywords or flags (e.g. "larger:5M")
    inAnywhere?: boolean;                    // Whether to search all folders
  };
  explanation: string;                       // Human-readable explanation of query
  suggestedFolder?: string;                  // Suggested smart folder name
  suggestedGmailCategory?: string;          // e.g. "CATEGORY_PROMOTIONS"
  query: string;                             // Final constructed Gmail query string
}
```

### AI Subscription Audit Schema
```typescript
export interface SubscriptionAuditItem {
  email: string;                             // Sender email address
  category: 'Marketing & Promo' | 'Newsletter & Content' | 'Transactional/Alerts' | 'Cold Outreach' | 'Unknown';
  intent: string;                            // 3-5 word description of sender intent
  spamScore: number;                         // 1 to 100 spam/noise score
  recommendation: 'Unsubscribe' | 'Ghost Block' | 'Keep';
}
```

---

## 8. Backend API Specification

### `POST /api/parse-query`
- **Request Body**:
  ```json
  {
    "prompt": "receipts from amazon larger than 2mb from last year",
    "settings": {
      "provider": "gemini",
      "model": "gemini-3.6-flash",
      "apiKey": "optional_user_byok_key"
    }
  }
  ```
- **Response Body**: Returns `ParsedQueryResponse` JSON object.

### `POST /api/analyze-inbox`
- **Request Body**:
  ```json
  {
    "emails": [
      { "id": "18e...", "sender": "promo@store.com", "subject": "50% Off Today", "labelIds": ["UNREAD", "CATEGORY_PROMOTIONS"] }
    ],
    "userEmail": "user@gmail.com",
    "settings": { "provider": "gemini", "model": "gemini-3.6-flash" }
  }
  ```
- **Response Body**: Returns array of behavioral clusters with titles, descriptions, suggested actions, and precise Gmail search queries.

### `POST /api/analyze-subscriptions`
- **Request Body**:
  ```json
  {
    "subscriptions": [
      { "name": "Newsletter Weekly", "email": "news@daily.com", "count": 42, "exampleSubject": "This week in tech" }
    ],
    "settings": { "provider": "gemini", "model": "gemini-3.6-flash" }
  }
  ```
- **Response Body**: Returns `analysis` array matching `SubscriptionAuditItem[]`.

### `POST /api/suggest-labels`
- **Request Body**:
  ```json
  {
    "emails": [{ "id": "18e...", "sender": "billing@stripe.com", "subject": "Invoice #1024" }],
    "userLabels": [{ "id": "Label_1", "name": "Finance" }],
    "settings": { "provider": "gemini", "model": "gemini-3.6-flash" }
  }
  ```
- **Response Body**: Returns `recommendations` array mapping email IDs to suggested labels with reasons.

### `POST /api/check-quota`
- **Request Body**: `{ "settings": { "provider": "gemini", "apiKey": "..." } }`
- **Response Body**: `{ "ok": true }` (or HTTP 429 / 500 on failure).

### `POST /api/models`
- **Request Body**: `{ "settings": { "provider": "openai", "apiKey": "..." } }`
- **Response Body**: `{ "models": ["gpt-4o", "gpt-4o-mini", "o1", "o3-mini"] }`

---

## 9. Error Handling, Quotas, & Resilience Strategies

1. **Graceful Degradation Without AI**:
   - If AI provider quotas are exhausted (HTTP 429) or no API key is provided, MailFlow automatically switches to native Gmail search and local behavioral heuristic engines without breaking the user experience.
2. **Exponential Backoff on Gmail API**:
   - Automatic 3-stage retry with backoff multipliers for all Gmail REST API endpoints.
3. **Chunked Rate Limiting**:
   - Enforces batch limits of 10 items with 200ms sleep intervals to maintain compliance with Gmail's 250 units/sec rate limit.
4. **Data Loss Prevention**:
   - Label deletion automatically reassigns member emails to `INBOX` prior to deleting the label.
   - Permanent delete operations require explicit modal confirmations.
   - Subscription actions offer full "Undo & Restore" capabilities.

---

## 10. Directory Structure & Code Layout

```
/
├── server.ts                             # Express AI Gateway & Multi-Model Proxy
├── package.json                          # Dependencies & scripts
├── metadata.json                         # Platform capabilities & metadata
├── tsconfig.json                         # TypeScript compiler configuration
├── vite.config.ts                        # Vite & Tailwind CSS plugins
├── APP_DOCUMENTATION.md                  # Comprehensive system documentation
├── ANTIGRAVITY_SPECIFICATION.md          # Architectural engineering spec
├── src/
│   ├── main.tsx                          # React DOM root entry point
│   ├── App.tsx                           # Firebase authentication router & state gate
│   ├── index.css                         # Tailwind CSS v4 imports
│   ├── lib/
│   │   ├── firebase.ts                   # Firebase Auth & Google Provider integration
│   │   ├── gmail.ts                      # Gmail REST API client & batch execution engine
│   │   └── utils.ts                      # Tailwind class merger utility (cn)
│   └── components/
│       ├── LoginScreen.tsx               # Google OAuth login landing & permissions
│       ├── Dashboard.tsx                 # Main email cockpit, table, toolbar, search
│       ├── InboxHealth.tsx               # Analytics, sender aggregations, health metrics
│       ├── CategoryDistributionModal.tsx # Recharts donut chart for category distribution
│       ├── UnsubscribeManager.tsx        # 1-Click unsubscribe, Ghost Block, AI audit
│       ├── FolderOptimizer.tsx           # Outlier detection & smart label recommendations
│       ├── LabelManagerModal.tsx         # Two-pane label manager with drag-and-drop
│       ├── BulkOrganizeDropdown.tsx      # Multi-mode bulk organization dropdown
│       ├── HealthScoreWidget.tsx         # Circular SVG health score gauge
│       ├── OnboardingWalkthrough.tsx     # 5-step onboarding walkthrough modal
│       └── WalkthroughTip.tsx            # Dismissible contextual hint banners
```
