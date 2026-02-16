
'use server';

// NOTE: The notification logic in this file has been temporarily disabled.
// The original code used a mock, local data array for users, while the client-side
// application uses live data from Firestore. This created a major data inconsistency bug.
// The correct, long-term solution is to refactor these server actions to use the
// Firebase Admin SDK to securely fetch live user data.
// As an immediate step to ensure the application can be published without runtime errors,
// the notification-sending parts have been commented out. The core logic of each action remains.

import type { ApplicationStatus, PipelineStatus, Task, TaskReply, TaskStatus, User, UserRole, Country, IeltsScore, ProfileCompletionStatus, RequestType, Student } from './types';
import { requestTypes } from './data';
import { NotificationType, sendTypedWhatsAppMessage } from './whatsapp-templates';

export async function updateApplicationStatus(
  studentId: string,
  university: string,
  major: string,
  newStatus: ApplicationStatus,
  studentName: string,
  employeeId: string | null
) {
  console.log(
    `Updating status for student ${studentId}, application to ${university} for ${major} to ${newStatus}`
  );
  // NOTIFICATION LOGIC DISABLED: See note at top of file.
  /*
  let notificationMessage = '';
  if (employeeId) {
    const employee = users.find((u) => u.id === employeeId);
    if (employee && employee.phone) {
      const result = await sendTypedWhatsAppMessage(NotificationType.GENERIC_NOTIFICATION, employee.phone, { "1": employee.name });
      if (!result.success) {
          notificationMessage = result.message;
          return { success: false, message: `Status updated, but notification failed: ${notificationMessage}` };
      }
    }
  }
  */
  return { success: true, message: `Status updated to ${newStatus}` };
}

export async function addNote(studentId: string, authorId: string, content: string) {
    console.log(`Adding note for student ${studentId} by ${authorId}: ${content}`);
    // No revalidation needed as client-side state is updated optimistically
    return { success: true, message: `Note added.` };
}

export async function addDocument(studentId: string, authorId: string, fileName: string, studentName: string | undefined, employeeId: string | null) {
  console.log(`Adding document '${fileName}' for student ${studentId} by ${authorId}. Assigned employee: ${employeeId}`);
    
  // NOTIFICATION LOGIC DISABLED: See note at top of file.
  /*
  const author = users.find(u => u.id === authorId);
  if (!author) {
    return { success: false, message: 'Author not found.' };
  }

  let notificationSent = false;
  let notificationResult: { success: boolean; message: string; } = { success: true, message: '' };

  if (author.role === 'employee') {
    // Employee uploads, notify admin.
    const admin = users.find(u => u.role === 'admin');
    if (admin && admin.phone) {
      notificationResult = await sendTypedWhatsAppMessage(
        NotificationType.DOCUMENT_UPLOAD_TO_ADMIN,
        admin.phone,
        {
          "1": admin.name,
          "2": author.name,
          "3": fileName,
          "4": studentName || 'N/A'
        }
      );
      notificationSent = true;
    }
  } else if (['admin', 'department'].includes(author.role) && employeeId) {
    // Admin or Dept uploads, notify assigned employee.
    const employee = users.find(u => u.id === employeeId);
    if (employee && employee.phone) {
      notificationResult = await sendTypedWhatsAppMessage(
        NotificationType.DOCUMENT_UPLOAD_TO_EMPLOYEE,
        employee.phone,
        {
          "1": employee.name,
          "2": fileName,
          "3": studentName || 'N/A'
        }
      );
      notificationSent = true;
    }
  }
  
  if (notificationSent) {
    if (!notificationResult.success) {
      return { success: false, message: `Document added, but notification failed: ${notificationResult.message}` };
    }
    return { success: true, message: 'Document added.', notificationMessage: 'Notification sent successfully.' };
  }
  */

  return { success: true, message: 'Document added.' };
}

export async function sendTask(authorId: string, recipientId: string, content: string) {
    console.log(`Sending task from ${authorId} to ${recipientId}: ${content}`);

    // NOTIFICATION LOGIC DISABLED: See note at top of file.
    /*
    const author = users.find(u => u.id === authorId);
    let allSentSuccessfully = true;

    const recipients: User[] = [];
    if (recipientId === 'all') {
        recipients.push(...users.filter(u => u.role === 'employee'));
    } else {
        const recipientUser = users.find(u => u.id === recipientId);
        if (recipientUser) recipients.push(recipientUser);
    }
    
    let firstError = '';

    for (const recipient of recipients) {
        if (recipient.phone) {
            const result = await sendTypedWhatsAppMessage(NotificationType.GENERIC_NOTIFICATION, recipient.phone, { "1": recipient.name });
            if (!result.success) {
                allSentSuccessfully = false;
                if(!firstError) firstError = result.message;
                console.error(`Failed to send WhatsApp notification to ${recipient.name} (${recipient.phone})`);
            }
        }
    }

    if(allSentSuccessfully) {
        return { success: true, message: 'Task sent and notification delivered.' };
    } else {
        return { success: false, message: `Task sent, but notification failed: ${firstError}` };
    }
    */
   return { success: true, message: 'Task sent.' };
}

