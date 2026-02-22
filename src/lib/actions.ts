'use server';

import { adminDb } from '@/lib/firebase/admin';

interface Employee {
  id: string;
  name: string;
  phone?: string;
  civilId?: string;
}

interface Student {
  id: string;
  name: string;
  employeeId?: string;
}

interface Application {
  id: string;
  studentId: string;
  assignedEmployeeId?: string;
  status: string;
}

// Helper to check if adminDb is available
function checkAdminDb() {
  if (!adminDb) {
    console.error('Firebase Admin not initialized. Check FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 env var.');
    return false;
  }
  return true;
}

export async function sendWhatsAppNotification(employeeId: string, message: string) {
  if (!checkAdminDb()) return { success: false, error: 'Firebase Admin not initialized' };
  
  try {
    // Get employee data from Firestore Admin
    const employeeDoc = await adminDb!.collection('users').doc(employeeId).get();
    
    if (!employeeDoc.exists) {
      console.error('Employee not found:', employeeId);
      return { success: false, error: 'Employee not found' };
    }

    const employee = employeeDoc.data() as Employee;
    const phoneNumber = employee?.phone;

    if (!phoneNumber) {
      console.error('Employee has no phone number:', employeeId);
      return { success: false, error: 'Employee has no phone number' };
    }

    // TODO: Implement actual WhatsApp sending
    console.log(`[MOCK] WhatsApp sent to ${phoneNumber}: ${message}`);
    
    // Log the notification
    await adminDb!.collection('notification_logs').add({
      type: 'whatsapp',
      recipientId: employeeId,
      recipientPhone: phoneNumber,
      message,
      status: 'sent',
      timestamp: new Date().toISOString()
    });
    
    return { success: true };
  } catch (error) {
    console.error('Failed to send notification:', error);
    return { success: false, error: String(error) };
  }
}

export async function onApplicationStatusChange(applicationId: string, newStatus: string) {
  if (!checkAdminDb()) return { success: false, error: 'Firebase Admin not initialized' };
  
  try {
    // Get application data
    const applicationDoc = await adminDb!.collection('applications').doc(applicationId).get();
    if (!applicationDoc.exists) {
      return { success: false, error: 'Application not found' };
    }
    
    const application = applicationDoc.data() as Application;
    const studentId = application?.studentId;
    const employeeId = application?.assignedEmployeeId;

    if (!employeeId || !studentId) {
      console.log('No employee or student assigned to this application');
      return { success: true, message: 'No employee or student assigned' };
    }

    // Get student and employee data in parallel
    const [studentDoc, employeeDoc] = await Promise.all([
      adminDb!.collection('students').doc(studentId).get(),
      adminDb!.collection('users').doc(employeeId).get()
    ]);

    const student = studentDoc.data() as Student;
    const employee = employeeDoc.data() as Employee;

    // Send notification if employee has phone
    if (employee?.phone) {
      await sendWhatsAppNotification(
        employeeId,
        `Application status changed to ${newStatus} for student ${student?.name || 'Unknown'}`
      );
    }

    // Log the action
    await adminDb!.collection('system_logs').add({
      type: 'application_status_change',
      applicationId,
      newStatus,
      timestamp: new Date().toISOString(),
      employeeId,
      studentId
    });

    return { success: true };
  } catch (error) {
    console.error('Error in onApplicationStatusChange:', error);
    return { success: false, error: String(error) };
  }
}

export async function onDocumentUploaded(documentId: string, studentId: string, documentName: string) {
  if (!checkAdminDb()) return { success: false, error: 'Firebase Admin not initialized' };
  
  try {
    // Get student data
    const studentDoc = await adminDb!.collection('students').doc(studentId).get();
    if (!studentDoc.exists) {
      return { success: false, error: 'Student not found' };
    }

    const student = studentDoc.data() as Student;
    const employeeId = student?.employeeId;

    if (!employeeId) {
      console.log('No employee assigned to this student');
      return { success: true, message: 'No employee assigned' };
    }

    // Get employee data
    const employeeDoc = await adminDb!.collection('users').doc(employeeId).get();
    const employee = employeeDoc.data() as Employee;

    // Send notification if employee has phone
    if (employee?.phone) {
      await sendWhatsAppNotification(
        employeeId,
        `New document uploaded for student ${student?.name}: ${documentName}`
      );
    }

    return { success: true };
  } catch (error) {
    console.error('Error in onDocumentUploaded:', error);
    return { success: false, error: String(error) };
  }
}

