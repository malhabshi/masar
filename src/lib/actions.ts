'use server';

import { adminDb } from '@/lib/firebase/admin';
import type { User, Student, Application, ApplicationStatus, Task, Note, TaskStatus } from './types';
import { sendTypedWhatsAppMessage, NotificationType } from './whatsapp-templates';

// Helper to check if adminDb is available
function checkAdminDb() {
  if (!adminDb) {
    console.error('Firebase Admin not initialized. Check FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 env var.');
    return false;
  }
  return true;
}

// Helper to get user from DB
async function getUser(userId: string): Promise<User | null> {
    if (!checkAdminDb()) return null;
    const doc = await adminDb!.collection('users').doc(userId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() } as User;
}

// --- NOTIFICATION ACTIONS ---

async function sendWhatsAppMessage(userId: string, type: NotificationType, data: Record<string, string>) {
  if (!checkAdminDb()) return { success: false, message: 'Server database not available.' };

  try {
    const user = await getUser(userId);
    if (!user || !user.phone) {
      console.log(`Notification not sent: User ${userId} not found or has no phone number.`);
      return { success: false, message: 'User not found or has no phone number.' };
    }
    
    const result = await sendTypedWhatsAppMessage(type, user.phone, data);

    if (result.success) {
        await adminDb!.collection('notification_logs').add({
            type: 'whatsapp',
            template: type,
            recipientId: userId,
            recipientPhone: user.phone,
            status: 'sent',
            timestamp: new Date().toISOString(),
            data,
        });
    }

    return result;

  } catch (error) {
    console.error(`Failed to send WhatsApp notification for user ${userId}:`, error);
    return { success: false, message: String(error) };
  }
}

// --- APPLICATION ACTIONS ---

export async function addApplication(studentId: string, universityName: string, country: string, major: string, studentName: string, employeeId: string | null) {
  if (!checkAdminDb()) return { success: false, message: 'Server database not available.' };
  
  try {
    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) return { success: false, message: 'Student not found.' };

    const studentData = studentDoc.data() as Student;
    const newApplication = {
      university: universityName,
      country: country as any,
      major: major,
      status: 'Pending' as const,
      updatedAt: new Date().toISOString(),
    };

    const updatedApplications = [...(studentData.applications || []), newApplication];
    await studentRef.update({ applications: updatedApplications });

    if (employeeId) {
      console.log(`Action: Notify employee ${employeeId} about new application for ${studentName}`);
    }

    return { success: true, message: `Application for ${universityName} added.` };
  } catch (error) {
    console.error('addApplication error:', error);
    return { success: false, message: 'Failed to add application.' };
  }
}

export async function updateApplicationStatus(studentId: string, universityName: string, major: string, newStatus: ApplicationStatus, studentName: string, employeeId: string | null) {
  if (!checkAdminDb()) return { success: false, message: 'Server database not available.' };

  try {
    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();

    if (!studentDoc.exists) return { success: false, message: 'Student not found.' };

    const studentData = studentDoc.data() as Student;
    const appIndex = studentData.applications.findIndex(app => app.university === universityName && app.major === major);

    if (appIndex === -1) return { success: false, message: 'Application not found.' };

    const updatedApplications = [...studentData.applications];
    updatedApplications[appIndex].status = newStatus;
    updatedApplications[appIndex].updatedAt = new Date().toISOString();

    await studentRef.update({ applications: updatedApplications });

    if (employeeId) {
      const employee = await getUser(employeeId);
      if(employee?.phone) {
        await sendWhatsAppMessage(employeeId, NotificationType.GENERIC_NOTIFICATION, { "1": employee.name });
        console.log(`Sent generic notification to ${employee.name} about application status change for ${studentName}.`);
      }
    }

    return { success: true, message: 'Status updated.' };
  } catch (error) {
    console.error('updateApplicationStatus error:', error);
    return { success: false, message: 'Failed to update status.' };
  }
}