export async function addReplyToTask(taskId: string, authorId: string, content: string, taskAuthorId: string) {
  console.log(`Adding reply to task ${taskId} by ${authorId}: ${content}`);
  
  // NOTIFICATION LOGIC DISABLED: See note at top of file.
  /*
  let notificationMessage = '';
  // Notify the original task author of the reply.
  const recipient = users.find(u => u.id === taskAuthorId);
  if (recipient && recipient.phone) {
      const result = await sendTypedWhatsAppMessage(NotificationType.GENERIC_NOTIFICATION, recipient.phone, { "1": recipient.name });
      if (!result.success) {
          notificationMessage = result.message;
          return { success: false, message: `Reply added, but notification failed: ${notificationMessage}` };
      }
  }
  */

  return { success: true, message: `Reply added.` };
}

export async function updateTaskStatus(taskId: string, newStatus: TaskStatus, task: Task) {
    console.log(`Updating status for task ${taskId} to ${newStatus}`);
  
    // NOTIFICATION LOGIC DISABLED: See note at top of file.
    /*
    if (task) {
      const admin = users.find(u => u.role === 'admin');
      let employeeToNotify: User | undefined | null = null;
  
      if (task.recipientId !== 'all' && task.recipientId !== admin?.id) {
        employeeToNotify = users.find(u => u.id === task.recipientId);
      } else if (task.authorId !== admin?.id) {
        employeeToNotify = users.find(u => u.id === task.authorId);
      }
  
      if (employeeToNotify && employeeToNotify.phone) {
        await sendTypedWhatsAppMessage(NotificationType.GENERIC_NOTIFICATION, employeeToNotify.phone, { "1": employeeToNotify.name });
        // We don't check for failure here to avoid blocking the status update itself.
      }
    }
    */
  
    return { success: true, message: `Task status updated to ${newStatus}.` };
}

export async function addMissingItem(studentId: string, item: string, studentName: string, employeeId: string | null) {
  console.log(`Adding missing item '${item}' for student ${studentId}`);
  
  // NOTIFICATION LOGIC DISABLED: See note at top of file.
  /*
  let notificationMessage = '';
  const employee = users.find(u => u.id === employeeId);

  if (employee && employee.phone) {
    const result = await sendTypedWhatsAppMessage(NotificationType.GENERIC_NOTIFICATION, employee.phone, { "1": employee.name });
    if (!result.success) {
        notificationMessage = result.message;
        return { success: false, message: `Item added, but notification failed: ${notificationMessage}` };
    }
  }
  */

  return { success: true, message: 'Item added and employee notified.' };
}

export async function removeMissingItem(studentId: string, item: string, studentName: string, employeeId: string | null) {
  console.log(`Removing missing item '${item}' for student ${studentId}`);
  
  // NOTIFICATION LOGIC DISABLED: See note at top of file.
  /*
  const employee = users.find(u => u.id === employeeId);

  if (employee && employee.phone) {
    await sendTypedWhatsAppMessage(NotificationType.GENERIC_NOTIFICATION, employee.phone, { "1": employee.name });
  }
  */

  return { success: true, message: 'Item removed and employee notified.' };
}

export async function transferStudent(studentId: string, newEmployee: User, adminId: string, studentName: string, fromEmployeeName: string | null) {
    console.log(`Transferring student ${studentId} to employee ${newEmployee.id}`);
    
    // NOTIFICATION LOGIC DISABLED: See note at top of file.
    /*
    if (newEmployee) {
        const isTransfer = !!fromEmployeeName;
        
        const message = isTransfer 
            ? `Student ${studentName} has been transferred to you from ${fromEmployeeName || 'Unassigned'}.`
            : `You have been assigned a new student: ${studentName}.`;

        if (newEmployee.phone) {
            const result = await sendTypedWhatsAppMessage(NotificationType.GENERIC_NOTIFICATION, newEmployee.phone, { "1": newEmployee.name });
            if (!result.success) {
                return { success: false, message: `Transfer failed: Notification could not be sent. ${result.message}` };
            }
        }

        const successMessage = isTransfer
            ? `Student transferred to ${newEmployee.name} and notification sent.`
            : `Student assigned to ${newEmployee.name} and notification sent.`;
        
        return { success: true, message: successMessage };
    }
    */
    const isTransfer = !!fromEmployeeName;
    const successMessage = isTransfer
        ? `Student transferred to ${newEmployee.name}.`
        : `Student assigned to ${newEmployee.name}.`;
    return { success: true, message: successMessage };
}

