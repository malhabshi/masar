// What the AI costs, per feature and per day, and the monthly budget.
//
// Every model call goes through getAnthropicClient(feature) (client.ts), which reports the
// tokens here. They are priced with the table in app_settings/ai_budget — editable from
// the AI Assistant page, since prices change and only the Anthropic bill is authoritative
// — and added to ai_usage/{YYYY-MM}.
//
// The budget: at the alert percentage admins get a notice once; at 100% the AUTOMATIC
// jobs (scheduled inbox checks, document reading, follow-ups, the chat responder, the
// nightly report…) pause until the month ends or the budget is raised. Anything a person
// starts by hand keeps working — a person can see what they are spending.

import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';

const USAGE_COLLECTION = 'ai_usage';
const SETTINGS = { collection: 'app_settings', doc: 'ai_budget' };

export type ModelPrice = { input: number; output: number };

export type BudgetSettings = {
  /** US dollars per calendar month; 0 means no limit. */
  monthlyBudgetUsd: number;
  /** Alert admins once spending passes this share of the budget. */
  alertPercent: number;
  /** US dollars per million tokens. Cache reads are charged at 10% of input, cache writes at 125%. */
  prices: Record<string, ModelPrice>;
};

/** Starting estimates — check them against the Anthropic bill and correct on the page. */
export const DEFAULT_BUDGET: BudgetSettings = {
  monthlyBudgetUsd: 200,
  alertPercent: 80,
  prices: {
    'claude-opus-5': { input: 5, output: 25 },
    'claude-sonnet-5-5': { input: 3, output: 15 },
    'claude-haiku-4-5-20251001': { input: 1, output: 5 },
  },
};

type Usage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

function db() {
  if (!adminDb) throw new Error('Database not available');
  return adminDb;
}

const month = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 7); // Kuwait calendar
const today = () => new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 10);
const safe = (k: string) => k.replace(/[^A-Za-z0-9_-]/g, '_');

let settingsCache: { at: number; value: BudgetSettings } | null = null;

export async function getBudgetSettings(): Promise<BudgetSettings> {
  if (settingsCache && Date.now() - settingsCache.at < 60_000) return settingsCache.value;
  let value = DEFAULT_BUDGET;
  try {
    const d = (await db().collection(SETTINGS.collection).doc(SETTINGS.doc).get()).data();
    if (d) {
      value = {
        monthlyBudgetUsd: typeof d.monthlyBudgetUsd === 'number' ? d.monthlyBudgetUsd : DEFAULT_BUDGET.monthlyBudgetUsd,
        alertPercent: typeof d.alertPercent === 'number' ? d.alertPercent : DEFAULT_BUDGET.alertPercent,
        prices: { ...DEFAULT_BUDGET.prices, ...(d.prices ?? {}) },
      };
    }
  } catch {
    /* defaults */
  }
  settingsCache = { at: Date.now(), value };
  return value;
}

export async function saveBudgetSettings(patch: Partial<BudgetSettings>): Promise<BudgetSettings> {
  const cur = await getBudgetSettings();
  const next: BudgetSettings = {
    monthlyBudgetUsd: typeof patch.monthlyBudgetUsd === 'number' && patch.monthlyBudgetUsd >= 0 ? patch.monthlyBudgetUsd : cur.monthlyBudgetUsd,
    alertPercent: typeof patch.alertPercent === 'number' && patch.alertPercent > 0 && patch.alertPercent <= 100 ? patch.alertPercent : cur.alertPercent,
    prices: { ...cur.prices, ...(patch.prices ?? {}) },
  };
  await db().collection(SETTINGS.collection).doc(SETTINGS.doc).set({ ...next, updatedAt: new Date().toISOString() });
  settingsCache = null;
  statusCache = null;
  return next;
}

function priceOf(prices: Record<string, ModelPrice>, model: string): ModelPrice {
  return prices[model] ?? prices[Object.keys(prices).find((k) => model.startsWith(k)) ?? ''] ?? { input: 5, output: 25 };
}

