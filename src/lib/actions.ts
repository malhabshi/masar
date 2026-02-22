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

    if (!employeeId) {
      console.log('No employee assigned to this application');
      return { success: true, message: 'No employee assigned' };
    }

    // Get student and employee data
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
