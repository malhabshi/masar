'use client';

import { useEffect, useState } from 'react';
import type { Student } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { FileText, Download, Trash2, Loader2, Link2, Copy, Check, PowerOff, Power, StickyNote, Pencil, Eye } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { doc, collection, setDoc, where, updateDoc, deleteDoc, arrayUnion } from 'firebase/firestore';
import { ref, deleteObject } from 'firebase/storage';
import { firestore } from '@/firebase';
import { storage } from '@/firebase/init';
import { useCollection, useMemoFirebase } from '@/firebase/client';
import { formatDate } from '@/lib/timestamp-utils';
import { useToast } from '@/hooks/use-toast';

interface PublicUpload {
  id: string;
  fileName: string;
  url: string;
  size: number;
  uploadedAt: string;
  token: string;
  storagePath?: string;
  studentNote?: string;
}

interface UploadLink {
  id: string;
  token: string;
  studentId: string;
  createdByName: string;
  createdAt: string;
  isDisabled?: boolean;
}

interface Props {
  student: Student;
  currentUser: AppUser;
  allowGenerateLink: boolean;
}

function forceDownload(url: string, filename: string) {
  const link = document.createElement('a');
  link.href = `/api/download?url=${encodeURIComponent(url)}&filename=${encodeURIComponent(filename)}`;
  link.download = filename;
  link.click();
}

