
'use server';

import { adminDb, adminAuth, storage } from '@/lib/firebase/admin';
import type { User, Student, Application, ApplicationStatus, Task, Note, TaskStatus, Country, UserRole, ProfileCompletionStatus } from './types';
import { sendTypedWhatsAppMessage, NotificationType } from './whatsapp-templates';
import * as xlsx from 'xlsx';

// Helper to check if adminDb is available
function checkAdminServices() {
  if (!adminDb || !adminAuth || !storage) {
    console.error('Firebase Admin not initialized. Check FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 env var.');
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

// --- NOTIFICATION ACTIONS ---

async function sendWhatsAppMessage(userId: string, type: NotificationType, data: Record<string, string>) {
  if (!checkAdminServices()) return { success: false, message: 'Server database not available.' };

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
  if (!checkAdminServices()) return { success: false, message: 'Server database not available.' };
  
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
      console.log(`Action: Notify employee ${employeeId} about new application for ${studentName}`);
    }

    return { success: true, message: `Application for ${universityName} added.` };
  } catch (error) {
    console.error('addApplication error:', error);
    return { success: false, message: 'Failed to add application.' };
  }
}

export async function updateApplicationStatus(studentId: string, universityName: string, major: string, newStatus: ApplicationStatus, studentName: string, employeeId: string | null) {
  if (!checkAdminServices()) return { success: false, message: 'Server database not available.' };

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
    if (!checkAdminServices()) return { success: false, message: 'Server database not available.' };
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
    if (!checkAdminServices()) return { success: false, message: 'Server database not available.' };
    
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
    if (!checkAdminServices()) return { success: false, message: 'Server database not available.' };

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
    if (!checkAdminServices()) return { success: false, message: 'Server database not available.' };
    try {
        await adminDb!.collection('tasks').doc(taskId).update({ status });
        return { success: true, message: 'Status updated.' };
    } catch(error) {
        console.error('updateTaskStatus error:', error);
        return { success: false, message: 'Failed to update task status.' };
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
}) {
  if (!checkAdminServices()) {
    return { success: false, message: 'Admin services not available.' };
  }

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
    };

    await adminDb!.collection('users').doc(authUser.uid).set(newUserForDb);
    
    return { success: true, message: `${userData.name} has been added.` };
  } catch (error: any) {
    console.error("Error creating user:", error);
    let message = 'An unexpected error occurred during user creation.';
    if (error.code === 'auth/email-already-exists') {
      message = 'This email address is already in use by another account.';
    } else if (error.code === 'auth/invalid-password') {
      message = 'The password must be at least 6 characters long.';
    }
    return { success: false, message: message };
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
  isForUnassigned: boolean = false
) {
  if (!checkAdminServices()) {
    return { success: false, message: 'Server database not available.' };
  }

  const { studentName, studentEmail, phone, targetCountries, otherCountry, notes } = values;

  const shouldBeAssigned = creatingUserRole === 'employee' && !isForUnassigned;

  if (shouldBeAssigned && !creatingUserCivilId) {
    return {
      success: false,
      message:
        'Your Civil ID is missing. Admin must add it before you can create assigned students.',
    };
  }
  
  let finalTargetCountries = targetCountries;
  if (otherCountry && otherCountry.trim()) {
      finalTargetCountries = [...finalTargetCountries, otherCountry.trim()];
  }

  try {
    const studentRef = adminDb!.collection('students').doc(); // Auto-generate ID
    const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(
      studentName
    )}&background=random&color=fff`;

    const newStudentData: Student = {
      id: studentRef.id,
      name: studentName,
      email: studentEmail || '',
      phone: phone,
      employeeId: shouldBeAssigned ? creatingUserCivilId! : null,
      ...(shouldBeAssigned && { isNewForEmployee: true }),
      avatarUrl,
      applications: [],
      notes: notes
        ? [
            {
              id: `note-${Date.now()}`,
              authorId: creatingUserId,
              content: notes,
              createdAt: new Date().toISOString(),
            },
          ]
        : [],
      documents: [],
      createdAt: new Date().toISOString(),
      createdBy: creatingUserId,
      targetCountries: finalTargetCountries as Country[],
      missingItems: [],
      pipelineStatus: 'none',
      profileCompletionStatus: {
        submitUniversityApplication: false,
        applyMoheScholarship: false,
        submitKcoRequest: false,
        receivedCasOrI20: false,
        appliedForVisa: false,
        visaGranted: false,
        documentsSubmittedToMohe: false,
        medicalFitnessSubmitted: false,
        financialStatementsProvided: false,
        readyToTravel: false,
      },
    };

    await studentRef.set(newStudentData);

    return { success: true, studentId: studentRef.id, studentName };
  } catch (error) {
    console.error('createStudent error:', error);
    return { success: false, message: 'Failed to create student on the server.' };
  }
}

export async function transferStudent(studentId: string, newEmployee: User, adminId: string, studentName: string, fromEmployeeName: string | null) {
    if (!checkAdminServices()) return { success: false, message: 'Server database not available.' };
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

export async function requestTransfer(studentId: string, reason: string, requestingEmployeeId: string, studentName: string) {
  if (!checkAdminServices()) return { success: false, message: 'Server database not available.' };
  
  try {
    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) return { success: false, message: 'Student not found.' };

    const employee = await getUser(requestingEmployeeId);
    if (!employee) return { success: false, message: 'Requesting employee not found.' };

    // 1. Set transferRequested flag on student
    await studentRef.update({ transferRequested: true });

    // 2. Add a note about the request
    const studentData = studentDoc.data() as Student;
    const newNote: Note = {
      id: `note-transfer-req-${Date.now()}`,
      authorId: requestingEmployeeId,
      content: `Transfer requested. Reason: ${reason}`,
      createdAt: new Date().toISOString(),
    };
    await studentRef.update({ notes: [...(studentData.notes || []), newNote] });

    // 3. Create a task for all admins
    const taskContent = `Employee ${employee.name} has requested to transfer student ${studentName}. Reason: ${reason}. Please go to the student's profile to approve the transfer.`;
    
    const adminsSnapshot = await adminDb!.collection('users').where('role', '==', 'admin').get();
    if (adminsSnapshot.empty) {
        console.log('No admins found to create transfer request task for.');
    } else {
        const batch = adminDb!.batch();
        adminsSnapshot.forEach(adminDoc => {
            const taskRef = adminDb!.collection('tasks').doc();
            const newTask: Omit<Task, 'id'> = {
                authorId: requestingEmployeeId,
                recipientId: adminDoc.id,
                content: taskContent,
                createdAt: new Date().toISOString(),
                status: 'new',
                replies: []
            };
            batch.set(taskRef, newTask);
        });
        await batch.commit();
    }
    
    return { success: true, message: 'Transfer request submitted. An admin will review it.' };
  } catch (error) {
    console.error('requestTransfer error:', error);
    return { success: false, message: 'Failed to submit transfer request.' };
  }
}

