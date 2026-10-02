// How each company writes to us.
//
// INTO, Study Group, Merit, Navitas… each has its own subject format, reference numbers,
// way of announcing an offer, a CAS, a missing document or a change of agent, and its own
// expectations of a reply. A playbook per company is learned from a sample of its real
// emails and the agency's own replies to it, kept in `email_company_profiles`, and handed
// to every step that reads or answers an email from that company: the request reader,
// the status reader, the email memory and the reply writer.
//
// Staff notes on a company (teamNotes) override the learned playbook — the learning is
// from what happened in the mailbox, the notes are how the team wants it done.

import Anthropic from '@anthropic-ai/sdk';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { adminDb } from '@/lib/firebase/admin';
import { getAnthropicClient } from '@/lib/ai/client';
import { AI_MODEL, isAiConfigured } from '@/lib/ai/config';
import { newestMessage } from './text';

export const COMPANY_COLLECTION = 'email_company_profiles';

export type Company = { id: string; name: string; domains: string[] };

/**
 * The starting list. Companies are managed from the Email Documents page — added,
 * renamed, given more domains or removed — and stored in COMPANY_COLLECTION; these only
 * fill in for a company that has never been saved there.
 */
const DEFAULT_COMPANIES: Company[] = [
  { id: 'merit', name: 'Merit Education', domains: ['meriteducation.net'] },
  { id: 'into', name: 'INTO', domains: ['intoglobal.com', 'intostudy.com', 'education.intostudy.com'] },
  { id: 'studygroup', name: 'Study Group', domains: ['studygroup.com', 'email.studygroup.com'] },
  { id: 'navitas', name: 'Navitas', domains: ['admissions.navitas.com', 'navitas.com'] },
  { id: 'ncg', name: 'New College Group', domains: ['newcollegegroup.com'] },
  { id: 'malvern', name: 'Malvern International', domains: ['malvernplc.com'] },
  { id: 'bayswater', name: 'Bayswater Education', domains: ['bayswater.ac'] },
  { id: 'englishpath', name: 'English Path', domains: ['englishpath.com'] },
  { id: 'oxford', name: 'Oxford International', domains: ['oxfordinternational.com'] },
  { id: 'alshamlan', name: 'Alshamlan Education', domains: ['alshamlanedu.org'] },
];

export type CompanyProfile = {
  id: string;
  name: string;
  domains: string[];
  /** A default company the team removed. Kept so it does not come back from the defaults. */
  removed?: boolean;
  /** The learned playbook, plain text. */
  playbook: string;
  /** How the team wants it done; overrides the playbook. */
  teamNotes: string;
  learnedFrom: { received: number; sent: number; at: string } | null;
  updatedAt: string;
};

function db() {
  if (!adminDb) throw new Error('Database not available');
  return adminDb;
}

// --------------------------------------------------------------------------
// The company list (cached — every email step asks for it)
// --------------------------------------------------------------------------

const CACHE_MS = 10 * 60 * 1000;
let cached: { at: number; list: CompanyProfile[] } | null = null;

function blank(c: Company): CompanyProfile {
  return { id: c.id, name: c.name, domains: c.domains, playbook: '', teamNotes: '', learnedFrom: null, updatedAt: '' };
}

/** Every company: those saved by the team, plus defaults never saved. Removed ones excluded. */
export async function listCompanyProfiles(): Promise<CompanyProfile[]> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.list;
  const snap = await db().collection(COMPANY_COLLECTION).get();
  const saved = new Map(snap.docs.map((d) => [d.id, { ...(d.data() as CompanyProfile), id: d.id }]));
  const list: CompanyProfile[] = [];
  for (const c of DEFAULT_COMPANIES) if (!saved.has(c.id)) list.push(blank(c));
  for (const p of saved.values()) list.push({ ...p, domains: p.domains ?? [], playbook: p.playbook ?? '', teamNotes: p.teamNotes ?? '' });
  const visible = list.filter((p) => !p.removed).sort((a, b) => a.name.localeCompare(b.name));
  cached = { at: Date.now(), list: visible };
  return visible;
}

function forget() {
  cached = null;
}

export async function getCompanyProfile(id: string): Promise<CompanyProfile | null> {
  return (await listCompanyProfiles()).find((c) => c.id === id) ?? null;
}

