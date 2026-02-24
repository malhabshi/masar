
'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Document, Student, UserRole } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FileText, Download } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { UploadDocumentDialog } from './upload-document-dialog';
import { formatDate } from '@/lib/timestamp-utils';
import { doc } from 'firebase/firestore';
import { firestore } from '@/firebase';
import { updateDocumentNonBlocking } from '@/firebase/client';
import { useUserCacheById } from '@/hooks/use-user-cache';

interface InternalDocumentsProps {
  student: Student;
  currentUser: AppUser;
  title: string;
  allowUpload: boolean;
}

export function InternalDocuments({ student, currentUser, title, allowUpload }: InternalDocumentsProps) {
  const [isClient, setIsClient] = useState(false);
  const authorIds = useMemo(() => {
    return (student.documents || []).map(doc => doc.authorId);
  }, [student.documents]);
  const { userMap } = useUserCacheById(authorIds);
  
  useEffect(() => {
    setIsClient(true);
  }, []);

  const managementRoles: UserRole[] = ['admin', 'department'];

  const documents = (student.documents || []).filter(doc => {
      const isEmployeeSection = title === 'Employee Documents';
      const author = userMap.get(doc.authorId);

      if (isEmployeeSection) {
          // Show documents created by employees (or if author can't be determined, assume it might be older data)
          return !author || author.role === 'employee';
      } else {
          // Admin/Dept section: show documents created by them
          return author && managementRoles.includes(author.role);
      }
  });

  // Effect to clear document notification counters upon viewing.
  useEffect(() => {
    if (!student || !currentUser) return;
    const studentDocRef = doc(firestore, 'students', student.id);
    const isAdminDept = ['admin', 'department'].includes(currentUser.role);
    const isEmployee = currentUser.role === 'employee';
    const updates: Partial<Student> = {};

    if (isEmployee && student.newDocumentsForEmployee && student.newDocumentsForEmployee > 0) {
      updates.newDocumentsForEmployee = 0;
    }
    if (isAdminDept && student.newDocumentsForAdmin && student.newDocumentsForAdmin > 0) {
      updates.newDocumentsForAdmin = 0;
    }

    if (Object.keys(updates).length > 0) {
      updateDocumentNonBlocking(studentDocRef, updates);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?.id, currentUser?.id]);


  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {documents.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File Name</TableHead>
                <TableHead>Uploaded By</TableHead>
                <TableHead>Date Uploaded</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.slice().sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()).map((doc) => {
                const author = userMap.get(doc.authorId);
                return (
                  <TableRow key={doc.id}>
                    <TableCell className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{doc.name}</span>
                      {doc.isNew && <Badge className="bg-blue-500 hover:bg-blue-600">New</Badge>}
                    </TableCell>
                    <TableCell>
                      {author ? (
                        <div className="flex items-center gap-2">
                          <Avatar className="h-6 w-6">
                            <AvatarImage src={author.avatarUrl} alt={author.name} />
                            <AvatarFallback>{author.name.charAt(0)}</AvatarFallback>
                          </Avatar>
                          <span className="text-sm">{author.name}</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Student</span>
                      )}
                    </TableCell>
                    <TableCell>{isClient ? formatDate(doc.uploadedAt) : '...'}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" asChild>
                        <a href={doc.url} download={doc.name} target="_blank" rel="noopener noreferrer">
                          <Download className="h-4 w-4" />
                        </a>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-8">No documents uploaded for this section.</p>
        )}
      </CardContent>
      {allowUpload && (
        <CardFooter className="border-t pt-4">
           <UploadDocumentDialog student={student} />
        </CardFooter>
      )}
    </Card>
  );
}
