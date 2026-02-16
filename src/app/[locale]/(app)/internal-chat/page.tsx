
'use client';

import { Fragment, useState, useMemo, useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { useUser } from '@/hooks/use-user';
import type { Student, User, ChatMessage } from '@/lib/types';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Send, MessageSquare, Search, ArrowLeft, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useFirebase, useCollection, useMemoFirebase, addDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase';
import { collection, doc, query, where, getDocs, getDoc, documentId } from 'firebase/firestore';
import { useUsers } from '@/contexts/users-provider';

type Conversation = {
  student: Student;
  employee: User;
};

export default function InternalChatPage() {
  const { user: currentUser, isUserLoading } = useUser();
  const { users, usersLoading } = useUsers();
  const { firestore } = useFirebase();

  // Common state
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [lastUnreadCount, setLastUnreadCount] = useState(0);

  const isAdminOrDept = useMemo(() => currentUser && ['admin', 'department'].includes(currentUser.role), [currentUser]);

  // --- Data Fetching Logic ---
  
  // Fetch all students for admin/dept
  const allStudentsQuery = useMemoFirebase(() => {
    if (!firestore || !isAdminOrDept) return null;
    return collection(firestore, 'students');
  }, [firestore, isAdminOrDept]);
  const { data: allStudentsData, isLoading: allStudentsLoading } = useCollection<Student>(allStudentsQuery);

  // Fetch assigned students for employee directly
  const employeeStudentsQuery = useMemoFirebase(() => {
      if (!firestore || isAdminOrDept || !currentUser?.civilId) return null;
      return query(collection(firestore, 'students'), where('employeeId', '==', currentUser.civilId));
  }, [firestore, isAdminOrDept, currentUser]);
  const { data: employeeStudentsData, isLoading: employeeStudentsLoading } = useCollection<Student>(employeeStudentsQuery);

  // Consolidate students list based on role
  const students = useMemo(() => {
    if (isAdminOrDept) {
      return allStudentsData || [];
    }
    return employeeStudentsData || [];
  }, [isAdminOrDept, allStudentsData, employeeStudentsData]);

  // Consolidate loading state
  const isDataLoading = isUserLoading || usersLoading || (isAdminOrDept ? allStudentsLoading : employeeStudentsLoading);

  // --- End Data Fetching Logic ---


  // Fetch messages only for the selected student
  const messagesCollection = useMemoFirebase(() => {
    if (!firestore || !selectedStudentId) return null;
    return collection(firestore, 'chats', selectedStudentId, 'messages');
  }, [firestore, selectedStudentId]);

  const { data: messagesData, isLoading: messagesLoading } = useCollection<ChatMessage>(messagesCollection);
  const messages = useMemo(() => {
    if (!messagesData) return [];
    return messagesData.sort((a,b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [messagesData]);


  const allConversations: Conversation[] = useMemo(() => {
    if (!currentUser || !students) return [];

    const conversations = students
      .filter(student => student.employeeId)
      .map(student => {
        const employee = users.find((u) => u.civilId === student.employeeId);
        return employee ? { student, employee } : null;
      })
      .filter((c): c is Conversation => c !== null);

    return conversations.sort((a, b) => {
        const aUnread = isAdminOrDept ? (a.student.unreadUpdates || 0) : (a.student.employeeUnreadMessages || 0);
        const bUnread = isAdminOrDept ? (b.student.unreadUpdates || 0) : (b.student.employeeUnreadMessages || 0);
        
        if (bUnread > aUnread) return 1;
        if (aUnread > bUnread) return -1;
        
        return a.student.name.localeCompare(b.student.name);
    });
  }, [currentUser, students, users, isAdminOrDept]);
  
  const totalUnreadMessages = useMemo(() => {
    if (!students || !currentUser) return 0;
    if (isAdminOrDept) {
        return students.reduce((acc, s) => acc + (s.unreadUpdates || 0), 0);
    }
    return students.reduce((acc, s) => acc + (s.employeeUnreadMessages || 0), 0);
  }, [students, currentUser, isAdminOrDept]);

  const selectedConversation = useMemo(() => {
    if (!selectedStudentId) return null;
    return allConversations.find(c => c.student.id === selectedStudentId);
  }, [selectedStudentId, allConversations]);

  const filteredConversations = useMemo(() => {
    if (!searchQuery) return allConversations;
    return allConversations.filter(c => 
      c.student.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.employee.name.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [allConversations, searchQuery]);

  // Effect to scroll to the bottom of messages
  useEffect(() => {
    if(selectedConversation) {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [selectedConversation, messages, lastUnreadCount]);

  // Effect to mark a conversation as read after viewing
  useEffect(() => {
    if (selectedConversation && firestore && currentUser) {
        const studentDocRef = doc(firestore, 'students', selectedConversation.student.id);
        if (isAdminOrDept) {
            const unreadCount = selectedConversation.student.unreadUpdates || 0;
            if (unreadCount > 0) {
                setLastUnreadCount(unreadCount); // Store the count before resetting
                updateDocumentNonBlocking(studentDocRef, { unreadUpdates: 0 });
            } else {
                setLastUnreadCount(0); // Reset if there were no unread messages
            }
        } else if (currentUser.civilId === selectedConversation.student.employeeId) {
            const unreadCount = selectedConversation.student.employeeUnreadMessages || 0;
            if (unreadCount > 0) {
                 setLastUnreadCount(unreadCount);
                 updateDocumentNonBlocking(studentDocRef, { employeeUnreadMessages: 0 });
            } else {
                 setLastUnreadCount(0);
            }
        }
    } else {
        setLastUnreadCount(0); // Reset when no conversation is selected
    }
  }, [selectedConversation, firestore, isAdminOrDept, currentUser]);

  const handleSendMessage = () => {
    if (!newMessage.trim() || !selectedConversation || !currentUser || !firestore) return;
    
    const message: Omit<ChatMessage, 'id'> = {
        authorId: currentUser.id,
        content: newMessage,
        timestamp: new Date().toISOString(),
    };
    
    const messagesCollectionRef = collection(firestore, 'chats', selectedConversation.student.id, 'messages');
    addDocumentNonBlocking(messagesCollectionRef, message);

    const student = selectedConversation.student;
    const studentDocRef = doc(firestore, 'students', student.id);
    if (student.employeeId && ['admin', 'department'].includes(currentUser.role)) {
        const currentUnread = student.employeeUnreadMessages || 0;
        updateDocumentNonBlocking(studentDocRef, { employeeUnreadMessages: currentUnread + 1 });
    } else if (currentUser.role === 'employee') {
        const currentUnread = student.unreadUpdates || 0;
        updateDocumentNonBlocking(studentDocRef, { unreadUpdates: currentUnread + 1 });
    }

    setNewMessage('');
  };

  const getAuthor = (authorId: string) => {
    return users.find(u => u.id === authorId) || null;
  }

  if (isDataLoading) {
      return <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }
  if (!currentUser) {
      return <div className="flex h-full w-full items-center justify-center"><p>You must be logged in to view this page.</p></div>;
  }

  // This handles mobile view where one panel is shown at a time
  const showChatPanel = selectedConversation !== null;

  return (
    <div className="h-full w-full grid grid-cols-1 md:grid-cols-[350px_1fr] border bg-card text-card-foreground rounded-lg overflow-hidden shadow-sm">
        {/* Conversation List Panel */}
        <div className={cn(
            "flex flex-col border-r bg-muted/50 min-h-0",
            showChatPanel && "hidden md:flex"
        )}>
            <div className="p-4 border-b">
                <h2 className="text-xl font-semibold tracking-tight truncate">
                  Inbox {totalUnreadMessages > 0 ? `(${totalUnreadMessages})` : ''}
                </h2>
                <div className="relative mt-4">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search conversations..."
                        className="pl-8 bg-background"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
            </div>
            <ScrollArea className="flex-1">
                <nav className="p-2 space-y-1">
                    {filteredConversations.map((convo) => {
                        const unreadCount = isAdminOrDept ? convo.student.unreadUpdates : convo.student.employeeUnreadMessages;
                        return (
                            <button
                                key={convo.student.id}
                                className={cn(
                                    "w-full text-left p-3 rounded-lg hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 transition-colors flex items-start gap-4",
                                    selectedStudentId === convo.student.id && "bg-zinc-200/50 dark:bg-zinc-800/50"
                                )}
                                onClick={() => setSelectedStudentId(convo.student.id)}
                            >
                                <Avatar className="h-12 w-12 border">
                                    <AvatarFallback>{convo.student.name.charAt(0)}</AvatarFallback>
                                </Avatar>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="font-semibold truncate">{convo.student.name}</span>
                                            {(unreadCount ?? 0) > 0 && (
                                                <Badge variant="destructive" className="h-5 w-5 flex-shrink-0 items-center justify-center rounded-full p-0">{unreadCount}</Badge>
                                            )}
                                        </div>
                                    </div>
                                    <div className="text-sm text-muted-foreground truncate">with {convo.employee.name}</div>
                                </div>
                            </button>
                        )
                    })}
                    {filteredConversations.length === 0 && (
                        <div className="p-4 text-center text-sm text-muted-foreground">
                            {currentUser.role !== 'employee' ? 'No conversations found.' : 'No conversations for your assigned students.'}
                        </div>
                    )}
                </nav>
            </ScrollArea>
        </div>

        {/* Chat Panel */}
        <div className={cn(
            "flex flex-col h-full min-h-0",
            !showChatPanel && "hidden md:flex"
        )}>
            {selectedConversation ? (
                <>
                    {/* Chat Header */}
                    <div className="flex items-center p-3 border-b flex-shrink-0">
                        <Button variant="ghost" size="icon" className="md:hidden mr-2" onClick={() => setSelectedStudentId(null)}>
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                            <Avatar className="h-10 w-10 border flex-shrink-0">
                                <AvatarFallback>{selectedConversation.student.name.charAt(0)}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                                <div className="font-semibold truncate block">
                                    {selectedConversation.student.name}
                                </div>
                                <div className="text-xs text-muted-foreground truncate">
                                    Conversation with {selectedConversation.employee.name}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Messages */}
                    <ScrollArea className="flex-1 bg-zinc-50 dark:bg-zinc-900">
                        <div className="p-4 space-y-4">
                            {messagesLoading ? (
                                <div className="flex justify-center items-center h-full">
                                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                                </div>
                            ) : messages && messages.length > 0 ? (
                                messages.map((message, index) => {
                                    const author = getAuthor(message.authorId);
                                    const isCurrentUserMsg = author?.id === currentUser?.id;
                                    
                                    const firstUnreadIndex = messages.length - lastUnreadCount;
                                    const showSeparator = lastUnreadCount > 0 && index === firstUnreadIndex;
                                    
                                    return (
                                    <Fragment key={message.id}>
                                        {showSeparator && (
                                            <div className="relative my-4">
                                                <div className="absolute inset-0 flex items-center" aria-hidden="true">
                                                    <div className="w-full border-t border-destructive" />
                                                </div>
                                                <div className="relative flex justify-center">
                                                    <span className="bg-background px-2 text-sm text-destructive rounded-full">
                                                        New Messages
                                                    </span>
                                                </div>
                                            </div>
                                        )}
                                        <div
                                            className={cn(
                                            'flex items-end gap-2 w-full',
                                            isCurrentUserMsg ? 'justify-end' : 'justify-start'
                                            )}
                                        >
                                            {!isCurrentUserMsg && author && (
                                                <Avatar className="h-8 w-8 self-start">
                                                    
                                                    <AvatarFallback>{author.name.charAt(0)}</AvatarFallback>
                                                </Avatar>
                                            )}
                                            <div
                                                className={cn(
                                                    'max-w-lg rounded-xl p-3 px-4 text-sm shadow-sm',
                                                    isCurrentUserMsg
                                                    ? 'bg-primary text-primary-foreground rounded-br-none'
                                                    : 'bg-card border rounded-bl-none'
                                                )}
                                            >
                                                <p className="whitespace-pre-wrap">{message.content}</p>
                                                <p className={cn("text-xs mt-2 text-right", isCurrentUserMsg ? "text-primary-foreground/70" : "text-muted-foreground/70")}>
                                                    {format(new Date(message.timestamp), 'p')}
                                                </p>
                                            </div>
                                        </div>
                                    </Fragment>
                                    );
                                })
                            ) : (
                                <div className="text-center text-sm text-muted-foreground py-10">
                                    No messages in this conversation yet.
                                </div>
                            )}
                            <div ref={messagesEndRef} />
                        </div>
                    </ScrollArea>

                    {/* Chat Input */}
                    <div className="border-t p-4 bg-background flex-shrink-0">
                        <div className="flex w-full items-center space-x-2">
                            <Input 
                                type="text" 
                                placeholder="Type a message..."
                                className="flex-1"
                                autoComplete="off"
                                value={newMessage}
                                onChange={(e) => setNewMessage(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSendMessage();
                                    }
                                }}
                            />
                            <Button type="submit" size="icon" onClick={handleSendMessage}>
                                <Send className="h-4 w-4" />
                                <span className="sr-only">Send</span>
                            </Button>
                        </div>
                    </div>
                </>
            ) : (
                <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                        <MessageSquare className="mx-auto h-12 w-12 text-muted-foreground" />
                        <h3 className="mt-2 text-lg font-medium text-foreground">Select a conversation</h3>
                        <p className="mt-1 text-sm text-muted-foreground">Choose a conversation from the list to start chatting.</p>
                    </div>
                </div>
            )}
        </div>
    </div>
  );
}
