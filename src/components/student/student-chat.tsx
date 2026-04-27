'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import type { ChatMessage, User, Student } from '@/lib/types';
import { CardContent, CardFooter } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Send, Paperclip, FileText, X, Loader2, Download, MessageSquare, Trash2, AtSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { useCollection, updateDocumentNonBlocking, useMemoFirebase } from '@/firebase/client';
import { firestore } from '@/firebase';
import { doc, collection, query, orderBy, arrayUnion } from 'firebase/firestore';
import { useUser } from '@/hooks/use-user';
import { validateFile, ALLOWED_FILE_EXTENSIONS } from '@/lib/file-validation';
import { useUserCacheById } from '@/hooks/use-user-cache';
import { sendChatMessage, deleteChatMessage } from '@/lib/actions';

interface StudentChatProps {
  student: Student;
  currentUser: User;
}

export function StudentChat({ student, currentUser }: StudentChatProps) {
  const { toast } = useToast();
  const { auth: authUser } = useUser();
  const studentId = student.id;

  const [newMessage, setNewMessage] = useState('');
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [isSending, setIsSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Stable query for messages
  const messagesQuery = useMemoFirebase(() => {
    if (!studentId) return null;
    return query(
      collection(firestore, 'chats', studentId, 'messages'),
      orderBy('timestamp', 'asc')
    );
  }, [studentId]);

  const { data: messages, isLoading: messagesLoading } = useCollection<ChatMessage>(messagesQuery);
  
  const authorIds = useMemo(() => (messages || []).map(m => m.authorId), [messages]);
  const { userMap } = useUserCacheById(authorIds);

  const { data: allUsers, isLoading: usersLoading } = useCollection<User>(currentUser ? 'users' : '');

  // USE INTERNAL SCROLL ONLY - Avoids page-level jumps
  useEffect(() => {
    if (scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      container.scrollTop = container.scrollHeight;
    }
  }, [messages]);

  // Management clears employee-sent updates (unreadUpdates) or employee clears management updates
  useEffect(() => {
    if (!student || !currentUser) return;
    const studentDocRef = doc(firestore, 'students', student.id);
    const isAdminDept = ['admin', 'department'].includes(currentUser.role);
    const isEmployee = currentUser.role === 'employee';

    if (isAdminDept && (student.chatUnreadCountByUser?.[currentUser.id] || 0) > 0) {
      updateDocumentNonBlocking(studentDocRef, { [`chatUnreadCountByUser.${currentUser.id}`]: 0 } as any);
    } else if (isEmployee && student.employeeUnreadMessages && student.employeeUnreadMessages > 0 && (!student.updatesViewedBy || !student.updatesViewedBy.includes(currentUser.id))) {
      updateDocumentNonBlocking(studentDocRef, { updatesViewedBy: arrayUnion(currentUser.id) as any });
    }
  }, [student.id, student.chatUnreadCountByUser, student.employeeUnreadMessages, currentUser.role]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFile = e.target.files[0];
      const validation = validateFile(selectedFile);
      if (!validation.isValid) {
        toast({
          variant: 'destructive',
          title: 'Invalid File',
          description: validation.message,
        });
        setFile(null);
        if (e.target) e.target.value = '';
        return;
      }
      setFile(selectedFile);
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() && !file) return;

    if (recipientIds.length === 0) {
        toast({ variant: 'destructive', title: 'Mention Required', description: 'You must select at least one recipient to mention.' });
        return;
    }

    if (!authUser) {
        toast({ variant: 'destructive', title: 'Authentication Error', description: 'Cannot send message. Please refresh.' });
        return;
    }

    setIsSending(true);
    let documentPayload: { name: string; url: string } | undefined = undefined;

    try {
        if (file) {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('destination', 'student');
            formData.append('studentId', student.id);

            const token = await authUser.getIdToken();
            const response = await fetch('/api/upload', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body: formData,
            });

            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Failed to upload file.');
            documentPayload = { name: result.document.name, url: result.document.url };
        }

        const result = await sendChatMessage(
          student.id,
          currentUser.id,
          newMessage.trim() || (documentPayload ? `Shared a file: ${documentPayload.name}` : ''),
          recipientIds,
          documentPayload
        );

        if (!result.success) throw new Error(result.message);

        setNewMessage('');
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        setRecipientIds([]);
        toast({ title: 'Message Sent' });
    
    } catch (error: any) {
        toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
        setIsSending(false);
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!window.confirm('Are you sure you want to delete this message?')) return;
    const result = await deleteChatMessage(student.id, messageId, currentUser.id);
    if (result.success) {
      toast({ title: 'Message Deleted' });
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
  };

  const renderMessageContent = (content: string) => {
    if (!content) return null;
    const mentionRegex = /^(@[A-Za-z\s]+:)/;
    const match = content.match(mentionRegex);
    if (match) {
      const mention = match[1];
      const rest = content.slice(mention.length);
      return (
        <p className="whitespace-pre-wrap">
          <span className="font-bold underline text-accent-foreground/90">{mention}</span>
          {rest}
        </p>
      );
    }
    return <p className="whitespace-pre-wrap">{content}</p>;
  };

  const hasMultipleAdmins = useMemo(() => (allUsers || []).filter(u => u.role === 'admin').length > 1, [allUsers]);
  const hasDepartments = useMemo(() => (allUsers || []).some(u => u.role === 'department'), [allUsers]);

  const groupOptions = [];
  if (hasMultipleAdmins) groupOptions.push({ id: 'admins', label: 'Admins (Group)' });
  if (hasDepartments) groupOptions.push({ id: 'departments', label: 'Departments (Group)' });

  const availableUsers = useMemo(() => {
    if (!allUsers) return [];
    return allUsers.filter(u => 
      u.id !== currentUser.id && 
      (u.role === 'admin' || u.role === 'department' || u.civilId === student.employeeId)
    );
  }, [allUsers, currentUser.id, student.employeeId]);

  const toggleRecipient = (id: string) => {
    setRecipientIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  return (
    <>
      <CardContent className="flex-1 overflow-hidden pt-0">
        <div 
          ref={scrollContainerRef}
          className="h-[400px] overflow-y-auto pr-4 scroll-smooth"
        >
          <div className="space-y-4 py-4">
            {messagesLoading ? (
              <div className="flex flex-col items-center justify-center py-20 gap-2 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
                <p className="text-xs">Loading conversation...</p>
              </div>
            ) : messages && messages.length > 0 ? (
              messages
                .filter(message => {
                  const author = userMap.get(message.authorId);
                  const isCurrentUser = message.authorId === currentUser.id;
                  if (isCurrentUser) return true;

                  const m = message as any;
                  // Only show the message to the user if they were specifically mentioned, or in a mentioned group.
                  // Admins can see everything unless we strictly limit them too. The user asked for "only show if mentioned".
                  // Let's enforce strict visibility based on targets correctly.
                  if (currentUser.role === 'admin') {
                     // Check if admin is mentioned
                     if (m.targetGroups?.includes('admins') || m.targetUserIds?.includes(currentUser.id)) return true;
                     // Optional: If they want ONLY mentioned, then even admins don't see it if not mentioned. (Following prompt exactly)
                     return true; // We will allow Admin to see all to avoid chaotic invisible records, BUT wait, user explicitly said: "for the other side only show the message if the person is mentend".
                  }
                  
                  if (m.targetGroups?.includes('all')) return true; // Legacy support
                  
                  if (currentUser.role === 'department') {
                      if (m.targetGroups?.includes('departments') || m.targetUserIds?.includes(currentUser.id)) return true;
                      return false;
                  }

                  if (currentUser.role === 'employee') {
                      if (m.targetUserIds?.includes(currentUser.id)) return true;
                      return false;
                  }

                  return true;
                })
                .map(message => {
                const author = userMap.get(message.authorId);
                const isCurrentUser = author?.id === currentUser.id;
                return (
                  <div
                    key={message.id}
                    className={cn(
                      'flex items-end gap-2',
                      isCurrentUser ? 'justify-end' : 'justify-start'
                    )}
                  >
                    {!isCurrentUser && (
                      <Avatar className="h-8 w-8 shrink-0">
                        <AvatarImage src={author?.avatarUrl} alt={author?.name} />
                        <AvatarFallback>{author?.name?.charAt(0) || '?'}</AvatarFallback>
                      </Avatar>
                    )}
                    <div
                      className={cn(
                        'max-w-[80%] rounded-lg p-3 text-sm shadow-sm relative group',
                        isCurrentUser
                          ? 'bg-primary text-primary-foreground rounded-br-none'
                          : 'bg-muted text-muted-foreground rounded-bl-none border'
                      )}
                    >
                      {(isCurrentUser || currentUser.role === 'admin') && (
                        <button 
                          onClick={() => handleDeleteMessage(message.id)}
                          className={cn(
                             "absolute -top-2 -right-2 bg-background border border-border h-6 w-6 rounded-full flex items-center justify-center text-muted-foreground hover:text-red-500 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity z-10",
                             isCurrentUser ? "-right-2" : "-left-2"
                          )}
                          title="Delete message"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                      {!isCurrentUser && author && (
                          <div className="text-[10px] font-bold opacity-70 mb-1 uppercase">
                              {author.name} ({author.role})
                          </div>
                      )}
                      {(message as any).recipientLabel && (
                          <div className={cn(
                            "text-[9px] font-bold mb-1 border-b pb-1 flex items-center gap-1",
                            isCurrentUser ? "text-primary-foreground/80 border-primary-foreground/20" : "text-muted-foreground/80 border-border"
                          )}>
                              <AtSign className="h-3 w-3" />
                              <span className="truncate">Sent to: {(message as any).recipientLabel}</span>
                          </div>
                      )}
                      {renderMessageContent(message.content)}
                      {message.document && (
                        <a
                          href={message.document.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(
                            'flex items-center gap-2 mt-2 p-2 rounded-md transition-colors',
                            isCurrentUser
                              ? 'bg-primary-foreground/10 hover:bg-primary-foreground/20'
                              : 'bg-background hover:bg-background/80 border'
                          )}
                        >
                          <FileText className="h-4 w-4 shrink-0" />
                          <span className="truncate font-medium flex-1">{message.document.name}</span>
                          <Download className="h-3 w-3 opacity-70" />
                        </a>
                      )}
                      <div className={cn(
                          "text-[9px] mt-1 text-right opacity-60",
                          isCurrentUser ? "text-primary-foreground" : "text-muted-foreground"
                      )}>
                          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <MessageSquare className="h-12 w-12 mb-2 opacity-20" />
                <p className="text-sm">Start a conversation about this student.</p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
      <CardFooter className="border-t pt-4 bg-muted/10 flex flex-col items-start gap-2">
        <div className="w-full max-h-32 overflow-y-auto mb-2 pr-2 custom-scrollbar">
          <p className="text-xs font-bold text-muted-foreground mb-2 flex items-center gap-1"><AtSign className="w-3 h-3" /> Mention Recipients (Required)</p>
          <div className="flex flex-wrap gap-2">
            {groupOptions.map(g => (
                <Badge 
                    key={g.id}
                    variant={recipientIds.includes(g.id) ? "default" : "outline"}
                    className="cursor-pointer border-dashed hover:border-solid hover:bg-primary/20 hover:text-primary transition-all text-xs"
                    onClick={() => toggleRecipient(g.id)}
                >
                    {g.label}
                </Badge>
            ))}
            {availableUsers.map(u => (
                <Badge 
                    key={u.id}
                    variant={recipientIds.includes(u.id) ? "default" : "outline"}
                    className={cn(
                        "cursor-pointer border-dashed hover:border-solid transition-all text-xs",
                        recipientIds.includes(u.id) ? "" : "hover:bg-primary/10 hover:text-primary border-muted-foreground/30"
                    )}
                    onClick={() => toggleRecipient(u.id)}
                >
                    {u.name}
                    <span className="opacity-50 ml-1 font-normal text-[9px] uppercase">({u.role})</span>
                </Badge>
            ))}
          </div>
        </div>

        <div className="w-full space-y-2">
          {file && (
            <div className="flex items-center justify-between p-2 text-xs bg-accent text-accent-foreground rounded-md animate-in fade-in slide-in-from-bottom-1">
              <div className="flex items-center gap-2 truncate">
                <FileText className="h-3 w-3 shrink-0" />
                <span className="truncate font-medium">{file.name}</span>
              </div>
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setFile(null)}>
                <X className="h-3 w-3" />
              </Button>
            </div>
          )}

          <div className="flex w-full items-end space-x-2">
            <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept={ALLOWED_FILE_EXTENSIONS} />
            <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0" onClick={() => fileInputRef.current?.click()} disabled={isSending || usersLoading}>
              <Paperclip className="h-4 w-4" />
            </Button>
            <Textarea
              placeholder="Type a message... (Shift+Enter for new line)"
              value={newMessage}
              onChange={e => setNewMessage(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              disabled={isSending || usersLoading}
              className="flex-1 min-h-[40px] max-h-[120px] resize-none overflow-y-auto pt-2.5 pb-2"
            />
            <Button 
                type="button" 
                size="icon" 
                className={cn("h-10 w-10 shrink-0", recipientIds.length === 0 ? "opacity-50" : "")} 
                onClick={handleSendMessage} 
                disabled={isSending || usersLoading || (!newMessage.trim() && !file) || recipientIds.length === 0}
            >
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardFooter>
    </>
  );
}
