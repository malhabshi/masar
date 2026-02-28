'use server';

import { adminDb, adminAuth, storage } from '@/lib/firebase/admin';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import type { User, Student, Application, ApplicationStatus, Task, Note, TaskStatus, Country, UserRole, ProfileCompletionStatus, TimeLog, ReportStats, UpcomingEvent, EmployeeStats, Document as StudentDoc, StudentLogin, RequestType, NotificationTemplate, NotificationType } from './types';
import {
  isWithinInterval,
  parseISO,
  format,
  differenceInMinutes,
  subMinutes,
  subDays,
  startOfDay,
} from 'date-fns';

const WANOTIFIER_API_KEY = '21ZrvNBzImlKBPxlXGce7rVy8GdzuT';

// Helper to check if adminDb is available
function checkAdminServices() {
  if (!adminDb || !adminAuth || !storage) {
    console.error('CRITICAL: Firebase Admin not initialized.');
    return false;
  }
  return true;
}

// Helper to get user from DB
async function getUser(userId: string): Promise<User | null> {
    if (!checkAdminServices()) return null;
    const doc = await adminDb!.collection('users').doc(userId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() } as User;
}

async function refreshStudentActivity(studentId: string) {
  if (!checkAdminServices()) return;
  try {
    await adminDb!.collection('students').doc(studentId).update({
      lastActivityAt: new Date().toISOString()
    });
  } catch (e) {
    console.error('Failed to refresh activity timestamp:', e);
  }
}

/**
 * REPAIR UTILITY: Rebuilds the DBAC collections (/admins and /departmentUsers)
 * based on the current state of the main /users collection.
 */
export async function repairPermissions(adminId: string) {
    if (!checkAdminServices()) return { success: false, message: 'DB not available' };
    
    try {
        const admin = await getUser(adminId);
        // During emergency, we allow specific reporting users to trigger this even if role is out of sync
        const authorizedBypass = [
          'bbkDS193aqcaAJS6M6GkjWFgFTr1', 
          'cYfvOMr5CCY5MACCgYm1DdjaZug1', 
          'IZr1zv5ePQb0bKNVXS4xGjERmE62', 
          'lZr1zv5ePQbObKNVXS4xGjERmE62'
        ];
        
        if (!admin && !authorizedBypass.includes(adminId)) {
            return { success: false, message: 'Unauthorized.' };
        }

        const usersSnap = await adminDb!.collection('users').get();
        const batch = adminDb!.batch();

        // 1. Clear existing DBAC collections
        const adminsSnap = await adminDb!.collection('admins').get();
        const deptsSnap = await adminDb!.collection('departmentUsers').get();
        
        adminsSnap.docs.forEach(doc => batch.delete(doc.ref));
        deptsSnap.docs.forEach(doc => batch.delete(doc.ref));

        // 2. Repopulate based on roles found in user documents
        usersSnap.docs.forEach(userDoc => {
            const userData = userDoc.data();
            const uid = userDoc.id;
            const syncTime = new Date().toISOString();

            if (userData.role === 'admin') {
                batch.set(adminDb!.collection('admins').doc(uid), { role: 'admin', lastSync: syncTime });
            } else if (userData.role === 'department') {
                batch.set(adminDb!.collection('departmentUsers').doc(uid), { role: 'department', lastSync: syncTime });
            }
        });

        await batch.commit();
        return { success: true, message: `Successfully repaired permissions for ${usersSnap.size} users. Data access should now be stable.` };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

// --- WHATSAPP NOTIFICATION ENGINE ---

async function sendWhatsAppViaWebhook(webhookUrl: string, phone: string, variables: Record<string, string>, mapping?: Record<string, string>) {
  if (!webhookUrl || !phone) return { success: false, message: 'Missing webhook URL or phone' };
  
  // Basic normalization for Kuwait numbers (remove + or prefix)
  const normalizedPhone = phone.replace(/\D/g, '');
  const fullPhone = normalizedPhone.startsWith('965') ? normalizedPhone : `965${normalizedPhone}`;

  // If a numbered mapping is provided, transform the descriptive variables into the numbered ones WANotifier expects
  let payloadVariables = variables;
  if (mapping && Object.keys(mapping).length > 0) {
    const transformed: Record<string, string> = {};
    Object.entries(mapping).forEach(([placeholderNum, systemVarName]) => {
      transformed[placeholderNum] = variables[systemVarName] || '';
    });
    payloadVariables = transformed;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: fullPhone,
        ...payloadVariables,
      }),
    });

    if (!response.ok) {
      const errData = await response.json();
      console.error('WANotifier Webhook Error:', errData);
      return { success: false, message: errData.message || 'Failed to trigger WANotifier webhook' };
    }

    return { success: true };
  } catch (e: any) {
    console.error('WhatsApp Webhook fetch error:', e);
    return { success: false, message: e.message };
  }
}

export async function triggerWhatsAppNotification(
  type: NotificationType, 
  variables: Record<string, string>, 
  recipientPhone?: string
) {
  if (!checkAdminServices() || !recipientPhone) return;

  try {
    const templateQuery = await adminDb!
      .collection('notification_templates')
      .where('notificationType', '==', type)
      .where('isActive', '==', true)
      .limit(1)
      .get();

    if (templateQuery.empty) {
      console.log(`No active WhatsApp template found for notification type: ${type}`);
      return;
    }

    const template = templateQuery.docs[0].data() as NotificationTemplate;
    
    if (template.webhookUrl) {
      console.log(`Triggering WhatsApp Webhook for ${type} to ${recipientPhone}`);
      await sendWhatsAppViaWebhook(template.webhookUrl, recipientPhone, variables, template.variableMapping);
    }
  } catch (e) {
    console.error('WhatsApp trigger failed:', e);
  }
}

export async function sendTestWhatsApp(templateId: string, phone: string, variables: Record<string, string>) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const templateDoc = await adminDb!.collection('notification_templates').doc(templateId).get();
    if (!templateDoc.exists) return { success: false, message: 'Template not found' };
    
    const template = templateDoc.data() as NotificationTemplate;
    
    if (!template.webhookUrl) {
      return { success: false, message: 'No Webhook URL configured for this template.' };
    }

    return await sendWhatsAppViaWebhook(template.webhookUrl, phone, variables, template.variableMapping);
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Sends a sample POST request to a webhook URL to help external tools "learn" the data structure.
 */
export async function sendSampleWebhookRequest(webhookUrl: string, mapping: Record<string, string>) {
  if (!webhookUrl) return { success: false, message: 'No URL provided' };

  const dummyVars: Record<string, string> = {
    employeeName: 'Sample Employee',
    taskTitle: 'Sample Task',
    taskDescription: 'This is a test description for the task.',
    studentName: 'Sample Student',
    studentEmail: 'sample@example.com',
    studentPhone: '55123456',
    dueDate: '2025-12-31',
    assignedBy: 'System Admin',
    userName: 'Sample User',
    taskUrl: 'https://uniapplyhub.com/tasks',
    createdAt: new Date().toISOString(),
    adminName: 'Super Admin',
    messageContent: 'This is a sample update content.',
    replyAuthor: 'System Assistant',
    replyMessage: 'The request has been processed.',
    documentName: 'Sample_Document.pdf',
    uploadedBy: 'Admin Team',
    courseOption: 'Standard Course',
    courseStartDate: 'Sunday, Jan 1',
    dashboardUrl: 'https://uniapplyhub.com/dashboard',
    pendingTasksCount: '5',
    oldestTaskDate: '2025-01-01',
    submissionDate: '2025-01-01',
    studentUrl: 'https://uniapplyhub.com/student/sample'
  };

  return await sendWhatsAppViaWebhook(webhookUrl, '00000000', dummyVars, mapping);
}

