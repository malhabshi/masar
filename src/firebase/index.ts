import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';
import { firebaseConfig } from './config';

// --- Firebase App Initialization ---
function initializeFirebaseApp(): FirebaseApp {
  const apps = getApps();
  if (apps.length > 0) {
    return apps[0];
  }
  return initializeApp(firebaseConfig);
}

const firebaseApp = initializeFirebaseApp();

// --- Service Getters ---
const auth: Auth = getAuth(firebaseApp);
const firestore: Firestore = getFirestore(firebaseApp);
const storage: FirebaseStorage = getStorage(firebaseApp);

// --- Exports ---
// These are safe for both server and client environments.
export { firebaseApp, auth, firestore, storage };

// Client-side hooks and utilities are NOT exported from this file.
// They are exported from './client.ts' to prevent bundling client-code in server components.
