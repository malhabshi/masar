# AI Assistant — foundation

An internal assistant for masar staff. It reads live Firestore data through the same
query layer the MCP integration uses, and can write reports, flag late applications,
send email, and upload documents.

**Status: built and building clean, but not yet switched on.** It needs an API key
before it will answer anything (step 1 below).

---

## What was built

| Piece | Path | Notes |
|---|---|---|
| Agent loop | `src/lib/ai/agent.ts` | Model call → run tools → feed results back, capped at 12 rounds |
| Tool surface | `src/lib/ai/tools.ts` | 14 tools; write tools hidden unless write mode is on |
| System prompt | `src/lib/ai/system-prompt.ts` | Domain context, split so the stable half is prompt-cached |
| Config | `src/lib/ai/config.ts` | Model, limits, allowed roles |
| Late applications | `src/lib/late-applications.ts` | New domain concept — see below |
| Email | `src/lib/email/` | Provider-agnostic, Resend adapter, audit log, dry-run + allowlist |
| Server-side upload | `src/lib/documents/upload.ts` | Buffer-based, no browser `File` needed |
| API | `src/app/api/ai/chat/route.ts` | `POST` to chat, `GET` for a config status probe |
| UI | `src/app/(app)/ai-assistant/page.tsx` | Chat page, admin-only, linked in the sidebar |

Everything is additive. No existing behaviour was modified except one new sidebar link.

---

## Setup

### 1. Anthropic API key (required — nothing works without it)

Get a key from <https://console.anthropic.com> → API Keys, then add to `apphosting.yaml`:

```yaml
  - variable: ANTHROPIC_API_KEY
    value: sk-ant-...
    availability:
      - RUNTIME
```

For local development, put it in `.env.local` instead (already gitignored):

```
ANTHROPIC_API_KEY=sk-ant-...
```

Until this is set, the page loads and says "Setup needed" rather than erroring.

Model is `claude-opus-5`. Cost is per token used — a typical question that reads a few
hundred students runs a few cents. The stable half of the system prompt is cached, so
follow-up questions in the same conversation are cheaper than the first.

### 2. Email (optional — only needed for the "send an email" capability)

No email service existed in masar before this; WhatsApp was the only outbound channel.
The adapter written is [Resend](https://resend.com) (free tier: 100 emails/day, 3k/month).

1. Create a Resend account, verify your sending domain, create an API key.
2. Add to `apphosting.yaml`:

```yaml
  - variable: EMAIL_API_KEY
    value: re_...
    availability:
      - RUNTIME
  - variable: EMAIL_FROM
    value: "Masar <noreply@yourdomain.com>"
    availability:
      - RUNTIME
  - variable: EMAIL_DRY_RUN          # strongly recommended at first
    value: "true"
    availability:
      - RUNTIME
```

**Start with `EMAIL_DRY_RUN=true`.** Messages are then fully validated and written to the
`email_log` Firestore collection but never delivered, so you can watch what the assistant
would send before letting it reach anyone. Set it to `false` when you are satisfied.

Optional extra guard — restrict who can ever be emailed:

```yaml
  - variable: EMAIL_ALLOWED_DOMAINS
    value: "q8sf.com"
    availability:
      - RUNTIME
```

Swapping provider later means writing one adapter in `src/lib/email/providers/` and
returning it from `resolveProvider()`. Nothing else changes.

Every attempt — sent, dry-run, or failed — is logged to `email_log` with who triggered it.

---

## Safety model

Three independent layers, because the assistant acts with real admin authority:

1. **Role gate** — admin accounts only (`AI_ALLOWED_ROLES` in `src/lib/ai/config.ts`).
2. **Write mode** — off by default, per conversation, toggled by the "Allow changes"
   switch. While off, the write tools are not even sent to the model, and the handlers
   refuse independently. The assistant can only read and report.
3. **Destructive confirm** — `run_action` reaches all 112 existing server actions through
   the MCP dispatcher, and anything marked destructive still requires `confirm: true`,
   enforced in `src/lib/mcp/dispatch.ts` exactly as it is for the MCP.

The prompt additionally instructs it to show you the exact email or upload and wait for
your approval before each one. That is guidance, not enforcement — layers 1–3 are the
enforcement.

Every answer shows a "Checked N sources" panel listing the tools it ran and their
arguments, so you can audit how it reached a number.

---

## "Late applications" — a new business rule

masar had no concept of application lateness. There is no deadline field anywhere, so
lateness is derived: **how long an application has sat in its current status**, measured
from `updatedAt` (written on every status change).

- Accepted and Rejected are final and never late.
- Closed students are excluded.
- Thresholds are per status and configurable at runtime in Firestore
  (`app_settings/late_application_rules`) — no deploy needed to change them.

### Shipped defaults, and why

Measured against production on 2026-09-14 (1,400 open students, 592 in-flight applications):

| Status | Count | Median days in status | Threshold | Flagged |
|---|---|---|---|---|
| Missing Items | 56 | 155 | 14d | 56 |
| Pending | 88 | 36 | 30d | 50 |
| Submitted | 448 | 71 | 90d | 195 |

**Total: 301 late applications.**

An aggressive 7/14/30 threshold set flagged 504 — 85% of everything in flight — which is
noise rather than a work list. The defaults above read as defensible internal SLAs rather
than numbers tuned to look good. They are a starting point; change them once you have a
view on what the agency's real SLA should be.

Two things worth knowing about the numbers:

- **The backlog is real.** Median time in `Missing Items` is 155 days, and the oldest is
  174 days. Almost every `Missing Items` application is stale regardless of threshold.
- **Timestamps only go back to 2026-03-23.** Anything that last changed status before
  then reports the same ceiling age (~174 days) rather than its true age. The tool returns
  this caveat with every result so the assistant states it instead of implying precision.

---

## Try it

Go to **AI Assistant** in the sidebar (admin only). Starting questions:

- "Which applications are late right now, and who owns them?"
- "Summarise the last 30 days: new students, applications, and where they stand."
- "Break down late applications by employee and tell me who needs help."

---

## Known gaps

- **No streaming.** The reply arrives in one piece, so a question needing several tool
  rounds shows a spinner for a while. Streaming is the obvious next improvement.
- **Conversations are not persisted.** Refreshing the page starts a new chat.
- **Attachments are base64 through the tool.** The assistant cannot read files off your
  computer; it can attach files it generated or that were pasted in.
- **`find_late_applications` scans open students** (~1,400 docs, ~3s) because Firestore
  cannot index inside the `applications` array. Passing an `employeeId` narrows it a lot.
  If this gets called constantly it is worth denormalising a per-application index.
