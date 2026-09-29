// Watches the Kuwait Cultural Office (kcouk.org) for changes that matter to students.
//
// Deliberately NOT a 'use server' module: every export of a server-action file becomes
// an endpoint any browser can call, and nobody outside the scheduler should be able to
// make this site hammer someone else's server.
//
// Three things are watched:
//
//   1. New announcements, from the WordPress posts feed. "Students Achievements" is left
//      out — it is congratulation posts, and at 2–3 a week it would bury everything else.
//   2. A chosen set of pages. WordPress reports a last-modified date per page, so a page
//      is only downloaded when that date moves, and an alert is raised only when the
//      page's actual text or its file links differ. A re-save with no real edit is silent.
//   3. The files those pages link to. The distinguished-universities "list" is a PDF,
//      and the page around it almost never changes, so the file itself has to be watched.
//      A HEAD request returns its fingerprint without downloading it, which also catches a
//      replacement uploaded under the same name.
//
// Pages are read through the WordPress REST API rather than scraped, because a scraped
// page carries the "latest posts" sidebar — every watched page would appear to change
// whenever anything at all was published.
//
// The first run records the site as it stands and raises nothing. Without that, the
// first day would bring an alert for every page and every recent post.

import { adminDb } from '@/lib/firebase/admin';

const SITE = 'https://www.kcouk.org';
const STATE_DOC = 'kcouk';
const USER_AGENT = 'masar-site-watch/1.0 (study-abroad CRM; checks public pages once a day)';

/** Once a day, as the owner asked: these offices post a few times a week at most. */
const INTERVAL_MS = 24 * 60 * 60 * 1000;
/** One slow response must not stall the reminder job this runs alongside. */
const REQUEST_TIMEOUT_MS = 15_000;
/** Stop starting new requests past this point, whatever is left. */
const RUN_BUDGET_MS = 60_000;

/** WordPress category id for "Students Achievements" — congratulation posts. */
const IGNORED_CATEGORY_IDS = [127];

/** The pages the owner chose to watch, grouped as they were agreed. */
export const WATCHED_PAGES: { slug: string; group: string }[] = [
  // University and institute lists
  { slug: 'distinguished-universities-list-2', group: 'Lists' },
  { slug: 'distinguished-scholarship-2', group: 'Lists' },
  { slug: 'approved-english-language-institutes-2025-2026', group: 'Lists' },
  { slug: 'how-to-look-for-approved-and-distinguished-universities', group: 'Lists' },
  // Rules and regulations
  { slug: 'mohe-sponsor-info', group: 'Rules' },
  { slug: 'equivalency-regulations', group: 'Rules' },
  { slug: 'csc-rules-regulations-arabic', group: 'Rules' },
  { slug: 'csc-rules-regulations-english', group: 'Rules' },
  { slug: 'paaet-rules-regulations', group: 'Rules' },
  { slug: 'kuwait-university-rules-regulations', group: 'Rules' },
  // Student guidance
  { slug: 'start-joining-the-scholarship-and-study-in-the-united-kingdom-for-new-students-step-by-step', group: 'Guidance' },
  { slug: 'visa-procedures', group: 'Guidance' },
  { slug: 'financial-allowances', group: 'Guidance' },
  { slug: 'kco-announcements', group: 'Guidance' },
];

export type SiteWatchAlertKind = 'post' | 'page_changed' | 'page_new' | 'file_changed';

export interface SiteWatchAlert {
  /** Short machine id of the source, e.g. 'kcouk', 'mohe-news'. */
  site: string;
  /** What the card shows as the source, e.g. 'MOHE · News'. */
  siteName: string;
  kind: SiteWatchAlertKind;
  title: string;
  url: string;
  summary: string;
  added?: string[];
  removed?: string[];
  addedCount?: number;
  removedCount?: number;
  createdAt: string;
  readBy: string[];
}

interface PageSnapshot {
  slug: string;
  title: string;
  url: string;
  modified: string;
  lines: string[];
  files: Record<string, string>; // url -> fingerprint
}

export interface SiteWatchResult {
  ran: boolean;
  reason?: string;
  baseline?: boolean;
  alerts: number;
  requests: number;
  errors: string[];
}

// ---------------------------------------------------------------------------- text --

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…',
  ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  laquo: '«', raquo: '»',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** WordPress "smart quotes" every attribute quote, so a shortcode's quotes can be any of these. */
const QUOTE = `["“”″]`;

