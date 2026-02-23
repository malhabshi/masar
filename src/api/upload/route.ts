
import { NextRequest, NextResponse } from 'next/server';
import { adminDb, storage } from '@/lib/firebase/admin';

export async function POST(req: NextRequest) {
  try {
    // Check if the centralized Firebase Admin SDK has been initialized.
    if (!adminDb || !storage) {
      console.error('Firebase Admin has not been initialized. Check service account key environment variable.');
      return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });
    }

    // Get the storage bucket from the now-centralized admin app instance.
    // The bucket name must be specified if it's not set during initialization.
    const bucket = storage.bucket('studio-9484431255-91d96.appspot.com');

    // Parse the multipart form data from the request just once.
    const formData = await req.formData();
    
    const file = formData.get('file') as File | null;
    const destination = formData.get('destination') as 'student' | 'shared' | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }
    if (!destination) {
      return NextResponse.json({ error: 'No destination provided.' }, { status: 400 });
    }

    let filePath = '';
    if (destination === 'student') {
        const studentId = formData.get('studentId') as string | null;
        if (!studentId) {
            return NextResponse.json({ error: 'studentId is required for student destination.' }, { status: 400 });
        }
        filePath = `students/${studentId}/${Date.now()}_${file.name}`;
    } else if (destination === 'shared') {
        filePath = `shared_documents/${Date.now()}_${file.name}`;
    } else {
        return NextResponse.json({ error: 'Invalid destination specified.' }, { status: 400 });
    }

    // Convert the file to a buffer.
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    // Get a reference to the file in Firebase Storage.
    const blob = bucket.file(filePath);
    
    // Use the .save() method to upload the file buffer directly.
    await blob.save(fileBuffer, {
        metadata: {
            contentType: file.type,
        },
    });

    // Make the file public and get its URL.
    await blob.makePublic();
    const downloadURL = blob.publicUrl();
    
    return NextResponse.json({ downloadURL });

  } catch (error: any) {
    console.error('API Upload Error:', error);
    return NextResponse.json({ error: 'Failed to process upload.', details: error.message }, { status: 500 });
  }
}
