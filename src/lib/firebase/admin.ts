import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';

// Parse the base64 service account from environment
const getServiceAccount = () => {
  console.log('Attempting to read FIREBASE_SERVICE_ACCOUNT_KEY_BASE64...');
  const base64Key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64;
  if (!base64Key) {
    console.error('CRITICAL: FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 is not set in environment. Server actions will not work.');
    return null;
  }
  console.log('Service account key found in environment.');
  
  try {
    const serviceAccountString = Buffer.from(base64Key, 'base64').toString('utf-8');
    console.log('Service account key decoded successfully.');
    return JSON.parse(serviceAccountString);
  } catch (error) {
    console.error('CRITICAL: Failed to parse service account JSON. The key may be malformed or corrupted.', error);
    return null;
  }
};

const serviceAccount = getServiceAccount();
const bucketName = serviceAccount ? `${serviceAccount.project_id}.appspot.com` : undefined;


// Initialize Firebase Admin only if service account exists
if (!getApps().length && serviceAccount) {
  console.log('No existing Firebase Admin app found. Initializing a new one...');
  try {
    initializeApp({
      credential: cert(serviceAccount),
      storageBucket: bucketName
    });
    console.log('Firebase Admin initialized successfully.');
  } catch (error) {
    console.error('CRITICAL: Failed to initialize Firebase Admin SDK:', error);
  }
} else if (getApps().length) {
    console.log('Firebase Admin app already initialized.');
} else if (!serviceAccount) {
    console.log('Skipping Firebase Admin initialization because service account is missing or invalid.');
}


// Export admin services (will be null if initialization failed)
export const adminDb = getApps().length ? getFirestore() : null;
export const storage = getApps().length ? getStorage() : null;
export const adminAuth = getApps().length ? getAdminAuth() : null;
