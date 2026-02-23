
import { NextRequest, NextResponse } from 'next/server';
import { adminDb, adminAuth, storage } from '@/lib/firebase/admin';
import type { User } from '@/lib/types';

// Helper to get user from DB
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
    
    const user = await getUser(decodedToken.uid);
    if (!user) {
        return NextResponse.json({ error: 'User not found in database.' }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const destination = formData.get('destination') as 'student' | 'shared' | 'user_avatar' | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }
    if (!destination) {
      return NextResponse.json({ error: 'No destination provided.' }, { status: 400 });
    }
    
    // Check permissions based on destination
    let filePath = '';
    if (destination === 'student') {
        const studentId = formData.get('studentId') as string | null;
        if (!studentId) {
            return NextResponse.json({ error: 'studentId is required for student destination.' }, { status: 400 });
        }
        
        const studentDoc = await adminDb.collection('students').doc(studentId).get();
        if (!studentDoc.exists) {
            return NextResponse.json({ error: 'Student not found.' }, { status: 404 });
        }
        const student = studentDoc.data();
        
        const canUpload = user.role === 'admin' || 
                          user.role === 'department' || 
                          (student?.employeeId && user.civilId && student.employeeId === user.civilId);
        
        if (!canUpload) {
          return NextResponse.json({ error: 'Forbidden: You do not have permission to upload to this student profile.' }, { status: 403 });
        }

        filePath = `students/${studentId}/${Date.now()}_${file.name}`;

    } else if (destination === 'shared') {
        const canUpload = user.role === 'admin' || user.role === 'department';
        if (!canUpload) {
            return NextResponse.json({ error: 'Forbidden: You do not have permission to upload to shared documents.' }, { status: 403 });
        }
        filePath = `shared_documents/${Date.now()}_${file.name}`;
    } else if (destination === 'user_avatar') {
        filePath = `user_avatars/${decodedToken.uid}/${Date.now()}_${file.name}`;
    } else {
        return NextResponse.json({ error: 'Invalid destination specified.' }, { status: 400 });
    }
    
    const bucket = storage.bucket();
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const blob = bucket.file(filePath);
    
    await blob.save(fileBuffer, {
        metadata: {
            contentType: file.type,
        },
    });

    await blob.makePublic();
    const downloadURL = blob.publicUrl();
    
    return NextResponse.json({ downloadURL });

  } catch (error: any) {
    console.error('API Upload Error:', error);
    return NextResponse.json({ error: 'Failed to process upload.', details: error.message }, { status: 500 });
  }
}
