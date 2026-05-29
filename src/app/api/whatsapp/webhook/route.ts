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

  if (!isAuthorized) return; // Silently ignore unauthorized senders

  // Search student — try phone, internalNumber, then partial name
  let student: any = null;
  const isPhoneLike = /^[\d\s\-+()]{6,}$/.test(messageText);

  if (isPhoneLike) {
    const q = normalizePhone(messageText);
    // Try exact match on stored phone
    let snap = await adminDb.collection('students').where('phone', '==', q).limit(1).get();
    if (snap.empty) {
      // Try with 965 prefix stored
      snap = await adminDb.collection('students').where('phone', '==', `965${q}`).limit(1).get();
    }
    if (!snap.empty) student = { id: snap.docs[0].id, ...snap.docs[0].data() };
  }

  if (!student) {
    // Try internalNumber exact match
    const snap = await adminDb.collection('students').where('internalNumber', '==', messageText).limit(1).get();
    if (!snap.empty) student = { id: snap.docs[0].id, ...snap.docs[0].data() };
  }

  if (!student) {
    // Partial name search — fetch all and filter in memory
    const allSnap = await adminDb.collection('students').get();
    const lower = messageText.toLowerCase();
    const matches = allSnap.docs.filter(doc =>
      (doc.data().name || '').toLowerCase().includes(lower)
    );

    if (matches.length === 1) {
      student = { id: matches[0].id, ...matches[0].data() };
    } else if (matches.length > 1) {
      const list = matches.slice(0, 5).map(d => `• ${d.data().name}`).join('\n');
      await sendReply(senderPhone, `Multiple students found:\n${list}\n\nPlease be more specific.`);
      return;
    }
  }

  if (!student) {
    await sendReply(senderPhone, `No student found for: "${messageText}"`);
    return;
  }

  // Resolve employee name via civilId
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
