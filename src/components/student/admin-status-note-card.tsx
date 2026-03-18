'use client';

import { useState, useEffect } from 'react';
import type { Student } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ShieldCheck, Save } from 'lucide-react';
import { updateStudentAdminStatusNote } from '@/lib/actions';
import { cn } from '@/lib/utils';

interface AdminStatusNoteCardProps {
  student: Student;
  currentUser: AppUser;
}

export function AdminStatusNoteCard({ student, currentUser }: AdminStatusNoteCardProps) {
  const [note, setNote] = useState(student.adminStatusNote || '');
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const isAdminOrDept = ['admin', 'department'].includes(currentUser.role);

  useEffect(() => {
    setNote(student.adminStatusNote || '');
  }, [student.adminStatusNote]);

  const handleSave = async () => {
    setIsLoading(true);
    const result = await updateStudentAdminStatusNote(student.id, note.trim(), currentUser.id);

    if (result.success) {
      toast({
        title: 'Admin Status Note Saved',
        description: 'This note is now visible to management in the Applicants table.',
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

  if (!isAdminOrDept) return null;

  return (
    <Card className="border-accent/20 bg-accent/5 shadow-sm">
      <CardHeader className="py-3 flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-accent" />
          <CardTitle className="text-sm font-bold uppercase tracking-widest text-accent">Management Status Note</CardTitle>
        </div>
        {!isEditing && (
          <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)} className="h-7 text-[10px] font-bold text-accent">
            Edit Admin Note
          </Button>
        )}
      </CardHeader>
      <CardContent className="pb-4">
        {isEditing ? (
          <div className="space-y-3">
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Enter a status update only visible to management..."
              className="bg-white text-sm"
              rows={3}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setIsEditing(false)} disabled={isLoading}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={isLoading} className="gap-2 bg-accent hover:bg-accent/90 text-white">
                {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                Save Admin Note
              </Button>
            </div>
          </div>
        ) : (
          <p className={cn(
            "text-sm font-medium italic leading-relaxed text-accent",
            !student.adminStatusNote && "opacity-50"
          )}>
            {student.adminStatusNote || "No management-specific status note provided yet."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
