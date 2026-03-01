'use client';

/**
 * @fileOverview Firebase Client SDK Barrel Exports
 * Centrally manages instances, providers, and hooks.
 */

export { auth, firestore, app as firebaseApp } from './init';
export * from './provider';
export * from './client-provider';
export * from './firestore/use-collection';
export * from './firestore/use-doc';
export * from './firestore/non-blocking-updates';
export * from './errors';
export * from './error-emitter';

import { auth, firestore, app } from './init';
import { FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

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
