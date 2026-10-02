// Internal-chat tools for the AI assistant page.
//
// The chat responder (chat-responder.ts) reacts to one message as it arrives. These are
// the other direction: an admin asks the assistant "what is waiting for a reply?" or
// "answer Sara in Ahmad's chat", and it reads the threads and posts the reply itself.
//
// Replies are posted as Masar AI, never as the admin who asked. A message under a
// colleague's name that they did not write would be indistinguishable from one they did.

import { adminDb } from '@/lib/firebase/admin';
import { sendChatMessage } from '@/lib/actions';
import { CHAT_BOT_NAME, CHAT_BOT_USER_ID, ensureChatBotUser } from './chat-bot';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const ACKNOWLEDGEMENT =
  /^(ok(ay)?|k+|done|thx|thanks?|thank you|ty|noted|sure|got it|fine|great|perfect|تم|تمام|شكرا|شكرا جزيلا|اوك|أوك|ماشي|تسلم|زين)[\s.!،]*$/i;

function db() {
  if (!adminDb) throw new Error('Database not available');
  return adminDb;
}

async function userDirectory(): Promise<Map<string, Row>> {
  const snap = await db().collection('users').get();
  return new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
}

function describeTargets(m: Row, users: Map<string, Row>): string[] {
  const out: string[] = [];
  for (const g of m.targetGroups ?? []) out.push(g === 'admins' ? 'Admins' : 'Departments');
  for (const id of m.targetUserIds ?? []) out.push(users.get(id)?.name ?? id);
  return out;
}

function shape(m: Row, users: Map<string, Row>) {
  const author = users.get(m.authorId);
  return {
    id: m.id,
    at: m.timestamp ?? null,
    from: m.authorId === CHAT_BOT_USER_ID ? CHAT_BOT_NAME : author?.name ?? 'Unknown',
    fromRole: author?.role ?? null,
    fromUserId: m.authorId ?? null,
    to: describeTargets(m, users),
    text: m.content ?? '',
    ...(m.document ? { file: m.document.name } : {}),
  };
}

/** Is this user among the message's addressees (directly or through a group)? */
function addressedTo(m: Row, user: Row | undefined): boolean {
  if (!user) return false;
  if ((m.targetUserIds ?? []).includes(user.id)) return true;
  if ((m.targetGroups ?? []).includes('admins') && user.role === 'admin') return true;
  if ((m.targetGroups ?? []).includes('departments') && user.role === 'department') return true;
  return false;
}

export async function readStudentChat(studentId: string, limit = 30) {
  const lim = Math.min(Math.max(limit, 1), 100);
  const [student, snap, users] = await Promise.all([
    db().collection('students').doc(studentId).get(),
    db().collection('chats').doc(studentId).collection('messages').orderBy('timestamp', 'desc').limit(lim).get(),
    userDirectory(),
  ]);
  if (!student.exists) return { error: `No student found with id ${studentId}.` };
  const messages = snap.docs.map((d) => shape({ id: d.id, ...d.data() }, users)).reverse();
  return { studentId, studentName: student.data()?.name ?? null, count: messages.length, messages };
}

/**
 * Threads whose newest message is still waiting on someone: it was addressed to a person
 * or group, or asked a question, and nobody has written after it. A plain "ok" or "thanks"
 * at the end of a thread closes it.
 */
export async function findChatsAwaitingReply(opts: { days?: number; userId?: string; limit?: number }) {
  const days = Math.min(Math.max(opts.days ?? 7, 1), 60);
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  const [studentsSnap, users] = await Promise.all([
    db()
      .collection('students')
      .where('lastChatMessageTimestamp', '>=', since)
      .orderBy('lastChatMessageTimestamp', 'desc')
      .limit(300)
      .get(),
    userDirectory(),
  ]);
  const forUser = opts.userId ? users.get(opts.userId) : undefined;
  if (opts.userId && !forUser) return { error: `No user found with id ${opts.userId}.` };

  const candidates = studentsSnap.docs.filter((d) => d.data().isClosed !== true);
  const waiting: Row[] = [];

  // Read threads in small batches: a few hundred parallel subcollection reads at once is
  // more than Firestore needs to answer this.
  for (let i = 0; i < candidates.length && waiting.length < limit; i += 20) {
    const batch = candidates.slice(i, i + 20);
    const lasts = await Promise.all(
      batch.map((d) =>
        db().collection('chats').doc(d.id).collection('messages').orderBy('timestamp', 'desc').limit(1).get(),
      ),
    );
    batch.forEach((studentDoc, j) => {
      const doc = lasts[j].docs[0];
      if (!doc) return;
      const m: Row = { id: doc.id, ...doc.data() };
      if (m.authorId === CHAT_BOT_USER_ID) return;
      const text = String(m.content ?? '').trim();
      if (ACKNOWLEDGEMENT.test(text)) return;
      const addressed = (m.targetUserIds ?? []).length > 0 || (m.targetGroups ?? []).length > 0;
      const question = /[?؟]/.test(text);
      if (!addressed && !question) return;
      if (forUser && !addressedTo(m, forUser)) return;
      const s = studentDoc.data();
      const hours = Math.round((Date.now() - new Date(m.timestamp).getTime()) / 36e5);
      waiting.push({
        studentId: studentDoc.id,
        studentName: s.name ?? null,
        waitingHours: hours,
        lastMessage: shape(m, users),
      });
    });
  }

  waiting.sort((a, b) => b.waitingHours - a.waitingHours);
  return {
    window: `messages from the last ${days} days`,
    ...(forUser ? { addressedTo: forUser.name } : {}),
    rule: 'Newest message in the thread was addressed to someone or asked a question, and nobody has replied since.',
    count: waiting.length,
    threads: waiting.slice(0, limit),
  };
}

/**
 * Post into a student's internal chat as Masar AI. By default the person who wrote the
 * newest staff message is notified, since that is almost always who the reply is for.
 */
export async function replyInStudentChat(input: { studentId: string; content: string; notifyUserIds?: string[] }) {
  const content = String(input.content ?? '').trim();
  if (!content) return { ok: false, error: 'The reply was empty; nothing was posted.' };

  let notify = input.notifyUserIds;
  if (!notify) {
    const last = await db()
      .collection('chats')
      .doc(input.studentId)
      .collection('messages')
      .orderBy('timestamp', 'desc')
      .limit(5)
      .get();
    const lastHuman = last.docs.map((d) => d.data()).find((m) => m.authorId !== CHAT_BOT_USER_ID);
    notify = lastHuman?.authorId ? [lastHuman.authorId] : [];
  }

  await ensureChatBotUser();
  const result = await sendChatMessage(input.studentId, CHAT_BOT_USER_ID, content, notify);
  return result.success
    ? { ok: true, posted: true, as: CHAT_BOT_NAME, notified: notify }
    : { ok: false, error: result.message ?? 'Failed to post the message.' };
}
