'use client';

import { firebaseConfig } from '@/firebase/config';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth } from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore'

let app: FirebaseApp;
let auth: Auth;
let firestore: Firestore;

// Initialize Firebase services only on the client side
if (typeof window !== 'undefined') {
    if (!getApps().length) {
        try {
            // Attempt to initialize via Firebase App Hosting environment variables
            app = initializeApp();
        } catch (e) {
            // Fallback to local config for development
            app = initializeApp(firebaseConfig);
        }
    } else {
        app = getApp();
    }
    auth = getAuth(app);
    firestore = getFirestore(app);
}

export { auth, firestore };

export function initializeFirebase() {
  if (typeof window === 'undefined') return {} as any;
  return {
    firebaseApp: app,
    auth,
    firestore
  };
}

export function getSdks(firebaseApp: FirebaseApp) {
  return {
    firebaseApp,
    auth: getAuth(firebaseApp),
    firestore: getFirestore(firebaseApp)
  };
}

export * from './provider';
export * from './client-provider';
export * from './firestore/use-collection';
export * from './firestore/use-doc';
export * from './non-blocking-updates';
export * from './non-blocking-login';
export * from './errors';
export * from './error-emitter';
