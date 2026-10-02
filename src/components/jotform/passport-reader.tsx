'use client';

// "Read from passport" on the JotForm page. The employee drops the passport in, the AI
// reads it, and the empty fields are filled. Fields already typed are never overwritten:
// a difference is shown instead, because when the passport and the employee disagree it
// is the employee who has the passport in front of them.

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, CheckCircle2, Loader2, ScanLine } from 'lucide-react';
import { auth } from '@/firebase';
import { cn } from '@/lib/utils';

export type PassportFields = {
  isPassport: boolean;
  surname: string | null;
  givenNames: string | null;
  dateOfBirth: string | null;
  sex: 'M' | 'F' | null;
  civilId: string | null;
  expiryDate: string | null;
  unsure: string[];
  note: string | null;
};

export type PassportApplyResult = {
  filled: string[];
  differences: string[];
};

/** Phone photos run to several MB; the reader needs far less. The original is still what gets saved. */
const MAX_SIDE = 2000;

async function shrinkForReading(file: File): Promise<Blob> {
  if (file.type === 'application/pdf' || !file.type.startsWith('image/')) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 3_000_000 && ['image/jpeg', 'image/png'].includes(file.type)) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not prepare the photo.'))), 'image/jpeg', 0.9),
    );
  } catch {
    throw new Error('This photo format cannot be read here. Use a JPG, PNG or PDF of the passport page.');
  }
}

function monthsUntil(iso: string): number {
  const d = new Date(iso);
  const now = new Date();
  return (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth());
}

export function PassportReader({
  passportFiles,
  onAddFile,
  onRead,
}: {
  /** Files already in the Passport slot under Documents. */
  passportFiles: File[];
  /** Put a newly chosen file into the Passport slot, so it is not uploaded twice. */
  onAddFile: (file: File) => void;
  onRead: (fields: PassportFields) => PassportApplyResult;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<(PassportApplyResult & { fields: PassportFields }) | null>(null);

  const read = async (file: File) => {
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const current = auth.currentUser;
      if (!current) throw new Error('You are signed out. Reload the page and sign in again.');
      const body = new FormData();
      const blob = await shrinkForReading(file);
      body.append('file', blob, file.name);
      const res = await fetch('/api/ai/passport', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await current.getIdToken()}` },
        body,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'The passport could not be read. Please type the details.');
      const fields = data as PassportFields;
      if (!fields.isPassport) {
        throw new Error(fields.note ? `That doesn't look like a passport page: ${fields.note}` : "That doesn't look like a passport page.");
      }
      setOutcome({ ...onRead(fields), fields });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (inputRef.current) inputRef.current.value = '';
    if (!file) return;
    onAddFile(file);
    read(file);
  };

  const expiry = outcome?.fields.expiryDate;
  const expiringSoon = expiry ? monthsUntil(expiry) < 6 : false;

  return (
    <div className="space-y-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <ScanLine className="h-4 w-4 text-primary" />
            Fill from passport
          </p>
          <p className="text-xs text-muted-foreground">
            Add the passport page and the name, date of birth and gender are filled in for you to check.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {passportFiles.length > 0 && (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => read(passportFiles[0])}>
              Read attached passport
            </Button>
          )}
          <Button type="button" size="sm" disabled={busy} onClick={() => inputRef.current?.click()} className="gap-1.5">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanLine className="h-3.5 w-3.5" />}
            {busy ? 'Reading…' : passportFiles.length > 0 ? 'Use another file' : 'Add passport'}
          </Button>
          <input ref={inputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={pick} />
        </div>
      </div>

      {error && (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </p>
      )}

      {outcome && (
        <div className="space-y-1.5 text-xs">
          {outcome.filled.length > 0 ? (
            <p className="flex items-start gap-1.5 text-success">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Filled: {outcome.filled.join(' · ')}. <strong>Check each one against the passport.</strong>
              </span>
            </p>
          ) : (
            <p className="text-muted-foreground">Nothing new to fill — those fields were already typed.</p>
          )}
          {outcome.differences.map((d) => (
            <p key={d} className="flex items-start gap-1.5 text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {d}
            </p>
          ))}
          {outcome.fields.unsure.length > 0 && (
            <p className="flex items-start gap-1.5 text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Hard to read on this copy: {outcome.fields.unsure.join(', ')}. Check these carefully.
            </p>
          )}
          {expiry && (
            <p className={cn('flex items-start gap-1.5', expiringSoon ? 'font-semibold text-destructive' : 'text-muted-foreground')}>
              {expiringSoon && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              Passport expires {expiry}
              {expiringSoon && ' — less than 6 months away; most visas need more.'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
