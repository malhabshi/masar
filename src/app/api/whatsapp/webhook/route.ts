import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';

const WANOTIFIER_API_KEY = '21ZrvNBzImlKBPxlXGce7rVy8GdzuT';
const WANOTIFIER_MESSAGES_API = `https://app.wanotifier.com/api/v1/messages?key=${WANOTIFIER_API_KEY}`;

async function sendReply(to: string, body: string) {
  const digits = to.replace(/\D/g, '');
  const phone = `+${digits.startsWith('965') ? digits : `965${digits}`}`;
  await fetch(WANOTIFIER_MESSAGES_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { whatsapp_number: phone },
      message: { type: 'text', text: { body } },
    }),
  });
}

function normalizePhone(phone: string) {
  return phone.replace(/\D/g, '').replace(/^965/, '');
}

// Score how well a student name matches the query tokens
function matchScore(studentName: string, tokens: string[]): number {
  const name = studentName.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (name.includes(token)) score += token.length; // longer token matches worth more
  }
  return score;
}

async function searchStudent(query: string) {
  if (!adminDb) return null;

  // --- 1. Phone search ---
  const isPhoneLike = /^[\d\s\-+()]{6,}$/.test(query);
  if (isPhoneLike) {
    const q = normalizePhone(query);
    const candidates = [q, `965${q}`];
    for (const field of ['phone', 'phone2', 'phone3']) {
      for (const val of candidates) {
        const snap = await adminDb.collection('students').where(field, '==', val).limit(1).get();
        if (!snap.empty) return { found: [{ id: snap.docs[0].id, ...snap.docs[0].data() }] };
      }
    }
  }

  // --- 2. Internal number (pure digits or "NUMBER - ...") ---
  const prefixPattern = query.match(/^(\d+)\s*[-–]\s*(.+)$/);
  const internalNumberCandidate = prefixPattern ? prefixPattern[1] : (/^\d+$/.test(query.trim()) ? query.trim() : null);

  if (internalNumberCandidate) {
    const snap = await adminDb.collection('students').where('internalNumber', '==', internalNumberCandidate).limit(1).get();
    if (!snap.empty) return { found: [{ id: snap.docs[0].id, ...snap.docs[0].data() }] };
  }

  // --- 3. Name search — fetch all, score, and rank ---
  // Build name candidates: full query, stripped prefix, individual tokens
  const nameCandidates: string[] = [query];
  if (prefixPattern) nameCandidates.push(prefixPattern[2].trim()); // "NAME" part after "NUMBER - "
  nameCandidates.push(query.replace(/^\d+\s*[-–]\s*/, '').trim()); // strip any leading "NUMBER - "

  const allSnap = await adminDb.collection('students').get();
  const scored: { score: number; doc: any }[] = [];

  for (const doc of allSnap.docs) {
    const name: string = (doc.data().name || '').toLowerCase();
    let best = 0;

    for (const candidate of nameCandidates) {
      if (!candidate) continue;
      const lower = candidate.toLowerCase();

      // Full phrase match — highest priority
      if (name.includes(lower)) {
        best = Math.max(best, lower.length * 10);
        continue;
      }

      // Token match — score by sum of matched token lengths
      const tokens = lower.split(/[\s\-]+/).filter(t => t.length > 1);
      const s = matchScore(name, tokens);
      best = Math.max(best, s);
    }

    if (best > 0) scored.push({ score: best, doc });
  }

  if (scored.length === 0) return { found: [] };

  // Sort descending by score
  scored.sort((a, b) => b.score - a.score);

  // If top score is clearly dominant (2x the second), return single result
  if (scored.length === 1 || scored[0].score >= scored[1].score * 2) {
    const d = scored[0].doc;
    return { found: [{ id: d.id, ...d.data() }] };
  }

  // Return top matches for disambiguation
  return { found: scored.slice(0, 5).map(s => ({ id: s.doc.id, ...s.doc.data() })), multiple: true };
}

async function handleMessageReceived(data: any) {
  if (!adminDb) return;

  const senderPhone: string = data.contact?.whatsapp_number || data.message?.from || '';
  const messageText: string = (data.message?.message?.body || '').trim();

  if (!senderPhone || !messageText) return;

  // Authorization: sender must be a registered staff member
  const normalizedSender = normalizePhone(senderPhone);
  const usersSnap = await adminDb.collection('users')
    .where('role', 'in', ['admin', 'adminplus', 'employee'])
    .get();

  const isAuthorized = usersSnap.docs.some(doc => {
    const userPhone = normalizePhone(doc.data().phone || '');
    return userPhone === normalizedSender && userPhone.length > 0;
  });

  if (!isAuthorized) return;

  const result = await searchStudent(messageText);

  if (!result || result.found.length === 0) {
    await sendReply(senderPhone, `No student found for: "${messageText}"`);
    return;
  }

  if (result.multiple) {
    const list = result.found.map((s: any) => `• ${s.name} (${s.phone})`).join('\n');
    await sendReply(senderPhone, `Multiple students found:\n${list}\n\nPlease be more specific.`);
    return;
  }

  const student = result.found[0];

  // Resolve employee name
  let employeeName = '-';
  if (student.employeeId) {
    const empSnap = await adminDb.collection('users')
      .where('civilId', '==', student.employeeId)
      .limit(1).get();
    if (!empSnap.empty) employeeName = empSnap.docs[0].data().name || '-';
  }

  // Active schools with change agent
  const changeAgentSchools =
    student.changeAgentRequired && student.changeAgentUniversities?.length
      ? student.changeAgentUniversities.join(', ')
      : '-';

  const reply = [
    `name :- ${student.name}`,
    `phone :- ${student.phone}`,
    `employee name :- ${employeeName}`,
    `active schools with change agent :- ${changeAgentSchools}`,
  ].join('\n');

  await sendReply(senderPhone, reply);
}

export async function POST(req: NextRequest) {
  try {
    const data = await req.json();

    if (adminDb) {
      await adminDb.collection('whatsapp_logs').add({
        receivedAt: new Date().toISOString(),
        payload: data,
        type: data.event || 'unknown',
      });
    }

    if (data.event === 'message.received') {
      await handleMessageReceived(data.data);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('❌ WhatsApp Webhook Error:', error);
    return NextResponse.json({ success: false, error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'active',
    service: 'Masar WhatsApp Gateway',
    timestamp: new Date().toISOString(),
  });
}
