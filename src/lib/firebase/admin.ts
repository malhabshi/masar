import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

// Parse the base64 service account from environment
const getServiceAccount = () => {
  const base64Key = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64;
  if (!base64Key) {
    console.warn('FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 is not set. Server actions will not work.');
    return null;
  }
  
  try {
    return JSON.parse(Buffer.from(base64Key, 'base64').toString());
  } catch (error) {
    console.error('Failed to parse service account:', error);
    return null;
  }
};

const serviceAccount = getServiceAccount();
const bucketName = serviceAccount ? `${serviceAccount.project_id}.appspot.com` : undefined;


// Initialize Firebase Admin only if service account exists
if (!getApps().length && serviceAccount) {
  try {
    initializeApp({
      credential: cert(serviceAccount),
      storageBucket: bucketName
    });
    console.log('Firebase Admin initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Firebase Admin:', error);
  }
}

// Export admin services (will be null if initialization failed)
export const adminDb = getApps().length ? getFirestore() : null;
export const storage = getApps().length ? getStorage() : null;
