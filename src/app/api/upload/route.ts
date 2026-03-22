'use server';

import { NextRequest, NextResponse } from 'next/server';
import { adminDb, adminAuth, storage } from '@/lib/firebase/admin';
import type { User, Student, SharedDocument, Country } from '@/lib/types';
import type { Document as StudentDocument } from '@/lib/types';
import { triggerDocumentUploadNotification } from '@/lib/actions';

export async function POST(req: NextRequest) {
  try {
    if (!adminDb || !storage || !adminAuth) {
      console.error('CRITICAL: Firebase Admin has not been initialized. Check service account key environment variable.');
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

    // Use the default bucket configured during Admin SDK initialization.
    const bucket = storage.bucket();
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    if (destination === 'student') {
        const studentId = formData.get('studentId') as string | null;
        if (!studentId) {
            return NextResponse.json({ error: 'studentId is required for student destination.' }, { status: 400 });
        }

        // 1. UPLOAD FILE TO STORAGE
        const filePath = `students/${studentId}/${Date.now()}_${file.name}`;
        const blob = bucket.file(filePath);
        await blob.save(fileBuffer, { metadata: { contentType: file.type } });
        
        const [url] = await blob.getSignedUrl({ action: 'read', expires: '03-09-2491' });

        // 2. UPDATE FIRESTORE DOCUMENT
        const studentRef = adminDb.collection('students').doc(studentId);
        const studentDoc = await studentRef.get();
        if (!studentDoc.exists) {
            return NextResponse.json({ error: 'Student not found.' }, { status: 404 });
        }
        const studentData = studentDoc.data() as Student;
        
        const fileName = customName || file.name;
        const now = new Date().toISOString();
        const newDocument: StudentDocument = {
            id: `doc-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            name: fileName,
            originalName: file.name,
            size: file.size,
            url: url,
            authorId: decodedToken.uid,
            uploadedAt: now,
            isNew: true,
        };
        
        const updatedDocuments = [...(studentData.documents || []), newDocument];
        
        // Update notification counters based on uploader role
        const uploaderDoc = await adminDb.collection('users').doc(decodedToken.uid).get();
        const uploaderRole = uploaderDoc.data()?.role;

        let counterUpdate: any = { lastActivityAt: now };
        if (uploaderRole === 'employee') {
          // Employee uploaded, notify admins
          counterUpdate = { 
            ...counterUpdate, 
            newDocumentsForAdmin: (studentData.newDocumentsForAdmin || 0) + 1,
            newDocsViewedBy: [decodedToken.uid]
          };
        } else if (uploaderRole === 'admin' || uploaderRole === 'department') {
          // Admin/Dept uploaded, notify employee
          counterUpdate = { 
            ...counterUpdate, 
            newDocumentsForEmployee: (studentData.newDocumentsForEmployee || 0) + 1,
            newDocsViewedBy: [decodedToken.uid]
          };
        }
   
        await studentRef.update({
            documents: updatedDocuments,
            ...counterUpdate,
        });

        // 3. Trigger WhatsApp Notification (Awaited)
        await triggerDocumentUploadNotification(studentId, fileName, decodedToken.uid);

        // 4. RETURN SUCCESS
        return NextResponse.json({ success: true, document: newDocument });

    } else if (destination === 'user_avatar') {
        const filePath = `user_avatars/${decodedToken.uid}/${Date.now()}_${file.name}`;
        const blob = bucket.file(filePath);
        await blob.save(fileBuffer, { metadata: { contentType: file.type } });
        const [downloadURL] = await blob.getSignedUrl({ action: 'read', expires: '03-09-2491' });

        await adminDb.collection('users').doc(decodedToken.uid).update({ avatarUrl: downloadURL });
        return NextResponse.json({ success: true, downloadURL });

    } else if (destination === 'shared') {
        const description = formData.get('description') as string | null;
        const country = formData.get('country') as string | null;

        const filePath = `shared_documents/${Date.now()}_${file.name}`;
        const blob = bucket.file(filePath);
        await blob.save(fileBuffer, { metadata: { contentType: file.type } });
        const [url] = await blob.getSignedUrl({ action: 'read', expires: '03-09-2491' });

        const newDocData: Omit<SharedDocument, 'id'> = {
            name: customName || file.name,
            description: description || '',
            url: url,
            authorId: decodedToken.uid,
            uploadedAt: new Date().toISOString(),
            size: file.size,
            ...(country && country !== 'all' && { country: country as Country }),
        };

        const newDocRef = await adminDb!.collection('shared_documents').add(newDocData);
        
        return NextResponse.json({ success: true, document: { id: newDocRef.id, ...newDocData } });
        
    } else {
        return NextResponse.json({ error: 'Invalid destination provided.' }, { status: 400 });
    }

  } catch (error: any) {
    console.error('Upload API Error:', error);
    return NextResponse.json({ error: 'Failed to process upload.', details: error.message }, { status: 500 });
  }
}
