'use client';

import type { Document, User, Student, UserRole } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FileText, Download } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { UploadDocumentDialog } from './upload-document-dialog';

interface InternalDocumentsProps {
  student: Student;
  currentUser: User;
  title: string;
  allowUpload: boolean;
  users: User[];
}

export function InternalDocuments({ student, currentUser, title, allowUpload, users }: InternalDocumentsProps) {
  const getAuthor = (authorId: string) => {
    return users.find(u => u.id === authorId);
  };
  
  const managementRoles: UserRole[] = ['admin', 'department'];

  const documents = student.documents.filter(doc => {
      const isEmployeeSection = title === 'Employee Documents';
      const author = getAuthor(doc.authorId);

      if (isEmployeeSection) {
          return !author || author.role === 'employee';
      } else {
          return author && managementRoles.includes(author.role);
      }
  });

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
                const author = getAuthor(doc.authorId);
                return (
                  <TableRow key={doc.id}>
                    <TableCell className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span>{doc.name}</span>
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
                    <TableCell>{new Date(doc.uploadedAt).toLocaleDateString()}</TableCell>
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
           <UploadDocumentDialog student={student} currentUser={currentUser} />
        </CardFooter>
      )}
    </Card>
  );
}
