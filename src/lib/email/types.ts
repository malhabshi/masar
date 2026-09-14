export type EmailAttachment = {
  filename: string;
  /** Base64-encoded file content (no data: prefix). */
  content: string;
  contentType?: string;
};

export type SendEmailInput = {
  to: string | string[];
  subject: string;
  /** At least one of html/text is required. */
  html?: string;
  text?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  /** Overrides EMAIL_FROM. Must be a verified sender on the provider. */
  from?: string;
  attachments?: EmailAttachment[];
  /** RFC822 Message-ID this is a reply to — makes mail clients thread it. */
  inReplyTo?: string;
  /** Message-ID chain for threading. Usually the same as inReplyTo. */
  references?: string | string[];
};

export type SendEmailResult = {
  success: boolean;
  /** Provider-side message id, when the send succeeded. */
  id?: string;
  error?: string;
  provider: string;
  /** True when EMAIL_DRY_RUN blocked the actual send. */
  dryRun: boolean;
  /** Recipients the message was actually addressed to, after allowlist filtering. */
  to: string[];
};

export interface EmailProvider {
  readonly name: string;
  send(input: SendEmailInput, from: string): Promise<{ id?: string; error?: string }>;
}
