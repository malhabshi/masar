'use server';

import { adminDb, adminAuth, storage } from '@/lib/firebase/admin';
import { formatKuwaitTime } from '@/lib/timestamp-utils';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import type { User, Student, Application, ApplicationStatus, Task, Note, TaskStatus, Country, UserRole, ChecklistConfigItem, TimeLog, ReportStats, UpcomingEvent, EmployeeStats, Document as StudentDoc, StudentLogin, RequestType, NotificationTemplate, NotificationType, Invoice, InvoiceStatus, InvoiceTemplate, InvoiceSavedItem, ResourceLink, SharedDocument, MissingItem, Reminder, ChangeAgentLogEntry } from './types';
import {
  isWithinInterval,
  parseISO,
  format,
  differenceInMinutes,
  differenceInHours,
  subMinutes,
  addMinutes,
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
        await triggerWhatsAppNotification('application_status_update', { 
          employeeName: employeeData.name, 
          studentName: studentName,
          messageContent: taskContent, 
          studentUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/student/${studentId}` 
        }, employeeData.phone);
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
    
    // Sync to Student Admin Notes for permanent archival
    if (task.studentId) {
      try {
        const studentRef = adminDb!.collection('students').doc(task.studentId);
        const studentDoc = await studentRef.get();
        if (studentDoc.exists) {
          const studentData = studentDoc.data() as Student;
          const noteLabel = task.taskType || 'Task';
          await studentRef.update({
            adminNotes: [...(studentData.adminNotes || []), {
              id: `note-task-notif-${Date.now()}`,
              authorId: fromId,
              content: `[Task Notification - ${noteLabel}] ${message}`,
              createdAt: new Date().toISOString()
            }]
          });
        }
      } catch (err) { console.error("Sync error:", err); }
    }

    await adminDb!.collection('tasks').add({ authorId: fromId, createdBy: fromId, recipientId: task.authorId, recipientIds: [task.authorId], content: `Update from ${fromName} on "${task.taskType}": ${message}`, status: 'new', category: 'system', createdAt: new Date().toISOString(), replies: [] });
    const recipient = await getUser(task.authorId);
    if (recipient?.phone) await triggerWhatsAppNotification('task_reply_received', { 
      userName: recipient.name,
      employeeName: recipient.name, 
      taskTitle: task.taskType || 'Task',
      replyAuthor: fromName,
      replyMessage: message, 
      taskUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/tasks` 
    }, recipient.phone);
    return { success: true };
  } catch (e: any) { return { success: false, message: e.message }; }
}

export async function sendTask(authorId: string, recipientId: string, content: string, category: 'update' | 'system' = 'update') {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const author = await getUser(authorId);
    if (!author || !['admin', 'department'].includes(author.role)) return { success: false, message: 'Unauthorized.' };
    
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

    // Notify recipients via WhatsApp
    if (recipientId === 'all') {
      const staffSnap = await adminDb!.collection('users').where('role', 'in', ['employee', 'department']).get();
      for (const doc of staffSnap.docs) {
        const staff = doc.data() as User;
        if (staff.phone) {
          await triggerWhatsAppNotification('admin_update', {
            userName: staff.name,
            employeeName: staff.name,
            messageContent: content,
            dashboardUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/dashboard`
          }, staff.phone);
        }
      }
    } else {
      const staff = await getUser(recipientId);
      if (staff?.phone) {
        await triggerWhatsAppNotification('admin_update', {
          userName: staff.name,
          employeeName: staff.name,
          messageContent: content,
          dashboardUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/dashboard`
        }, staff.phone);
      }
    }

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
    
    // Also sync to Student Admin Notes for permanent archival
    if (taskData.studentId) {
      try {
        const studentRef = adminDb!.collection('students').doc(taskData.studentId);
        const studentDoc = await studentRef.get();
        if (studentDoc.exists) {
          const studentData = studentDoc.data() as Student;
          const noteId = `note-task-reply-${Date.now()}`;
          const noteAuthor = author.name;
          const taskLabel = taskData.taskType || 'Task';
          await studentRef.update({
            adminNotes: [...(studentData.adminNotes || []), {
              id: noteId,
              authorId: authorId,
              content: `[Task Update - ${taskLabel}] ${content}`,
              createdAt: newReply.createdAt
            }]
          });
        }
      } catch (noteErr) {
        console.error("Failed to sync reply to student notes:", noteErr);
      }
    }

    if (taskData.authorId !== authorId) {
      await adminDb!.collection('tasks').add({ authorId: 'system', createdBy: 'system', recipientId: taskData.authorId, recipientIds: [taskData.authorId], content: `${author.name} replied to: "${taskData.taskType || 'Task'}"`, createdAt: new Date().toISOString(), status: 'new', category: 'system', replies: [] });
      const recipient = await getUser(taskData.authorId);
      if (recipient?.phone) await triggerWhatsAppNotification('task_reply_received', { 
        userName: recipient.name,
        employeeName: recipient.name, 
        taskTitle: taskData.taskType || 'Task',
        replyAuthor: author.name, 
        replyMessage: content, 
        taskUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/tasks` 
      }, recipient.phone);
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

export async function createStudent(values: { studentName: string; studentEmail?: string; phone: string; phone2?: string; phone3?: string; gender?: 'M' | 'F'; internalNumber?: string; highSchoolGrade?: string; targetCountries: string[]; otherCountry?: string; notes?: string; }, creatingUserId: string, creatingUserRole: UserRole, creatingUserCivilId?: string | null, assignedEmployeeId?: string | null) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  const { studentName, studentEmail, phone, phone2, phone3, gender, internalNumber, highSchoolGrade, targetCountries, otherCountry, notes } = values;
  let finalTargetCountries = targetCountries;
  if (otherCountry && otherCountry.trim()) finalTargetCountries = [...finalTargetCountries, otherCountry.trim()];
  try {
    const newPhones = [phone, phone2, phone3].filter(Boolean) as string[];
    const existingIds = new Set<string>();
    await Promise.all(['phone', 'phone2', 'phone3'].map(async field => {
      const snap = await adminDb!.collection('students').where(field, 'in', newPhones).get();
      snap.docs.forEach(d => existingIds.add(d.id));
    }));
    let duplicateInfo = {};
    if (existingIds.size > 0) duplicateInfo = { duplicatePhoneWarning: true, duplicateOfStudentIds: [...existingIds] };
    const fallbackId = Math.random().toString(36).substring(2, 9);
    const idPrefix = creatingUserCivilId ? `U-${creatingUserCivilId}` : `S-${fallbackId}`;
    const studentId = `${idPrefix}-${Date.now()}`;
    const studentRef = adminDb!.collection('students').doc(studentId);
    const now = new Date().toISOString();
    // If this person is on a previously-imported accepted list, inherit their acceptance.
    const acceptedMatch = await lookupAcceptedList([phone, phone2, phone3]);
    await studentRef.set({ id: studentId, name: studentName, email: studentEmail || '', phone: phone, ...(phone2 ? { phone2 } : {}), ...(phone3 ? { phone3 } : {}), gender: gender || null, internalNumber: internalNumber || '', highSchoolGrade: highSchoolGrade || '', employeeId: assignedEmployeeId || null, applications: [], employeeNotes: [], adminNotes: notes ? [{ id: `note-${Date.now()}`, authorId: creatingUserId, content: notes, createdAt: now }] : [], documents: [], createdAt: now, lastActivityAt: now, createdBy: creatingUserId, targetCountries: finalTargetCountries as Country[], missingItems: [], pipelineStatus: 'none', isClosed: false, isNewForEmployee: !!assignedEmployeeId, ...(acceptedMatch ? { acceptedInfo: { country: acceptedMatch.country, major: acceptedMatch.major }, ...(acceptedMatch.listName ? { importListName: acceptedMatch.listName } : {}) } : {}), profileCompletionStatus: { submitUniversityApplication: false, applyMoheScholarship: false, submitKcoRequest: false, receivedCasOrI20: false, appliedForVisa: false, documentsSubmittedToMohe: false, readyToTravel: false, financialStatementsProvided: false, visaGranted: false, medicalFitnessSubmitted: false }, ...duplicateInfo });
    
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

export async function transferStudent(studentId: string, newEmployee: User | string, adminId: string, studentName?: string, fromEmployeeName?: string | null) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  // MCP-friendly: `newEmployee` may be a full User object (UI) OR a string identifier
  // (civil id, user doc id, or exact name) which we resolve to the User here.
  let emp: User | null = null;
  if (typeof newEmployee === 'string') {
    const key = newEmployee.trim();
    const byCivil = await adminDb!.collection('users').where('civilId', '==', key).limit(1).get();
    if (!byCivil.empty) emp = { id: byCivil.docs[0].id, ...byCivil.docs[0].data() } as User;
    if (!emp) emp = await getUser(key);
    if (!emp) {
      const byName = await adminDb!.collection('users').where('name', '==', key).get();
      if (byName.size === 1) emp = { id: byName.docs[0].id, ...byName.docs[0].data() } as User;
      else if (byName.size > 1) return { success: false, message: `Multiple employees named "${key}"; pass a civil id or user id instead.` };
    }
    if (!emp) return { success: false, message: `No employee found for "${key}" (tried civil id, user id, then exact name).` };
  } else {
    emp = newEmployee;
  }
  if (!emp.civilId) return { success: false, message: 'Employee missing Civil ID.' };
  try {
    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) return { success: false, message: 'Student not found.' };
    const studentData = studentDoc.data() as Student;
    // Derive names when the caller (e.g. MCP) didn't supply them.
    const resolvedStudentName = studentName || studentData.name || '';
    let resolvedFromName: string | null = fromEmployeeName ?? null;
    if (fromEmployeeName === undefined && studentData.employeeId) {
      const cur = await adminDb!.collection('users').where('civilId', '==', studentData.employeeId).limit(1).get();
      resolvedFromName = cur.empty ? null : ((cur.docs[0].data() as User).name ?? null);
    }
    const newEmployeeObj = emp;
    const updates = {
      employeeId: newEmployeeObj.civilId,
      transferRequested: false,
      transferRequest: FieldValue.delete(),
      isNewForEmployee: true,
      lastActivityAt: new Date().toISOString(),
      transferHistory: [...(studentData.transferHistory || []), { fromEmployeeId: studentData.employeeId, toEmployeeId: newEmployeeObj.civilId, date: new Date().toISOString(), transferredBy: adminId }],
      adminNotes: [...(studentData.adminNotes || []), { id: `note-transfer-${Date.now()}`, authorId: adminId, content: `Transferred from ${resolvedFromName || 'Unassigned'} to ${newEmployeeObj.name}.`, createdAt: new Date().toISOString() }]
    };
    await studentRef.update(updates);
    if (newEmployeeObj.id) {
      const admin = await getUser(adminId);
      await adminDb!.collection('tasks').add({ authorId: adminId, createdBy: adminId, recipientId: newEmployeeObj.id, recipientIds: [newEmployeeObj.id], content: `The student '${resolvedStudentName}' has been transferred to you.`, createdAt: new Date().toISOString(), status: 'new', category: 'system', replies: [] });
      await triggerWhatsAppNotification('student_assigned', { employeeName: newEmployeeObj.name, studentName: resolvedStudentName, assignedBy: admin?.name || 'Administrator', studentUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/student/${studentId}` }, newEmployeeObj.phone);
    }
    return { success: true, message: `Student transferred to ${newEmployeeObj.name}.` };
  } catch (error: any) { return { success: false, message: error.message }; }
}

