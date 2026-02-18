
import { NextRequest, NextResponse } from 'next/server';
import admin from 'firebase-admin';

// Helper function to initialize Firebase Admin SDK idempotently.
function initializeAdmin() {
  const appName = 'UNIAPPLY_HUB_ADMIN_API'; // Unique name for this admin instance
  // Check if the app is already initialized to prevent errors.
  const existingApp = admin.apps.find(app => app?.name === appName);
  if (existingApp) {
    return existingApp;
  }

  let serviceAccount;
  const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64;
  
  if (serviceAccountBase64) {
    try {
      const decodedJson = Buffer.from(serviceAccountBase64, 'base64').toString('utf8');
      serviceAccount = JSON.parse(decodedJson);
      // Replace escaped newlines in the private key.
      if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }
    } catch (e: any) {
      throw new Error(`Failed to parse Base64-encoded service account key: ${e.message}`);
    }
  } else {
    throw new Error('Firebase Admin SDK credentials not found. Set FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 environment variable.');
  }

  // Initialize the app with the parsed credentials and a unique name.
  try {
    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: 'studio-9484431255-91d96.appspot.com'
    }, appName);
  } catch (error: any) {
    throw new Error(`Firebase Admin SDK initialization error: ${error.message}`);
  }
}


export async function POST(req: NextRequest) {
  try {
    const adminApp = initializeAdmin();
    const bucket = adminApp.storage().bucket();

    // Parse the multipart form data from the request.
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

    const fileBuffer = Buffer.from(await file.arrayBuffer());

    const blob = bucket.file(filePath);
    
    // Use the .save() method to upload the file buffer directly.
    // This is simpler and more robust than using streams for this use case.
    await blob.save(fileBuffer, {
        metadata: {
            contentType: file.type,
        },
    });

    await blob.makePublic();
    const downloadURL = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
    
    return NextResponse.json({ downloadURL });

  } catch (error: any) {
    console.error('API Upload Error:', error);
    // The user's original error is a TypeError. Let's make sure our response reflects that.
    if (error instanceof TypeError) {
        return NextResponse.json({ error: 'Failed to process upload.', details: 'TypeError: ' + error.message }, { status: 500 });
    }
    return NextResponse.json({ error: 'Failed to process upload.', details: error.message }, { status: 500 });
  }
}
