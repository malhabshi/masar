// The role a server route may trust.
//
// users/{uid}.role is NOT trustworthy on its own: the security rules let a signed-in
// person write their own user document, so anyone could set their role to "admin" and
// walk into an admin-only route that only reads that field. Admin and department rights
// therefore come from the protected lists — admins/{uid} and departmentUsers/{uid} — which
// only admins (or the server) can write, the same lists firestore.rules uses for
// isAdmin() and isDepartment(). The users document is consulted only for the roles that
// grant no admin power (employee, adminplus), and never to grant admin or department.

import { adminDb } from '@/lib/firebase/admin';

export type TrustedRole = 'admin' | 'department' | 'adminplus' | 'employee' | 'student' | null;

export async function trustedRole(uid: string): Promise<TrustedRole> {
  if (!adminDb || !uid) return null;
  const [adminDoc, deptDoc, userDoc] = await Promise.all([
    adminDb.collection('admins').doc(uid).get(),
    adminDb.collection('departmentUsers').doc(uid).get(),
    adminDb.collection('users').doc(uid).get(),
  ]);
  if (adminDoc.exists) return 'admin';
  if (deptDoc.exists) return 'department';
  const claimed = userDoc.data()?.role;
  // A users document claiming admin/department without being on the protected list is
  // not believed — it is treated as no staff role at all.
  if (claimed === 'adminplus' || claimed === 'employee' || claimed === 'student') return claimed;
  return null;
}
