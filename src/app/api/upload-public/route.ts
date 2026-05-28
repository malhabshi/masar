import { NextRequest, NextResponse } from 'next/server';
import { adminDb, storage } from '@/lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';

export async function POST(req: NextRequest) {
  try {
    if (!adminDb || !storage) {
      return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });
    }

    const formData = await req.formData();
    const token = formData.get('token') as string | null;
    const file = formData.get('file') as File | null;
    const studentNote = formData.get('studentNote') as string | null;

    if (!token || !file) {
      return NextResponse.json({ error: 'Missing token or file.' }, { status: 400 });
    }

    // Validate token by doc ID
    const linkDoc = await adminDb.collection('upload_links').doc(token).get();
    if (!linkDoc.exists) {
      return NextResponse.json({ error: 'Invalid or expired link.' }, { status: 403 });
    }

    const linkData = linkDoc.data() as {
      studentId: string;
      isDisabled?: boolean;
      expiresAt?: string;
    };

    if (linkData.isDisabled) {
      return NextResponse.json({ error: 'This upload link has been disabled.' }, { status: 403 });
    }

    if (linkData.expiresAt && new Date(linkData.expiresAt) < new Date()) {
      return NextResponse.json({ error: 'This upload link has expired.' }, { status: 403 });
    }

    // Upload to Firebase Storage
    const bucket = storage.bucket();
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const storagePath = `student_uploads/${token}/${Date.now()}_${file.name}`;
    const blob = bucket.file(storagePath);
    await blob.save(fileBuffer, { metadata: { contentType: file.type } });
    const [url] = await blob.getSignedUrl({ action: 'read', expires: '03-09-2491' });

    const now = new Date().toISOString();

    // Write to student_public_uploads
    await adminDb.collection('student_public_uploads').add({
      token,
      studentId: linkData.studentId,
      fileName: file.name,
      storagePath,
      size: file.size,
      url,
      uploadedAt: now,
      ...(studentNote?.trim() ? { studentNote: studentNote.trim() } : {}),
    });

    // Update lastUsedAt on the link
    await adminDb.collection('upload_links').doc(token).update({ lastUsedAt: now });

    // Increment badge counters on the student document
    await adminDb.collection('students').doc(linkData.studentId).update({
      newPublicUploadsForAdmin: FieldValue.increment(1),
      newPublicUploadsForEmployee: FieldValue.increment(1),
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Public upload error:', error);
    return NextResponse.json({ error: 'Failed to upload.', details: error.message }, { status: 500 });
  }
}
