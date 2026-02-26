'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import type { ChatMessage, User, Student } from '@/lib/types';
import { CardContent, CardFooter } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Send, Paperclip, FileText, X, Loader2, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useCollection, addDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/client';
import { firestore } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { useUser } from '@/hooks/use-user';
import { validateFile, ALLOWED_FILE_EXTENSIONS } from '@/lib/file-validation';
import { useUserCacheById } from '@/hooks/use-user-cache';

interface StudentChatProps {
  student: Student;
  currentUser: User;
}

export function StudentChat({ student, currentUser }: StudentChatProps) {
  const { toast } = useToast();
  const { auth: authUser } = useUser();
  const studentId = student.id;

  const [newMessage, setNewMessage] = useState('');
  const [recipientId, setRecipientId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messagesPath = `chats/${studentId}/messages`;
  const { data: messagesData } = useCollection<ChatMessage>(messagesPath);

  const messages = useMemo(() => {
    if (!messagesData) return [];
    return [...messagesData].sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [messagesData]);
  
  const authorIds = useMemo(() => (messages || []).map(m => m.authorId), [messages]);
  const { userMap } = useUserCacheById(authorIds);

  const { data: allUsers, isLoading: usersLoading } = useCollection<User>(currentUser ? 'users' : '');
  const managementUsers = useMemo(() => (allUsers || []).filter(u => ['admin', 'department'].includes(u.role)), [allUsers]);
  const hasMultipleAdmins = useMemo(() => (allUsers || []).filter(u => u.role === 'admin').length > 1, [allUsers]);
  const hasDepartments = useMemo(() => (allUsers || []).some(u => u.role === 'department'), [allUsers]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Effect to clear document notification counters upon viewing.
  useEffect(() => {
    if (!student || !currentUser) return;
    const studentDocRef = doc(firestore, 'students', student.id);
    const isAdminDept = ['admin', 'department'].includes(currentUser.role);
    const isEmployee = currentUser.role === 'employee';

    // Management clears employee-sent updates
    if (isAdminDept && student.unreadUpdates && student.unreadUpdates > 0) {
      updateDocumentNonBlocking(studentDocRef, { unreadUpdates: 0 });
    } 
    // Employee clears management-sent messages
    else if (isEmployee && student.employeeUnreadMessages && student.employeeUnreadMessages > 0) {
      updateDocumentNonBlocking(studentDocRef, { employeeUnreadMessages: 0 });
    }
  }, [student.id, student.unreadUpdates, student.employeeUnreadMessages, currentUser.role]);

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

    if (!authUser) {
        toast({ variant: 'destructive', title: 'Authentication Error', description: 'Cannot send message. Please refresh.' });
        return;
    }

    setIsLoading(true);
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

        let finalMessageContent = newMessage.trim();
        const recipientUser = recipientId ? managementUsers.find(u => u.id === recipientId) : null;

        if (currentUser.role === 'employee' && recipientId) {
            if (recipientId === 'admins') {
                finalMessageContent = `@Admins: ${finalMessageContent}`;
            } else if (recipientId === 'departments') {
                finalMessageContent = `@Departments: ${finalMessageContent}`;
            } else if (recipientUser) {
                finalMessageContent = `@${recipientUser.name}: ${finalMessageContent}`;
            }
        }

        const message: Omit<ChatMessage, 'id'> = {
            authorId: currentUser.id,
            content: finalMessageContent || (documentPayload ? `Shared a file: ${documentPayload.name}` : ''),
            timestamp: new Date().toISOString(),
            ...(documentPayload && { document: documentPayload }),
        };

        const messagesCollection = collection(firestore, 'chats', studentId, 'messages');
        addDocumentNonBlocking(messagesCollection, message);

        // Update counters
        const studentDocRef = doc(firestore, 'students', student.id);
        const isAdminDept = ['admin', 'department'].includes(currentUser.role);
        
        if (isAdminDept) {
            const current = student.employeeUnreadMessages || 0;
            updateDocumentNonBlocking(studentDocRef, { employeeUnreadMessages: current + 1 });
        } else {
            const current = student.unreadUpdates || 0;
            updateDocumentNonBlocking(studentDocRef, { unreadUpdates: current + 1 });
        }

        setNewMessage('');
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        setRecipientId('');
        toast({ title: 'Message Sent' });
    
    } catch (error: any) {
        toast({ variant: 'destructive', title: 'Error', description: error.message });
    } finally {
        setIsLoading(false);
    }
  };

  const renderMessageContent = (content: string) => {
    if (!content) return null;
    
    // Highlight mentions (@Admins, @Departments, @Name)
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

  return (
    <>
      <CardContent className="flex-1 overflow-hidden pt-0">
        <ScrollArea className="h-[400px] pr-4">
          <div className="space-y-4">
            {messages.map(message => {
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
                      'max-w-[80%] rounded-lg p-3 text-sm shadow-sm',
                      isCurrentUser
                        ? 'bg-primary text-primary-foreground rounded-br-none'
                        : 'bg-muted text-muted-foreground rounded-bl-none border'
                    )}
                  >
                    {!isCurrentUser && author && (
                        <div className="text-[10px] font-bold opacity-70 mb-1 uppercase">
                            {author.name} ({author.role})
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
            })}
            <div ref={messagesEndRef} />
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                <MessageSquare className="h-12 w-12 mb-2 opacity-20" />
                <p className="text-sm">Start a conversation about this student.</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
      <CardFooter className="border-t pt-4 bg-muted/10">
        <div className="w-full space-y-2">
          {currentUser.role === 'employee' && (
            <Select onValueChange={setRecipientId} value={recipientId}>
              <SelectTrigger className="bg-background h-8 text-xs border-dashed" disabled={isLoading || usersLoading}>
                <SelectValue placeholder="Address message to... (Optional)" />
              </SelectTrigger>
              <SelectContent>
                {hasMultipleAdmins && <SelectItem value="admins">Admins (Group)</SelectItem>}
                {hasDepartments && <SelectItem value="departments">Departments (Group)</SelectItem>}
                {managementUsers.map(user => (
                  <SelectItem key={user.id} value={user.id}>{user.name} ({user.role})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          
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

          <div className="flex w-full items-center space-x-2">
            <Input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept={ALLOWED_FILE_EXTENSIONS} />
            <Button type="button" variant="outline" size="icon" onClick={() => fileInputRef.current?.click()} disabled={isLoading}>
              <Paperclip className="h-4 w-4" />
            </Button>
            <Input
              type="text"
              placeholder="Type a message..."
              value={newMessage}
              onChange={e => setNewMessage(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
              disabled={isLoading}
              className="flex-1"
            />
            <Button type="button" size="icon" onClick={handleSendMessage} disabled={isLoading || (!newMessage.trim() && !file)}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </CardFooter>
    </>
  );
}
