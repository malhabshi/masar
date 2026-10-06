// Everything the AI changes, in one list, each with a way back.
//
// Every place the AI changes a record — an application status from an email, Change Agent
// switched on, schools added from a request, Missing Items added, a company notice applied,
// a profile field filled from a document — writes one entry here: what changed, why (the
// email or document and its words), which student, and exactly how to reverse it. The
// AI Activity page lists them; Undo puts the record back the way it was and marks the
// entry undone, keeping who undid it and when.
//
// Undo is careful: it only reverses a change if the record still shows the AI's value —
// if a person has since changed it again, Undo refuses rather than overwrite their work.

import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '@/lib/firebase/admin';
import type { Application, ApplicationStatus } from '@/lib/types';

export const AI_ACTIONS_COLLECTION = 'ai_actions';

export type AiActionSource = 'email' | 'notice' | 'task' | 'document' | 'chat' | 'followup' | 'change_agent' | 'assistant';

export type UndoSpec =
  | {
      type: 'app_status';
      university: string;
      major: string;
      from: ApplicationStatus;
      to: ApplicationStatus;
      rejectionReason?: string | null;
      /** The application's updatedAt as the AI left it: a later change by staff (even back to the same status) is theirs, and Undo leaves it. */
      setAt?: string;
      /** The change also stopped follow-ups for this application: Undo lifts that stop. */
      followUpStop?: FollowUpStopUndo;
    }
  | ({ type: 'resume_follow_up' } & FollowUpStopUndo)
  | { type: 'remove_application'; university: string; major: string; addedStatus?: ApplicationStatus }
  | { type: 'remove_missing_items'; ids: string[] }
  | { type: 'restore_missing_items'; items: unknown[] }
  | { type: 'change_agent'; university: string; logEntryId: string; wasRequired: boolean; previousUniversities: string[] }
  | { type: 'set_field'; field: string; from: unknown; to: unknown }
  | {
      type: 'approved_university';
      universityId: string;
      isAvailable: boolean;
      importantNote: string | null;
      /** What the AI set, so Undo can tell whether someone has changed it since. */
      setTo?: { isAvailable: boolean; importantNote: string };
    }
  | { type: 'none' };

/** Which stop request this action added (email_followups id + its stop id). */
type FollowUpStopUndo = { key: string; stopId: string };

export type AiAction = {
  id: string;
  at: string;
  source: AiActionSource;
  /** One line for staff: what was done. */
  summary: string;
  /** Why — the email / document and its words. */
  reason: string;
  studentId: string | null;
  studentName: string | null;
  undo: UndoSpec;
  undone?: { by: string; byName: string; at: string };
};

function db() {
  if (!adminDb) throw new Error('Database not available');
  return adminDb;
}

/** Record one AI change. Never throws — a failed log must not fail the change itself. */
export async function logAiAction(entry: Omit<AiAction, 'id' | 'at'>): Promise<string | null> {
  try {
    const ref = db().collection(AI_ACTIONS_COLLECTION).doc();
    await ref.set(JSON.parse(JSON.stringify({ ...entry, id: ref.id, at: new Date().toISOString() })));
    return ref.id;
  } catch (e) {
    console.error('[ai-actions] could not log:', e);
    return null;
  }
}

export async function listAiActions(opts: { limit?: number; source?: string; studentId?: string } = {}) {
  let q: FirebaseFirestore.Query = db().collection(AI_ACTIONS_COLLECTION).orderBy('at', 'desc');
  if (opts.studentId) q = db().collection(AI_ACTIONS_COLLECTION).where('studentId', '==', opts.studentId);
  const snap = await q.limit(Math.min(opts.limit ?? 200, 500)).get();
  let rows = snap.docs.map((d) => d.data() as AiAction);
  if (opts.studentId) rows.sort((a, b) => b.at.localeCompare(a.at));
  if (opts.source) rows = rows.filter((r) => r.source === opts.source);
  return rows;
}

/** JSON with object keys sorted: Firestore does not keep the order a map's keys were written in. */
function stable(v: unknown): string {
  return JSON.stringify(v, (_, x) =>
    x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x,
  );
}

/** Clears a "stop chasing" from an email_followups record. */
const RESUME = { stoppedAt: FieldValue.delete(), stoppedBy: FieldValue.delete(), stopReason: FieldValue.delete() };

