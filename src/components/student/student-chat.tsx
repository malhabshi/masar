'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import type { ChatMessage, User, Student } from '@/lib/types';
import { CardContent, CardFooter } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Send, Paperclip, FileText, X } from 'lucide-react';
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
import { firestore, useCollection, useMemoFirebase, addDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/client';
import { collection, doc } from 'firebase/firestore';

interface StudentChatProps {
  student: Student;
  currentUser: User;
  users: User[];
}

export function StudentChat({ student, currentUser, users }: StudentChatProps) {
  const { toast } = useToast();
  const studentId = student.id;

  const [newMessage, setNewMessage] = useState('');
  const [recipientId, setRecipientId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messagesCollection = useMemoFirebase(() => {
    return collection(firestore, 'chats', studentId, 'messages');
  }, [studentId]);

  const { data: messagesData } = useCollection<ChatMessage>(messagesCollection);

  const messages = useMemo(() => {
    if (!messagesData) return [];
    return messagesData.sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [messagesData]);
  
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const managementUsers = useMemo(() => users.filter(u => ['admin', 'department'].includes(u.role)), [users]);
  const hasMultipleAdmins = useMemo(() => users.filter(u => u.role === 'admin').length > 1, [users]);
  const hasDepartments = useMemo(() => users.some(u => u.role === 'department'), [users]);

  const getAuthor = (authorId: string) => users.find(u => u.id === authorId);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFile(e.target.files[0]);
    }
  };

  const handleSendMessage = () => {
    if (!newMessage.trim() && !file) return;
    if (!messagesCollection) return;

    let finalMessageContent = newMessage;
    const recipientUser = recipientId ? users.find(u => u.id === recipientId) : null;
    let toastDescription = 'Your message has been added to the chat.';

    if (currentUser.role === 'employee' && recipientId) {
      if (recipientId === 'admins') {
        finalMessageContent = `@Admins: ${newMessage}`;
        toastDescription = 'Your message addressing all admins has been added to the chat.';
      } else if (recipientId === 'departments') {
        finalMessageContent = `@Departments: ${newMessage}`;
        toastDescription = 'Your message addressing all department users has been added.';
      } else if (recipientUser) {
        finalMessageContent = `@${recipientUser.name}: ${newMessage}`;
        toastDescription = `Your message addressing ${recipientUser.name} has been added to the chat.`;
      }
    }

    const message: Omit<ChatMessage, 'id'> = {
      authorId: currentUser.id,
      content: finalMessageContent,
      timestamp: new Date().toISOString(),
    };

    if (file) {
      (message as any).document = {
        name: file.name,
        url: '#', // Placeholder URL
      };
      if (!message.content.trim()) {
        message.content = `Shared a file`;
      }
      toastDescription = 'Your file has been shared in the chat.';
    }

    addDocumentNonBlocking(messagesCollection, message);

    if (student) {
        const studentDocRef = doc(firestore, 'students', student.id);
        if (['admin', 'department'].includes(currentUser.role) && student.employeeId) {
            // Admin/dept is sending, notify employee
            const currentUnread = student.employeeUnreadMessages || 0;
            updateDocumentNonBlocking(studentDocRef, { employeeUnreadMessages: currentUnread + 1 });
        } else if (currentUser.role === 'employee') {
            // Employee is sending, notify admin/dept
            const currentUnread = student.unreadUpdates || 0;
            updateDocumentNonBlocking(studentDocRef, { unreadUpdates: currentUnread + 1 });
        }
    }

    setNewMessage('');
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setRecipientId('');

    toast({
      title: 'Message Sent',
      description: toastDescription,
    });
  };

  return (
    <>
      <CardContent className="flex-1 overflow-hidden pt-0">
        <ScrollArea className="h-80 pr-4">
          <div className="space-y-4">
            {messages.map(message => {
              const author = getAuthor(message.authorId);
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
                        className={cn(
                          'flex items-center gap-2 mt-2 p-2 rounded-md',
                          isCurrentUser
                            ? 'bg-primary-foreground/10 hover:bg-primary-foreground/20'
                            : 'bg-background/50 hover:bg-background'
                        )}
                      >
                        <FileText className="h-4 w-4 flex-shrink-0" />
                        <span className="truncate">{message.document.name}</span>
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
              <SelectTrigger>
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
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
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
            />
            <Button type="button" size="icon" onClick={handleSendMessage}>
              <Send className="h-4 w-4" />
              <span className="sr-only">Send</span>
            </Button>
          </div>
        </div>
      </CardFooter>
    </>
  );
}
