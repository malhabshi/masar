
'use client';

import { useState, useMemo, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge as BadgeComponent } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  Loader2, 
  Send, 
  User, 
  Phone, 
  Mail, 
  FileText, 
  Calendar, 
  DollarSign, 
  ShieldCheck, 
  CheckCircle2,
  XCircle,
  Clock,
  ExternalLink,
  MessageSquare,
  BellRing,
  Save,
  Building2,
  GraduationCap,
  Key
} from 'lucide-react';
import type { Task, TaskStatus, User as UserType, Document as StudentDoc } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { formatDateTime, formatRelativeTime } from '@/lib/timestamp-utils';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { UploadDocumentDialog } from '../student/upload-document-dialog';
import { useDoc, useMemoFirebase } from '@/firebase';
import { doc } from 'firebase/firestore';
import { firestore } from '@/firebase';
import { Skeleton } from '@/components/ui/skeleton';

interface TaskDetailsDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  task: Task;
  currentUser: AppUser;
  userMap: Map<string, UserType>;
  onStatusChange: (taskId: string, status: TaskStatus) => Promise<void>;
  onReply: (taskId: string, reply: string) => Promise<void>;
  onSendNotification: (taskId: string, message: string) => Promise<void>;
}

export function TaskDetailsDialog({
  isOpen,
  onOpenChange,
  task,
  currentUser,
  userMap,
  onStatusChange,
  onReply,
  onSendNotification,
}: TaskDetailsDialogProps) {
  const [replyContent, setReplyContent] = useState('');
  const [notifContent, setNotifContent] = useState('');
  const [isSendingNotif, setIsSendingNotif] = useState(false);
  const [localStatus, setLocalStatus] = useState<TaskStatus>(task.status);
  const [isSavingStatus, setIsSavingStatus] = useState(false);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    setLocalStatus(task.status);
  }, [task.status, isOpen]);

  const author = userMap.get(task.authorId);
  const data = task.data || {};
  
  const studentRef = useMemoFirebase(() => {
    if (!task.studentId) return null;
    return doc(firestore, 'students', task.studentId);
  }, [task.studentId]);

  const { data: student, isLoading: isStudentLoading } = useDoc<any>(studentRef);

  const taskThread = useMemo(() => {
    const thread: any[] = [];
    (task.replies || []).forEach(r => thread.push({ ...r, type: 'reply' }));
    (task.notifications || []).forEach(n => thread.push({ ...n, id: `notif-${n.timestamp}`, createdAt: n.timestamp, type: 'notif', content: n.message, authorId: n.fromId }));
    return thread.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [task.replies, task.notifications]);

  const handleReplyClick = async () => {
    if (!replyContent.trim()) return;
    await onReply(task.id, replyContent);
    setReplyContent('');
  };

  const handleNotifClick = async () => {
    if (!notifContent.trim()) return;
    setIsSendingNotif(true);
    await onSendNotification(task.id, notifContent);
    setNotifContent('');
    setIsSendingNotif(false);
  };

  const handleSaveStatus = async () => {
    setIsSavingStatus(true);
    try {
      await onStatusChange(task.id, localStatus);
    } finally {
      setIsSavingStatus(false);
    }
  };

  const renderDataField = (label: string, value: any, icon?: any) => {
    if (value === undefined || value === null || value === '') return null;
    const Icon = icon;
    return (
      <div className="space-y-1">
        <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">{label}</p>
        <div className="flex items-center gap-2 font-medium">
          {Icon && <Icon className="h-4 w-4 text-primary" />}
          <span className="text-sm">
            {Array.isArray(value) ? value.join(', ') : 
             (isClient && (value instanceof Date || (typeof value === 'string' && value.includes('T'))) ? formatDateTime(value) : String(value))}
          </span>
        </div>
      </div>
    );
  };

  const hasStatusChanged = localStatus !== task.status;
  const selectedApp = data.selectedApplicationDetails;
  const selectedGlobalUni = data.selectedGlobalUniversityDetails;
  const selectedMultiUnis = data.selectedGlobalUniversities;
  const selectedPortal = data.selectedPortalDetails;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[95vh] p-0 flex flex-col overflow-hidden">
        <DialogHeader className="p-6 border-b bg-muted/10">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1 min-w-0">
              <Badge variant="outline" className="mb-2 uppercase tracking-tighter bg-primary/5">
                {task.taskType || 'Request'}
              </Badge>
              <DialogTitle className="text-2xl truncate flex items-center gap-2">
                {data.internalNumber && <span className="opacity-50">#{data.internalNumber}</span>}
                {task.studentName}
              </DialogTitle>
              <DialogTitle className="text-xs text-muted-foreground font-mono mt-1">
                By: {task.authorName || author?.name || 'Employee'}
              </DialogTitle>
              <DialogTitle className="flex items-center gap-4 mt-1">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground font-normal"><Phone className="h-3.5 w-3.5" /> {task.studentPhone}</span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground font-normal"><Mail className="h-3.5 w-3.5" /> {data.studentEmail || 'No email'}</span>
              </DialogTitle>
            </div>
            <div className="flex flex-col items-end gap-3 shrink-0">
              <Link href={`/student/${task.studentId}`} className="text-xs text-primary font-bold underline flex items-center gap-1">
                View Full Profile <ExternalLink className="h-3 w-3" />
              </Link>
              <div className="flex flex-col gap-2">
                <div className="flex gap-1 p-1 bg-muted rounded-md border">
                  {(['new', 'in-progress', 'completed', 'denied'] as TaskStatus[]).map(s => (
                    <Button
                      key={s}
                      size="sm"
                      variant={localStatus === s ? 'secondary' : 'ghost'}
                      className={cn(
                        "h-7 text-[10px] font-bold uppercase px-2",
                        localStatus === s && s === 'completed' && "bg-green-100 text-green-700 hover:bg-green-200",
                        localStatus === s && s === 'denied' && "bg-red-100 text-red-700 hover:bg-red-200",
                        localStatus === s && s === 'new' && "bg-blue-100 text-blue-700 hover:bg-blue-200",
                        localStatus === s && s === 'in-progress' && "bg-orange-100 text-orange-700 hover:bg-orange-200"
                      )}
                      onClick={() => setLocalStatus(s)}
                    >
                      {s.replace('-', ' ')}
                    </Button>
                  ))}
                </div>
                {hasStatusChanged && (
                  <Button size="sm" className="h-8 font-bold gap-2 animate-in fade-in slide-in-from-top-1 w-full" onClick={handleSaveStatus} disabled={isSavingStatus}>
                    {isSavingStatus ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    Save Status
                  </Button>
                )}
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-5">
          <div className="lg:col-span-3 border-r overflow-y-auto p-6 space-y-8">
            {selectedPortal && (
                <section className="space-y-4">
                    <h3 className="text-lg font-bold flex items-center gap-2 text-accent">
                        <Key className="h-5 w-5" /> 
                        Attached Portal Reference
                    </h3>
                    <div className="bg-accent/5 p-4 rounded-lg border border-accent/20 grid grid-cols-1 md:grid-cols-2 gap-4">
                        {renderDataField('Portal', selectedPortal.description)}
                        {renderDataField('Username', selectedPortal.username, User)}
                        {renderDataField('Password', selectedPortal.password, ShieldCheck)}
                        {renderDataField('Portal Notes', selectedPortal.notes)}
                    </div>
                </section>
            )}

            {selectedApp && (
                <section className="space-y-4">
                    <h3 className="text-lg font-bold flex items-center gap-2 text-primary">
                        <Building2 className="h-5 w-5" /> 
                        Existing Application Context
                    </h3>
                    <div className="bg-primary/5 p-4 rounded-lg border border-primary/20 grid grid-cols-1 md:grid-cols-2 gap-4">
                        {renderDataField('University', selectedApp.university)}
                        {renderDataField('Major', selectedApp.major)}
                        {renderDataField('Country', selectedApp.country)}
                        {renderDataField('Current Status', selectedApp.status)}
                    </div>
                </section>
            )}

            {selectedMultiUnis && selectedMultiUnis.length > 0 ? (
                <section className="space-y-4">
                    <h3 className="text-lg font-bold flex items-center gap-2 text-primary">
                        <GraduationCap className="h-5 w-5" /> 
                        Requested Universities ({selectedMultiUnis.length})
                    </h3>
                    <div className="space-y-3">
                        {selectedMultiUnis.map((uni: any, i: number) => (
                            <div key={i} className="bg-blue-50/50 p-4 rounded-lg border border-blue-200 grid grid-cols-1 md:grid-cols-2 gap-4">
                                {renderDataField('University', uni.name)}
                                {renderDataField('Major', uni.major)}
                                {renderDataField('Country', uni.country)}
                                {renderDataField('Category', uni.category)}
                            </div>
                        ))}
                    </div>
                </section>
            ) : selectedGlobalUni && (
                <section className="space-y-4">
                    <h3 className="text-lg font-bold flex items-center gap-2 text-primary">
                        <GraduationCap className="h-5 w-5" /> 
                        Requested New school/major
                    </h3>
                    <div className="bg-blue-50/50 p-4 rounded-lg border border-blue-200 grid grid-cols-1 md:grid-cols-2 gap-4">
                        {renderDataField('New University', selectedGlobalUni.name)}
                        {renderDataField('New Major', selectedGlobalUni.major)}
                        {renderDataField('Country', selectedGlobalUni.country)}
                        {renderDataField('Category', selectedGlobalUni.category)}
                    </div>
                </section>
            )}

            <section className="space-y-4">
              <h3 className="text-lg font-bold flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" /> 
                Request Details
              </h3>
              <div className="grid grid-cols-2 gap-y-6 bg-muted/20 p-4 rounded-lg border border-dashed">
                {renderDataField('Requested By', task.authorName || author?.name, User)}
                {renderDataField('Internal Number', data.internalNumber)}
                {renderDataField('Passport Name', data.passportName, ShieldCheck)}
                {renderDataField('Exam Category', data.examType, Clock)}
                {renderDataField('IELTS Type', data.ieltsSubtype)}
                {renderDataField('Requested Date', data.requestedDate, Calendar)}
                {renderDataField('Course Start', data.courseStartDate, Calendar)}
                {renderDataField('Course Option', data.courseOption)}
                {renderDataField('Retake Section', data.retakeSection)}
                {renderDataField('Preferred Time', data.preferredTime)}
                {renderDataField('Amount', data.amount ? `${data.amount} KWD` : null, DollarSign)}
                {renderDataField('Original Exam', data.originalExamDate, Calendar)}
              </div>
            </section>

            {data.idpUsername && (
              <section className="space-y-4">
                <h3 className="text-lg font-bold flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-blue-600" /> 
                  IDP Credentials
                </h3>
                <div className="grid grid-cols-2 gap-4 bg-blue-50/30 p-4 rounded-lg border border-blue-100">
                  {renderDataField('Username', data.idpUsername)}
                  {renderDataField('Password', data.idpPassword)}
                </div>
              </section>
            )}

            <section className="space-y-4">
              <h3 className="text-lg font-bold">Employee Notes</h3>
              <p className="text-sm text-muted-foreground p-4 bg-muted/10 rounded border whitespace-pre-wrap">
                {task.content || "No additional notes provided."}
              </p>
            </section>

            {data.selectedDocuments && data.selectedDocuments.length > 0 && (
              <section className="space-y-4">
                <h3 className="text-lg font-bold">Attached Documents</h3>
                <div className="space-y-2">
                  {data.selectedDocuments.map((docId: string) => {
                    if (isStudentLoading) return <Skeleton key={docId} className="h-12 w-full rounded-md" />;
                    const docItem = student?.documents?.find((d: any) => d.id === docId);
                    if (docItem) {
                      return (
                        <div key={docId} className="flex items-center justify-between p-3 border rounded-md hover:bg-muted/50 transition-colors">
                          <div className="flex items-center gap-3">
                            <FileText className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-medium">{docItem.name}</span>
                          </div>
                          <Button size="sm" variant="ghost" asChild>
                            <a href={docItem.url} target="_blank" rel="noopener noreferrer">Download</a>
                          </Button>
                        </div>
                      );
                    }
                    return (
                      <div key={docId} className="flex items-center justify-between p-3 border border-destructive/20 bg-destructive/5 rounded-md text-destructive">
                        <div className="flex items-center gap-3"><XCircle className="h-4 w-4" /><span className="text-xs font-medium italic">Document missing from profile</span></div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>

          <div className="lg:col-span-2 bg-muted/5 flex flex-col">
            <div className="p-4 border-b space-y-4">
              <h3 className="font-bold text-sm uppercase tracking-widest text-muted-foreground">Workflow</h3>
              <div className="flex gap-2">
                <UploadDocumentDialog student={student || { id: task.studentId }} />
              </div>
            </div>
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-6">
                {taskThread.map((item: any) => {
                  const author = userMap.get(item.authorId);
                  const isNotif = item.type === 'notif';
                  return (
                    <div key={item.id} className={cn("flex items-start gap-3", isNotif && "bg-blue-50/50 p-3 rounded-lg border border-blue-100")}>
                      <Avatar className="h-7 w-7 mt-1"><AvatarImage src={author?.avatarUrl} /><AvatarFallback>{author?.name?.charAt(0) || '?'}</AvatarFallback></Avatar>
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold">{author?.name || 'System'}</span>
                          <span className="text-[10px] text-muted-foreground">{isClient ? formatRelativeTime(item.createdAt) : '...'}</span>
                        </div>
                        <div className="text-xs text-muted-foreground whitespace-pre-wrap">
                          {isNotif && <BadgeComponent variant="secondary" className="mr-1 h-4 text-[8px] bg-blue-500 text-white">NOTIF</BadgeComponent>}
                          {item.content}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
            <div className="p-4 border-t space-y-4 bg-background">
              <div className="space-y-2">
                <Label className="text-[10px] font-bold flex items-center gap-1.5 uppercase"><BellRing className="h-3 w-3" /> Quick Notification</Label>
                <div className="flex gap-2">
                  <Input placeholder="Note for employee..." className="text-xs h-8" value={notifContent} onChange={(e) => setNotifContent(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleNotifClick()} />
                  <Button size="sm" className="h-8" onClick={handleNotifClick} disabled={!notifContent.trim() || isSendingNotif}>{isSendingNotif ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}</Button>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] font-bold flex items-center gap-1.5 uppercase"><MessageSquare className="h-3 w-3" /> Add Internal Comment</Label>
                <Textarea placeholder="Type comment..." className="text-xs min-h-[60px]" value={replyContent} onChange={(e) => setReplyContent(e.target.value)} />
                <Button size="sm" className="w-full h-8" onClick={handleReplyClick} disabled={!replyContent.trim()}>Post</Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