// Decline a pending transfer request: clears the request WITHOUT moving the student,
// logs an admin note, and notifies the employee who requested it.
export async function declineTransfer(studentId: string, adminId: string, reason?: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const admin = await getUser(adminId);
    if (!admin || !['admin', 'adminplus', 'department'].includes(admin.role)) return { success: false, message: 'Unauthorized.' };
    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) return { success: false, message: 'Student not found.' };
    const studentData = studentDoc.data() as Student;
    if (!studentData.transferRequested) return { success: false, message: 'No pending transfer request for this student.' };

    const requesterId = studentData.transferRequest?.requestedBy;
    const reasonText = reason && reason.trim() ? reason.trim() : 'No reason provided.';

    await studentRef.update({
      transferRequested: false,
      transferRequest: FieldValue.delete(),
      lastActivityAt: new Date().toISOString(),
      adminNotes: [...(studentData.adminNotes || []), {
        id: `note-decline-transfer-${Date.now()}`,
        authorId: adminId,
        content: `${admin.name} declined the transfer request. Reason: ${reasonText}`,
        createdAt: new Date().toISOString(),
      }],
    });

    // Notify the requesting employee that their request was declined.
    if (requesterId) {
      await adminDb!.collection('tasks').add({
        authorId: adminId, createdBy: adminId, authorName: admin.name,
        recipientId: requesterId, recipientIds: [requesterId],
        content: `Your transfer request for '${studentData.name}' was declined. Reason: ${reasonText}`,
        createdAt: new Date().toISOString(), status: 'new', category: 'system', replies: [],
      });
    }

    return { success: true, message: 'Transfer request declined.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function unassignStudent(studentId: string, adminId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const admin = await getUser(adminId);
    if (!admin || !['admin', 'adminplus', 'department'].includes(admin.role)) return { success: false, message: 'Unauthorized.' };
    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) return { success: false, message: 'Student not found.' };
    const studentData = studentDoc.data() as Student;
    if (!studentData.employeeId) return { success: false, message: 'Student is already unassigned.' };
    const now = new Date().toISOString();
    await studentRef.update({
      employeeId: null,
      isNewForEmployee: false,
      transferRequested: false,
      transferRequest: FieldValue.delete(),
      lastActivityAt: now,
      transferHistory: [...(studentData.transferHistory || []), { fromEmployeeId: studentData.employeeId, toEmployeeId: null, date: now, transferredBy: adminId }],
      adminNotes: [...(studentData.adminNotes || []), { id: `note-unassign-${Date.now()}`, authorId: adminId, content: `Unassigned from agent. Student is now an unassigned lead.`, createdAt: now }],
    });
    return { success: true, message: 'Student unassigned.' };
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
        batch.set(adminDb!.collection('tasks').doc(), { 
          authorId: requestingEmployeeId, 
          createdBy: requestingEmployeeId, 
          recipientId: adminDoc.id, 
          recipientIds: [adminDoc.id], 
          content: `Transfer request for ${studentName}: ${reason}`, 
          taskType: 'Transfer Request',
          createdAt: now, 
          status: 'new', 
          category: 'request', 
          replies: [] 
        });
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
        batch.set(adminDb!.collection('tasks').doc(), { 
          authorId: employeeId, 
          createdBy: employeeId, 
          recipientId: adminDoc.id, 
          recipientIds: [adminDoc.id], 
          content: `Deletion request for ${studentData.name}: ${reason}`, 
          taskType: 'Deletion Request',
          status: 'new', 
          category: 'request', 
          createdAt: new Date().toISOString(), 
          replies: [] 
        });
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

export async function updateChecklistItem(studentId: string, itemKey: string, value: boolean, authorId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const studentDoc = await adminDb!.collection('students').doc(studentId).get();
    if (!studentDoc.exists) return { success: false, message: "Student found." };
    const author = await getUser(authorId);
    const isAssignedEmployee = !!author && author.civilId === studentDoc.data()!.employeeId;
    const isAdmin = !!author && ['admin', 'adminplus'].includes(author.role);
    if (!author || (!isAssignedEmployee && !isAdmin)) return { success: false, message: 'Unauthorized.' };
    await adminDb!.collection('students').doc(studentId).update({ [`profileCompletionStatus.${itemKey}`]: value, lastActivityAt: new Date().toISOString() });
    return { success: true, message: 'Checklist updated.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

const DEFAULT_CHECKLIST_ITEMS: ChecklistConfigItem[] = [
  { id: 'submitUniversityApplication', label: 'Submit University Application', order: 0 },
  { id: 'applyMoheScholarship', label: 'Apply for MOHE Scholarship', order: 1 },
  { id: 'submitKcoRequest', label: 'Submit KCO Request', order: 2 },
  { id: 'receivedCasOrI20', label: 'Received CAS or I-20', order: 3 },
  { id: 'appliedForVisa', label: 'Applied for Visa', order: 4 },
  { id: 'visaGranted', label: 'Visa Granted', order: 5 },
  { id: 'documentsSubmittedToMohe', label: 'Documents Submitted to MOHE', order: 6 },
  { id: 'medicalFitnessSubmitted', label: 'Medical Fitness Submitted', order: 7 },
  { id: 'financialStatementsProvided', label: 'Financial Statements Provided', order: 8 },
  { id: 'readyToTravel', label: 'Ready to Travel', order: 9, isFinal: true },
];

export async function getChecklistConfig(): Promise<ChecklistConfigItem[]> {
  if (!checkAdminServices()) return DEFAULT_CHECKLIST_ITEMS;
  try {
    const doc = await adminDb!.collection('system_metadata').doc('checklist_config').get();
    if (!doc.exists) return DEFAULT_CHECKLIST_ITEMS;
    const data = doc.data();
    return (data?.items as ChecklistConfigItem[]) || DEFAULT_CHECKLIST_ITEMS;
  } catch { return DEFAULT_CHECKLIST_ITEMS; }
}

export async function saveChecklistConfig(items: ChecklistConfigItem[], adminId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const admin = await getUser(adminId);
    if (!admin || admin.role !== 'admin') return { success: false, message: 'Unauthorized' };
    await adminDb!.collection('system_metadata').doc('checklist_config').set({ items, updatedAt: new Date().toISOString(), updatedBy: adminId });
    return { success: true, message: 'Checklist config saved.' };
  } catch (e: any) { return { success: false, message: e.message }; }
}

export async function getAdminChecklistConfig(): Promise<ChecklistConfigItem[]> {
  if (!checkAdminServices()) return [];
  try {
    const doc = await adminDb!.collection('system_metadata').doc('admin_checklist_config').get();
    if (!doc.exists) return [];
    const data = doc.data();
    return (data?.items as ChecklistConfigItem[]) || [];
  } catch { return []; }
}

export async function saveAdminChecklistConfig(items: ChecklistConfigItem[], adminId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const admin = await getUser(adminId);
    if (!admin || admin.role !== 'admin') return { success: false, message: 'Unauthorized' };
    await adminDb!.collection('system_metadata').doc('admin_checklist_config').set({ items, updatedAt: new Date().toISOString(), updatedBy: adminId });
    return { success: true, message: 'Admin checklist config saved.' };
  } catch (e: any) { return { success: false, message: e.message }; }
}

export async function updateAdminChecklistItem(studentId: string, itemKey: string, value: boolean, authorId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const author = await getUser(authorId);
    if (!author || !['admin', 'adminplus', 'department'].includes(author.role)) {
      return { success: false, message: 'Unauthorized.' };
    }
    await adminDb!.collection('students').doc(studentId).update({
      [`adminChecklistStatus.${itemKey}`]: value,
      lastActivityAt: new Date().toISOString(),
    });
    return { success: true, message: 'Admin checklist updated.' };
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

export async function unfinalizeStudentDecision(studentId: string, updaterId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) return { success: false, message: 'Student not found.' };
    const studentData = studentDoc.data() as Student;
    const updater = await getUser(updaterId);
    if (!updater) return { success: false, message: 'Updater not found.' };
    
    // Authorization check
    if (updater.role === 'employee' && updater.civilId !== studentData.employeeId) {
      if (!['admin', 'department'].includes(updater.role)) return { success: false, message: 'Unauthorized.' };
    }

    await studentRef.update({
      finalChoiceUniversity: FieldValue.delete(),
      finalizedAt: FieldValue.delete(),
      finalizedViewedBy: FieldValue.delete(),
      lastActivityAt: new Date().toISOString(),
      adminNotes: FieldValue.arrayUnion({ 
        id: `note-unfinalize-${Date.now()}`, 
        authorId: updaterId, 
        content: `${updater.name} removed student from finalized list. (Mistake corrected)`, 
        createdAt: new Date().toISOString() 
      })
    });

    return { success: true, message: `Student removed from finalized list.` };
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

    // Check if we just resolved a duplicate phone issue (across all phone fields)
    const deletedPhones = [studentData.phone, studentData.phone2, studentData.phone3].filter(Boolean) as string[];
    if (deletedPhones.length > 0) {
      const affectedIds = new Set<string>();
      await Promise.all(['phone', 'phone2', 'phone3'].map(async field => {
        const snap = await adminDb!.collection('students').where(field, 'in', deletedPhones).get();
        snap.docs.forEach(d => affectedIds.add(d.id));
      }));
      if (affectedIds.size === 1) {
        const [remainingId] = affectedIds;
        await adminDb!.collection('students').doc(remainingId).update({
          duplicatePhoneWarning: false,
          duplicateOfStudentIds: FieldValue.delete()
        });
      } else if (affectedIds.size > 1) {
        const batch = adminDb!.batch();
        affectedIds.forEach(id => {
          batch.update(adminDb!.collection('students').doc(id), { duplicateOfStudentIds: FieldValue.arrayRemove(studentId) });
        });
        await batch.commit();
      }
    }

    return { success: true, message: `Student deleted successfully.` };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function bulkDeleteStudents(studentIds: string[], adminId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  const adminUser = await getUser(adminId);
  if (!adminUser || adminUser.role !== 'admin') return { success: false, message: 'Unauthorized.' };
  let deleted = 0;
  const failed: string[] = [];
  for (const id of studentIds) {
    const res = await deleteStudent(id, adminId);
    if (res.success) deleted++;
    else failed.push(id);
  }
  return {
    success: failed.length === 0,
    deleted,
    message: failed.length === 0
      ? `Deleted ${deleted} student${deleted === 1 ? '' : 's'}.`
      : `Deleted ${deleted}; ${failed.length} failed.`,
  };
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

export async function markDocumentViewed(studentId: string, docId: string, userId: string) {
  if (!checkAdminServices()) return { success: false };
  try {
    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) return { success: false };
    const studentData = studentDoc.data() as Student;

    const updatedDocs = (studentData.documents || []).map(doc => {
      if (doc.id === docId) {
        const viewedBy = doc.viewedBy || [];
        if (!viewedBy.includes(userId)) {
          return { ...doc, viewedBy: [...viewedBy, userId] };
        }
      }
      return doc;
    });

    await studentRef.update({ documents: updatedDocs });
    return { success: true };
  } catch { return { success: false }; }
}

export async function updateStudentDocumentNote(studentId: string, documentId: string, note: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) return { success: false, message: 'Student not found.' };
    const studentData = studentDoc.data() as Student;
    
    const updatedDocs = (studentData.documents || []).map(doc => {
      if (doc.id === documentId) {
        return { ...doc, note };
      }
      return doc;
    });

    await studentRef.update({ documents: updatedDocs, lastActivityAt: new Date().toISOString() });
    return { success: true, message: 'Note updated.' };
  } catch (error: any) { 
    return { success: false, message: error.message }; 
  }
}

