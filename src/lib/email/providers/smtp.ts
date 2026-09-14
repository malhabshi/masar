import nodemailer, { type Transporter } from 'nodemailer';
import type { EmailProvider, SendEmailInput } from '../types';

/**
 * SMTP adapter — covers Gmail / Google Workspace and any other SMTP server.
 *
 * Gmail requires an **App Password**, not the account password: 2-Step Verification must
 * be on, then Google generates a 16-character password for this app. Normal passwords are
 * rejected outright, and OAuth would need a consent flow this doesn't have.
 *
 * Gmail also rewrites the From header to the authenticated account unless the address is
 * a verified "Send mail as" alias, so EMAIL_FROM should normally match SMTP_USER.
 */
export function createSmtpProvider(config: {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  label: string;
}): EmailProvider {
  let transporter: Transporter | null = null;

  const getTransport = () => {
    if (!transporter) {
      transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure, // true for 465, false for 587 (which upgrades via STARTTLS)
        auth: { user: config.user, pass: config.password },
      });
    }
    return transporter;
  };

  return {
    name: config.label,
    async send(input: SendEmailInput, from: string) {
      try {
        const info = await getTransport().sendMail({
          from,
          to: Array.isArray(input.to) ? input.to.join(', ') : input.to,
          subject: input.subject,
          ...(input.text ? { text: input.text } : {}),
          ...(input.html ? { html: input.html } : {}),
          ...(input.cc ? { cc: Array.isArray(input.cc) ? input.cc.join(', ') : input.cc } : {}),
          ...(input.bcc ? { bcc: Array.isArray(input.bcc) ? input.bcc.join(', ') : input.bcc } : {}),
          ...(input.replyTo ? { replyTo: input.replyTo } : {}),
          ...(input.attachments?.length
            ? {
                attachments: input.attachments.map((a) => ({
                  filename: a.filename,
                  content: Buffer.from(a.content, 'base64'),
                  ...(a.contentType ? { contentType: a.contentType } : {}),
                })),
              }
            : {}),
        });
        return { id: info.messageId };
      } catch (e) {
        const raw = e instanceof Error ? e.message : String(e);
        // Translate the two failures people actually hit into something actionable.
        if (/Invalid login|Username and Password not accepted|BadCredentials/i.test(raw)) {
          return {
            error:
              'Gmail rejected the login. Use a 16-character App Password (Google Account → ' +
              'Security → 2-Step Verification → App passwords), not your normal password.',
          };
        }
        if (/self signed|certificate|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(raw)) {
          return { error: `Could not reach the SMTP server (${config.host}:${config.port}): ${raw}` };
        }
        return { error: `SMTP send failed: ${raw}` };
      }
    },
  };
}

/** Gmail / Google Workspace preset. Port 587 + STARTTLS is the supported combination. */
export function createGmailProvider(user: string, appPassword: string): EmailProvider {
  return createSmtpProvider({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    user,
    password: appPassword,
    label: 'gmail',
  });
}
