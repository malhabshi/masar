
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
import { CheckCircle, XCircle, Loader2, Trash2, Star, ShieldCheck, AlertCircle } from 'lucide-react';
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
import { cn } from '@/lib/utils';

interface UniversitiesTableProps {
  universities: ApprovedUniversity[];
  onUpdateUniversity?: (university: ApprovedUniversity) => void;
  onDeleteUniversity?: (id: string) => void;
  isLoading: boolean;
}

export function UniversitiesTable({ universities, onUpdateUniversity, onDeleteUniversity, isLoading }: UniversitiesTableProps) {
  const numColumns = onUpdateUniversity ? 7 : 6;
  
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
            <TableHead>Entry Levels</TableHead>
            <TableHead>IELTS Score</TableHead>
            <TableHead>Available</TableHead>
            {onUpdateUniversity && <TableHead className="text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {universities.length > 0 ? (
            universities.map((uni) => (
              <TableRow key={uni.id}>
                <TableCell className="font-bold align-top">
                  <div className="flex flex-col gap-1">
                    <span>{uni.name}</span>
                    {uni.importantNote && (
                      <div className="flex items-center gap-1.5 text-red-600 animate-pulse">
                        <AlertCircle className="h-3 w-3 shrink-0" />
                        <span className="text-[10px] font-black uppercase tracking-tight leading-none">
                          IMPORTANT: {uni.importantNote}
                        </span>
                      </div>
                    )}
                  </div>
                </TableCell>
                <TableCell className="align-top">
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{uni.major}</span>
                        {uni.category === 'Merit' && (
                            <Badge className="bg-yellow-500 hover:bg-yellow-600 text-black text-[9px] font-bold px-1.5 h-4 gap-1">
                                <Star className="h-2 w-2 fill-current" /> MERIT
                            </Badge>
                        )}
                        {uni.category === 'MOHE' && (
                            <Badge className="bg-blue-600 hover:bg-blue-700 text-white text-[9px] font-bold px-1.5 h-4 gap-1">
                                <ShieldCheck className="h-2 w-2" /> MOHE
                            </Badge>
                        )}
                    </div>
                    {uni.notes && (
                      <span className="text-[10px] text-muted-foreground italic line-clamp-1" title={uni.notes}>
                        {uni.notes}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="align-top">
                  <Badge variant="outline" className="font-mono text-[10px]">{uni.country}</Badge>
                </TableCell>
                <TableCell className="align-top">
                  <div className="flex flex-wrap gap-1">
                    {(uni.entryLevels || []).length > 0 ? (
                      uni.entryLevels?.map(level => (
                        <Badge key={level} variant="secondary" className="text-[9px] px-1 h-4 whitespace-nowrap bg-primary/10 text-primary border-primary/20">
                          {level}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-[10px] text-muted-foreground italic">Standard</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="align-top">
                    <Badge variant="secondary" className="font-mono">
                        {uni.ieltsScore.toFixed(1)}
                    </Badge>
                </TableCell>
                <TableCell className="align-top">
                  {uni.isAvailable ? (
                    <CheckCircle className="h-5 w-5 text-success" />
                  ) : (
                    <XCircle className="h-5 w-5 text-destructive" />
                  )}
                </TableCell>
                {onUpdateUniversity && (
                    <TableCell className="text-right align-top">
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
              <TableCell colSpan={numColumns} className="h-24 text-center text-muted-foreground">
                No universities match your filters.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
