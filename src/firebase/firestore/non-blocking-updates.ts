'use client';

import { 
  addDoc, 
  updateDoc, 
  deleteDoc,
  setDoc,
  DocumentReference,
  CollectionReference
} from 'firebase/firestore';
import { errorEmitter } from '@/firebase/error-emitter';
import { FirestorePermissionError } from '@/firebase/errors';


// Non-blocking add document
export function addDocumentNonBlocking<T extends Record<string, any>>(
  collectionRef: CollectionReference, 
  data: T
) {
  addDoc(collectionRef, data)
    .catch(async (serverError) => {
        const permissionError = new FirestorePermissionError({
          path: collectionRef.path,
          operation: 'create',
          requestResourceData: data,
        });
        errorEmitter.emit('permission-error', permissionError);
      });
}

// Non-blocking update document
export function updateDocumentNonBlocking(
  docRef: DocumentReference, 
  data: any
) {
  updateDoc(docRef, data)
    .catch(async (serverError) => {
        const permissionError = new FirestorePermissionError({
          path: docRef.path,
          operation: 'update',
          requestResourceData: data,
        });
        errorEmitter.emit('permission-error', permissionError);
      });
}

// Non-blocking set document
export function setDocumentNonBlocking(
  docRef: DocumentReference,
  data: any
) {
    setDoc(docRef, data, { merge: true })
        .catch(async (serverError) => {
            const permissionError = new FirestorePermissionError({
                path: docRef.path,
                operation: 'write',
                requestResourceData: data,
            });
            errorEmitter.emit('permission-error', permissionError);
        });
}


// Non-blocking delete document
export function deleteDocumentNonBlocking(
  docRef: DocumentReference
) {
  deleteDoc(docRef)
    .catch(async (serverError) => {
        const permissionError = new FirestorePermissionError({
          path: docRef.path,
          operation: 'delete',
        });
        errorEmitter.emit('permission-error', permissionError);
      });
}
