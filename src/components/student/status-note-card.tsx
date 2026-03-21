'use client';

import { useState, useEffect } from 'react';
import type { Student } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Loader2, StickyNote, Save } from 'lucide-react';
import { updateStudentStatusNote } from '@/lib/actions';

interface StatusNoteCardProps {
  student: Student;
  currentUser: AppUser;
}

export function StatusNoteCard({ student, currentUser }: StatusNoteCardProps) {
  const [note, setNote] = useState(student.statusNote || '');
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const isAssignedEmployee = currentUser.civilId === student.employeeId;

  useEffect(() => {
    setNote(student.statusNote || '');
  }, [student.statusNote]);

  const handleSave = async () => {
    setIsLoading(true);
    const result = await updateStudentStatusNote(student.id, note.trim(), currentUser.id);

    if (result.success) {
      toast({
        title: 'Status Note Saved',
        description: 'This note is now visible in the Applicants table.',
      });
      setIsEditing(false);
    } else {
      toast({
        variant: 'destructive',
        title: 'Save Failed',
        description: result.message,
      });
    }
    setIsLoading(false);
  };

  return (
    <Card className="border-primary/20 bg-primary/5 shadow-sm">
      <CardHeader className="py-3 flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <StickyNote className="h-4 w-4 text-primary" />
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Current Status Note</CardTitle>
        </div>
        {isAssignedEmployee && !isEditing && (
          <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)} className="h-7 text-[10px] font-bold">
            Edit Note
          </Button>
        )}
      </CardHeader>
      <CardContent className="pb-4">
        {isEditing ? (
          <div className="space-y-3">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Enter a brief status update for the master list..."
              className="bg-white text-sm"
              rows={3}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setIsEditing(false)} disabled={isLoading}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={isLoading} className="gap-2">
                {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                Save to Master List
              </Button>
            </div>
          </div>
        ) : (
          <p className={cn(
            "text-sm font-medium italic leading-relaxed",
            !student.statusNote && "text-muted-foreground opacity-50"
          )}>
            {student.statusNote || "No status note provided by the employee yet."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

import { cn } from '@/lib/utils';
