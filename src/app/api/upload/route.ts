
'use server';

import { NextRequest, NextResponse } from 'next/server';
import { adminDb, adminAuth, storage } from '@/lib/firebase/admin';
import type { User, Student } from '@/lib/types';
import type { Document as StudentDocument } from '@/lib/types';

console.log('🔥🔥🔥 UPLOAD API ROUTE CALLED 🔥🔥🔥');

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

     console.log('📦 Form data received:', {
       file: file?.name,
       destination,
       studentId: formData.get('studentId'),
       customName
     });


    if (!file) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }
    if (!destination) {
      return NextResponse.json({ error: 'No destination provided.' }, { status: 400 });
    }

    const bucket = storage.bucket('studio-9484431255-91d96.firebasestorage.app');
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    if (destination === 'student') {
        const studentId = formData.get('studentId') as string | null;
        if (!studentId) {
            return NextResponse.json({ error: 'studentId is required for student destination.' }, { status: 400 });
        }

        // 1. UPLOAD FILE TO STORAGE
        const filePath = `students/${studentId}/${Date.now()}_${file.name}`;
        console.log('📁 Attempting to upload to storage path:', filePath);
        const blob = bucket.file(filePath);
        await blob.save(fileBuffer, { metadata: { contentType: file.type } });
        console.log('✅ File saved to storage successfully');
        
        const [url] = await blob.getSignedUrl({ action: 'read', expires: '03-09-2491' });

        // 2. UPDATE FIRESTORE DOCUMENT
        const studentRef = adminDb.collection('students').doc(studentId);
        const studentDoc = await studentRef.get();
        if (!studentDoc.exists) {
            return NextResponse.json({ error: 'Student not found.' }, { status: 404 });
        }
        const studentData = studentDoc.data() as Student;
        
        const newDocument: StudentDocument = {
            id: `doc-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
            name: customName || file.name,
            originalName: file.name,
            size: file.size,
            url: url,
            authorId: decodedToken.uid,
            uploadedAt: new Date().toISOString(),
            isNew: true,
        };
        
        console.log('📝 Updating Firestore with new document:', newDocument);
        const updatedDocuments = [...(studentData.documents || []), newDocument];
        
        await studentRef.update({ documents: updatedDocuments });
        
        // Update notification counters based on uploader role
        const uploaderDoc = await adminDb.collection('users').doc(decodedToken.uid).get();
        const uploaderRole = uploaderDoc.data()?.role;
   
        if (uploaderRole === 'employee') {
          await studentRef.update({ 
            newDocumentsForAdmin: (studentData.newDocumentsForAdmin || 0) + 1 
          });
        } else {
          await studentRef.update({ 
            newDocumentsForEmployee: (studentData.newDocumentsForEmployee || 0) + 1 
          });
        }

        // 3. RETURN SUCCESS
        return NextResponse.json({ success: true, document: newDocument });

    } else if (destination === 'user_avatar') {
        const filePath = `user_avatars/${decodedToken.uid}/${Date.now()}_${file.name}`;
        console.log('📁 Attempting to upload to storage path:', filePath);
        const blob = bucket.file(filePath);
        await blob.save(fileBuffer, { metadata: { contentType: file.type } });
        await blob.makePublic();
        const downloadURL = blob.publicUrl();

        await adminDb.collection('users').doc(decodedToken.uid).update({ avatarUrl: downloadURL });
        return NextResponse.json({ success: true, downloadURL });

    } else {
        return NextResponse.json({ error: 'Invalid destination provided.' }, { status: 400 });
    }

  } catch (error: any) {
    console.error('🔥🔥🔥 FULL ERROR OBJECT:', error);
    console.error('🔥 Error name:', error.name);
    console.error('🔥 Error message:', error.message);
    console.error('🔥 Error stack:', error.stack);
    if (error.code) console.error('🔥 Error code:', error.code);
    if (error.response) console.error('🔥 Error response:', error.response);
    return NextResponse.json({ error: 'Failed to process upload.', details: error.message }, { status: 500 });
  }
}
