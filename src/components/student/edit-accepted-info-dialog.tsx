'use client';

import { useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { updateAcceptedInfo } from '@/lib/actions';
import { Loader2, Pencil, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { AppUser } from '@/hooks/use-user';
import type { Student } from '@/lib/types';

interface EditAcceptedInfoDialogProps {
  student: Student;
  currentUser: AppUser;
}

export function EditAcceptedInfoDialog({ student, currentUser }: EditAcceptedInfoDialogProps) {
  const { toast } = useToast();
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [country, setCountry] = useState(student.acceptedInfo?.country || '');
  const [major, setMajor] = useState(student.acceptedInfo?.major || '');
  const [listName, setListName] = useState(student.importListName || '');

  const openEdit = () => {
    setCountry(student.acceptedInfo?.country || '');
    setMajor(student.acceptedInfo?.major || '');
    setListName(student.importListName || '');
    setEditOpen(true);
  };

  const handleSave = async () => {
    if (!country.trim() || !major.trim()) {
      toast({ variant: 'destructive', title: 'Missing fields', description: 'Country and Major are required.' });
      return;
    }
    setSaving(true);
    const result = await updateAcceptedInfo(
      student.id,
      { country: country.trim(), major: major.trim(), importListName: listName.trim() },
      currentUser.id,
    );
    setSaving(false);
    if (result.success) {
      toast({ title: 'Updated', description: 'Accepted info has been updated.' });
      setEditOpen(false);
      router.refresh();
    } else {
      toast({ variant: 'destructive', title: 'Update failed', description: result.message });
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    const result = await updateAcceptedInfo(student.id, null, currentUser.id);
    if (result.success) {
      toast({ title: 'Removed', description: 'Accepted info has been removed.' });
      setConfirmDelete(false);
      router.refresh();
    } else {
      toast({ variant: 'destructive', title: 'Remove failed', description: result.message });
    }
    setDeleting(false);
  };

  return (
    <>
      <div className="flex items-center gap-1 pdf-hide">
        <Button variant="ghost" size="icon" className="h-6 w-6 text-purple-700 hover:text-purple-900" onClick={openEdit} aria-label="Edit accepted info">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button variant="ghost" size="icon" className="h-6 w-6 text-purple-700 hover:text-destructive" onClick={() => setConfirmDelete(true)} aria-label="Remove accepted info">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Accepted Info</DialogTitle>
            <DialogDescription>Update the accepted country, major, and list name for {student.name}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="ai-country">Country Accepted</Label>
              <Input id="ai-country" value={country} onChange={e => setCountry(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-major">Major Accepted</Label>
              <Input id="ai-major" value={major} onChange={e => setMajor(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-list">List Name <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input id="ai-list" value={listName} onChange={e => setListName(e.target.value)} placeholder="e.g. July 2026 Accepted" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove accepted info?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the ACCEPTED badge (country · major) and the list name from{' '}
              <strong>{student.name}</strong>. The student profile itself is not deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive hover:bg-destructive/90">
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Yes, remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