/** Add one call's tokens and cost. Never throws. */
export async function recordUsage(feature: string, model: string, usage: Usage | undefined): Promise<void> {
  if (!usage || !adminDb) return;
  try {
    const { prices } = await getBudgetSettings();
    const p = priceOf(prices, model);
    const inTok = usage.input_tokens ?? 0;
    const outTok = usage.output_tokens ?? 0;
    const cacheRead = usage.cache_read_input_tokens ?? 0;
    const cacheWrite = usage.cache_creation_input_tokens ?? 0;
    const cost = (inTok * p.input + outTok * p.output + cacheRead * p.input * 0.1 + cacheWrite * p.input * 1.25) / 1_000_000;
    const f = safe(feature);
    const day = today();
    await db()
      .collection(USAGE_COLLECTION)
      .doc(month())
      .set(
        {
          totalCost: FieldValue.increment(cost),
          calls: FieldValue.increment(1),
          features: { [f]: { cost: FieldValue.increment(cost), calls: FieldValue.increment(1), input: FieldValue.increment(inTok + cacheRead + cacheWrite), output: FieldValue.increment(outTok) } },
          days: { [day]: FieldValue.increment(cost) },
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );
    statusCache = null;
    void alertIfNeeded();
  } catch (e) {
    console.error('[ai-usage] could not record:', e);
  }
}

export type BudgetStatus = {
  month: string;
  spent: number;
  budget: number;
  percent: number;
  /** Automatic jobs are paused because the budget is used up. */
  paused: boolean;
  byFeature: Array<{ feature: string; cost: number; calls: number }>;
  byDay: Array<{ day: string; cost: number }>;
};

let statusCache: { at: number; value: BudgetStatus } | null = null;

export async function getBudgetStatus(): Promise<BudgetStatus> {
  if (statusCache && Date.now() - statusCache.at < 60_000) return statusCache.value;
  const settings = await getBudgetSettings();
  const d = (await db().collection(USAGE_COLLECTION).doc(month()).get()).data() ?? {};
  const spent = Number(d.totalCost ?? 0);
  const budget = settings.monthlyBudgetUsd;
  const value: BudgetStatus = {
    month: month(),
    spent,
    budget,
    percent: budget > 0 ? Math.round((spent / budget) * 100) : 0,
    paused: budget > 0 && spent >= budget,
    byFeature: Object.entries((d.features ?? {}) as Record<string, { cost: number; calls: number }>)
      .map(([feature, v]) => ({ feature, cost: Number(v.cost ?? 0), calls: Number(v.calls ?? 0) }))
      .sort((a, b) => b.cost - a.cost),
    byDay: Object.entries((d.days ?? {}) as Record<string, number>)
      .map(([day, cost]) => ({ day, cost: Number(cost) }))
      .sort((a, b) => a.day.localeCompare(b.day)),
  };
  statusCache = { at: Date.now(), value };
  return value;
}

/** For automatic jobs: false once this month's budget is used up. */
export async function automaticAiAllowed(): Promise<boolean> {
  try {
    return !(await getBudgetStatus()).paused;
  } catch {
    return true;
  }
}

/** Tell the admins once when spending crosses the alert line, and once when it hits the budget. */
async function alertIfNeeded() {
  const status = await getBudgetStatus();
  const settings = await getBudgetSettings();
  if (!status.budget) return;
  const ref = db().collection(USAGE_COLLECTION).doc(status.month);
  const level = status.percent >= 100 ? 'full' : status.percent >= settings.alertPercent ? 'warn' : null;
  if (!level) return;
  const field = level === 'full' ? 'alertedFull' : 'alertedWarn';
  const sent = await db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (s.data()?.[field]) return false;
    tx.set(ref, { [field]: new Date().toISOString() }, { merge: true });
    return true;
  });
  if (!sent) return;
  const admins = (await db().collection('users').where('role', '==', 'admin').get()).docs.map((d) => d.id);
  if (!admins.length) return;
  const content =
    level === 'full'
      ? `⛔ AI spending has reached this month's budget ($${status.spent.toFixed(2)} of $${status.budget}). Automatic AI jobs are paused until next month — raise the budget on the AI Assistant page to restart them.`
      : `⚠️ AI spending is at ${status.percent}% of this month's budget ($${status.spent.toFixed(2)} of $${status.budget}). See the AI Assistant page for where it goes.`;
  await db().collection('tasks').add({
    authorId: 'system',
    createdBy: 'system',
    recipientId: admins[0],
    recipientIds: admins,
    content,
    createdAt: new Date().toISOString(),
    status: 'new',
    category: 'update',
    replies: [],
  });
}
