
'use client';
    
import {
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  CollectionReference,
  DocumentReference,
  SetOptions,
  DocumentData,
} from 'firebase/firestore';
import { errorEmitter } from '@/firebase/error-emitter';
import {FirestorePermissionError} from '@/firebase/errors';

/**
 * Initiates a setDoc operation for a document reference.
 * Does NOT await the write operation internally.
 */
export function setDocumentNonBlocking(docRef: DocumentReference, data: any, options?: SetOptions) {
  const promise = options ? setDoc(docRef, data, options) : setDoc(docRef, data);
  promise.catch(error => {
    errorEmitter.emit(
      'permission-error',
      new FirestorePermissionError({
        path: docRef.path,
        operation: (options && 'merge' in options) ? 'update' : 'write',
        requestResourceData: data,
      })
    )
  })
}


/**
 * Initiates an addDoc or setDoc operation for a collection.
 * If a customId is provided, it uses setDoc to create a document with that ID.
 * If no customId is provided, it uses addDoc to auto-generate an ID.
 * Does NOT await the write operation internally.
 * Returns a promise that resolves with the document's ID.
 */
export function addDocumentNonBlocking(colRef: CollectionReference, data: any, customId?: string): Promise<string | undefined> {
  if (customId) {
    const docRef = doc(colRef, customId);
    return setDoc(docRef, data)
      .then(() => customId)
      .catch(error => {
        errorEmitter.emit(
          'permission-error',
          new FirestorePermissionError({
            path: docRef.path,
            operation: 'create',
            requestResourceData: data,
          })
        );
        return undefined; // Return undefined on error
      });
  } else {
    return addDoc(colRef, data)
      .then(docRef => docRef.id)
      .catch(error => {
        errorEmitter.emit(
          'permission-error',
          new FirestorePermissionError({
            path: colRef.path,
            operation: 'create',
            requestResourceData: data,
          })
        );
        return undefined; // Return undefined on error
      });
  }
}


/**
 * Initiates an updateDoc operation for a document reference.
 * Does NOT await the write operation internally.
 */
export function updateDocumentNonBlocking(docRef: DocumentReference, data: any) {
  updateDoc(docRef, data)
    .catch(error => {
      errorEmitter.emit(
        'permission-error',
        new FirestorePermissionError({
          path: docRef.path,
          operation: 'update',
          requestResourceData: data,
        })
      )
    });
}


/**
 * Initiates a deleteDoc operation for a document reference.
 * Does NOT await the write operation internally.
 */
export function deleteDocumentNonBlocking(docRef: DocumentReference) {
  deleteDoc(docRef)
    .catch(error => {
      errorEmitter.emit(
        'permission-error',
        new FirestorePermissionError({
          path: docRef.path,
          operation: 'delete',
        })
      )
    });
}
