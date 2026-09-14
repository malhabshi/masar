import type { EmailProvider, SendEmailInput } from '../types';

/**
 * Resend adapter. Uses the plain HTTPS API rather than the `resend` npm package so the
 * app takes on no extra dependency — the endpoint is a single JSON POST.
 * Docs: https://resend.com/docs/api-reference/emails/send-email
 */
export function createResendProvider(apiKey: string): EmailProvider {
  return {
    name: 'resend',
    async send(input: SendEmailInput, from: string) {
      const body: Record<string, unknown> = {
        from,
        to: input.to,
        subject: input.subject,
      };
      if (input.html) body.html = input.html;
      if (input.text) body.text = input.text;
      if (input.cc) body.cc = input.cc;
      if (input.bcc) body.bcc = input.bcc;
      if (input.replyTo) body.reply_to = input.replyTo;
      if (input.inReplyTo || input.references) {
        const refs = Array.isArray(input.references) ? input.references.join(' ') : input.references;
        body.headers = {
          ...(input.inReplyTo ? { 'In-Reply-To': input.inReplyTo } : {}),
          ...(refs ? { References: refs } : {}),
        };
      }
      if (input.attachments?.length) {
        body.attachments = input.attachments.map((a) => ({
          filename: a.filename,
          content: a.content,
          ...(a.contentType ? { content_type: a.contentType } : {}),
        }));
      }

      let response: Response;
      try {
        response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
      } catch (e) {
        return { error: `Could not reach Resend: ${e instanceof Error ? e.message : String(e)}` };
      }

      const payload = (await response.json().catch(() => null)) as
        | { id?: string; message?: string; name?: string }
        | null;

      if (!response.ok) {
        const detail = payload?.message || payload?.name || `HTTP ${response.status}`;
        return { error: `Resend rejected the message: ${detail}` };
      }
      return { id: payload?.id };
    },
  };
}
