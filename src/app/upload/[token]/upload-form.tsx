'use client';

import { useState, useCallback, useEffect } from 'react';
import { UploadCloud, CheckCircle2, FileText, X, Loader2, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { ALLOWED_FILE_EXTENSIONS, ALLOWED_FILE_TYPES, MAX_FILE_SIZE_MB, MAX_FILE_SIZE_BYTES } from '@/lib/file-validation';
import { cn } from '@/lib/utils';
import { firestore } from '@/firebase/init';
import { doc, getDoc } from 'firebase/firestore';
import { notifyStudentUpload } from '@/lib/actions';

interface QueuedFile {
  file: File;
  status: 'pending' | 'uploading' | 'done' | 'error';
  error?: string;
}

interface LinkInfo {
  studentId: string;
  studentName: string;
  studentEmail: string;
  isDisabled?: boolean;
  uploadNote?: string;
  expiresAt?: string;
}

export function PublicUploadForm({ token }: { token: string }) {
  const { toast } = useToast();
  const [linkInfo, setLinkInfo] = useState<LinkInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [allDone, setAllDone] = useState(false);
  const [studentNote, setStudentNote] = useState('');

  useEffect(() => {
    getDoc(doc(firestore, 'upload_links', token))
      .then(snap => setLinkInfo(snap.exists() ? (snap.data() as LinkInfo) : null))
      .finally(() => setLoading(false));
  }, [token]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const valid: QueuedFile[] = [];
    Array.from(files).forEach(f => {
      if (f.size > MAX_FILE_SIZE_BYTES) {
        toast({ variant: 'destructive', title: `${f.name} is too large`, description: `Max ${MAX_FILE_SIZE_MB}MB.` });
        return;
      }
      if (!ALLOWED_FILE_TYPES.includes(f.type)) {
        toast({ variant: 'destructive', title: `${f.name} not supported`, description: 'Use PDF, Word, Excel, or image files.' });
        return;
      }
      valid.push({ file: f, status: 'pending' });
    });
    setQueue(prev => [...prev, ...valid]);
  }, [toast]);

  const removeFile = (idx: number) =>
    setQueue(prev => prev.filter((_, i) => i !== idx));

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const handleUploadAll = async () => {
    if (!linkInfo) return;
    const pendingIndices = queue.reduce<number[]>((acc, q, i) => q.status === 'pending' ? [...acc, i] : acc, []);
    if (!pendingIndices.length) return;

    setQueue(prev => prev.map((q, i) => pendingIndices.includes(i) ? { ...q, status: 'uploading' } : q));

    await Promise.all(pendingIndices.map(async (i) => {
      const file = queue[i].file;
      try {
        const fd = new FormData();
        fd.append('token', token);
        fd.append('file', file);
        if (studentNote.trim()) fd.append('studentNote', studentNote.trim());

        const res = await fetch('/api/upload-public', { method: 'POST', body: fd });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Upload failed (${res.status})`);
        }

        setQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: 'done' } : q));
        notifyStudentUpload(token, file.name);
      } catch (e: any) {
        setQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: 'error', error: e.message } : q));
      }
    }));

    setAllDone(true);
  };

  if (loading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  if (!linkInfo) {
    return (
      <div className="text-center space-y-3 py-16">
        <h2 className="text-2xl font-bold text-destructive">Invalid Link</h2>
        <p className="text-muted-foreground">This upload link is invalid or has expired. Please contact your advisor.</p>
      </div>
    );
  }

  if (linkInfo.isDisabled) {
    return (
      <div className="text-center space-y-3 py-16">
        <h2 className="text-2xl font-bold text-destructive">Link Disabled</h2>
        <p className="text-muted-foreground">This upload link has been disabled. Please contact your advisor for a new link.</p>
      </div>
    );
  }

  if (linkInfo.expiresAt && new Date(linkInfo.expiresAt) < new Date()) {
    return (
      <div className="text-center space-y-3 py-16">
        <h2 className="text-2xl font-bold text-destructive">Link Expired</h2>
        <p className="text-muted-foreground">This upload link has expired. Please contact your advisor for a new link.</p>
      </div>
    );
  }

  if (allDone && queue.every(q => q.status === 'done')) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
        <CheckCircle2 className="h-16 w-16 text-green-500" />
        <h2 className="text-2xl font-bold">All files uploaded!</h2>
        <p className="text-muted-foreground">Your documents have been sent successfully. You may close this page.</p>
      </div>
    );
  }

  const pendingCount = queue.filter(q => q.status === 'pending').length;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-muted/40 p-4 space-y-1">
        <p className="text-sm text-muted-foreground">Uploading for</p>
        <p className="text-lg font-semibold">{linkInfo.studentName}</p>
        <p className="text-sm text-muted-foreground">{linkInfo.studentEmail}</p>
      </div>

      {linkInfo.uploadNote && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-4 space-y-1">
          <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide">Required Documents</p>
          <p className="text-sm whitespace-pre-wrap text-amber-900 dark:text-amber-200">{linkInfo.uploadNote}</p>
        </div>
      )}

      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Your Note (optional)</p>
        </div>
        <Textarea
          value={studentNote}
          onChange={e => setStudentNote(e.target.value)}
          placeholder="Add any message or context for your advisor..."
          className="text-sm min-h-[72px] resize-none"
        />
      </div>

      <label
        className={cn(
          'flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 cursor-pointer transition-colors',
          isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/30'
        )}
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <UploadCloud className="h-10 w-10 text-muted-foreground" />
        <div className="text-center">
          <p className="font-medium">Drag & drop files here, or click to browse</p>
          <p className="text-xs text-muted-foreground mt-1">PDF, Word, Excel, Images — max {MAX_FILE_SIZE_MB}MB each</p>
        </div>
        <input type="file" multiple accept={ALLOWED_FILE_EXTENSIONS} className="sr-only"
          onChange={e => e.target.files && addFiles(e.target.files)} />
      </label>

      {queue.length > 0 && (
        <div className="space-y-2">
          {queue.map((item, i) => (
            <div key={i} className={cn(
              'flex items-center gap-3 rounded-lg border px-3 py-2 text-sm',
              item.status === 'done' && 'border-green-200 bg-green-50',
              item.status === 'error' && 'border-red-200 bg-red-50',
              item.status === 'uploading' && 'border-blue-200 bg-blue-50',
            )}>
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate">{item.file.name}</span>
              <span className="text-xs text-muted-foreground shrink-0">{(item.file.size / 1024 / 1024).toFixed(1)}MB</span>
              {item.status === 'pending' && (
                <button onClick={() => removeFile(i)} className="text-muted-foreground hover:text-destructive">
                  <X className="h-4 w-4" />
                </button>
              )}
              {item.status === 'uploading' && <Loader2 className="h-4 w-4 animate-spin text-blue-500 shrink-0" />}
              {item.status === 'done' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
              {item.status === 'error' && <span className="text-xs text-red-500">{item.error || 'Failed'}</span>}
            </div>
          ))}
        </div>
      )}

      <Button className="w-full" size="lg" disabled={!pendingCount} onClick={handleUploadAll}>
        <UploadCloud className="mr-2 h-4 w-4" />
        Upload {pendingCount ? `${pendingCount} file(s)` : 'Files'}
      </Button>
    </div>
  );
}
