
'use client';

import { useState } from 'react';
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
import { useToast } from '@/hooks/use-toast';
import { Loader2, GitMerge } from 'lucide-react';
import type { Student, Application, Document, Note } from '@/lib/types';
import { useFirebase, updateDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase';
import { doc } from 'firebase/firestore';

interface MergeStudentDialogProps {
  primaryStudent: Student;
  secondaryStudent: Student;
}

export function MergeStudentDialog({ primaryStudent, secondaryStudent }: MergeStudentDialogProps) {
  const { toast } = useToast();
  const { firestore } = useFirebase();
  const [isMerging, setIsMerging] = useState(false);

  const handleMerge = () => {
    if (!firestore) return;
    setIsMerging(true);

    // 1. Merge Notes
    const mergedNotes: Note[] = [...primaryStudent.notes, ...secondaryStudent.notes];

    // 2. Merge Applications (keeping the one with the latest update on conflict)
    const appMap = new Map<string, Application>();
    [...primaryStudent.applications, ...secondaryStudent.applications].forEach(app => {
        const key = `${app.university}|${app.major}`;
        const existing = appMap.get(key);
        if (!existing || new Date(app.updatedAt) > new Date(existing.updatedAt)) {
            appMap.set(key, app);
        }
    });
    const mergedApplications = Array.from(appMap.values());

    // 3. Merge Documents (simple concatenation, filtering by name)
    const docMap = new Map<string, Document>();
    [...primaryStudent.documents, ...secondaryStudent.documents].forEach(doc => {
        if (!docMap.has(doc.name)) {
            docMap.set(doc.name, doc);
        }
    });
    const mergedDocuments = Array.from(docMap.values());

    // 4. Merge Missing Items
    const mergedMissingItems = Array.from(new Set([...(primaryStudent.missingItems || []), ...(secondaryStudent.missingItems || [])]));
    
    // 5. Update primary student
    const primaryStudentDocRef = doc(firestore, 'students', primaryStudent.id);
    updateDocumentNonBlocking(primaryStudentDocRef, {
        notes: mergedNotes,
        applications: mergedApplications,
        documents: mergedDocuments,
        missingItems: mergedMissingItems,
    });

    // 6. Delete secondary student
    const secondaryStudentDocRef = doc(firestore, 'students', secondaryStudent.id);
    deleteDocumentNonBlocking(secondaryStudentDocRef);

    // 7. Toast and redirect
    toast({
        title: 'Merge Successful!',
        description: `${primaryStudent.name} and ${secondaryStudent.name} have been merged into one profile.`,
    });

    // We can either push to the new merged profile (which is the current page)
    // or to the applicants list. Let's just reload to show the merged data.
    window.location.reload();
    
    setIsMerging(false);
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
            <GitMerge className="mr-2 h-4 w-4" />
            Merge
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Merge Student Profiles?</AlertDialogTitle>
          <AlertDialogDescription>
            You are about to merge the profile of <strong>{secondaryStudent.name}</strong> into the profile of <strong>{primaryStudent.name}</strong>.
            <ul className="list-disc pl-5 mt-2 text-left text-muted-foreground">
                <li>All notes, applications, and documents will be combined.</li>
                <li>In case of duplicate applications, the most recently updated one will be kept.</li>
                <li>The profile for <strong>{secondaryStudent.name}</strong> will be permanently deleted.</li>
            </ul>
            <br />This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleMerge} disabled={isMerging} className="bg-destructive hover:bg-destructive/90">
            {isMerging ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Confirm Merge
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