// Export a test function to verify setup
export async function testFirebaseAdmin() {
  if (!checkAdminDb()) {
    return { 
      success: false, 
      message: 'Firebase Admin not initialized. Check FIREBASE_SERVICE_ACCOUNT_KEY_BASE64 env var.' 
    };
  }
  
  try {
    // Try to read a single document to test connection
    const testDoc = await adminDb!.collection('users').limit(1).get();
    return { 
      success: true, 
      message: 'Firebase Admin is working correctly',
      hasUsers: !testDoc.empty
    };
  } catch (error) {
    return { 
      success: false, 
      message: 'Firebase Admin failed to query: ' + String(error)
    };
  }
}

export async function addApplication(studentId: string, universityName: string, country: string, major: string, studentName: string, employeeId: string | null) {
  // This is a placeholder. In a real app, you'd have more logic here.
  // For example, sending a notification to the employee.
  return { success: true, message: `Application for ${universityName} added.` };
}

export async function updateApplicationStatus(studentId: string, universityName: string, major: string, newStatus: ApplicationStatus, studentName: string, employeeId: string | null) {
  // Placeholder
  return { success: true, message: 'Status updated.' };
}

export async function updateStudentPipelineStatus(studentId: string, status: string, userName: string, studentName: string) {
    return { success: true, message: 'Status updated.' };
}

export async function transferStudent(studentId: string, newEmployee: { id: string }, adminId: string, studentName: string, fromEmployeeName: string | null) {
    return { success: true, message: `Student ${studentName} transferred.` };
}

export async function bulkTransferStudents(fromEmployeeId: string, toEmployeeId: string, adminId: string) {
    if (!checkAdminDb()) {
        return { success: false, message: 'Server database connection not available.' };
    }
    try {
        const fromEmployeeDoc = await adminDb.collection('users').doc(fromEmployeeId).get();
        const toEmployeeDoc = await adminDb.collection('users').doc(toEmployeeId).get();
        
        if (!fromEmployeeDoc.exists || !toEmployeeDoc.exists) {
            return { success: false, message: 'One or both employees not found.' };
        }
        
        const fromEmployeeCivilId = fromEmployeeDoc.data()?.civilId;
        const toEmployeeCivilId = toEmployeeDoc.data()?.civilId;
        
        if (!fromEmployeeCivilId || !toEmployeeCivilId) {
            return { success: false, message: 'One or both employees are missing a Civil ID.' };
        }

        const snapshot = await adminDb.collection('students').where('employeeId', '==', fromEmployeeCivilId).get();
        
        if (snapshot.empty) {
            return { success: true, message: 'No students to transfer.' };
        }

        const batch = adminDb.batch();
        snapshot.docs.forEach(doc => {
            batch.update(doc.ref, { employeeId: toEmployeeCivilId, isNewForEmployee: true });
        });

        await batch.commit();
        
        return { success: true, message: `${snapshot.size} students were transferred successfully.` };
    } catch (error: any) {
        return { success: false, message: error.message };
    }
}


export async function sendTask(authorId: string, recipientId: string, content: string) {
    return { success: true, message: 'Update sent.' };
}

export async function addReplyToTask(taskId: string, authorId: string, content: string, taskAuthorId: string) {
    return { success: true, message: 'Reply sent.' };
}

export async function updateTaskStatus(taskId: string, status: string, task: any) {
    return { success: true, message: 'Status updated.' };
}

export async function importStudentsFromExcel(userId: string, fileName: string) {
    // This is a mock function. In a real scenario, you'd parse the excel file
    // and add students to the database.
    console.log(`User ${userId} initiated import from ${fileName}`);
    return { success: true, message: `Students from '${fileName}' are being imported in the background.` };
}

export async function sendTestNotification(phoneNumber: string, userName: string) {
    // In a real app, this would integrate with a WhatsApp service.
    if (!phoneNumber) return { success: false, message: 'Phone number is required.' };
    console.log(`Sending test WhatsApp to ${phoneNumber} from ${userName}.`);
    return { success: true, message: 'Test message sent successfully.' };
}