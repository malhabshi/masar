
'use server';

import { adminDb, adminAuth, storage } from '@/lib/firebase/admin';
import { FieldPath } from 'firebase-admin/firestore';
import type { User, Student, Application, ApplicationStatus, Task, Note, TaskStatus, Country, UserRole, ProfileCompletionStatus, TimeLog, ReportStats, UpcomingEvent, EmployeeStats, Document as StudentDoc } from './types';
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
    console.error('CRITICAL: Firebase Admin not initialized. Check server logs for "CRITICAL" errors regarding FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 or SDK initialization.');
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

// --- APPLICATION ACTIONS ---

export async function addApplication(studentId: string, universityName: string, country: string, major: string, studentName: string, employeeId: string | null) {
  if (!checkAdminServices()) return { success: false, message: 'Server database connection not available. Please check server logs for configuration errors.' };
  
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
          const newTask: Omit<Task, 'id'> = {
              authorId: 'system',
              recipientId: employeeDocId,
              content: taskContent,
              createdAt: new Date().toISOString(),
              status: 'new',
              replies: []
          };
          await adminDb!.collection('tasks').add(newTask);
      }
    }

    return { success: true, message: `Application for ${universityName} added.` };
  } catch (error) {
    console.error('addApplication error:', error);
    return { success: false, message: 'Failed to add application.' };
  }
}

export async function updateApplicationStatus(studentId: string, universityName: string, major: string, newStatus: ApplicationStatus, studentName: string, employeeId: string | null) {
  if (!checkAdminServices()) return { success: false, message: 'Server database connection not available. Please check server logs for configuration errors.' };

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
            const taskContent = `The status for ${studentName}'s application to ${universityName} (${major}) has been updated to: ${newStatus}.`;
            const newTask: Omit<Task, 'id'> = {
                authorId: 'system',
                recipientId: employeeDocId,
                content: taskContent,
                createdAt: new Date().toISOString(),
                status: 'new',
                replies: []
            };
            await adminDb!.collection('tasks').add(newTask);
        }
    }

    return { success: true, message: 'Status updated.' };
  } catch (error) {
    console.error('updateApplicationStatus error:', error);
    return { success: false, message: 'Failed to update status.' };
  }
}

export async function updateStudentPipelineStatus(studentId: string, status: string, userName: string, studentName: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available. Please check server logs for configuration errors.' };
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
        await studentRef.update({ adminNotes: [...(studentData.adminNotes || []), newNote] });
        
        return { success: true, message: 'Status updated.' };
    } catch(error) {
        console.error('updateStudentPipelineStatus error:', error);
        return { success: false, message: 'Failed to update pipeline status.' };
    }
}

// --- TASK ACTIONS ---

export async function createStudentTask(authorId: string, studentId: string, requestTypeId: string, description: string) {
    if (!checkAdminServices()) {
        return { success: false, message: 'Server database connection not available. Please check server logs for configuration errors.' };
    }

    try {
        const requestTypeRef = adminDb!.collection('request_types').doc(requestTypeId);
        const requestTypeDoc = await requestTypeRef.get();
        if (!requestTypeDoc.exists) {
            return { success: false, message: 'Selected request type not found.' };
        }
        const requestTypeData = requestTypeDoc.data() as { name: string; defaultRecipientId: string };

        const studentRef = adminDb!.collection('students').doc(studentId);
        const studentDoc = await studentRef.get();
        if (!studentDoc.exists) {
            return { success: false, message: 'Student not found.' };
        }
        const studentData = studentDoc.data() as Student;

        const newTask: Omit<Task, 'id'> = {
            authorId,
            recipientId: requestTypeData.defaultRecipientId,
            content: description,
            createdAt: new Date().toISOString(),
            status: 'new',
            replies: [],
            studentId: studentId,
            studentName: studentData.name,
            taskType: requestTypeData.name,
        };

        await adminDb!.collection('tasks').add(newTask);
        
        return { success: true, message: 'Task created successfully and routed to the appropriate user.' };
    } catch (error) {
        console.error('createStudentTask error:', error);
        return { success: false, message: 'Failed to create task.' };
    }
}

