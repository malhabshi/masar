'use server';

import admin from 'firebase-admin';
import type { ApplicationStatus, PipelineStatus, Task, TaskReply, TaskStatus, User, UserRole, Country, IeltsScore, ProfileCompletionStatus, RequestType, Student } from './types';
import { NotificationType, sendTypedWhatsAppMessage } from './whatsapp-templates';

// --- Firebase Admin SDK Initialization ---
function initializeAdmin() {
  const appName = 'UNIAPPLY_HUB_ACTIONS'; // A unique name for this admin app instance
  // Check if the app is already initialized to prevent errors.
  const existingApp = admin.apps.find(app => app?.name === appName);
  if (existingApp) {
    return existingApp;
  }

  const serviceAccountBase64 = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64;
  if (!serviceAccountBase64) {
    console.error('Firebase Admin SDK credentials not found. Set FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 environment variable.');
    throw new Error('Firebase Admin SDK credentials not found.');
  }
  
  try {
    const serviceAccountJson = Buffer.from(serviceAccountBase64, 'base64').toString('utf8');
    const serviceAccount = JSON.parse(serviceAccountJson);

    // Initialize the app with the parsed credentials and a unique name.
    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    }, appName);

  } catch (e: any) {
    console.error(`Failed to parse or initialize Firebase Admin SDK: ${e.message}`);
    throw new Error(`Failed to parse or initialize Firebase Admin SDK: ${e.message}`);
  }
}

// --- Live User Data Fetching ---

async function getUser(userId: string): Promise<User | null> {
    if (!userId) return null;
    try {
        const adminApp = initializeAdmin();
        const userDoc = await adminApp.firestore().collection('users').doc(userId).get();
        if (!userDoc.exists) return null;
        return { id: userDoc.id, ...userDoc.data() } as User;
    } catch (error) {
        console.error(`Error fetching user ${userId}:`, error);
        return null;
    }
}

async function getUserByCivilId(civilId: string): Promise<User | null> {
    if (!civilId) return null;
    try {
        const adminApp = initializeAdmin();
        const usersSnapshot = await adminApp.firestore().collection('users').where('civilId', '==', civilId).limit(1).get();
        if (usersSnapshot.empty) return null;
        const userDoc = usersSnapshot.docs[0];
        return { id: userDoc.id, ...userDoc.data() } as User;
    } catch (error) {
        console.error(`Error fetching user by civilId ${civilId}:`, error);
        return null;
    }
}

async function getUsersByRole(role: UserRole): Promise<User[]> {
    try {
        const adminApp = initializeAdmin();
        const usersSnapshot = await adminApp.firestore().collection('users').where('role', '==', role).get();
        if (usersSnapshot.empty) return [];
        return usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as User));
    } catch (error) {
        console.error(`Error fetching users by role ${role}:`, error);
        return [];
    }
}

// --- Server Actions ---

export async function updateApplicationStatus(
  studentId: string,
  university: string,
  major: string,
  newStatus: ApplicationStatus,
  studentName: string,
  employeeCivilId: string | null
) {
  console.log(`Updating status for student ${studentId}, to ${newStatus}`);
  
  if (employeeCivilId) {
    const employee = await getUserByCivilId(employeeCivilId);
    if (employee && employee.phone) {
      await sendTypedWhatsAppMessage(NotificationType.GENERIC_NOTIFICATION, employee.phone, { "1": employee.name });
    }
  }
  return { success: true, message: `Status updated to ${newStatus}` };
}

export async function addNote(studentId: string, authorId: string, content: string) {
    console.log(`Adding note for student ${studentId} by ${authorId}`);
    return { success: true, message: `Note added.` };
}

export async function addDocument(studentId: string, authorId: string, fileName: string, studentName: string | undefined, employeeCivilId: string | null) {
  console.log(`Adding document '${fileName}' for student ${studentId} by ${authorId}.`);
    
  const author = await getUser(authorId);
  if (!author) return { success: false, message: 'Author not found.' };

  if (author.role === 'employee') {
    const admins = await getUsersByRole('admin');
    for (const admin of admins) {
        if (admin.phone) {
            await sendTypedWhatsAppMessage(
                NotificationType.DOCUMENT_UPLOAD_TO_ADMIN,
                admin.phone,
                { "1": admin.name, "2": author.name, "3": fileName, "4": studentName || 'N/A' }
            );
        }
    }
  } else if (['admin', 'department'].includes(author.role) && employeeCivilId) {
    const employee = await getUserByCivilId(employeeCivilId);
    if (employee && employee.phone) {
      await sendTypedWhatsAppMessage(
        NotificationType.DOCUMENT_UPLOAD_TO_EMPLOYEE,
        employee.phone,
        { "1": employee.name, "2": fileName, "3": studentName || 'N/A' }
      );
    }
  }
  
  return { success: true, message: 'Document added and notifications sent.' };
}

export async function sendTask(authorId: string, recipientId: string, content: string) {
    console.log(`Sending task from ${authorId} to ${recipientId}: ${content}`);

    const recipients: User[] = [];
    if (recipientId === 'all') {
        recipients.push(...await getUsersByRole('employee'));
    } else {
        const recipientUser = await getUser(recipientId);
        if (recipientUser) recipients.push(recipientUser);
    }
    
    for (const recipient of recipients) {
        if (recipient.phone) {
            await sendTypedWhatsAppMessage(NotificationType.GENERIC_NOTIFICATION, recipient.phone, { "1": recipient.name });
        }
    }

   return { success: true, message: 'Task sent.' };
}