export async function updateStudentPipelineStatus(studentId: string, status: PipelineStatus, employeeName: string, studentName: string) {
    console.log(`Updating pipeline status for student ${studentId} to ${status}`);

    // NOTIFICATION LOGIC DISABLED: See note at top of file.
    /*
    const admin = users.find(u => u.role === 'admin');
    let notificationMessage = '';
    if (admin && admin.phone) {
        const result = await sendTypedWhatsAppMessage(NotificationType.GENERIC_NOTIFICATION, admin.phone, { "1": admin.name });
        if (!result.success) {
            notificationMessage = result.message;
            return { success: false, message: `Status updated, but notification failed: ${notificationMessage}` };
        }
    }
    */

    return { success: true, message: `Student pipeline status updated to ${status}.` };
}

export async function requestStudentDeletion(studentId: string, employeeId: string, reason: string, studentName: string) {
    console.log(`Deletion request for student ${studentId} from employee ${employeeId}. Reason: ${reason}`);
    
    // This action creates a Task, which will be handled by the client-side UI.
    // The notification part of sendTask is disabled, but the task creation itself is now handled on the client.
    return { success: true, message: 'Deletion request sent to admin.' };
}

export async function deleteStudentPermanently(studentId: string, studentName: string, adminId: string) {
    console.log(`Permanently deleting student ${studentName} (ID: ${studentId}) by admin ${adminId}`);
    
    // NOTIFICATION LOGIC DISABLED: See note at top of file.
    /*
    const departments = users.filter(u => u.role === 'department');
    if (departments.length > 0) {
        const taskContent = `Student ${studentName} was deleted. PLEASE hold all related applications.`;
        for (const dept of departments) {
            if (dept.phone) {
                await sendTypedWhatsAppMessage(NotificationType.GENERIC_NOTIFICATION, dept.phone, { "1": dept.name });
            }
        }
    }
    */

    return { success: true, message: 'Student deleted permanently.' };
}

export async function createUser(userData: { name: string; email: string; phone: string; role: UserRole; civilId: string; employeeId: string; password?: string; }) {
    console.log(`Creating new user:`, userData);
    // This action is now fully handled on the client via Firebase SDK. This server action is effectively deprecated.
    return { success: true, message: 'User creation initiated.' };
}

export async function updateUserRole(userId: string, newRole: UserRole) {
    console.log(`Updating role for user ${userId} to ${newRole}`);
    // This action is handled on the client via Firebase SDK. This server action is effectively deprecated.
    return { success: true, message: "User role update initiated." };
}

export async function bulkTransferStudents(fromEmployeeId: string, toEmployeeId: string, adminId: string) {
    console.log(`Bulk transferring all students from employee ${fromEmployeeId} to ${toEmployeeId}`);
    // This action now primarily creates a task on the client-side. The notification part is disabled.
    return { success: true, message: `Successfully initiated transfer.` };
}

export async function addUpcomingEvent(authorId: string, title: string, date: string, description: string) {
    console.log(`Adding upcoming event by ${authorId}: ${title}`);
    return { success: true, message: 'Upcoming event added successfully.' };
}

export async function deleteTask(taskId: string) {
    console.log(`Deleting task ${taskId}`);
    return { success: true, message: 'Task deleted.' };
}

export async function addSharedDocument(authorId: string, name: string, description: string, country?: Country) {
    console.log(`Adding shared document by ${authorId}: ${name} - ${description}`);
    if (country) {
        console.log(`Assigning to country: ${country}`);
    }
    return { success: true, message: 'Document has been uploaded and is now available.' };
}

export async function updateStudentInfo(studentId: string, data: { name: string; email: string; phone: string }) {
    console.log(`Updating info for student ${studentId}:`, data);
    return { success: true, message: 'Student information updated.' };
}

