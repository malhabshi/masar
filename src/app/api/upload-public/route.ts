import { NextRequest, NextResponse } from 'next/server';
import { adminDb, storage } from '@/lib/firebase/admin';
import type { Document as StudentDocument, Student } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    if (!adminDb || !storage) {
      return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });
    }

    const formData = await req.formData();
    const token = formData.get('token') as string | null;
    const file = formData.get('file') as File | null;

    if (!token || !file) {
      return NextResponse.json({ error: 'Missing token or file.' }, { status: 400 });
    }

    // Validate token
    const q = await adminDb.collection('upload_links').where('token', '==', token).limit(1).get();
    if (q.empty) {
      return NextResponse.json({ error: 'Invalid or expired link.' }, { status: 403 });
    }

    const linkData = q.docs[0].data();
    const studentId: string = linkData.studentId;

    const studentRef = adminDb.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) {
      return NextResponse.json({ error: 'Student not found.' }, { status: 404 });
    }
    const studentData = studentDoc.data() as Student;

    // Upload to Firebase Storage
    const bucket = storage.bucket();
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const filePath = `students/${studentId}/student_uploads/${Date.now()}_${file.name}`;
    const blob = bucket.file(filePath);
    await blob.save(fileBuffer, { metadata: { contentType: file.type } });
    const [url] = await blob.getSignedUrl({ action: 'read', expires: '03-09-2491' });

    const now = new Date().toISOString();
    const newDocument: StudentDocument = {
      id: `doc-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      name: file.name,
      originalName: file.name,
      size: file.size,
      url,
      authorId: 'student-self-upload',
      uploadedAt: now,
      isNew: true,
    };

    await studentRef.update({
      documents: [...(studentData.documents || []), newDocument],
      newDocumentsForAdmin: (studentData.newDocumentsForAdmin || 0) + 1,
      newDocumentsForEmployee: (studentData.newDocumentsForEmployee || 0) + 1,
      newPublicUploadsForAdmin: (studentData.newPublicUploadsForAdmin || 0) + 1,
      newPublicUploadsForEmployee: (studentData.newPublicUploadsForEmployee || 0) + 1,
      lastActivityAt: now,
    });

    return NextResponse.json({ success: true, document: newDocument });
  } catch (error: any) {
    console.error('Public upload error:', error);
    return NextResponse.json({ error: 'Failed to upload.', details: error.message }, { status: 500 });
  }
}