export function StudentUploadedDocuments({ student, currentUser, allowGenerateLink }: Props) {
  const { toast } = useToast();
  const [isClient, setIsClient] = useState(false);
  const [showGenDialog, setShowGenDialog] = useState(false);
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);
  const [newLinkUrl, setNewLinkUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [notifyEmployee, setNotifyEmployee] = useState(true);
  const [notifyDepartment, setNotifyDepartment] = useState(false);
  const [notifyAdmin, setNotifyAdmin] = useState(false);
  const [expiryDays, setExpiryDays] = useState('2');
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [togglingLink, setTogglingLink] = useState<string | null>(null);
  const [isDeletingLink, setIsDeletingLink] = useState<string | null>(null);
  const [isSavingNote, setIsSavingNote] = useState(false);
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [noteValue, setNoteValue] = useState(student.uploadNote ?? '');

  useEffect(() => { setIsClient(true); }, []);

  useEffect(() => {
    const hasUnseen = ((student.newPublicUploadsForAdmin || 0) > 0 || (student.newPublicUploadsForEmployee || 0) > 0)
      && (!student.publicUploadsViewedBy || !student.publicUploadsViewedBy.includes(currentUser.id));
    if (!hasUnseen) return;
    updateDoc(doc(firestore, 'students', student.id), {
      publicUploadsViewedBy: arrayUnion(currentUser.id),
    }).catch(() => {});
  }, [student.id]);

  const uploadConstraints = useMemoFirebase(
    () => [where('studentId', '==', student.id)],
    [student.id]
  );
  const { data: uploads } = useCollection<PublicUpload>('student_public_uploads', ...uploadConstraints);
  const { data: uploadLinks } = useCollection<UploadLink>('upload_links', ...uploadConstraints);

  const sortedUploads = (uploads || []).slice().sort(
    (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
  );
  const sortedLinks = (uploadLinks || []).slice().sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const handleDelete = async (upload: PublicUpload) => {
    setIsDeleting(upload.id);
    try {
      if (upload.storagePath) {
        await deleteObject(ref(storage, upload.storagePath));
      }
      await deleteDoc(doc(firestore, 'student_public_uploads', upload.id));
      toast({ title: 'File deleted' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Delete failed', description: e.message });
    } finally {
      setIsDeleting(null);
    }
  };

  const handleRename = async (upload: PublicUpload, newName: string) => {
    if (!newName.trim() || newName === upload.fileName) return;
    try {
      await updateDoc(doc(firestore, 'student_public_uploads', upload.id), { fileName: newName.trim() });
      toast({ title: 'Name updated' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Rename failed', description: e.message });
    }
  };

  const handleDeleteLink = async (link: UploadLink) => {
    setIsDeletingLink(link.id);
    try {
      await deleteDoc(doc(firestore, 'upload_links', link.id));
      toast({ title: 'Link deleted' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Failed to delete link', description: e.message });
    } finally {
      setIsDeletingLink(null);
    }
  };

  const handleToggleLink = async (link: UploadLink) => {
    setTogglingLink(link.id);
    try {
      await updateDoc(doc(firestore, 'upload_links', link.id), { isDisabled: !link.isDisabled });
      toast({ title: link.isDisabled ? 'Link enabled' : 'Link disabled' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Failed to update link', description: e.message });
    } finally {
      setTogglingLink(null);
    }
  };

  const handleGenerateLink = async () => {
    setIsGeneratingLink(true);
    try {
      const token = crypto.randomUUID();
      const expiresAt = expiryDays !== 'none'
        ? new Date(Date.now() + parseInt(expiryDays) * 86400000).toISOString()
        : null;
      await setDoc(doc(collection(firestore, 'upload_links'), token), {
        token,
        studentId: student.id,
        studentName: student.name,
        studentEmail: student.email || '',
        createdBy: currentUser.id,
        createdByName: currentUser.name,
        createdAt: new Date().toISOString(),
        isDisabled: false,
        uploadNote: student.uploadNote ?? '',
        notifyEmployee,
        notifyDepartment,
        notifyAdmin,
        ...(expiresAt ? { expiresAt } : {}),
      });
      setNewLinkUrl(`${window.location.origin}/upload/${token}`);
      setShowGenDialog(false);
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Failed to generate link', description: e.message });
    } finally {
      setIsGeneratingLink(false);
    }
  };

  const handleSaveNote = async () => {
    setIsSavingNote(true);
    try {
      await updateDoc(doc(firestore, 'students', student.id), { uploadNote: noteValue });
      await Promise.all(
        (uploadLinks || []).map(link =>
          updateDoc(doc(firestore, 'upload_links', link.id), { uploadNote: noteValue })
        )
      );
      setIsEditingNote(false);
      toast({ title: 'Note saved' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Failed to save note', description: e.message });
    } finally {
      setIsSavingNote(false);
    }
  };

  const handleCopy = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Student Documents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Uploaded files */}
          {sortedUploads.length > 0 ? (
            <div className="space-y-2">
              {sortedUploads.map(upload => {
                const beingDeleted = isDeleting === upload.id;
                return (
                  <div key={upload.id} className="rounded-lg border bg-muted/30 px-3 py-2 space-y-1">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <Input
                        defaultValue={upload.fileName}
                        disabled={beingDeleted}
                        className="h-7 text-sm flex-1 bg-transparent border-transparent hover:border-input focus:border-input px-1"
                        onBlur={e => handleRename(upload, e.target.value)}
                      />
                      <span className="text-xs text-muted-foreground shrink-0">
                        {isClient ? formatDate(upload.uploadedAt) : '...'}
                      </span>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" asChild title="View">
                        <a href={upload.url} target="_blank" rel="noopener noreferrer">
                          <Eye className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Download" onClick={() => forceDownload(upload.url, upload.fileName)}>
                        <Download className="h-3.5 w-3.5" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" disabled={beingDeleted}>
                            {beingDeleted
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Trash2 className="h-3.5 w-3.5 text-destructive" />}
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete file?</AlertDialogTitle>
                            <AlertDialogDescription>
                              "{upload.fileName}" will be permanently deleted. This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDelete(upload)} className="bg-destructive hover:bg-destructive/90">
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                    {upload.studentNote && (
                      <p className="text-xs text-muted-foreground italic pl-6 whitespace-pre-wrap">{upload.studentNote}</p>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-6">No documents uploaded by the student yet.</p>
          )}

          {/* Missing items note */}
          <div className="border-t pt-4 space-y-2">
            <div className="flex items-center gap-1.5">
              <StickyNote className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Missing Items Note</p>
              {!isEditingNote && (
                <Button variant="ghost" size="icon" className="h-6 w-6 ml-auto" onClick={() => setIsEditingNote(true)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            {isEditingNote ? (
              <div className="space-y-2">
                <Textarea
                  autoFocus
                  value={noteValue}
                  onChange={e => setNoteValue(e.target.value)}
                  placeholder="List the documents or items needed from the student..."
                  className="text-sm min-h-[80px] resize-none"
                />
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={() => { setNoteValue(student.uploadNote ?? ''); setIsEditingNote(false); }}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSaveNote} disabled={isSavingNote}>
                    {isSavingNote && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap min-h-[2rem]">
                {noteValue || <span className="italic">No note yet. Click the pencil to add one.</span>}
              </p>
            )}
          </div>

          {/* Upload links management */}
          {allowGenerateLink && sortedLinks.length > 0 && (
            <div className="border-t pt-4 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Upload Links</p>
              {sortedLinks.map(link => {
                const linkUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/upload/${link.token}`;
                const isToggling = togglingLink === link.id;
                return (
                  <div key={link.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                    <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate font-mono text-xs text-muted-foreground">{linkUrl}</span>
                    <Badge variant={link.isDisabled ? 'secondary' : 'default'} className="shrink-0 text-xs">
                      {link.isDisabled ? 'Disabled' : 'Active'}
                    </Badge>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {isClient ? formatDate(link.createdAt) : '...'}
                    </span>
                    {!link.isDisabled && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => handleCopy(linkUrl)}>
                        {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      disabled={isToggling}
                      onClick={() => handleToggleLink(link)}
                      title={link.isDisabled ? 'Enable link' : 'Disable link'}
                    >
                      {isToggling
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : link.isDisabled
                          ? <Power className="h-3.5 w-3.5 text-green-500" />
                          : <PowerOff className="h-3.5 w-3.5 text-destructive" />}
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" disabled={isDeletingLink === link.id}>
                          {isDeletingLink === link.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Trash2 className="h-3.5 w-3.5 text-destructive" />}
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete this link?</AlertDialogTitle>
                          <AlertDialogDescription>
                            The link will stop working immediately and cannot be recovered.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDeleteLink(link)} className="bg-destructive hover:bg-destructive/90">
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>

        {allowGenerateLink && (
          <CardFooter className="border-t pt-4">
            <Button variant="outline" onClick={() => setShowGenDialog(true)}>
              <Link2 className="mr-2 h-4 w-4" />
              Share Upload Link
            </Button>
          </CardFooter>
        )}
      </Card>

      {/* Pre-generation dialog */}
      <Dialog open={showGenDialog} onOpenChange={setShowGenDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Share Upload Link</DialogTitle>
            <DialogDescription>Configure who gets notified when {student.name} uploads a file.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <p className="text-sm font-medium">Notify when student uploads</p>
              <div className="space-y-2">
                {[
                  { id: 'notify-emp', label: 'Link creator (you)', checked: notifyEmployee, onChange: setNotifyEmployee },
                  { id: 'notify-dept', label: 'Department staff', checked: notifyDepartment, onChange: setNotifyDepartment },
                  { id: 'notify-admin', label: 'Admins', checked: notifyAdmin, onChange: setNotifyAdmin },
                ].map(({ id, label, checked, onChange }) => (
                  <div key={id} className="flex items-center gap-2">
                    <Checkbox id={id} checked={checked} onCheckedChange={v => onChange(!!v)} />
                    <Label htmlFor={id} className="text-sm font-normal">{label}</Label>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Link expires after</Label>
              <Select value={expiryDays} onValueChange={setExpiryDays}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No expiry</SelectItem>
                  <SelectItem value="1">1 day</SelectItem>
                  <SelectItem value="2">2 days</SelectItem>
                  <SelectItem value="7">7 days</SelectItem>
                  <SelectItem value="30">30 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGenDialog(false)}>Cancel</Button>
            <Button onClick={handleGenerateLink} disabled={isGeneratingLink}>
              {isGeneratingLink && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Generate Link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New link dialog */}
      <Dialog open={!!newLinkUrl} onOpenChange={v => !v && setNewLinkUrl(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Upload Link for {student.name}</DialogTitle>
            <DialogDescription>
              Share this link with the student. They can upload documents without logging in. You can disable it anytime from the card below.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 mt-2">
            <Input readOnly value={newLinkUrl || ''} className="text-xs font-mono" />
            <Button size="icon" variant="outline" onClick={() => newLinkUrl && handleCopy(newLinkUrl)}>
              {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
