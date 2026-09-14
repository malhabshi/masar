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
| Chat responder | `src/lib/ai/chat-responder.ts` | Reads internal staff chat and replies / creates tasks |
| Bot identity | `src/lib/ai/chat-bot.ts` | "Masar AI" user + responder settings |
| Responder API | `src/app/api/ai/chat-responder/route.ts` | `POST` to wake it, `GET`/`PATCH` for settings |

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
Three providers are supported: **gmail**, **smtp** (any server), and **resend**.

#### Option A — Gmail / Google Workspace (simplest if you already have an account)

Gmail needs an **App Password**, not your normal password:

1. Google Account → Security → turn on **2-Step Verification** (required).
2. Security → **App passwords** → create one for "Mail". Google shows a 16-character code.
3. Add to `.env.local` (or `apphosting.yaml` for production):

```
EMAIL_PROVIDER=gmail
SMTP_USER=you@yourdomain.com
SMTP_PASSWORD=the16charapppassword
EMAIL_DRY_RUN=true
```

`EMAIL_FROM` is optional here — it defaults to `SMTP_USER`, and Gmail rewrites the From
header to the authenticated account anyway unless the address is a verified
"Send mail as" alias.

Limits: ~500 recipients/day on a free Gmail account, ~2,000/day on Google Workspace.
Replies come back to that mailbox, which is usually what you want for chasing students.

#### Option B — Resend (better for volume and deliverability)

Free tier: 100 emails/day, 3k/month. Requires domain verification.

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

## Internal chat responder

The AI reads **every** new message in a student's internal staff chat, and decides for
itself whether to help. When it does, it can answer from the student's record and create
a task from what an employee asked for.

**It is off by default, and even once enabled it starts in watch-only mode.** Controls are
on the AI Assistant page (admin only):

| Switch | Default | What it does |
|---|---|---|
| Enabled | **off** | Master switch. While off, nothing runs and nothing is charged. |
| Watch only | **on** | It decides and drafts, but posts nothing. Drafts go to `ai_chat_log`. |
| Can create tasks | on | Allows `create_task` when an employee asks for something. |

**Run it in watch-only for a while first.** Read `ai_chat_log` and check its judgement —
whether it stayed quiet when it should have, and whether the replies it drafted were
right. Only turn "Watch only" off once you trust it, because at that point it is talking
to your staff under the name **Masar AI**.

### How it gets triggered

There is no background job. When someone sends a chat message, their browser fires a
request at `/api/ai/chat-responder` and does not wait for it — so the sender never sits
waiting on the AI. The endpoint also accepts a `CRON_SECRET` bearer token if you later
want a scheduled sweep.

### Guards

- **Loop guard** — it never reacts to its own messages.
- **Duplicate guard** — each message id is claimed in a Firestore transaction
  (`ai_chat_state/{studentId}`), so two triggers for the same message produce one reply.
- **Muting** — `mutedStudentIds` skips individual students.
- **Bias toward silence** — the prompt tells it that staying quiet is the normal outcome,
  and it must call `stay_silent` with a reason, which is logged for review.

### Bot identity

A `users/masar-ai-assistant` document is created on first use so its messages render with
a name. It has no phone (so it is never sent WhatsApp notifications) and no civil ID (so
it never appears in employee-portfolio queries).

### What to watch out for

It reads every message, so it will sometimes speak when nobody wanted it to — that is the
tradeoff of this mode over "only when tagged". Staff chat is a mix of English and Arabic;
the prompt tells it to reply in the language used, but this is the part most worth
checking during watch-only. And a task it creates is a real task, so keep "Can create
tasks" off until you have seen its judgement on a few real requests.

---

## Email document intake

Students email documents in; this reads the mailbox, works out who each one belongs to,
and attaches it to their profile. Page: **Email Documents** (admin only).

### The matching rule

