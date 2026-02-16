'use client';

import { firebaseConfig } from '@/firebase/config';
import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage';

const APP_NAME = "UniApplyHub";

// IMPORTANT: DO NOT MODIFY THIS FUNCTION
export function initializeFirebase() {
  const apps = getApps();
  const existingApp = apps.find(app => app.name === APP_NAME);

  if (!existingApp) {
    // Initialize our named app with the explicit configuration.
    // This guarantees all services, especially Storage, have the correct properties.
    const firebaseApp = initializeApp(firebaseConfig, APP_NAME);
    const sdks = getSdks(firebaseApp);
    return sdks;
  }

  // If our named app is already initialized, return its SDKs.
  const sdks = getSdks(existingApp);
  return sdks;
}

export function getSdks(firebaseApp: FirebaseApp) {
  return {
    firebaseApp,
    auth: getAuth(firebaseApp),
    firestore: getFirestore(firebaseApp),
    storage: getStorage(firebaseApp)
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