/**
 * A page body as a list of readable lines.
 *
 * Block-level closing tags become line breaks before tags are stripped, so a list of
 * universities stays one university per line and a diff can say exactly which one was
 * added. WPBakery's raw shortcodes leak into the REST output on this site. They are
 * layout and are removed — except their `title` attribute, which on this site carries
 * real policy text: the approved-institutes page states who may use the list in a
 * separator's title, and dropping it would miss exactly the change that matters.
 */
function htmlToLines(html: string): string[] {
  const text = html
    .replace(/\[\/?vc_[^\]]*\]/gi, shortcode => {
      const title = decodeEntities(shortcode).match(new RegExp(`\\btitle=${QUOTE}([^"“”″]+)${QUOTE}`));
      return title ? `\n${title[1]}\n` : ' ';
    })
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|td|th|section|article|blockquote|figcaption)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(text)
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const DOC_EXT = '(?:pdf|docx?|xlsx?|pptx?)';

/**
 * Documents on a page — the lists that actually matter usually live in these.
 *
 * Plain links are not enough on this site. Most of its PDFs are shown in a flipbook
 * viewer whose file address sits inside a <script> as JSON, with its slashes escaped
 * (`http:\/\/www.kcouk.org\/…pdf`) and no href anywhere. So every absolute address to a
 * document is taken from the raw page, as well as every relative href.
 */
function fileLinks(html: string): string[] {
  const src = decodeEntities(html).replace(/\\\//g, '/');
  const found = [
    ...[...src.matchAll(new RegExp(`(?:https?:)?//[^\\s"'<>()\\\\]+?\\.${DOC_EXT}(?=[?#"'\\s<>)\\\\]|$)`, 'gi'))].map(m => m[0]),
    ...[...src.matchAll(new RegExp(`href\\s*=\\s*["']([^"']+?\\.${DOC_EXT})(?:[?#][^"']*)?["']`, 'gi'))].map(m => m[1]),
  ];
  const out = new Set<string>();
  for (const raw of found) {
    try {
      const u = new URL(raw, SITE);
      // The site links the same file over http and https in different places; treat
      // them as one, or a switch between the two would read as a file replaced.
      if (/(^|\.)kcouk\.org$/i.test(u.hostname)) u.protocol = 'https:';
      u.hash = '';
      out.add(u.toString());
    } catch {
      /* a malformed address is not worth failing a run over */
    }
  }
  return [...out];
}

function fileName(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() || url);
  } catch {
    return url;
  }
}

/** Order-preserving difference: what appears in one list of lines and not the other. */
function lineDiff(before: string[], after: string[]) {
  const was = new Set(before);
  const now = new Set(after);
  return {
    added: after.filter(l => !was.has(l)),
    removed: before.filter(l => !now.has(l)),
  };
}

/** Enough to recognise the change on screen; the link carries the rest. */
function sample(lines: string[], max = 8): string[] {
  return lines.slice(0, max).map(l => (l.length > 220 ? `${l.slice(0, 217)}…` : l));
}

// ---------------------------------------------------------------------------- http --

class Fetcher {
  requests = 0;
  constructor(private readonly deadline: number) {}

  get outOfTime() {
    return Date.now() > this.deadline;
  }