export async function bulkTransferStudents(fromEmployeeId: string, toEmployeeId: string, adminId: string) {
    if (!checkAdminServices()) {
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

export async function addNoteToStudent(studentId: string, authorId: string, content: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database not available.' };
    try {
        const studentRef = adminDb!.collection('students').doc(studentId);
        const studentDoc = await studentRef.get();
        if (!studentDoc.exists) return { success: false, message: 'Student not found.' };
        
        const studentData = studentDoc.data() as Student;
        const newNote: Note = {
            id: `note-${Date.now()}`,
            authorId: authorId,
            content: content,
            createdAt: new Date().toISOString(),
        };
        const updatedNotes = [...(studentData.notes || []), newNote];
        await studentRef.update({ notes: updatedNotes });
        return { success: true, message: 'Note added.' };
    } catch (error) {
        console.error('addNoteToStudent error:', error);
        return { success: false, message: 'Failed to add note.' };
    }
}

export async function addMissingItemToStudent(studentId: string, item: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database not available.' };
    try {
        const studentRef = adminDb!.collection('students').doc(studentId);
        const studentDoc = await studentRef.get();
        if (!studentDoc.exists) return { success: false, message: 'Student not found.' };

        const studentData = studentDoc.data() as Student;
        const updatedItems = [...(studentData.missingItems || []), item];
        const updates = {
            missingItems: updatedItems,
            newMissingItemsForEmployee: (studentData.newMissingItemsForEmployee || 0) + 1,
        };
        await studentRef.update(updates);
        return { success: true, message: 'Missing item added.' };
    } catch (error) {
        console.error('addMissingItemToStudent error:', error);
        return { success: false, message: 'Failed to add missing item.' };
    }
}

export async function removeMissingItemFromStudent(studentId: string, itemToRemove: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database not available.' };
    try {
        const studentRef = adminDb!.collection('students').doc(studentId);
        const studentDoc = await studentRef.get();
        if (!studentDoc.exists) return { success: false, message: 'Student not found.' };

        const studentData = studentDoc.data() as Student;
        const updatedItems = (studentData.missingItems || []).filter(item => item !== itemToRemove);
        await studentRef.update({ missingItems: updatedItems });
        return { success: true, message: 'Missing item removed.' };
    } catch (error) {
        console.error('removeMissingItemFromStudent error:', error);
        return { success: false, message: 'Failed to remove missing item.' };
    }
}

export async function markMissingItemAsReceived(studentId: string, itemReceived: string, userId: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database not available.' };
    try {
        const studentRef = adminDb!.collection('students').doc(studentId);
        const studentDoc = await studentRef.get();
        if (!studentDoc.exists) return { success: false, message: 'Student not found.' };

        const studentData = studentDoc.data() as Student;
        const updatedItems = (studentData.missingItems || []).filter(item => item !== itemReceived);
        
        const newNote: Note = {
            id: `note-item-received-${Date.now()}`,
            authorId: userId,
            content: `Marked missing item as received: "${itemReceived}"`,
            createdAt: new Date().toISOString(),
        };

        const updates = {
            missingItems: updatedItems,
            notes: [...(studentData.notes || []), newNote],
            unreadUpdates: (studentData.unreadUpdates || 0) + 1,
        };
        await studentRef.update(updates);
        return { success: true, message: 'Item marked as received.' };
    } catch (error) {
        console.error('markMissingItemAsReceived error:', error);
        return { success: false, message: 'Failed to mark item as received.' };
    }
}


// --- TODO ACTIONS ---

export async function addTodo(userId: string, content: string) {
  if (!checkAdminServices()) return { success: false, message: 'DB not available' };
  
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
    if (!checkAdminServices()) return { success: false, message: 'DB not available' };
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
    if (!checkAdminServices()) return { success: false, message: 'DB not available' };
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

export async function updateChecklistItem(studentId: string, itemKey: keyof ProfileCompletionStatus, value: boolean) {
    if (!checkAdminServices()) {
        return { success: false, message: 'Server database not available.' };
    }

    try {
        const studentRef = adminDb!.collection('students').doc(studentId);
        // Use dot notation to update a field in a map
        await studentRef.update({
            [`profileCompletionStatus.${itemKey}`]: value
        });
        return { success: true, message: 'Checklist updated.' };
    } catch (error) {
        console.error('updateChecklistItem error:', error);
        return { success: false, message: 'Failed to update checklist item.' };
    }
}

export async function updateFinalChoice(studentId: string, universityName: string, adminId: string, studentName: string, employeeId: string | null) {
  if (!checkAdminServices()) {
    return { success: false, message: 'Server database not available.' };
  }
  try {
    const studentRef = adminDb!.collection('students').doc(studentId);
    
    const newNote: Note = {
      id: `note-finalize-${Date.now()}`,
      authorId: adminId,
      content: `Final university choice set to: ${universityName}.`,
      createdAt: new Date().toISOString(),
    };

    const studentDoc = await studentRef.get();
    const studentData = studentDoc.data() as Student;
    const updatedNotes = [...(studentData.notes || []), newNote];

    await studentRef.update({
      finalChoiceUniversity: universityName,
      notes: updatedNotes,
    });
    
    // Notify the assigned employee
    if (employeeId) {
        const employeeQuery = await adminDb!.collection('users').where('civilId', '==', employeeId).limit(1).get();
        if (!employeeQuery.empty) {
            const employeeDoc = employeeQuery.docs[0];
            const employee = { id: employeeDoc.id, ...employeeDoc.data() } as User;
            if (employee.phone) {
                await sendWhatsAppMessage(employee.id, NotificationType.GENERIC_NOTIFICATION, { "1": employee.name });
                console.log(`Sent final choice notification to ${employee.name}`);
            }
        }
    }

    return { success: true, message: `Final choice for ${studentName} set to ${universityName}.` };
  } catch (error) {
    console.error('updateFinalChoice error:', error);
    return { success: false, message: 'Failed to update final choice.' };
  }
}

export async function importStudentsFromExcel(formData: FormData) {
  if (!checkAdminServices()) {
    return { success: false, message: 'Server database not available.' };
  }

  const file = formData.get('file') as File | null;
  const userId = formData.get('userId') as string | null;

  if (!file || !userId) {
    return { success: false, message: 'File or user ID missing.' };
  }
  
  const uploader = await getUser(userId);
  if (!uploader) {
      return { success: false, message: 'Could not identify the importing user.' };
  }

  try {
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const workbook = xlsx.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet) as any[];

    if (data.length === 0) {
      return { success: false, message: 'The Excel file is empty or in an incorrect format.' };
    }

    const batch = adminDb!.batch();
    let importedCount = 0;

    for (const row of data) {
      const name = row.Name || row.name;
      const email = row.Email || row.email;
      const phone = String(row.Phone || row.phone || '');

      if (!name || (!email && !phone)) {
        continue;
      }

      const newStudentRef = adminDb!.collection('students').doc(); // Auto-generate ID
      const avatarUrl = `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random&color=fff`;

      const newStudentData: Omit<Student, 'id'> = {
        name,
        email: email || '',
        phone,
        employeeId: null, // Always unassigned on import
        avatarUrl,
        applications: [],
        notes: [],
        documents: [],
        createdAt: new Date().toISOString(),
        createdBy: userId,
        targetCountries: [],
        missingItems: [],
        pipelineStatus: 'none',
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
        },
      };

      batch.set(newStudentRef, newStudentData);
      importedCount++;
    }

    if (importedCount === 0) {
      return { success: false, message: 'No valid student data found in the file. Check column names (Name, Email, Phone).' };
    }

    await batch.commit();

    // Create a task for admins to notify them of the import
    const taskContent = `User ${uploader.name} has bulk-imported ${importedCount} students from the file '${file.name}'. Please review the new student profiles and assign them as needed.`;
    const adminsSnapshot = await adminDb!.collection('users').where('role', '==', 'admin').get();
    
    if (!adminsSnapshot.empty) {
        const adminBatch = adminDb!.batch();
        adminsSnapshot.forEach(adminDoc => {
            const taskRef = adminDb!.collection('tasks').doc();
            const newTask: Omit<Task, 'id'> = {
                authorId: userId,
                recipientId: adminDoc.id,
                content: taskContent,
                createdAt: new Date().toISOString(),
                status: 'new',
                replies: []
            };
            adminBatch.set(taskRef, newTask);
        });
        await adminBatch.commit();
    }
    
    return { success: true, message: `${importedCount} students were imported successfully and are now in the 'Unassigned' list.` };

  } catch (error) {
    console.error('Error importing students from Excel:', error);
    return { success: false, message: 'An error occurred while processing the file. Ensure it is a valid .xlsx, .xls, or .csv file.' };
  }
}

export async function onDocumentUploaded(documentId: string, studentId: string, documentName: string, uploaderId: string) {
  if (!checkAdminServices()) return { success: false, message: 'Server database not available.' };
  
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
                if (employee.phone) {
                    recipientId = employee.id;
                    notificationType = NotificationType.DOCUMENT_UPLOAD_TO_EMPLOYEE;
                    notificationData = { "1": employee.name, "2": documentName, "3": student.name };
                }
            }
        }
    }

    if (recipientId && notificationType!) {
      await sendWhatsAppMessage(recipientId, notificationType!, notificationData);
    }

    return { success: true, message: 'Document upload notification processed.' };
  } catch (error) {
    console.error('Error in onDocumentUploaded:', error);
    return { success: false, message: String(error) };
  }
}