/** The company an email address belongs to, by its domain (subdomains included). */
export async function companyForAddress(address: string): Promise<CompanyProfile | null> {
  const domain = address.toLowerCase().split('@')[1] ?? '';
  if (!domain) return null;
  const list = await listCompanyProfiles();
  return list.find((c) => c.domains.some((d) => domain === d || domain.endsWith(`.${d}`))) ?? null;
}

function cleanDomains(domains: string[] | string): string[] {
  const raw = Array.isArray(domains) ? domains : domains.split(/[\s,;]+/);
  return Array.from(
    new Set(
      raw
        .map((d) => d.trim().toLowerCase().replace(/^.*@/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
        .filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)),
    ),
  );
}

/** Add a company, or rename / change the domains of an existing one. */
export async function saveCompany(input: { id?: string; name: string; domains: string[] | string }) {
  const name = input.name.trim();
  const domains = cleanDomains(input.domains);
  if (!name) throw new Error('Give the company a name.');
  if (!domains.length) throw new Error('Give at least one email domain, e.g. intoglobal.com.');
  const list = await listCompanyProfiles();
  const taken = list.find((c) => c.id !== input.id && c.domains.some((d) => domains.includes(d)));
  if (taken) throw new Error(`${taken.name} already uses ${domains.filter((d) => taken.domains.includes(d)).join(', ')}.`);
  const id =
    input.id ||
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) ||
    `company-${Date.now()}`;
  await db()
    .collection(COMPANY_COLLECTION)
    .doc(id)
    .set({ id, name, domains, removed: false, updatedAt: new Date().toISOString() }, { merge: true });
  forget();
  return { id, name, domains };
}

/** Remove a company. Its playbook and notes are kept, so adding it back restores them. */
export async function removeCompany(id: string) {
  const c = await getCompanyProfile(id);
  if (!c) throw new Error('That company is not on the list.');
  await db()
    .collection(COMPANY_COLLECTION)
    .doc(id)
    .set({ id, name: c.name, domains: c.domains, removed: true, updatedAt: new Date().toISOString() }, { merge: true });
  forget();
}

/**
 * The text to put in a prompt for an email from / to this address, or '' when the
 * company has no playbook yet. Never throws.
 */
