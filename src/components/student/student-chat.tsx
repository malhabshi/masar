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
import { useUsers } from '@/contexts/users-provider';
import { useUser } from '@/hooks/use-user';
import { validateFile, ALLOWED_FILE_EXTENSIONS } from '@/lib/file-validation';


interface StudentChatProps {
  student: Student;
  currentUser: User;
}

export function StudentChat({ student, currentUser }: StudentChatProps) {
  const { toast } = useToast();
  const { users, getUserById } = useUsers();
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
    return messagesData.sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [messagesData]);
  
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!student || !currentUser) return;
    const studentDocRef = doc(firestore, 'students', student.id);
    const isAdminDept = ['admin', 'department'].includes(currentUser.role);
    const isEmployee = currentUser.role === 'employee';

    if (isEmployee && student.employeeUnreadMessages && student.employeeUnreadMessages > 0) {
      updateDocumentNonBlocking(studentDocRef, { employeeUnreadMessages: 0 });
    } else if (isAdminDept && student.unreadUpdates && student.unreadUpdates > 0) {
      updateDocumentNonBlocking(studentDocRef, { unreadUpdates: 0 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [student?.id, currentUser?.id]);


  const managementUsers = useMemo(() => users.filter(u => ['admin', 'department'].includes(u.role)), [users]);
  const hasMultipleAdmins = useMemo(() => users.filter(u => u.role === 'admin').length > 1, [users]);
  const hasDepartments = useMemo(() => users.some(u => u.role === 'department'), [users]);

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
        if (e.target) e.target.value = ''; // Reset input
        return;
      }
      setFile(selectedFile);
    }
  };

  const handleSendMessage = async () => {
    if (!newMessage.trim() && !file) return;

    if (!authUser) {
        toast({ variant: 'destructive', title: 'Authentication Error', description: 'Cannot send message. Please refresh the page.' });
        return;
    }

    setIsLoading(true);
    let documentPayload: { name: string; url: string } | undefined = undefined;

    try {
        // 1. Handle file upload if a file is attached
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
            if (!response.ok) {
                throw new Error(result.error || 'Failed to upload file.');
            }
            documentPayload = { name: file.name, url: result.downloadURL };
        }

        // 2. Prepare and send the message
        let finalMessageContent = newMessage.trim();
        const recipientUser = recipientId ? users.find(u => u.id === recipientId) : null;
        let toastDescription = 'Your message has been added to the chat.';

        if (currentUser.role === 'employee' && recipientId) {
            if (recipientId === 'admins') {
                finalMessageContent = `@Admins: ${finalMessageContent}`;
                toastDescription = 'Your message addressing all admins has been added.';
            } else if (recipientId === 'departments') {
                finalMessageContent = `@Departments: ${finalMessageContent}`;
                toastDescription = 'Your message addressing all department users has been added.';
            } else if (recipientUser) {
                finalMessageContent = `@${recipientUser.name}: ${finalMessageContent}`;
                toastDescription = `Your message addressing ${recipientUser.name} has been added.`;
            }
        }

        const message: Omit<ChatMessage, 'id'> = {
            authorId: currentUser.id,
            content: finalMessageContent || (documentPayload ? `Shared a file` : ''),
            timestamp: new Date().toISOString(),
            ...(documentPayload && { document: documentPayload }),
        };

        const messagesCollection = collection(firestore, 'chats', studentId, 'messages');
        addDocumentNonBlocking(messagesCollection, message);

        // 3. Update unread counters
        if (student) {
            const studentDocRef = doc(firestore, 'students', student.id);
            if (['admin', 'department'].includes(currentUser.role) && student.employeeId) {
                const currentUnread = student.employeeUnreadMessages || 0;
                updateDocumentNonBlocking(studentDocRef, { employeeUnreadMessages: currentUnread + 1 });
            } else if (currentUser.role === 'employee') {
                const currentUnread = student.unreadUpdates || 0;
                updateDocumentNonBlocking(studentDocRef, { unreadUpdates: currentUnread + 1 });
            }
        }

        // 4. Reset state and show toast
        setNewMessage('');
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
        setRecipientId('');
        toast({ title: 'Message Sent', description: documentPayload ? `File '${documentPayload.name}' sent.` : toastDescription });
    
    } catch (error: any) {
        console.error("Failed to send message:", error);
        toast({ variant: 'destructive', title: 'Error', description: error.message || 'Could not send the message.' });
    } finally {
        setIsLoading(false);
    }
  };

  return (
    <>
      <CardContent className="flex-1 overflow-hidden pt-0">
        <ScrollArea className="h-80 pr-4">
          <div className="space-y-4">
            {messages.map(message => {
              const author = getUserById(message.authorId);
              const isCurrentUser = author?.id === currentUser.id;
              return (
                <div
                  key={message.id}
                  className={cn(
                    'flex items-end gap-2',
                    isCurrentUser ? 'justify-end' : 'justify-start'
                  )}
                >
                  {!isCurrentUser && author && (
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={author.avatarUrl} alt={author.name} />
                      <AvatarFallback>{author.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                  )}
                  <div
                    className={cn(
                      'max-w-xs rounded-lg p-3 text-sm',
                      isCurrentUser
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted'
                    )}
                  >
                    {message.content && <p className="whitespace-pre-wrap">{message.content}</p>}
                    {message.document && (
                      <a
                        href={message.document.url}
                        download={message.document.name}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(
                          'flex items-center gap-2 mt-2 p-2 rounded-md',
                          isCurrentUser
                            ? 'bg-primary-foreground/10 hover:bg-primary-foreground/20'
                            : 'bg-background/50 hover:bg-background'
                        )}
                      >
                        <FileText className="h-4 w-4 flex-shrink-0" />
                        <span className="truncate font-medium">{message.document.name}</span>
                        <Download className="h-4 w-4 ml-auto flex-shrink-0"/>
                      </a>
                    )}
                  </div>
                  {isCurrentUser && author && (
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={author.avatarUrl} alt={author.name} />
                      <AvatarFallback>{author.name.charAt(0)}</AvatarFallback>
                    </Avatar>
                  )}
                </div>
              );
            })}
            <div ref={messagesEndRef} />
            {messages.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                No messages yet. Start a conversation!
              </p>
            )}
          </div>
        </ScrollArea>
      </CardContent>
      <CardFooter className="border-t pt-4">
        <div className="w-full space-y-2">
          {currentUser.role === 'employee' && (
            <Select onValueChange={setRecipientId} value={recipientId}>
              <SelectTrigger disabled={isLoading}>
                <SelectValue placeholder="Address message to..." />
              </SelectTrigger>
              <SelectContent>
                {hasMultipleAdmins && (
                  <SelectItem value="admins">Admins (Group)</SelectItem>
                )}
                {hasDepartments && (
                  <SelectItem value="departments">Departments (Group)</SelectItem>
                )}
                {managementUsers.map(user => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name} ({user.role})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {file && (
            <div className="flex items-center justify-between p-2 text-sm bg-muted rounded-md">
              <div className="flex items-center gap-2 truncate">
                <FileText className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">{file.name}</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 flex-shrink-0"
                onClick={() => {
                  setFile(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          )}
          <div className="flex w-full items-center space-x-2">
            <Input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              className="hidden"
              accept={ALLOWED_FILE_EXTENSIONS}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
            >
              <Paperclip className="h-4 w-4" />
              <span className="sr-only">Attach file</span>
            </Button>
            <Input
              type="text"
              placeholder="Type a message..."
              value={newMessage}
              onChange={e => setNewMessage(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              disabled={isLoading}
            />
            <Button type="button" size="icon" onClick={handleSendMessage} disabled={isLoading || (!newMessage.trim() && !file)}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              <span className="sr-only">Send</span>
            </Button>
          </div>
        </div>
      </CardFooter>
    </>
  );
}
