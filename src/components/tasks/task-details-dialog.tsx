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
  XCircle,
  Clock,
  ExternalLink,
  MessageSquare,
  MessagesSquare,
  BellRing,
  Save,
  Building2,
  GraduationCap,
  Key,
  Paperclip,
  Inbox,
} from 'lucide-react';
import type { Task, TaskStatus, User as UserType } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { formatDateTime, formatDate, formatRelativeTime } from '@/lib/timestamp-utils';
import Link from 'next/link';
import { cn, calculateAge } from '@/lib/utils';
import { UploadDocumentDialog } from '../student/upload-document-dialog';
import { useDoc, useMemoFirebase } from '@/firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { firestore } from '@/firebase';
import { Skeleton } from '@/components/ui/skeleton';
import { sendChatMessage } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';

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

/**
 * One heading style for every section.
 *
 * The dialog previously gave each section an 18px bold heading in its own colour —
 * accent, primary, warning, info, muted — which made five equal sections compete for
 * attention and left no room for the content to stand out. A single quiet label lets the
 * values be the loudest thing on the screen, which is what anyone opening this is here to
 * read.
 */
function Section({
  title,
  icon: Icon,
  count,
  children,
}: {
  title: string;
  icon: any;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        {title}
        {count != null && (
          <span className="rounded-full bg-muted px-1.5 py-px font-mono text-[10px] text-foreground/70">
            {count}
          </span>
        )}
      </h3>
      {children}
    </section>
  );
}

/**
 * A hairline grid of equal cells.
 *
 * Fields used to be spaced apart with `gap-y-6`, so a highlighted field wrapped in its own
 * tinted box stood taller than its neighbour and the two columns drifted out of line. Here
 * every field is a cell in one table: grid rows stretch, so a tinted cell is exactly as
 * tall as the plain one beside it and the columns stay square however many fields a
 * request happens to carry.
 *
 * The negative margins pull the last row's and column's borders underneath the outer
 * border, so there is no doubled line at the edges.
 */
function FieldGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-lg border bg-card', className)}>
      <div className="-mb-px -mr-px grid grid-cols-1 sm:grid-cols-2">{children}</div>
    </div>
  );
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
  const [isPaid, setIsPaid] = useState<boolean | undefined>(task.data?.isPaid);
  const [isPostingReply, setIsPostingReply] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    setLocalStatus(task.status);
  }, [task.status, isOpen]);

  useEffect(() => {
    setIsPaid(task.data?.isPaid);
  }, [task.id, task.data?.isPaid]);

  const handleToggleIsPaid = async (value: boolean) => {
    setIsPaid(value);
    await updateDoc(doc(firestore, 'tasks', task.id), { 'data.isPaid': value });
  };

  const author = userMap.get(task.authorId);
  const data = task.data || {};

  const studentRef = useMemoFirebase(() => {
    if (!task.studentId) return null;
    return doc(firestore, 'students', task.studentId);
  }, [task.studentId]);

  const { data: student, isLoading: isStudentLoading } = useDoc<any>(studentRef);

  const studentAge = calculateAge(student?.jotformData?.dob);

  /**
   * Who an internal comment should reach on the student's chat thread.
   *
   * `students.employeeId` holds a CIVIL ID, not a user id — a handful of legacy profiles
   * hold a uid instead, so both are tried. The person who raised the request is added when
   * that is someone else, because they are the one actually waiting on an answer and a
   * reply they never see is worse than no reply.
   *
   * Only named recipients are used, never the `admins` or `departments` groups: a group
   * mention is invisible to an employee by design and would not reach them at all.
   */
  const chatRecipients = useMemo(() => {
    const ids: string[] = [];
    const assignedKey = student?.employeeId;
    if (assignedKey) {
      const assigned =
        Array.from(userMap.values()).find(u => u.civilId === assignedKey) || userMap.get(assignedKey);
      if (assigned) ids.push(assigned.id);
    }
    if (task.authorId && userMap.has(task.authorId) && !ids.includes(task.authorId)) {
      ids.push(task.authorId);
    }
    return ids.filter(id => id !== currentUser?.id);
  }, [student?.employeeId, task.authorId, userMap, currentUser?.id]);

  const chatRecipientNames = chatRecipients
    .map(id => userMap.get(id)?.name)
    .filter(Boolean) as string[];

  /**
   * Management posts into the student's chat thread instead of the task's own replies.
   * Anyone else — and any task with no student or no reachable employee — keeps the old
   * behaviour, so a system task or an orphaned request never swallows a message.
   */
  const routeReplyToChat =
    !!task.studentId &&
    chatRecipients.length > 0 &&
    ['admin', 'adminplus', 'department'].includes(currentUser?.role ?? '');

  const uniLookupId = (data.selectedGlobalUniversityDetails?.id || data.selectedGlobalUniversityId) && !data.selectedGlobalUniversityDetails?.name
    ? (data.selectedGlobalUniversityDetails?.id || data.selectedGlobalUniversityId)
    : null;
  const uniLookupRef = useMemoFirebase(() => {
    if (!uniLookupId) return null;
    return doc(firestore, 'approved_universities', uniLookupId);
  }, [uniLookupId]);
  const { data: liveUni } = useDoc<any>(uniLookupRef);

  const taskThread = useMemo(() => {
    const thread: any[] = [];
    (task.replies || []).forEach(r => thread.push({ ...r, type: 'reply' }));
    (task.notifications || []).forEach(n => thread.push({ ...n, id: `notif-${n.timestamp}`, createdAt: n.timestamp, type: 'notif', content: n.message, authorId: n.fromId }));
    return thread.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [task.replies, task.notifications]);

  const handleReplyClick = async () => {
    if (!replyContent.trim()) return;
    setIsPostingReply(true);
    try {
      if (routeReplyToChat) {
        const result = await sendChatMessage(
          task.studentId!,
          currentUser.id,
          replyContent,
          chatRecipients,
        );
        if (!result?.success) {
          toast({
            variant: 'destructive',
            title: 'Not sent',
            description: result?.message || 'The message could not be posted to the chat.',
          });
          return;
        }
        toast({
          title: 'Sent to internal chat',
          description: `${chatRecipientNames.join(', ')} will see it on ${task.studentName}'s chat, and will reply there.`,
        });
      } else {
        await onReply(task.id, replyContent);
      }
      setReplyContent('');
    } finally {
      setIsPostingReply(false);
    }
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

  const renderDataField = (label: string, value: any, icon?: any, dateOnly?: boolean, valueClassName?: string, important?: boolean) => {
    if (value === undefined || value === null || value === '') return null;
    const Icon = icon;
    const isDateLike = value instanceof Date || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value));
    const formatted = Array.isArray(value) ? value.join(', ')
      : (isClient && isDateLike ? (dateOnly ? formatDate(value) : formatDateTime(value)) : String(value));
    return (
      <div className={cn('border-b border-r px-3.5 py-3', important && 'bg-warning-soft')}>
        <p
          className={cn(
            'text-[10px] font-semibold uppercase tracking-wider',
            important ? 'text-warning' : 'text-muted-foreground',
          )}
        >
          {label}
        </p>
        <div className="mt-1 flex items-start gap-2">
          {Icon && (
            <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', important ? 'text-warning' : 'text-muted-foreground')} />
          )}
          <span
            className={cn(
              'break-words text-sm font-medium leading-snug',
              important && 'font-semibold text-warning',
              valueClassName,
            )}
          >
            {formatted}
          </span>
        </div>
      </div>
    );
  };

  // Keys already surfaced explicitly in the dialog (either in Request Details or in a
  // dedicated section). Anything NOT in this set is shown in the catch-all "Additional
  // Details" section so no employee-entered value is ever silently dropped.
  const HANDLED_DATA_KEYS = new Set<string>([
    'internalNumber', 'passportName', 'examType', 'ieltsSubtype', 'lrwTime', 'requestedDate',
    'courseStartDate', 'courseOption', 'courseTiming', 'courseBallroom', 'retakeSection', 'preferredDate', 'preferredTime', 'amount',
    'guardianFirstNameEn', 'guardianLastNameEn', 'guardianDob', 'guardianPhone', 'originalExamDate',
    'idpUsername', 'idpPassword', 'notes', 'isPaid',
    // Auto-added to every task's data (createStudentTask) and already shown in the header.
    'studentName', 'studentEmail', 'studentPhone', 'requestedBy', 'requestedByName',
    'unifiedExamDateId', 'unifiedExamDateLabel', 'unifiedExamDelivery',
    'selectedApplicationDetails', 'selectedApplicationId',
    'selectedGlobalUniversityDetails', 'selectedGlobalUniversityId',
    'selectedGlobalUniversities', 'selectedGlobalUniversityIds',
    'selectedPortalDetails', 'selectedPortalId', 'selectedDocuments',
    // Rendered as links below.
    'attachments',
  ]);

  const prettifyKey = (key: string) =>
    key.replace(/([A-Z])/g, ' $1').replace(/[_-]+/g, ' ').replace(/^./, c => c.toUpperCase()).trim();

  const extraDataEntries = Object.entries(data).filter(([key, value]) => {
    if (HANDLED_DATA_KEYS.has(key)) return false;
    if (value === undefined || value === null || value === '') return false;
    // Skip nested objects (handled/complex); allow Dates and primitive arrays.
    if (typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value)) return false;
    if (Array.isArray(value) && value.some(v => typeof v === 'object')) return false;
    return true;
  });

  const hasStatusChanged = localStatus !== task.status;
  const selectedApp = data.selectedApplicationDetails;
  const selectedGlobalUni = data.selectedGlobalUniversityDetails;
  const selectedMultiUnis = data.selectedGlobalUniversities;
  const selectedPortal = data.selectedPortalDetails;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[95vh] max-w-5xl flex-col overflow-hidden p-0 gap-0">
        {/* ---------------------------------------------------------------- header -- */}
        <DialogHeader className="space-y-0 border-b bg-muted/20 px-6 py-5 text-left">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="bg-primary/5 text-[10px] font-bold uppercase tracking-wider">
                  {task.taskType || 'Request'}
                </Badge>
                {data.internalNumber && (
                  <span className="font-mono text-xs text-muted-foreground">#{data.internalNumber}</span>
                )}
              </div>

              {/* One title only. Three stacked DialogTitles is invalid markup, and screen
                  readers announced the phone number as the name of the window. */}
              <DialogTitle className="truncate text-2xl leading-tight">{task.studentName}</DialogTitle>

              <DialogDescription className="sr-only">
                Request details for {task.studentName}.
              </DialogDescription>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="font-medium">By: {task.authorName || author?.name || 'Employee'}</span>
                {task.studentPhone && (
                  <a href={`tel:${task.studentPhone}`} className="flex items-center gap-1.5 hover:text-foreground">
                    <Phone className="h-3.5 w-3.5" /> {task.studentPhone}
                  </a>
                )}
                {data.studentEmail ? (
                  <a href={`mailto:${data.studentEmail}`} className="flex items-center gap-1.5 hover:text-foreground">
                    <Mail className="h-3.5 w-3.5" /> {data.studentEmail}
                  </a>
                ) : (
                  <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" /> No email</span>
                )}
                {task.studentId && (student || isStudentLoading) && (
                  <Link
                    href={`/student/${task.studentId}`}
                    className="flex items-center gap-1 font-semibold text-primary hover:underline"
                  >
                    View Full Profile <ExternalLink className="h-3 w-3" />
                  </Link>
                )}
              </div>
            </div>

            {/* Status lives in a single segmented control, and the Save button takes the
                row beneath it rather than appearing between the tabs and the edge — it
                used to shift the whole header downward the moment anything was clicked. */}
            <div className="flex shrink-0 flex-col items-stretch gap-2 lg:items-end">
              <div className="flex gap-1 rounded-lg border bg-background p-1">
                {(['new', 'in-progress', 'completed', 'denied'] as TaskStatus[]).map(s => (
                  <Button
                    key={s}
                    size="sm"
                    variant="ghost"
                    className={cn(
                      'h-7 px-2.5 text-[10px] font-bold uppercase tracking-wide',
                      localStatus !== s && 'text-muted-foreground',
                      localStatus === s && s === 'completed' && 'bg-success-soft text-success hover:bg-success-soft/70',
                      localStatus === s && s === 'denied' && 'bg-danger-soft text-danger hover:bg-danger-soft/70',
                      localStatus === s && s === 'new' && 'bg-info-soft text-info hover:bg-info-soft/70',
                      localStatus === s && s === 'in-progress' && 'bg-warning-soft text-warning hover:bg-warning-soft/70',
                    )}
                    onClick={() => setLocalStatus(s)}
                  >
                    {s.replace('-', ' ')}
                  </Button>
                ))}
              </div>
              {hasStatusChanged && (
                <Button
                  size="sm"
                  className="h-8 w-full animate-in fade-in slide-in-from-top-1 gap-2 font-bold"
                  onClick={handleSaveStatus}
                  disabled={isSavingStatus}
                >
                  {isSavingStatus ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Save Status
                </Button>
              )}
            </div>
          </div>

          {task.status === 'denied' && task.denialReason && (
            <div className="mt-4 animate-in fade-in slide-in-from-top-2 rounded-lg border border-danger-border bg-danger-soft p-3">
              <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase text-danger">
                <XCircle className="h-3 w-3" /> Rejection Reason
              </p>
              <p className="text-sm font-medium italic text-danger">&ldquo;{task.denialReason}&rdquo;</p>
            </div>
          )}
        </DialogHeader>

        <div className="grid flex-1 grid-cols-1 overflow-hidden lg:grid-cols-5">
          {/* ------------------------------------------------------------- details -- */}
          <div className="space-y-6 overflow-y-auto border-r p-6 lg:col-span-3">
            <Section title="Request Details" icon={FileText}>
              <FieldGrid>
                {renderDataField('Requested By', task.authorName || author?.name, User)}
                {data.examType && renderDataField(
                  'Student Age',
                  studentAge != null ? `${studentAge} years${studentAge < 18 ? ' · Under 18 (guardian required)' : ''}` : 'N/A',
                  User, false, undefined, studentAge != null && studentAge < 18
                )}
                {renderDataField('Internal Number', data.internalNumber)}
                {renderDataField('Passport Name', data.passportName, ShieldCheck)}
                {renderDataField('Exam Category', data.examType, Clock, false, undefined, true)}
                {renderDataField('IELTS Type', data.ieltsSubtype)}
                {renderDataField('LRW Time', data.lrwTime, Clock, false, undefined, true)}
                {renderDataField('Requested Date', data.requestedDate, Calendar, true, undefined, true)}
                {renderDataField('Course Start', data.courseStartDate, Calendar)}
                {renderDataField('Course Option', data.courseOption)}
                {renderDataField('Course Timing', data.courseTiming, Clock)}
                {renderDataField('Ballroom', data.courseBallroom)}
                {renderDataField('Retake Section', data.retakeSection)}
                {renderDataField('Preferred Date', data.preferredDate, Calendar, true, 'text-danger font-bold', true)}
                {renderDataField('Preferred Time', data.preferredTime, Clock, false, undefined, true)}
                {renderDataField('Exam Date', data.unifiedExamDateLabel, Calendar)}
                {renderDataField('Delivery', data.unifiedExamDelivery)}
                {renderDataField('Amount', data.amount ? `${data.amount} KWD` : null, DollarSign, false, undefined, true)}
                {(data.amount != null || data.examType) && (
                  <div className="border-b border-r px-3.5 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Payment Status
                    </p>
                    <div className="mt-1.5 flex gap-2">
                      <Button
                        size="sm"
                        type="button"
                        variant={isPaid === true ? 'default' : 'outline'}
                        className={cn('h-7 flex-1 text-xs', isPaid === true && 'bg-success text-success-foreground hover:bg-success/90')}
                        onClick={() => handleToggleIsPaid(true)}
                      >
                        Paid
                      </Button>
                      <Button
                        size="sm"
                        type="button"
                        variant={isPaid === false ? 'default' : 'outline'}
                        className={cn('h-7 flex-1 text-xs', isPaid === false && 'bg-danger text-danger-foreground hover:bg-danger/90')}
                        onClick={() => handleToggleIsPaid(false)}
                      >
                        Not Paid
                      </Button>
                    </div>
                  </div>
                )}
                {renderDataField('Original Exam', data.originalExamDate, Calendar, true)}
              </FieldGrid>
            </Section>

            {selectedPortal && (
              <Section title="Attached Portal Reference" icon={Key}>
                <FieldGrid className="border-accent/30 bg-accent/5">
                  {renderDataField('Portal', selectedPortal.description)}
                  {renderDataField('Username', selectedPortal.username, User)}
                  {renderDataField('Password', selectedPortal.password, ShieldCheck)}
                  {renderDataField('Portal Notes', selectedPortal.notes)}
                </FieldGrid>
              </Section>
            )}

            {selectedApp && (
              <Section title="Existing Application Context" icon={Building2}>
                <FieldGrid>
                  {renderDataField('University', selectedApp.university)}
                  {renderDataField('Major', selectedApp.major)}
                  {renderDataField('Country', selectedApp.country)}
                  {renderDataField('Current Status', selectedApp.status)}
                </FieldGrid>
              </Section>
            )}

            {selectedMultiUnis && selectedMultiUnis.length > 0 ? (
              <Section title="Requested Universities" icon={GraduationCap} count={selectedMultiUnis.length}>
                <div className="space-y-2">
                  {selectedMultiUnis.map((uni: any, i: number) => (
                    <FieldGrid key={i}>
                      {renderDataField('University', uni.name || uni.university)}
                      {renderDataField('Major', uni.major)}
                      {renderDataField('Country', uni.country)}
                      {renderDataField('Category', uni.category)}
                    </FieldGrid>
                  ))}
                </div>
              </Section>
            ) : selectedGlobalUni && (
              <Section title="Requested New School / Major" icon={GraduationCap}>
                <FieldGrid>
                  {renderDataField('New University', selectedGlobalUni.name || selectedGlobalUni.university || liveUni?.name)}
                  {renderDataField('New Major', selectedGlobalUni.major || liveUni?.major)}
                  {renderDataField('Country', selectedGlobalUni.country)}
                  {renderDataField('Category', selectedGlobalUni.category)}
                </FieldGrid>
              </Section>
            )}

            {(data.guardianFirstNameEn || data.guardianLastNameEn || data.guardianDob || data.guardianPhone) && (
              <Section title="Parent / Guardian" icon={User}>
                <FieldGrid className="border-warning-border">
                  {renderDataField('Parent Name (EN)', [data.guardianFirstNameEn, data.guardianLastNameEn].filter(Boolean).join(' ') || null, User)}
                  {renderDataField('Parent DOB', data.guardianDob, Calendar, true)}
                  {renderDataField('Parent Phone', data.guardianPhone)}
                </FieldGrid>
              </Section>
            )}

            {data.idpUsername && (
              <Section title="IDP Credentials" icon={ShieldCheck}>
                <FieldGrid className="border-info-border">
                  {renderDataField('Username', data.idpUsername)}
                  {renderDataField('Password', data.idpPassword)}
                </FieldGrid>
              </Section>
            )}

            {extraDataEntries.length > 0 && (
              <Section title="Additional Details" icon={FileText} count={extraDataEntries.length}>
                <FieldGrid>
                  {extraDataEntries.map(([key, value]) => renderDataField(prettifyKey(key), value))}
                </FieldGrid>
              </Section>
            )}

            <Section title="Employee Notes" icon={MessageSquare}>
              <p
                className={cn(
                  'whitespace-pre-wrap rounded-lg border bg-card p-3.5 text-sm leading-relaxed',
                  !task.content && 'italic text-muted-foreground',
                )}
              >
                {task.content || 'No additional notes provided.'}
              </p>
            </Section>

            {/* Two different sources of documents, so two distinct names. Both used to be
                headed "Attached Documents", which read as the same list twice. */}
            {Array.isArray(data.attachments) && data.attachments.length > 0 && (
              <Section title="Files Attached to This Request" icon={Paperclip} count={data.attachments.length}>
                <div className="overflow-hidden rounded-lg border bg-card">
                  {data.attachments.map((a: any, i: number) => (
                    <a
                      key={i}
                      href={a?.url || '#'}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-3 border-b px-3.5 py-2.5 transition-colors last:border-b-0 hover:bg-muted/50"
                    >
                      <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="shrink-0 text-sm font-semibold">{a?.label}</span>
                      <span className="flex-1 truncate text-xs text-muted-foreground">{a?.name}</span>
                      <span className="shrink-0 text-xs font-semibold text-primary">Open</span>
                    </a>
                  ))}
                </div>
              </Section>
            )}

            {data.selectedDocuments && data.selectedDocuments.length > 0 && (
              <Section
                title="Documents from the Student Profile"
                icon={FileText}
                count={data.selectedDocuments.length}
              >
                <div className="overflow-hidden rounded-lg border bg-card">
                  {data.selectedDocuments.map((docId: string) => {
                    if (isStudentLoading) {
                      return <Skeleton key={docId} className="h-12 w-full" />;
                    }
                    const docItem = student?.documents?.find((d: any) => d.id === docId);
                    if (docItem) {
                      return (
                        <div
                          key={docId}
                          className="flex items-center justify-between gap-3 border-b px-3.5 py-2 transition-colors last:border-b-0 hover:bg-muted/50"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate text-sm font-medium">{docItem.name}</span>
                          </div>
                          <Button size="sm" variant="ghost" className="h-7 shrink-0 text-xs" asChild>
                            <a href={docItem.url} target="_blank" rel="noopener noreferrer">Download</a>
                          </Button>
                        </div>
                      );
                    }
                    return (
                      <div
                        key={docId}
                        className="flex items-center gap-3 border-b bg-danger-soft px-3.5 py-2.5 text-danger last:border-b-0"
                      >
                        <XCircle className="h-3.5 w-3.5 shrink-0" />
                        <span className="text-xs font-medium italic">Document missing from profile</span>
                      </div>
                    );
                  })}
                </div>
              </Section>
            )}
          </div>

          {/* ------------------------------------------------------------ workflow -- */}
          <div className="flex flex-col bg-muted/20 lg:col-span-2">
            <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                Activity
              </h3>
              <UploadDocumentDialog student={student || { id: task.studentId }} />
            </div>

            {routeReplyToChat && task.studentId && (
              // The conversation now lives on the student's thread, so there has to be a
              // way to get there from here — otherwise replies are somewhere the admin
              // was never told to look.
              <Link
                href={`/student/${task.studentId}`}
                className="flex items-center justify-between gap-2 border-b bg-info-soft/60 px-4 py-2 text-[11px] font-medium text-info transition-colors hover:bg-info-soft"
              >
                <span className="flex items-center gap-1.5">
                  <MessagesSquare className="h-3.5 w-3.5 shrink-0" />
                  Replies happen in the internal chat
                </span>
                <span className="flex shrink-0 items-center gap-1 font-semibold">
                  Open <ExternalLink className="h-3 w-3" />
                </span>
              </Link>
            )}

            <ScrollArea className="flex-1">
              <div className="space-y-4 p-4">
                {taskThread.length === 0 ? (
                  // The panel used to be a tall blank space, which reads as something
                  // failing to load rather than as nothing having happened yet.
                  <div className="flex flex-col items-center gap-2 py-12 text-center">
                    <Inbox className="h-7 w-7 text-muted-foreground/40" />
                    <p className="text-xs font-medium text-muted-foreground">No activity yet</p>
                    <p className="max-w-[200px] text-[11px] leading-snug text-muted-foreground/70">
                      Notifications and internal comments on this request will appear here.
                    </p>
                  </div>
                ) : (
                  taskThread.map((item: any) => {
                    const itemAuthor = userMap.get(item.authorId);
                    const isNotif = item.type === 'notif';
                    return (
                      <div
                        key={item.id}
                        className={cn(
                          'flex items-start gap-3 rounded-lg',
                          isNotif && 'border border-info-border bg-info-soft/60 p-3',
                        )}
                      >
                        <Avatar className="mt-0.5 h-7 w-7 shrink-0">
                          <AvatarImage src={itemAuthor?.avatarUrl} />
                          <AvatarFallback className="text-[10px]">{itemAuthor?.name?.charAt(0) || '?'}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-xs font-bold">{itemAuthor?.name || 'System'}</span>
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {isClient ? formatRelativeTime(item.createdAt) : '...'}
                            </span>
                          </div>
                          <div className="whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
                            {isNotif && (
                              <BadgeComponent
                                variant="secondary"
                                className="mr-1 h-4 bg-info text-[8px] text-info-foreground"
                              >
                                NOTIF
                              </BadgeComponent>
                            )}
                            {item.content}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>

            <div className="space-y-3 border-t bg-background p-4">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider">
                  <BellRing className="h-3 w-3" /> Quick Notification
                </Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Note for employee..."
                    className="h-8 text-xs"
                    value={notifContent}
                    onChange={(e) => setNotifContent(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleNotifClick()}
                  />
                  <Button
                    size="sm"
                    className="h-8 shrink-0"
                    onClick={handleNotifClick}
                    disabled={!notifContent.trim() || isSendingNotif}
                  >
                    {isSendingNotif ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider">
                  <MessageSquare className="h-3 w-3" />
                  {routeReplyToChat ? 'Message the Employee' : 'Add Internal Comment'}
                </Label>
                <Textarea
                  placeholder={
                    routeReplyToChat
                      ? `Message ${chatRecipientNames[0] || 'the employee'}...`
                      : 'Type comment...'
                  }
                  className="min-h-[60px] text-xs"
                  value={replyContent}
                  onChange={(e) => setReplyContent(e.target.value)}
                />
                {routeReplyToChat && (
                  // Say where it lands. The old box was labelled "internal" while quietly
                  // WhatsApping the employee, and nobody could tell from the screen.
                  <p className="flex items-start gap-1.5 text-[10px] leading-snug text-muted-foreground">
                    <MessagesSquare className="mt-px h-3 w-3 shrink-0" />
                    <span>
                      Goes to <strong className="font-semibold text-foreground">{chatRecipientNames.join(', ')}</strong>{' '}
                      in {task.studentName}&apos;s internal chat. Replies appear there, not here.
                    </span>
                  </p>
                )}
                <Button
                  size="sm"
                  className="h-8 w-full gap-2"
                  onClick={handleReplyClick}
                  disabled={!replyContent.trim() || isPostingReply}
                >
                  {isPostingReply && <Loader2 className="h-3 w-3 animate-spin" />}
                  {routeReplyToChat ? 'Send to Internal Chat' : 'Post'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
