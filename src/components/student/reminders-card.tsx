'use client';

import { useState, useEffect } from 'react';
import { useCollection, useMemoFirebase } from '@/firebase/client';
import { where, collection, addDoc, updateDoc, doc, deleteField } from 'firebase/firestore';
import { firestore } from '@/firebase';
import type { Student, User, Reminder, ReminderRecipientType } from '@/lib/types';
import { formatKuwaitTime } from '@/lib/timestamp-utils';
import { TimeLeft } from '@/components/reminders-time-left';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Bell, Plus, AlarmClock, Trash2, Pencil, Clock, MapPin, MessageSquare, Loader2 } from 'lucide-react';
import { addHours, addDays, isPast } from 'date-fns';

interface Props {
  student: Student;
  currentUser: User;
}

const RECIPIENT_LABELS: Record<ReminderRecipientType, string> = {
  admin: 'Admin',
  employee: 'Employee',
  department: 'Department',
  all: 'Everyone',
  custom: 'Custom Users',
};

const RECIPIENT_COLORS: Record<ReminderRecipientType, string> = {
  admin: 'bg-purple-100 text-purple-700 border-purple-200',
  employee: 'bg-blue-100 text-blue-700 border-blue-200',
  department: 'bg-teal-100 text-teal-700 border-teal-200',
  all: 'bg-orange-100 text-orange-700 border-orange-200',
  custom: 'bg-gray-100 text-gray-700 border-gray-200',
};

const SNOOZE_PRESETS = [
  { label: '+1 hour',  getValue: () => addHours(new Date(), 1) },
  { label: '+4 hours', getValue: () => addHours(new Date(), 4) },
  { label: '+1 day',   getValue: () => addDays(new Date(), 1) },
  { label: '+3 days',  getValue: () => addDays(new Date(), 3) },
];

