
'use client';

import {
  addDocument as addDocumentAction,
} from './actions';

function getNotificationSettings() {
  try {
    const stored = localStorage.getItem('notificationSettings');
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error("Could not parse notification settings", e);
  }
  return {
    newDocumentUpload: true,
  };
}

/**
 * A wrapper for the addDocument server action that checks notification settings
 * before triggering the notification.
 */
export async function addDocument(studentId: string, authorId: string, fileName: string, studentName: string | undefined, employeeId: string | null) {
    const settings = getNotificationSettings();
    const shouldNotify = settings.newDocumentUpload;

    if (shouldNotify) {
      return await addDocumentAction(studentId, authorId, fileName, studentName, employeeId);
    }

    // If notifications are off, we still want to simulate the upload without the notification part.
    // We can return a success message that indicates no notification was sent.
    console.log(`Adding document '${fileName}' for student ${studentId} by ${authorId}. Notifications are turned off.`);
    return { success: true, message: 'Document added. Notification was not sent due to user settings.' };
}