export async function handleEmployeeLogin(userId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const user = await getUser(userId);
    if (!user || user.role !== 'employee') return { success: true, message: 'Not an employee.' };
    
    const timeLogsRef = adminDb!.collection('time_logs');
    const todayStr = new Date().toISOString().split('T')[0];
    
    // Check for an active session (clockOut is null)
    const activeLogQuery = await timeLogsRef
      .where('employeeId', '==', userId)
      .where('clockOut', '==', null)
      .limit(1)
      .get();

    if (!activeLogQuery.empty) {
      const activeLog = activeLogQuery.docs[0].data() as TimeLog;
      
      // If the active session is from today, just continue it (don't create a new log)
      if (activeLog.date === todayStr) {
        await activeLogQuery.docs[0].ref.update({ lastSeen: new Date().toISOString() });
        return { success: true, message: 'Session continued.' };
      }
      
      // If it's an old session from a previous day, close all old ones first
      const allActiveQuery = await timeLogsRef.where('employeeId', '==', userId).where('clockOut', '==', null).get();
      const batch = adminDb!.batch();
      allActiveQuery.docs.forEach(doc => batch.update(doc.ref, { 
        clockOut: new Date().toISOString(),
        notes: (doc.data().notes || '') + ' (Auto-closed on next login)'
      }));
      await batch.commit();
    }
    
    // Start a new session
    await timeLogsRef.add({ 
      employeeId: userId, 
      date: todayStr, 
      clockIn: new Date().toISOString(), 
      clockOut: null, 
      lastSeen: new Date().toISOString() 
    });
    
    processInactivityReminders();
    return { success: true, message: 'New session started.' };
  } catch (error: any) { 
    console.error("Login log error:", error);
    return { success: false, message: error.message }; 
  }
}

export async function handleEmployeeLogout(userId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const activeLogQuery = await adminDb!.collection('time_logs').where('employeeId', '==', userId).where('clockOut', '==', null).limit(1).get();
    if (activeLogQuery.empty) return { success: true, message: 'No active session.' };
    await activeLogQuery.docs[0].ref.update({ clockOut: new Date().toISOString() });
    return { success: true, message: 'Session ended.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function keepAlive(userId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const activeLogQuery = await adminDb!.collection('time_logs').where('employeeId', '==', userId).where('clockOut', '==', null).limit(1).get();
    if (!activeLogQuery.empty) await activeLogQuery.docs[0].ref.update({ lastSeen: new Date().toISOString() });
    return { success: true };
  } catch (error) { return { success: false, message: 'Failed.' }; }
}

export async function closeInactiveSessions() {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    // If a user stops working for a full 60 min, then count him as logged out
    const sixtyMinutesAgo = subMinutes(new Date(), 60).toISOString();
    
    const openSessionsQuery = await adminDb!.collection('time_logs')
      .where('clockOut', '==', null)
      .get();

    const inactiveDocs = openSessionsQuery.docs.filter(doc => {
      const lastSeen = doc.data().lastSeen || doc.data().clockIn;
      return lastSeen && lastSeen < sixtyMinutesAgo;
    });

    if (inactiveDocs.length === 0) return { success: true, message: 'No inactive sessions to close.' };

    const batch = adminDb!.batch();

    inactiveDocs.forEach(doc => {
      const data = doc.data() as TimeLog;
      const lastSeenStr = data.lastSeen || data.clockIn;
      const lastSeenDate = parseISO(lastSeenStr);
      // Log out starting from minute 5 (lastSeen + 5 minutes)
      const adjustedClockOut = addMinutes(lastSeenDate, 5).toISOString();
      
      batch.update(doc.ref, { 
        clockOut: adjustedClockOut,
        automatedLogout: true,
        inactivityPeriod: 60
      });
    });
    
    await batch.commit();
    return { success: true, message: `Closed ${inactiveDocs.length} inactive sessions (applied 5-minute buffer).` };
  } catch (error) { 
    console.error("Error closing inactive sessions:", error);
    return { success: false, message: 'Failed to close sessions.' }; 
  }
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
        yellow: assigned.filter(s => s.pipelineStatus === 'yellow').length,
        orange: assigned.filter(s => s.pipelineStatus === 'orange').length,
        red: assigned.filter(s => s.pipelineStatus === 'red').length,
        black: assigned.filter(s => s.pipelineStatus === 'black').length,
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

