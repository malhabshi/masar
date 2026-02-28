
'use client';

import { useState, useMemo, useEffect } from 'react';
import { useCollection } from '@/firebase/client';
import { useToast } from '@/hooks/use-toast';
import type { NotificationTemplate, NotificationType } from '@/lib/types';
import { saveNotificationTemplate, sendTestWhatsApp } from '@/lib/actions';
import type { AppUser } from '@/hooks/use-user';

import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { 
  Loader2, 
  PlusCircle, 
  Pencil, 
  CheckCircle, 
  XCircle, 
  MessageSquare,
  Link as LinkIcon,
} from 'lucide-react';
import { TemplateDialog } from './template-dialog';

export interface NotificationTypeMeta {
  type: NotificationType;
  label: string;
  variables: string[];
  exampleMessage: string;
}

const NOTIFICATION_TYPES: NotificationTypeMeta[] = [
  { 
    type: 'new_task_assigned', 
    label: 'New Task Assigned', 
    variables: ['employeeName', 'taskTitle', 'taskDescription', 'studentName', 'dueDate', 'assignedBy', 'taskUrl'],
    exampleMessage: "📋 *New Task Assigned*\n\nHello {{employeeName}},\n\nYou have been assigned a new task: *{{taskTitle}}*\n\nStudent: {{studentName}}\nAssigned By: {{assignedBy}}\n\nView details: {{taskUrl}}"
  },
  { 
    type: 'task_reply_received', 
    label: 'Task Reply Received', 
    variables: ['employeeName', 'taskTitle', 'replyAuthor', 'replyMessage', 'taskUrl'],
    exampleMessage: "💬 *New Task Reply*\n\nHello {{employeeName}},\n\n{{replyAuthor}} replied to your task \"{{taskTitle}}\":\n\n_\"{{replyMessage}}\"_\n\nView here: {{taskUrl}}"
  },
  { 
    type: 'new_student_added', 
    label: 'New Student Added (Lead)', 
    variables: ['adminName', 'studentName', 'studentEmail', 'studentPhone', 'submissionDate', 'studentUrl'],
    exampleMessage: "🆕 *New Student Lead*\n\nHello {{adminName}},\n\nA new student has been added to the system: *{{studentName}}*\nPhone: {{studentPhone}}\nEmail: {{studentEmail}}\n\nReview here: {{studentUrl}}"
  },
  { 
    type: 'student_assigned', 
    label: 'Student Assigned to Employee', 
    variables: ['employeeName', 'studentName', 'assignedBy', 'studentUrl'],
    exampleMessage: "👤 *Student Assigned*\n\nHello {{employeeName}},\n\nThe student *{{studentName}}* has been assigned to your portfolio by {{assignedBy}}.\n\nOpen profile: {{studentUrl}}"
  },
  { 
    type: 'task_reminder', 
    label: 'Task Reminder', 
    variables: ['employeeName', 'pendingTasksCount', 'oldestTaskDate', 'dashboardUrl'],
    exampleMessage: "⏰ *Task Reminder*\n\nHello {{employeeName}},\n\nYou have {{pendingTasksCount}} pending tasks waiting for your attention.\n\nDashboard: {{dashboardUrl}}"
  },
  { 
    type: 'admin_update', 
    label: 'Admin Update/Announcement', 
    variables: ['userName', 'messageContent', 'dashboardUrl'],
    exampleMessage: "📣 *Management Update*\n\nHello {{userName}},\n\n{{messageContent}}\n\nMore info: {{dashboardUrl}}"
  },
  { 
    type: 'document_uploaded_admin', 
    label: 'Document Uploaded (by Admin)', 
    variables: ['employeeName', 'studentName', 'documentName', 'uploadedBy', 'studentUrl'],
    exampleMessage: "📄 *New Document Uploaded*\n\nHello {{employeeName}},\n\n{{uploadedBy}} uploaded a new document \"{{documentName}}\" for your student: *{{studentName}}*.\n\nView document: {{studentUrl}}"
  },
  { 
    type: 'task_status_completed', 
    label: 'Task Status: Completed', 
    variables: ['employeeName', 'taskTitle', 'studentName', 'taskUrl'],
    exampleMessage: "✅ *Task Completed*\n\nHello {{employeeName}},\n\nYour task \"{{taskTitle}}\" for {{studentName}} has been marked as *COMPLETED*.\n\nTask details: {{taskUrl}}"
  },
  { 
    type: 'ielts_course_registration', 
    label: 'IELTS Course Registration', 
    variables: ['adminName', 'studentName', 'courseOption', 'courseStartDate', 'employeeName'],
    exampleMessage: "🎓 *IELTS Course Registration*\n\nHello {{adminName}},\n\nA new student has registered for an IELTS course:\n\nStudent: {{studentName}}\nCourse: {{courseOption}}\nStart Date: {{courseStartDate}}\nRegistered by: {{employeeName}}"
  },
  {
    type: 'inactivity_reminder',
    label: 'Inactivity Reminder (Auto)',
    variables: ['employeeName', 'studentName', 'dashboardUrl'],
    exampleMessage: "⚠️ *Inactivity Alert*\n\nHello {{employeeName}},\n\nThere has been no activity for *{{studentName}}* for 10 days.\n\nPlease contact the student and provide a report.\nتواصل مع الطالب و عطني تقرير عنه.\n\nProfile: {{dashboardUrl}}"
  }
];

