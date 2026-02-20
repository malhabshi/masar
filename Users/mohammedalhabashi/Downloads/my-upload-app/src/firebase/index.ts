import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getStorage, FirebaseStorage } from 'firebase/storage';
import { firebaseConfig } from './config';

export * from './provider';
export * from './firestore/use-collection';
export * from './firestore/use-doc';
export * from './auth/use-user';
export * from './non-blocking-updates';
export * from './use-memo-firebase';


let firebaseApp: FirebaseApp;

if (!getApps().length) {
  firebaseApp = initializeApp(firebaseConfig);
} else {
  firebaseApp = getApps()[0];
}

export function initializeFirebase() {
    const app = !getApps().length ? initializeApp(firebaseConfig) : getApps()[0];
    const auth = getAuth(app);
    const firestore = getFirestore(app);
    const storage = getStorage(app);
    return { firebaseApp: app, auth, firestore, storage };
}