export async function updateStudentStudyLevel(studentId: string, level: 'Foundation' | 'First Year' | 'Transfer Student', authorId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const studentRef = adminDb!.collection('students').doc(studentId);
    await studentRef.update({ studyLevel: level, lastActivityAt: new Date().toISOString(), adminNotes: FieldValue.arrayUnion({ id: `note-study-${Date.now()}`, authorId, content: `Study Level updated to: ${level}`, createdAt: new Date().toISOString() }) });
    return { success: true, message: 'Study Level updated.' };
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

export async function sendChatMessage(studentId: string, authorId: string, content: string, recipientIds?: string[], documentPayload?: { name: string; url: string }) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const author = await getUser(authorId);
    if (!author) return { success: false, message: 'Author not found.' };
    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) return { success: false, message: 'Student not found.' };
    const studentData = studentDoc.data() as Student;
    const now = new Date().toISOString();

    let targetUserIds: string[] = [];
    let targetGroups: ('admins' | 'departments')[] = [];
    let labels: string[] = [];

    if (recipientIds && recipientIds.length > 0) {
      if (recipientIds.includes('admins')) {
        targetGroups.push('admins');
        labels.push('Admins');
      }
      if (recipientIds.includes('departments')) {
        targetGroups.push('departments');
        labels.push('Departments');
      }
      const specificUsers = recipientIds.filter(id => id !== 'admins' && id !== 'departments');
      for (const id of specificUsers) {
        targetUserIds.push(id);
        const rUser = await getUser(id);
        if (rUser) labels.push(rUser.name);
        else labels.push('Target User');
      }
    }

    const recipientLabel = labels.length > 0 ? labels.join(', ') : 'No one specified';

    // 1. Add the message to the subcollection
    await adminDb!.collection('chats').doc(studentId).collection('messages').add({
      authorId,
      content,
      timestamp: now,
      recipientLabel, // Store who this message is meant for
      targetUserIds,
      targetGroups,
      ...(documentPayload && { document: documentPayload })
    });

    // 2. Resolve all users to determine exact notification targets
    const relevantDepts = getDepartmentsForStudent(studentData);
    const staffSnap = await adminDb!.collection('users').get();
    const allUsers: User[] = staffSnap.docs.map(d => ({ id: d.id, ...d.data() } as User));

    // Build the precise list of user IDs who should be notified
    const mentionedUserIds: string[] = [];
    for (const staff of allUsers) {
      if (staff.id === author.id) continue;
      if (targetUserIds.includes(staff.id)) { mentionedUserIds.push(staff.id); continue; }
      if (targetGroups.includes('admins') && staff.role === 'admin') { mentionedUserIds.push(staff.id); continue; }
      if (targetGroups.includes('departments') && staff.role === 'department' && staff.department && relevantDepts.includes(staff.department)) { mentionedUserIds.push(staff.id); continue; }
    }

    // Update metadata for SMS-style sorting
    const nowISO = new Date().toISOString();
    const updates: any = {
      lastActivityAt: nowISO,
      lastChatMessageText: content || (documentPayload ? `Shared file: ${documentPayload.name}` : 'Sent a file'),
      lastChatMessageTimestamp: nowISO,
    };

    // Increment per-user unread count for each mentioned user
    for (const uid of mentionedUserIds) {
      updates[`chatUnreadCountByUser.${uid}`] = FieldValue.increment(1);
    }

    // Employee unread counter — only when the employee is specifically mentioned
    if (studentData.employeeId) {
        const empQuery = await adminDb!.collection('users').where('civilId', '==', studentData.employeeId).limit(1).get();
        if (!empQuery.empty) {
            const empId = empQuery.docs[0].id;
            if (targetUserIds.includes(empId)) {
                updates.employeeUnreadMessages = (studentData.employeeUnreadMessages || 0) + 1;
                updates.updatesViewedBy = [];
            }
        }
    }

    await studentRef.update(updates);

    // 3. Trigger Targeted WhatsApp Notifications
    if (studentData.isClosed) return { success: true };
    for (const staff of allUsers) {
      if (!mentionedUserIds.includes(staff.id)) continue;
      if (!staff.phone) continue;

      await triggerWhatsAppNotification('internal_chat_message', {
        userName: staff.name,
        employeeName: staff.name,
        studentName: studentData.name,
        messageContent: `${author.name} sent a message for ${studentData.name}: ${content.substring(0, 50)}...`,
        studentUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/student/${studentId}`
      }, staff.phone);
    }
    return { success: true };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function deleteChatMessage(studentId: string, messageId: string, userId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const user = await getUser(userId);
    if (!user) return { success: false, message: 'User not found.' };
    
    const messageRef = adminDb!.collection('chats').doc(studentId).collection('messages').doc(messageId);
    const messageDoc = await messageRef.get();
    
    if (!messageDoc.exists) return { success: false, message: 'Message not found.' };
    const messageData = messageDoc.data() as any;
    
    // Only author or admin can delete
    if (messageData.authorId !== userId && user.role !== 'admin') {
      return { success: false, message: 'Unauthorized to delete this message.' };
    }
    
    await messageRef.delete();
    return { success: true, message: 'Message deleted successfully.' };
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
    if (studentData.isClosed) return;
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

export async function notifyStudentUpload(token: string, fileName: string) {
  if (!checkAdminServices()) return;
  try {
    const linkDoc = await adminDb!.collection('upload_links').doc(token).get();
    if (!linkDoc.exists) return;
    const link = linkDoc.data() as {
      studentId: string; studentName: string; createdBy: string;
      notifyEmployee?: boolean; notifyDepartment?: boolean; notifyAdmin?: boolean;
    };

    const studentUrl = `${process.env.NEXT_PUBLIC_APP_URL || ''}/student/${link.studentId}`;
    const usersToNotify: User[] = [];

    if (link.notifyEmployee !== false) {
      const creator = await getUser(link.createdBy);
      if (creator) usersToNotify.push(creator);
    }

    if (link.notifyDepartment || link.notifyAdmin) {
      const roles: string[] = [];
      if (link.notifyDepartment) roles.push('department');
      if (link.notifyAdmin) roles.push('admin');
      const staffSnap = await adminDb!.collection('users').where('role', 'in', roles).get();
      staffSnap.docs.forEach(d => {
        const u = d.data() as User;
        if (u.id !== link.createdBy) usersToNotify.push(u);
      });
    }

    for (const u of usersToNotify) {
      if (u.phone) {
        await triggerWhatsAppNotification('document_uploaded_student', {
          recipientName: u.name,
          studentName: link.studentName,
          fileName,
          studentUrl,
        }, u.phone);
      }
    }
  } catch (e) {
    console.error('notifyStudentUpload failed:', e);
  }
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

    const now = new Date().toISOString();
    const updates: any = {
      changeAgentRequired: status,
      lastActivityAt: now,
    };

    if (status) {
      updates.changeAgentUniversities = universities || [];
      updates.hasChangeAgentHistory = true;

      const universitiesToLog = (universities && universities.length > 0) ? universities : ['General Request'];
      const logEntries: ChangeAgentLogEntry[] = universitiesToLog.map((uni: string, idx: number) => ({
        id: `ca-${Date.now()}-${idx}`,
        university: uni,
        flaggedAt: now,
        flaggedByName: admin.name,
      }));
      updates.changeAgentLog = FieldValue.arrayUnion(...logEntries);
    } else {
      updates.changeAgentUniversities = FieldValue.delete();

      if (studentData.changeAgentLog && studentData.changeAgentLog.length > 0) {
        updates.changeAgentLog = studentData.changeAgentLog.map((entry: ChangeAgentLogEntry) =>
          entry.resolvedAt ? entry : { ...entry, resolvedAt: now }
        );
      }
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

    const twentyDaysAgo = subDays(new Date(), 20).toISOString();
    const snapshot = await adminDb!.collection('students').where('lastActivityAt', '<', twentyDaysAgo).get();

    if (snapshot.empty) return { success: true };

    for (const doc of snapshot.docs) {
      const student = doc.data() as Student;
      if (student.isClosed || student.changeAgentRequired || student.profileCompletionStatus?.readyToTravel || !student.employeeId) continue;

      if (student.lastInactivityReminderSentAt) {
        if (differenceInHours(now, parseISO(student.lastInactivityReminderSentAt)) < 48) {
          continue;
        }
      }

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
    const twentyOneDaysAgo = subDays(new Date(), 21).toISOString();
    await adminDb!.collection('students').doc(studentId).update({ lastActivityAt: twentyOneDaysAgo, createdAt: twentyOneDaysAgo, changeAgentRequired: false, pipelineStatus: 'none', lastInactivityReminderSentAt: null, 'profileCompletionStatus.readyToTravel': false });
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

// Add an approved university. Server-side (admin SDK) so it never depends on client
// Firestore rules — client writes were failing silently, so add/close did nothing.
export async function addUniversity(data: Record<string, unknown>, userId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const user = await getUser(userId);
    if (!user || !['admin', 'department'].includes(user.role)) return { success: false, message: 'Unauthorized.' };
    const clean = Object.fromEntries(Object.entries(data || {}).filter(([, v]) => v !== undefined));
    const ref = await adminDb!.collection('approved_universities').add(clean);
    return { success: true, id: ref.id, message: 'University added.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}

// Update an approved university (incl. the isAvailable "open/close" toggle).
export async function updateUniversity(id: string, data: Record<string, unknown>, userId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const user = await getUser(userId);
    if (!user || !['admin', 'department'].includes(user.role)) return { success: false, message: 'Unauthorized.' };
    const ref = adminDb!.collection('approved_universities').doc(id);
    if (!(await ref.get()).exists) return { success: false, message: 'University not found.' };
    const clean = Object.fromEntries(Object.entries(data || {}).filter(([k, v]) => k !== 'id' && v !== undefined));
    await ref.update(clean);
    return { success: true, message: 'University updated.' };
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

export async function getMissingItemTemplates(): Promise<{ id: string; text: string }[]> {
  if (!checkAdminServices()) return [];
  try {
    const doc = await adminDb!.collection('system_metadata').doc('missing_item_templates').get();
    if (!doc.exists) return [];
    const data = doc.data();
    return data?.items || [];
  } catch { return []; }
}

export async function saveMissingItemTemplates(items: { id: string; text: string }[], adminId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const admin = await getUser(adminId);
    if (!admin || admin.role !== 'admin') return { success: false, message: 'Unauthorized' };
    await adminDb!.collection('system_metadata').doc('missing_item_templates').set({ items, updatedAt: new Date().toISOString(), updatedBy: adminId });
    return { success: true, message: 'Templates saved.' };
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
        await triggerWhatsAppNotification('student_assigned', { 
          userName: employeeData.name,
          employeeName: employeeData.name, 
          assignedBy: admin.name,
          studentName: `A bulk set of ${studentIds.length} students`,
          studentUrl: `${process.env.NEXT_PUBLIC_APP_URL || ''}/applicants` 
        }, employeeData.phone);
    }

    await batch.commit();
    return { success: true, message: `Assigned ${studentIds.length} students to ${employeeData.name}` };
  } catch (error: any) { return { success: false, message: error.message }; }
}

export async function rejectStudentDeletion(studentId: string, adminId: string, reason: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const adminUser = await getUser(adminId);
    if (!adminUser || adminUser.role !== 'admin') return { success: false, message: 'Unauthorized.' };
    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) return { success: false, message: 'Student not found.' };

    const authorRole = adminUser.role;
    const authorName = adminUser.name;

    await studentRef.update({ 
      deletionRequested: FieldValue.delete(),
      lastActivityAt: new Date().toISOString(),
      adminNotes: FieldValue.arrayUnion({ 
        id: `note-reject-del-${Date.now()}`, 
        authorId: adminId, 
        content: `Admin (${authorName}) rejected the deletion request. Reason: ${reason}`, 
        createdAt: new Date().toISOString() 
      })
    });
    
    return { success: true, message: 'Deletion request rejected.' };
  } catch (error: any) { return { success: false, message: error.message }; }
}


export async function processStudentReminders(params: {
  userId: string;
  userRole: string;
  userDepartment?: string;
  userCivilId?: string;
}): Promise<{ triggered: Reminder[] }> {
  if (!checkAdminServices()) return { triggered: [] };
  try {
    const now = new Date().toISOString();
    const snapshot = await adminDb!
      .collection('student_reminders')
      .where('status', '==', 'active')
      .where('dueAt', '<=', now)
      .get();

    if (snapshot.empty) return { triggered: [] };

    const triggered: Reminder[] = [];

    for (const doc of snapshot.docs) {
      const reminder = { id: doc.id, ...doc.data() } as Reminder;

      // Check if this user is a recipient
      const { recipientType, recipientUserIds } = reminder;
      let isRecipient = false;
      if (recipientType === 'all') isRecipient = true;
      else if (recipientType === 'admin' && params.userRole === 'admin') isRecipient = true;
      else if (recipientType === 'employee' && params.userRole === 'employee') isRecipient = true;
      else if (recipientType === 'department' && params.userRole === 'department') isRecipient = true;
      else if (recipientType === 'custom' && recipientUserIds?.includes(params.userId)) isRecipient = true;

      if (!isRecipient) continue;

      triggered.push(scrub(reminder));

      // Send WhatsApp if not yet sent
      if (reminder.notifyWhatsApp && !reminder.whatsAppSentAt) {
        const recipients: { phone: string; name: string }[] = [];

        if (recipientType === 'admin' || recipientType === 'all') {
          const admins = await adminDb!.collection('users').where('role', '==', 'admin').get();
          admins.docs.forEach(d => { if (d.data().phone) recipients.push({ phone: d.data().phone, name: d.data().name || 'Admin' }); });
        }
        if (recipientType === 'employee' || recipientType === 'all') {
          // Get student's assigned employee
          const studentDoc = await adminDb!.collection('students').doc(reminder.studentId).get();
          if (studentDoc.exists) {
            const student = studentDoc.data() as Student;
            if (student.employeeId) {
              const emp = await adminDb!.collection('users').where('civilId', '==', student.employeeId).limit(1).get();
              emp.docs.forEach(d => { if (d.data().phone) recipients.push({ phone: d.data().phone, name: d.data().name || 'Employee' }); });
            }
          }
        }
        if (recipientType === 'department') {
          const depts = await adminDb!.collection('users').where('role', '==', 'department').get();
          depts.docs.forEach(d => { if (d.data().phone) recipients.push({ phone: d.data().phone, name: d.data().name || 'Team' }); });
        }
        if (recipientType === 'custom' && recipientUserIds?.length) {
          const docs = await Promise.all(recipientUserIds.map(uid => adminDb!.collection('users').doc(uid).get()));
          docs.forEach(d => { if (d.exists && d.data()?.phone) recipients.push({ phone: d.data()!.phone, name: d.data()!.name || 'Team' }); });
        }

        const seen = new Set<string>();
        for (const { phone, name } of recipients) {
          if (seen.has(phone)) continue;
          seen.add(phone);
          await triggerWhatsAppNotification('student_reminder', {
            recipientName: name,
            studentName: reminder.studentName,
            reminderTitle: reminder.title,
            reminderDescription: reminder.description || '',
            dueAt: formatKuwaitTime(reminder.dueAt),
          }, phone);
        }

        await doc.ref.update({ whatsAppSentAt: now });
      }
    }

    return { triggered };
  } catch (e: any) {
    console.error('processStudentReminders failed:', e);
    return { triggered: [] };
  }
}

export async function closeStudentProfile(studentId: string, reason: string, adminId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const admin = await getUser(adminId);
    if (!admin || !['admin', 'adminplus'].includes(admin.role)) {
      return { success: false, message: 'Unauthorized. Only Admins can close profiles.' };
    }

    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) return { success: false, message: 'Student not found.' };
    const studentData = studentDoc.data() as Student;

    if (studentData.isClosed) return { success: false, message: 'Profile is already closed.' };

    const now = new Date().toISOString();
    const closureNote = `${reason} (Closed: ${formatKuwaitTime(now)})`;

    const existingNote = studentData.adminStatusNote || '';
    const newAdminStatusNote = existingNote ? `${existingNote} | ${closureNote}` : closureNote;

    const currentName = studentData.name || '';
    const newName = currentName.endsWith('-Closed') ? currentName : `${currentName}-Closed`;

    const updatedApplications = (studentData.applications || []).map(app => ({
      ...app,
      status: 'Rejected' as ApplicationStatus,
      rejectionReason: 'change agent / the student do not work with us',
      updatedAt: now,
    }));

    await studentRef.update({
      isClosed: true,
      closedAt: now,
      closedReason: reason,
      name: newName,
      adminStatusNote: newAdminStatusNote,
      pipelineStatus: 'black',
      applications: updatedApplications,
      employeeId: '123456789010',
      transferHistory: [...(studentData.transferHistory || []), { fromEmployeeId: studentData.employeeId || null, toEmployeeId: '123456789010', date: now, transferredBy: adminId }],
      changeAgentRequired: false,
      changeAgentUniversities: FieldValue.delete(),
      lastActivityAt: now,
      adminNotes: FieldValue.arrayUnion({
        id: `note-closed-${Date.now()}`,
        authorId: adminId,
        content: `🔒 Profile closed by ${admin.name}. Reason: "${reason}". Pipeline set to Black. All applications rejected with reason "change agent / the student do not work with us". Reassigned to TEST - Talal 2. Name updated to "${newName}".`,
        createdAt: now,
      }),
    });

    return { success: true, message: 'Profile closed successfully.' };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

export async function reopenStudentProfile(studentId: string, adminId: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const admin = await getUser(adminId);
    if (!admin || !['admin', 'adminplus'].includes(admin.role)) {
      return { success: false, message: 'Unauthorized. Only Admins can reopen profiles.' };
    }

    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) return { success: false, message: 'Student not found.' };
    const studentData = studentDoc.data() as Student;

    if (!studentData.isClosed) return { success: false, message: 'Profile is not closed.' };

    const now = new Date().toISOString();

    // Remove -Closed suffix from name
    const currentName = studentData.name || '';
    const newName = currentName.endsWith('-Closed') ? currentName.slice(0, -7) : currentName;

    // Append reopen note to adminStatusNote
    const existingNote = studentData.adminStatusNote || '';
    const reopenNote = `Reopened by ${admin.name} (${formatKuwaitTime(now)})`;
    const newAdminStatusNote = existingNote ? `${existingNote} | ${reopenNote}` : reopenNote;

    // Reset all applications back to Pending, clear the system rejection reason
    const updatedApplications = (studentData.applications || []).map(app => {
      const { rejectionReason, ...rest } = app as any;
      return { ...rest, status: 'Pending' as ApplicationStatus, updatedAt: now };
    });

    await studentRef.update({
      isClosed: false,
      closedAt: FieldValue.delete(),
      closedReason: FieldValue.delete(),
      name: newName,
      adminStatusNote: newAdminStatusNote,
      pipelineStatus: 'none',
      applications: updatedApplications,
      employeeId: null,
      transferHistory: [...(studentData.transferHistory || []), { fromEmployeeId: studentData.employeeId || null, toEmployeeId: null, date: now, transferredBy: adminId }],
      lastActivityAt: now,
      adminNotes: FieldValue.arrayUnion({
        id: `note-reopened-${Date.now()}`,
        authorId: adminId,
        content: `🔓 Profile reopened by ${admin.name}. Pipeline reset to No Status. All applications reset to Pending. Student moved to Unassigned. Name restored to "${newName}".`,
        createdAt: now,
      }),
    });

    return { success: true, message: 'Profile reopened and moved to unassigned.' };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// ─── Jotform Application Submission ───────────────────────────────────────────

const JOTFORM_UK_FORM_ID = '240775032170045';
const JOTFORM_AUNZ_FORM_ID = '241203903610442';
const JOTFORM_USA_FORM_ID = '242303620566450';

const STAFF_CIVIL_ID_MAP: Record<string, string> = {
  'طلال':              '295021900391',
  'محمد سليمان':       '302052600167',
  'خالد الشمري':       '295100401179',
  'عبدالرحمن العنزي': '887766554433',
  'طلال العنزي':       '998877665544',
  'زينب دشتي':         '300021001306',
  'دنيا':              '299121800441',
  'عايشه':             '001122334455',
  'مريم العنزي':       '665544332211',
  'حنان الكندري':      '301042901113',
  'فاطمه الشمري':      '299021001191',
  'خالد الهدهود':      '300072600069',
  'يوسف سليمان':       '304052500624',
  'ابراهيم':           '305061500954',
  'دلال':              '306021400064',
};

export async function submitJotformApplications(formData: FormData): Promise<{ jotformResults: { country: string; success: boolean; detail?: string }[]; studentCreated: boolean }> {
  const jotformResults: { country: string; success: boolean; detail?: string }[] = [];

  const selectedCountries = JSON.parse((formData.get('selectedCountries') as string) || '[]') as string[];
  const firstName = (formData.get('firstName') as string) || '';
  const lastName = (formData.get('lastName') as string) || '';
  const dob = (formData.get('dob') as string) || '';
  const email = (formData.get('email') as string) || '';
  const ukMajor = (formData.get('ukMajor') as string) || '';
  const ukUniversities = (formData.get('ukUniversities') as string) || '';
  const aunzMajor = (formData.get('aunzMajor') as string) || '';
  const aunzUniversities = (formData.get('aunzUniversities') as string) || '';
  const usaMajor = (formData.get('usaMajor') as string) || '';
  const usaUniversities = (formData.get('usaUniversities') as string) || '';
  const kuwaitAddress = (formData.get('kuwaitAddress') as string) || '';
  const kuwaitPhone = (formData.get('kuwaitPhone') as string) || '';
  const civilId = (formData.get('civilId') as string) || '';
  const schoolName = (formData.get('schoolName') as string) || '';
  const ieltsScore = (formData.get('ieltsScore') as string) || '';
  const followUpPerson = (formData.get('followUpPerson') as string) || '';
  const guardianName = (formData.get('guardianName') as string) || '';
  const guardianEmail = (formData.get('guardianEmail') as string) || '';
  const guardianPhone = (formData.get('guardianPhone') as string) || '';
  const scholarshipType = (formData.get('scholarshipType') as string) || '';
  const acceptanceType = (formData.get('acceptanceType') as string) || '';
  const semester = (formData.get('semester') as string) || '';
  const guardianDob = (formData.get('guardianDob') as string) || '';
  const gender = (formData.get('gender') as string) || '';
  const intakeSemester = (formData.get('intakeSemester') as string) || 'FALL (8/9)';
  const intakeYear = parseInt((formData.get('intakeYear') as string) || '2026', 10);

  const getFiles = (key: string) =>
    formData.getAll(key).filter((f): f is File => f instanceof File && (f as File).size > 0);

  const passportFiles = getFiles('passport');
  const secondaryCertsFiles = getFiles('secondaryCerts');
  const ieltsFileFiles = getFiles('ieltsFile');
  const otherFilesFiles = getFiles('otherFiles');
  const universityDegreeFiles = getFiles('universityDegree');
  const recommendationLetterFiles = getFiles('recommendationLetter');
  const personalStatementFiles = getFiles('personalStatement');

  const toDateParts = (iso: string) => {
    if (!iso) return null;
    const [year, month, day] = iso.split('-');
    return { month, day, year };
  };

  type FileData = { buffer: ArrayBuffer; name: string; type: string };
  const readFilesData = async (files: File[]): Promise<FileData[]> =>
    Promise.all(files.map(async f => ({ buffer: await f.arrayBuffer(), name: f.name, type: f.type || 'application/octet-stream' })));

  const [passportData, secondaryCertsData, ieltsFileData, otherFilesData, universityDegreeData, recommendationLetterData, personalStatementData] =
    await Promise.all([
      readFilesData(passportFiles), readFilesData(secondaryCertsFiles), readFilesData(ieltsFileFiles),
      readFilesData(otherFilesFiles), readFilesData(universityDegreeFiles), readFilesData(recommendationLetterFiles),
      readFilesData(personalStatementFiles),
    ]);

  const appendFiles = (fd: FormData, field: string, filesData: FileData[]) => {
    for (const f of filesData) fd.append(field, new Blob([f.buffer], { type: f.type }), f.name);
  };

  // Build FormData using the browser-style q{id}_{name} format for direct form submission.
  // Passport field name differs between forms: UK uses 'input11', AU/NZ uses 'passportPhoto'.
  const buildJotformData = (formId: string): FormData => {
    const fd = new FormData();
    fd.append('formID', formId);
    fd.append('q3_input3[first]', firstName);
    fd.append('q3_input3[last]', lastName);
    const dobj = toDateParts(dob);
    if (dobj) {
      fd.append('q4_input4[month]', dobj.month);
      fd.append('q4_input4[day]', dobj.day);
      fd.append('q4_input4[year]', dobj.year);
    }
    if (email) fd.append('q5_input5', email);
    if (kuwaitAddress) fd.append('q9_input9', kuwaitAddress);
    if (ieltsScore) fd.append('q16_input16', ieltsScore);
    if (followUpPerson) fd.append('q17_input17', followUpPerson);
    if (guardianName) fd.append('q23_input23', guardianName);
    if (guardianEmail) fd.append('q25_input25', guardianEmail);
    if (guardianPhone) fd.append('q26_input26', guardianPhone);

    appendFiles(fd,'q12_input12[]', secondaryCertsData);
    appendFiles(fd,'q13_input13[]', ieltsFileData);
    appendFiles(fd,'q14_input14[]', otherFilesData);
    appendFiles(fd,'q15_input15[]', universityDegreeData);
    appendFiles(fd,'q28_input28[]', recommendationLetterData);
    appendFiles(fd,'q29_personalStatement[]', personalStatementData);

    return fd;
  };

  const postToJotform = async (formId: string, fd: FormData) => {
    try {
      const res = await fetch(`https://submit.jotform.com/submit/${formId}/`, {
        method: 'POST',
        body: fd,
      });
      const bodyText = await res.text().catch(() => '');
      // JotForm rejects with an error "message" and/or an error <title> ("Incomplete
      // Values", file-size errors, etc.) — often still with HTTP 200. Treat the PRESENCE
      // of such an error as failure; a clean response means it was accepted. (Do NOT read
      // a submission id out of res.url — that URL just echoes the form id.)
      const jfError = (
        bodyText.match(/"message"\s*:\s*"([^"]+)"/)?.[1] ||
        /<title>\s*(Incomplete Values|Unable[^<]*|Submission Error[^<]*|[^<]*cannot be bigger[^<]*)\s*<\/title>/i.exec(bodyText)?.[1] ||
        ''
      ).replace(/\\u0026lt;/g, '<').replace(/\\u0026gt;/g, '>').replace(/\\\//g, '/').replace(/<[^>]+>/g, '').trim();
      const accepted = res.ok && !jfError;
      console.log(`[jotform:${formId}] status=${res.status} accepted=${accepted} bodyLen=${bodyText.length}${jfError ? ` error="${jfError}"` : ''}`);
      if (!accepted) {
        console.error(`[jotform:${formId}] NOT accepted — body snippet:`, bodyText.slice(0, 1000));
      }
      const detail = accepted
        ? 'accepted'
        : jfError || `HTTP ${res.status} — JotForm did not save it`;
      return { responseCode: accepted ? 200 : (res.status === 200 ? 422 : res.status || 502), detail };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[jotform:${formId}] fetch threw:`, msg);
      return { responseCode: 500, detail: `request failed: ${msg}` };
    }
  };

  if (selectedCountries.includes('UK')) {
    const fd = buildJotformData(JOTFORM_UK_FORM_ID);
    if (ukMajor) fd.append('q7_input7', ukMajor);
    if (ukUniversities) fd.append('q8_input8', ukUniversities);
    appendFiles(fd,'q11_input11[]', passportData);
    if (kuwaitPhone) fd.append('q48_input48', kuwaitPhone);
    if (civilId) fd.append('q52_input52', civilId);
    if (schoolName) fd.append('q62_input62', schoolName);
    if (scholarshipType) fd.append('q37_input37', scholarshipType);
    if (acceptanceType) fd.append('q38_input38', acceptanceType);
    if (followUpPerson) fd.append('q39_input39', followUpPerson);
    // q21 (program) and q36 (scholarship) are REQUIRED checkboxes on the UK form —
    // JotForm rejects the whole submission with HTTP 400 if they are missing.
    const ukProgramMap: Record<string, string> = {
      'Foundation': 'I want to apply for foundation',
      'First Year': 'I want to apply for first year',
      'General English': 'General English معهد اللغة',
      'ESL': 'General English معهد اللغة',
      'ESL + Foundation': 'I want to apply for foundation',
      'Masters': 'Masters',
    };
    const ukProgram = acceptanceType ? ukProgramMap[acceptanceType] : '';
    if (ukProgram) fd.append('q21_input21[]', ukProgram);
    const ukScholarshipMap: Record<string, string> = {
      'MOHE - التعليم العالي': 'بعثة التعليم العالي',
      'خطة الايفاد':          'بعثة الإيفاد',
      'بعثه متميزه':          'بعثة متميزة',
      'Self Funded - حساب الخاص': 'حساب خاص',
    };
    if (scholarshipType) {
      const mappedScholarship = ukScholarshipMap[scholarshipType];
      if (mappedScholarship) {
        fd.append('q36_input36[]', mappedScholarship);
      } else {
        // No matching option (e.g. طلبة الثانويه العامه, PAEET) — send as "Other" + text.
        fd.append('q36_input36[other]', scholarshipType);
      }
    }
    try {
      const res = await postToJotform(JOTFORM_UK_FORM_ID, fd);
      jotformResults.push({ country: 'UK', success: res.responseCode === 200, detail: res.detail });
    } catch (e: unknown) {
      jotformResults.push({ country: 'UK', success: false, detail: e instanceof Error ? e.message : String(e) });
    }
  }

  if (selectedCountries.includes('Australia / New Zealand') || selectedCountries.includes('Australia') || selectedCountries.includes('New Zealand')) {
    const fd = buildJotformData(JOTFORM_AUNZ_FORM_ID);
    if (aunzMajor) fd.append('q7_input7', aunzMajor);
    if (aunzUniversities) fd.append('q8_input8', aunzUniversities);
    appendFiles(fd,'q11_passportPhoto[]', passportData);
    if (kuwaitPhone) fd.append('q10_input10[full]', kuwaitPhone);
    if (civilId) fd.append('q36_input36', civilId);
    // q21_input21 is a required checkbox — values must match form options exactly
    const aunzProgramMap: Record<string, string> = {
      'Foundation': 'I want to apply for foundation',
      'First Year': 'I want to apply for first year',
      'General English': 'General English معهد اللغة',
      'ESL': 'General English معهد اللغة',
      'ESL + Foundation': 'I want to apply for foundation',
      'Masters': 'Masters',
    };
    const mappedProgram = acceptanceType ? aunzProgramMap[acceptanceType] : '';
    if (mappedProgram) fd.append('q21_input21[]', mappedProgram);
    try {
      const res = await postToJotform(JOTFORM_AUNZ_FORM_ID, fd);
      jotformResults.push({ country: 'AU/NZ', success: res.responseCode === 200, detail: res.detail });
    } catch (e: unknown) {
      jotformResults.push({ country: 'AU/NZ', success: false, detail: e instanceof Error ? e.message : String(e) });
    }
  }

  if (selectedCountries.includes('USA')) {
    const fd = new FormData();
    fd.append('formID', JOTFORM_USA_FORM_ID);
    fd.append('q3_input3[first]', firstName);
    fd.append('q3_input3[last]', lastName);
    const dobObj = toDateParts(dob);
    if (dobObj) {
      fd.append('q19_input19[month]', dobObj.month);
      fd.append('q19_input19[day]', dobObj.day);
      fd.append('q19_input19[year]', dobObj.year);
    }
    if (email) fd.append('q26_input26', email);
    if (semester) fd.append('q5_input5', semester);
    if (usaMajor) fd.append('q6_input6', usaMajor);
    if (usaUniversities) fd.append('q7_input7', usaUniversities);
    if (kuwaitAddress) fd.append('q8_input8', kuwaitAddress);
    if (kuwaitPhone) fd.append('q10_input10[full]', kuwaitPhone);
    if (guardianName) fd.append('q12_input12', guardianName);
    const guardianDobObj = toDateParts(guardianDob);
    if (guardianDobObj) {
      fd.append('q34_input34[month]', guardianDobObj.month);
      fd.append('q34_input34[day]', guardianDobObj.day);
      fd.append('q34_input34[year]', guardianDobObj.year);
    }
    if (guardianPhone) fd.append('q13_input13[full]', guardianPhone);
    if (guardianEmail) fd.append('q36_input36', guardianEmail);
    if (ieltsScore) fd.append('q20_input20', ieltsScore);
    if (followUpPerson) fd.append('q33_input33', followUpPerson);
    // Required agreement widget fields — must be sent to pass server-side validation
    fd.append('q22_typeA', 'Yes');
    fd.append('q23_typeA23', 'Yes');
    appendFiles(fd, 'q14_passport[]', passportData);
    appendFiles(fd, 'q15_highSchool[]', secondaryCertsData);
    appendFiles(fd, 'q16_input16[]', ieltsFileData);
    appendFiles(fd, 'q17_input17[]', otherFilesData);
    appendFiles(fd, 'q18_input18[]', universityDegreeData);
    try {
      const res = await postToJotform(JOTFORM_USA_FORM_ID, fd);
      jotformResults.push({ country: 'USA', success: res.responseCode === 200, detail: res.detail });
    } catch (e: unknown) {
      jotformResults.push({ country: 'USA', success: false, detail: e instanceof Error ? e.message : String(e) });
    }
  }

  // Create student profile server-side using admin SDK (bypasses Firestore rules)
  const studyLevelMap: Record<string, string> = { 'Foundation': 'Foundation', 'First Year': 'First Year' };
  const employeeCivilId = STAFF_CIVIL_ID_MAP[followUpPerson] || null;
  const newStudentId = (formData.get('newStudentId') as string) || `S-jotform-${Date.now()}`;
  const creatingUserId = (formData.get('creatingUserId') as string) || 'jotform';
  let studentCreated = false;

  if ((firstName || lastName) && adminDb) {
    try {
      const now = new Date().toISOString();

      // Upload all document types to Storage and collect URLs
      const passportDocs: Record<string, unknown>[] = [];
      const jotformDocUrls: Record<string, string[]> = {
        passport: [], secondaryCerts: [], ieltsFile: [], otherFiles: [],
        universityDegree: [], recommendationLetter: [], personalStatement: [],
      };

      if (storage) {
        const bucketName = 'studio-9484431255-91d96.firebasestorage.app';
        const bucket = storage.bucket(bucketName);

        const uploadDocSet = async (filesData: typeof passportData, docKey: string, docLabel: string) => {
          const urls: string[] = [];
          for (let i = 0; i < filesData.length; i++) {
            const f = filesData[i];
            const storagePath = `students/${newStudentId}/jotform/${docKey}/${Date.now()}_${i}_${f.name}`;
            const downloadToken = crypto.randomUUID();
            const fileRef = bucket.file(storagePath);
            await fileRef.save(Buffer.from(f.buffer), {
              metadata: { contentType: f.type, metadata: { firebaseStorageDownloadTokens: downloadToken } },
            });
            const encodedPath = encodeURIComponent(storagePath);
            const url = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${downloadToken}`;
            urls.push(url);
            if (docKey === 'passport') {
              passportDocs.push({ id: `passport-${Date.now()}-${i}`, name: docLabel, originalName: f.name, size: f.buffer.byteLength, url, uploadedAt: now, authorId: creatingUserId });
            }
          }
          return urls;
        };

        await Promise.all([
          uploadDocSet(passportData, 'passport', 'Passport').then(urls => { jotformDocUrls.passport = urls; }),
          uploadDocSet(secondaryCertsData, 'secondaryCerts', 'Secondary Certs').then(urls => { jotformDocUrls.secondaryCerts = urls; }),
          uploadDocSet(ieltsFileData, 'ieltsFile', 'IELTS File').then(urls => { jotformDocUrls.ieltsFile = urls; }),
          uploadDocSet(otherFilesData, 'otherFiles', 'Other Files').then(urls => { jotformDocUrls.otherFiles = urls; }),
          uploadDocSet(universityDegreeData, 'universityDegree', 'University Degree').then(urls => { jotformDocUrls.universityDegree = urls; }),
          uploadDocSet(recommendationLetterData, 'recommendationLetter', 'Recommendation Letter').then(urls => { jotformDocUrls.recommendationLetter = urls; }),
          uploadDocSet(personalStatementData, 'personalStatement', 'Personal Statement').then(urls => { jotformDocUrls.personalStatement = urls; }),
        ]);
      }

      const builtApplicationsJson = (formData.get('builtApplications') as string) || '[]';
      const builtApplications = JSON.parse(builtApplicationsJson);
      const studyLevel = acceptanceType ? (studyLevelMap[acceptanceType] ?? null) : null;

      const studentDoc: Record<string, unknown> = {
        id: newStudentId,
        name: `${firstName} ${lastName}`.trim(),
        email,
        phone: kuwaitPhone,
        ...(gender && { gender }),
        employeeId: employeeCivilId,
        applications: builtApplications,
        employeeNotes: [],
        adminNotes: [],
        documents: passportDocs,
        createdAt: now,
        lastActivityAt: now,
        createdBy: creatingUserId,
        targetCountries: selectedCountries,
        missingItems: [],
        pipelineStatus: 'none',
        isNewForEmployee: !!employeeCivilId,
        jotform: true,
        jotformData: {
          ...(dob && { dob }),
          ...(civilId && { civilId }),
          ...(kuwaitAddress && { kuwaitAddress }),
          ...(schoolName && { schoolName }),
          ...(ieltsScore && { ieltsScore }),
          ...(scholarshipType && { scholarshipType }),
          ...(acceptanceType && { acceptanceType }),
          ...(semester && { semester }),
          ...(guardianName && { guardianName }),
          ...(guardianEmail && { guardianEmail }),
          ...(guardianPhone && { guardianPhone }),
          ...(guardianDob && { guardianDob }),
          ...(followUpPerson && { followUpPerson }),
          documents: jotformDocUrls,
        },
        academicIntakeSemester: intakeSemester,
        academicIntakeYear: intakeYear,
        profileCompletionStatus: {
          submitUniversityApplication: false,
          applyMoheScholarship: false,
          submitKcoRequest: false,
          receivedCasOrI20: false,
          appliedForVisa: false,
          documentsSubmittedToMohe: false,
          readyToTravel: false,
          financialStatementsProvided: false,
          visaGranted: false,
          medicalFitnessSubmitted: false,
        },
      };
      if (studyLevel) studentDoc.studyLevel = studyLevel;

      // If this applicant is on a previously-imported accepted list, inherit their acceptance.
      const acceptedMatch = await lookupAcceptedList([kuwaitPhone], civilId);
      if (acceptedMatch) {
        studentDoc.acceptedInfo = { country: acceptedMatch.country, major: acceptedMatch.major };
        if (acceptedMatch.listName) studentDoc.importListName = acceptedMatch.listName;
      }

      await adminDb.collection('students').doc(newStudentId).set(studentDoc);
      studentCreated = true;
    } catch (err) {
      console.error('[Jotform] Server-side student creation failed:', err);
    }
  }

  return {
    jotformResults,
    studentCreated,
  };
}

