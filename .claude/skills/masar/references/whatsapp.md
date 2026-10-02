# WhatsApp notifications (WaNotifier)

Staff notifications go out over WhatsApp through WaNotifier. masar never talks to
WhatsApp directly.

## How a message is sent

`triggerWhatsAppNotification(type, variables, phone)` in `src/lib/actions.ts`:

1. Looks up `notification_templates` where `notificationType == type` and
   `isActive == true`.
2. Reads that template's `webhookUrl` and `variableMapping`.
3. `sendWhatsAppViaWebhook` maps the named variables onto numbered placeholders and
   POSTs `{ to, "1": …, "2": … }` to the webhook.

Phone numbers are normalised to digits and prefixed with `965` when missing.

The mapping is positional. `variableMapping` of `{"1":"recipientName","2":"studentName"}`
means the WhatsApp template's `{{1}}` receives `recipientName`. If a message arrives with
the words in the wrong slots, the mapping is wrong, not the sending code.

## The failure mode that keeps happening

A webhook URL points at one notification inside WaNotifier. **When someone deletes or
recreates that notification, the stored URL 404s and every message of that type silently
stops.** This has happened repeatedly, and has gone unnoticed for weeks at a time —
three of seven templates were dead simultaneously in September 2026.

WaNotifier answers a dead webhook with HTTP 404 and
`{"error":true,"message":"Invalid request. Notification not found."}`. Since
September 2026 that reason is surfaced in the toast and the server log rather than a
generic failure.

## Checking every template in one go

The account API key can list notifications, which makes a full health check cheap:

```js
const live = new Map((await (await fetch(
  'https://app.wanotifier.com/api/v1/notifications?key=' + KEY
)).json()).notifications.map(n => [n.webhook_key, n.title]));
// compare against each template's webhookUrl → /notifications/<key>
```

A template is healthy when its key appears in that list. Testing by POSTing to the
webhook also works — send to the unused number `96500000000` so nobody is messaged.

The key currently lives in `src/lib/actions.ts` and
`src/app/api/whatsapp/webhook/route.ts`. It is an account key, so treat it as a secret.

## What masar can and cannot do to WaNotifier

masar only ever POSTs: one call to trigger a notification, one to the messages endpoint
for replies. There is **no** code that deletes anything in WaNotifier, and none that
deletes `notification_templates`. If a notification disappears, it was removed inside
WaNotifier by someone with account access.

## Types with no template

Several notification types are raised in code but have no template, so they silently do
nothing: `application_status_update`, `inactivity_reminder`, `task_reply_received`,
`new_student_added`, `document_uploaded_student`, `internal_chat_message`,
`task_status_completed`, `task_status_denied`. Adding a template in the WA Templates
screen is enough to activate one — no code change.

## Reminder sending

Student reminders fire four times: at creation, a day before, an hour before, and five
minutes before. `src/lib/reminder-stages.ts` holds the stage logic, and
`processReminderStages()` claims stages transactionally so the cron and a page load
cannot double-send. A stage whose messages all fail is released so the next run retries
it, which is why a fixed webhook backfills automatically.

Trigger a run by hand with:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "$BASE/api/cron/reminder-notifications"
```