export async function saveNotificationTemplate(data: Omit<NotificationTemplate, 'id' | 'createdAt' | 'updatedAt'>, id?: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const now = new Date().toISOString();
    if (id) {
      await adminDb!.collection('notification_templates').doc(id).update({ ...data, updatedAt: now });
    } else {
      await adminDb!.collection('notification_templates').add({ ...data, createdAt: now, updatedAt: now });
    }
    return { success: true, message: 'Template saved.' };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// --- REQUEST SETTINGS ACTIONS ---

export async function createRequestType(data: Omit<RequestType, 'id'>) {
  if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
  try {
    const docRef = await adminDb!.collection('request_types').add({
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return { success: true, id: docRef.id, message: 'Request type created.' };
  } catch (error: any) {
    return { success: false, message: error.message || 'Failed to create request type.' };
  }
}

export async function updateRequestType(id: string, data: Partial<RequestType>) {
  if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
  try {
    await adminDb!.collection('request_types').doc(id).update({
      ...data,
      updatedAt: new Date().toISOString(),
    });
    return { success: true, message: 'Request type updated.' };
  } catch (error: any) {
    return { success: false, message: error.message || 'Failed to update request type.' };
  }
}

export async function deleteRequestType(id: string) {
  if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
  try {
    await adminDb!.collection('request_types').doc(id).delete();
    return { success: true, message: 'Request type deleted.' };
  } catch (error: any) {
    return { success: false, message: error.message || 'Failed to delete request type.' };
  }
}

// --- USER ACTIONS ---

export async function deleteUser(userIdToDelete: string, adminId: string) {
  if (!checkAdminServices()) return { success: false, message: 'Admin services not available.' };
  try {
    const admin = await getUser(adminId);
    if (!admin || admin.role !== 'admin') {
      return { success: false, message: 'Unauthorized.' };
    }
    if (userIdToDelete === adminId) return { success: false, message: 'Cannot delete self.' };

    await adminAuth!.deleteUser(userIdToDelete);
    const batch = adminDb!.batch();
    batch.delete(adminDb!.collection('users').doc(userIdToDelete));
    batch.delete(adminDb!.collection('admins').doc(userIdToDelete));
    batch.delete(adminDb!.collection('departmentUsers').doc(userIdToDelete));
    await batch.commit();

    return { success: true, message: 'User deleted successfully.' };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function changeUserRole(userId: string, newRole: UserRole, adminId: string) {
    if (!checkAdminServices()) return { success: false, message: 'Admin services not available.' };
    try {
        const admin = await getUser(adminId);
        if (!admin || admin.role !== 'admin') return { success: false, message: 'Unauthorized.' };

        const batch = adminDb!.batch();
        const userRef = adminDb!.collection('users').doc(userId);
        batch.update(userRef, { role: newRole });

        const adminDBACRef = adminDb!.collection('admins').doc(userId);
        const deptDBACRef = adminDb!.collection('departmentUsers').doc(userId);

        batch.delete(adminDBACRef);
        batch.delete(deptDBACRef);

        if (newRole === 'admin') {
            batch.set(adminDBACRef, { role: 'admin', syncAt: new Date().toISOString() });
        } else if (newRole === 'department') {
            batch.set(deptDBACRef, { role: 'department', syncAt: new Date().toISOString() });
        }

        await batch.commit();
        return { success: true, message: `User role updated to ${newRole}.` };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}

// --- APPLICATION ACTIONS ---

export async function addApplication(studentId: string, universityName: string, country: string, major: string, studentName: string, employeeId: string | null) {
  if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
  try {
    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) return { success: false, message: 'Student not found.' };

    const studentData = studentDoc.data() as Student;
    const newApplication: Application = {
      university: universityName,
      country: country as any,
      major: major,
      status: 'Pending' as const,
      updatedAt: new Date().toISOString(),
    };

    const updatedApplications = [...(studentData.applications || []), newApplication];
    await studentRef.update({ 
      applications: updatedApplications,
      lastActivityAt: new Date().toISOString() 
    });

    if (employeeId) {
      const employeeQuery = await adminDb!.collection('users').where('civilId', '==', employeeId).limit(1).get();
      if (!employeeQuery.empty) {
          const employeeDoc = employeeQuery.docs[0];
          const employeeData = employeeDoc.data() as User;
          const taskContent = `A new application for '${universityName}' has been added for your student, ${studentName}.`;
          await adminDb!.collection('tasks').add({
              authorId: 'system',
              recipientId: employeeDoc.id,
              recipientIds: [employeeDoc.id],
              content: taskContent,
              createdAt: new Date().toISOString(),
              status: 'new',
              category: 'system',
              replies: []
          });

          // WhatsApp alert
          await triggerWhatsAppNotification('admin_update', {
            employeeName: employeeData.name,
            messageContent: taskContent,
            dashboardUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/student/${studentId}`
          }, employeeData.phone);
      }
    }
    return { success: true, message: `Application for ${universityName} added.` };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function updateApplicationStatus(studentId: string, universityName: string, major: string, newStatus: ApplicationStatus, studentName: string, employeeId: string | null) {
  if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
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

    await studentRef.update({ 
      applications: updatedApplications,
      lastActivityAt: new Date().toISOString()
    });

    if (employeeId) {
        const employeeQuery = await adminDb!.collection('users').where('civilId', '==', employeeId).limit(1).get();
        if (!employeeQuery.empty) {
            const employeeDoc = employeeQuery.docs[0];
            const employeeData = employeeDoc.data() as User;
            const message = `Status update for ${studentName}: ${universityName} is now ${newStatus}.`;
            await adminDb!.collection('tasks').add({
                authorId: 'system',
                recipientId: employeeDoc.id,
                recipientIds: [employeeDoc.id],
                content: message,
                createdAt: new Date().toISOString(),
                status: 'new',
                category: 'system',
                replies: []
            });

            // WhatsApp alert
            let notifType: NotificationType = 'admin_update';
            if (newStatus === 'Accepted') notifType = 'scholarship_approved'; // Using as generic success alert
            
            await triggerWhatsAppNotification(notifType, {
              employeeName: employeeData.name,
              studentName: studentName,
              messageContent: message,
              dashboardUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/student/${studentId}`
            }, employeeData.phone);
        }
    }
    return { success: true, message: 'Status updated.' };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function updateStudentPipelineStatus(studentId: string, status: string, userName: string, studentName: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
    try {
        const studentRef = adminDb!.collection('students').doc(studentId);
        const studentDoc = await studentRef.get();
        if (!studentDoc.exists) return { success: false, message: "Student not found."};
        
        await studentRef.update({ 
          pipelineStatus: status,
          lastActivityAt: new Date().toISOString()
        });
        const studentData = studentDoc.data() as Student;
        const newNote: Note = {
            id: `note-pipeline-${Date.now()}`,
            authorId: 'system',
            content: `Pipeline status updated to '${status}' by ${userName}.`,
            createdAt: new Date().toISOString(),
        };
        await studentRef.update({ adminNotes: [...(studentData.adminNotes || []), newNote] });
        return { success: true, message: 'Status updated.' };
    } catch(error: any) {
        return { success: false, message: error.message };
    }
}

// --- TASK ACTIONS ---

export async function createStudentTask(authorId: string, studentId: string, requestTypeId: string, description: string, dynamicData?: any) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
    try {
        const requestTypeDoc = await adminDb!.collection('request_types').doc(requestTypeId).get();
        if (!requestTypeDoc.exists) return { success: false, message: 'Request type not found.' };
        const requestTypeData = requestTypeDoc.data() as RequestType;

        const studentDoc = await adminDb!.collection('students').doc(studentId).get();
        if (!studentDoc.exists) return { success: false, message: 'Student not found.' };
        const studentData = studentDoc.data() as Student;

        const recipientIds: string[] = [];
        if (requestTypeData.recipients) {
          requestTypeData.recipients.forEach(r => {
            if (r.type === 'user') recipientIds.push(r.id);
            else if (r.type === 'group') recipientIds.push(r.id);
            else if (r.type === 'department') recipientIds.push(`dept:${r.id}`);
          });
        }

        const creator = await getUser(authorId);
        const taskRef = await adminDb!.collection('tasks').add({
            authorId,
            createdBy: authorId, 
            authorName: creator?.name || 'Unknown Employee',
            recipientId: recipientIds[0] || 'all', 
            recipientIds: recipientIds.length > 0 ? recipientIds : ['all'],
            content: description,
            createdAt: new Date().toISOString(),
            status: 'new',
            category: 'request',
            replies: [],
            studentId: studentId,
            studentName: studentData.name,
            studentPhone: studentData.phone,
            taskType: requestTypeData.name,
            data: {
              ...(dynamicData || {}),
              studentName: studentData.name,
              studentEmail: studentData.email,
              studentPhone: studentData.phone,
              requestedBy: creator?.email,
              requestedByName: creator?.name
            }
        });

        // Also refresh student activity
        await refreshStudentActivity(studentId);

        // WhatsApp for recipients
        for (const rid of recipientIds) {
          if (!rid.startsWith('dept:') && rid !== 'all' && rid !== 'admins') {
            const recipient = await getUser(rid);
            if (recipient?.phone) {
              await triggerWhatsAppNotification('new_task_assigned', {
                employeeName: recipient.name,
                taskTitle: requestTypeData.name,
                taskDescription: description,
                studentName: studentData.name,
                assignedBy: creator?.name || 'UniApply System',
                taskUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/tasks`
              }, recipient.phone);
            }
          }
        }

        return { success: true, message: 'Task created successfully.' };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}

export async function markTaskAsSeen(taskId: string, userId: string, userName: string) {
  if (!checkAdminServices()) return { success: false };
  try {
    const taskRef = adminDb!.collection('tasks').doc(taskId);
    await taskRef.update({
      viewedBy: FieldValue.arrayUnion({ 
        userId, 
        userName, 
        timestamp: new Date().toISOString() 
      })
    });
    return { success: true };
  } catch (e) {
    return { success: false };
  }
}

export async function markMultipleTasksAsSeen(taskIds: string[], userId: string, userName: string) {
  if (!checkAdminServices() || taskIds.length === 0) return { success: false };
  try {
    const batch = adminDb!.batch();
    const timestamp = new Date().toISOString();
    
    for (const id of taskIds) {
      batch.update(adminDb!.collection('tasks').doc(id), {
        viewedBy: FieldValue.arrayUnion({ userId, userName, timestamp })
      });
    }
    
    await batch.commit();
    return { success: true };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function sendTaskNotification(taskId: string, fromId: string, fromName: string, message: string) {
  if (!checkAdminServices()) return { success: false };
  try {
    const taskRef = adminDb!.collection('tasks').doc(taskId);
    const taskDoc = await taskRef.get();
    if (!taskDoc.exists) return { success: false, message: 'Task not found' };
    const task = taskDoc.data() as Task;

    const notification = { fromId, fromName, message, timestamp: new Date().toISOString() };
    await taskRef.update({
      notifications: FieldValue.arrayUnion(notification)
    });

    await adminDb!.collection('tasks').add({
      authorId: fromId,
      createdBy: fromId,
      recipientId: task.authorId,
      recipientIds: [task.authorId],
      content: `New update from ${fromName} on task "${task.taskType}": ${message}`,
      status: 'new',
      category: 'system',
      createdAt: new Date().toISOString(),
      replies: []
    });

    // WhatsApp alert to task author
    const recipient = await getUser(task.authorId);
    if (recipient?.phone) {
      await triggerWhatsAppNotification('admin_update', {
        employeeName: recipient.name,
        messageContent: `Update on task "${task.taskType}": ${message}`,
        dashboardUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/tasks`
      }, recipient.phone);
    }

    return { success: true };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function sendTask(authorId: string, recipientId: string, content: string, category: 'update' | 'system' = 'update') {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
    try {
        const author = await getUser(authorId);
        if (!author || !['admin', 'department'].includes(author.role)) {
            return { success: false, message: 'Unauthorized.' };
        }
        await adminDb!.collection('tasks').add({
            authorId,
            createdBy: authorId,
            recipientId,
            recipientIds: [recipientId],
            content,
            createdAt: new Date().toISOString(),
            status: 'new',
            category,
            replies: []
        });
        return { success: true, message: 'Update sent.' };
    } catch(error: any) {
        return { success: false, message: error.message };
    }
}

export async function addReplyToTask(taskId: string, authorId: string, content: string, taskAuthorId: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
    try {
        const author = await getUser(authorId);
        if (!author || !['admin', 'department'].includes(author.role)) return { success: false, message: 'Unauthorized.' };

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

        await taskRef.update({ replies: FieldValue.arrayUnion(newReply), status: 'in-progress' });

        if (taskData.authorId !== authorId) {
            await adminDb!.collection('tasks').add({
              authorId: 'system',
              createdBy: 'system',
              recipientId: taskData.authorId,
              recipientIds: [taskData.authorId],
              content: `${author.name} replied to your task: "${taskData.taskType || taskData.content.substring(0, 30)}..."`,
              createdAt: new Date().toISOString(),
              status: 'new',
              category: 'system',
              replies: [],
            });

            // WhatsApp alert to author
            const recipient = await getUser(taskData.authorId);
            if (recipient?.phone) {
              await triggerWhatsAppNotification('task_reply_received', {
                employeeName: recipient.name,
                taskTitle: taskData.taskType || 'Task',
                replyAuthor: author.name,
                replyMessage: content,
                taskUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/tasks`
              }, recipient.phone);
            }
        }
        return { success: true, message: 'Reply sent.' };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}

export async function updateTaskStatus(taskId: string, status: TaskStatus, updaterId: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
    try {
        const updater = await getUser(updaterId);
        if (!updater || !['admin', 'department'].includes(updater.role)) return { success: false, message: 'Unauthorized.' };

        const taskRef = adminDb!.collection('tasks').doc(taskId);
        await taskRef.update({ status });

        const taskDoc = await taskRef.get();
        const taskData = taskDoc.data() as Task;

        if (taskData.authorId !== updaterId) {
            const message = `Task "${taskData.taskType}" status updated to '${status}' by ${updater.name}.`;
            await adminDb!.collection('tasks').add({
                authorId: 'system',
                createdBy: 'system',
                recipientId: taskData.authorId,
                recipientIds: [taskData.authorId],
                content: message,
                createdAt: new Date().toISOString(),
                status: 'new',
                category: 'system',
                replies: []
            });

            // WhatsApp alert
            const recipient = await getUser(taskData.authorId);
            if (recipient?.phone) {
              let type: NotificationType = 'task_status_in_progress';
              if (status === 'completed') type = 'task_status_completed';
              if (status === 'denied') type = 'task_status_denied';

              await triggerWhatsAppNotification(type, {
                employeeName: recipient.name,
                taskTitle: taskData.taskType || 'Task',
                studentName: taskData.studentName || 'Student',
                taskUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/tasks`
              }, recipient.phone);
            }
        }
        return { success: true, message: 'Status updated.' };
    } catch(error: any) {
        return { success: false, message: error.message };
    }
}

export async function toggleTaskPriority(taskId: string, isPrioritized: boolean) {
    if (!checkAdminServices()) return { success: false };
    try {
        await adminDb!.collection('tasks').doc(taskId).update({ isPrioritized });
        return { success: true };
    } catch (e) {
        return { success: false };
    }
}


// --- STUDENT & USER MANAGEMENT ACTIONS ---

export async function createNewUser(userData: {
  name: string;
  email: string;
  password: string;
  civilId: string;
  phone: string;
  role: 'admin' | 'employee' | 'department';
  department?: string;
}) {
  if (!checkAdminServices()) return { success: false, message: 'Admin services not available.' };
  try {
    const authUser = await adminAuth!.createUser({
      email: userData.email,
      password: userData.password,
      displayName: userData.name,
      phoneNumber: userData.phone,
    });

    const employeeId = userData.civilId.slice(-5);
    const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(userData.name)}&background=random&color=fff`;

    const newUserForDb: Omit<User, 'id'> = {
      name: userData.name,
      email: userData.email,
      phone: userData.phone,
      role: userData.role,
      avatarUrl,
      civilId: userData.civilId,
      employeeId: employeeId,
      ...(userData.department && { department: userData.department }),
    };

    const batch = adminDb!.batch();
    batch.set(adminDb!.collection('users').doc(authUser.uid), newUserForDb);

    if (userData.role === 'admin') {
      batch.set(adminDb!.collection('admins').doc(authUser.uid), { role: 'admin', syncAt: new Date().toISOString() });
    } else if (userData.role === 'department') {
      batch.set(adminDb!.collection('departmentUsers').doc(authUser.uid), { role: 'department', syncAt: new Date().toISOString() });
    }

    await batch.commit();
    return { success: true, message: `${userData.name} added.` };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function createStudent(
  values: {
    studentName: string;
    studentEmail?: string;
    phone: string;
    internalNumber?: string;
    targetCountries: string[];
    otherCountry?: string;
    notes?: string;
  },
  creatingUserId: string,
  creatingUserRole: UserRole,
  creatingUserCivilId?: string | null,
  assignedEmployeeId?: string | null
) {
  if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
  
  const { studentName, studentEmail, phone, internalNumber, targetCountries, otherCountry, notes } = values;
  let finalTargetCountries = targetCountries;
  if (otherCountry && otherCountry.trim()) finalTargetCountries = [...finalTargetCountries, otherCountry.trim()];

  try {
    const existingSnap = await adminDb!.collection('students').where('phone', '==', phone).get();
    let duplicateInfo = {};
    if (!existingSnap.empty) {
      duplicateInfo = { duplicatePhoneWarning: true, duplicateOfStudentIds: existingSnap.docs.map(doc => doc.id) };
    }

    // Restore robust ID generation
    const fallbackId = Math.random().toString(36).substring(2, 9);
    const idPrefix = creatingUserCivilId ? `U-${creatingUserCivilId}` : `S-${fallbackId}`;
    const studentId = `${idPrefix}-${Date.now()}`;
    const studentRef = adminDb!.collection('students').doc(studentId);

    const now = new Date().toISOString();

    await studentRef.set({
      id: studentId,
      name: studentName,
      email: studentEmail || '',
      phone: phone,
      internalNumber: internalNumber || '',
      employeeId: assignedEmployeeId || null, 
      applications: [],
      employeeNotes: [],
      adminNotes: notes ? [{ id: `note-${Date.now()}`, authorId: creatingUserId, content: notes, createdAt: now }] : [],
      documents: [],
      createdAt: now,
      lastActivityAt: now,
      createdBy: creatingUserId,
      targetCountries: finalTargetCountries as Country[],
      missingItems: [],
      pipelineStatus: 'none',
      isNewForEmployee: !!assignedEmployeeId,
      profileCompletionStatus: {
        submitUniversityApplication: false, applyMoheScholarship: false, submitKcoRequest: false, 
        receivedCasOrI20: false, appliedForVisa: false, documentsSubmittedToMohe: false,
        readyToTravel: false, financialStatementsProvided: false, visaGranted: false, medicalFitnessSubmitted: false,
      },
      ...duplicateInfo,
    });

    if (!assignedEmployeeId) {
        const adminsSnapshot = await adminDb!.collection('users').where('role', '==', 'admin').get();
        if (!adminsSnapshot.empty) {
          const batch = adminDb!.batch();
          for (const adminDoc of adminsSnapshot.docs) {
            const taskRef = adminDb!.collection('tasks').doc();
            batch.set(taskRef, {
              authorId: creatingUserId,
              createdBy: creatingUserId,
              recipientId: adminDoc.id,
              recipientIds: [adminDoc.id],
              content: `New student '${studentName}' added.`,
              status: 'new', category: 'system', studentId: studentRef.id, studentName: studentName,
              createdAt: new Date().toISOString(), replies: [],
            });

            // WhatsApp alert to admins
            const adminData = adminDoc.data() as User;
            await triggerWhatsAppNotification('new_student_added', {
              adminName: adminData.name,
              studentName: studentName,
              studentEmail: studentEmail || 'N/A',
              studentPhone: phone,
              submissionDate: new Date().toLocaleDateString(),
              studentUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/unassigned-students`
            }, adminData.phone);
          }
          await batch.commit();
        }
    }
    return { success: true, studentId: studentRef.id, studentName };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function resolveDuplicate(studentId: string, adminId: string) {
  if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
  try {
    const admin = await getUser(adminId);
    if (!admin || admin.role !== 'admin') return { success: false, message: 'Unauthorized.' };
    await adminDb!.collection('students').doc(studentId).update({ duplicatePhoneWarning: false, duplicateOfStudentIds: null });
    return { success: true, message: 'Duplicate warning resolved.' };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function transferStudent(studentId: string, newEmployee: User, adminId: string, studentName: string, fromEmployeeName: string | null) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
    if (!newEmployee.civilId) return { success: false, message: 'Employee missing Civil ID.' };

    try {
        const studentRef = adminDb!.collection('students').doc(studentId);
        const studentDoc = await studentRef.get();
        if (!studentDoc.exists) return { success: false, message: 'Student not found.' };

        const studentData = studentDoc.data() as Student;
        const updates = {
            employeeId: newEmployee.civilId,
            transferRequested: false, isNewForEmployee: true,
            lastActivityAt: new Date().toISOString(),
            transferHistory: [...(studentData.transferHistory || []), { fromEmployeeId: studentData.employeeId, toEmployeeId: newEmployee.civilId, date: new Date().toISOString(), transferredBy: adminId }],
            adminNotes: [...(studentData.adminNotes || []), { id: `note-transfer-${Date.now()}`, authorId: adminId, content: `Transferred from ${fromEmployeeName || 'Unassigned'} to ${newEmployee.name}.`, createdAt: new Date().toISOString() }]
        };

        await studentRef.update(updates);
        if (newEmployee.id) {
            const admin = await getUser(adminId);
            await adminDb!.collection('tasks').add({
                authorId: adminId, 
                createdBy: adminId,
                recipientId: newEmployee.id, 
                recipientIds: [newEmployee.id],
                content: `The student '${studentName}' has been transferred to you.`,
                createdAt: new Date().toISOString(), status: 'new', category: 'system', replies: []
            });

            // WhatsApp alert to new employee
            await triggerWhatsAppNotification('student_assigned', {
              employeeName: newEmployee.name,
              studentName: studentName,
              assignedBy: admin?.name || 'Administrator',
              studentUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/student/${studentId}`
            }, newEmployee.phone);
        }
        return { success: true, message: `Student transferred.` };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}

export async function requestTransfer(studentId: string, reason: string, requestingEmployeeId: string, studentName: string) {
  if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
  try {
    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) return { success: false, message: 'Student not found.' };

    const employee = await getUser(requestingEmployeeId);
    if (!employee) return { success: false, message: 'Employee not found.' };

    await studentRef.update({ 
      transferRequested: true,
      lastActivityAt: new Date().toISOString()
    });
    const studentData = studentDoc.data() as Student;
    await studentRef.update({ adminNotes: [...(studentData.adminNotes || []), { id: `note-transfer-req-${Date.now()}`, authorId: requestingEmployeeId, content: `Transfer requested: ${reason}`, createdAt: new Date().toISOString() }] });

    const adminsSnapshot = await adminDb!.collection('users').where('role', '==', 'admin').get();
    if (!adminsSnapshot.empty) {
        const batch = adminDb!.batch();
        adminsSnapshot.forEach(adminDoc => {
            const taskRef = adminDb!.collection('tasks').doc();
            batch.set(taskRef, {
                authorId: requestingEmployeeId, 
                createdBy: requestingEmployeeId,
                recipientId: adminDoc.id, 
                recipientIds: [adminDoc.id],
                content: `Transfer request for ${studentName}: ${reason}`,
                createdAt: new Date().toISOString(), status: 'new', category: 'request', replies: []
            });
        });
        await batch.commit();
    }
    return { success: true, message: 'Transfer request submitted.' };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function requestStudentDeletion(studentId: string, employeeId: string, reason: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
    try {
        const studentRef = adminDb!.collection('students').doc(studentId);
        const employee = await getUser(employeeId);
        if (!employee) return { success: false, message: "Invalid employee." };

        await studentRef.update({ 
          deletionRequested: { requestedBy: employeeId, reason: reason, requestedAt: new Date().toISOString(), status: 'pending' },
          lastActivityAt: new Date().toISOString()
        });

        const adminsSnap = await adminDb!.collection('users').where('role', '==', 'admin').get();
        if (!adminsSnap.empty) {
            const studentData = (await studentRef.get()).data() as Student;
            const batch = adminDb!.batch();
            adminsSnap.forEach(adminDoc => {
                const taskRef = adminDb!.collection('tasks').doc();
                batch.set(taskRef, { 
                  authorId: employeeId, 
                  createdBy: employeeId,
                  recipientId: adminDoc.id, 
                  recipientIds: [adminDoc.id], 
                  content: `Deletion request for ${studentData.name}: ${reason}`, 
                  status: 'new', category: 'request', createdAt: new Date().toISOString(), replies: [] 
                });
            });
            await batch.commit();
        }
        return { success: true, message: 'Deletion request submitted.' };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}


export async function bulkTransferStudents(fromEmployeeId: string, toEmployeeId: string, adminId: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
    try {
        const fromEmployee = await getUser(fromEmployeeId);
        const toEmployee = await getUser(toEmployeeId);
        if (!fromEmployee || !toEmployee || !fromEmployee.civilId || !toEmployee.civilId) return { success: false, message: 'Invalid employees.' };

        const snapshot = await adminDb!.collection('students').where('employeeId', '==', fromEmployee.civilId).get();
        if (snapshot.empty) return { success: true, message: 'No students to transfer.' };

        const batch = adminDb!.batch();
        snapshot.docs.forEach(doc => {
            const docData = doc.data();
            batch.update(doc.ref, { 
                employeeId: toEmployee.civilId, isNewForEmployee: true,
                lastActivityAt: new Date().toISOString(),
                transferHistory: [...(docData.transferHistory || []), { fromEmployeeId: fromEmployee.civilId, toEmployeeId: toEmployee.civilId, date: new Date().toISOString(), transferredBy: adminId }]
            });
        });
        await batch.commit();
        return { success: true, message: `${snapshot.size} students transferred.` };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}

export async function addEmployeeNote(studentId: string, authorId: string, content: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
    try {
        const studentRef = adminDb!.collection('students').doc(studentId);
        const studentDoc = await studentRef.get();
        if (!studentDoc.exists) return { success: false, message: 'Student not found.' };
        const author = await getUser(authorId);
        if (!author) return { success: false, message: 'Author not found.'};
        const studentData = studentDoc.data() as Student;
        if (author.role === 'employee' && author.civilId !== studentData.employeeId) return { success: false, message: 'Unauthorized.' };
        await studentRef.update({ 
          employeeNotes: FieldValue.arrayUnion({ id: `note-${Date.now()}`, authorId, content, createdAt: new Date().toISOString() }),
          lastActivityAt: new Date().toISOString()
        });
        return { success: true, message: 'Note added.' };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}

export async function addAdminNote(studentId: string, authorId: string, content: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
    try {
        const studentRef = adminDb!.collection('students').doc(studentId);
        const studentDoc = await studentRef.get();
        if (!studentDoc.exists) return { success: false, message: 'Student not found.' };
        const author = await getUser(authorId);
        if (!author || !['admin', 'department'].includes(author.role)) return { success: false, message: 'Unauthorized.' };
        await studentRef.update({ 
          adminNotes: FieldValue.arrayUnion({ id: `note-admin-${Date.now()}`, authorId, content, createdAt: new Date().toISOString() }),
          lastActivityAt: new Date().toISOString()
        });
        return { success: true, message: 'Admin note added.' };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}

export async function addMissingItemToStudent(studentId: string, item: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
    try {
        await adminDb!.collection('students').doc(studentId).update({ 
          missingItems: FieldValue.arrayUnion(item), 
          newMissingItemsForEmployee: FieldValue.increment(1),
          lastActivityAt: new Date().toISOString()
        });
        return { success: true, message: 'Missing item added.' };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}

export async function removeMissingItemFromStudent(studentId: string, itemToRemove: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
  try {
    await adminDb!.collection('students').doc(studentId).update({ 
      missingItems: FieldValue.arrayRemove(itemToRemove),
      lastActivityAt: new Date().toISOString()
    });
    return { success: true, message: 'Missing item removed.' };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function markMissingItemAsReceived(studentId: string, itemReceived: string, userId: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
    try {
        const studentRef = adminDb!.collection('students').doc(studentId);
        await studentRef.update({ 
            missingItems: FieldValue.arrayRemove(itemReceived), 
            adminNotes: FieldValue.arrayUnion({ id: `note-item-received-${Date.now()}`, authorId: userId, content: `Marked as received: "${itemReceived}"`, createdAt: new Date().toISOString() }),
            unreadUpdates: FieldValue.increment(1),
            lastActivityAt: new Date().toISOString()
        });
        return { success: true, message: 'Item marked as received.' };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}


// --- TODO ACTIONS ---

export async function addTodo(userId: string, content: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    await adminDb!.collection('users').doc(userId).collection('personal_todos').add({ userId, content, completed: false, createdAt: new Date().toISOString() });
    return { success: true, message: "To-do added." };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function toggleTodo(userId: string, todoId: string, completed: boolean) {
    if (!checkAdminServices()) return { success: false, message: 'DB not available' };
    try {
        await adminDb!.collection('users').doc(userId).collection('personal_todos').doc(todoId).update({ completed: !completed });
        return { success: true, message: 'To-do updated.' };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}

export async function deleteTodo(userId: string, todoId: string) {
    if (!checkAdminServices()) return { success: false, message: 'DB not available' };
    try {
        await adminDb!.collection('users').doc(userId).collection('personal_todos').doc(todoId).delete();
        return { success: true, message: 'To-do deleted.' };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}

// --- MISC ACTIONS ---

export async function updateChecklistItem(studentId: string, itemKey: keyof ProfileCompletionStatus, value: boolean, authorId: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
    try {
        const studentDoc = await adminDb!.collection('students').doc(studentId).get();
        if (!studentDoc.exists) return { success: false, message: "Student found." };
        const author = await getUser(authorId);
        if (!author || author.civilId !== studentDoc.data()!.employeeId) return { success: false, message: 'Unauthorized.' };
        await adminDb!.collection('students').doc(studentId).update({ 
          [`profileCompletionStatus.${itemKey}`]: value,
          lastActivityAt: new Date().toISOString()
        });
        return { success: true, message: 'Checklist updated.' };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}

export async function setStudentFinalChoice(studentId: string, university: string, major: string, updaterId: string) {
  if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
  try {
    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) return { success: false, message: 'Student not found.' };
    const studentData = studentDoc.data() as Student;
    const updater = await getUser(updaterId);
    if (!updater) return { success: false, message: 'Updater not found.' };
    
    if (updater.role === 'employee' && updater.civilId !== studentData.employeeId && updater.role !== 'admin' && updater.role !== 'department') return { success: false, message: 'Unauthorized.' };

    await studentRef.update({ 
      finalChoiceUniversity: university, 
      lastActivityAt: new Date().toISOString(),
      adminNotes: FieldValue.arrayUnion({ id: `note-finalize-${Date.now()}`, authorId: updaterId, content: `${updater.name} set final choice to ${university}.`, createdAt: new Date().toISOString() }) 
    });

    if (updater.role === 'employee') {
        const adminsSnapshot = await adminDb!.collection('users').where('role', '==', 'admin').get();
        if (!adminsSnapshot.empty) {
            const batch = adminDb!.batch();
            for (const adminDoc of adminsSnapshot.docs) {
                batch.set(adminDb!.collection('tasks').doc(), { 
                  authorId: updaterId, 
                  createdBy: updaterId,
                  recipientId: adminDoc.id, 
                  recipientIds: [adminDoc.id], 
                  content: `Final choice set for ${studentData.name} to ${university}.`, 
                  createdAt: new Date().toISOString(), status: 'new', category: 'system', replies: [] 
                });
            }
            await batch.commit();
        }
    }
    return { success: true, message: `Final choice set.` };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function deleteStudent(studentId: string, adminId: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
    try {
        const adminUser = await getUser(adminId);
        if (!adminUser || adminUser.role !== 'admin') return { success: false, message: 'Unauthorized.' };

        const studentRef = adminDb!.collection('students').doc(studentId);
        const studentDoc = await studentRef.get();
        if (!studentDoc.exists) return { success: false, message: 'Student not found.' };
        const studentData = studentDoc.data() as Student;

        if (storage) {
            const bucket = storage.bucket();
            for (const doc of (studentData.documents || [])) {
                try {
                    const filePath = decodeURIComponent(new URL(doc.url).pathname.split('/').slice(2).join('/'));
                    if (filePath) await bucket.file(filePath).delete();
                } catch (e) {}
            }
        }
        
        await adminDb!.collection('chats').doc(studentId).collection('messages').get().then(s => s.forEach(d => d.ref.delete()));
        await adminDb!.collection('chats').doc(studentId).delete();
        await studentRef.delete();

        return { success: true, message: `Student deleted successfully.` };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}

export async function deleteStudentDocument(studentId: string, documentId: string, documentUrl: string, deleterId: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
    try {
        const studentRef = adminDb!.collection('students').doc(studentId);
        const studentDoc = await studentRef.get();
        if (!studentDoc.exists) return { success: false, message: 'Student not found.' };
        const studentData = studentDoc.data() as Student;
        const deleter = await getUser(deleterId);
        if (!deleter) return { success: false, message: "Invalid user." };

        if (deleter.role === 'employee' && deleter.civilId !== studentData.employeeId && deleter.role !== 'admin' && deleter.role !== 'department') return { success: false, message: 'Unauthorized.' };

        const bucket = storage!.bucket();
        const filePath = decodeURIComponent(new URL(documentUrl).pathname.split('/').slice(2).join('/'));
        if (filePath) await bucket.file(filePath).delete();

        const updatedDocs = (studentData.documents || []).filter(d => d.id !== documentId);
        await studentRef.update({ 
          documents: updatedDocs,
          lastActivityAt: new Date().toISOString()
        });
        return { success: true, message: 'Document deleted.' };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}


export async function handleEmployeeLogin(userId: string) {
  if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
  try {
    const user = await getUser(userId);
    if (!user || user.role !== 'employee') return { success: true, message: 'Not an employee.' };

    const timeLogsRef = adminDb!.collection('time_logs');
    const activeLogQuery = await timeLogsRef.where('employeeId', '==', userId).where('clockOut', '==', null).get();
    if (!activeLogQuery.empty) {
      const batch = adminDb!.batch();
      activeLogQuery.docs.forEach(doc => batch.update(doc.ref, { clockOut: new Date().toISOString() }));
      await batch.commit();
    }
    await timeLogsRef.add({ employeeId: userId, date: new Date().toISOString().split('T')[0], clockIn: new Date().toISOString(), clockOut: null, lastSeen: new Date().toISOString() });
    
    // Trigger inactivity check when employee logs in
    await processInactivityReminders();

    return { success: true, message: 'Login session started.' };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function handleEmployeeLogout(userId: string) {
  if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
  try {
    const activeLogQuery = await adminDb!.collection('time_logs').where('employeeId', '==', userId).where('clockOut', '==', null).orderBy('clockIn', 'desc').limit(1).get();
    if (activeLogQuery.empty) return { success: true, message: 'No active session.' };
    await activeLogQuery.docs[0].ref.update({ clockOut: new Date().toISOString() });
    return { success: true, message: 'Session ended.' };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function keepAlive(userId: string) {
    if (!checkAdminServices()) return { success: false, message: 'DB not available' };
    try {
        const activeLogQuery = await adminDb!.collection('time_logs').where('employeeId', '==', userId).where('clockOut', '==', null).orderBy('clockIn', 'desc').limit(1).get();
        if (!activeLogQuery.empty) await activeLogQuery.docs[0].ref.update({ lastSeen: new Date().toISOString() });
        
        // Use heartbeat to trigger background inactivity reminder checks
        await processInactivityReminders();

        return { success: true };
    } catch (error) {
        return { success: false, message: 'Failed to update session.' };
    }
}

export async function closeInactiveSessions() {
    if (!checkAdminServices()) return { success: false, message: 'DB not available' };
    try {
        const fiveMinutesAgo = subMinutes(new Date(), 2).toISOString();
        const inactiveSessionsQuery = await adminDb!.collection('time_logs').where('clockOut', '==', null).where('lastSeen', '<', fiveMinutesAgo).get();
        if (inactiveSessionsQuery.empty) return { success: true, message: 'No inactive sessions.' };
        const batch = adminDb!.batch();
        inactiveSessionsQuery.docs.forEach(doc => batch.update(doc.ref, { clockOut: doc.data().lastSeen }));
        await batch.commit();
        return { success: true, message: `Closed ${inactiveSessionsQuery.size} sessions.` };
    } catch (error) {
        return { success: false, message: 'Failed.' };
    }
}

export async function updateUserAvatar(userId: string, avatarUrl: string) {
  if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
  try {
    await adminDb!.collection('users').doc(userId).update({ avatarUrl });
    return { success: true, message: 'Avatar updated.' };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function getReportStats(dateRange: {
  from: string;
  to: string;
}): Promise<{ success: boolean; data?: ReportStats; message?: string }> {
  if (!checkAdminServices()) return { success: false, message: "Admin services not available" };
  try {
    const interval = { start: parseISO(dateRange.from), end: parseISO(dateRange.to) };
    const [studentsSnap, usersSnap, timeLogsSnap] = await Promise.all([
      adminDb!.collection('students').get(), 
      adminDb!.collection('users').get(), 
      adminDb!.collection('time_logs').get()
    ]);
    const allStudents = studentsSnap.docs.map(doc => doc.data() as Student);
    const allUsers = usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as User));
    const allTimeLogs = timeLogsSnap.docs.map(doc => doc.data() as TimeLog);
    const studentsInRange = allStudents.filter(s => s.createdAt && isWithinInterval(parseISO(s.createdAt), interval));
    const appsInRange = allStudents.flatMap(s => s.applications || []).filter(app => app.updatedAt && isWithinInterval(parseISO(app.updatedAt), interval));
    const stats: ReportStats = {
      totalStudents: allStudents.length, 
      totalApplications: allStudents.reduce((acc, s) => acc + (s.applications?.length || 0), 0), 
      totalEmployees: allUsers.filter(u => u.role === 'employee').length,
      applicationStatusData: Object.entries(appsInRange.reduce((acc, app) => { acc[app.status] = (acc[app.status] || 0) + 1; return acc; }, {} as Record<string, number>)).map(([name, count]) => ({ name, count })),
      studentEmployeeData: Object.entries(allStudents.reduce((acc, s) => { const name = s.employeeId ? allUsers.find(u => u.civilId === s.employeeId)?.name || 'Unassigned' : 'Unassigned'; acc[name] = (acc[name] || 0) + (s.applications?.length || 0); return acc; }, {} as Record<string, number>)).map(([name, count]) => ({ name, count })),
      studentGrowthData: Object.entries(studentsInRange.reduce((acc, s) => { const d = format(parseISO(s.createdAt), 'yyyy-MM-dd'); acc[d] = (acc[d] || 0) + 1; return acc; }, {} as Record<string, number>)).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
      applicationCountryData: Object.entries(appsInRange.reduce((acc, app) => { acc[app.country] = (acc[app.country] || 0) + 1; return acc; }, {} as Record<string, number>)).map(([name, count]) => ({ name, count })),
      employeeHoursData: Object.entries(allTimeLogs.filter(log => log.clockOut && isWithinInterval(parseISO(log.date), interval)).reduce((acc, log) => { const user = allUsers.find(u => u.id === log.employeeId); if (user) acc[user.name] = (acc[user.name] || 0) + (differenceInMinutes(parseISO(log.clockOut!), parseISO(log.clockIn)) / 60); return acc; }, {} as Record<string, number>)).map(([name, hours]) => ({ name, hours: parseFloat(hours.toFixed(1))}))
    };
    return { success: true, data: stats };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function addEvent(authorId: string, title: string, description: string, date: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
    try {
        const author = await getUser(authorId);
        if (!author || !['admin', 'department'].includes(author.role)) return { success: false, message: 'Unauthorized.' };
        await adminDb!.collection('upcoming_events').add({ authorId, title, description, date, createdAt: new Date().toISOString() });
        return { success: true, message: 'Event added.' };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}

export async function deleteEvent(eventId: string, userId: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
    try {
        const user = await getUser(userId);
        if (!user || !['admin', 'department'].includes(user.role)) return { success: false, message: 'Unauthorized.' };
        await adminDb!.collection('upcoming_events').doc(eventId).delete();
        return { success: true, message: 'Event deleted.' };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}


export async function getEmployeeStudentStats(): Promise<{ success: boolean; data?: EmployeeStats[]; message?: string; }> {
    if (!checkAdminServices()) return { success: false, message: "Server not available" };
    try {
        const employees = (await adminDb!.collection('users').where('role', '==', 'employee').get()).docs.map(doc => ({ id: doc.id, ...doc.data() } as User));
        const allStudents = (await adminDb!.collection('students').get()).docs.map(doc => doc.data() as Student);
        const thirtyDaysAgo = startOfDay(subDays(new Date(), 30));
        const stats: EmployeeStats[] = employees.map(employee => {
            const created = allStudents.filter(s => s.createdBy === employee.id);
            const dailyCountsMap: Record<string, number> = {};
            const monthlyMap: Record<string, number> = {};
            created.forEach(s => {
                const d = parseISO(s.createdAt);
                monthlyMap[format(d, 'yyyy-MM')] = (monthlyMap[format(d, 'yyyy-MM')] || 0) + 1;
                if (d >= thirtyDaysAgo) dailyCountsMap[format(d, 'yyyy-MM-dd')] = (dailyCountsMap[format(d, 'yyyy-MM-dd')] || 0) + 1;
            });
            return {
                employeeId: employee.id, employeeName: employee.name, totalStudents: created.length,
                dailyCounts: Array.from({ length: 30 }, (_, i) => format(subDays(new Date(), i), 'yyyy-MM-dd')).map(date => ({ date, count: dailyCountsMap[date] || 0 })).sort((a,b) => a.date.localeCompare(b.date)),
                monthlyTotals: Object.entries(monthlyMap).map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month)),
            };
        });
        return { success: true, data: stats };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}

export async function updateStudentIELTS(studentId: string, overallScore: number, authorId: string) {
  if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
  try {
    const studentRef = adminDb!.collection('students').doc(studentId);
    await studentRef.update({ 
      ieltsOverall: overallScore, 
      lastActivityAt: new Date().toISOString(),
      adminNotes: FieldValue.arrayUnion({ id: `note-ielts-${Date.now()}`, authorId, content: `IELTS updated to ${overallScore.toFixed(1)}.`, createdAt: new Date().toISOString() }) 
    });
    return { success: true, message: 'IELTS score updated.' };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function createStudentLogin(studentId: string, description: string, username: string, password: string, notes: string | undefined, createdByUserId: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
    try {
        const studentRef = adminDb!.collection('students').doc(studentId);
        const creator = await getUser(createdByUserId);
        if (!creator) return { success: false, message: "User not found." };
        await studentRef.update({ 
          studentLogins: FieldValue.arrayUnion({ id: `login-${Date.now()}`, username, password, description, notes, createdAt: new Date().toISOString() }),
          lastActivityAt: new Date().toISOString()
        });
        return { success: true, message: 'Student login record created.' };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}


export async function deleteStudentLogin(studentId: string, idToDelete: string, deletedByUserId: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
    try {
        const studentRef = adminDb!.collection('students').doc(studentId);
        const studentDoc = await studentRef.get();
        const updatedLogins = (studentDoc.data()?.studentLogins || []).filter((l: any) => l.id !== idToDelete);
        await studentRef.update({ 
          studentLogins: updatedLogins,
          lastActivityAt: new Date().toISOString()
        });
        return { success: true, message: 'Record deleted.' };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}


export async function resetStudentPassword(email: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
    try {
        await adminAuth!.generatePasswordResetLink(email);
        return { success: true, message: 'Reset link generated.' };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}

export async function updateStudentTargetCountries(studentId: string, countries: string[], updaterId: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
    try {
        await adminDb!.collection('students').doc(studentId).update({ 
          targetCountries: countries, 
          lastActivityAt: new Date().toISOString(),
          adminNotes: FieldValue.arrayUnion({ id: `note-target-${Date.now()}`, authorId, content: `Target countries set to: ${countries.join(', ')}`, createdAt: new Date().toISOString() }) 
        });
        return { success: true, message: 'Target countries updated.' };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}

export async function updateStudentAcademicIntake(studentId: string, semester: string, year: number, updaterId: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
    try {
        await adminDb!.collection('students').doc(studentId).update({ 
          academicIntakeSemester: semester, 
          academicIntakeYear: year, 
          lastActivityAt: new Date().toISOString(),
          adminNotes: FieldValue.arrayUnion({ id: `note-intake-${Date.now()}`, authorId, content: `Academic intake updated to: ${semester} ${year}`, createdAt: new Date().toISOString() }) 
        });
        return { success: true, message: 'Academic intake updated.' };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}

export async function seedAcademicTerms(authorId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const terms = [
      'FALL (8/9) 2025', 'SPRING (1/2) 2026', 'MARCH (3) 2026', 'SUMMER (6/7) 2026',
      'FALL (8/9) 2026', 'SPRING (1/2) 2027', 'MARCH (3) 2027', 'SUMMER (6/7) 2027'
    ];
    const batch = adminDb!.batch();
    for (const name of terms) {
      const docRef = adminDb!.collection('academic_terms').doc();
      batch.set(docRef, { name, authorId, createdAt: new Date().toISOString() });
    }
    await batch.commit();
    return { success: true, message: 'Default terms restored.' };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function addAcademicTerm(name: string, authorId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    await adminDb!.collection('academic_terms').add({ name, authorId, createdAt: new Date().toISOString() });
    return { success: true, message: 'Term added.' };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function deleteAcademicTerm(termId: string, userId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    await adminDb!.collection('academic_terms').doc(termId).delete();
    return { success: true };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function updateStudentTerm(studentId: string, term: string, authorId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    await adminDb!.collection('students').doc(studentId).update({ 
      term,
      lastActivityAt: new Date().toISOString()
    });
    await addAdminNote(studentId, authorId, `Academic intake updated to: ${term}`);
    return { success: true };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function sendChatMessage(studentId: string, authorId: string, content: string, recipientId?: string, documentPayload?: { name: string; url: string }) {
  if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
  try {
    const author = await getUser(authorId);
    if (!author) return { success: false, message: 'Author not found.' };

    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) return { success: false, message: 'Student not found.' };
    const studentData = studentDoc.data() as Student;

    // 1. Create message record
    const now = new Date().toISOString();
    const messageData = {
      authorId,
      content,
      timestamp: now,
      ...(documentPayload && { document: documentPayload }),
    };
    await adminDb!.collection('chats').doc(studentId).collection('messages').add(messageData);

    // 2. Update notification counters and activity timestamp
    const isAdminDept = ['admin', 'department'].includes(author.role);
    const updates: any = { lastActivityAt: now };

    if (isAdminDept) {
      updates.employeeUnreadMessages = (studentData.employeeUnreadMessages || 0) + 1;
      await studentRef.update(updates);
      
      // WhatsApp notify employee
      if (studentData.employeeId) {
        const employeeQuery = await adminDb!.collection('users').where('civilId', '==', studentData.employeeId).limit(1).get();
        if (!employeeQuery.empty) {
          const emp = employeeQuery.docs[0].data() as User;
          await triggerWhatsAppNotification('admin_update', {
            employeeName: emp.name,
            messageContent: `Management sent a message for ${studentData.name}: ${content.substring(0, 50)}...`,
            dashboardUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/student/${studentId}`
          }, emp.phone);
        }
      }
    } else {
      updates.unreadUpdates = (studentData.unreadUpdates || 0) + 1;
      await studentRef.update(updates);
      
      // WhatsApp notify admins if @Admins or @Department mention is used, or just general update
      const adminsSnap = await adminDb!.collection('users').where('role', '==', 'admin').get();
      for (const adminDoc of adminsSnap.docs) {
        const adminData = adminDoc.data() as User;
        await triggerWhatsAppNotification('admin_update', {
          employeeName: adminData.name,
          messageContent: `${author.name} sent a message for ${studentData.name}: ${content.substring(0, 50)}...`,
          dashboardUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/internal-chat`
        }, adminData.phone);
      }
    }

    return { success: true };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function triggerDocumentUploadNotification(studentId: string, documentName: string, authorId: string) {
  if (!checkAdminServices()) return;
  try {
    const author = await getUser(authorId);
    if (!author) return;

    const studentDoc = await adminDb!.collection('students').doc(studentId).get();
    if (!studentDoc.exists) return;
    const studentData = studentDoc.data() as Student;

    const isAdminDept = ['admin', 'department'].includes(author.role);
    
    if (isAdminDept) {
      // Notify assigned employee
      if (studentData.employeeId) {
        const employeeQuery = await adminDb!.collection('users').where('civilId', '==', studentData.employeeId).limit(1).get();
        if (!employeeQuery.empty) {
          const emp = employeeQuery.docs[0].data() as User;
          await triggerWhatsAppNotification('document_uploaded_admin', {
            employeeName: emp.name,
            studentName: studentData.name,
            documentName: documentName,
            uploadedBy: author.name,
            studentUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/student/${studentId}`
          }, emp.phone);
        }
      }
    } else {
      // Notify admins
      const adminsSnap = await adminDb!.collection('users').where('role', '==', 'admin').get();
      for (const adminDoc of adminsSnap.docs) {
        const adminData = adminDoc.data() as User;
        await triggerWhatsAppNotification('document_uploaded_employee', {
          adminName: adminData.name,
          studentName: studentData.name,
          documentName: documentName,
          employeeName: author.name,
          uploadedBy: author.name,
          studentUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/student/${studentId}`
        }, adminData.phone);
      }
    }
  } catch (e) {
    console.error('Document upload notification trigger failed:', e);
  }
}

export async function toggleChangeAgentStatus(studentId: string, status: boolean, adminId: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
    try {
        const admin = await getUser(adminId);
        if (!admin || !['admin', 'department'].includes(admin.role)) return { success: false, message: 'Unauthorized.' };

        const studentRef = adminDb!.collection('students').doc(studentId);
        const studentDoc = await studentRef.get();
        if (!studentDoc.exists) return { success: false, message: 'Student not found.' };
        const studentData = studentDoc.data() as Student;

        await studentRef.update({ 
          changeAgentRequired: status,
          lastActivityAt: new Date().toISOString()
        });

        // If turned ON, notify the employee and management
        if (status) {
            const taskContent = `🚨 URGENT: Change Agent status enabled for ${studentData.name}. Please review this profile immediately.`;
            const studentUrl = `${process.env.NEXT_PUBLIC_APP_URL || ''}/student/${studentId}`;

            // 1. Notify Assigned Employee
            if (studentData.employeeId) {
                const employeeQuery = await adminDb!.collection('users').where('civilId', '==', studentData.employeeId).limit(1).get();
                if (!employeeQuery.empty) {
                    const employeeDoc = employeeQuery.docs[0];
                    const employeeData = employeeDoc.data() as User;
                    
                    await adminDb!.collection('tasks').add({
                        authorId: adminId,
                        createdBy: adminId,
                        recipientId: employeeDoc.id,
                        recipientIds: [employeeDoc.id],
                        content: taskContent,
                        createdAt: new Date().toISOString(),
                        status: 'new',
                        category: 'system',
                        replies: []
                    });

                    // WhatsApp to Employee
                    if (employeeData.phone) {
                      await triggerWhatsAppNotification('change_agent_enabled', {
                        userName: employeeData.name,
                        studentName: studentData.name,
                        employeeName: employeeData.name,
                        messageContent: taskContent,
                        studentUrl: studentUrl
                      }, employeeData.phone);
                    }
                }
            }

            // 2. Notify all Admins and Department Users
            const managementSnap = await adminDb!.collection('users')
              .where('role', 'in', ['admin', 'department'])
              .get();

            const assignedEmployeeName = studentData.employeeId 
              ? (await adminDb!.collection('users').where('civilId', '==', studentData.employeeId).limit(1).get()).docs[0]?.data()?.name || 'Unassigned'
              : 'Unassigned';

            for (const mDoc of managementSnap.docs) {
              const mData = mDoc.data() as User;
              if (mData.id === adminId) continue; // Don't notify the one who triggered it

              if (mData.phone) {
                await triggerWhatsAppNotification('change_agent_enabled', {
                  userName: mData.name,
                  studentName: studentData.name,
                  employeeName: assignedEmployeeName,
                  messageContent: taskContent,
                  studentUrl: studentUrl
                }, mData.phone);
              }
            }
        }

        return { success: true, message: status ? 'Change Agent status enabled.' : 'Change Agent status removed.' };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}

export async function submitInactivityReport(studentId: string, employeeId: string, reportContent: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const studentRef = adminDb!.collection('students').doc(studentId);
    const employee = await getUser(employeeId);
    if (!employee) return { success: false, message: 'Employee not found' };

    const now = new Date().toISOString();
    const fullReportMessage = `Inactivity Report for student: ${reportContent}`;

    // 1. Send chat message to admins
    await sendChatMessage(studentId, employeeId, `@Admins: ${fullReportMessage}`);

    // 2. Add to internal notes for record
    await studentRef.update({
      lastActivityAt: now,
      employeeNotes: FieldValue.arrayUnion({
        id: `note-inactivity-${Date.now()}`,
        authorId: employeeId,
        content: `Contacted student and submitted inactivity report: ${reportContent}`,
        createdAt: now,
      })
    });

    return { success: true, message: 'Report submitted and sent to management.' };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * BACKGROUND TASK: Scans students for inactivity (>10 days) and sends recurring 3-hour chat reminders to employees.
 * Also notifies Admins so they can track the status.
 */
export async function processInactivityReminders() {
  if (!checkAdminServices()) return { success: false };
  
  try {
    const tenDaysAgo = subDays(new Date(), 10).toISOString();
    const threeHoursAgo = subMinutes(new Date(), 180).toISOString();
    
    // Find students with no activity for 10 days
    const snapshot = await adminDb!.collection('students')
      .where('lastActivityAt', '<', tenDaysAgo)
      .get();
      
    if (snapshot.empty) return { success: true };

    for (const doc of snapshot.docs) {
      const student = doc.data() as Student;
      
      // Exclude high-priority or finalized students
      if (student.changeAgentRequired || student.profileCompletionStatus?.readyToTravel) continue;
      
      // Only send if assigned to an employee
      if (!student.employeeId) continue;

      // Check if we already sent a reminder recently (within last 3 hours)
      if (student.lastInactivityReminderSentAt && student.lastInactivityReminderSentAt > threeHoursAgo) continue;
      
      // Construct the alert message
      const reminderContent = "Please contact the student , and give me a report why there is no activities \n\nتواصل مع الطالب و عطني تقرير عن الطالب ليش ماكو اي شي يديد عنه ؟";
      
      // 1. Add chat message from 'Management'
      await adminDb!.collection('chats').doc(doc.id).collection('messages').add({
        authorId: 'system',
        content: reminderContent,
        timestamp: new Date().toISOString()
      });
      
      // 2. Update student metadata to track reminder and alert BOTH employee and admin
      await doc.ref.update({
        lastInactivityReminderSentAt: new Date().toISOString(),
        employeeUnreadMessages: (student.employeeUnreadMessages || 0) + 1,
        unreadUpdates: (student.unreadUpdates || 0) + 1 // Increment for admin tracking
      });

      // 3. Notify all admins via system update task so they can keep track
      const employeeQuery = await adminDb!.collection('users').where('civilId', '==', student.employeeId).limit(1).get();
      const employeeData = !employeeQuery.empty ? employeeQuery.docs[0].data() as User : null;
      
      if (employeeData) {
          // Trigger WhatsApp Alert for Employee
          await triggerWhatsAppNotification('inactivity_reminder', {
            employeeName: employeeData.name,
            studentName: student.name,
            dashboardUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/student/${doc.id}`
          }, employeeData.phone);
      }

      const adminsSnap = await adminDb!.collection('users').where('role', '==', 'admin').get();
      if (!adminsSnap.empty) {
          const batch = adminDb!.batch();
          for (const adminDoc of adminsSnap.docs) {
              const adminUpdateRef = adminDb!.collection('tasks').doc();
              batch.set(adminUpdateRef, {
                  authorId: 'system',
                  createdBy: 'system',
                  recipientId: adminDoc.id,
                  recipientIds: [adminDoc.id],
                  content: `[Auto-Reminder] Inactivity nudge sent to ${employeeData?.name || 'employee'} for student ${student.name}.`,
                  createdAt: new Date().toISOString(),
                  status: 'new',
                  category: 'system',
                  replies: []
              });
          }
          await batch.commit();
      }
      
      console.log(`[Reminder] Sent 3-hour inactivity nudge for ${student.name} assigned to ${student.employeeId}`);
    }

    return { success: true };
  } catch (e: any) {
    console.error('Inactivity reminder process failed:', e);
    return { success: false, message: e.message };
  }
}

/**
 * DEBUG UTILITY: Forces a student into an "Inactive" state for testing.
 * Sets the lastActivityAt to 11 days ago.
 */
export async function forceInactivity(studentId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const elevenDaysAgo = subDays(new Date(), 11).toISOString();
    await adminDb!.collection('students').doc(studentId).update({
      lastActivityAt: elevenDaysAgo,
      createdAt: elevenDaysAgo,
      changeAgentRequired: false,
      pipelineStatus: 'none',
      lastInactivityReminderSentAt: null, // Clear reminder history
      'profileCompletionStatus.readyToTravel': false
    });
    return { success: true, message: 'Student status backdated to 11 days ago.' };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}
