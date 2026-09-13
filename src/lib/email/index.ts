// Outbound email for masar.
//
// The app had no email capability at all before this — the only outbound channel was
// WhatsApp via notification_templates webhooks. This module is deliberately thin and
// provider-agnostic so the provider can be swapped without touching call sites.
//
// Environment:
//   EMAIL_PROVIDER          'resend' (default; the only adapter implemented so far)
//   EMAIL_API_KEY           provider API key — without it, sends fail with a clear message
//   EMAIL_FROM              default sender, e.g. "Masar <noreply@yourdomain.com>"
//   EMAIL_DRY_RUN           'true' to log sends without delivering (safe for testing)
//   EMAIL_ALLOWED_DOMAINS   optional comma-separated allowlist, e.g. "q8sf.com,example.com"
//
// Every attempt — delivered, blocked, or failed — is written to the `email_log`
// Firestore collection, because an AI assistant can trigger these and that trail matters.

import { adminDb } from '@/lib/firebase/admin';
import { createResendProvider } from './providers/resend';
import type { EmailProvider, SendEmailInput, SendEmailResult } from './types';

export type { EmailAttachment, SendEmailInput, SendEmailResult } from './types';

export const EMAIL_LOG_COLLECTION = 'email_log';

function env(name: string): string | null {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
}

export function isEmailConfigured(): boolean {
  return env('EMAIL_API_KEY') !== null && env('EMAIL_FROM') !== null;
}

export function isEmailDryRun(): boolean {
  return (env('EMAIL_DRY_RUN') ?? '').toLowerCase() === 'true';
}

/** Optional recipient allowlist. Empty array means "no restriction". */
export function getAllowedDomains(): string[] {
  const raw = env('EMAIL_ALLOWED_DOMAINS');
  if (!raw) return [];
  return raw
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

export function getEmailConfigStatus() {
  return {
    provider: env('EMAIL_PROVIDER') ?? 'resend',
    configured: isEmailConfigured(),
    hasApiKey: env('EMAIL_API_KEY') !== null,
    from: env('EMAIL_FROM'),
    dryRun: isEmailDryRun(),
    allowedDomains: getAllowedDomains(),
  };
}

function resolveProvider(): { provider: EmailProvider } | { error: string } {
  const name = (env('EMAIL_PROVIDER') ?? 'resend').toLowerCase();
  const apiKey = env('EMAIL_API_KEY');
  if (!apiKey) {
    return {
      error:
        'Email is not configured: EMAIL_API_KEY is not set. Add it (plus EMAIL_FROM) to ' +
        'apphosting.yaml for production or .env.local for local development.',
    };
  }
  switch (name) {
    case 'resend':
      return { provider: createResendProvider(apiKey) };
    default:
      return { error: `Unsupported EMAIL_PROVIDER "${name}". Only "resend" is implemented.` };
  }
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function toList(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).map((v) => v.trim()).filter(Boolean);
}

/** Extracts the bare address from either "a@b.com" or "Name <a@b.com>". */
function bareAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match ? match[1] : value).trim().toLowerCase();
}

async function logAttempt(entry: Record<string, unknown>): Promise<void> {
  if (!adminDb) return;
  try {
    await adminDb.collection(EMAIL_LOG_COLLECTION).add({ ...entry, createdAt: new Date().toISOString() });
  } catch (e) {
    // A logging failure must never block or mask the send result.
    console.error('[email] Failed to write email_log entry:', e);
  }
}

export type SendEmailContext = {
  /** Who triggered this — a user id, or 'ai-assistant' / 'system'. */
  triggeredBy?: string;
  triggeredByName?: string;
  /** Free-form origin tag, e.g. 'ai-assistant' or 'late-application-report'. */
  source?: string;
};

/**
 * Send an email. Never throws — always resolves to a SendEmailResult describing what
 * happened, so callers (including tool handlers) can report the outcome verbatim.
 */
export async function sendEmail(
  input: SendEmailInput,
  context: SendEmailContext = {},
): Promise<SendEmailResult> {
  const providerName = (env('EMAIL_PROVIDER') ?? 'resend').toLowerCase();
  const dryRun = isEmailDryRun();
  const recipients = toList(input.to);

  const fail = async (error: string, extra: Record<string, unknown> = {}): Promise<SendEmailResult> => {
    await logAttempt({
      status: 'failed',
      provider: providerName,
      to: recipients,
      subject: input.subject ?? null,
      error,
      dryRun,
      ...context,
      ...extra,
    });
    return { success: false, error, provider: providerName, dryRun, to: recipients };
  };

  // --- Validation -----------------------------------------------------------
  if (recipients.length === 0) return fail('No recipient provided.');

  const invalid = recipients.filter((r) => !EMAIL_PATTERN.test(bareAddress(r)));
  if (invalid.length) return fail(`Invalid email address(es): ${invalid.join(', ')}`);

  if (!input.subject || !input.subject.trim()) return fail('Subject is required.');
  if (!input.html && !input.text) return fail('Either html or text body is required.');

  const from = input.from ?? env('EMAIL_FROM');
  if (!from) {
    return fail('Email is not configured: EMAIL_FROM is not set (e.g. "Masar <noreply@yourdomain.com>").');
  }

  // --- Recipient allowlist --------------------------------------------------
  const allowedDomains = getAllowedDomains();
  if (allowedDomains.length) {
    const blocked = [...recipients, ...toList(input.cc), ...toList(input.bcc)].filter((r) => {
      const domain = bareAddress(r).split('@')[1] ?? '';
      return !allowedDomains.includes(domain);
    });
    if (blocked.length) {
      return fail(
        `Blocked by EMAIL_ALLOWED_DOMAINS: ${blocked.join(', ')}. ` +
          `Only these domains may be emailed: ${allowedDomains.join(', ')}.`,
      );
    }
  }

  // --- Dry run --------------------------------------------------------------
  if (dryRun) {
    await logAttempt({
      status: 'dry_run',
      provider: providerName,
      from,
      to: recipients,
      cc: toList(input.cc),
      bcc: toList(input.bcc),
      subject: input.subject,
      bodyPreview: (input.text ?? input.html ?? '').slice(0, 2000),
      attachmentNames: (input.attachments ?? []).map((a) => a.filename),
      dryRun: true,
      ...context,
    });
    return {
      success: true,
      provider: providerName,
      dryRun: true,
      to: recipients,
      error: undefined,
    };
  }

  // --- Send -----------------------------------------------------------------
  const resolved = resolveProvider();
  if ('error' in resolved) return fail(resolved.error);

  const { id, error } = await resolved.provider.send(input, from);
  if (error) return fail(error);

  await logAttempt({
    status: 'sent',
    provider: providerName,
    providerMessageId: id ?? null,
    from,
    to: recipients,
    cc: toList(input.cc),
    bcc: toList(input.bcc),
    subject: input.subject,
    bodyPreview: (input.text ?? input.html ?? '').slice(0, 2000),
    attachmentNames: (input.attachments ?? []).map((a) => a.filename),
    dryRun: false,
    ...context,
  });

  return { success: true, id, provider: providerName, dryRun: false, to: recipients };
}