function SnoozeDialog({ reminder, open, onClose }: { reminder: Reminder; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [customDate, setCustomDate] = useState('');
  const [customTime, setCustomTime] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSnooze = async (isoDate: string) => {
    setLoading(true);
    try {
      await updateDoc(doc(firestore, 'student_reminders', reminder.id), {
        dueAt: isoDate,
        whatsAppSentAt: deleteField(),
      });
      toast({ title: 'Reminder snoozed' });
      onClose();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Failed', description: e.message });
    } finally {
      setLoading(false);
    }
  };

  const handleCustomSnooze = () => {
    if (!customDate || !customTime) return;
    // Snooze time is treated as Kuwait local time → UTC (Kuwait is always UTC+3)
    const dt = new Date(`${customDate}T${customTime}:00Z`);
    handleSnooze(new Date(dt.getTime() - 3 * 60 * 60 * 1000).toISOString());
  };

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Snooze reminder</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {SNOOZE_PRESETS.map(p => (
              <Button key={p.label} variant="outline" size="sm" disabled={loading}
                onClick={() => handleSnooze(p.getValue().toISOString())}>
                {p.label}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground text-center">or pick a custom Kuwait time</p>
          <div className="flex gap-2">
            <Input type="date" value={customDate} onChange={e => setCustomDate(e.target.value)} className="flex-1" />
            <Input type="time" value={customTime} onChange={e => setCustomTime(e.target.value)} className="w-28" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleCustomSnooze} disabled={!customDate || !customTime || loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Snooze
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const BLANK_FORM = {
  title: '',
  description: '',
  location: '',
  date: '',
  time: '',
  recipientType: 'admin' as ReminderRecipientType,
  recipientUserIds: [] as string[],
  notifyWhatsApp: false,
};

function ReminderFormDialog({
  student, currentUser, editing, open, onClose, allUsers,
}: {
  student: Student;
  currentUser: User;
  editing: Reminder | null;
  open: boolean;
  onClose: () => void;
  allUsers: User[];
}) {
  const { toast } = useToast();
  const [form, setForm] = useState(BLANK_FORM);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      const d = new Date(editing.dueAt);
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kuwait',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(d);
      const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
      setForm({
        title: editing.title,
        description: editing.description || '',
        location: editing.location || '',
        date: `${get('year')}-${get('month')}-${get('day')}`,
        time: `${get('hour')}:${get('minute')}`,
        recipientType: editing.recipientType,
        recipientUserIds: editing.recipientUserIds || [],
        notifyWhatsApp: editing.notifyWhatsApp,
      });
    } else {
      setForm(BLANK_FORM);
    }
  }, [editing, open]);

  const set = (k: keyof typeof BLANK_FORM, v: any) => setForm(prev => ({ ...prev, [k]: v }));

  const toggleUserId = (id: string) =>
    set('recipientUserIds', form.recipientUserIds.includes(id)
      ? form.recipientUserIds.filter(x => x !== id)
      : [...form.recipientUserIds, id]);

  const handleSave = async () => {
    if (!form.title.trim() || !form.date || !form.time) return;
    // User enters Kuwait local time (UTC+3). Treat the string as UTC then subtract 3h to get real UTC.
    const dt = new Date(`${form.date}T${form.time}:00Z`);
    const dueAt = new Date(dt.getTime() - 3 * 60 * 60 * 1000).toISOString();

    const payload = {
      title: form.title.trim(),
      description: form.description.trim() || '',
      location: form.location.trim() || '',
      dueAt,
      recipientType: form.recipientType,
      recipientUserIds: form.recipientType === 'custom' ? form.recipientUserIds : [],
      notifyWhatsApp: form.notifyWhatsApp,
    };

    setLoading(true);
    try {
      if (editing) {
        await updateDoc(doc(firestore, 'student_reminders', editing.id), {
          ...payload,
          whatsAppSentAt: deleteField(),
        });
      } else {
        await addDoc(collection(firestore, 'student_reminders'), {
          ...payload,
          studentId: student.id,
          studentName: student.name,
          createdBy: currentUser.id,
          createdByName: currentUser.name,
          status: 'active',
          createdAt: new Date().toISOString(),
        });
      }
      toast({ title: editing ? 'Reminder updated' : 'Reminder created' });
      onClose();
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Failed', description: e.message });
    } finally {
      setLoading(false);
    }
  };

  const staffUsers = allUsers.filter(u => u.role !== 'student');

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{editing ? 'Edit Reminder' : 'New Reminder'}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input placeholder="e.g. Student interview tomorrow" value={form.title}
              onChange={e => set('title', e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Description (optional)</Label>
            <Textarea placeholder="Add more details..." rows={2} value={form.description}
              onChange={e => set('description', e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Location / Region (optional)</Label>
            <Input placeholder="e.g. Salmiya, London, Online" value={form.location}
              onChange={e => set('location', e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" value={form.date} onChange={e => set('date', e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Time (Kuwait)</Label>
              <Input type="time" value={form.time} onChange={e => set('time', e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Notify</Label>
            <Select value={form.recipientType} onValueChange={v => set('recipientType', v as ReminderRecipientType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="employee">Employee (assigned)</SelectItem>
                <SelectItem value="department">Department</SelectItem>
                <SelectItem value="all">Everyone</SelectItem>
                <SelectItem value="custom">Custom users</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.recipientType === 'custom' && (
            <div className="space-y-1.5">
              <Label>Select users</Label>
              <div className="max-h-36 overflow-y-auto border rounded-md divide-y">
                {staffUsers.map(u => (
                  <label key={u.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/50">
                    <input type="checkbox" checked={form.recipientUserIds.includes(u.id)}
                      onChange={() => toggleUserId(u.id)} className="h-4 w-4 rounded border-gray-300" />
                    <span className="text-sm flex-1">{u.name}</span>
                    <span className="text-xs text-muted-foreground capitalize">{u.role}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <Switch id="wa-toggle" checked={form.notifyWhatsApp} onCheckedChange={v => set('notifyWhatsApp', v)} />
            <Label htmlFor="wa-toggle" className="flex items-center gap-1.5 cursor-pointer">
              <MessageSquare className="h-4 w-4 text-green-600" />
              Send WhatsApp notification
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleSave} disabled={!form.title.trim() || !form.date || !form.time || loading}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {editing ? 'Save changes' : 'Create reminder'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RemindersCard({ student, currentUser }: Props) {
  const { toast } = useToast();
  const [formOpen, setFormOpen] = useState(false);
  const [editingReminder, setEditingReminder] = useState<Reminder | null>(null);
  const [snoozeTarget, setSnoozeTarget] = useState<Reminder | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);

  const constraints = useMemoFirebase(
    () => [where('studentId', '==', student.id), where('status', '==', 'active')],
    [student.id]
  );
  const { data: reminders, isLoading } = useCollection<Reminder>('student_reminders', ...constraints);

  // Only fetch users when the form is open (needed only for custom recipient picker)
  const { data: allUsers } = useCollection<User>(formOpen ? 'users' : '');

  const active = (reminders || [])
    .slice()
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
    .map(r => ({ ...r, _overdue: isPast(new Date(r.dueAt)) }));

  const overdueCount = active.filter(r => r._overdue).length;

  const handleDismiss = async (id: string) => {
    setDismissingId(id);
    try {
      await updateDoc(doc(firestore, 'student_reminders', id), { status: 'dismissed' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Failed', description: e.message });
    } finally {
      setDismissingId(null);
    }
  };

  const openEdit = (r: Reminder) => { setEditingReminder(r); setFormOpen(true); };
  const handleFormClose = () => { setFormOpen(false); setEditingReminder(null); };

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm">Reminders</CardTitle>
              {overdueCount > 0 && (
                <span className="bg-red-500 text-white text-xs font-bold rounded-full px-2 py-0.5 leading-none">
                  {overdueCount}
                </span>
              )}
            </div>
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs"
              onClick={() => { setEditingReminder(null); setFormOpen(true); }}>
              <Plus className="h-3.5 w-3.5" />Add
            </Button>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          {isLoading ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : active.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No active reminders.</p>
          ) : (
            <div className="space-y-2">
              {active.map(r => (
                <div key={r.id} className={cn(
                  'rounded-md border p-3 space-y-1.5 transition-colors',
                  r._overdue
                    ? 'bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800'
                    : 'bg-muted/30 border-border'
                )}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold leading-snug">{r.title}</p>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => openEdit(r)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button size="icon" variant="ghost"
                        className="h-6 w-6 text-destructive hover:text-destructive"
                        disabled={dismissingId === r.id} onClick={() => handleDismiss(r.id)}>
                        {dismissingId === r.id
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <Trash2 className="h-3 w-3" />}
                      </Button>
                    </div>
                  </div>

                  {r.description && <p className="text-xs text-muted-foreground">{r.description}</p>}

                  {r.location && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3 shrink-0" />{r.location}
                    </div>
                  )}

                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />{formatKuwaitTime(r.dueAt)}
                    </div>
                    <TimeLeft dueAt={r.dueAt} />
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={cn('text-xs px-2 py-0.5 rounded border font-medium', RECIPIENT_COLORS[r.recipientType])}>
                      {RECIPIENT_LABELS[r.recipientType]}
                    </span>
                    {r.notifyWhatsApp && (
                      <span className="text-xs px-2 py-0.5 rounded border bg-green-50 border-green-200 text-green-700 font-medium flex items-center gap-1">
                        <MessageSquare className="h-3 w-3" />WhatsApp
                      </span>
                    )}
                    {r.whatsAppSentAt && <span className="text-xs text-muted-foreground">· sent</span>}
                  </div>

                  <Button size="sm" variant="outline" className="h-6 text-xs gap-1 mt-1"
                    onClick={() => setSnoozeTarget(r)}>
                    <AlarmClock className="h-3 w-3" />Snooze
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ReminderFormDialog
        student={student} currentUser={currentUser} editing={editingReminder}
        open={formOpen} onClose={handleFormClose} allUsers={allUsers || []}
      />
      {snoozeTarget && (
        <SnoozeDialog reminder={snoozeTarget} open={!!snoozeTarget} onClose={() => setSnoozeTarget(null)} />
      )}
    </>
  );
}
