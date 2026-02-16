
import { NextRequest, NextResponse } from 'next/server';
import admin from 'firebase-admin';

// Helper function to initialize Firebase Admin SDK idempotently.
function initializeAdmin() {
  // Check if the app is already initialized to prevent errors.
  if (admin.apps.length > 0) {
    return admin;
  }

  let serviceAccount;
  const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64;
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_JSON;

  // Prioritize the Base64 environment variable (for Vercel/hosting).
  if (serviceAccountBase64) {
    try {
      // Decode the Base64 string to a JSON string.
      const decodedJson = Buffer.from(serviceAccountBase64, 'base64').toString('utf8');
      serviceAccount = JSON.parse(decodedJson);
      // The private_key field often has escaped newlines when stored as an env var.
      // This line replaces '\\n' with the actual newline character '\n'.
      if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }
    } catch (e: any) {
      // If parsing fails, throw a specific error.
      throw new Error(`Failed to parse Base64-encoded service account key: ${e.message}`);
    }
  } 
  // Fallback to the direct JSON variable (for local development).
  else if (serviceAccountJson) {
    try {
      serviceAccount = JSON.parse(serviceAccountJson);
    } catch (e: any) {
      throw new Error(`Failed to parse JSON service account key: ${e.message}`);
    }
  } 
  // If neither is found, throw an error.
  else {
    throw new Error('Firebase Admin SDK credentials not found. Set FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 or FIREBASE_SERVICE_ACCOUNT_KEY_JSON.');
  }

  // Initialize the app with the parsed credentials.
  try {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      storageBucket: 'studio-9484431255-91d96.appspot.com'
    });
  } catch (error: any) {
    throw new Error(`Firebase Admin SDK initialization error: ${error.message}`);
  }
  
  return admin;
}


export async function POST(req: NextRequest) {
  try {
    // Initialize Admin SDK within the request to catch any setup errors.
    const adminApp = initializeAdmin();
    const bucket = adminApp.storage().bucket();

    // Parse the multipart form data from the request.
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const destination = formData.get('destination') as 'student' | 'shared' | null;

    // Validate that a file and destination were provided.
    if (!file) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }
    if (!destination) {
      return NextResponse.json({ error: 'No destination provided.' }, { status: 400 });
    }

    // Determine the upload path based on the 'destination' parameter.
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

    // Get the file content as a buffer.
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    // Create a reference to the file in the bucket.
    const blob = bucket.file(filePath);
    
    // Create a writable stream to upload the file.
    const blobStream = blob.createWriteStream({
        metadata: {
            contentType: file.type,
        },
        resumable: false // Use a simple upload for reliability.
    });

    // Wait for the upload to complete.
    await new Promise((resolve, reject) => {
        blobStream.on('error', (err) => {
            console.error("Upload stream error:", err);
            reject(new Error('Failed to upload file to storage.'));
        });

        blobStream.on('finish', () => {
            resolve(true);
        });

        // Write the file buffer to the stream and end it.
        blobStream.end(fileBuffer);
    });

    // Make the file public to get a downloadable URL.
    await blob.makePublic();
    const downloadURL = `https://storage.googleapis.com/${bucket.name}/${filePath}`;
    
    // Return the public URL in a JSON response.
    return NextResponse.json({ downloadURL });

  } catch (error: any) {
    // If any part of the try block fails, log the error and return a proper JSON error response.
    console.error('API Upload Error:', error);
    return NextResponse.json({ error: 'Failed to process upload.', details: error.message }, { status: 500 });
  }
}