export async function addCountryApplication(
  studentId: string,
  country: string,
  major: string,
  universities: string,
  userId: string,
  semesterOverride?: string,
  guardianDobOverride?: string,
  applicationEntries?: { university: string; major: string; country: string }[]
): Promise<{ success: boolean; message: string }> {
  'use server';
  if (!adminDb) return { success: false, message: 'Server not configured.' };

  const userSnap = await adminDb.collection('users').doc(userId).get();
  if (!userSnap.exists) return { success: false, message: 'User not found.' };
  const user = userSnap.data()!;
  const allowedRoles = ['admin', 'adminplus', 'department', 'employee'];
  if (!allowedRoles.includes(user.role)) return { success: false, message: 'Unauthorized.' };

  const studentSnap = await adminDb.collection('students').doc(studentId).get();
  if (!studentSnap.exists) return { success: false, message: 'Student not found.' };
  const student = studentSnap.data()!;

  if (user.role === 'employee' && user.civilId !== student.employeeId) {
    return { success: false, message: 'You are not assigned to this student.' };
  }

  const jd = student.jotformData;
  if (!jd?.documents?.passport?.length) {
    return { success: false, message: 'Student does not have stored Jotform documents.' };
  }

  if (!storage) return { success: false, message: 'Storage not configured.' };

  // Download files via Firebase Admin SDK (authenticated, avoids URL-based fetch issues)
  type FileData = { buffer: ArrayBuffer; name: string; type: string };
  const BUCKET_NAME = 'studio-9484431255-91d96.firebasestorage.app';
  const EXT_TYPE: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    pdf: 'application/pdf', doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };

  const downloadFile = async (url: string): Promise<FileData> => {
    const encodedPath = url.split('/o/')[1]?.split('?')[0] || '';
    const storagePath = decodeURIComponent(encodedPath);
    const rawFilename = storagePath.split('/').pop() || 'file';
    const name = rawFilename.replace(/^\d+_\d+_/, '');
    const ext = name.split('.').pop()?.toLowerCase() || '';
    const type = EXT_TYPE[ext] || 'application/octet-stream';
    const bucket = storage!.bucket(BUCKET_NAME);
    const [nodeBuffer] = await bucket.file(storagePath).download();
    // Copy into a standalone ArrayBuffer (same structure as original submitJotformApplications)
    const ab = nodeBuffer.buffer.slice(nodeBuffer.byteOffset, nodeBuffer.byteOffset + nodeBuffer.byteLength) as ArrayBuffer;
    return { buffer: ab, name, type };
  };

  const downloadAll = async (urls: string[] | undefined): Promise<FileData[]> => {
    if (!urls?.length) return [];
    return Promise.all(urls.map(downloadFile));
  };

  const [passportData, secondaryCertsData, ieltsFileData, otherFilesData, universityDegreeData, recommendationLetterData, personalStatementData] =
    await Promise.all([
      downloadAll(jd.documents.passport),
      downloadAll(jd.documents.secondaryCerts),
      downloadAll(jd.documents.ieltsFile),
      downloadAll(jd.documents.otherFiles),
      downloadAll(jd.documents.universityDegree),
      downloadAll(jd.documents.recommendationLetter),
      downloadAll(jd.documents.personalStatement),
    ]);

  // Identical to the working submitJotformApplications appendFiles
  const appendFiles = (fd: FormData, field: string, filesData: FileData[]) => {
    for (const f of filesData) fd.append(field, new Blob([f.buffer], { type: f.type }), f.name);
  };

  const toDateParts = (iso: string) => {
    if (!iso) return null;
    const [year, month, day] = iso.split('-');
    return { month, day, year };
  };

  const firstName = student.name?.split(' ')[0] || '';
  const lastName = student.name?.split(' ').slice(1).join(' ') || '';
  const email = student.email || '';
  const kuwaitPhone = student.phone || '';
  const dob = jd.dob || '';
  const civilId = jd.civilId || '';
  const kuwaitAddress = jd.kuwaitAddress || '';
  const schoolName = jd.schoolName || '';
  const ieltsScore = jd.ieltsScore || '';
  const followUpPerson = jd.followUpPerson || '';
  const guardianName = jd.guardianName || '';
  const guardianEmail = jd.guardianEmail || '';
  const guardianPhone = jd.guardianPhone || '';
  const scholarshipType = jd.scholarshipType || '';
  const acceptanceType = jd.acceptanceType || '';
  const semester = semesterOverride || jd.semester || '';
  const guardianDob = guardianDobOverride || jd.guardianDob || '';

  const buildBase = (formId: string): FormData => {
    const fd = new FormData();
    fd.append('formID', formId);
    fd.append('q3_input3[first]', firstName);
    fd.append('q3_input3[last]', lastName);
    const dobj = toDateParts(dob);
    if (dobj) {
      fd.append('q4_input4[month]', dobj.month);
      fd.append('q4_input4[day]', dobj.day);
      fd.append('q4_input4[year]', dobj.year);
    }
    if (email) fd.append('q5_input5', email);
    if (kuwaitAddress) fd.append('q9_input9', kuwaitAddress);
    if (ieltsScore) fd.append('q16_input16', ieltsScore);
    if (followUpPerson) fd.append('q17_input17', followUpPerson);
    if (guardianName) fd.append('q23_input23', guardianName);
    if (guardianEmail) fd.append('q25_input25', guardianEmail);
    if (guardianPhone) fd.append('q26_input26', guardianPhone);
    appendFiles(fd, 'q12_input12[]', secondaryCertsData);
    appendFiles(fd, 'q13_input13[]', ieltsFileData);
    appendFiles(fd, 'q14_input14[]', otherFilesData);
    appendFiles(fd, 'q15_input15[]', universityDegreeData);
    appendFiles(fd, 'q28_input28[]', recommendationLetterData);
    appendFiles(fd, 'q29_personalStatement[]', personalStatementData);
    return fd;
  };

  const postToJotform = async (formId: string, fd: FormData): Promise<{ ok: boolean; status: number; detail: string }> => {
    const res = await fetch(`https://submit.jotform.com/submit/${formId}/`, {
      method: 'POST',
      body: fd,
    });
    let detail = '';
    try { detail = await res.text(); } catch { /* ignore */ }
    const textPreview = detail.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 500);
    console.log(`[Jotform] ${formId} → HTTP ${res.status} | ${textPreview}`);
    return { ok: res.ok, status: res.status, detail };
  };

  let jotformResult: { ok: boolean; status: number; detail: string } = { ok: false, status: 0, detail: '' };

  try {
    if (country === 'UK') {
      const fd = buildBase(JOTFORM_UK_FORM_ID);
      if (major) fd.append('q7_input7', major);
      if (universities) fd.append('q8_input8', universities);
      appendFiles(fd, 'q11_input11[]', passportData);
      if (kuwaitPhone) fd.append('q48_input48', kuwaitPhone);
      if (civilId) fd.append('q52_input52', civilId);
      if (schoolName) fd.append('q62_input62', schoolName);
      if (scholarshipType) fd.append('q37_input37', scholarshipType);
      if (acceptanceType) fd.append('q38_input38', acceptanceType);
      if (followUpPerson) fd.append('q39_input39', followUpPerson);
      jotformResult = await postToJotform(JOTFORM_UK_FORM_ID, fd);
    } else if (country === 'Australia / New Zealand') {
      const fd = buildBase(JOTFORM_AUNZ_FORM_ID);
      if (major) fd.append('q7_input7', major);
      if (universities) fd.append('q8_input8', universities);
      appendFiles(fd, 'q11_passportPhoto[]', passportData);
      if (kuwaitPhone) fd.append('q10_input10[full]', kuwaitPhone);
      if (civilId) fd.append('q36_input36', civilId);
      const aunzProgramMap: Record<string, string> = {
        'Foundation': 'I want to apply for foundation',
        'First Year': 'I want to apply for first year',
        'General English': 'General English معهد اللغة',
        'ESL': 'General English معهد اللغة',
        'ESL + Foundation': 'I want to apply for foundation',
        'Masters': 'Masters',
      };
      const mappedProgram = acceptanceType ? aunzProgramMap[acceptanceType] : '';
      if (mappedProgram) fd.append('q21_input21[]', mappedProgram);
      jotformResult = await postToJotform(JOTFORM_AUNZ_FORM_ID, fd);
    } else if (country === 'USA') {
      const fd = new FormData();
      fd.append('formID', JOTFORM_USA_FORM_ID);
      fd.append('q3_input3[first]', firstName);
      fd.append('q3_input3[last]', lastName);
      const dobObj = toDateParts(dob);
      if (dobObj) {
        fd.append('q19_input19[month]', dobObj.month);
        fd.append('q19_input19[day]', dobObj.day);
        fd.append('q19_input19[year]', dobObj.year);
      }
      if (email) fd.append('q26_input26', email);
      if (semester) fd.append('q5_input5', semester);
      if (major) fd.append('q6_input6', major);
      if (universities) fd.append('q7_input7', universities);
      if (kuwaitAddress) fd.append('q8_input8', kuwaitAddress);
      if (kuwaitPhone) fd.append('q10_input10[full]', kuwaitPhone);
      if (guardianName) fd.append('q12_input12', guardianName);
      const guardianDobObj = toDateParts(guardianDob);
      if (guardianDobObj) {
        fd.append('q34_input34[month]', guardianDobObj.month);
        fd.append('q34_input34[day]', guardianDobObj.day);
        fd.append('q34_input34[year]', guardianDobObj.year);
      }
      if (guardianPhone) fd.append('q13_input13[full]', guardianPhone);
      if (guardianEmail) fd.append('q36_input36', guardianEmail);
      if (ieltsScore) fd.append('q20_input20', ieltsScore);
      if (followUpPerson) fd.append('q33_input33', followUpPerson);
      fd.append('q22_typeA', 'Yes');
      fd.append('q23_typeA23', 'Yes');
      appendFiles(fd, 'q14_passport[]', passportData);
      appendFiles(fd, 'q15_highSchool[]', secondaryCertsData);
      appendFiles(fd, 'q16_input16[]', ieltsFileData);
      appendFiles(fd, 'q17_input17[]', otherFilesData);
      appendFiles(fd, 'q18_input18[]', universityDegreeData);
      const missingUSA: string[] = [];
      if (!firstName) missingUSA.push('firstName');
      if (!lastName) missingUSA.push('lastName');
      if (!dob) missingUSA.push('dob');
      if (!email) missingUSA.push('email');
      if (!semester) missingUSA.push('semester');
      if (!kuwaitAddress) missingUSA.push('kuwaitAddress');
      if (!kuwaitPhone) missingUSA.push('kuwaitPhone');
      if (!guardianName) missingUSA.push('guardianName');
      if (!guardianDob) missingUSA.push('guardianDob');
      if (!guardianPhone) missingUSA.push('guardianPhone');
      if (!guardianEmail) missingUSA.push('guardianEmail');
      if (!followUpPerson) missingUSA.push('followUpPerson');
      if (passportData.length === 0) missingUSA.push('passport(0 files)');
      if (secondaryCertsData.length === 0) missingUSA.push('secondaryCerts(0 files)');
      console.log('[addCountryApplication] USA missing:', missingUSA, '| all:', { firstName, lastName, dob, email, semester, kuwaitAddress, kuwaitPhone, guardianName, guardianDob, guardianPhone, guardianEmail, followUpPerson, passport: passportData.length, secondaryCerts: secondaryCertsData.length });
      if (missingUSA.length > 0) {
        return { success: false, message: `Missing required fields for USA: ${missingUSA.join(', ')}` };
      }
      jotformResult = await postToJotform(JOTFORM_USA_FORM_ID, fd);
    } else if (country === 'Ireland') {
      // No JotForm intake form exists for Ireland — store the application directly.
      jotformResult = { ok: true, status: 200, detail: 'No JotForm form for Ireland (stored directly).' };
    }
  } catch (err) {
    console.error('[addCountryApplication] Jotform submission failed:', err);
    return { success: false, message: `Failed to submit: ${err instanceof Error ? err.message : 'Unknown error'}` };
  }

  if (!jotformResult.ok) {
    const stripped = jotformResult.detail.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 300);
    const snippet = stripped || `HTTP ${jotformResult.status}`;
    return { success: false, message: `Jotform error (${jotformResult.status}): ${snippet}` };
  }

  const now = new Date().toISOString();
  const existingApps: unknown[] = student.applications || [];
  const existingCountries: string[] = student.targetCountries || [];
  const updatedCountries = existingCountries.includes(country) ? existingCountries : [...existingCountries, country];

  // Create one Application entry per university
  const newApplications = applicationEntries && applicationEntries.length > 0
    ? applicationEntries.map(e => ({ university: e.university, major: e.major, country: e.country, status: 'Pending', updatedAt: now }))
    : [{
        university: universities.split(', ').map(u => u.replace(/\s*\([^)]+\)\s*$/, '').trim()).join(', '),
        major,
        country: country === 'Australia / New Zealand' ? 'Australia' : country,
        status: 'Pending',
        updatedAt: now,
      }];

  await adminDb.collection('students').doc(studentId).update({
    applications: [...existingApps, ...newApplications],
    targetCountries: updatedCountries,
    lastActivityAt: now,
  });

  return { success: true, message: `Application for ${country} submitted successfully.` };
}