export async function sendTask(authorId: string, recipientId: string, content: string) {
    if (!checkAdminServices()) {
        console.error('adminDb is null - check FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 env var');
        return { success: false, message: 'Server database connection not available - check service account' };
    }
    
    try {
        const author = await getUser(authorId);
        if (!author || !['admin', 'department'].includes(author.role)) {
            return { success: false, message: 'You do not have permission to send tasks.' };
        }

        const newTask: Omit<Task, 'id'> = {
            authorId,
            recipientId,
            content,
            createdAt: new Date().toISOString(),
            status: 'new',
            replies: []
        };
        await adminDb!.collection('tasks').add(newTask);
        
        return { success: true, message: 'Update sent.' };

    } catch(error) {
        console.error('sendTask error:', error);
        return { success: false, message: 'Failed to send task.' };
    }
}

export async function addReplyToTask(taskId: string, authorId: string, content: string, taskAuthorId: string) {
    if (!checkAdminServices()) {
      return { success: false, message: 'Server database connection not available. Please check server logs for configuration errors.' };
    }

    try {
        const author = await getUser(authorId);
        // Only Admins and department can reply
        if (!author || !['admin', 'department'].includes(author.role)) {
            return { success: false, message: 'You do not have permission to reply to tasks.' };
        }

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

        // Notify the original employee if an admin/dept replies
        if (taskData.authorId !== authorId) {
          const originalAuthor = await getUser(taskData.authorId);
          if (originalAuthor && originalAuthor.role === 'employee') {
            const taskContent = `${author.name} replied to your task: "${taskData.content.substring(0, 30)}..."`;
            const notificationTask: Omit<Task, 'id'> = {
              authorId: 'system',
              recipientId: taskData.authorId,
              content: taskContent,
              createdAt: new Date().toISOString(),
              status: 'new',
              replies: [],
            };
            await adminDb!.collection('tasks').add(notificationTask);
          }
        }
        
        return { success: true, message: 'Reply sent.' };
    } catch (error) {
        console.error('addReplyToTask error:', error);
        return { success: false, message: 'Failed to add reply.' };
    }
}

export async function updateTaskStatus(taskId: string, status: TaskStatus, updaterId: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available. Please check server logs for configuration errors.' };
    try {
        const updater = await getUser(updaterId);
        if (!updater || !['admin', 'department'].includes(updater.role)) {
            return { success: false, message: 'You do not have permission to update task status.' };
        }

        const taskRef = adminDb!.collection('tasks').doc(taskId);
        await taskRef.update({ status });

        const taskDoc = await taskRef.get();
        const taskData = taskDoc.data() as Task;

        // Notify the original task author about the status change, if they aren't the one who changed it.
        if (taskData.authorId !== updaterId) {
            const author = await getUser(taskData.authorId);
            if (author) {
                 const taskContent = `The status of your task "${taskData.content.substring(0, 30)}..." was updated to '${status}' by ${updater.name}.`;
                 const notificationTask: Omit<Task, 'id'> = {
                    authorId: 'system',
                    recipientId: author.id,
                    content: taskContent,
                    createdAt: new Date().toISOString(),
                    status: 'new',
                    replies: []
                };
                await adminDb!.collection('tasks').add(notificationTask);
            }
        }
        
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
) {
  if (!checkAdminServices()) {
    return { success: false, message: 'Server database connection not available. Please check server logs for configuration errors.' };
  }

  const { studentName, studentEmail, phone, targetCountries, otherCountry, notes } = values;

  const shouldBeAssigned = creatingUserRole === 'employee';

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

    const newStudentData: Omit<Student, 'avatarUrl' | 'ielts'> = {
      id: studentRef.id,
      name: studentName,
      email: studentEmail || '',
      phone: phone,
      employeeId: shouldBeAssigned ? creatingUserCivilId! : null,
      ...(shouldBeAssigned && { isNewForEmployee: true }),
      applications: [],
      employeeNotes: notes
        ? [
            {
              id: `note-${Date.now()}`,
              authorId: creatingUserId,
              content: notes,
              createdAt: new Date().toISOString(),
            },
          ]
        : [],
      adminNotes: [],
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
        documentsSubmittedToMohe: false,
        readyToTravel: false,
        financialStatementsProvided: false,
        visaGranted: false,
        medicalFitnessSubmitted: false
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
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available. Please check server logs for configuration errors.' };
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
            adminNotes: [...(studentData.adminNotes || []), newNote]
        };

        await studentRef.update(updates);

        if (newEmployee.id) {
            const taskContent = `The student '${studentName}' has been transferred to you.`;
            const newTask: Omit<Task, 'id'> = {
                authorId: adminId,
                recipientId: newEmployee.id,
                content: taskContent,
                createdAt: new Date().toISOString(),
                status: 'new',
                replies: []
            };
            await adminDb!.collection('tasks').add(newTask);
        }

        return { success: true, message: `Student ${studentName} transferred to ${newEmployee.name}.` };
    } catch (error) {
        console.error('transferStudent error:', error);
        return { success: false, message: 'Failed to transfer student.' };
    }
}

