'use client';

import type { Document } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FileText, Download } from 'lucide-react';

interface DocumentListProps {
  documents: Document[];
}

export function DocumentList({ documents }: DocumentListProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Student Documents</CardTitle>
      </CardHeader>
      <CardContent>
        {documents.length > 0 ? (
            <Table>
                <TableHeader>
                    <TableRow>
                    <TableHead>File Name</TableHead>
                    <TableHead>Date Uploaded</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {documents.map((doc) => (
                    <TableRow key={doc.id}>
                        <TableCell className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <span>{doc.name}</span>
                        </TableCell>
                        <TableCell>{new Date(doc.uploadedAt).toLocaleDateString()}</TableCell>
                        <TableCell className="text-right">
                        <Button variant="ghost" size="icon" asChild>
                            <a href={doc.url} download>
                                <Download className="h-4 w-4" />
                            </a>
                        </Button>
                        </TableCell>
                    </TableRow>
                    ))}
                </TableBody>
            </Table>
        ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No student documents uploaded yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
