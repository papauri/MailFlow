# MailFlow

**MailFlow** is an AI-powered Gmail management platform, high-throughput inbox cleaner, and automated subscription auditor built with React 19, TypeScript, Tailwind CSS v4, and an Express AI gateway.

For complete, detailed technical architecture and feature documentation, see **[APP_DOCUMENTATION.md](./APP_DOCUMENTATION.md)**.

---

## Key Features

1. **Natural Language Search Translation**: Converts plain-English queries (e.g. *"receipts older than 6 months over 5MB"*) into precise, valid Gmail search operators.
2. **High-Throughput Bulk Operations**: Chunk-based processing for bulk trashing, permanent deletion, archiving, and label modification respecting Gmail API rate limits (250 quota units/sec).
3. **Inbox Health & Analytics**: Live health score gauge, unread metrics, storage hogs, stale promotional backlogs, and interactive Recharts category distribution donut chart.
4. **Subscription Manager**: Detects `List-Unsubscribe` headers for 1-Click Unsubscribing, plus "Ghost Blocking" (automatic trashing and blocking) for aggressive senders, complete with persistent audit logs and 1-click undo/restore.
5. **Smart Folder Optimizer**: Uses AI and local behavioral heuristics to group unorganized emails and outliers, offering 1-click batch filing into existing or new Gmail labels.
6. **Two-Pane Label Manager**: Interactive sidebar with live message counts, drag-and-drop email assignment, and safe label deletion that automatically preserves contained emails in the inbox.
7. **Multi-Model AI Gateway (BYOK)**: Supports dynamic model selection and user-provided API keys across Google Gemini, OpenAI, Anthropic Claude, DeepSeek, Groq, Mistral, and Zhipu AI.
