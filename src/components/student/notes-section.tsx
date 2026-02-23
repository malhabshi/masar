'use client';
import { useState, useMemo } from 'react';
import type { Student, Note } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Send, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { updateDocumentNonBlocking } from '@/firebase/client';
import { firestore } from '@/firebase';
import { doc } from 'firebase/firestore';
import { formatRelativeTime, sortByDate } from '@/lib/timestamp-utils';
import { useUsers } from '@/contexts/users-provider';

interface NotesSectionProps {
  student: Student;
  currentUser: AppUser;
  title: string;
  readOnly: boolean;
}

export function NotesSection({ student, currentUser, title, readOnly }: NotesSectionProps) {
  const [newNote, setNewNote] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const { getUserById } = useUsers();

  const sortedNotes = useMemo(() => {
    if (!student.notes) return [];
    return [...student.notes].sort((a,b) => sortByDate(a,b));
  }, [student.notes]);

  const handleAddNote = async () => {
    if (!newNote.trim() || !currentUser) return;

    setIsLoading(true);

    const noteToAdd: Note = {
      id: `note-${Date.now()}`,
      authorId: currentUser.id,
      content: newNote.trim(),
      createdAt: new Date().toISOString(),
    };
    
    const studentDocRef = doc(firestore, 'students', student.id);
    const updatedNotes = [...(student.notes || []), noteToAdd];
    updateDocumentNonBlocking(studentDocRef, { notes: updatedNotes });

    toast({
      title: 'Note Added',
      description: 'Your note has been saved.',
    });

    setNewNote('');
    setIsLoading(false);
  };
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {sortedNotes.length > 0 ? (
            sortedNotes.map(note => {
              const author = getUserById(note.authorId);
              return (
                <div key={note.id} className="flex items-start gap-3">
                  <Avatar className="h-8 w-8 border">
                    {author ? (
                        <>
                            <AvatarImage src={author.avatarUrl} alt={author.name} />
                            <AvatarFallback>{author.name.charAt(0)}</AvatarFallback>
                        </>
                    ) : <AvatarFallback>U</AvatarFallback>}
                  </Avatar>
                  <div className="flex-1 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{author?.name || 'Unknown'}</span>
                      <span className="text-xs text-muted-foreground">{formatRelativeTime(note.createdAt)}</span>
                    </div>
                    <p className="text-muted-foreground mt-1 whitespace-pre-wrap">{note.content}</p>
                  </div>
                </div>
              )
            })
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">No notes yet.</p>
          )}
        </div>
      </CardContent>
      {!readOnly && (
        <CardFooter className="flex flex-col items-stretch gap-2 border-t pt-4">
          <Textarea 
            placeholder="Add a new note..."
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
          />
          <Button onClick={handleAddNote} disabled={isLoading || !newNote.trim()} className="self-end">
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
            Add Note
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