export async function updateStudentPipelineStatus(studentId: string, status: string, userName: string, studentName: string) {
    if (!checkAdminDb()) return { success: false, message: 'Server database not available.' };
    try {
        const studentRef = adminDb!.collection('students').doc(studentId);
        const studentDoc = await studentRef.get();
        if (!studentDoc.exists) return { success: false, message: "Student not found."};
        
        await studentRef.update({ pipelineStatus: status });
        
        const noteContent = `Pipeline status updated to '${status}' by ${userName}.`;
        const studentData = studentDoc.data() as Student;
        const newNote: Note = {
            id: `note-pipeline-${Date.now()}`,
            authorId: 'system',
            content: noteContent,
            createdAt: new Date().toISOString(),
        };
        await studentRef.update({ notes: [...(studentData.notes || []), newNote] });
        
        return { success: true, message: 'Status updated.' };
    } catch(error) {
        console.error('updateStudentPipelineStatus error:', error);
        return { success: false, message: 'Failed to update pipeline status.' };
    }
}

// --- TASK ACTIONS ---

export async function sendTask(authorId: string, recipientId: string, content: string) {
    if (!checkAdminDb()) return { success: false, message: 'Server database not available.' };
    
    try {
        const newTask: Omit<Task, 'id'> = {
            authorId,
            recipientId,
            content,
            createdAt: new Date().toISOString(),
            status: 'new',
            replies: []
        };
        await adminDb!.collection('tasks').add(newTask);
        
        if (recipientId !== 'all') {
            const recipient = await getUser(recipientId);
            if (recipient?.phone) {
                await sendWhatsAppMessage(recipientId, NotificationType.GENERIC_NOTIFICATION, { "1": recipient.name });
                console.log(`Sent 'new task' notification to ${recipient.name}`);
            }
        } else {
             console.log(`Task sent to all employees.`);
        }
        return { success: true, message: 'Update sent.' };

    } catch(error) {
        console.error('sendTask error:', error);
        return { success: false, message: 'Failed to send task.' };
    }
}

export async function addReplyToTask(taskId: string, authorId: string, content: string, taskAuthorId: string) {
    if (!checkAdminDb()) return { success: false, message: 'Server database not available.' };

    try {
        const taskRef = adminDb!.collection('tasks').doc(taskId);
        const taskDoc = await taskRef.get();
        if (!taskDoc.exists) return { success: false, message: 'Task not found.' };

        const taskData = taskDoc.data() as Task;
        const newReply = {
            id: `reply-${Date.now()}`,
            authorId,
            content,
            createdAt: new Date().toISOString(),
        };

        const updatedReplies = [...(taskData.replies || []), newReply];
        await taskRef.update({ replies: updatedReplies, status: 'in-progress' });

        const originalAuthor = await getUser(taskAuthorId);
        if (originalAuthor?.phone && originalAuthor.id !== authorId) {
             await sendWhatsAppMessage(taskAuthorId, NotificationType.GENERIC_NOTIFICATION, { "1": originalAuthor.name });
            console.log(`Sent 'task reply' notification to ${originalAuthor.name}`);
        }
        
        return { success: true, message: 'Reply sent.' };
    } catch (error) {
        console.error('addReplyToTask error:', error);
        return { success: false, message: 'Failed to add reply.' };
    }
}

export async function updateTaskStatus(taskId: string, status: TaskStatus, task: Task) {
    if (!checkAdminDb()) return { success: false, message: 'Server database not available.' };
    try {
        await adminDb!.collection('tasks').doc(taskId).update({ status });
        return { success: true, message: 'Status updated.' };
    } catch(error) {
        console.error('updateTaskStatus error:', error);
        return { success: false, message: 'Failed to update task status.' };
    }
}


// --- STUDENT & USER MANAGEMENT ACTIONS ---

