'use server';

import { adminDb, adminAuth, storage } from '@/lib/firebase/admin';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import type { User, Student, Application, ApplicationStatus, Task, Note, TaskStatus, Country, UserRole, ProfileCompletionStatus, TimeLog, ReportStats, UpcomingEvent, EmployeeStats, Document as StudentDoc, StudentLogin, RequestType, NotificationTemplate, NotificationType, Invoice, InvoiceStatus, InvoiceTemplate, InvoiceSavedItem, ResourceLink, SharedDocument, MissingItem } from './types';
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

/**
 * SCRUBBER: Ensures data is a plain object for Server-to-Client boundaries.
 */
function scrub<T>(data: T): T {
  if (data === undefined) return data;
  return JSON.parse(JSON.stringify(data));
}

// Helper to get user from DB
async function getUser(userId: string): Promise<User | null> {
  if (!checkAdminServices()) return null;
  const doc = await adminDb!.collection('users').doc(userId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() } as User;
}

// Map application countries to department names
function getDepartmentsForStudent(student: Student): string[] {
  const countries = new Set((student.applications || []).map(app => app.country));
  const depts = new Set<string>();

  if (countries.has('UK')) depts.add('UK');
  if (countries.has('USA')) depts.add('USA');
  if (countries.has('Australia') || countries.has('New Zealand')) depts.add('AU/NZ');

  return Array.from(depts);
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

export async function updateStudentStatusNote(studentId: string, note: string, authorId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const studentRef = adminDb!.collection('students').doc(studentId);
    const now = new Date().toISOString();

    await studentRef.update({
      statusNote: note,
      lastActivityAt: now
    });

    return { success: true, message: 'Status note updated.' };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function updateStudentAdminStatusNote(studentId: string, note: string, authorId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const updater = await getUser(authorId);
    if (!updater || updater.role !== 'admin') {
      return { success: false, message: 'Unauthorized. Only Admins can set Management Status Notes.' };
    }

    const studentRef = adminDb!.collection('students').doc(studentId);
    const now = new Date().toISOString();

    await studentRef.update({
      adminStatusNote: note,
      lastActivityAt: now
    });

    return { success: true, message: 'Admin status note updated.' };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function repairPermissions(adminId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };

  try {
    const authorizedBypass = [
      'bbkDS193aqcaAJS6M6GkjWFgFTr1',
      'IZr1zv5ePQb0bKNVXS4xGjERmE62',
      'cYfvOMr5CCY5MACCgYm1DdjaZug1',
      'lZr1zv5ePQbObKNVXS4xGjERmE62'
    ];

    console.log('Repairing permissions for Admin ID:', adminId);

    const usersSnap = await adminDb!.collection('users').get();
    const batch = adminDb!.batch();

    // Clear existing permissions
    const adminsSnap = await adminDb!.collection('admins').get();
    const deptsSnap = await adminDb!.collection('departmentUsers').get();

    adminsSnap.docs.forEach(doc => batch.delete(doc.ref));
    deptsSnap.docs.forEach(doc => batch.delete(doc.ref));

    const now = new Date().toISOString();

    // Rebuild permissions based on current roles
    usersSnap.docs.forEach(userDoc => {
      const userData = userDoc.data();
      const uid = userDoc.id;

      if (userData.role === 'admin' || authorizedBypass.includes(uid)) {
        batch.set(adminDb!.collection('admins').doc(uid), {
          role: 'admin',
          lastSync: now,
          userEmail: userData.email || 'bypass@system.local'
        });
      }

      if (userData.role === 'department') {
        const dept = userData.department || 'UK';
        batch.set(adminDb!.collection('departmentUsers').doc(uid), {
          role: 'department',
          lastSync: now,
          department: dept,
          email: userData.email || ''
        });
      }
    });

    await batch.commit();
    console.log('Permission repair complete.');
    return { success: true, message: `Successfully repaired permissions and synchronized ${usersSnap.size} users.` };
  } catch (e: any) {
    console.error('Permission repair failed:', e);
    return { success: false, message: e.message };
  }
}

async function sendWhatsAppViaWebhook(webhookUrl: string, phone: string, variables: Record<string, string>, mapping?: Record<string, string>) {
  if (!webhookUrl || !phone) return { success: false, message: 'Missing webhook URL or phone' };

  const normalizedPhone = phone.replace(/\D/g, '');
  const fullPhone = normalizedPhone.startsWith('965') ? normalizedPhone : `965${normalizedPhone}`;

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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to: fullPhone, ...payloadVariables }),
    });

    if (!response.ok) {
      return { success: false, message: 'Failed to trigger WANotifier webhook' };
    }

    return { success: true };
  } catch (e: any) {
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

    if (templateQuery.empty) return;

    const template = templateQuery.docs[0].data() as NotificationTemplate;
    if (template.webhookUrl) {
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
    if (!template.webhookUrl) return { success: false, message: 'No Webhook URL configured.' };
    return await sendWhatsAppViaWebhook(template.webhookUrl, phone, variables, template.variableMapping);
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function sendSampleWebhookRequest(webhookUrl: string, mapping: Record<string, string>) {
  if (!webhookUrl) return { success: false, message: 'No URL provided' };
  const dummyVars: Record<string, string> = {
    recipientName: 'Sample Admin',
    staffName: 'Sample Employee',
    taskName: 'Visa Application Request',
    employeeName: 'Sample Employee',
    taskTitle: 'Sample Task',
    taskDescription: 'Test Description',
    studentName: 'Sample Student',
    studentEmail: 'sample@example.com',
    studentPhone: '55123456',
    dueDate: '2025-12-31',
    assignedBy: 'System Admin',
    userName: 'Sample User',
    taskUrl: 'https://uniapplyhub.com/tasks',
    createdAt: new Date().toISOString(),
    adminName: 'Super Admin',
    messageContent: 'Update Content',
    replyAuthor: 'System Assistant',
    replyMessage: 'The request has been processed.',
    documentName: 'Sample.pdf',
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
  } catch (error: any) {
    console.error('Error in saveNotificationTemplate:', error);
    return { success: false, message: error.message };
  }
}

export async function createRequestType(data: Omit<RequestType, 'id'>) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const docRef = await adminDb!.collection('request_types').add({
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return { success: true, id: docRef.id, message: 'Request type created.' };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function updateRequestType(id: string, data: Partial<RequestType>) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    await adminDb!.collection('request_types').doc(id).update({
      ...data,
      updatedAt: new Date().toISOString(),
    });
    return { success: true, message: 'Request type updated.' };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function deleteRequestType(id: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    await adminDb!.collection('request_types').doc(id).delete();
    return { success: true, message: 'Request type deleted.' };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function deleteUser(userIdToDelete: string, adminId: string) {
  if (!checkAdminServices()) return { success: false, message: 'Admin services not available.' };
  try {
    const admin = await getUser(adminId);
    if (!admin || admin.role !== 'admin') return { success: false, message: 'Unauthorized.' };
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

    const targetUser = await getUser(userId);
    if (!targetUser) return { success: false, message: 'Target user not found.' };

    const batch = adminDb!.batch();
    const userRef = adminDb!.collection('users').doc(userId);
    batch.update(userRef, { role: newRole });

    const adminDBACRef = adminDb!.collection('admins').doc(userId);
    const deptDBACRef = adminDb!.collection('departmentUsers').doc(userId);

    batch.delete(adminDBACRef);
    batch.delete(deptDBACRef);

    const now = new Date().toISOString();
    if (newRole === 'admin') {
      batch.set(adminDBACRef, { role: 'admin', syncAt: now, userEmail: targetUser.email });
    } else if (newRole === 'department') {
      batch.set(deptDBACRef, { role: 'department', syncAt: now, department: targetUser.department || 'UK' });
    }

    await batch.commit();
    return { success: true, message: `User role updated to ${newRole}.` };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function addApplication(studentId: string, universityName: string, country: string, major: string, studentName: string, employeeId: string | null) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) return { success: false, message: 'Student not found.' };
    const studentData = studentDoc.data() as Student;
    const newApplication: Application = { university: universityName, country: country as any, major: major, status: 'Pending', updatedAt: new Date().toISOString() };
    const updatedApplications = [...(studentData.applications || []), newApplication];
    await studentRef.update({ applications: updatedApplications, lastActivityAt: new Date().toISOString() });
    if (employeeId) {
      const employeeQuery = await adminDb!.collection('users').where('civilId', '==', employeeId).limit(1).get();
      if (!employeeQuery.empty) {
        const employeeDoc = employeeQuery.docs[0];
        const employeeData = employeeDoc.data() as User;
        const taskContent = `A new application for '${universityName}' has been added for ${studentName}.`;
        await adminDb!.collection('tasks').add({ authorId: 'system', recipientId: employeeDoc.id, recipientIds: [employeeDoc.id], content: taskContent, createdAt: new Date().toISOString(), status: 'new', category: 'system', replies: [] });
        await triggerWhatsAppNotification('admin_update', { employeeName: employeeData.name, messageContent: taskContent, dashboardUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/student/${studentId}` }, employeeData.phone);
      }
    }
    return { success: true, message: `Application for ${universityName} added.` };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

function buildAppSummary(applications: Application[]): string {
  if (!applications || applications.length === 0) return "No applications listed.";
  return applications.map(a => `- ${a.university}: *${a.status}*`).join('\n');
}

export async function updateApplicationStatus(studentId: string, universityName: string, major: string, newStatus: ApplicationStatus, studentName: string, employeeId: string | null, rejectionReason?: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
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

    if (newStatus === 'Rejected' && rejectionReason) {
      updatedApplications[appIndex].rejectionReason = rejectionReason;
    } else if (newStatus !== 'Rejected') {
      delete updatedApplications[appIndex].rejectionReason;
    }

    await studentRef.update({ applications: updatedApplications, lastActivityAt: new Date().toISOString() });

    if (employeeId) {
      const employeeQuery = await adminDb!.collection('users').where('civilId', '==', employeeId).limit(1).get();
      if (!employeeQuery.empty) {
        const employeeDoc = employeeQuery.docs[0];
        const employeeData = employeeDoc.data() as User;

        const summary = buildAppSummary(updatedApplications);
        const taskContent = `Status update for ${studentName}: ${universityName} is now ${newStatus}.\n\nFull Summary:\n${summary}`;

        await adminDb!.collection('tasks').add({ authorId: 'system', createdBy: 'system', recipientId: employeeDoc.id, recipientIds: [employeeDoc.id], content: taskContent, createdAt: new Date().toISOString(), status: 'new', category: 'system', replies: [] });

        await triggerWhatsAppNotification('application_status_update', {
          employeeName: employeeData.name,
          studentName: studentName,
          messageContent: taskContent,
          dashboardUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/student/${studentId}`
        }, employeeData.phone);
      }
    }
    return { success: true, message: 'Status updated.' };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function bulkUpdateApplicationStatuses(
  studentId: string,
  updates: { university: string; major: string; status: ApplicationStatus; rejectionReason?: string }[],
  adminId: string
) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) return { success: false, message: 'Student not found.' };
    const studentData = studentDoc.data() as Student;

    const updatedApplications = [...(studentData.applications || [])];
    const now = new Date().toISOString();

    for (const update of updates) {
      const idx = updatedApplications.findIndex(a => a.university === update.university && a.major === update.major);
      if (idx !== -1) {
        updatedApplications[idx].status = update.status;
        updatedApplications[idx].updatedAt = now;
        if (update.status === 'Rejected' && update.rejectionReason) {
          updatedApplications[idx].rejectionReason = update.rejectionReason;
        } else if (update.status !== 'Rejected') {
          delete updatedApplications[idx].rejectionReason;
        }
      }
    }

    await studentRef.update({ applications: updatedApplications, lastActivityAt: now });

    if (studentData.employeeId) {
      const employeeQuery = await adminDb!.collection('users').where('civilId', '==', studentData.employeeId).limit(1).get();
      if (!employeeQuery.empty) {
        const employeeDoc = employeeQuery.docs[0];
        const employeeData = employeeDoc.data() as User;

        const summary = buildAppSummary(updatedApplications);
        const taskContent = `Bulk status update for ${studentData.name}. ${updates.length} application(s) changed.\n\nFull Summary:\n${summary}`;

        await adminDb!.collection('tasks').add({
          authorId: 'system',
          recipientId: employeeDoc.id,
          recipientIds: [employeeDoc.id],
          content: taskContent,
          createdAt: now,
          status: 'new',
          category: 'system',
          replies: []
        });

        await triggerWhatsAppNotification('application_status_update', {
          employeeName: employeeData.name,
          studentName: studentData.name,
          messageContent: taskContent,
          dashboardUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/student/${studentId}`
        }, employeeData.phone);
      }
    }

    return { success: true, message: `Successfully updated ${updates.length} applications.` };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function deleteApplication(studentId: string, university: string, major: string, adminId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const admin = await getUser(adminId);
    if (!admin || !['admin', 'department'].includes(admin.role)) return { success: false, message: 'Unauthorized.' };

    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) return { success: false, message: 'Student not found.' };

    const studentData = studentDoc.data() as Student;
    const updatedApplications = (studentData.applications || []).filter(
      app => !(app.university === university && app.major === major)
    );

    const updates: any = {
      applications: updatedApplications,
      lastActivityAt: new Date().toISOString()
    };

    if (studentData.finalChoiceUniversity === university) {
      updates.finalChoiceUniversity = FieldValue.delete();
    }

    await studentRef.update(updates);

    return { success: true, message: 'Application deleted successfully.' };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function updateApplicationMajor(studentId: string, university: string, oldMajor: string, newMajor: string, adminId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const admin = await getUser(adminId);
    if (!admin || !['admin', 'department'].includes(admin.role)) return { success: false, message: 'Unauthorized.' };

    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) return { success: false, message: 'Student not found.' };

    const studentData = studentDoc.data() as Student;
    const appIndex = studentData.applications.findIndex(
      app => app.university === university && app.major === oldMajor
    );

    if (appIndex === -1) return { success: false, message: 'Application not found.' };

    const updatedApplications = [...studentData.applications];
    updatedApplications[appIndex].major = newMajor;
    updatedApplications[appIndex].updatedAt = new Date().toISOString();

    await studentRef.update({
      applications: updatedApplications,
      lastActivityAt: new Date().toISOString()
    });

    return { success: true, message: 'Major updated successfully.' };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function updateStudentPipelineStatus(studentId: string, status: string, userName: string, studentName: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) return { success: false, message: "Student found." };
    await studentRef.update({ pipelineStatus: status, lastActivityAt: new Date().toISOString() });
    const studentData = studentDoc.data() as Student;
    const newNote: Note = { id: `note-pipeline-${Date.now()}`, authorId: 'system', content: `Pipeline updated to '${status}' by ${userName}.`, createdAt: new Date().toISOString() };
    await studentRef.update({ adminNotes: [...(studentData.adminNotes || []), newNote] });
    return { success: true, message: 'Status updated.' };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function createStudentTask(authorId: string, studentId: string, requestTypeId: string, description: string, dynamicData?: any) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const requestTypeDoc = await adminDb!.collection('request_types').doc(requestTypeId).get();
    if (!requestTypeDoc.exists) return { success: false, message: 'Request type not found.' };
    const requestTypeData = requestTypeDoc.data() as RequestType;
    const studentDoc = await adminDb!.collection('students').doc(studentId).get();
    if (!studentDoc.exists) return { success: false, message: 'Student not found.' };
    const studentData = studentDoc.data() as Student;
    const recipientGroups: string[] = [];
    const specificUserIds: string[] = [];
    if (requestTypeData.recipients) {
      requestTypeData.recipients.forEach(r => {
        if (r.type === 'user') specificUserIds.push(r.id);
        else if (r.type === 'group') recipientGroups.push(r.id);
        else if (r.type === 'department') recipientGroups.push(`dept:${r.id}`);
      });
    }
    const creator = await getUser(authorId);
    const recipientIdsForTask = [...specificUserIds, ...recipientGroups];
    const taskRef = await adminDb!.collection('tasks').add({
      authorId, createdBy: authorId, authorName: creator?.name || 'Staff',
      recipientId: recipientIdsForTask[0] || 'all',
      recipientIds: recipientIdsForTask[0] === 'all' ? ['all'] : recipientIdsForTask,
      content: description, createdAt: new Date().toISOString(), status: 'new', category: 'request', replies: [],
      studentId, studentName: studentData.name, studentPhone: studentData.phone,
      taskType: requestTypeData.name, requestTypeId: requestTypeId,
      data: { ...(dynamicData || {}), studentName: studentData.name, studentEmail: studentData.email, studentPhone: studentData.phone, requestedBy: creator?.email, requestedByName: creator?.name }
    });
    await refreshStudentActivity(studentId);
    const usersToNotify = new Map<string, User>();
    for (const uid of specificUserIds) {
      const u = await getUser(uid);
      if (u) usersToNotify.set(u.id, u);
    }
    if (recipientGroups.includes('admins') || recipientGroups.includes('all')) {
      const adminsSnap = await adminDb!.collection('users').where('role', '==', 'admin').get();
      adminsSnap.forEach(doc => { const u = { id: doc.id, ...doc.data() } as User; usersToNotify.set(u.id, u); });
    }
    const recipientDeptGroups = recipientGroups.filter(g => g.startsWith('dept:'));
    for (const dg of recipientDeptGroups) {
      const deptName = dg.replace('dept:', '');
      const deptSnap = await adminDb!.collection('users').where('department', '==', deptName).get();
      deptSnap.forEach(doc => { const u = { id: doc.id, ...doc.data() } as User; usersToNotify.set(u.id, u); });
    }
    const notificationPromises = Array.from(usersToNotify.values()).map(recipient => {
      if (recipient.id === authorId || !recipient.phone) return Promise.resolve();
      return triggerWhatsAppNotification('new_task_assigned', { recipientName: recipient.name, staffName: creator?.name || 'Staff', taskName: requestTypeData.name, taskTitle: requestTypeData.name, taskDescription: description, studentName: studentData.name, assignedBy: creator?.name || 'Staff', taskUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/tasks` }, recipient.phone);
    });
    await Promise.all(notificationPromises);
    return { success: true, message: 'Task created.' };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function markTaskAsSeen(taskId: string, userId: string, userName: string) {
  if (!checkAdminServices()) return { success: false };
  try {
    await adminDb!.collection('tasks').doc(taskId).update({ viewedBy: FieldValue.arrayUnion({ userId, userName, timestamp: new Date().toISOString() }) });
    return { success: true };
  } catch (e) { return { success: false }; }
}

export async function markMultipleTasksAsSeen(taskIds: string[], userId: string, userName: string) {
  if (!checkAdminServices()) return { success: false };
  if (!taskIds || taskIds.length === 0) return { success: true };
  try {
    const batch = adminDb!.batch();
    const timestamp = new Date().toISOString();
    for (const id of taskIds) batch.update(adminDb!.collection('tasks').doc(id), { viewedBy: FieldValue.arrayUnion({ userId, userName, timestamp }) });
    await batch.commit();
    return { success: true };
  } catch (e: any) { return { success: false, message: e.message }; }
}

export async function sendTaskNotification(taskId: string, fromId: string, fromName: string, message: string) {
  if (!checkAdminServices()) return { success: false };
  try {
    const taskRef = adminDb!.collection('tasks').doc(taskId);
    const taskDoc = await taskRef.get();
    if (!taskDoc.exists) return { success: false, message: 'Task not found' };
    const task = taskDoc.data() as Task;
    await taskRef.update({ notifications: FieldValue.arrayUnion({ fromId, fromName, message, timestamp: new Date().toISOString() }) });
    await adminDb!.collection('tasks').add({ authorId: fromId, createdBy: fromId, recipientId: task.authorId, recipientIds: [task.authorId], content: `Update from ${fromName} on "${task.taskType}": ${message}`, status: 'new', category: 'system', createdAt: new Date().toISOString(), replies: [] });
    const recipient = await getUser(task.authorId);
    if (recipient?.phone) await triggerWhatsAppNotification('admin_update', { employeeName: recipient.name, messageContent: `Update on "${task.taskType}": ${message}`, dashboardUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/tasks` }, recipient.phone);
    return { success: true };
  } catch (e: any) { return { success: false, message: e.message }; }
}

export async function sendTask(authorId: string, recipientId: string, content: string, category: 'update' | 'system' = 'update') {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const author = await getUser(authorId);
    if (!author || !['admin', 'department'].includes(author.role)) return { success: false, message: 'Unauthorized.' };
    await adminDb!.collection('tasks').add({ authorId, createdBy: authorId, recipientId, recipientIds: [recipientId], content, createdAt: new Date().toISOString(), status: 'new', category, replies: [] });
    return { success: true, message: 'Update sent.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function addReplyToTask(taskId: string, authorId: string, content: string, taskAuthorId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const author = await getUser(authorId);
    if (!author) return { success: false, message: 'Author not found.' };
    const taskRef = adminDb!.collection('tasks').doc(taskId);
    const taskDoc = await taskRef.get();
    if (!taskDoc.exists) return { success: false, message: 'Task not found.' };
    const taskData = taskDoc.data() as Task;
    const newReply = { id: `reply-${Date.now()}`, authorId, content, createdAt: new Date().toISOString() };
    await taskRef.update({ replies: FieldValue.arrayUnion(newReply), status: 'in-progress' });
    if (taskData.authorId !== authorId) {
      await adminDb!.collection('tasks').add({ authorId: 'system', createdBy: 'system', recipientId: taskData.authorId, recipientIds: [taskData.authorId], content: `${author.name} replied to: "${taskData.taskType || 'Task'}"`, createdAt: new Date().toISOString(), status: 'new', category: 'system', replies: [] });
      const recipient = await getUser(taskData.authorId);
      if (recipient?.phone) await triggerWhatsAppNotification('task_reply_received', { employeeName: recipient.name, taskTitle: taskData.taskType || 'Task', replyAuthor: author.name, replyMessage: content, taskUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/tasks` }, recipient.phone);
    }
    return { success: true, message: 'Reply sent.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function updateTaskStatus(taskId: string, status: TaskStatus, updaterId: string, reason?: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const updater = await getUser(updaterId);
    if (!updater || !['admin', 'department'].includes(updater.role)) return { success: false, message: 'Unauthorized.' };
    const taskRef = adminDb!.collection('tasks').doc(taskId);

    const updateData: any = { status };
    if (status === 'denied' && reason) {
      updateData.denialReason = reason;
    }
    await taskRef.update(updateData);

    const taskDoc = await taskRef.get();
    const taskData = taskDoc.data() as Task;
    if (taskData.authorId !== updaterId) {
      let message = `Task "${taskData.taskType}" status updated to '${status}' by ${updater.name}.`;
      if (status === 'denied' && reason) {
        message = `Status updated to 'Denied' by ${updater.name}. Reason: ${reason}`;
      }

      await adminDb!.collection('tasks').add({ authorId: 'system', createdBy: 'system', recipientId: taskData.authorId, recipientIds: [taskData.authorId], content: message, createdAt: new Date().toISOString(), status: 'new', category: 'system', replies: [] });
      const recipient = await getUser(taskData.authorId);
      if (recipient?.phone) {
        let type: NotificationType = 'task_status_in_progress';
        if (status === 'completed') type = 'task_status_completed';
        if (status === 'denied') type = 'task_status_denied';
        await triggerWhatsAppNotification(type, { employeeName: recipient.name, taskTitle: taskData.taskType || 'Task', studentName: taskData.studentName || 'Student', taskUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/tasks` }, recipient.phone);
      }
    }
    return { success: true, message: 'Status updated.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function toggleTaskPriority(taskId: string, isPrioritized: boolean) {
  if (!checkAdminServices()) return { success: false };
  try {
    await adminDb!.collection('tasks').doc(taskId).update({ isPrioritized });
    return { success: true };
  } catch (e) { return { success: false }; }
}

export async function deleteTask(taskId: string, adminId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const admin = await getUser(adminId);
    if (!admin || admin.role !== 'admin') return { success: false, message: 'Unauthorized.' };
    await adminDb!.collection('tasks').doc(taskId).delete();
    return { success: true, message: 'Update removed from feed.' };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function createNewUser(userData: { name: string; email: string; password: string; civilId: string; phone: string; role: 'admin' | 'employee' | 'department'; department?: string; }) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const authUser = await adminAuth!.createUser({ email: userData.email, password: userData.password, displayName: userData.name, phoneNumber: userData.phone });
    const employeeId = userData.civilId.slice(-5);
    const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(userData.name)}&background=random&color=fff`;
    const newUserForDb: Omit<User, 'id'> = { name: userData.name, email: userData.email, phone: userData.phone, role: userData.role, avatarUrl, civilId: userData.civilId, employeeId: employeeId, ...(userData.department && { department: userData.department }) };
    const batch = adminDb!.batch();
    batch.set(adminDb!.collection('users').doc(authUser.uid), newUserForDb);
    if (userData.role === 'admin') batch.set(adminDb!.collection('admins').doc(authUser.uid), { role: 'admin', syncAt: new Date().toISOString(), userEmail: userData.email });
    else if (userData.role === 'department') batch.set(adminDb!.collection('departmentUsers').doc(authUser.uid), { role: 'department', syncAt: new Date().toISOString(), department: userData.department || 'UK' });
    await batch.commit();
    return { success: true, message: `${userData.name} added.` };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function createStudent(values: { studentName: string; studentEmail?: string; phone: string; internalNumber?: string; highSchoolGrade?: string; targetCountries: string[]; otherCountry?: string; notes?: string; }, creatingUserId: string, creatingUserRole: UserRole, creatingUserCivilId?: string | null, assignedEmployeeId?: string | null) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  const { studentName, studentEmail, phone, internalNumber, highSchoolGrade, targetCountries, otherCountry, notes } = values;
  let finalTargetCountries = targetCountries;
  if (otherCountry && otherCountry.trim()) finalTargetCountries = [...finalTargetCountries, otherCountry.trim()];
  try {
    const existingSnap = await adminDb!.collection('students').where('phone', '==', phone).get();
    let duplicateInfo = {};
    if (!existingSnap.empty) duplicateInfo = { duplicatePhoneWarning: true, duplicateOfStudentIds: existingSnap.docs.map(doc => doc.id) };
    const fallbackId = Math.random().toString(36).substring(2, 9);
    const idPrefix = creatingUserCivilId ? `U-${creatingUserCivilId}` : `S-${fallbackId}`;
    const studentId = `${idPrefix}-${Date.now()}`;
    const studentRef = adminDb!.collection('students').doc(studentId);
    const now = new Date().toISOString();
    await studentRef.set({ id: studentId, name: studentName, email: studentEmail || '', phone: phone, internalNumber: internalNumber || '', highSchoolGrade: highSchoolGrade || '', employeeId: assignedEmployeeId || null, applications: [], employeeNotes: [], adminNotes: notes ? [{ id: `note-${Date.now()}`, authorId: creatingUserId, content: notes, createdAt: now }] : [], documents: [], createdAt: now, lastActivityAt: now, createdBy: creatingUserId, targetCountries: finalTargetCountries as Country[], missingItems: [], pipelineStatus: 'none', isNewForEmployee: !!assignedEmployeeId, profileCompletionStatus: { submitUniversityApplication: false, applyMoheScholarship: false, submitKcoRequest: false, receivedCasOrI20: false, appliedForVisa: false, documentsSubmittedToMohe: false, readyToTravel: false, financialStatementsProvided: false, visaGranted: false, medicalFitnessSubmitted: false }, ...duplicateInfo });
    
    // Auto-post initial notes to chat if they exist
    if (notes && notes.trim()) {
      const chatMessageId = `msg-init-${Date.now()}`;
      await adminDb!.collection('chats').doc(studentId).collection('messages').doc(chatMessageId).set({
        id: chatMessageId,
        authorId: creatingUserId,
        content: `[SYSTEM] Initial Notes: ${notes.trim()}`,
        timestamp: now
      });
      // Increment unread count for employee if assigned
      if (assignedEmployeeId) {
        await studentRef.update({ employeeUnreadMessages: 1 });
      }
    }

    if (!assignedEmployeeId) {
      const adminsSnapshot = await adminDb!.collection('users').where('role', '==', 'admin').get();
      if (!adminsSnapshot.empty) {
        const batch = adminDb!.batch();
        for (const adminDoc of adminsSnapshot.docs) {
          batch.set(adminDb!.collection('tasks').doc(), { authorId: creatingUserId, createdBy: creatingUserId, recipientId: adminDoc.id, recipientIds: [adminDoc.id], content: `New student '${studentName}' added.`, status: 'new', category: 'system', studentId: studentRef.id, studentName: studentName, createdAt: new Date().toISOString(), replies: [] });
          const adminData = adminDoc.data() as User;
          await triggerWhatsAppNotification('new_student_added', { adminName: adminData.name, studentName: studentName, studentEmail: studentEmail || 'N/A', studentPhone: phone, submissionDate: new Date().toLocaleDateString(), studentUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/unassigned-students` }, adminData.phone);
        }
        await batch.commit();
      }
    }
    return { success: true, studentId: studentRef.id, studentName };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function resolveDuplicate(studentId: string, adminId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const admin = await getUser(adminId);
    if (!admin || admin.role !== 'admin') return { success: false, message: 'Unauthorized.' };
    await adminDb!.collection('students').doc(studentId).update({ duplicatePhoneWarning: false, duplicateOfStudentIds: null });
    return { success: true, message: 'Duplicate warning resolved.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function transferStudent(studentId: string, newEmployee: User, adminId: string, studentName: string, fromEmployeeName: string | null) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  if (!newEmployee.civilId) return { success: false, message: 'Employee missing Civil ID.' };
  try {
    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) return { success: false, message: 'Student not found.' };
    const studentData = studentDoc.data() as Student;
    const updates = {
      employeeId: newEmployee.civilId,
      transferRequested: false,
      transferRequest: FieldValue.delete(),
      isNewForEmployee: true,
      lastActivityAt: new Date().toISOString(),
      transferHistory: [...(studentData.transferHistory || []), { fromEmployeeId: studentData.employeeId, toEmployeeId: newEmployee.civilId, date: new Date().toISOString(), transferredBy: adminId }],
      adminNotes: [...(studentData.adminNotes || []), { id: `note-transfer-${Date.now()}`, authorId: adminId, content: `Transferred from ${fromEmployeeName || 'Unassigned'} to ${newEmployee.name}.`, createdAt: new Date().toISOString() }]
    };
    await studentRef.update(updates);
    if (newEmployee.id) {
      const admin = await getUser(adminId);
      await adminDb!.collection('tasks').add({ authorId: adminId, createdBy: adminId, recipientId: newEmployee.id, recipientIds: [newEmployee.id], content: `The student '${studentName}' has been transferred to you.`, createdAt: new Date().toISOString(), status: 'new', category: 'system', replies: [] });
      await triggerWhatsAppNotification('student_assigned', { employeeName: newEmployee.name, studentName: studentName, assignedBy: admin?.name || 'Administrator', studentUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/student/${studentId}` }, newEmployee.phone);
    }
    return { success: true, message: `Student transferred.` };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function requestTransfer(studentId: string, reason: string, requestingEmployeeId: string, studentName: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) return { success: false, message: 'Student not found.' };
    const employee = await getUser(requestingEmployeeId);
    if (!employee) return { success: false, message: 'Employee not found.' };

    const now = new Date().toISOString();
    await studentRef.update({
      transferRequested: true,
      transferRequest: {
        requestedBy: requestingEmployeeId,
        reason: reason,
        requestedAt: now
      },
      lastActivityAt: now
    });
    const studentData = studentDoc.data() as Student;
    await studentRef.update({ adminNotes: [...(studentData.adminNotes || []), { id: `note-transfer-req-${Date.now()}`, authorId: requestingEmployeeId, content: `Transfer requested: ${reason}`, createdAt: now }] });
    const adminsSnapshot = await adminDb!.collection('users').where('role', '==', 'admin').get();
    if (!adminsSnapshot.empty) {
      const batch = adminDb!.batch();
      adminsSnapshot.forEach(adminDoc => {
        batch.set(adminDb!.collection('tasks').doc(), { authorId: requestingEmployeeId, createdBy: requestingEmployeeId, recipientId: adminDoc.id, recipientIds: [adminDoc.id], content: `Transfer request for ${studentName}: ${reason}`, createdAt: now, status: 'new', category: 'request', replies: [] });
      });
      await batch.commit();
    }
    return { success: true, message: 'Transfer request submitted.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function requestStudentDeletion(studentId: string, employeeId: string, reason: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const studentRef = adminDb!.collection('students').doc(studentId);
    const employee = await getUser(employeeId);
    if (!employee) return { success: false, message: "Invalid employee." };
    await studentRef.update({ deletionRequested: { requestedBy: employeeId, reason: reason, requestedAt: new Date().toISOString(), status: 'pending' }, lastActivityAt: new Date().toISOString() });
    const adminsSnap = await adminDb!.collection('users').where('role', '==', 'admin').get();
    if (!adminsSnap.empty) {
      const studentData = (await studentRef.get()).data() as Student;
      const batch = adminDb!.batch();
      adminsSnap.forEach(adminDoc => {
        batch.set(adminDb!.collection('tasks').doc(), { authorId: employeeId, createdBy: employeeId, recipientId: adminDoc.id, recipientIds: [adminDoc.id], content: `Deletion request for ${studentData.name}: ${reason}`, status: 'new', category: 'request', createdAt: new Date().toISOString(), replies: [] });
      });
      await batch.commit();
    }
    return { success: true, message: 'Deletion request submitted.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function addEmployeeNote(studentId: string, authorId: string, content: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) return { success: false, message: 'Student not found.' };
    const author = await getUser(authorId);
    if (!author) return { success: false, message: 'Author not found.' };
    const studentData = studentDoc.data() as Student;
    if (author.role === 'employee' && author.civilId !== studentData.employeeId) return { success: false, message: 'Unauthorized.' };
    await studentRef.update({ employeeNotes: FieldValue.arrayUnion({ id: `note-${Date.now()}`, authorId, content, createdAt: new Date().toISOString() }), lastActivityAt: new Date().toISOString() });
    return { success: true, message: 'Note added.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function addAdminNote(studentId: string, authorId: string, content: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) return { success: false, message: 'Student not found.' };
    const author = await getUser(authorId);
    if (!author || !['admin', 'department'].includes(author.role)) return { success: false, message: 'Unauthorized.' };
    await studentRef.update({ adminNotes: FieldValue.arrayUnion({ id: `note-admin-${Date.now()}`, authorId, content, createdAt: new Date().toISOString() }), lastActivityAt: new Date().toISOString() });
    return { success: true, message: 'Admin note added.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function addMissingItemToStudent(studentId: string, itemText: string, userId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const user = await getUser(userId);
    if (!user) return { success: false, message: 'User not found' };

    const dept = user.role === 'admin' ? 'Admin' : (user.department || 'General');

    const newItem: MissingItem = {
      id: `mi-${Date.now()}`,
      text: itemText,
      department: dept,
      addedBy: userId,
      createdAt: new Date().toISOString()
    };

    await adminDb!.collection('students').doc(studentId).update({
      missingItems: FieldValue.arrayUnion(newItem),
      newMissingItemsForEmployee: FieldValue.increment(1),
      missingItemsViewedBy: [userId],
      lastActivityAt: new Date().toISOString()
    });
    return { success: true, message: 'Missing item added.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function removeMissingItemFromStudent(studentId: string, item: string | MissingItem) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    await adminDb!.collection('students').doc(studentId).update({ missingItems: FieldValue.arrayRemove(item), lastActivityAt: new Date().toISOString() });
    return { success: true, message: 'Missing item removed.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function markMissingItemAsReceived(studentId: string, item: string | MissingItem, userId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const itemText = typeof item === 'string' ? item : item.text;
    const itemDept = typeof item === 'string' ? 'General' : item.department;

    await adminDb!.collection('students').doc(studentId).update({
      missingItems: FieldValue.arrayRemove(item),
      adminNotes: FieldValue.arrayUnion({
        id: `note-item-received-${Date.now()}`,
        authorId: userId,
        content: `Marked as received: "${itemText}" (Required by: ${itemDept})`,
        createdAt: new Date().toISOString()
      }),
      unreadUpdates: FieldValue.increment(1),
      lastActivityAt: new Date().toISOString()
    });
    return { success: true, message: 'Item marked as received.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function addTodo(userId: string, content: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    await adminDb!.collection('users').doc(userId).collection('personal_todos').add({ userId, content, completed: false, createdAt: new Date().toISOString() });
    return { success: true, message: "To-do added." };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function toggleTodo(userId: string, todoId: string, completed: boolean) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    await adminDb!.collection('users').doc(userId).collection('personal_todos').doc(todoId).update({ completed: !completed });
    return { success: true, message: 'To-do updated.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function deleteTodo(userId: string, todoId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    await adminDb!.collection('users').doc(userId).collection('personal_todos').doc(todoId).delete();
    return { success: true, message: 'To-do deleted.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function updateChecklistItem(studentId: string, itemKey: keyof ProfileCompletionStatus, value: boolean, authorId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const studentDoc = await adminDb!.collection('students').doc(studentId).get();
    if (!studentDoc.exists) return { success: false, message: "Student found." };
    const author = await getUser(authorId);
    if (!author || author.civilId !== studentDoc.data()!.employeeId) return { success: false, message: 'Unauthorized.' };
    await adminDb!.collection('students').doc(studentId).update({ [`profileCompletionStatus.${itemKey}`]: value, lastActivityAt: new Date().toISOString() });
    return { success: true, message: 'Checklist updated.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function setStudentFinalChoice(studentId: string, university: string, major: string, updaterId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) return { success: false, message: 'Student not found.' };
    const studentData = studentDoc.data() as Student;
    const updater = await getUser(updaterId);
    if (!updater) return { success: false, message: 'Updater not found.' };
    if (updater.role === 'employee' && updater.civilId !== studentData.employeeId) {
      if (!['admin', 'department'].includes(updater.role)) return { success: false, message: 'Unauthorized.' };
    }
    await studentRef.update({
      finalChoiceUniversity: university,
      lastActivityAt: new Date().toISOString(),
      finalizedAt: new Date().toISOString(),
      finalizedViewedBy: [updaterId],
      adminNotes: FieldValue.arrayUnion({ id: `note-finalize-${Date.now()}`, authorId: updaterId, content: `${updater.name} set final choice to ${university}.`, createdAt: new Date().toISOString() })
    });
    if (updater.role === 'employee') {
      const adminsSnapshot = await adminDb!.collection('users').where('role', '==', 'admin').get();
      if (!adminsSnapshot.empty) {
        const batch = adminDb!.batch();
        for (const adminDoc of adminsSnapshot.docs) {
          batch.set(adminDb!.collection('tasks').doc(), { authorId: updaterId, createdBy: updaterId, recipientId: adminDoc.id, recipientIds: [adminDoc.id], content: `Final choice for ${studentData.name}: ${university}.`, createdAt: new Date().toISOString(), status: 'new', category: 'system', replies: [] });
        }
        await batch.commit();
      }
    }
    return { success: true, message: `Final choice set.` };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function markFinalizedAsViewed(studentIds: string[], userId: string) {
  if (!checkAdminServices()) return { success: false };
  if (!studentIds || studentIds.length === 0) return { success: true };
  try {
    const batch = adminDb!.batch();
    for (const id of studentIds) {
      batch.update(adminDb!.collection('students').doc(id), {
        finalizedViewedBy: FieldValue.arrayUnion(userId)
      });
    }
    await batch.commit();
    return { success: true };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function clearStudentFlagsForEveryone(studentId: string, userId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) return { success: false, message: 'Student not found.' };
    const studentData = studentDoc.data() as Student;
    const author = await getUser(userId);

    const updates: any = {
      unreadUpdates: 0,
      newDocumentsForAdmin: 0,
      newDocumentsForEmployee: 0,
      newMissingItemsForEmployee: 0,
      employeeUnreadMessages: 0,
      updatesViewedBy: [],
      newDocsViewedBy: [],
      missingItemsViewedBy: [],
      lastActivityAt: new Date().toISOString(),
      adminNotes: FieldValue.arrayUnion({
        id: `note-flags-cleared-${Date.now()}`,
        authorId: userId,
        content: `${author?.name || 'Staff'} cleared all notification flags for everyone.`,
        createdAt: new Date().toISOString()
      })
    };

    await studentRef.update(updates);
    return { success: true, message: 'Flags cleared for everyone.' };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function deleteStudent(studentId: string, adminId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
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
        } catch (e) { }
      }
    }
    await adminDb!.collection('chats').doc(studentId).collection('messages').get().then(s => s.forEach(d => d.ref.delete()));
    await adminDb!.collection('chats').doc(studentId).delete();
    await studentRef.delete();
    return { success: true, message: `Student deleted successfully.` };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function deleteStudentDocument(studentId: string, documentId: string, documentUrl: string, deleterId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) return { success: false, message: 'Student not found.' };
    const studentData = studentDoc.data() as Student;
    const deleter = await getUser(deleterId);
    if (!deleter) return { success: false, message: "Invalid user." };

    const isAdminOrDept = deleter.role === 'admin' || deleter.role === 'department';
    const isAssignedEmployee = deleter.role === 'employee' && deleter.civilId === studentData.employeeId;

    if (!isAdminOrDept && !isAssignedEmployee) {
      return { success: false, message: 'Unauthorized.' };
    }

    const bucket = storage!.bucket();
    const filePath = decodeURIComponent(new URL(documentUrl).pathname.split('/').slice(2).join('/'));
    if (filePath) await bucket.file(filePath).delete();
    const updatedDocs = (studentData.documents || []).filter(d => d.id !== documentId);
    await studentRef.update({ documents: updatedDocs, lastActivityAt: new Date().toISOString() });
    return { success: true, message: 'Document deleted.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function handleEmployeeLogin(userId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
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
    processInactivityReminders();
    return { success: true, message: 'Login started.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function handleEmployeeLogout(userId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const activeLogQuery = await adminDb!.collection('time_logs').where('employeeId', '==', userId).where('clockOut', '==', null).orderBy('clockIn', 'desc').limit(1).get();
    if (activeLogQuery.empty) return { success: true, message: 'No active session.' };
    await activeLogQuery.docs[0].ref.update({ clockOut: new Date().toISOString() });
    return { success: true, message: 'Session ended.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function keepAlive(userId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const activeLogQuery = await adminDb!.collection('time_logs').where('employeeId', '==', userId).where('clockOut', '==', null).orderBy('clockIn', 'desc').limit(1).get();
    if (!activeLogQuery.empty) await activeLogQuery.docs[0].ref.update({ lastSeen: new Date().toISOString() });
    return { success: true };
  } catch (error) { return { success: false, message: 'Failed.' }; }
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
  } catch (error) { return { success: false, message: 'Failed.' }; }
}

export async function closeForceInactivitySessions() {
  // legacy helper
  return { success: true };
}

export async function updateUserAvatar(userId: string, avatarUrl: string) {
  if (!checkAdminServices()) return { success: true, message: 'DB not available' };
  try {
    await adminDb!.collection('users').doc(userId).update({ avatarUrl });
    return { success: true, message: 'Avatar updated.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function getReportStats(dateRange: { from: string; to: string; }): Promise<{ success: boolean; data?: ReportStats; message?: string }> {
  if (!checkAdminServices()) return { success: false, message: "Admin services not available" };
  try {
    const interval = { start: parseISO(dateRange.from), end: parseISO(dateRange.to) };
    const [studentsSnap, usersSnap, timeLogsSnap] = await Promise.all([adminDb!.collection('students').get(), adminDb!.collection('users').get(), adminDb!.collection('time_logs').get()]);

    const allUsers = usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as User));
    const allStudentsRaw = studentsSnap.docs.map(doc => doc.data() as Student);
    const allTimeLogs = timeLogsSnap.docs.map(doc => doc.data() as TimeLog);

    // Exclusion logic: Filter out students assigned to deleted employee IDs (Ghost students)
    const validCivilIds = new Set(allUsers.map(u => u.civilId).filter(Boolean));
    const validUserIds = new Set(allUsers.map(u => u.id));
    const allStudents = allStudentsRaw.filter(s => {
      if (!s.employeeId) return true; // Unassigned is valid
      return validCivilIds.has(s.employeeId) || validUserIds.has(s.employeeId);
    });

    const studentsInRange = allStudents.filter(s => s.createdAt && isWithinInterval(parseISO(s.createdAt), interval));
    const appsInRange = allStudents.flatMap(s => s.applications || []).filter(app => app.updatedAt && isWithinInterval(parseISO(app.updatedAt), interval));

    const stats: ReportStats = {
      totalStudents: allStudents.length,
      totalApplications: allStudents.reduce((acc, s) => acc + (s.applications?.length || 0), 0),
      totalEmployees: allUsers.filter(u => u.role === 'employee').length,
      applicationStatusData: Object.entries(appsInRange.reduce((acc, app) => { acc[app.status] = (acc[app.status] || 0) + (1); return acc; }, {} as Record<string, number>)).map(([name, count]) => ({ name, count })),
      studentEmployeeData: Object.entries(allStudents.reduce((acc, s) => { const name = s.employeeId ? allUsers.find(u => u.civilId === s.employeeId)?.name || 'Unassigned' : 'Unassigned'; acc[name] = (acc[name] || 0) + (s.applications?.length || 0); return acc; }, {} as Record<string, number>)).map(([name, count]) => ({ name, count })),
      studentGrowthData: Object.entries(studentsInRange.reduce((acc, s) => { const d = format(parseISO(s.createdAt), 'yyyy-MM-dd'); acc[d] = (acc[d] || 0) + 1; return acc; }, {} as Record<string, number>)).map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date)),
      applicationCountryData: Object.entries(appsInRange.reduce((acc, app) => { acc[app.country] = (acc[app.country] || 0) + (1); return acc; }, {} as Record<string, number>)).map(([name, count]) => ({ name, count })),
      employeeHoursData: Object.entries(allTimeLogs.filter(log => log.clockOut && isWithinInterval(parseISO(log.date), interval)).reduce((acc, log) => { const user = allUsers.find(u => u.id === log.employeeId); if (user) acc[user.name] = (acc[user.name] || 0) + (differenceInMinutes(parseISO(log.clockOut!), parseISO(log.clockIn)) / 60); return acc; }, {} as Record<string, number>)).map(([name, hours]) => ({ name, hours: parseFloat(hours.toFixed(1)) }))
    };
    return scrub({ success: true, data: stats });
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function getEmployeeStudentStats(): Promise<{ success: boolean; data?: EmployeeStats[]; message?: string; }> {
  if (!checkAdminServices()) return { success: false, message: "Server not available" };
  try {
    const employees = (await adminDb!.collection('users').where('role', '==', 'employee').get()).docs.map(doc => ({ id: doc.id, ...doc.data() } as User));
    const allStudents = (await adminDb!.collection('students').get()).docs.map(doc => doc.data() as Student);
    const thirtyDaysAgo = startOfDay(subDays(new Date(), 30));

    const stats: EmployeeStats[] = employees.map(employee => {
      // Creation stats
      const created = allStudents.filter(s => s.createdBy === employee.id);
      const dailyCountsMap: Record<string, number> = {};
      const monthlyMap: Record<string, number> = {};

      created.forEach(s => {
        const d = parseISO(s.createdAt);
        monthlyMap[format(d, 'yyyy-MM')] = (monthlyMap[format(d, 'yyyy-MM')] || 0) + 1;
        if (d >= thirtyDaysAgo) dailyCountsMap[format(d, 'yyyy-MM-dd')] = (dailyCountsMap[format(d, 'yyyy-MM-dd')] || 0) + 1;
      });

      // Pipeline breakdown based on ASSIGNED portfolio
      const assigned = allStudents.filter(s => s.employeeId === employee.civilId);
      const pipelineBreakdown = {
        green: assigned.filter(s => s.pipelineStatus === 'green').length,
        orange: assigned.filter(s => s.pipelineStatus === 'orange').length,
        red: assigned.filter(s => s.pipelineStatus === 'red').length,
        none: assigned.filter(s => !s.pipelineStatus || s.pipelineStatus === 'none').length,
      };

      return {
        employeeId: employee.id,
        employeeName: employee.name,
        totalStudents: created.length,
        dailyCounts: Array.from({ length: 30 }, (_, i) => format(subDays(new Date(), i), 'yyyy-MM-dd')).map(date => ({ date, count: dailyCountsMap[date] || 0 })).sort((a, b) => a.date.localeCompare(b.date)),
        monthlyTotals: Object.entries(monthlyMap).map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month)),
        pipelineBreakdown
      };
    });

    return scrub({ success: true, data: stats });
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function updateStudentIELTS(studentId: string, overallScore: number, authorId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const studentRef = adminDb!.collection('students').doc(studentId);
    await studentRef.update({ ieltsOverall: overallScore, lastActivityAt: new Date().toISOString(), adminNotes: FieldValue.arrayUnion({ id: `note-ielts-${Date.now()}`, authorId, content: `IELTS updated to ${overallScore.toFixed(1)}.`, createdAt: new Date().toISOString() }) });
    return { success: true, message: 'IELTS updated.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function updateStudentGrade(studentId: string, grade: string, authorId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const studentRef = adminDb!.collection('students').doc(studentId);
    await studentRef.update({ highSchoolGrade: grade, lastActivityAt: new Date().toISOString(), adminNotes: FieldValue.arrayUnion({ id: `note-grade-${Date.now()}`, authorId, content: `High School Grade/GPA updated to: ${grade}`, createdAt: new Date().toISOString() }) });
    return { success: true, message: 'Grade updated.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function createStudentLogin(studentId: string, description: string, username: string, password: string, notes: string | undefined, createdByUserId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    await adminDb!.collection('students').doc(studentId).update({ studentLogins: FieldValue.arrayUnion({ id: `login-${Date.now()}`, username, password, description, notes, createdAt: new Date().toISOString() }), lastActivityAt: new Date().toISOString() });
    return { success: true, message: 'Reference created.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function deleteStudentLogin(studentId: string, idToDelete: string, deletedByUserId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    const updatedLogins = (studentDoc.data()?.studentLogins || []).filter((l: any) => l.id !== idToDelete);
    await studentRef.update({ studentLogins: updatedLogins, lastActivityAt: new Date().toISOString() });
    return { success: true, message: 'Deleted.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function updateStudentTargetCountries(studentId: string, countries: string[], authorId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    await adminDb!.collection('students').doc(studentId).update({ targetCountries: countries, lastActivityAt: new Date().toISOString(), adminNotes: FieldValue.arrayUnion({ id: `note-target-${Date.now()}`, authorId, content: `Target countries: ${countries.join(', ')}`, createdAt: new Date().toISOString() }) });
    return { success: true, message: 'Updated.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function updateStudentAcademicIntake(studentId: string, semester: string, year: number, authorId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    await adminDb!.collection('students').doc(studentId).update({ academicIntakeSemester: semester, academicIntakeYear: year, lastActivityAt: new Date().toISOString(), adminNotes: FieldValue.arrayUnion({ id: `note-intake-${Date.now()}`, authorId, content: `Intake: ${semester} ${year}`, createdAt: new Date().toISOString() }) });
    return { success: true, message: 'Updated.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function seedAcademicTerms(authorId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const terms = ['FALL (8/9) 2025', 'SPRING (1/2) 2026', 'MARCH (3) 2026', 'SUMMER (6/7) 2026'];
    const batch = adminDb!.batch();
    for (const name of terms) batch.set(adminDb!.collection('academic_terms').doc(), { name, authorId, createdAt: new Date().toISOString() });
    await batch.commit();
    return { success: true, message: 'Defaults restored.' };
  } catch (e: any) { return { success: false, message: e.message }; }
}

export async function addAcademicTerm(name: string, authorId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    await adminDb!.collection('academic_terms').add({ name, authorId, createdAt: new Date().toISOString() });
    return { success: true, message: 'Term added.' };
  } catch (e: any) { return { success: false, message: e.message }; }
}

export async function deleteAcademicTerm(termId: string, userId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const user = await getUser(userId);
    if (!user || user.role !== 'admin') return { success: false, message: 'Unauthorized.' };
    await adminDb!.collection('academic_terms').doc(termId).delete();
    return { success: true };
  } catch (e: any) { return { success: false, message: e.message }; }
}

export async function updateStudentTerm(studentId: string, term: string, authorId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    await adminDb!.collection('students').doc(studentId).update({ term, lastActivityAt: new Date().toISOString() });
    await addAdminNote(studentId, authorId, `Academic intake updated to: ${term}`);
    return { success: true };
  } catch (e: any) { return { success: false, message: e.message }; }
}

export async function sendChatMessage(studentId: string, authorId: string, content: string, recipientId?: string, documentPayload?: { name: string; url: string }) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const author = await getUser(authorId);
    if (!author) return { success: false, message: 'Author not found.' };
    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) return { success: false, message: 'Student not found.' };
    const studentData = studentDoc.data() as Student;
    const now = new Date().toISOString();

    // 1. Add the message to the subcollection
    await adminDb!.collection('chats').doc(studentId).collection('messages').add({
      authorId,
      content,
      timestamp: now,
      ...(documentPayload && { document: documentPayload })
    });

    // 2. Update metadata for SMS-style sorting
    const authorRole = author.role;
    const nowISO = new Date().toISOString();
    const updates: any = {
      lastActivityAt: nowISO,
      lastChatMessageText: content || (documentPayload ? `Shared file: ${documentPayload.name}` : 'Sent a file'),
      lastChatMessageTimestamp: nowISO,
      // Mark as viewed by the author automatically
      updatesViewedBy: [author.id]
    };

    // Calculate who should see this as an UNREAD message (internal flags)
    // Rule: Mentions or Role defaults
    const isAdminAuthor = authorRole === 'admin';
    const isDeptAuthor = authorRole === 'department';
    const isEmployeeAuthor = authorRole === 'employee';

    // Target users for notifications and unread counts
    let targetUserIds: string[] = [];
    let targetGroups: ('admins' | 'departments' | 'all')[] = [];

    if (recipientId) {
      if (recipientId === 'admins') targetGroups.push('admins');
      else if (recipientId === 'departments') targetGroups.push('departments');
      else targetUserIds.push(recipientId);
    } else {
      // DEFAULT RULES (No explicit recipient/mention)
      if (isAdminAuthor) {
        // Admin sends: Only notify employee
        if (studentData.employeeId) {
          // We'll resolve civilId to userId later
        }
      } else if (isDeptAuthor || isEmployeeAuthor) {
        // Dept or Employee sends: Notify all relevant parties
        targetGroups.push('all');
      }
    }

    // Resolve specific target users (e.g. employeeId from student profile if admin sent no mention)
    if (!recipientId && isAdminAuthor && studentData.employeeId) {
      const empQuery = await adminDb!.collection('users').where('civilId', '==', studentData.employeeId).limit(1).get();
      if (!empQuery.empty) targetUserIds.push(empQuery.docs[0].id);
    }

    // Update unread counts
    if (isAdminAuthor || isDeptAuthor) {
      // Management sends: Mark as unread for the employee (if they are a target)
      // If it's a specific mention to another admin/dept, maybe employee shouldn't see it?
      // But user said: "department user message will show to all they do not have to mention employee"
      // And for admin: "only send it to the assend employee and not the department"

      if (targetUserIds.length > 0 || targetGroups.includes('all')) {
        // Check if employee is in specific targets or 'all'
        updates.employeeUnreadMessages = (studentData.employeeUnreadMessages || 0) + 1;
      }
    } else {
      // Employee sends: Mark as unread for the management side
      updates.unreadUpdates = (studentData.unreadUpdates || 0) + 1;
    }

    await studentRef.update(updates);

    // 3. Trigger Targeted WhatsApp Notifications
    const relevantDepts = getDepartmentsForStudent(studentData);
    const staffSnap = await adminDb!.collection('users').get(); // Fetching once (can be optimized if many users)

    // Management users Map for easy access
    const allUsers: User[] = staffSnap.docs.map(d => ({ id: d.id, ...d.data() } as User));

    for (const staff of allUsers) {
      if (staff.id === author.id) continue;
      if (!staff.phone) continue;

      let shouldNotify = false;

      // Check explicit ID target
      if (targetUserIds.includes(staff.id)) shouldNotify = true;

      // Check group targets
      if (targetGroups.includes('all')) {
        if (staff.role === 'admin') shouldNotify = true;
        if (staff.role === 'department' && staff.department && relevantDepts.includes(staff.department)) shouldNotify = true;
        // Also notify employee if they belong to this student
        if (staff.role === 'employee' && staff.civilId === studentData.employeeId) shouldNotify = true;
      }

      if (targetGroups.includes('admins') && staff.role === 'admin') shouldNotify = true;

      if (targetGroups.includes('departments')) {
        if (staff.role === 'department' && staff.department && relevantDepts.includes(staff.department)) shouldNotify = true;
      }

      if (isAdminAuthor && !recipientId) {
        // Only notify employee
        if (staff.role === 'employee' && staff.civilId === studentData.employeeId) shouldNotify = true;
      }

      if (shouldNotify) {
        await triggerWhatsAppNotification('admin_update', {
          employeeName: staff.name,
          studentName: studentData.name,
          messageContent: `${author.name} sent a message for ${studentData.name}: ${content.substring(0, 50)}...`,
          dashboardUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/student/${studentId}`
        }, staff.phone);
      }
    }
    return { success: true };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function triggerDocumentUploadNotification(studentId: string, documentName: string, authorId: string) {
  if (!checkAdminServices()) return;
  try {
    const author = await getUser(authorId);
    if (!author) return;
    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) return;
    const studentData = studentDoc.data() as Student;
    const isAdminDept = ['admin', 'department'].includes(author.role);

    if (isAdminDept) {
      if (studentData.employeeId) {
        const employeeQuery = await adminDb!.collection('users').where('civilId', '==', studentData.employeeId).limit(1).get();
        if (!employeeQuery.empty) {
          const emp = employeeQuery.docs[0].data() as User;
          await triggerWhatsAppNotification('document_uploaded_admin', { employeeName: emp.name, studentName: studentData.name, documentName: documentName, uploadedBy: author.name, studentUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/student/${studentId}` }, emp.phone);
        }
      }
    } else {
      // Precision Routing: Notify admins and matching departments
      const relevantDepts = getDepartmentsForStudent(studentData);
      const staffSnap = await adminDb!.collection('users').where('role', 'in', ['admin', 'department']).get();

      for (const staffDoc of staffSnap.docs) {
        const staffData = staffDoc.data() as User;
        const isTargetDept = staffData.role === 'department' && staffData.department && relevantDepts.includes(staffData.department);

        if (staffData.role === 'admin' || isTargetDept) {
          if (staffData.phone) {
            await triggerWhatsAppNotification('document_uploaded_employee', {
              adminName: staffData.name,
              studentName: studentData.name,
              documentName: documentName,
              employeeName: author.name,
              uploadedBy: author.name,
              studentUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/student/${studentId}`
            }, staffData.phone);
          }
        }
      }
    }
  } catch (e) { console.error('Notification failed:', e); }
}

export async function toggleChangeAgentStatus(studentId: string, status: boolean, adminId: string, universities?: string[]) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const admin = await getUser(adminId);
    if (!admin || !['admin', 'department'].includes(admin.role)) return { success: false, message: 'Unauthorized.' };
    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) return { success: false, message: 'Student not found.' };
    const studentData = studentDoc.data() as Student;
    const studentName = studentData.name || 'A student';

    const updates: any = {
      changeAgentRequired: status,
      lastActivityAt: new Date().toISOString()
    };

    if (status) {
      updates.changeAgentUniversities = universities || [];
    } else {
      updates.changeAgentUniversities = FieldValue.delete();
    }

    await studentRef.update(updates);

    if (status) {
      // 1. Identify relevant countries and departments based on selected schools
      const selectedApps = studentData.applications?.filter(app => universities?.includes(app.university)) || [];
      const countries = [...new Set(selectedApps.map(app => app.country))];

      const targetDepts: string[] = [];
      if (countries.includes('UK')) targetDepts.push('UK');
      if (countries.includes('USA')) targetDepts.push('USA');
      if (countries.includes('Australia') || countries.includes('New Zealand')) targetDepts.push('AU/NZ');

      const schoolsDetails = selectedApps.map(app => `${app.university} (${app.country})`).join(', ');
      const uniString = universities && universities.length > 0 ? ` (${universities.join(', ')})` : '';
      const taskContent = `🚨 URGENT: Change Agent status for ${studentName}${uniString}. Schools: ${schoolsDetails}`;
      const studentUrl = `${process.env.NEXT_PUBLIC_APP_URL || ''}/student/${studentId}`;

      // 2. Notify Assigned Employee
      if (studentData.employeeId) {
        const employeeQuery = await adminDb!.collection('users').where('civilId', '==', studentData.employeeId).limit(1).get();
        if (!employeeQuery.empty) {
          const employeeDoc = employeeQuery.docs[0];
          const employeeData = employeeDoc.data() as User;
          await adminDb!.collection('tasks').add({ authorId: adminId, createdBy: adminId, recipientId: employeeDoc.id, recipientIds: [employeeDoc.id], content: taskContent, createdAt: new Date().toISOString(), status: 'new', category: 'system', replies: [] });
          if (employeeData.phone) await triggerWhatsAppNotification('change_agent_enabled', { userName: employeeData.name, studentName: studentName, employeeName: employeeData.name, messageContent: taskContent, studentUrl: studentUrl }, employeeData.phone);
        }
      }

      // 3. Notify Admins and Targeted Departments
      const staffSnap = await adminDb!.collection('users').get();
      const assignedEmployeeSnap = studentData.employeeId ? await adminDb!.collection('users').where('civilId', '==', studentData.employeeId).limit(1).get() : null;
      const assignedEmployeeName = assignedEmployeeSnap && !assignedEmployeeSnap.empty ? assignedEmployeeSnap.docs[0].data().name : 'Unassigned';

      for (const staffDoc of staffSnap.docs) {
        const staff = { id: staffDoc.id, ...staffDoc.data() } as User;
        if (staff.id === adminId) continue;
        if (!staff.phone) continue;

        let shouldNotify = false;
        if (staff.role === 'admin') shouldNotify = true;
        if (staff.role === 'department' && staff.department && targetDepts.includes(staff.department)) shouldNotify = true;

        if (shouldNotify) {
          const waContent = `VERY URGENT CHANGE AGENT
!!!! Please Notice That this student have a Urgent Change Agent case , ${studentName}

please follow up ,

The assigned employee is ${assignedEmployeeName}

The student have a change agent in these schools :
${universities?.join(', ') || 'N/A'}

which are in the following country ${countries.join(', ') || 'N/A'}

please contact the need people , to follow the information ,
VERY URGENT CHANGE AGENT
VERY URGENT CHANGE AGENT
Please Replay with " OKAY "`;

          await triggerWhatsAppNotification('change_agent_enabled', {
            userName: staff.name,
            studentName: studentName,
            employeeName: assignedEmployeeName,
            messageContent: waContent,
            studentUrl: studentUrl
          }, staff.phone);
        }
      }
    }
    return { success: true, message: status ? 'Enabled.' : 'Removed.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function submitInactivityReport(studentId: string, employeeId: string, reportContent: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const studentRef = adminDb!.collection('students').doc(studentId);
    const now = new Date().toISOString();

    // 1. Send to chat (Primary source now)
    await sendChatMessage(studentId, employeeId, `@Admins: Inactivity Report: ${reportContent}`);

    // 2. Update activity timestamp so the alert clears
    // Note: We deliberately exclude statusNote and employeeNotes updates here per user request
    await studentRef.update({
      lastActivityAt: now,
    });

    return { success: true, message: 'Report submitted.' };
  } catch (e: any) { return { success: false, message: e.message }; }
}

export async function processInactivityReminders() {
  if (!checkAdminServices()) return { success: false };

  try {
    const now = new Date();
    const cooldownRef = adminDb!.collection('system_metadata').doc('inactivity_check');
    const cooldownDoc = await cooldownRef.get();

    if (cooldownDoc.exists) {
      const lastRunAt = cooldownDoc.data()?.lastRunAt;
      if (lastRunAt && differenceInMinutes(now, parseISO(lastRunAt)) < 60) {
        return { success: true, message: 'Scan skipped: Cooldown active.' };
      }
    }

    await cooldownRef.set({ lastRunAt: now.toISOString() }, { merge: true });

    const tenDaysAgo = subDays(new Date(), 10).toISOString();
    const snapshot = await adminDb!.collection('students').where('lastActivityAt', '<', tenDaysAgo).get();

    if (snapshot.empty) return { success: true };

    for (const doc of snapshot.docs) {
      const student = doc.data() as Student;
      if (student.changeAgentRequired || student.profileCompletionStatus?.readyToTravel || !student.employeeId) continue;

      const reminderContent = "Please contact the student, and give me a report why there is no activities\n\nتواصل مع الطالب و عطني تقرير عن الطالب ليش ماكو اي شي يديد عنه ؟";
      await adminDb!.collection('chats').doc(doc.id).collection('messages').add({ authorId: 'system', content: reminderContent, timestamp: new Date().toISOString() });
      await doc.ref.update({ lastInactivityReminderSentAt: new Date().toISOString(), employeeUnreadMessages: (student.employeeUnreadMessages || 0) + 1, unreadUpdates: (student.unreadUpdates || 0) + 1 });

      const employeeQuery = await adminDb!.collection('users').where('civilId', '==', student.employeeId).limit(1).get();
      if (!employeeQuery.empty) {
        const emp = employeeQuery.docs[0].data() as User;
        await triggerWhatsAppNotification('inactivity_reminder', { employeeName: emp.name, studentName: student.name, dashboardUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/student/${doc.id}` }, emp.phone);
      }
    }
    return { success: true };
  } catch (e: any) { return { success: false, message: e.message }; }
}

export async function forceInactivity(studentId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const elevenDaysAgo = subDays(new Date(), 11).toISOString();
    await adminDb!.collection('students').doc(studentId).update({ lastActivityAt: elevenDaysAgo, createdAt: elevenDaysAgo, changeAgentRequired: false, pipelineStatus: 'none', lastInactivityReminderSentAt: null, 'profileCompletionStatus.readyToTravel': false });
    return { success: true, message: 'Forced inactivity state.' };
  } catch (e: any) { return { success: false, message: e.message }; }
}

export async function deleteUniversity(id: string, adminId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const admin = await getUser(adminId);
    if (!admin || !['admin', 'department'].includes(admin.role)) return { success: false, message: 'Unauthorized.' };
    await adminDb!.collection('approved_universities').doc(id).delete();
    return { success: true, message: 'Deleted.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function bulkTransferStudents(fromEmployeeId: string, toEmployeeId: string, adminId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const admin = await getUser(adminId);
    if (!admin || admin.role !== 'admin') return { success: false, message: 'Unauthorized.' };
    const fromUser = await getUser(fromEmployeeId);
    const toUser = await getUser(toEmployeeId);
    if (!fromUser || !toUser || !toUser.civilId) return { success: false, message: 'Invalid employees.' };

    const now = new Date().toISOString();
    const batch = adminDb!.batch();
    const studentIds: string[] = [];

    const assignedSnap = await adminDb!.collection('students').where('employeeId', '==', fromUser.civilId).get();
    const assignedLegacySnap = await adminDb!.collection('students').where('employeeId', '==', fromUser.id).get();
    const leadsSnap = await adminDb!.collection('students').where('employeeId', '==', null).where('createdBy', '==', fromUser.id).get();

    const allRelevantDocs = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    assignedSnap.docs.forEach(d => allRelevantDocs.set(d.id, d));
    assignedLegacySnap.docs.forEach(d => allRelevantDocs.set(d.id, d));
    leadsSnap.docs.forEach(d => allRelevantDocs.set(d.id, d));

    if (allRelevantDocs.size === 0) return { success: true, message: 'No students to transfer.' };

    allRelevantDocs.forEach((doc, id) => {
      const data = doc.data() as Student;
      studentIds.push(id);
      batch.update(doc.ref, {
        employeeId: toUser.civilId,
        transferHistory: [...(data.transferHistory || []), { fromEmployeeId: data.employeeId || null, toEmployeeId: toUser.civilId, date: now, transferredBy: adminId }],
        adminNotes: [...(data.adminNotes || []), { id: `note-bulk-${Date.now()}`, authorId: adminId, content: `Bulk transfer from ${fromUser.name} to ${toUser.name}.`, createdAt: now }],
        lastActivityAt: now,
        isNewForEmployee: true
      });
    });

    await batch.commit();
    return scrub({ success: true, message: `Transferred ${allRelevantDocs.size} students.`, studentIds, toEmployeeName: toUser.name, toEmployeePhone: toUser.phone });
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function addEvent(authorId: string, title: string, description: string, date: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const docRef = await adminDb!.collection('upcoming_events').add({ authorId, title, description, date, createdAt: new Date().toISOString() });
    return { success: true, message: 'Event added.', id: docRef.id };
  } catch (e: any) { return { success: false, message: e.message }; }
}

export async function deleteEvent(eventId: string, adminId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const admin = await getUser(adminId);
    if (!admin || !['admin', 'department'].includes(admin.role)) return { success: false, message: 'Unauthorized.' };
    await adminDb!.collection('upcoming_events').doc(eventId).delete();
    return { success: true, message: 'Event deleted.' };
  } catch (e: any) { return { success: false, message: e.message }; }
}

export async function getFullSystemBackup(adminId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const admin = await getUser(adminId);
    if (!admin || admin.role !== 'admin') return { success: false, message: 'Unauthorized access.' };
    const collections = ['users', 'students', 'tasks', 'approved_universities', 'request_types', 'notification_templates', 'upcoming_events'];
    const backupData: Record<string, any[]> = {};
    for (const col of collections) {
      const snap = await adminDb!.collection(col).get();
      backupData[col] = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }
    return scrub({ success: true, data: backupData, filename: `UniApply_Hub_Backup_${format(new Date(), 'yyyy-MM-dd')}.json` });
  } catch (e: any) { return { success: false, message: e.message }; }
}

export async function createInvoice(adminId: string, data: any) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const admin = await getUser(adminId);
    if (!admin || admin.role !== 'admin') return { success: false, message: 'Unauthorized.' };
    const now = new Date().toISOString();
    const counterRef = adminDb!.collection('system_metadata').doc('invoice_counter');
    const result = await adminDb!.runTransaction(async (transaction) => {
      const counterDoc = await transaction.get(counterRef);
      let nextNumber = 1001;
      if (counterDoc.exists) nextNumber = (counterDoc.data()?.lastNumber || 1000) + 1;
      const invoiceNumber = `INV-${nextNumber}`;
      const invoiceRef = adminDb!.collection('invoices').doc();
      transaction.set(invoiceRef, { ...data, invoiceNumber, createdAt: now, updatedAt: now, createdBy: adminId, authorName: admin.name });
      transaction.set(counterRef, { lastNumber: nextNumber }, { merge: true });
      return { id: invoiceRef.id, invoiceNumber };
    });
    if (data.studentId) await refreshStudentActivity(data.studentId);
    return { success: true, id: result.id, message: `Invoice ${result.invoiceNumber} created.` };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function updateInvoice(adminId: string, invoiceId: string, data: any) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const admin = await getUser(adminId);
    if (!admin || admin.role !== 'admin') return { success: false, message: 'Unauthorized.' };
    await adminDb!.collection('invoices').doc(invoiceId).update({ ...data, updatedAt: new Date().toISOString() });
    return { success: true, message: 'Invoice updated.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function updateInvoiceStatus(invoiceId: string, status: InvoiceStatus, adminId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const admin = await getUser(adminId);
    if (!admin || admin.role !== 'admin') return { success: false, message: 'Unauthorized.' };
    await adminDb!.collection('invoices').doc(invoiceId).update({ status, updatedAt: new Date().toISOString() });
    return { success: true, message: 'Status updated.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function deleteInvoice(invoiceId: string, adminId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const admin = await getUser(adminId);
    if (!admin || admin.role !== 'admin') return { success: false, message: 'Unauthorized.' };
    await adminDb!.collection('invoices').doc(invoiceId).delete();
    return { success: true, message: 'Invoice deleted.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function saveInvoiceTemplate(adminId: string, data: any, id?: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const admin = await getUser(adminId);
    if (!admin || admin.role !== 'admin') return { success: false, message: 'Unauthorized.' };
    const now = new Date().toISOString();
    if (id) await adminDb!.collection('invoice_templates').doc(id).update({ ...data, updatedAt: now });
    else await adminDb!.collection('invoice_templates').add({ ...data, createdAt: now, updatedAt: now });
    return { success: true, message: 'Template saved.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function deleteInvoiceTemplate(adminId: string, templateId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const admin = await getUser(adminId);
    if (!admin || admin.role !== 'admin') return { success: false, message: 'Unauthorized.' };
    await adminDb!.collection('invoice_templates').doc(templateId).delete();
    return { success: true, message: 'Template deleted.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function saveInvoiceSavedItem(adminId: string, data: any, id?: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const admin = await getUser(adminId);
    if (!admin || admin.role !== 'admin') return { success: false, message: 'Unauthorized.' };
    const now = new Date().toISOString();
    if (id) await adminDb!.collection('invoice_saved_items').doc(id).update({ ...data, updatedAt: now });
    else await adminDb!.collection('invoice_saved_items').add({ ...data, createdAt: now, updatedAt: now });
    return { success: true, message: 'Item saved.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function deleteInvoiceSavedItem(adminId: string, itemId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const admin = await getUser(adminId);
    if (!admin || admin.role !== 'admin') return { success: false, message: 'Unauthorized.' };
    await adminDb!.collection('invoice_saved_items').doc(itemId).delete();
    return { success: true, message: 'Item deleted.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function updateResourceLink(adminId: string, linkId: string, data: Partial<ResourceLink>) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const admin = await getUser(adminId);
    if (!admin || !['admin', 'department'].includes(admin.role)) return { success: false, message: 'Unauthorized.' };
    await adminDb!.collection('resource_links').doc(linkId).update(data);
    return { success: true, message: 'Link updated.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function updateSharedDocument(adminId: string, docId: string, data: Partial<SharedDocument>) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const admin = await getUser(adminId);
    if (!admin || !['admin', 'department'].includes(admin.role)) return { success: false, message: 'Unauthorized.' };
    await adminDb!.collection('shared_documents').doc(docId).update(data);
    return { success: true, message: 'Document updated successfully.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function bulkAssignStudents(studentIds: string[], targetCivilId: string, requesterId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const admin = await getUser(requesterId);
    if (!admin || !['admin', 'department'].includes(admin.role)) return { success: false, message: 'Unauthorized' };

    const employeeQuery = await adminDb!.collection('users').where('civilId', '==', targetCivilId).limit(1).get();
    if (employeeQuery.empty) return { success: false, message: 'Employee not found' };
    const employeeDoc = employeeQuery.docs[0];
    const employeeData = employeeDoc.data() as User;

    const batch = adminDb!.batch();
    const now = new Date().toISOString();

    for (const studentId of studentIds) {
      batch.update(adminDb!.collection('students').doc(studentId), {
        employeeId: targetCivilId,
        isNewForEmployee: true,
        lastActivityAt: now
      });
    }

    // Add a summary task for the employee
    await adminDb!.collection('tasks').add({
      authorId: requesterId,
      createdBy: requesterId,
      recipientId: employeeDoc.id,
      recipientIds: [employeeDoc.id],
      content: `Bulk Assignment: You have been assigned ${studentIds.length} new students.`,
      createdAt: now,
      status: 'new',
      category: 'system',
      replies: []
    });

    if (employeeData.phone) {
        await triggerWhatsAppNotification('admin_update', { 
          employeeName: employeeData.name, 
          messageContent: `Management has bulk-assigned ${studentIds.length} new students to your portfolio.`, 
          dashboardUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/applicants` 
        }, employeeData.phone);
    }

    await batch.commit();
    return { success: true, message: `Assigned ${studentIds.length} students to ${employeeData.name}` };
  } catch (error: any) { return { success: false, message: error.message }; }
}
