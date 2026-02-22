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
export { firebaseApp, auth, firestore, storage };

// Re-export hooks and utilities for a single entry point
export * from './firestore/use-collection';
export * from './firestore/use-doc';
export * from './firestore/non-blocking-updates';
export * from './firestore/memo';