export async function refreshStudentDuplicateWarning(studentId: string): Promise<void> {
  if (!adminDb) return;

  const studentDoc = await adminDb.collection('students').doc(studentId).get();
  if (!studentDoc.exists) return;

  const data = studentDoc.data()!;
  const phones = [data.phone, data.phone2, data.phone3].filter(Boolean) as string[];

  const affectedIds = new Set<string>();

  if (phones.length > 0) {
    await Promise.all(['phone', 'phone2', 'phone3'].map(async field => {
      const snap = await adminDb!.collection('students').where(field, 'in', phones).get();
      snap.docs.forEach(d => { if (d.id !== studentId) affectedIds.add(d.id); });
    }));
  }

  const hasDuplicate = affectedIds.size > 0;

  // Update the edited student
  await adminDb.collection('students').doc(studentId).update({
    duplicatePhoneWarning: hasDuplicate,
    ...(hasDuplicate
      ? { duplicateOfStudentIds: [...affectedIds] }
      : { duplicateOfStudentIds: FieldValue.delete() }),
  });

  // For each previously linked student, re-check if they still have duplicates
  const previouslyLinked: string[] = (data.duplicateOfStudentIds || []) as string[];
  const toRecheck = new Set([...affectedIds, ...previouslyLinked]);
  toRecheck.delete(studentId);

  await Promise.all([...toRecheck].map(async otherId => {
    const otherDoc = await adminDb!.collection('students').doc(otherId).get();
    if (!otherDoc.exists) return;
    const otherData = otherDoc.data()!;
    const otherPhones = [otherData.phone, otherData.phone2, otherData.phone3].filter(Boolean) as string[];

    const otherConflicts = new Set<string>();
    if (otherPhones.length > 0) {
      await Promise.all(['phone', 'phone2', 'phone3'].map(async field => {
        const snap = await adminDb!.collection('students').where(field, 'in', otherPhones).get();
        snap.docs.forEach(d => { if (d.id !== otherId) otherConflicts.add(d.id); });
      }));
    }

    const otherHasDuplicate = otherConflicts.size > 0;
    await adminDb!.collection('students').doc(otherId).update({
      duplicatePhoneWarning: otherHasDuplicate,
      ...(otherHasDuplicate
        ? { duplicateOfStudentIds: [...otherConflicts] }
        : { duplicateOfStudentIds: FieldValue.delete() }),
    });
  }));
}

