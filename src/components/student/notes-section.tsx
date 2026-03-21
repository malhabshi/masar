
'use client';
import { useState, useMemo, useEffect } from 'react';
import type { Note } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Send, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { formatRelativeTime, sortByDate } from '@/lib/timestamp-utils';
import { useUserCacheById } from '@/hooks/use-user-cache';

interface NotesSectionProps {
  notes: Note[];
  canWrite: boolean;
  title: string;
  placeholder: string;
  onAddNote: (content: string) => Promise<{ success: boolean; message: string }>;
}

export function NotesSection({ notes, canWrite, title, placeholder, onAddNote }: NotesSectionProps) {
  const [newNote, setNewNote] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const authorIds = useMemo(() => (notes || []).map(note => note.authorId), [notes]);
  const { userMap } = useUserCacheById(authorIds);

  const sortedNotes = useMemo(() => {
    if (!notes) return [];
    return [...notes].sort((a,b) => sortByDate(a,b));
  }, [notes]);

  const handleAddNote = async () => {
    if (!newNote.trim()) return;

    setIsLoading(true);
    const result = await onAddNote(newNote.trim());

    if (result.success) {
        toast({
          title: 'Note Added',
          description: 'Your note has been saved.',
        });
        setNewNote('');
    } else {
        toast({
            variant: 'destructive',
            title: 'Error',
            description: result.message,
        });
    }
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
              const author = userMap.get(note.authorId);
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
                      <span className="font-semibold">{author?.name || '...'}</span>
                      <span className="text-xs text-muted-foreground">{isClient ? formatRelativeTime(note.createdAt) : '...'}</span>
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
      {canWrite && (
        <CardFooter className="flex flex-col items-stretch gap-2 border-t pt-4">
          <Textarea 
            placeholder={placeholder}
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
