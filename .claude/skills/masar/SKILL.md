---
name: masar
description: How the masar CRM works — its data model, the internal chat, student profile creation, WhatsApp notifications, deployment, and the MCP server. Use this whenever working in the masar repo or answering anything about masar: students, applicants, applications, offers, the internal chat, reminders, tasks and requests, JotForm, employees and departments, or anything that touches Firestore or deploying this site. Read it before changing code here, because several of masar's rules are invisible in the code and expensive to rediscover.
---

# masar

A CRM for a Kuwaiti study-abroad agency. Staff track students from first contact through
university offers, visas and travel. Next.js 14 App Router, Firestore, Firebase App
Hosting, deployed from GitHub `main`.

This skill exists so you do not have to rediscover how masar works. The details that
actually cause bugs are in `references/`. Read the relevant one before changing that
area — each is short and answers questions the code does not.

| You are working on | Read |
|---|---|
| The internal chat, unread badges, read receipts | `references/internal-chat.md` |
| Creating students, JotForm, bulk import, the student shape | `references/student-profiles.md` |
| Anything that sends a WhatsApp, or reminders | `references/whatsapp.md` |
| Shipping, verifying a deploy, running scripts on prod data | `references/deploying.md` |
| The MCP server and its tools | `references/mcp.md` |

## The shape of the system

Everything lives in Firestore. The collections that matter, by weight of use:

```
students             ~2,000 docs, the centre of the app
users                staff accounts
tasks                ~27,000 docs — mostly notifications, not tasks (see below)
chats/{studentId}/messages      internal chat, one subcollection per student
student_reminders    scheduled reminders with staged sending
notification_templates          WhatsApp wiring
request_types        the dynamic request forms, driven by feature flags
```

Server logic is server actions in `src/lib/actions.ts` — one very large file holding
112 actions. Route handlers under `src/app/api/` cover uploads, cron and MCP. The client
reads Firestore directly through a `useCollection` / `useDoc` hook pair in
`src/firebase/`.

## Five things that will catch you out

**`students.employeeId` holds a civil ID, not a user id.** Every other reference in the
app is a Firebase Auth uid. To go from a student to their employee's user record you
must query `users where civilId == student.employeeId`. Getting this wrong silently
assigns work to nobody.

**The `tasks` collection is three things wearing one coat.** `category` decides which:
`request` is a real request from the /tasks page (~6,600), `system` is an automated
notification (~20,000), `update` is a management broadcast to staff (~15). Any query over
`tasks` that does not filter by category is almost certainly wrong, and will be slow.

**Timestamps are ISO strings, everywhere.** `createdAt`, `lastActivityAt`, `uploadedAt`
and the rest are strings, not Firestore Timestamps, so they are compared
lexicographically. This works, and it is deliberate — do not "fix" it to Timestamps
without migrating every comparison.

**Feature flags live in Firestore, not in code.** `request_types.specialConfig` gates
the dynamic task form: `useApprovedUniversitiesList`, `allowMultipleUniversitySelection`,
`countryFilter`, `skipCompanyLimit`, `firstYearUkFields`, `allowPortalReferenceSelection`,
`examTypes`. Shipping code that reads a new flag changes nothing until the flag is set on
the right request type. Set it and say so, or the owner will report the feature as broken.

**Data is inconsistent, and normalising is the caller's job.** The same student holds
both "Pharmacology" and "pharmacology". University names use a curly apostrophe
("Queen’s") while document names use a straight one. Trailing spaces are common
("IELTS Course "). Compare with case folded, whitespace collapsed and apostrophes
normalised.

## Roles

`admin`, `adminplus`, `department`, `employee`, and `student` (unused in the staff app).
A `department` user has a `department` of `UK`, `USA` or `AU/NZ` and only sees students
with an application in that region.

Admins and departments can flip into an employee view. `useUser()` returns both `role`
and `effectiveRole`, where `effectiveRole` respects that toggle. Use `effectiveRole` for
what the screen shows, and `role` for what the person is allowed to do. `adminplus`
never toggles.

## Working with the owner

The owner is the agency's admin, not a developer, and reads results rather than code.

- **Push only when asked.** A push to `main` goes straight to production. They say
  "push" when they want it. They then ask "is it pushed?" — answer with the actual
  `origin/main` sha and unpushed count.
- **Write plainly.** Short sentences, no jargon, no code in prose. When they say they are
  lost, stop adding options and give them the one next step.
- **Verify before claiming.** They have been given wrong "it works" answers by testing in
  the wrong environment. Test the way production runs, then say what you checked.
- **Never push the `ai-assistant` branch** without explicit permission for that push.
- **Never delete emails**, and never leave test records in the database.

## Known open items

Accurate as of 2026-09-25; re-check before relying on any line.

- The sidebar still downloads about 4 MB per page for an admin: a task badge streaming
  ~6,500 task documents and a Finalized badge streaming ~170 fat student documents. Both
  only need counts. The owner has deferred this.
- `/api/download` and `/api/proxy-image` are unauthenticated open proxies that will fetch
  any URL. They should be restricted to the project's storage bucket.
- Around 33 server actions trust a `userId` passed by the caller instead of verifying it.
- `AlertDialogFooter` and `SheetFooter` still use non-wrapping `sm:space-x-2`, the same
  bug already fixed in `DialogFooter`.
- A `/simple-test` page and a dead `vercel.json` are left over and can be removed.
