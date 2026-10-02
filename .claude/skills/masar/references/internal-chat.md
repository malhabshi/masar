# The internal chat

Staff discuss a student in a thread attached to that student. It is not a general
messenger: every message must be addressed to someone, and who can read a message is
decided by who it was addressed to.

## Where it lives

```
chats/{studentId}/messages/{messageId}
```

Fields, all written server-side by `sendChatMessage` (`src/lib/actions.ts:2308-2409`):

| Field | Meaning |
|---|---|
| `authorId` | sender's user id, or the literal `'system'` |
| `content` | the text |
| `timestamp` | ISO string, not a Firestore Timestamp |
| `targetUserIds` | user ids this message is addressed to |
| `targetGroups` | `'admins'` and/or `'departments'`; `'all'` is legacy, read but never written |
| `recipientLabel` | frozen display string, e.g. "Admins, Fatemah" — never use it for access decisions |
| `document` | `{ name, url }`, present only when a file was attached |
| `readBy` | `{ userId: ISO string }` read receipts |

The chat card is rendered on the student profile
(`src/app/(app)/student/[id]/page.tsx:277-283`) and again inside a dialog on the Chat
Inbox page (`src/app/(app)/internal-chat/page.tsx`).

## Visibility is enforced in the client, not in rules

`firestore.rules:115-120` allows any signed-in user to read every message. The only
filter is `visibleMessages` in `src/components/student/student-chat.tsx:75-88`:

- your own messages, always
- `admin`: the entire thread
- `department`: addressed to them by name, or to the `departments` group
- `employee`: addressed to them by name only
- `adminplus`: falls through to "see everything"

**Any new surface that lists messages must reimplement this filter or it leaks the
thread.** Do not write a second, subtly different copy — three predicates already have to
agree (see the invariants below).

## Addressed ≠ notified

`sendChatMessage` computes `mentionedUserIds` separately (`actions.ts:2359-2366`):

- named users are notified
- `admins` notifies users whose role is exactly `admin`, so **adminplus is never notified**
  even though it can read everything
- `departments` notifies only department users whose region matches the student's
  applications, via `getDepartmentsForStudent` (`actions.ts:64-73`)

So a department user outside the student's region sees the message but gets no badge and
no WhatsApp. That is deliberate.

## Unread state lives on the student document, not the message

| Field | Who it is for | Incremented | Cleared |
|---|---|---|---|
| `chatUnreadCountByUser.{uid}` | management, per user | `actions.ts:2377`, `FieldValue.increment(1)` | client, on opening the thread (`student-chat.tsx:132`) |
| `employeeUnreadMessages` | the assigned employee | `actions.ts:2387` | client (`student-chat.tsx:134`), and `clearStudentFlagsForEveryone` |
| `updatesViewedBy` | gate on the employee counter | reset to `[]` on a new employee-addressed message | `arrayUnion(uid)` when the employee opens the thread |
| `lastChatMessageText` / `lastChatMessageTimestamp` | inbox preview and sort | every send (`actions.ts:2371-2374`) | never |
| `markedUnreadBy` | manual "mark unread", unrelated to sending | `student-header.tsx:353` | on opening the profile |

Two consequences worth holding on to. **The server increments and the client clears**, so
merely rendering the chat card zeroes the viewer's counter — mounting it off-screen would
silently wipe unread state, and lazy-mounting it would silently stop clearing. And
**clearing sets zero rather than decrementing**, so per-message unread cannot be derived
from these counters. `readBy` is the only per-message state.

Every send also bumps `lastActivityAt`, which is what the notification listener watches.

## Read receipts

`markChatMessagesRead` (`actions.ts:864-894`) records `readBy[userId]` once per message.
The first read time is immutable, so a later visit never moves it, and each receipt is
written as a single field path so concurrent readers cannot clobber one another.

The client marks messages only while the tab is actually visible
(`student-chat.tsx:93-113`), and re-checks on `visibilitychange`, so a thread left open in
a background tab is not counted as seen. The sender's own bubbles render "Seen by …"
through `src/components/shared/read-receipt.tsx`; zero readers shows "Sent".

The server re-verifies that the reader was actually addressed, so an admin reading a
message meant for someone else never appears as having seen it. That is why receipts do
not match what is rendered, and it is correct: a receipt should mean "the intended
recipient saw it".

## Toasts

`src/components/notifications/notification-listener.tsx` block 5. Management watches two
queries: students touched since the page opened, plus a backlog query
`chatUnreadCountByUser.{uid} > 0`. The backlog is the baseline — without it a student who
already owed you messages would announce itself the moment anything unrelated touched
that student. Employees watch their own portfolio instead, and a student seen for the
first time never toasts, so a transfer carrying an unread count says "Student Assigned"
rather than "New Message".

## Invariants

1. **Three targeting predicates must agree**: `visibleMessages` and `isTargetOf` in
   `student-chat.tsx`, and the server check in `markChatMessagesRead`. They differ today
   only in that admins see everything but are not counted as readers of messages not
   addressed to them.
2. **A group mention never reaches the assigned employee.** Only `targetUserIds` makes a
   message visible to an employee and only `targetUserIds` bumps their counter, so an
   `@Admins` message is invisible to them by design.
3. **System and legacy messages have no targets.** Student-creation initial notes
   (`actions.ts:1328-1337`), the inactivity cron (`actions.ts:2691`) and
   `submitInactivityReport` write bare messages with no `targetUserIds`. The employee
   counter is still incremented in the first two, which leaves a badge for a message the
   employee cannot see. Fixing this means giving those writers real targets.
4. **`employeeUnreadMessages` uses read-modify-write**, not `increment`, so simultaneous
   sends can lose a count. `chatUnreadCountByUser` does it correctly.
5. **Keep the badge queries single-filter.** `chatUnreadCountByUser.{uid} > 0` relies on
   Firestore's automatic single-field indexing of map subfields. Adding an `orderBy` or a
   second filter would need a composite index per user id, which cannot exist.
6. **Deleting a message leaves the counters and the inbox preview stale.** Only the author
   or an admin can delete (`actions.ts:2424`), and nothing is recomputed.
7. **WhatsApp fan-out is sequential and inside the action** (`actions.ts:2395-2407`), so a
   mention of every admin and department makes the send slow. Closed students skip
   WhatsApp only; the message and counters are still written.
8. **Two heavy reads to leave alone or improve deliberately**: `sendChatMessage` reads the
   whole `users` collection on every send, and the inbox reads the whole `students`
   collection for management. The sidebar and the listener are deliberately targeted —
   keep them that way.
