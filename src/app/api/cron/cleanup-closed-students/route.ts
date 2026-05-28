import { NextRequest, NextResponse } from 'next/server';
import { adminDb, storage } from '@/lib/firebase/admin';
import type { Student } from '@/lib/types';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!adminDb || !storage) {
    return NextResponse.json({ error: 'DB not available' }, { status: 500 });
  }

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const snapshot = await adminDb.collection('students').where('isClosed', '==', true).get();

    let cleaned = 0;

    for (const docSnap of snapshot.docs) {
      const student = docSnap.data() as Student;
      if (!student.closedAt) continue;

      const closedAt = new Date(student.closedAt);
      if (closedAt > thirtyDaysAgo) continue;

      const allDocs = student.documents || [];
      const passportDocs = allDocs.filter(d =>
        d.name?.toLowerCase().includes('passport') ||
        d.originalName?.toLowerCase().includes('passport')
      );
      const toDelete = allDocs.filter(d =>
        !d.name?.toLowerCase().includes('passport') &&
        !d.originalName?.toLowerCase().includes('passport')
      );

      for (const file of toDelete) {
        try {
          if (file.url) {
            const urlObj = new URL(file.url);
            const encodedPath = urlObj.pathname.split('/o/')[1]?.split('?')[0];
            if (encodedPath) {
              const filePath = decodeURIComponent(encodedPath);
              await storage.bucket().file(filePath).delete().catch(() => {});
            }
          }
        } catch {}
      }

      if (toDelete.length > 0) {
        await docSnap.ref.update({ documents: passportDocs });
        cleaned++;
      }
    }

    return NextResponse.json({ success: true, cleaned });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