  async json<T>(path: string): Promise<{ data: T; headers: Headers }> {
    this.requests++;
    const res = await fetch(`${SITE}${path}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
    return { data: (await res.json()) as T, headers: res.headers };
  }

  /**
   * A file's fingerprint without downloading it, or null when it could not be read.
   * Null is never compared: a timeout or a blip must not be reported as a changed file.
   */
  async fingerprint(url: string): Promise<string | null> {
    this.requests++;
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        cache: 'no-store',
        redirect: 'follow',
      });
      if (!res.ok) return null;
      const parts = [
        res.headers.get('etag'),
        res.headers.get('last-modified'),
        res.headers.get('content-length'),
      ];
      return parts.some(Boolean) ? parts.map(p => p ?? '').join('|') : null;
    } catch {
      return null;
    }
  }
}

// ----------------------------------------------------------------------------- run --

type WpPost = {
  id: number;
  link: string;
  date_gmt: string;
  title: { rendered: string };
  excerpt?: { rendered: string };
  categories: number[];
};
type WpPageMeta = { id: number; slug: string; link: string; modified_gmt: string; title: { rendered: string } };
type WpPage = WpPageMeta & { content: { rendered: string } };

/**
 * Check the site once, if it is due.
 *
 * The claim on `lastRunAt` happens in a transaction before any request goes out, so two
 * overlapping scheduler calls cannot both run it. A run that fails part-way still counts
 * as a run — it retries at the next interval rather than on the next five-minute tick.
 */
export async function runSiteWatch(opts: { force?: boolean } = {}): Promise<SiteWatchResult> {
  if (!adminDb) return { ran: false, reason: 'DB not available', alerts: 0, requests: 0, errors: [] };
  const db = adminDb;
  const stateRef = db.collection('site_watch').doc(STATE_DOC);
  const pagesRef = stateRef.collection('pages');
  const now = new Date().toISOString();

  const claim = await db.runTransaction(async tx => {
    const snap = await tx.get(stateRef);
    const last = snap.exists ? (snap.data()?.lastRunAt as string | undefined) : undefined;
    if (!opts.force && last && Date.now() - Date.parse(last) < INTERVAL_MS) return null;
    tx.set(stateRef, { lastRunAt: now }, { merge: true });
    return { data: snap.exists ? snap.data() ?? {} : null };
  });
  if (!claim) return { ran: false, reason: 'not due', alerts: 0, requests: 0, errors: [] };

  const baseline = claim.data === null || !claim.data.baselinedAt;
  const fetcher = new Fetcher(Date.now() + RUN_BUDGET_MS);
  const alerts: SiteWatchAlert[] = [];
  const errors: string[] = [];
  const raise = (a: Omit<SiteWatchAlert, 'site' | 'siteName' | 'createdAt' | 'readBy'>) => {
    if (!baseline) alerts.push({ ...a, site: 'kcouk', siteName: 'Kuwait Cultural Office · London', createdAt: new Date().toISOString(), readBy: [] });
  };

  const seenPostIds: number[] = (claim.data?.seenPostIds as number[]) ?? [];
  const knownSlugs: string[] = (claim.data?.knownSlugs as string[]) ?? [];
  let nextSeenPostIds = seenPostIds;
  let nextKnownSlugs = knownSlugs;

  // 1. Announcements ------------------------------------------------------------------
  try {
    const { data: posts } = await fetcher.json<WpPost[]>(
      '/wp-json/wp/v2/posts?per_page=20&_fields=id,link,date_gmt,title,excerpt,categories',
    );
    const seen = new Set(seenPostIds);
    for (const p of posts) {
      if (seen.has(p.id)) continue;
      if (p.categories?.some(c => IGNORED_CATEGORY_IDS.includes(c))) continue;
      const title = decodeEntities(p.title.rendered);
      const excerpt = htmlToLines(p.excerpt?.rendered || '').join(' ');
      // Many posts here have no excerpt of their own, and WordPress then offers the title
      // back — which would print the same words twice on the card.
      const summary = !excerpt || excerpt === title.trim()
        ? 'New announcement on the Cultural Office site.'
        : excerpt.length > 280 ? `${excerpt.slice(0, 277)}…` : excerpt;
      raise({ kind: 'post', title, url: p.link, summary });
    }
    // Remember every id seen, ignored ones included, so they are never reconsidered.
    nextSeenPostIds = [...new Set([...posts.map(p => p.id), ...seenPostIds])].slice(0, 200);
  } catch (e) {
    errors.push(`posts: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 2. Pages: new ones anywhere on the site, and edits to the watched ones -----------
  let pageList: WpPageMeta[] = [];
  try {
    for (let page = 1; page <= 3 && !fetcher.outOfTime; page++) {
      const { data, headers } = await fetcher.json<WpPageMeta[]>(
        `/wp-json/wp/v2/pages?per_page=100&page=${page}&_fields=id,slug,link,modified_gmt,title`,
      );
      pageList.push(...data);
      if (page >= Number(headers.get('x-wp-totalpages') || 1)) break;
    }
  } catch (e) {
    errors.push(`pages: ${e instanceof Error ? e.message : String(e)}`);
    pageList = [];
  }

  if (pageList.length > 0) {
    // A new page is how next year's approved-institutes list will most likely arrive —
    // under a new address, which the watched list would otherwise never see.
    if (knownSlugs.length > 0) {
      const known = new Set(knownSlugs);
      for (const p of pageList) {
        if (known.has(p.slug)) continue;
        raise({
          kind: 'page_new',
          title: decodeEntities(p.title.rendered) || decodeURIComponent(p.slug),
          url: p.link,
          summary: 'A new page was published on the Cultural Office site.',
        });
      }
    }
    nextKnownSlugs = pageList.map(p => p.slug);
  }

  const bySlug = new Map(pageList.map(p => [p.slug, p]));
  const writes: { slug: string; snapshot: PageSnapshot }[] = [];
  // One file can be linked from several pages — merit2025.pdf sits on three — and a
  // replacement is one event, not three. Each file is also fingerprinted once per run.
  const fingerprints = new Map<string, string | null>();
  const alertedFiles = new Set<string>();

  for (const { slug } of WATCHED_PAGES) {
    if (fetcher.outOfTime) {
      errors.push('ran out of time before every page was checked');
      break;
    }
    const meta = bySlug.get(slug);
    if (!meta) continue; // the page list failed, or the page was removed — not a guess worth alerting on

    const storedSnap = await pagesRef.doc(slug).get();
    const stored = storedSnap.exists ? (storedSnap.data() as PageSnapshot) : null;
    const title = decodeEntities(meta.title.rendered) || slug;

    let current: PageSnapshot;
    if (stored && stored.modified === meta.modified_gmt) {
      current = { ...stored, title, url: meta.link };
    } else {
      try {
        const { data } = await fetcher.json<WpPage>(
          `/wp-json/wp/v2/pages/${meta.id}?_fields=id,slug,link,modified_gmt,title,content`,
        );
        const html = data.content?.rendered || '';
        const links = fileLinks(html);
        current = {
          slug,
          title,
          url: meta.link,
          modified: meta.modified_gmt,
          lines: htmlToLines(html),
          // Carry fingerprints forward for files still linked; new ones are read below.
          files: Object.fromEntries(links.map(u => [u, stored?.files?.[u] ?? ''])),
        };
      } catch (e) {
        errors.push(`${slug}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }

      // Only a new page snapshot is compared; a watched page seen for the first time is
      // recorded silently, the same as the very first run.
      if (stored) {
        const text = lineDiff(stored.lines, current.lines);
        const fileDiff = lineDiff(Object.keys(stored.files || {}), Object.keys(current.files));
        const hasText = text.added.length > 0 || text.removed.length > 0;
        const hasFiles = fileDiff.added.length > 0 || fileDiff.removed.length > 0;
        if (hasText || hasFiles) {
          const bits: string[] = [];
          if (fileDiff.added.length) bits.push(`new file: ${fileDiff.added.map(fileName).join(', ')}`);
          if (fileDiff.removed.length) bits.push(`file removed: ${fileDiff.removed.map(fileName).join(', ')}`);
          if (hasText) bits.push(`${text.added.length} line(s) added, ${text.removed.length} removed`);
          raise({
            kind: 'page_changed',
            title,
            url: meta.link,
            summary: `This page was edited — ${bits.join('; ')}.`,
            added: sample([...fileDiff.added.map(u => `📄 ${fileName(u)}`), ...text.added]),
            removed: sample([...fileDiff.removed.map(u => `📄 ${fileName(u)}`), ...text.removed]),
            addedCount: text.added.length + fileDiff.added.length,
            removedCount: text.removed.length + fileDiff.removed.length,
          });
        }
      }
    }

    // 3. The files themselves ---------------------------------------------------------
    for (const url of Object.keys(current.files)) {
      if (!fingerprints.has(url)) {
        if (fetcher.outOfTime) break;
        fingerprints.set(url, await fetcher.fingerprint(url));
      }
      const fp = fingerprints.get(url) ?? null;
      if (fp === null) continue; // unreadable this time: keep the old fingerprint, say nothing
      const before = current.files[url];
      if (stored && before && before !== fp && !alertedFiles.has(url)) {
        alertedFiles.add(url);
        raise({
          kind: 'file_changed',
          title: `${fileName(url)} was replaced`,
          url,
          summary: `The file linked from "${title}" was re-uploaded under the same name, so its contents may have changed.`,
        });
      }
      current.files[url] = fp;
    }

    writes.push({ slug, snapshot: current });
  }

  // Persist ----------------------------------------------------------------------------
  const batch = db.batch();
  for (const { slug, snapshot } of writes) batch.set(pagesRef.doc(slug), snapshot);
  for (const a of alerts) batch.set(db.collection('site_watch_alerts').doc(), a);
  batch.set(
    stateRef,
    {
      seenPostIds: nextSeenPostIds,
      knownSlugs: nextKnownSlugs,
      lastCompletedAt: new Date().toISOString(),
      lastErrors: errors,
      lastRequests: fetcher.requests,
      ...(baseline && errors.length === 0 ? { baselinedAt: new Date().toISOString() } : {}),
    },
    { merge: true },
  );
  await batch.commit();

  return { ran: true, baseline, alerts: alerts.length, requests: fetcher.requests, errors };
}

// =====================================================================================
// Lists of items on ordinary web pages — every other source works this way.
//
// None of these sites offers a data feed, so the page is read as HTML and every link
// that looks like an item (a news story, an announcement, a decision PDF) is collected.
// A link not seen before is a new item. Only additions are reported: an item leaving
// the first page of a list is paging, not news.
// =====================================================================================

export interface ListTarget {
  /** Stable id, also the Firestore doc id of this target's state. */
  id: string;
  /** Shown on the card. */
  siteName: string;
  url: string;
  /** Which links on the page are items. */
  itemHref: RegExp;
  /**
   * What makes an item "the same item". Usually its address. The US office renumbers its
   * announcements — id=1 is always the newest — so there an address says nothing and the
   * wording is the only stable identity.
   */
  keyBy: 'href' | 'text';
}

export const LIST_TARGETS: ListTarget[] = [
  {
    id: 'kcdc-announcements',
    siteName: 'Kuwait Cultural Office · Washington',
    // robots.txt asks for 30 seconds between requests. One request a day is
    // well inside that, and it is the only request this watch makes to that site.
    url: 'https://kuwaitculturedc.org/kuwait_cultural_office/announcements.php',
    itemHref: /announcement\.php\?id=\d+/i,
    keyBy: 'text',
  },
  {
    id: 'mohe-news',
    siteName: 'MOHE · News',
    url: 'https://www.mohe.edu.kw/site/AR/News?PageID=14',
    itemHref: /\/News\/NewsDetails\/\d+/i,
    keyBy: 'href',
  },
  {
    id: 'mohe-announcements',
    siteName: 'MOHE · Announcements',
    url: 'https://www.mohe.edu.kw/site/AR/Announcements?PageID=12',
    itemHref: /\/Announcements\/AnnouncementDetails\/\d+/i,
    keyBy: 'href',
  },
  {
    id: 'mohe-eservices',
    siteName: 'MOHE · E-services',
    url: 'https://www.mohe.edu.kw/site/AR/EServices?PageID=3',
    itemHref: /\/eServices\/ServiceDetails\/\d+/i,
    // By wording: next year's registration usually reuses the same service page with the
    // year changed ("2027/2026" → "2028/2027"), and that change IS the news.
    keyBy: 'text',
  },
  {
    id: 'mohe-decisions',
    siteName: 'MOHE · Ministerial decisions',
    url: 'https://www.mohe.edu.kw/site/AR/MinisterialDecisions?PageID=4',
    itemHref: /\/Uploads\/[^"'?#]+\.pdf/i,
    keyBy: 'href',
  },
];

/** Link text that names nothing — the real title is in a heading above the link. */
const GENERIC_LINK_TEXT = /^(read more|more|details|view|قراءة المزيد|المزيد|التفاصيل|اقرأ المزيد)$/i;

/** More new items than this in one check means the page was rebuilt, not that N things happened. */
const FLOOD_LIMIT = 10;

/** Keys remembered per list. Far more than any first page shows. */
const MAX_KEYS = 600;

interface ListItem { key: string; title: string; url: string }

function clean(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function extractItems(html: string, target: ListTarget): ListItem[] {
  const body = html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ');
  const items = new Map<string, ListItem>();
  for (const m of body.matchAll(/<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeEntities(m[1]);
    if (!target.itemHref.test(href)) continue;
    let url: string;
    try {
      url = new URL(href, target.url).toString();
    } catch {
      continue;
    }
    let title = clean(m[2]);
    if (!title || title.length < 4 || GENERIC_LINK_TEXT.test(title)) {
      // "Read more" cards: take the last heading before this link, within the same card.
      const before = body.slice(Math.max(0, (m.index ?? 0) - 2000), m.index);
      const headings = [...before.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)];
      title = headings.length ? clean(headings[headings.length - 1][1]) : '';
    }
    if (!title) continue; // an item with no name cannot be keyed by name, or shown usefully
    const key = target.keyBy === 'text' ? title : url;
    if (!items.has(key)) items.set(key, { key, title, url });
  }
  return [...items.values()];
}

/** Check one list, if it is due. Same claim-then-work pattern as the London office. */
async function runListWatch(target: ListTarget, opts: { force?: boolean }): Promise<SiteWatchResult & { id: string }> {
  const db = adminDb!;
  const ref = db.collection('site_watch').doc(target.id);
  const claim = await db.runTransaction(async tx => {
    const snap = await tx.get(ref);
    const last = snap.exists ? (snap.data()?.lastRunAt as string | undefined) : undefined;
    if (!opts.force && last && Date.now() - Date.parse(last) < INTERVAL_MS) return null;
    tx.set(ref, { lastRunAt: new Date().toISOString() }, { merge: true });
    return { data: snap.exists ? snap.data() ?? {} : null };
  });
  if (!claim) return { id: target.id, ran: false, reason: 'not due', alerts: 0, requests: 0, errors: [] };

  const baseline = claim.data === null || !claim.data.baselinedAt;
  const known: string[] = (claim.data?.keys as string[]) ?? [];
  const errors: string[] = [];
  let items: ListItem[] = [];
  try {
    const res = await fetch(target.url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: 'no-store',
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    items = extractItems(await res.text(), target);
    // A page that suddenly lists nothing is broken or blocked, not empty. Recording that
    // would make every item look new the day it comes back.
    if (items.length === 0) throw new Error('no items found on the page — layout may have changed');
  } catch (e) {
    errors.push(`${target.id}: ${e instanceof Error ? e.message : String(e)}`);
    await ref.set({ lastErrors: errors, lastCompletedAt: new Date().toISOString() }, { merge: true });
    return { id: target.id, ran: true, baseline, alerts: 0, requests: 1, errors };
  }

  const knownSet = new Set(known);
  const fresh = items.filter(i => !knownSet.has(i.key));
  const alerts: SiteWatchAlert[] = [];
  const stamp = () => new Date().toISOString();

  if (!baseline && fresh.length > 0) {
    if (fresh.length > FLOOD_LIMIT) {
      alerts.push({
        site: target.id,
        siteName: target.siteName,
        kind: 'page_changed',
        title: `${fresh.length} new items at once`,
        url: target.url,
        summary: 'So many items appeared together that the page was most likely redesigned. Worth a look.',
        added: sample(fresh.map(i => i.title)),
        addedCount: fresh.length,
        createdAt: stamp(),
        readBy: [],
      });
    } else {
      for (const i of fresh) {
        alerts.push({
          site: target.id,
          siteName: target.siteName,
          kind: 'post',
          title: i.title,
          url: i.url,
          summary: `New on ${target.siteName}.`,
          createdAt: stamp(),
          readBy: [],
        });
      }
    }
  }

  const batch = db.batch();
  for (const a of alerts) batch.set(db.collection('site_watch_alerts').doc(), a);
  batch.set(
    ref,
    {
      // Newest first, so trimming the tail forgets the oldest.
      keys: [...new Set([...items.map(i => i.key), ...known])].slice(0, MAX_KEYS),
      lastCompletedAt: stamp(),
      lastErrors: [],
      lastItemCount: items.length,
      ...(baseline ? { baselinedAt: stamp() } : {}),
    },
    { merge: true },
  );
  await batch.commit();

  return { id: target.id, ran: true, baseline, alerts: alerts.length, requests: 1, errors: [] };
}

/**
 * Every watched source, one after another. Each keeps its own 24-hour clock, so a
 * source that failed is retried on its own schedule without dragging the others along.
 * One source failing never stops the rest.
 */
export async function runAllSiteWatches(opts: { force?: boolean } = {}) {
  if (!adminDb) return { ran: false, reason: 'DB not available', sources: [] as unknown[] };
  const deadline = Date.now() + RUN_BUDGET_MS;
  const sources: unknown[] = [];

  try {
    sources.push({ id: 'kcouk', ...(await runSiteWatch(opts)) });
  } catch (e) {
    sources.push({ id: 'kcouk', ran: false, errors: [e instanceof Error ? e.message : String(e)] });
  }

  for (const target of LIST_TARGETS) {
    if (Date.now() > deadline) {
      sources.push({ id: target.id, ran: false, reason: 'out of time — next tick' });
      continue;
    }
    try {
      sources.push(await runListWatch(target, opts));
    } catch (e) {
      sources.push({ id: target.id, ran: false, errors: [e instanceof Error ? e.message : String(e)] });
    }
  }

  const ran = sources.filter(s => (s as { ran?: boolean }).ran);
  return {
    ran: ran.length > 0,
    alerts: ran.reduce<number>((n, s) => n + ((s as { alerts?: number }).alerts ?? 0), 0),
    sources,
  };
}
