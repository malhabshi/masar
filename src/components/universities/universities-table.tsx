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
import { CheckCircle, XCircle, Loader2, Trash2, Star, ShieldCheck, AlertCircle, GraduationCap } from 'lucide-react';
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
import { bandParts, isEmptyRequirement } from './entry-requirements';

const COMPANY_COLORS: Record<string, string> = {
  Into:       'bg-blue-100 text-blue-800 border-blue-300',
  Studygroup: 'bg-violet-100 text-violet-800 border-violet-300',
  Kaplan:     'bg-red-100 text-red-800 border-red-300',
  OnCampus:   'bg-green-100 text-green-800 border-green-300',
  Navitas:    'bg-teal-100 text-teal-800 border-teal-300',
  Other:      'bg-gray-100 text-gray-700 border-gray-300',
  Inhouse:    'bg-amber-100 text-amber-800 border-amber-300',
};

/**
 * What this school asks for, level by level.
 *
 * Falls back to the single row-level score, which is all that exists on rows recorded
 * before per-level requirements were added — that is most of the list, so the fallback is
 * the normal case rather than the exception.
 */
function RequirementsCell({ university }: { university: ApprovedUniversity }) {
  const perLevel = (university.entryRequirements || []).filter(r => !isEmptyRequirement(r));
  const general =
    typeof university.ieltsScore === 'number' ? university.ieltsScore.toFixed(1) : null;

  if (perLevel.length === 0) {
    return general ? (
      <Badge variant="secondary" className="font-mono">{general}</Badge>
    ) : (
      <span className="text-[10px] text-muted-foreground italic">—</span>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {perLevel.map(req => {
        // Only what this level actually sets. Repeating the general score against every
        // level reads as a requirement the school never made.
        const overall =
          typeof req.ieltsOverall === 'number' ? req.ieltsOverall.toFixed(1) : null;
        const bands = bandParts(req);
        return (
          <div key={req.level} className="flex flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-tight text-muted-foreground">
                {req.level}
              </span>
              {overall && (
                <Badge variant="secondary" className="font-mono text-[10px] px-1.5 h-4">
                  {overall}
                </Badge>
              )}
              {bands.length > 0 && (
                <span className="font-mono text-[10px] text-muted-foreground">
                  {bands.map(b => (
                    <span key={b.short} className="mr-1.5 whitespace-nowrap">
                      <span className="font-bold text-foreground">{b.short}</span>
                      <span className="font-semibold text-success">{b.value}</span>
                    </span>
                  ))}
                </span>
              )}
            </div>
            {req.otherRequirements && (
              <span className="text-[10px] leading-snug text-foreground/80">
                {req.otherRequirements}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface UniversitiesTableProps {
  universities: ApprovedUniversity[];
  onUpdateUniversity?: (university: ApprovedUniversity) => void;
  onDeleteUniversity?: (id: string) => void;
  isLoading: boolean;
}

export function UniversitiesTable({ universities, onUpdateUniversity, onDeleteUniversity, isLoading }: UniversitiesTableProps) {
  const numColumns = onUpdateUniversity ? 8 : 7;
  
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
            <TableHead>Company</TableHead>
            <TableHead>Entry Levels</TableHead>
            <TableHead className="min-w-[200px]">IELTS &amp; Requirements</TableHead>
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
                      <div className="flex items-center gap-1.5 text-red-600">
                        <AlertCircle className="h-3 w-3 shrink-0" />
                        <span className="text-[10px] font-semibold uppercase tracking-tight leading-none">
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
                    {uni.foundationName && (
                      <div className="flex items-start gap-1.5 text-[10px] leading-snug">
                        <GraduationCap className="h-3 w-3 shrink-0 mt-px text-muted-foreground" />
                        <span>
                          <span className="font-semibold uppercase tracking-tight text-muted-foreground">
                            Foundation:{' '}
                          </span>
                          {uni.foundationName}
                        </span>
                      </div>
                    )}
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
                  {uni.company ? (
                    <Badge variant="outline" className={cn('text-[10px] font-bold', COMPANY_COLORS[uni.company])}>
                      {uni.company}
                    </Badge>
                  ) : (
                    <span className="text-[10px] text-muted-foreground italic">—</span>
                  )}
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
                  <RequirementsCell university={uni} />
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