export async function requestTransfer(studentId: string, reason: string, requestingEmployeeId: string, studentName: string) {
  if (!checkAdminServices()) return { success: false, message: 'Server database connection not available. Please check server logs for configuration errors.' };
  
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
    await studentRef.update({ adminNotes: [...(studentData.adminNotes || []), newNote] });

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

export async function requestStudentDeletion(studentId: string, employeeId: string, reason: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
    
    try {
        const studentRef = adminDb!.collection('students').doc(studentId);
        const employee = await getUser(employeeId);
        
        if (!employee || employee.id !== employeeId) return { success: false, message: "Invalid employee." };

        const deletionRequest = {
            requestedBy: employeeId,
            reason: reason,
            requestedAt: new Date().toISOString(),
            status: 'pending' as const
        };

        await studentRef.update({ deletionRequested: deletionRequest });

        // Notify admins
        const adminsSnap = await adminDb!.collection('users').where('role', '==', 'admin').get();
        if (!adminsSnap.empty) {
            const student = (await studentRef.get()).data() as Student;
            const batch = adminDb!.batch();
            const taskContent = `Employee ${employee.name} has requested deletion for student ${student.name}. Reason: ${reason}`;
            adminsSnap.forEach(adminDoc => {
                const taskRef = adminDb!.collection('tasks').doc();
                const newTask: Omit<Task, 'id'> = {
                    authorId: employeeId,
                    recipientId: adminDoc.id,
                    content: taskContent,
                    status: 'new',
                    createdAt: new Date().toISOString(),
                    replies: []
                };
                batch.set(taskRef, newTask);
            });
            await batch.commit();
        }

        return { success: true, message: 'Deletion request submitted.' };
    } catch (error) {
        console.error('requestStudentDeletion error:', error);
        return { success: false, message: 'Failed to submit deletion request.' };
    }
}


export async function bulkTransferStudents(fromEmployeeId: string, toEmployeeId: string, adminId: string) {
    if (!checkAdminServices()) {
        return { success: false, message: 'Server database connection not available. Please check server logs for configuration errors.' };
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
        return { success: false, message: 'An unexpected error occurred during the bulk transfer.' };
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
        if (author.role === 'employee' && author.civilId !== studentData.employeeId) {
            return { success: false, message: 'Only the assigned employee can add notes to this section.' };
        }
        
        const newNote: Note = {
            id: `note-${Date.now()}`,
            authorId: authorId,
            content: content,
            createdAt: new Date().toISOString(),
        };
        await studentRef.update({ employeeNotes: [...(studentData.employeeNotes || []), newNote] });
        return { success: true, message: 'Note added.' };
    } catch (error) {
        console.error('addEmployeeNote error:', error);
        return { success: false, message: 'Failed to add employee note.' };
    }
}

export async function addAdminNote(studentId: string, authorId: string, content: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
    try {
        const studentRef = adminDb!.collection('students').doc(studentId);
        const studentDoc = await studentRef.get();
        if (!studentDoc.exists) return { success: false, message: 'Student not found.' };

        const author = await getUser(authorId);
        if (!author || !['admin', 'department'].includes(author.role)) {
            return { success: false, message: 'Only admins or department users can add notes to this section.' };
        }
        
        const studentData = studentDoc.data() as Student;
        const newNote: Note = {
            id: `note-admin-${Date.now()}`,
            authorId: authorId,
            content: content,
            createdAt: new Date().toISOString(),
        };
        await studentRef.update({ adminNotes: [...(studentData.adminNotes || []), newNote] });
        return { success: true, message: 'Admin note added.' };
    } catch (error) {
        console.error('addAdminNote error:', error);
        return { success: false, message: 'Failed to add admin note.' };
    }
}

export async function addMissingItemToStudent(studentId: string, item: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available. Please check server logs for configuration errors.' };
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
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available. Please check server logs for configuration errors.' };
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
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available. Please check server logs for configuration errors.' };
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
            adminNotes: [...(studentData.adminNotes || []), newNote],
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

export async function updateChecklistItem(studentId: string, itemKey: keyof ProfileCompletionStatus, value: boolean, authorId: string) {
    if (!checkAdminServices()) {
        return { success: false, message: 'Server database connection not available. Please check server logs for configuration errors.' };
    }

    try {
        const studentRef = adminDb!.collection('students').doc(studentId);
        const studentDoc = await studentRef.get();
        if (!studentDoc.exists) {
            return { success: false, message: "Student not found." };
        }
        const studentData = studentDoc.data() as Student;
        
        const author = await getUser(authorId);
        if (!author) {
            return { success: false, message: 'Authorizing user not found.' };
        }

        const isAssignedEmployee = author.civilId === studentData.employeeId;

        if (!isAssignedEmployee) {
            return { success: false, message: 'Only the assigned employee can update the readiness checklist.' };
        }

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

export async function setStudentFinalChoice(studentId: string, university: string, major: string, updaterId: string) {
  if (!checkAdminServices()) return { success: false, message: 'Server database connection not available. Please check server logs for configuration errors.' };
  
  try {
    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) return { success: false, message: 'Student not found.' };

    const studentData = studentDoc.data() as Student;
    const updater = await getUser(updaterId);
    if (!updater) return { success: false, message: 'Updater not found.' };
    
    // Check permissions
    const isAssignedEmployee = updater.role === 'employee' && updater.civilId === studentData.employeeId;
    const isAdminOrDept = ['admin', 'department'].includes(updater.role);
    if (!isAssignedEmployee && !isAdminOrDept) {
        return { success: false, message: 'You do not have permission to perform this action.' };
    }

    const oldChoice = studentData.finalChoiceUniversity;
    
    // Update final choice
    await studentRef.update({ finalChoiceUniversity: university });

    // Add note
    const noteContent = oldChoice
      ? `${updater.name} has changed the final choice from '${oldChoice}' to: ${university} (${major}).`
      : `${updater.name} has set the final choice to: ${university} (${major}).`;
      
    const newNote: Note = {
        id: `note-finalize-${Date.now()}`,
        authorId: updaterId,
        content: noteContent,
        createdAt: new Date().toISOString(),
    };
    await studentRef.update({ adminNotes: [...(studentData.adminNotes || []), newNote] });

    // Notify admins if employee made the choice
    if (updater.role === 'employee') {
        const adminsSnapshot = await adminDb!.collection('users').where('role', '==', 'admin').get();
        if (!adminsSnapshot.empty) {
            const taskContent = oldChoice
                ? `${updater.name} has changed the final university choice for student ${studentData.name} from '${oldChoice}' to '${university}'.`
                : `${updater.name} has set the final university choice for student ${studentData.name} to ${university}.`;
            const batch = adminDb!.batch();
            adminsSnapshot.forEach(adminDoc => {
                const taskRef = adminDb!.collection('tasks').doc();
                const newTask: Omit<Task, 'id'> = {
                    authorId: updaterId,
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
    }
    
    const successMessage = oldChoice
      ? `Final choice changed to ${university}.`
      : `Final choice set to ${university}.`;
      
    return { success: true, message: successMessage };
  } catch (error) {
    console.error('setStudentFinalChoice error:', error);
    return { success: false, message: 'Failed to set final choice.' };
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
        return { success: false, message: 'Server database connection not available. Please check server logs for configuration errors.' };
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

        // 4. Create task for relevant parties
        const batch = adminDb!.batch();

        // Notify other admins
        const adminTaskContent = `Admin ${adminUser.name} has permanently deleted the profile for student: ${studentData.name} (ID: ${studentId}).`;
        const adminsSnapshot = await adminDb!.collection('users')
            .where('role', '==', 'admin')
            .where(FieldPath.documentId(), '!=', adminId)
            .get();

        adminsSnapshot.forEach(doc => {
            const taskRef = adminDb!.collection('tasks').doc();
            const newTask: Omit<Task, 'id'> = {
                authorId: adminId,
                recipientId: doc.id,
                content: adminTaskContent,
                createdAt: new Date().toISOString(),
                status: 'new',
                replies: []
            };
            batch.set(taskRef, newTask);
        });

        // Notify the employee who requested deletion, if applicable
        if (studentData.deletionRequested?.requestedBy) {
            const employeeId = studentData.deletionRequested.requestedBy;
            const employeeTaskContent = `Your request to delete student '${studentData.name}' has been approved and completed by ${adminUser.name}.`;
            const employeeTaskRef = adminDb!.collection('tasks').doc();
            const employeeTask: Omit<Task, 'id'> = {
                authorId: adminId,
                recipientId: employeeId,
                content: employeeTaskContent,
                createdAt: new Date().toISOString(),
                status: 'new',
                replies: []
            };
            batch.set(employeeTaskRef, employeeTask);
        }

        await batch.commit();

        return { success: true, message: `Student ${studentData.name} deleted successfully.` };
    } catch (error: any) {
        console.error('deleteStudent error:', error);
        return { success: false, message: 'An unexpected server error occurred while deleting the student.' };
    }
}

export async function deleteStudentDocument(studentId: string, documentId: string, documentUrl: string, deleterId: string) {
    if (!checkAdminServices()) {
        return { success: false, message: 'Server database connection not available.' };
    }
    
    try {
        const studentRef = adminDb!.collection('students').doc(studentId);
        const studentDoc = await studentRef.get();
        if (!studentDoc.exists) {
            return { success: false, message: 'Student not found.' };
        }
        const studentData = studentDoc.data() as Student;
        const docToDelete = studentData.documents.find(d => d.id === documentId);
        
        const deleter = await getUser(deleterId);
        if (!deleter) return { success: false, message: "Invalid user." };

        const isAssignedEmployee = deleter.role === 'employee' && deleter.civilId === studentData.employeeId;
        const isAdminOrDept = ['admin', 'department'].includes(deleter.role);
        
        if (!isAssignedEmployee && !isAdminOrDept) {
            return { success: false, message: 'You do not have permission to delete documents for this student.' };
        }

        // Delete from storage
        const bucket = storage!.bucket();
        const url = new URL(documentUrl);
        const bucketName = bucket.name;
        let filePath = decodeURIComponent(url.pathname.substring(1));
        if (filePath.startsWith(`${bucketName}/`)) {
            filePath = filePath.substring(bucketName.length + 1);
        }

        if (filePath) {
            await bucket.file(filePath).delete();
        } else {
            console.warn(`Could not determine file path from URL, skipping storage deletion: ${documentUrl}`);
        }

        // Delete from Firestore array
        const updatedDocuments = (studentData.documents || []).filter(doc => doc.id !== documentId);
        const updates: { documents: StudentDoc[]; [key: string]: any } = {
            documents: updatedDocuments
        };

        if (docToDelete?.isNew) {
            const author = await getUser(docToDelete.authorId);
            if (author?.role === 'employee') {
                if (studentData.newDocumentsForAdmin && studentData.newDocumentsForAdmin > 0) {
                    updates.newDocumentsForAdmin = studentData.newDocumentsForAdmin - 1;
                }
            } else if (author?.role === 'admin' || author?.role === 'department') {
                if (studentData.newDocumentsForEmployee && studentData.newDocumentsForEmployee > 0) {
                    updates.newDocumentsForEmployee = studentData.newDocumentsForEmployee - 1;
                }
            }
        }
        
        await studentRef.update(updates);
        
        return { success: true, message: 'Document deleted successfully.' };

    } catch (error: any) {
        console.error('deleteStudentDocument error:', error);
        if (error.code === 404) {
             console.warn(`File not found in storage, but proceeding to remove Firestore entry: ${documentUrl}`);
             const studentRef = adminDb!.collection('students').doc(studentId);
             const studentDoc = await studentRef.get();
             if (studentDoc.exists) {
                const studentData = studentDoc.data() as Student;
                const updatedDocuments = (studentData.documents || []).filter(doc => doc.id !== documentId);
                await studentRef.update({ documents: updatedDocuments });
                return { success: true, message: 'Document removed from list (was not found in storage).' };
             }
        }
        return { success: false, message: 'Failed to delete document.' };
    }
}


export async function handleEmployeeLogin(userId: string) {
  if (!checkAdminServices()) return { success: false, message: 'Server database connection not available. Please check server logs for configuration errors.' };
  
  try {
    const user = await getUser(userId);
    if (!user || user.role !== 'employee') {
      return { success: true, message: 'Not an employee.' };
    }

    const timeLogsRef = adminDb!.collection('time_logs');
    
    const activeLogQuery = await timeLogsRef
      .where('employeeId', '==', userId)
      .where('clockOut', '==', null)
      .get();
      
    if (!activeLogQuery.empty) {
      const batch = adminDb!.batch();
      activeLogQuery.docs.forEach(doc => {
        batch.update(doc.ref, { clockOut: new Date().toISOString() });
      });
      await batch.commit();
      console.warn(`Closed ${activeLogQuery.size} dangling session(s) for employee ${userId}.`);
    }
    
    const newLog = {
      employeeId: userId,
      date: new Date().toISOString().split('T')[0],
      clockIn: new Date().toISOString(),
      clockOut: null,
      lastSeen: new Date().toISOString(),
    };
    
    await timeLogsRef.add(newLog);
    
    return { success: true, message: 'Login session started.' };
  } catch (error) {
    console.error('handleEmployeeLogin error:', error);
    return { success: false, message: 'Failed to start login session.' };
  }
}

export async function handleEmployeeLogout(userId: string) {
  if (!checkAdminServices()) return { success: false, message: 'Server database connection not available. Please check server logs for configuration errors.' };
  
  try {
    const timeLogsRef = adminDb!.collection('time_logs');
    
    const activeLogQuery = await timeLogsRef
      .where('employeeId', '==', userId)
      .where('clockOut', '==', null)
      .orderBy('clockIn', 'desc')
      .limit(1)
      .get();
      
    if (activeLogQuery.empty) {
      return { success: true, message: 'No active session found to close.' };
    }
    
    const logDoc = activeLogQuery.docs[0];
    await logDoc.ref.update({
      clockOut: new Date().toISOString(),
    });
    
    return { success: true, message: 'Session ended.' };
  } catch (error) {
    console.error('handleEmployeeLogout error:', error);
    return { success: false, message: 'Failed to end session.' };
  }
}

export async function keepAlive(userId: string) {
    if (!checkAdminServices()) return { success: false, message: 'DB not available' };
    try {
        const activeLogQuery = await adminDb!
            .collection('time_logs')
            .where('employeeId', '==', userId)
            .where('clockOut', '==', null)
            .orderBy('clockIn', 'desc')
            .limit(1)
            .get();

        if (!activeLogQuery.empty) {
            const logDoc = activeLogQuery.docs[0];
            await logDoc.ref.update({ lastSeen: new Date().toISOString() });
        }
        return { success: true };
    } catch (error) {
        console.error('keepAlive error:', error);
        return { success: false, message: 'Failed to update session.' };
    }
}

export async function closeInactiveSessions() {
    if (!checkAdminServices()) return { success: false, message: 'DB not available' };
    try {
        const fiveMinutesAgo = subMinutes(new Date(), 2).toISOString();
        const inactiveSessionsQuery = await adminDb!
            .collection('time_logs')
            .where('clockOut', '==', null)
            .where('lastSeen', '<', fiveMinutesAgo)
            .get();

        if (inactiveSessionsQuery.empty) {
            return { success: true, message: 'No inactive sessions to close.' };
        }

        const batch = adminDb!.batch();
        inactiveSessionsQuery.docs.forEach(doc => {
            const log = doc.data() as TimeLog;
            // Clock out at the last seen time
            batch.update(doc.ref, { clockOut: log.lastSeen });
        });
        await batch.commit();

        return { success: true, message: `Closed ${inactiveSessionsQuery.size} inactive sessions.` };
    } catch (error) {
        console.error('closeInactiveSessions error:', error);
        return { success: false, message: 'Failed to close inactive sessions.' };
    }
}

export async function updateUserAvatar(userId: string, avatarUrl: string) {
  if (!checkAdminServices()) {
    return { success: false, message: 'Server database connection not available. Please check server logs for configuration errors.' };
  }
  try {
    const userRef = adminDb!.collection('users').doc(userId);
    await userRef.update({ avatarUrl });
    return { success: true, message: 'Avatar updated successfully.' };
  } catch (error) {
    console.error('updateUserAvatar error:', error);
    return { success: false, message: 'Failed to update avatar.' };
  }
}

export async function getReportStats(dateRange: {
  from: string;
  to: string;
}): Promise<{ success: boolean; data?: ReportStats; message?: string }> {
  if (!checkAdminServices()) {
    return { success: false, message: 'Server database connection not available. Please check server logs for configuration errors.' };
  }

  try {
    const fromDate = parseISO(dateRange.from);
    const toDate = parseISO(dateRange.to);
    const interval = { start: fromDate, end: toDate };

    // Fetch all necessary data
    const [studentsSnap, usersSnap, timeLogsSnap] = await Promise.all([
      adminDb!.collection('students').get(),
      adminDb!.collection('users').get(),
      adminDb!.collection('time_logs').get(),
    ]);

    const allStudents = studentsSnap.docs.map(doc => doc.data() as Student);
    const allUsers = usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as User));
    const allTimeLogs = timeLogsSnap.docs.map(doc => doc.data() as TimeLog);

    // --- Aggregations ---

    // Filter students and applications by date range
    const studentsInDateRange = allStudents.filter(s =>
      isWithinInterval(parseISO(s.createdAt), interval)
    );
    const applicationsInDateRange = allStudents
      .flatMap(s => s.applications || [])
      .filter(app => isWithinInterval(parseISO(app.updatedAt), interval));

    // 1. Totals
    const totalStudents = allStudents.length;
    const totalApplications = allStudents.reduce(
      (acc, s) => acc + (s.applications?.length || 0),
      0
    );
    const totalEmployees = allUsers.filter(u => u.role === 'employee').length;

    // 2. Application Status (within date range)
    const statusCounts = applicationsInDateRange.reduce((acc, app) => {
      acc[app.status] = (acc[app.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const applicationStatusData = Object.entries(statusCounts).map(
      ([name, count]) => ({ name, count })
    );

    // 3. Students per Employee (snapshot, not date-based)
    const employeeMap = new Map<string, string>();
    allUsers
      .filter(u => u.role === 'employee')
      .forEach(u => u.civilId && employeeMap.set(u.civilId, u.name));

    const studentCountsByEmployee = allStudents.reduce((acc, student) => {
      const employeeName = student.employeeId
        ? employeeMap.get(student.employeeId) || 'Unassigned'
        : 'Unassigned';
      acc[employeeName] = (acc[employeeName] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const studentEmployeeData = Object.entries(studentCountsByEmployee).map(
      ([name, count]) => ({ name, count })
    );

    // 4. Student Growth (within date range)
    const growthCounts = studentsInDateRange.reduce((acc, student) => {
      const date = format(parseISO(student.createdAt), 'yyyy-MM-dd');
      acc[date] = (acc[date] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const studentGrowthData = Object.entries(growthCounts)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // 5. Applications by Country (within date range)
    const countryCounts = applicationsInDateRange.reduce((acc, app) => {
        acc[app.country] = (acc[app.country] || 0) + 1;
        return acc;
    }, {} as Record<string, number>);
    const applicationCountryData = Object.entries(countryCounts).map(([name, count]) => ({ name, count }));

    // 6. Employee Hours Logged (within date range)
    const employeeHours = allTimeLogs
      .filter(log => log.clockOut && isWithinInterval(parseISO(log.date), interval))
      .reduce((acc, log) => {
          const user = allUsers.find(u => u.id === log.employeeId);
          if (user) {
              const minutes = differenceInMinutes(parseISO(log.clockOut!), parseISO(log.clockIn));
              const hours = minutes / 60;
              acc[user.name] = (acc[user.name] || 0) + hours;
          }
          return acc;
      }, {} as Record<string, number>);
    const employeeHoursData = Object.entries(employeeHours).map(([name, hours]) => ({ name, hours: parseFloat(hours.toFixed(1))}));

    const stats: ReportStats = {
      totalStudents,
      totalApplications,
      totalEmployees,
      applicationStatusData,
      studentEmployeeData,
      studentGrowthData,
      applicationCountryData,
      employeeHoursData
    };

    return { success: true, data: stats };
  } catch (error: any) {
    console.error('getReportStats error:', error);
    return { success: false, message: 'An error occurred while generating the report data.' };
  }
}

export async function addEvent(authorId: string, title: string, description: string, date: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
    try {
        const author = await getUser(authorId);
        if (!author || !['admin', 'department'].includes(author.role)) {
            return { success: false, message: 'You do not have permission to add events.' };
        }
        const newEvent: Omit<UpcomingEvent, 'id'> = {
            authorId,
            title,
            description,
            date,
            createdAt: new Date().toISOString(),
        };
        await adminDb!.collection('upcoming_events').add(newEvent);
        return { success: true, message: 'Event added.' };
    } catch (error) {
        console.error('addEvent error:', error);
        return { success: false, message: 'Failed to add event.' };
    }
}

export async function deleteEvent(eventId: string, userId: string) {
    if (!checkAdminServices()) return { success: false, message: 'Server database connection not available.' };
    try {
        const user = await getUser(userId);
        if (!user || !['admin', 'department'].includes(user.role)) {
            return { success: false, message: 'You do not have permission to delete events.' };
        }
        await adminDb!.collection('upcoming_events').doc(eventId).delete();
        return { success: true, message: 'Event deleted.' };
    } catch (error) {
        console.error('deleteEvent error:', error);
        return { success: false, message: 'Failed to delete event.' };
    }
}


export async function getEmployeeStudentStats(): Promise<{ success: boolean; data?: EmployeeStats[]; message?: string; }> {
    if (!checkAdminServices()) return { success: false, message: "Server not available" };

    try {
        const employeesSnap = await adminDb!.collection('users').where('role', '==', 'employee').get();
        const employees = employeesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as User));

        const studentsSnap = await adminDb!.collection('students').get();
        const allStudents = studentsSnap.docs.map(doc => doc.data() as Student);

        const thirtyDaysAgo = startOfDay(subDays(new Date(), 30));

        const stats: EmployeeStats[] = employees.map(employee => {
            const createdStudents = allStudents.filter(student => student.createdBy === employee.id);
            const totalStudents = createdStudents.length;

            const dailyCountsMap: { [key: string]: number } = {};
            const monthlyTotalsMap: { [key: string]: number } = {};

            for (const student of createdStudents) {
                const createdAt = parseISO(student.createdAt);
                
                // Monthly total
                const monthKey = format(createdAt, 'yyyy-MM');
                monthlyTotalsMap[monthKey] = (monthlyTotalsMap[monthKey] || 0) + 1;
                
                // Daily total (last 30 days)
                if (createdAt >= thirtyDaysAgo) {
                    const dayKey = format(createdAt, 'yyyy-MM-dd');
                    dailyCountsMap[dayKey] = (dailyCountsMap[dayKey] || 0) + 1;
                }
            }

            // Fill in missing days for the last 30 days
            const dailyCounts = [];
            for (let i = 0; i < 30; i++) {
                const date = subDays(new Date(), i);
                const dateKey = format(date, 'yyyy-MM-dd');
                dailyCounts.push({
                    date: dateKey,
                    count: dailyCountsMap[dateKey] || 0,
                });
            }

            const monthlyTotals = Object.entries(monthlyTotalsMap)
                .map(([month, count]) => ({ month, count }))
                .sort((a, b) => a.month.localeCompare(b.month));

            return {
                employeeId: employee.id,
                employeeName: employee.name,
                totalStudents,
                dailyCounts: dailyCounts.sort((a,b) => a.date.localeCompare(b.date)),
                monthlyTotals,
            };
        });

        return { success: true, data: stats };

    } catch (error: any) {
        console.error("getEmployeeStudentStats error:", error);
        return { success: false, message: error.message };
    }
}

export async function updateStudentIELTS(studentId: string, overallScore: number, authorId: string) {
  if (!checkAdminServices()) {
    return { success: false, message: 'Server database connection not available.' };
  }
  try {
    const studentRef = adminDb!.collection('students').doc(studentId);
    const studentDoc = await studentRef.get();
    if (!studentDoc.exists) {
      return { success: false, message: 'Student not found.' };
    }

    const studentData = studentDoc.data() as Student;

    await studentRef.update({ ieltsOverall: overallScore });

    // Add a note for the update
    const author = await getUser(authorId);
    const noteContent = `IELTS overall score updated to ${overallScore.toFixed(1)} by ${author?.name || 'an employee'}.`;
    const newNote: Note = {
      id: `note-ielts-${Date.now()}`,
      authorId: authorId,
      content: noteContent,
      createdAt: new Date().toISOString(),
    };
    await studentRef.update({ adminNotes: [...(studentData.adminNotes || []), newNote] });

    return { success: true, message: 'IELTS score updated successfully.' };
  } catch (error) {
    console.error('updateStudentIELTS error:', error);
    return { success: false, message: 'Failed to update IELTS score.' };
  }
}