const note = (content: string, by: string) => ({
  id: `note-ai-undo-${Date.now()}`,
  authorId: by,
  content,
  createdAt: new Date().toISOString(),
});

/**
 * Reverse one AI change. Returns a message for the person who pressed Undo.
 *
 * Each undo reads, checks and writes inside ONE transaction, together with marking the
 * entry undone: if a person edits the same student (or adds an application) in between,
 * Firestore retries with their version instead of the undo writing back a stale copy.
 */
export async function undoAiAction(id: string, user: { id: string; name: string }): Promise<{ ok: boolean; message: string }> {
  const actionRef = db().collection(AI_ACTIONS_COLLECTION).doc(id);
  const undoneMark = { undone: { by: user.id, byName: user.name, at: new Date().toISOString() } };

  try {
    return await db().runTransaction(async (tx) => {
      const actionSnap = await tx.get(actionRef);
      if (!actionSnap.exists) return { ok: false, message: 'That entry no longer exists.' };
      const a = actionSnap.data() as AiAction;
      if (a.undone) return { ok: false, message: `Already undone by ${a.undone.byName}.` };
      const u = a.undo;
      if (u.type === 'none') return { ok: false, message: 'This one cannot be undone from here.' };

      const studentRef = a.studentId ? db().collection('students').doc(a.studentId) : null;
      // All reads first (a transaction requires reads before writes).
      const studentSnap = studentRef ? await tx.get(studentRef) : null;
      const s = studentSnap?.data() ?? {};
      const requestsSnap =
        u.type === 'remove_missing_items' && a.studentId
          ? await tx.get(db().collection('email_requests').where('studentId', '==', a.studentId))
          : null;
      const uniRef = u.type === 'approved_university' ? db().collection('approved_universities').doc(u.universityId) : null;
      const uniSnap = uniRef ? await tx.get(uniRef) : null;
      const stop = u.type === 'resume_follow_up' ? u : u.type === 'app_status' ? u.followUpStop : undefined;
      const stopRef = stop ? db().collection('email_followups').doc(stop.key) : null;
      const stopSnap = stopRef ? await tx.get(stopRef) : null;
      /** Remove this action's own stop request. Returns true when no other stop remains (chasing resumes). */
      const undoStop = (): boolean => {
        if (!stop || !stopRef) return true;
        const ids = (stopSnap?.data()?.stopIds ?? []) as string[];
        const remaining = ids.filter((x) => x !== stop.stopId);
        if (remaining.length) tx.set(stopRef, { stopIds: remaining }, { merge: true });
        else tx.set(stopRef, { stopIds: [], ...RESUME }, { merge: true });
        return remaining.length === 0;
      };

      const finish = (message: string) => {
        tx.update(actionRef, undoneMark);
        return { ok: true, message };
      };

      switch (u.type) {
        case 'app_status': {
          const apps = (s.applications ?? []) as Application[];
          const i = apps.findIndex((x) => x.university === u.university && x.major === u.major);
          // Staff changed it since (or removed it): their decision stays, but this request's stop is lifted.
          const changedSince = i < 0 || apps[i].status !== u.to || (!!u.setAt && apps[i].updatedAt !== u.setAt);
          if (u.followUpStop && changedSince) {
            const resumed = undoStop();
            return finish(
              `${u.university} was changed since${i >= 0 ? ` to ${apps[i].status}` : ''}, so that stays; ` +
                (resumed ? 'follow-ups are back on.' : 'another stop request still applies.'),
            );
          }
          if (i < 0) return { ok: false, message: 'That application is no longer on the profile.' };
          if (changedSince) return { ok: false, message: `Not undone — it has been changed since (now ${apps[i].status}).` };
          const next = [...apps];
          next[i] = { ...next[i], status: u.from, updatedAt: new Date().toISOString() };
          if (u.from === 'Rejected' && u.rejectionReason) next[i].rejectionReason = u.rejectionReason;
          else delete next[i].rejectionReason;
          tx.update(studentRef!, {
            applications: next,
            adminNotes: FieldValue.arrayUnion(note(`Undid AI change: ${u.university} back to ${u.from} (was set to ${u.to}). By ${user.name}.`, user.id)),
          });
          const followUps = !u.followUpStop ? '' : undoStop() ? ' and follow-ups are back on' : ' (another stop request still applies)';
          return finish(`${u.university} is back to ${u.from}${followUps}.`);
        }
        case 'remove_application': {
          const apps = (s.applications ?? []) as Application[];
          const app = apps.find((x) => x.university === u.university && x.major === u.major);
          if (!app) return finish('Already removed.');
          const added = u.addedStatus ?? 'Pending';
          if (app.status !== added) return { ok: false, message: `Not removed — it has moved on to ${app.status} since it was added.` };
          tx.update(studentRef!, {
            applications: apps.filter((x) => x !== app),
            adminNotes: FieldValue.arrayUnion(note(`Undid AI change: removed ${u.university} (${u.major}), added by the AI. By ${user.name}.`, user.id)),
          });
          return finish(`${u.university} removed from the applications.`);
        }
        case 'remove_missing_items': {
          const items = ((s.missingItems ?? []) as Array<string | { id?: string }>).filter(
            (m) => typeof m !== 'string' && u.ids.includes(m.id ?? ''),
          );
          if (items.length) tx.update(studentRef!, { missingItems: FieldValue.arrayRemove(...items) });
          // The email request behind these items must stop waiting too — otherwise their
          // disappearance reads as "received" and a reply would be drafted.
          for (const r of requestsSnap?.docs ?? []) {
            const its = (r.data().items ?? []) as Array<{ missingItemId: string; status: string }>;
            if (!its.some((it) => u.ids.includes(it.missingItemId))) continue;
            const next = its.map((it) => (u.ids.includes(it.missingItemId) ? { ...it, status: 'closed' } : it));
            tx.update(r.ref, { items: next, status: next.some((it) => it.status === 'waiting') ? 'waiting' : 'closed' });
          }
          return finish(items.length ? `${items.length} Missing Item(s) removed.` : 'They were already gone.');
        }
        case 'resume_follow_up': {
          return finish(undoStop() ? 'Follow-ups are back on for this application.' : 'This stop request is removed; another one still applies.');
        }
        case 'restore_missing_items': {
          if (u.items.length) tx.update(studentRef!, { missingItems: FieldValue.arrayUnion(...u.items) });
          return finish('Missing Item put back.');
        }
        case 'change_agent': {
          const log = ((s.changeAgentLog ?? []) as Array<{ id: string }>).filter((e) => e.id !== u.logEntryId);
          const unis = ((s.changeAgentUniversities ?? []) as string[]).filter((x) => x !== u.university);
          // Never switch Change Agent back on from an undo: if staff turned it off since, it stays off.
          const stillOn = s.changeAgentRequired === true && unis.length > 0;
          tx.update(studentRef!, {
            changeAgentLog: log,
            changeAgentUniversities: unis,
            changeAgentRequired: stillOn,
            adminNotes: FieldValue.arrayUnion(note(`Undid AI change: Change Agent for ${u.university} switched off. By ${user.name}.`, user.id)),
          });
          return finish(`Change Agent for ${u.university} removed${stillOn ? ' (still on for other schools)' : ''}.`);
        }
        case 'set_field': {
          const current = u.field.split('.').reduce<any>((o, k) => (o == null ? o : o[k]), s);
          if (stable(current) !== stable(u.to)) return { ok: false, message: 'Not undone — the value has been changed since.' };
          tx.update(studentRef!, {
            [u.field]: u.from === undefined || u.from === null ? FieldValue.delete() : u.from,
            adminNotes: FieldValue.arrayUnion(note(`Undid AI change: ${u.field} restored. By ${user.name}.`, user.id)),
          });
          return finish('Restored.');
        }
        case 'approved_university': {
          const cur = uniSnap?.data() ?? {};
          if (u.setTo && (cur.isAvailable !== u.setTo.isAvailable || String(cur.importantNote ?? '') !== u.setTo.importantNote)) {
            return { ok: false, message: 'Not undone — the row has been changed since.' };
          }
          tx.update(uniRef!, { isAvailable: u.isAvailable, importantNote: u.importantNote ?? FieldValue.delete() });
          return finish(`Approved University put back to ${u.isAvailable ? 'open' : 'closed'}.`);
        }
      }
      return { ok: false, message: 'Unknown change type.' };
    });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