export async function clearStaleDuplicateWarnings(): Promise<{ fixed: number }> {
  if (!adminDb) return { fixed: 0 };

  // Fetch all students that currently have the warning flag set
  const flaggedSnap = await adminDb.collection('students').where('duplicatePhoneWarning', '==', true).get();
  if (flaggedSnap.empty) return { fixed: 0 };

  // Fetch ALL students once to build a full phone index
  const allSnap = await adminDb.collection('students').get();
  const phoneCounts = new Map<string, number>();
  allSnap.docs.forEach(d => {
    const data = d.data();
    [data.phone, data.phone2, data.phone3].filter(Boolean).forEach((p: string) => {
      phoneCounts.set(p, (phoneCounts.get(p) || 0) + 1);
    });
  });

  const batch = adminDb.batch();
  let fixed = 0;

  for (const doc of flaggedSnap.docs) {
    const data = doc.data();
    const phones = [data.phone, data.phone2, data.phone3].filter(Boolean) as string[];
    const stillHasDuplicate = phones.some(p => (phoneCounts.get(p) || 0) > 1);

    if (!stillHasDuplicate) {
      batch.update(adminDb.collection('students').doc(doc.id), {
        duplicatePhoneWarning: false,
        duplicateOfStudentIds: FieldValue.delete(),
      });
      fixed++;
    }
  }

  if (fixed > 0) await batch.commit();
  return { fixed };
}

