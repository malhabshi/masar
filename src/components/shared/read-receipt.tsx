'use client';

import { Check, CheckCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReadReceipts } from '@/lib/types';

/** Readers other than the author, earliest first. */
export function readerIds(readBy: ReadReceipts | undefined, authorId: string): string[] {
  return Object.entries(readBy || {})
    .filter(([id]) => id !== authorId)
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([id]) => id);
}

interface ReadReceiptProps {
  readBy?: ReadReceipts;
  authorId: string;
  getName: (userId: string) => string;
  className?: string;
}

/**
 * "Seen by Talal, Fatemah" with a double tick, or "Sent" with a single one.
 * Hover shows when each person first had it on screen.
 */
export function ReadReceipt({ readBy, authorId, getName, className }: ReadReceiptProps) {
  const readers = readerIds(readBy, authorId);

  if (readers.length === 0) {
    return (
      <span className={cn('inline-flex items-center gap-1', className)} title="Not seen yet">
        <Check className="h-3 w-3" aria-hidden />
        Sent
      </span>
    );
  }

  const title = readers
    .map(id => `${getName(id)} · ${new Date(readBy![id]).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`)
    .join('\n');

  return (
    <span className={cn('inline-flex items-center gap-1', className)} title={title}>
      <CheckCheck className="h-3 w-3" aria-hidden />
      Seen by {readers.map(getName).join(', ')}
    </span>
  );
}