export async function playbookFor(address: string): Promise<string> {
  try {
    const p = await companyForAddress(address);
    if (!p) return '';
    // Recent company-wide notices (course closed, reopened…), recorded by notices.ts.
    const since = new Date(Date.now() - 120 * 86_400_000).toISOString();
    const notices = (await db().collection('company_notices').where('company', '==', p.name).get()).docs
      .map((d) => d.data())
      .filter((n) => String(n.date) >= since)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 12)
      .map((n) => `- ${String(n.date).slice(0, 10)} ${n.kind}: ${n.summary}`);
    if (!p.playbook && !p.teamNotes && !notices.length) return '';
    return [
      p.playbook ? `How ${p.name} works (from their past emails):\n${p.playbook}` : '',
      notices.length ? `\nRecent notices from ${p.name}:\n${notices.join('\n')}` : '',
      p.teamNotes ? `\nThe team's own notes on ${p.name} — these override the above:\n${p.teamNotes}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  } catch {
    return '';
  }
}

export async function saveCompanyNotes(id: string, teamNotes: string) {
  const company = await getCompanyProfile(id);
  if (!company) throw new Error(`Unknown company "${id}".`);
  await db()
    .collection(COMPANY_COLLECTION)
    .doc(id)
    .set({ id, name: company.name, domains: company.domains, teamNotes: teamNotes.trim(), updatedAt: new Date().toISOString() }, { merge: true });
  forget();
}

// --------------------------------------------------------------------------
// Learning a playbook from the mailbox (read-only)
// --------------------------------------------------------------------------

const LEARN_SYSTEM = `You study how one company corresponds with a Kuwaiti study-abroad agency (masar), from a sample of its real emails and the agency's own replies to it, and write a playbook the agency's AI will follow when it reads or answers this company's emails.

Write plain text with these headings, short and specific — quote the exact phrases and formats you see, do not generalise:
WHO THEY ARE: agent / pathway provider / language school / university; which universities or colleges they handle.
SUBJECT LINES & REFERENCES: the subject format(s) and the reference numbers they use (e.g. "IN:A8370810Q", "APP-833449", "2407 - NAME"); which one identifies the student.
HOW THEY SAY IT: the exact wording or pattern for each — application received; offer (conditional / unconditional) and how it arrives (attachment, portal, link); CAS; missing documents / incomplete application; rejection or course closed; change of agent / conflicting application; deadlines; payment / deposit.
WHAT THEY USUALLY ASK FOR: the documents and information they typically request.
HOW THE AGENCY REPLIES TO THEM: tone, length, language, greeting and sign-off seen in the agency's replies; whether replies stay in one thread per student; anything they insist on (e.g. which address, one email per student).
PITFALLS: things that could be misread — quoted older messages, automated notices that are not decisions, marketing, messages that look like decisions but are not.

Only write what the sample shows. If the sample does not show something, write "not seen".`;

function imapClient(): ImapFlow | null {
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASSWORD?.trim();
  if (!user || !pass) return null;
  return new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user, pass }, logger: false });
}

async function sample(client: ImapFlow, mailbox: string, criteria: object, max: number) {
  await client.mailboxOpen(mailbox, { readOnly: true });
  const uids = ((await client.search(criteria, { uid: true })) || []).slice(-max * 3);
  // Spread the sample over the period rather than taking only the latest burst.
  const step = Math.max(1, Math.floor(uids.length / max));
  const chosen = uids.filter((_, i) => i % step === 0).slice(-max);
  const out: string[] = [];
  if (!chosen.length) return out;
  for await (const m of client.fetch(chosen.join(','), { source: true }, { uid: true })) {
    if (!m.source) continue;
    const p = await simpleParser(m.source);
    const atts = (p.attachments ?? []).filter((a) => a.contentDisposition !== 'inline').map((a) => a.filename);
    out.push(
      [
        `Date: ${p.date?.toISOString().slice(0, 10) ?? ''}`,
        `From: ${p.from?.text ?? ''}`,
        `To: ${Array.isArray(p.to) ? p.to.map((t) => t.text).join(', ') : p.to?.text ?? ''}`,
        `Subject: ${p.subject ?? ''}`,
        `Attachments: ${atts.join(', ') || 'none'}`,
        newestMessage(p.text ?? '').slice(0, 1500),
      ].join('\n'),
    );
  }
  return out;
}

/** Learn (or re-learn) one company's playbook from the mailbox. Keeps the team's notes. */
export async function learnCompanyPlaybook(id: string, opts: { received?: number; sent?: number } = {}) {
  const company = await getCompanyProfile(id);
  if (!company) throw new Error(`Unknown company "${id}".`);
  if (!isAiConfigured()) throw new Error('The AI is not configured.');
  const client = imapClient();
  if (!client) throw new Error('The mailbox is not configured.');

  const received: string[] = [];
  const sent: string[] = [];
  await client.connect();
  try {
    for (const d of company.domains) {
      received.push(...(await sample(client, '[Gmail]/All Mail', { from: d }, Math.ceil((opts.received ?? 30) / company.domains.length))));
      sent.push(...(await sample(client, '[Gmail]/Sent Mail', { to: d }, Math.ceil((opts.sent ?? 12) / company.domains.length))));
    }
  } finally {
    await client.logout().catch(() => {});
  }
  if (!received.length) throw new Error(`No emails from ${company.name} were found.`);

  const res = await getAnthropicClient().messages.create({
    model: AI_MODEL,
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    system: LEARN_SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          `Company: ${company.name} (${company.domains.join(', ')})`,
          '',
          `=== ${received.length} emails FROM ${company.name} ===`,
          ...received.map((e, i) => `--- #${i + 1}\n${e}`),
          '',
          `=== ${sent.length} replies FROM the agency TO ${company.name} ===`,
          ...sent.map((e, i) => `--- #${i + 1}\n${e}`),
        ].join('\n'),
      },
    ],
  });
  const playbook = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
  if (!playbook) throw new Error('The playbook came back empty.');

  const now = new Date().toISOString();
  await db()
    .collection(COMPANY_COLLECTION)
    .doc(id)
    .set(
      {
        id,
        name: company.name,
        domains: company.domains,
        playbook,
        learnedFrom: { received: received.length, sent: sent.length, at: now },
        updatedAt: now,
      },
      { merge: true },
    );
  forget();
  return { id, name: company.name, received: received.length, sent: sent.length, playbook };
}