export async function transferStudent(studentId: string, newEmployee: User, adminId: string, studentName: string, fromEmployeeName: string | null) {
    if (!checkAdminDb()) return { success: false, message: 'Server database not available.' };
    if (!newEmployee.civilId) {
        return { success: false, message: 'Employee missing Civil ID.' };
    }

    try {
        const studentRef = adminDb!.collection('students').doc(studentId);
        const studentDoc = await studentRef.get();
        if (!studentDoc.exists) return { success: false, message: 'Student not found.' };

        const studentData = studentDoc.data() as Student;
        const oldEmployeeId = studentData.employeeId;

        const transferRecord = {
            fromEmployeeId: oldEmployeeId,
            toEmployeeId: newEmployee.civilId,
            date: new Date().toISOString(),
            transferredBy: adminId,
        };
        
        const noteContent = `Student transferred from ${fromEmployeeName || 'Unassigned'} to ${newEmployee.name}.`;
        const newNote: Note = {
            id: `note-transfer-${Date.now()}`,
            authorId: adminId,
            content: noteContent,
            createdAt: new Date().toISOString(),
        };

        const updates = {
            employeeId: newEmployee.civilId,
            transferRequested: false, 
            isNewForEmployee: true,
            transferHistory: [...(studentData.transferHistory || []), transferRecord],
            notes: [...(studentData.notes || []), newNote]
        };

        await studentRef.update(updates);

        if (newEmployee.id && newEmployee.phone) {
             await sendWhatsAppMessage(newEmployee.id, NotificationType.GENERIC_NOTIFICATION, { "1": newEmployee.name });
            console.log(`Sent 'student transfer' notification to ${newEmployee.name}`);
        }

        return { success: true, message: `Student ${studentName} transferred to ${newEmployee.name}.` };
    } catch (error) {
        console.error('transferStudent error:', error);
        return { success: false, message: 'Failed to transfer student.' };
    }
}

export async function bulkTransferStudents(fromEmployeeId: string, toEmployeeId: string, adminId: string) {
    if (!checkAdminDb()) {
        return { success: false, message: 'Server database not available.' };
    }
    try {
        const fromEmployee = await getUser(fromEmployeeId);
        const toEmployee = await getUser(toEmployeeId);
        
        if (!fromEmployee || !toEmployee) {
            return { success: false, message: 'One or both employees not found.' };
        }
        
        const fromEmployeeCivilId = fromEmployee.civilId;
        const toEmployeeCivilId = toEmployee.civilId;
        
        if (!fromEmployeeCivilId || !toEmployeeCivilId) {
            return { success: false, message: 'One or both employees are missing a Civil ID.' };
        }

        const snapshot = await adminDb!.collection('students').where('employeeId', '==', fromEmployeeCivilId).get();
        
        if (snapshot.empty) {
            return { success: true, message: 'No students to transfer.' };
        }

        const batch = adminDb!.batch();
        snapshot.docs.forEach(doc => {
            batch.update(doc.ref, { 
                employeeId: toEmployeeCivilId, 
                isNewForEmployee: true,
                transferHistory: [
                    ...(doc.data().transferHistory || []), 
                    {
                        fromEmployeeId: fromEmployeeCivilId,
                        toEmployeeId: toEmployeeCivilId,
                        date: new Date().toISOString(),
                        transferredBy: adminId,
                    }
                ]
            });
        });

        await batch.commit();
        
        return { success: true, message: `${snapshot.size} students were transferred successfully.` };
    } catch (error: any) {
        console.error('bulkTransferStudents error:', error);
        return { success: false, message: error.message };
    }
}

// --- TODO ACTIONS ---

export async function addTodo(userId: string, content: string) {
  if (!checkAdminDb()) return { success: false, message: 'DB not available' };
  
  try {
    const todoCollRef = adminDb!.collection('users').doc(userId).collection('personal_todos');
    await todoCollRef.add({
        userId,
        content,
        completed: false,
        createdAt: new Date().toISOString()
    });
    return { success: true, message: "To-do added." };
  } catch (error) {
    console.error('addTodo error:', error);
    return { success: false, message: 'Failed to add to-do.' };
  }
}