// --- Accepted-list registry -------------------------------------------------
// A phone/civil-id keyed store of accepted-list entries, so students added LATER
// (via JotForm or manual add) automatically inherit the accepted country/major and
// the list name. Written by bulkImportStudents; read at student-creation time.
function normalizeAcceptedPhone(p?: string): string {
  if (!p) return '';
  return p.toString().replace(/\D/g, '').replace(/^965/, '');
}

async function lookupAcceptedList(
  phones: (string | undefined)[],
  civilId?: string,
): Promise<{ country: string; major: string; listName?: string } | null> {
  if (!adminDb) return null;
  const cid = normalizeAcceptedPhone(civilId);
  const ids = [...new Set([
    ...phones.map(normalizeAcceptedPhone).filter(Boolean),
    ...(cid ? [`cid_${cid}`] : []),
  ])];
  for (const id of ids) {
    try {
      const snap = await adminDb.collection('accepted_list').doc(id).get();
      if (snap.exists) {
        const d = snap.data()!;
        if (d.country && d.major) {
          return { country: d.country as string, major: d.major as string, listName: (d.listName as string) || undefined };
        }
      }
    } catch { /* ignore lookup errors, never block creation */ }
  }
  return null;
}

async function writeAcceptedListRegistry(
  entries: Array<{ phones?: string[]; civilId?: string; country: string; major: string }>,
  listName: string,
) {
  if (!adminDb || entries.length === 0) return;
  const now = new Date().toISOString();
  let batch = adminDb.batch();
  let ops = 0;
  for (const e of entries) {
    if (!e.country || !e.major) continue;
    const cid = normalizeAcceptedPhone(e.civilId);
    const ids = [...new Set([
      ...(e.phones || []).map(normalizeAcceptedPhone).filter(Boolean),
      ...(cid ? [`cid_${cid}`] : []),
    ])];
    for (const id of ids) {
      batch.set(adminDb.collection('accepted_list').doc(id), {
        key: id, country: e.country, major: e.major, listName: listName || '', updatedAt: now,
      }, { merge: true });
      ops++;
      if (ops >= 450) { await batch.commit(); batch = adminDb.batch(); ops = 0; }
    }
  }
  if (ops > 0) await batch.commit();
}

export async function bulkImportStudents(
  listName: string,
  toUpdate: Array<{ studentId: string; acceptedInfo: { country: string; major: string }; importListName?: string; phone2?: string; phone3?: string }>,
  toCreate: Array<{ arabicName: string; phone: string; phone2?: string; phone3?: string; gender?: 'M' | 'F'; acceptedInfo: { country: string; major: string }; importListName: string }>,
  creatingUserId: string,
  listEntries?: Array<{ phones: string[]; civilId?: string; country: string; major: string }>
) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const now = new Date().toISOString();
    const batch = adminDb!.batch();

    for (const u of toUpdate) {
      const ref = adminDb!.collection('students').doc(u.studentId);
      batch.update(ref, {
        acceptedInfo: u.acceptedInfo,
        importMatchType: 'existing',
        ...(u.importListName ? { importListName: u.importListName } : {}),
        // Add newly-imported extra numbers; the original primary phone is never touched.
        ...(u.phone2 ? { phone2: u.phone2 } : {}),
        ...(u.phone3 ? { phone3: u.phone3 } : {}),
      });
    }

    for (const s of toCreate) {
      const fallbackId = Math.random().toString(36).substring(2, 9);
      const studentId = `B-${fallbackId}-${Date.now()}`;
      const ref = adminDb!.collection('students').doc(studentId);
      batch.set(ref, {
        id: studentId,
        name: s.arabicName,
        arabicName: s.arabicName,
        email: '',
        phone: s.phone,
        ...(s.phone2 ? { phone2: s.phone2 } : {}),
        ...(s.phone3 ? { phone3: s.phone3 } : {}),
        gender: s.gender || null,
        employeeId: null,
        applications: [],
        employeeNotes: [],
        adminNotes: [],
        documents: [],
        createdAt: now,
        lastActivityAt: now,
        createdBy: creatingUserId,
        targetCountries: [],
        missingItems: [],
        pipelineStatus: 'none',
        acceptedInfo: s.acceptedInfo,
        importListName: s.importListName,
        importMatchType: 'new',
        profileCompletionStatus: {
          submitUniversityApplication: false, applyMoheScholarship: false, submitKcoRequest: false,
          receivedCasOrI20: false, appliedForVisa: false, documentsSubmittedToMohe: false,
          readyToTravel: false, financialStatementsProvided: false, visaGranted: false,
          medicalFitnessSubmitted: false,
        },
      });
    }

    await batch.commit();

    // Persist the accepted-list registry so students added LATER (JotForm / manual)
    // inherit the accepted country/major and the list name by phone or civil id.
    if (listEntries && listEntries.length) {
      await writeAcceptedListRegistry(listEntries, listName);
    }

    return { success: true, updated: toUpdate.length, created: toCreate.length };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// Edit or remove a student's accepted-list info (the ACCEPTED badge + list name).
// Pass data=null to remove it entirely.
export async function updateAcceptedInfo(
  studentId: string,
  data: { country: string; major: string; importListName?: string } | null,
  authorId: string
) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const author = await getUser(authorId);
    if (!author || !['admin', 'adminplus', 'department'].includes(author.role)) {
      return { success: false, message: 'Unauthorized.' };
    }
    const ref = adminDb!.collection('students').doc(studentId);
    if (data === null) {
      await ref.update({
        acceptedInfo: FieldValue.delete(),
        importListName: FieldValue.delete(),
        lastActivityAt: new Date().toISOString(),
      });
      return { success: true, message: 'Accepted info removed.' };
    }
    const country = (data.country || '').trim();
    const major = (data.major || '').trim();
    if (!country || !major) return { success: false, message: 'Country and Major are required.' };
    const listName = (data.importListName || '').trim();
    await ref.update({
      acceptedInfo: { country, major },
      importListName: listName ? listName : FieldValue.delete(),
      lastActivityAt: new Date().toISOString(),
    });
    return { success: true, message: 'Accepted info updated.' };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}

// Per-employee student stats for the Reports domain. One pass over the students
// collection. Applies the SAME ghost-student exclusion as getReportStats (drop students
// assigned to a deleted employee id) so the totalStudents figures reconcile. Groups by
// employeeId — which on a student is the employee's CIVIL ID — and includes the
// 'unassigned' bucket so the row totals sum to getReportStats.totalStudents.
export async function getStudentStats(groupBy: string = 'employee'): Promise<{ success: boolean; data?: Array<{ employeeId: string; employeeName: string; totalStudents: number; mohesAccepted: number; mohesAcceptedWithApplications: number }>; message?: string }> {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  if (groupBy !== 'employee') return { success: false, message: `Unsupported groupBy "${groupBy}". Only "employee" is supported.` };
  try {
    const [studentsSnap, usersSnap] = await Promise.all([adminDb!.collection('students').get(), adminDb!.collection('users').get()]);
    const allUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() } as User));
    const validCivilIds = new Set(allUsers.map(u => u.civilId).filter(Boolean));
    const validUserIds = new Set(allUsers.map(u => u.id));
    const allStudents = studentsSnap.docs.map(d => d.data() as Student).filter(s => {
      if (!s.employeeId) return true; // unassigned is valid
      return validCivilIds.has(s.employeeId) || validUserIds.has(s.employeeId);
    });

    const byEmp = new Map<string, { totalStudents: number; mohesAccepted: number; mohesAcceptedWithApplications: number }>();
    for (const s of allStudents) {
      const key = s.employeeId || 'unassigned';
      let r = byEmp.get(key);
      if (!r) { r = { totalStudents: 0, mohesAccepted: 0, mohesAcceptedWithApplications: 0 }; byEmp.set(key, r); }
      r.totalStudents++;
      const info = s.acceptedInfo as unknown;
      const accepted = info != null && (typeof info !== 'object' || Object.keys(info as object).length > 0);
      if (accepted) {
        r.mohesAccepted++;
        if ((s.applications?.length || 0) > 0) r.mohesAcceptedWithApplications++;
      }
    }

    const resolveName = (empId: string) => empId === 'unassigned'
      ? 'Unassigned'
      : (allUsers.find(u => u.civilId === empId)?.name || allUsers.find(u => u.id === empId)?.name || 'Unknown');
    const data = Array.from(byEmp.entries())
      .map(([employeeId, c]) => ({ employeeId, employeeName: resolveName(employeeId), ...c }))
      .sort((a, b) => b.totalStudents - a.totalStudents);
    return scrub({ success: true, data });
  } catch (error: any) { return { success: false, message: error.message }; }
}

// Count students whose admin-checklist item `itemKey` is checked vs not, within an
// active/relevant scope: only students with applications, excluding unassigned and closed
// profiles. `unchecked` includes both explicit false and missing values.
export async function countStudentsByAdminChecklist(itemKey: string): Promise<{ success: boolean; checked?: number; unchecked?: number; totalConsidered?: number; message?: string }> {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  try {
    const studentsSnap = await adminDb!.collection('students').get();
    let checked = 0, unchecked = 0;
    for (const doc of studentsSnap.docs) {
      const s = doc.data() as Student;
      if ((s.applications?.length || 0) === 0) continue;          // must have applications
      if (!s.employeeId || s.employeeId === 'unassigned') continue; // exclude unassigned
      if (s.isClosed === true) continue;                          // exclude closed
      if (s.adminChecklistStatus?.[itemKey] === true) checked++;
      else unchecked++;
    }
    return { success: true, checked, unchecked, totalConsidered: checked + unchecked };
  } catch (error: any) { return { success: false, message: error.message }; }
}
