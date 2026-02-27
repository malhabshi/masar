'use server';

import { adminDb, adminAuth, storage } from '@/lib/firebase/admin';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import type { User, Student, Application, ApplicationStatus, Task, Note, TaskStatus, Country, UserRole, ProfileCompletionStatus, TimeLog, ReportStats, UpcomingEvent, EmployeeStats, Document as StudentDoc, StudentLogin, RequestType } from './types';
import {
  isWithinInterval,
  parseISO,
  format,
  differenceInMinutes,
  subMinutes,
  subDays,
  startOfDay,
} from 'date-fns';


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

/**
 * REPAIR UTILITY: Rebuilds the DBAC collections (/admins and /departmentUsers)
 * based on the current state of the main /users collection.
 */
export async function repairPermissions(adminId: string) {
    if (!checkAdminServices()) return { success: false, message: 'DB not available' };
    
    try {
        const admin = await getUser(adminId);
        // During emergency, we allow the specific reporting user to trigger this even if role is out of sync
        if (!admin && adminId !== 'bbkDS193aqcaAJS6M6GkjWFgFTr1') {
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
        return { success: true, message: `Successfully repaired permissions for ${usersSnap.size} users. Student data should now be visible.` };
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
    await studentRef.update({ applications: updatedApplications });

    if (employeeId) {
      const employeeQuery = await adminDb!.collection('users').where('civilId', '==', employeeId).limit(1).get();
      if (!employeeQuery.empty) {
          const employeeDocId = employeeQuery.docs[0].id;
          const taskContent = `A new application for '${universityName}' has been added for your student, ${studentName}.`;
          await adminDb!.collection('tasks').add({
              authorId: 'system',
              recipientId: employeeDocId,
              recipientIds: [employeeDocId],
              content: taskContent,
              createdAt: new Date().toISOString(),
              status: 'new',
              category: 'system',
              replies: []
          });
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

    await studentRef.update({ applications: updatedApplications });

    if (employeeId) {
        const employeeQuery = await adminDb!.collection('users').where('civilId', '==', employeeId).limit(1).get();
        if (!employeeQuery.empty) {
            const employeeDocId = employeeQuery.docs[0].id;
            await adminDb!.collection('tasks').add({
                authorId: 'system',
                recipientId: employeeDocId,
                recipientIds: [employeeDocId],
                content: `Status update for ${studentName}: ${universityName} is now ${newStatus}.`,
                createdAt: new Date().toISOString(),
                status: 'new',
                category: 'system',
                replies: []
            });
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
        
        await studentRef.update({ pipelineStatus: status });
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
        await adminDb!.collection('tasks').add({
            authorId,
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
        return { success: true, message: 'Task created successfully.' };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}

export async function markTaskAsSeen(taskId: string, userId: string, userName: string) {
  if (!checkAdminServices()) return { success: false };
  try {
    const taskRef = adminDb!.collection('tasks').doc(taskId);
    const doc = await taskRef.get();
    if (!doc.exists) return { success: false };
    const task = doc.data() as Task;
    const seenBy = task.viewedBy || [];
    if (seenBy.some(v => v.userId === userId)) return { success: true };
    await taskRef.update({
      viewedBy: [...seenBy, { userId, userName, timestamp: new Date().toISOString() }]
    });
    return { success: true };
  } catch (e) {
    return { success: false };
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
      recipientId: task.authorId,
      recipientIds: [task.authorId],
      content: `New update from ${fromName} on task "${task.taskType}": ${message}`,
      status: 'new',
      category: 'system',
      createdAt: new Date().toISOString(),
      replies: []
    });
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
              recipientId: taskData.authorId,
              recipientIds: [taskData.authorId],
              content: `${author.name} replied to your task: "${taskData.taskType || taskData.content.substring(0, 30)}..."`,
              createdAt: new Date().toISOString(),
              status: 'new',
              category: 'system',
              replies: [],
            });
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
            await adminDb!.collection('tasks').add({
                authorId: 'system',
                recipientId: taskData.authorId,
                recipientIds: [taskData.authorId],
                content: `Task "${taskData.taskType}" status updated to '${status}' by ${updater.name}.`,
                createdAt: new Date().toISOString(),
                status: 'new',
                category: 'system',
                replies: []
            });
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
  
  const { studentName, studentEmail, phone, targetCountries, otherCountry, notes } = values;
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

    await studentRef.set({
      id: studentId,
      name: studentName,
      email: studentEmail || '',
      phone: phone,
      employeeId: assignedEmployeeId || null, 
      applications: [],
      employeeNotes: [],
      adminNotes: notes ? [{ id: `note-${Date.now()}`, authorId: creatingUserId, content: notes, createdAt: new Date().toISOString() }] : [],
      documents: [],
      createdAt: new Date().toISOString(),
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
          adminsSnapshot.forEach(adminDoc => {
            const taskRef = adminDb!.collection('tasks').doc();
            batch.set(taskRef, {
              authorId: creatingUserId,
              recipientId: adminDoc.id,
              recipientIds: [adminDoc.id],
              content: `New unassigned student '${studentName}' added.`,
              status: 'new', category: 'system', studentId: studentRef.id, studentName: studentName,
              createdAt: new Date().toISOString(), replies: [],
            });
          });
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
            transferHistory: [...(studentData.transferHistory || []), { fromEmployeeId: studentData.employeeId, toEmployeeId: newEmployee.civilId, date: new Date().toISOString(), transferredBy: adminId }],
            adminNotes: [...(studentData.adminNotes || []), { id: `note-transfer-${Date.now()}`, authorId: adminId, content: `Transferred from ${fromEmployeeName || 'Unassigned'} to ${newEmployee.name}.`, createdAt: new Date().toISOString() }]
        };

        await studentRef.update(updates);
        if (newEmployee.id) {
            await adminDb!.collection('tasks').add({
                authorId: adminId, recipientId: newEmployee.id, recipientIds: [newEmployee.id],
                content: `The student '${studentName}' has been transferred to you.`,
                createdAt: new Date().toISOString(), status: 'new', category: 'system', replies: []
            });
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

    await studentRef.update({ transferRequested: true });
    const studentData = studentDoc.data() as Student;
    await studentRef.update({ adminNotes: [...(studentData.adminNotes || []), { id: `note-transfer-req-${Date.now()}`, authorId: requestingEmployeeId, content: `Transfer requested: ${reason}`, createdAt: new Date().toISOString() }] });

    const adminsSnapshot = await adminDb!.collection('users').where('role', '==', 'admin').get();
    if (!adminsSnapshot.empty) {
        const batch = adminDb!.batch();
        adminsSnapshot.forEach(adminDoc => {
            const taskRef = adminDb!.collection('tasks').doc();
            batch.set(taskRef, {
                authorId: requestingEmployeeId, recipientId: adminDoc.id, recipientIds: [adminDoc.id],
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

        await studentRef.update({ deletionRequested: { requestedBy: employeeId, reason: reason, requestedAt: new Date().toISOString(), status: 'pending' } });

        const adminsSnap = await adminDb!.collection('users').where('role', '==', 'admin').get();
        if (!adminsSnap.empty) {
            const student = (await studentRef.get()).data() as Student;
            const batch = adminDb!.batch();
            adminsSnap.forEach(adminDoc => {
                const taskRef = adminDb!.collection('tasks').doc();
                batch.set(taskRef, { authorId: employeeId, recipientId: adminDoc.id, recipientIds: [adminDoc.id], content: `Deletion request for ${student.name}: ${reason}`, status: 'new', category: 'request', createdAt: new Date().toISOString(), replies: [] });
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
            batch.update(doc.ref, { 
                employeeId: toEmployee.civilId, isNewForEmployee: true,
                transferHistory: [...(doc.data().transferHistory || []), { fromEmployeeId: fromEmployee.civilId, toEmployeeId: toEmployee.civilId, date: new Date().toISOString(), transferredBy: adminId }]
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
        await studentRef.update({ employeeNotes: FieldValue.arrayUnion({ id: `note-${Date.now()}`, authorId, content, createdAt: new Date().toISOString() }) });
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
        await studentRef.update({ adminNotes: FieldValue.arrayUnion({ id: `note-admin-${Date.now()}`, authorId, content, createdAt: new Date().toISOString() }) });
        return { success: true, message: 'Admin note added.' };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}

export async function addMissingItemToStudent(studentId: string, item: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
    try {
        await adminDb!.collection('students').doc(studentId).update({ missingItems: FieldValue.arrayUnion(item), newMissingItemsForEmployee: FieldValue.increment(1) });
        return { success: true, message: 'Missing item added.' };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}

export async function removeMissingItemFromStudent(studentId: string, itemToRemove: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
    try {
        await adminDb!.collection('students').doc(studentId).update({ missingItems: FieldValue.arrayRemove(itemToRemove) });
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
            unreadUpdates: FieldValue.increment(1)
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
        if (!studentDoc.exists) return { success: false, message: "Student not found." };
        const author = await getUser(authorId);
        if (!author || author.civilId !== studentDoc.data()!.employeeId) return { success: false, message: 'Unauthorized.' };
        await adminDb!.collection('students').doc(studentId).update({ [`profileCompletionStatus.${itemKey}`]: value });
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

    const oldChoice = studentData.finalChoiceUniversity;
    await studentRef.update({ finalChoiceUniversity: university, adminNotes: FieldValue.arrayUnion({ id: `note-finalize-${Date.now()}`, authorId: updaterId, content: `${updater.name} set final choice to ${university}.`, createdAt: new Date().toISOString() }) });

    if (updater.role === 'employee') {
        const adminsSnapshot = await adminDb!.collection('users').where('role', '==', 'admin').get();
        if (!adminsSnapshot.empty) {
            const batch = adminDb!.batch();
            adminsSnapshot.forEach(adminDoc => {
                batch.set(adminDb!.collection('tasks').doc(), { authorId: updaterId, recipientId: adminDoc.id, recipientIds: [adminDoc.id], content: `Final choice set for ${studentData.name} to ${university}.`, createdAt: new Date().toISOString(), status: 'new', category: 'system', replies: [] });
            });
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
        await studentRef.update({ documents: updatedDocs });
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
  if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
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
    const studentsInRange = allStudents.filter(s => isWithinInterval(parseISO(s.createdAt), interval));
    const appsInRange = allStudents.flatMap(s => s.applications || []).filter(app => isWithinInterval(parseISO(app.updatedAt), interval));
    const stats: ReportStats = {
      totalStudents: allStudents.length, 
      totalApplications: allStudents.reduce((acc, s) => acc + (s.applications?.length || 0), 0), 
      totalEmployees: allUsers.filter(u => u.role === 'employee').length,
      applicationStatusData: Object.entries(appsInRange.reduce((acc, app) => { acc[app.status] = (acc[app.status] || 0) + 1; return acc; }, {} as Record<string, number>)).map(([name, count]) => ({ name, count })),
      studentEmployeeData: Object.entries(allStudents.reduce((acc, s) => { const name = s.employeeId ? allUsers.find(u => u.civilId === s.employeeId)?.name || 'Unassigned' : 'Unassigned'; acc[name] = (acc[name] || 0) + 1; return acc; }, {} as Record<string, number>)).map(([name, count]) => ({ name, count })),
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
    await studentRef.update({ ieltsOverall: overallScore, adminNotes: FieldValue.arrayUnion({ id: `note-ielts-${Date.now()}`, authorId, content: `IELTS updated to ${overallScore.toFixed(1)}.`, createdAt: new Date().toISOString() }) });
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
        await studentRef.update({ studentLogins: FieldValue.arrayUnion({ id: `login-${Date.now()}`, username, password, description, notes, createdAt: new Date().toISOString() }) });
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
        await studentRef.update({ studentLogins: updatedLogins });
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
        await adminDb!.collection('students').doc(studentId).update({ targetCountries: countries, adminNotes: FieldValue.arrayUnion({ id: `note-target-${Date.now()}`, authorId: updaterId, content: `Target countries set to: ${countries.join(', ')}`, createdAt: new Date().toISOString() }) });
        return { success: true, message: 'Target countries updated.' };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}

export async function updateStudentAcademicIntake(studentId: string, semester: string, year: number, updaterId: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
    try {
        await adminDb!.collection('students').doc(studentId).update({ academicIntakeSemester: semester, academicIntakeYear: year, adminNotes: FieldValue.arrayUnion({ id: `note-intake-${Date.now()}`, authorId: updaterId, content: `Academic intake updated to: ${semester} ${year}`, createdAt: new Date().toISOString() }) });
        return { success: true, message: 'Academic intake updated.' };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}