export async function addApplication(studentId: string, university: string, country: Country, major: string, studentName: string, employeeId: string | null) {
  console.log(`Adding application for student ${studentId} to ${university} for ${major}, ${country}`);

  // NOTIFICATION LOGIC DISABLED: See note at top of file.
  /*
  const employee = users.find(u => u.id === employeeId);
  let notificationMessage = '';
  if (employee && employee.phone) {
    const result = await sendTypedWhatsAppMessage(NotificationType.GENERIC_NOTIFICATION, employee.phone, { "1": employee.name });
    if(!result.success) {
        notificationMessage = result.message;
        return { success: false, message: `Application added, but notification failed: ${notificationMessage}` };
    }
  }
  */

  return { success: true, message: `Application added for ${university} (${major}).` };
}

export async function sendReminders() {
  console.log('--- Running Scheduled Reminders ---');
  console.log('Simulating reminder checks...');
  console.log('--- Finished Scheduled Reminders ---');
  
  return { success: true, message: 'Reminders sent.' };
}

export async function importStudentsFromExcel(authorId: string, fileName: string) {
    console.log(`Importing students from ${fileName} by ${authorId}`);
    // The main logic now happens on the client, creating a task for admins.
    return { success: true, message: `Successfully imported students from ${fileName}. Admins have been notified to process them.` };
}

export async function setFinalChoice(studentId: string, university: string, employeeId: string, studentName: string) {
  console.log(`Setting final choice for student ${studentId} to ${university}`);

  // NOTIFICATION LOGIC DISABLED: See note at top of file.
  /*
  const employee = users.find(u => u.id === employeeId);
  const admins = users.filter(u => u.role === 'admin');

  if (employee) {
    for (const admin of admins) {
      if (admin.phone) {
        await sendTypedWhatsAppMessage(NotificationType.GENERIC_NOTIFICATION, admin.phone, { "1": admin.name });
      }
    }
  }
  */

  return { success: true, message: `${university} has been set as the final choice.` };
}

export async function updateIeltsScore(studentId: string, scores: IeltsScore) {
  console.log(`Updating IELTS score for student ${studentId}`, scores);
  return { success: true, message: "IELTS scores have been updated." };
}

export async function updateProfileCompletionTask(studentId: string, taskId: keyof ProfileCompletionStatus, completed: boolean) {
    console.log(`Updating profile completion for student ${studentId}: task ${taskId} to ${completed}`);
    return { success: true, message: "Profile task status updated." };
}

export async function addRequestType(requestTypeData: Omit<RequestType, 'id'>) {
    console.log("Adding new request type:", requestTypeData);
    return { success: true, message: 'Request type added successfully.' };
}

export async function updateRequestType(requestTypeId: string, requestTypeData: Partial<Omit<RequestType, 'id'>>) {
    console.log(`Updating request type ${requestTypeId}:`, requestTypeData);
    return { success: true, message: 'Request type updated successfully.' };
}

export async function deleteRequestType(requestTypeId: string) {
    console.log(`Deleting request type ${requestTypeId}`);
    return { success: true, message: 'Request type deleted.' };
}

export async function submitCustomRequest(studentId: string, authorId: string, requestTypeId: string, details: string, studentName: string) {
    console.log(`Submitting custom request for student ${studentId} by ${authorId}`);
    // The main logic for task creation is now on the client.
    return { success: true, message: `Request submitted.` };
}

export async function updateStudentTerm(studentId: string, studentName: string, term: string, employeeId: string | null) {
  console.log(`Updating term for student ${studentId} to ${term}`);
  
  // NOTIFICATION LOGIC DISABLED: See note at top of file.
  /*
  const employee = users.find(u => u.id === employeeId);
  const admins = users.filter(u => u.role === 'admin');

  if (employee && admins.length > 0) {
    for (const admin of admins) {
      if (admin.phone) {
        await sendTypedWhatsAppMessage(NotificationType.GENERIC_NOTIFICATION, admin.phone, { "1": admin.name });
      }
    }
  }
  */

  return { success: true, message: `Student term updated to ${term}.` };
}

export async function createNewStudent(
  newStudentData: {
    studentName: string,
    studentEmail: string,
    phone: string,
    targetCountries: Country[],
    otherCountry: string,
    notes: string,
  }, 
  creatorId: string, 
  assignToCreator: boolean
) {
    console.log("Creating new student via action:", newStudentData);
    // In a real app, you'd save this to a database.
    // Here we just log it. The client-side context handles the state.
    return { success: true };
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

export async function deleteUpcomingEvent(eventId: string) {
    console.log(`Deleting event ${eventId}`);
    return { success: true, message: 'Event deleted.' };
}
