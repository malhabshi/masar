
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import type { Student, JotformSubmission } from '@/lib/types';

export async function POST(req: NextRequest) {
  try {
    if (!adminDb) {
      return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });
    }

    const contentType = req.headers.get('content-type') || '';
    let payload: any = {};

    if (contentType.includes('application/json')) {
      payload = await req.json();
    } else {
      // Jotform often sends multipart/form-data
      const formData = await req.formData();
      formData.forEach((value, key) => {
        payload[key] = value;
      });
    }

    // Jotform payloads often have different keys based on form structure.
    // We attempt to find the most common naming patterns.
    const extractField = (keys: string[]) => {
      for (const key of keys) {
        if (payload[key]) return payload[key];
        // Try qX_key format
        const match = Object.keys(payload).find(k => k.toLowerCase().endsWith(key.toLowerCase()));
        if (match) return payload[match];
      }
      return null;
    };

    const studentName = extractField(['studentName', 'fullName', 'name', 'first_name']);
    const email = extractField(['email', 'emailAddress', 'studentEmail']);
    const phone = extractField(['phone', 'phoneNumber', 'mobile', 'tel']);
    const submissionId = payload.submissionID || payload.id;
    const formId = payload.formID;

    if (!studentName || !phone) {
      console.warn('Jotform Webhook: Missing required fields.', { studentName, phone });
      return NextResponse.json({ error: 'Missing required fields: studentName and phone' }, { status: 400 });
    }

    // Check for duplicate phone
    const existingSnap = await adminDb.collection('students').where('phone', '==', String(phone)).get();
    let duplicateInfo = {};
    if (!existingSnap.empty) {
      duplicateInfo = { 
        duplicatePhoneWarning: true, 
        duplicateOfStudentIds: existingSnap.docs.map(doc => doc.id) 
      };
    }

    // Create Student Document
    const studentId = `JF-${submissionId}`;
    const studentRef = adminDb.collection('students').doc(studentId);
    
    const studentData: Partial<Student> = {
      id: studentId,
      name: String(studentName),
      email: String(email || ''),
      phone: String(phone),
      employeeId: null, // Unassigned
      applications: [],
      employeeNotes: [],
      adminNotes: [{
        id: `note-${Date.now()}`,
        authorId: 'system',
        content: `Imported from Jotform (ID: ${submissionId})`,
        createdAt: new Date().toISOString()
      }],
      documents: [],
      createdAt: new Date().toISOString(),
      createdBy: 'jotform_webhook',
      source: 'jotform',
      jotformSubmissionId: String(submissionId),
      pipelineStatus: 'none',
      profileCompletionStatus: {
        submitUniversityApplication: false, applyMoheScholarship: false, submitKcoRequest: false, 
        receivedCasOrI20: false, appliedForVisa: false, documentsSubmittedToMohe: false,
        readyToTravel: false, financialStatementsProvided: false, visaGranted: false, medicalFitnessSubmitted: false,
      },
      ...duplicateInfo,
    };

    await studentRef.set(studentData);

    // Save full application data
    const submissionRef = adminDb.collection('jotform_submissions').doc(String(submissionId));
    const submissionData: JotformSubmission = {
      id: String(submissionId),
      submissionId: String(submissionId),
      formId: String(formId),
      studentId: studentId,
      source: 'jotform',
      rawData: payload,
      documents: [], // Logic to parse file URLs could go here
      submittedAt: new Date().toISOString(),
    };
    await submissionRef.set(submissionData);

    // Notify Admins via Tasks
    const adminsSnapshot = await adminDb.collection('users').where('role', '==', 'admin').get();
    if (!adminsSnapshot.empty) {
      const batch = adminDb.batch();
      adminsSnapshot.forEach(adminDoc => {
        const taskRef = adminDb!.collection('tasks').doc();
        batch.set(taskRef, {
          authorId: 'system',
          createdBy: 'system',
          recipientId: adminDoc.id,
          recipientIds: [adminDoc.id],
          content: `New Jotform Lead: ${studentName} (${phone}). Check unassigned students.`,
          status: 'new',
          category: 'system',
          studentId: studentId,
          studentName: String(studentName),
          createdAt: new Date().toISOString(),
          replies: []
        });
      });
      await batch.commit();
    }

    return NextResponse.json({ success: true, studentId });

  } catch (error: any) {
    console.error('Jotform Webhook Error:', error);
    return NextResponse.json({ error: 'Failed to process webhook', details: error.message }, { status: 500 });
  }
}