async function deleteCollection(collectionPath: string, batchSize: number = 100) {
    if (!adminDb) return;
    const collectionRef = adminDb.collection(collectionPath);
    const query = collectionRef.limit(batchSize);

    return new Promise<void>((resolve, reject) => {
        deleteQueryBatch(query, resolve, reject).catch(reject);
    });
}

async function deleteQueryBatch(query: FirebaseFirestore.Query, resolve: (value: void) => void, reject: (reason?: any) => void) {
    if (!adminDb) {
        return reject('adminDb not initialized');
    }
    const snapshot = await query.get();

    if (snapshot.size === 0) {
        return resolve();
    }

    const batch = adminDb.batch();
    snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
    });

    await batch.commit();

    process.nextTick(() => {
        deleteQueryBatch(query, resolve, reject);
    });
}

export async function deleteStudent(studentId: string, adminId: string) {
    if (!checkAdminServices()) {
        return { success: false, message: 'Server database not available.' };
    }

    try {
        const adminUser = await getUser(adminId);
        if (!adminUser || adminUser.role !== 'admin') {
            return { success: false, message: 'Unauthorized action. Only admins can delete students.' };
        }

        const studentRef = adminDb!.collection('students').doc(studentId);
        const studentDoc = await studentRef.get();

        if (!studentDoc.exists) {
            return { success: false, message: 'Student not found.' };
        }
        const studentData = studentDoc.data() as Student;

        // 1. Delete associated files from Storage
        if (storage) {
            const bucket = storage.bucket();
            const fileDeletionPromises = (studentData.documents || []).map(doc => {
                try {
                    const url = new URL(doc.url);
                    const bucketName = bucket.name;
                    let filePath = decodeURIComponent(url.pathname.substring(1));
                    if (filePath.startsWith(`${bucketName}/`)) {
                        filePath = filePath.substring(bucketName.length + 1);
                    }
                    
                    if(filePath) {
                        console.log(`Deleting file from storage: ${filePath}`);
                        return bucket.file(filePath).delete().catch(err => {
                            console.error(`Failed to delete file ${filePath}:`, err.message);
                        });
                    }
                } catch (e) {
                    console.error(`Invalid document URL, skipping deletion: ${doc.url}`, e);
                }
                return Promise.resolve();
            });
            await Promise.all(fileDeletionPromises);
        }
        
        // 2. Delete chat subcollection
        const chatCollectionPath = `chats/${studentId}/messages`;
        await deleteCollection(chatCollectionPath);
        const chatParentDoc = adminDb!.collection('chats').doc(studentId);
        if((await chatParentDoc.get()).exists) {
            await chatParentDoc.delete();
        }
        
        // 3. Delete student document
        await studentRef.delete();

        // 4. Create task for other admins
        const taskContent = `Admin ${adminUser.name} has permanently deleted the profile for student: ${studentData.name} (ID: ${studentId}).`;
        const adminsSnapshot = await adminDb!.collection('users')
            .where('role', '==', 'admin')
            .where(adminDb!.FieldPath.documentId(), '!=', adminId)
            .get();

        if (!adminsSnapshot.empty) {
            const adminBatch = adminDb!.batch();
            adminsSnapshot.forEach(doc => {
                const taskRef = adminDb!.collection('tasks').doc();
                const newTask: Omit<Task, 'id'> = {
                    authorId: adminId,
                    recipientId: doc.id,
                    content: taskContent,
                    createdAt: new Date().toISOString(),
                    status: 'new',
                    replies: []
                };
                adminBatch.set(taskRef, newTask);
            });
            await adminBatch.commit();
        }

        return { success: true, message: `Student ${studentData.name} deleted successfully.` };
    } catch (error: any) {
        console.error('deleteStudent error:', error);
        return { success: false, message: 'An unexpected server error occurred while deleting the student.' };
    }
}
