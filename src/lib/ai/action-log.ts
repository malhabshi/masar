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

export type AiActionSource = 'email' | 'notice' | 'task' | 'document' | 'chat' | 'followup' | 'change_agent';

export type UndoSpec =
  | { type: 'app_status'; university: string; major: string; from: ApplicationStatus; to: ApplicationStatus; rejectionReason?: string | null }
  | { type: 'remove_application'; university: string; major: string }
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

      const finish = (message: string) => {
        tx.update(actionRef, undoneMark);
        return { ok: true, message };
      };

      switch (u.type) {
        case 'app_status': {
          const apps = (s.applications ?? []) as Application[];
          const i = apps.findIndex((x) => x.university === u.university && x.major === u.major);
          if (i < 0) return { ok: false, message: 'That application is no longer on the profile.' };
          if (apps[i].status !== u.to) return { ok: false, message: `Not undone — someone has since set it to ${apps[i].status}.` };
          const next = [...apps];
          next[i] = { ...next[i], status: u.from, updatedAt: new Date().toISOString() };
          if (u.from === 'Rejected' && u.rejectionReason) next[i].rejectionReason = u.rejectionReason;
          else delete next[i].rejectionReason;
          tx.update(studentRef!, {
            applications: next,
            adminNotes: FieldValue.arrayUnion(note(`Undid AI change: ${u.university} back to ${u.from} (was set to ${u.to}). By ${user.name}.`, user.id)),
          });
          return finish(`${u.university} is back to ${u.from}.`);
        }
        case 'remove_application': {
          const apps = (s.applications ?? []) as Application[];
          const app = apps.find((x) => x.university === u.university && x.major === u.major);
          if (!app) return finish('Already removed.');
          if (app.status !== 'Pending') return { ok: false, message: `Not removed — it has moved on to ${app.status} since it was added.` };
          tx.update(studentRef!, {
            applications: apps.filter((x) => x !== app),
            adminNotes: FieldValue.arrayUnion(note(`Undid AI change: removed ${u.university} (${u.major}), added from a request. By ${user.name}.`, user.id)),
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
          if (JSON.stringify(current) !== JSON.stringify(u.to)) return { ok: false, message: 'Not undone — the value has been changed since.' };
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