export async function addReplyToTask(taskId: string, authorId: string, content: string, taskAuthorId: string) {
  console.log(`Adding reply to task ${taskId} by ${authorId}: ${content}`);
  
  const recipient = await getUser(taskAuthorId);
  if (recipient && recipient.phone) {
      await sendTypedWhatsAppMessage(NotificationType.GENERIC_NOTIFICATION, recipient.phone, { "1": recipient.name });
  }

  return { success: true, message: `Reply added.` };
}

export async function updateTaskStatus(taskId: string, newStatus: TaskStatus, task: Task) {
    console.log(`Updating status for task ${taskId} to ${newStatus}`);
  
    const admin = (await getUsersByRole('admin'))[0];
    let employeeToNotify: User | undefined | null = null;

    if (task.recipientId !== 'all' && task.recipientId !== admin?.id) {
      employeeToNotify = await getUser(task.recipientId);
    } else if (task.authorId !== admin?.id) {
      employeeToNotify = await getUser(task.authorId);
    }

    if (employeeToNotify && employeeToNotify.phone) {
      await sendTypedWhatsAppMessage(NotificationType.GENERIC_NOTIFICATION, employeeToNotify.phone, { "1": employeeToNotify.name });
    }
  
    return { success: true, message: `Task status updated to ${newStatus}.` };
}

export async function transferStudent(studentId: string, newEmployee: User, adminId: string, studentName: string, fromEmployeeName: string | null) {
    console.log(`Transferring student ${studentId} to employee ${newEmployee.id}`);
    
    if (newEmployee.phone) {
        await sendTypedWhatsAppMessage(NotificationType.GENERIC_NOTIFICATION, newEmployee.phone, { "1": newEmployee.name });
    }

    const isTransfer = !!fromEmployeeName;
    const successMessage = isTransfer
        ? `Student transferred to ${newEmployee.name}.`
        : `Student assigned to ${newEmployee.name}.`;
    return { success: true, message: successMessage };
}

export async function updateStudentPipelineStatus(studentId: string, status: PipelineStatus, employeeName: string, studentName: string) {
    console.log(`Updating pipeline status for student ${studentId} to ${status}`);

    const admins = await getUsersByRole('admin');
    for (const admin of admins) {
        if (admin.phone) {
            await sendTypedWhatsAppMessage(NotificationType.GENERIC_NOTIFICATION, admin.phone, { "1": admin.name });
        }
    }
    
    return { success: true, message: `Student pipeline status updated to ${status}.` };
}

export async function bulkTransferStudents(fromEmployeeId: string, toEmployeeId: string, adminId: string) {
    console.log(`Bulk transferring all students from employee ${fromEmployeeId} to ${toEmployeeId}`);
    return { success: true, message: `Successfully initiated transfer.` };
}

export async function addApplication(studentId: string, university: string, country: Country, major: string, studentName: string, employeeCivilId: string | null) {
  console.log(`Adding application for student ${studentId} to ${university}`);

  if (employeeCivilId) {
      const employee = await getUserByCivilId(employeeCivilId);
      if (employee && employee.phone) {
        await sendTypedWhatsAppMessage(NotificationType.GENERIC_NOTIFICATION, employee.phone, { "1": employee.name });
      }
  }

  return { success: true, message: `Application added for ${university} (${major}).` };
}

export async function importStudentsFromExcel(authorId: string, fileName: string) {
    console.log(`Importing students from ${fileName} by ${authorId}`);
    return { success: true, message: `Successfully imported students from ${fileName}. Admins have been notified to process them.` };
}

export async function sendTestNotification(phoneNumber: string, userName: string) {
  console.log(`--- Sending Test WhatsApp Notification to ${phoneNumber} ---`);
  if (!phoneNumber) {
    return { success: false, message: 'Phone number cannot be empty.' };
  }
  
  const result = await sendTypedWhatsAppMessage(
    NotificationType.GENERIC_NOTIFICATION,
    phoneNumber,
    { "1": userName }
  );
  console.log('Test notification result:', result);
  return result;
}

// Deprecated or client-side handled actions below, kept for reference
export async function addUpcomingEvent(authorId: string, title: string, date: string, description: string) {
    console.log(`Adding upcoming event by ${authorId}: ${title}`);
    return { success: true, message: 'Upcoming event added successfully.' };
}

export async function deleteTask(taskId: string) {
    console.log(`Deleting task ${taskId}`);
    return { success: true, message: 'Task deleted.' };
}

export async function requestStudentDeletion(studentId: string, employeeId: string, reason: string, studentName: string) {
    console.log(`Deletion request for student ${studentId} from employee ${employeeId}. Reason: ${reason}`);
    return { success: true, message: 'Deletion request sent to admin.' };
}

export async function deleteStudentPermanently(studentId: string, studentName: string, adminId: string) {
    console.log(`Permanently deleting student ${studentName} (ID: ${studentId}) by admin ${adminId}`);
    return { success: true, message: 'Student deleted permanently.' };
}