A document is filed automatically **only when exactly one student's complete registered
name appears in the email** (sender display name, subject or body). Everything else goes
to a review queue where a human picks the student.

This was chosen against measured production data (2026-09-14, 1,400 open students):

| Key | Uniquely identifies |
|---|---|
| Full name | **100%** — zero collisions |
| First + last name | 97.2% — 39 students ambiguous |
| Email address | 38.8% — most students have no address on file |

Full names never collide because of the stored middle initials:
`FAISAL A S S ALMUTAIRI` vs `FAISAL F M S ALMUTAIRI` are two different people, and an
email saying only "Faisal Almutairi" matches **neither** — it goes to review. That is
deliberate. Misfiling a passport onto the wrong profile is a silent, expensive error;
a few clicks a week is not.

Names are normalised (case, punctuation, whitespace) and matched on whole-word
boundaries. Arabic-script names work. Students whose stored name is a single word
(27 of them) are excluded from auto-matching — one token is too weak a signal.

### Announcing it in the internal chat

Every identified email is posted into that student's internal staff chat as **Masar AI**,
with a one-line AI summary of what the student is saying or asking for, plus the list of
files attached to the profile. Three groups are notified:

- **the assigned employee** — `student.employeeId` is a civil ID, so it is resolved to a
  user id first (verified: 0 of 699 assigned students fail this lookup)
- **all admins**
- **the relevant department** — derived from the student's application countries, so a UK
  applicant reaches the UK department and an Australian one reaches AU/NZ

This is how staff find out at all; the document counters alone are easy to miss.
Manually-filed items from the review queue are announced the same way.

### Revised documents — checking the offer is still current

Offer letters get reissued with changed conditions, and a revised offer filed quietly
alongside the old one means staff act on stale terms. So when an incoming document looks
like a newer version of one already on the profile (matched on the generated document
name — "University of Bath - ISC Offer Letter"), the PDF text of both versions is
extracted and compared, and the differences are stated in the chat note:

```
⚠️ University of Bath - ISC Offer Letter is a NEW VERSION of the one on file
   from 2026-09-09. What changed:
   - Tuition fee changed: GBP 27,250.00 → GBP 19,500.00
   - Course dates 28 Sep 2026–28 May 2027 → 21 Sep 2026–11 Jun 2027
   - Interview requirement during foundation year removed
```

The comparison reports only material changes — conditions, deadlines, fees, course,
intake, English requirements, offer type. Formatting, reference numbers and print dates
are ignored. Verified against two real 7-page Study Group offer letters: identical input
returns "no material change", and genuinely different offers produce the list above.

**The old document is never deleted or overwritten** — both versions stay on the profile
so the history is intact.

Three outcomes, so a resend is never confused with a revision:

| Incoming file | Result |
|---|---|
| Byte-identical to one on file | Skipped, noted as "nothing new to review" |
| Same document, different content | Filed **and** flagged with what changed |
| Not seen before | Filed normally |

PDF text extraction uses `pdf-parse`. It and `pdfjs-dist` are listed in
`serverComponentsExternalPackages` in `next.config.mjs` — webpack otherwise rewrites
pdfjs into something broken that silently returns no text.

### What gets picked up

Unread messages with at least one attachment of a plausible document type (PDF, PNG,
JPEG, HEIC, WEBP, DOC, DOCX) under 20 MB. Inline images — signatures and logos — are
ignored. Messages are marked read only after being dealt with, so a crash means a retry
rather than a lost document.

### Running it

Press **Check inbox now** on the page, or POST to `/api/email/intake` with a
`CRON_SECRET` bearer token for a scheduled sweep. Queued items are stored in
`email_intake_queue`; everything filed is logged to `email_intake_log`.

Reading uses IMAP (`imap.gmail.com:993`) with the same App Password as sending. IMAP must
be enabled in Gmail (Settings → Forwarding and POP/IMAP), and a Workspace admin can
disable it org-wide.

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
