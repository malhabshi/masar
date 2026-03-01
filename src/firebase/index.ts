'use client';

import { firebaseConfig } from '@/firebase/config';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

/**
 * @fileOverview Firebase Client SDK Initialization & Barrel Exports
 * 
 * This file serves as the primary entry point for all client-side Firebase 
 * interactions. It ensures single-instance initialization and exports
 * consolidated hooks and utilities from the firestore/ subdirectory.
 */

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const auth = getAuth(app);
const firestore = getFirestore(app);

export { auth, firestore };

export function initializeFirebase() {
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

// Consolidated exports from subdirectories
export * from './provider';
export * from './client-provider';
export * from './firestore/use-collection';
export * from './firestore/use-doc';
export * from './firestore/non-blocking-updates';
// Removed * export from memo to avoid useMemoFirebase conflict with provider.
// useMemoFirebase is correctly handled within provider.tsx for this architecture.
export * from './errors';
export * from './error-emitter';