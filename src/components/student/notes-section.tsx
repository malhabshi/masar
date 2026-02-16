'use client';

import { useState, useMemo } from 'react';
import type { Note, User, Student } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useFirebase, updateDocumentNonBlocking } from '@/firebase';
import { doc } from 'firebase/firestore';

interface NotesSectionProps {
  student: Student;
  currentUser: User;
  title: string;
  users: User[];
  readOnly?: boolean;
  noteFilter: 'admin' | 'employee' | 'all';
}

export function NotesSection({ student, currentUser, title, users, readOnly = false, noteFilter }: NotesSectionProps) {
  const [newNote, setNewNote] = useState('');
  const { toast } = useToast();
  const { firestore } = useFirebase();

  const getAuthor = (authorId: string) => users.find(u => u.id === authorId);
  const managementRoles = ['admin', 'department'];

  const filteredNotes = useMemo(() => {
    if (noteFilter === 'all') return student.notes;
    return student.notes.filter(note => {
      const author = getAuthor(note.authorId);
      if (noteFilter === 'admin') {
        return author && managementRoles.includes(author.role);
      }
      if (noteFilter === 'employee') {
        return !author || !managementRoles.includes(author.role);
      }
      return false;
    });
  }, [student.notes, noteFilter, users]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim() || !firestore) return;

    const newNoteObject: Note = {
      id: `note-${Date.now()}`,
      authorId: currentUser.id,
      content: newNote.trim(),
      createdAt: new Date().toISOString(),
    };

    const studentDocRef = doc(firestore, 'students', student.id);
    const updatedNotes = [...student.notes, newNoteObject];
    
    updateDocumentNonBlocking(studentDocRef, { notes: updatedNotes });
    
    toast({ title: 'Note Added', description: 'Your note has been saved.' });
    setNewNote('');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-64 pr-4">
            <div className="space-y-4">
                {filteredNotes.length > 0 ? (
                    filteredNotes.slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map((note) => {
                    const author = getAuthor(note.authorId);
                    return (
                        <div key={note.id} className="flex items-start gap-3">
                        <Avatar className="h-8 w-8">
                            <AvatarImage src={author?.avatarUrl} alt={author?.name} />
                            <AvatarFallback>{author?.name.charAt(0)}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                            <div className="flex items-center justify-between">
                                <span className="font-semibold">{author?.name}</span>
                                <span className="text-xs text-muted-foreground">
                                    {new Date(note.createdAt).toLocaleString()}
                                </span>
                            </div>
                            <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{note.content}</p>
                        </div>
                        </div>
                    );
                    })
                ) : (
                    <p className="text-sm text-muted-foreground text-center py-8">No notes yet.</p>
                )}
            </div>
        </ScrollArea>
      </CardContent>
      {!readOnly && (
        <CardFooter>
            <form onSubmit={handleSubmit} className="w-full space-y-2">
            <Textarea
                placeholder="Add a new note..."
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
            />
            <Button type="submit" className="w-full">Add Note</Button>
            </form>
        </CardFooter>
      )}
    </Card>
  );
}
