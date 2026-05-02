'use client';

import { useMemo, useState } from 'react';
import { useUser } from '@/hooks/use-user';
import { useCollection } from '@/firebase/client';
import { firestore } from '@/firebase';
import { doc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { formatDate } from '@/lib/timestamp-utils';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Loader2, Trash2, Power, PowerOff, Copy, Check, Link2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface UploadLink {
  id: string;
  token: string;
  studentId: string;
  studentName: string;
  studentEmail: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  isDisabled?: boolean;
  lastUsedAt?: string;
  expiresAt?: string;
  notifyEmployee?: boolean;
  notifyDepartment?: boolean;
  notifyAdmin?: boolean;
}

interface PublicUpload {
  id: string;
  token: string;
}

type Filter = 'all' | 'active' | 'disabled' | 'never-used';

export default function UploadLinksPage() {
  const { user } = useUser();
  const router = useRouter();
  const { toast } = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const { data: links, isLoading: linksLoading } = useCollection<UploadLink>('upload_links');
  const { data: uploads, isLoading: uploadsLoading } = useCollection<PublicUpload>('student_public_uploads');

  const uploadCountByToken = useMemo(() => {
    const map = new Map<string, number>();
    (uploads || []).forEach(u => map.set(u.token, (map.get(u.token) ?? 0) + 1));
    return map;
  }, [uploads]);

  if (!['admin', 'adminplus'].includes(user?.role ?? '')) {
    router.replace('/dashboard');
    return null;
  }

  const isLoading = linksLoading || uploadsLoading;

  const isExpired = (link: UploadLink) =>
    !!link.expiresAt && new Date(link.expiresAt) < new Date();

  const sorted = (links || []).slice().sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const filtered = sorted.filter(link => {
    if (filter === 'active') return !link.isDisabled && !isExpired(link);
    if (filter === 'disabled') return link.isDisabled || isExpired(link);
    if (filter === 'never-used') return !link.lastUsedAt;
    return true;
  });

  const filterCounts = {
    all: sorted.length,
    active: sorted.filter(l => !l.isDisabled && !isExpired(l)).length,
    disabled: sorted.filter(l => l.isDisabled || isExpired(l)).length,
    'never-used': sorted.filter(l => !l.lastUsedAt).length,
  };

  const allSelected = filtered.length > 0 && filtered.every(l => selectedIds.has(l.id));

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(l => l.id)));
    }
  };

  const handleCopy = (link: UploadLink) => {
    navigator.clipboard.writeText(`${window.location.origin}/upload/${link.token}`);
    setCopiedId(link.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleToggle = async (link: UploadLink) => {
    setTogglingId(link.id);
    try {
      await updateDoc(doc(firestore, 'upload_links', link.id), { isDisabled: !link.isDisabled });
      toast({ title: link.isDisabled ? 'Link enabled' : 'Link disabled' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Failed', description: e.message });
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (link: UploadLink) => {
    setDeletingId(link.id);
    try {
      await deleteDoc(doc(firestore, 'upload_links', link.id));
      setSelectedIds(prev => { const next = new Set(prev); next.delete(link.id); return next; });
      toast({ title: 'Link deleted' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Failed', description: e.message });
    } finally {
      setDeletingId(null);
    }
  };

  const handleBulkDelete = async () => {
    setIsBulkDeleting(true);
    try {
      const batch = writeBatch(firestore);
      selectedIds.forEach(id => batch.delete(doc(firestore, 'upload_links', id)));
      await batch.commit();
      setSelectedIds(new Set());
      toast({ title: `${selectedIds.size} link(s) deleted` });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Bulk delete failed', description: e.message });
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'disabled', label: 'Disabled / Expired' },
    { key: 'never-used', label: 'Never Used' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Upload Links</h1>
        <p className="text-sm text-muted-foreground">All student upload links generated by staff.</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <CardTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5" />
              All Links
              {!isLoading && <Badge variant="secondary">{sorted.length}</Badge>}
            </CardTitle>
            <div className="flex items-center gap-1 flex-wrap">
              {FILTERS.map(f => (
                <Button
                  key={f.key}
                  variant={filter === f.key ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => { setFilter(f.key); setSelectedIds(new Set()); }}
                >
                  {f.label}
                  {!isLoading && (
                    <Badge variant={filter === f.key ? 'secondary' : 'outline'} className="ml-1.5">
                      {filterCounts[f.key]}
                    </Badge>
                  )}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-muted/50 border">
              <span className="text-sm font-medium">{selectedIds.size} selected</span>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" size="sm" disabled={isBulkDeleting}>
                    {isBulkDeleting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-2 h-3.5 w-3.5" />}
                    Delete Selected
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete {selectedIds.size} link(s)?</AlertDialogTitle>
                    <AlertDialogDescription>
                      All selected links will stop working immediately. This cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleBulkDelete} className="bg-destructive hover:bg-destructive/90">
                      Delete All
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>Clear</Button>
            </div>
          )}

          {isLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-12">No links match this filter.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} />
                  </TableHead>
                  <TableHead>Student</TableHead>
                  <TableHead>Created By</TableHead>
                  <TableHead>Created At</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead>Uploads</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(link => {
                  const expired = isExpired(link);
                  const count = uploadCountByToken.get(link.token) ?? 0;
                  return (
                    <TableRow key={link.id} className={selectedIds.has(link.id) ? 'bg-muted/40' : ''}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(link.id)}
                          onCheckedChange={() => toggleSelect(link.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <button
                          className="text-left hover:underline font-medium"
                          onClick={() => router.push(`/student/${link.studentId}`)}
                        >
                          {link.studentName}
                        </button>
                        {link.studentEmail && (
                          <p className="text-xs text-muted-foreground">{link.studentEmail}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{link.createdByName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDate(link.createdAt)}</TableCell>
                      <TableCell className="text-sm">
                        {link.expiresAt ? (
                          <span className={expired ? 'text-destructive text-xs font-medium' : 'text-xs text-muted-foreground'}>
                            {expired ? 'Expired' : formatDate(link.expiresAt)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={count > 0 ? 'default' : 'secondary'} className="text-xs">
                          {count} file{count !== 1 ? 's' : ''}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {link.lastUsedAt ? (
                          <span className="text-xs text-green-600 font-medium">{formatDate(link.lastUsedAt)}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Never</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={link.isDisabled || expired ? 'secondary' : 'default'}>
                          {expired ? 'Expired' : link.isDisabled ? 'Disabled' : 'Active'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {!link.isDisabled && !expired && (
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleCopy(link)}>
                              {copiedId === link.id
                                ? <Check className="h-4 w-4 text-green-500" />
                                : <Copy className="h-4 w-4" />}
                            </Button>
                          )}
                          {!expired && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              disabled={togglingId === link.id}
                              onClick={() => handleToggle(link)}
                              title={link.isDisabled ? 'Enable' : 'Disable'}
                            >
                              {togglingId === link.id
                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                : link.isDisabled
                                  ? <Power className="h-4 w-4 text-green-500" />
                                  : <PowerOff className="h-4 w-4 text-destructive" />}
                            </Button>
                          )}
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8" disabled={deletingId === link.id}>
                                {deletingId === link.id
                                  ? <Loader2 className="h-4 w-4 animate-spin" />
                                  : <Trash2 className="h-4 w-4 text-destructive" />}
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete this link?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  The link for <strong>{link.studentName}</strong> will stop working immediately.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDelete(link)} className="bg-destructive hover:bg-destructive/90">
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