export function NotificationTemplatesManager({ currentUser }: { currentUser: AppUser }) {
  const { toast } = useToast();
  const { data: templates, isLoading } = useCollection<NotificationTemplate>('notification_templates');
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<NotificationTemplate | undefined>(undefined);

  const handleSave = async (values: any) => {
    const result = await saveNotificationTemplate({
      ...values,
      updatedBy: currentUser.email,
    }, editingTemplate?.id);

    if (result.success) {
      toast({ title: 'Template Saved', description: result.message });
      setIsDialogOpen(false);
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
  };

  const handleTest = async (templateId: string, phone: string) => {
    const dummyVars = {
      employeeName: 'Test Employee',
      taskTitle: 'Urgent Documentation',
      studentName: 'Ahmad Example',
      taskUrl: 'https://uniapplyhub.com/tasks',
      adminName: 'Super Admin',
      messageContent: 'This is a test notification.',
      replyAuthor: 'Admin User',
      replyMessage: 'Please upload the transcript.',
      documentName: 'Passport.pdf',
      uploadedBy: 'Admin Sarah',
      courseOption: 'One Month In-Person',
      courseStartDate: 'Sunday, Oct 12',
      assignedBy: 'Manager Ahmad',
      dashboardUrl: 'https://uniapplyhub.com/dashboard'
    };

    const result = await sendTestWhatsApp(templateId, phone, dummyVars);
    if (result.success) {
      toast({ title: 'Test Sent', description: 'WhatsApp message sent successfully.' });
    } else {
      toast({ variant: 'destructive', title: 'Test Failed', description: result.message });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">WhatsApp Notifications</h1>
          <p className="text-muted-foreground mt-1">Configure automated messages triggered by system events.</p>
        </div>
        <Button onClick={() => { setEditingTemplate(undefined); setIsDialogOpen(true); }}>
          <PlusCircle className="mr-2 h-4 w-4" />
          Add Template
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Notification Type</TableHead>
                <TableHead>Template Name</TableHead>
                <TableHead>Webhook</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></TableCell>
                </TableRow>
              ) : templates && templates.length > 0 ? (
                templates.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-bold">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="h-4 w-4 text-primary" />
                        {NOTIFICATION_TYPES.find(nt => nt.type === t.notificationType)?.label || t.notificationType}
                      </div>
                    </TableCell>
                    <TableCell>{t.templateName}</TableCell>
                    <TableCell>
                      {t.webhookUrl ? (
                        <div className="flex items-center gap-1.5 text-success font-medium text-xs">
                          <LinkIcon className="h-3 w-3" />
                          <span className="truncate max-w-[150px]" title={t.webhookUrl}>Configured</span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground italic text-xs">Missing URL</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {t.isActive ? (
                        <Badge className="bg-green-100 text-green-800 border-green-200">
                          <CheckCircle className="h-3 w-3 mr-1" /> Active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          <XCircle className="h-3 w-3 mr-1" /> Inactive
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="icon" onClick={() => { setEditingTemplate(t); setIsDialogOpen(true); }}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">No templates configured.</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <TemplateDialog
        isOpen={isDialogOpen}
        setIsOpen={setIsDialogOpen}
        template={editingTemplate}
        onSave={handleSave}
        onTest={handleTest}
        types={NOTIFICATION_TYPES}
      />
    </div>
  );
}
