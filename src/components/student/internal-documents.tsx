'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Document, Student, UserRole } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FileText, Download, Trash2, Loader2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { UploadDocumentDialog } from './upload-document-dialog';
import { formatDate } from '@/lib/timestamp-utils';
import { doc } from 'firebase/firestore';
import { firestore } from '@/firebase';
import { updateDocumentNonBlocking } from '@/firebase/client';
import { useUserCacheById } from '@/hooks/use-user-cache';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { deleteStudentDocument } from '@/lib/actions';

function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

interface InternalDocumentsProps {
  student: Student;
  currentUser: AppUser;
  title: string;
  allowUpload: boolean;
}

export function InternalDocuments({ student, currentUser, title, allowUpload }: InternalDocumentsProps) {
  const [isClient, setIsClient] = useState(false);
  const { toast } = useToast();
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

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
  
  const handleDelete = async (docToDelete: Document) => {
    if (!currentUser) return;
    setIsDeleting(docToDelete.id);
    const result = await deleteStudentDocument(student.id, docToDelete.id, docToDelete.url, currentUser.id);

    if(result.success) {
        toast({ title: 'Document Deleted', description: `'${docToDelete.name}' has been deleted.` });
    } else {
        toast({ variant: 'destructive', title: 'Deletion Failed', description: result.message });
    }
    setIsDeleting(null);
  };


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
                <TableHead>Size</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.slice().sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()).map((doc) => {
                const author = userMap.get(doc.authorId);
                const isBeingDeleted = isDeleting === doc.id;
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
                    <TableCell>{formatBytes(doc.size || 0)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end">
                        {allowUpload && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" disabled={isBeingDeleted}>
                                {isBeingDeleted ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-destructive" />}
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This will permanently delete the document "{doc.name}". This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDelete(doc)} className="bg-destructive hover:bg-destructive/90">Delete</AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                        <Button variant="ghost" size="icon" asChild>
                          <a href={doc.url} download={doc.originalName || doc.name} target="_blank" rel="noopener noreferrer">
                            <Download className="h-4 w-4" />
                          </a>
                        </Button>
                      </div>
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
