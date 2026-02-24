'use server';

import { NextRequest, NextResponse } from 'next/server';
import { adminDb, adminAuth, storage } from '@/lib/firebase/admin';
import type { User, Student, Document as StudentDocument } from '@/lib/types';
import { FieldPath } from 'firebase-admin/firestore';

// Re-using the getUser helper from actions.ts, but defined locally for the route
async function getUser(userId: string): Promise<User | null> {
    if (!adminDb) return null;
    const doc = await adminDb.collection('users').doc(userId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() } as User;
}

export async function POST(req: NextRequest) {
  try {
    if (!adminDb || !storage || !adminAuth) {
      console.error('Firebase Admin has not been initialized. Check service account key environment variable.');
      return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });
    }

    const authHeader = req.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized: No token provided.' }, { status: 401 });
    }

    const token = authHeader.split('Bearer ')[1];
    let decodedToken;
    try {
        decodedToken = await adminAuth.verifyIdToken(token);
    } catch (error) {
        console.error('Token verification error:', error);
        return NextResponse.json({ error: 'Invalid or expired token.' }, { status: 401 });
    }

    const uploader = await getUser(decodedToken.uid);
    if (!uploader) {
        return NextResponse.json({ error: 'User not found in database.' }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const destination = formData.get('destination') as 'student' | 'shared' | 'user_avatar' | null;
    const customName = formData.get('customName') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }
    if (!destination) {
      return NextResponse.json({ error: 'No destination provided.' }, { status: 400 });
    }

    const bucket = storage.bucket();
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    if (destination === 'student') {
        const studentId = formData.get('studentId') as string | null;
        if (!studentId) {
            return NextResponse.json({ error: 'studentId is required for student destination.' }, { status: 400 });
        }

        const studentRef = adminDb.collection('students').doc(studentId);
        const studentDoc = await studentRef.get();
        if (!studentDoc.exists) {
            return NextResponse.json({ error: 'Student not found.' }, { status: 404 });
        }
        const studentData = studentDoc.data() as Student;

        const canUpload = uploader.role === 'admin' ||
                          uploader.role === 'department' ||
                          (studentData.employeeId && uploader.civilId && studentData.employeeId === uploader.civilId);

        if (!canUpload) {
          return NextResponse.json({ error: 'Forbidden: You do not have permission to upload to this student profile.' }, { status: 403 });
        }

        const filePath = `students/${studentId}/${Date.now()}_${file.name}`;
        const blob = bucket.file(filePath);
        await blob.save(fileBuffer, { metadata: { contentType: file.type } });
        const [url] = await blob.getSignedUrl({ action: 'read', expires: '03-09-2491' });

        // --- THIS IS THE NEW, CONSOLIDATED DATABASE UPDATE LOGIC ---
        const newDocument: StudentDocument = {
            id: `doc-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            name: customName || file.name,
            originalName: file.name,
            size: file.size,
            url: url,
            authorId: decodedToken.uid,
            uploadedAt: new Date().toISOString(),
            isNew: true,
        };
        
        const updates: any = {
            documents: [...(studentData.documents || []), newDocument],
        };

        if (uploader.role === 'employee') {
            updates.newDocumentsForAdmin = (studentData.newDocumentsForAdmin || 0) + 1;
        } else if (['admin', 'department'].includes(uploader.role)) {
            updates.newDocumentsForEmployee = (studentData.newDocumentsForEmployee || 0) + 1;
        }

        await studentRef.update(updates);

        return NextResponse.json({ success: true, document: newDocument });

    } else if (destination === 'user_avatar') {
        const filePath = `user_avatars/${decodedToken.uid}/${Date.now()}_${file.name}`;
        const blob = bucket.file(filePath);
        await blob.save(fileBuffer, { metadata: { contentType: file.type } });
        await blob.makePublic();
        const downloadURL = blob.publicUrl();

        await adminDb.collection('users').doc(decodedToken.uid).update({ avatarUrl: downloadURL });
        return NextResponse.json({ success: true, downloadURL });

    } else {
        // Logic for other destinations like 'shared'
        const canUpload = uploader.role === 'admin' || uploader.role === 'department';
        if (destination === 'shared' && !canUpload) {
             return NextResponse.json({ error: 'Forbidden: You do not have permission to upload to shared documents.' }, { status: 403 });
        }
        const filePath = `shared_documents/${Date.now()}_${file.name}`;
        const blob = bucket.file(filePath);
        await blob.save(fileBuffer, { metadata: { contentType: file.type } });
        const [url] = await blob.getSignedUrl({ action: 'read', expires: '03-09-2491' });
        const downloadURL = url;
        return NextResponse.json({ success: true, downloadURL });
    }

  } catch (error: any) {
    console.error('API Upload Error:', error);
    return NextResponse.json({ error: 'Failed to process upload.', details: error.message }, { status: 500 });
  }
}