export async function toggleTodo(userId: string, todoId: string, completed: boolean) {
    if (!checkAdminDb()) return { success: false, message: 'DB not available' };
    try {
        const todoRef = adminDb!.collection('users').doc(userId).collection('personal_todos').doc(todoId);
        await todoRef.update({ completed: !completed });
        return { success: true, message: 'To-do updated.' };
    } catch (error) {
        console.error('toggleTodo error:', error);
        return { success: false, message: 'Failed to update to-do.' };
    }
}

export async function deleteTodo(userId: string, todoId: string) {
    if (!checkAdminDb()) return { success: false, message: 'DB not available' };
    try {
        const todoRef = adminDb!.collection('users').doc(userId).collection('personal_todos').doc(todoId);
        await todoRef.delete();
        return { success: true, message: 'To-do deleted.' };
    } catch (error) {
        console.error('deleteTodo error:', error);
        return { success: false, message: 'Failed to delete to-do.' };
    }
}

// --- MISC ACTIONS ---

export async function importStudentsFromExcel(userId: string, fileName: string) {
    if (!checkAdminDb()) return { success: false, message: 'Server database not available.' };
    console.log(`User ${userId} initiated import from ${fileName}`);
    // This is a placeholder. Real implementation would parse the excel file and create student docs.
    // For now, it just creates a task for an admin to handle it manually.
    await sendTask(userId, 'all', `User ${userId} bulk-imported students from file '${fileName}'. Please review and assign.`);
    return { success: true, message: `Students from '${fileName}' are being imported. A task has been created for admins to review.` };
}

export async function sendTestNotification(phoneNumber: string, userName: string) {
    if (!phoneNumber) return { success: false, message: 'Phone number is required.' };
    
    const result = await sendTypedWhatsAppMessage(NotificationType.GENERIC_NOTIFICATION, phoneNumber, { "1": userName });
    
    console.log(`Sending test WhatsApp to ${phoneNumber} from ${userName}. Result:`, result);
    
    return result;
}

export async function onDocumentUploaded(documentId: string, studentId: string, documentName: string, uploaderId: string) {
  if (!checkAdminDb()) return { success: false, message: 'Server database not available.' };
  
  try {
    const studentDoc = await adminDb!.collection('students').doc(studentId).get();
    if (!studentDoc.exists) return { success: false, message: 'Student not found' };

    const student = studentDoc.data() as Student;
    const uploader = await getUser(uploaderId);
    
    const isEmployeeUploader = uploader?.role === 'employee';
    let recipientId: string | null = null;
    let notificationType: NotificationType;
    let notificationData: Record<string, string> = {};

    if (isEmployeeUploader) {
        const admins = (await adminDb!.collection('users').where('role', '==', 'admin').get()).docs;
        if (admins.length > 0) {
            recipientId = admins[0].id;
            notificationType = NotificationType.DOCUMENT_UPLOAD_TO_ADMIN;
            notificationData = { "1": admins[0].data().name, "2": uploader?.name || 'Unknown', "3": documentName, "4": student.name };
        }
    } else {
        if (student.employeeId) {
            const employeeQuery = await adminDb!.collection('users').where('civilId', '==', student.employeeId).limit(1).get();
            if (!employeeQuery.empty) {
                const employeeDoc = employeeQuery.docs[0];
                const employee = { id: employeeDoc.id, ...employeeDoc.data() } as User;
                recipientId = employee.id;
                notificationType = NotificationType.DOCUMENT_UPLOAD_TO_EMPLOYEE;
                notificationData = { "1": employee.name, "2": documentName, "3": student.name };
            }
        }
    }

    if (recipientId && notificationType!) {
      await sendWhatsAppMessage(recipientId, notificationType, notificationData);
    }

    return { success: true, message: 'Document upload notification processed.' };
  } catch (error) {
    console.error('Error in onDocumentUploaded:', error);
    return { success: false, message: String(error) };
  }
}
