'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import type { ApprovedUniversity } from '@/lib/types';
import { CheckCircle, XCircle, Loader2, Trash2 } from 'lucide-react';
import { EditUniversityDialog } from './edit-university-dialog';
import { Skeleton } from '../ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

interface UniversitiesTableProps {
  universities: ApprovedUniversity[];
  onUpdateUniversity?: (university: ApprovedUniversity) => void;
  onDeleteUniversity?: (id: string) => void;
  isLoading: boolean;
}

export function UniversitiesTable({ universities, onUpdateUniversity, onDeleteUniversity, isLoading }: UniversitiesTableProps) {
  const numColumns = onUpdateUniversity ? 6 : 5;
  
  if (isLoading) {
    return (
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {Array.from({ length: numColumns }).map((_, i) => (
                <TableHead key={i}><Skeleton className="h-5 w-24" /></TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: numColumns }).map((_, j) => (
                  <TableCell key={j}><Skeleton className="h-5 w-full" /></TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>University</TableHead>
            <TableHead>Major</TableHead>
            <TableHead>Country</TableHead>
            <TableHead>IELTS Score</TableHead>
            <TableHead>Available</TableHead>
            {onUpdateUniversity && <TableHead className="text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {universities.length > 0 ? (
            universities.map((uni) => (
              <TableRow key={uni.id}>
                <TableCell className="font-medium">
                  {uni.name}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col">
                    <span>{uni.major}</span>
                    {uni.notes && (
                      <span className="text-[10px] text-muted-foreground italic line-clamp-1" title={uni.notes}>
                        {uni.notes}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{uni.country}</Badge>
                </TableCell>
                <TableCell>{uni.ieltsScore.toFixed(1)}</TableCell>
                <TableCell>
                  {uni.isAvailable ? (
                    <CheckCircle className="h-5 w-5 text-success" />
                  ) : (
                    <XCircle className="h-5 w-5 text-destructive" />
                  )}
                </TableCell>
                {onUpdateUniversity && (
                    <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <EditUniversityDialog university={uni} onUpdateUniversity={onUpdateUniversity} />
                          {onDeleteUniversity && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive hover:bg-destructive/10">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete Approved University?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Are you sure you want to remove <strong>{uni.name} ({uni.major})</strong> from the list? This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction 
                                    onClick={() => onDeleteUniversity(uni.id)}
                                    className="bg-destructive hover:bg-destructive/90"
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </div>
                    </TableCell>
                )}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={numColumns} className="h-24 text-center">
                No universities match your filters.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}