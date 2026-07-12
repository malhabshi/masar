'use client';

import { useMemo } from 'react';
import type { Student, User } from '@/lib/types';
import { useCollection } from '@/firebase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { History, GraduationCap, ArrowRightLeft, CheckCircle2, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';

interface ChangeAgentHistoryProps {
  student: Student;
}

function fmtDateTime(iso?: string) {
  if (!iso) return '—';
  try {
    return format(new Date(iso), 'yyyy-MM-dd • hh:mm a');
  } catch {
    return iso;
  }
}

export function ChangeAgentHistory({ student }: ChangeAgentHistoryProps) {
  const { data: users } = useCollection<User>('users');

  const nameByCivilId = useMemo(() => {
    const m = new Map<string, string>();
    (users || []).forEach(u => { if (u.civilId) m.set(u.civilId, u.name); });
    return m;
  }, [users]);
  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    (users || []).forEach(u => m.set(u.id, u.name));
    return m;
  }, [users]);

  const log = student.changeAgentLog || [];
  const transfers = student.transferHistory || [];

  if (log.length === 0 && transfers.length === 0) return null;

  const sortedLog = [...log].sort((a, b) => String(b.flaggedAt).localeCompare(String(a.flaggedAt)));
  const sortedTransfers = [...transfers].sort((a, b) => String(b.date).localeCompare(String(a.date)));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-4 w-4" /> Change Agent History
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {sortedLog.length > 0 && (
          <div className="space-y-2">
            {sortedLog.map(entry => (
              <div key={entry.id} className="rounded-md border p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 font-medium text-sm">
                    <GraduationCap className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span>{entry.university}</span>
                  </div>
                  {entry.resolvedAt ? (
                    <Badge className="bg-green-100 text-green-800 border border-green-300 gap-1 text-[10px]"><CheckCircle2 className="h-3 w-3" />Solved</Badge>
                  ) : (
                    <Badge className="bg-red-100 text-red-800 border border-red-300 gap-1 text-[10px]"><AlertTriangle className="h-3 w-3" />Active</Badge>
                  )}
                </div>
                <div className="mt-1.5 text-xs text-muted-foreground space-y-0.5">
                  <div>Change agent flagged: <span className="font-medium text-foreground">{fmtDateTime(entry.flaggedAt)}</span>{entry.flaggedByName ? ` — by ${entry.flaggedByName}` : ''}</div>
                  {entry.resolvedAt && <div>Solved: <span className="font-medium text-green-700">{fmtDateTime(entry.resolvedAt)}</span></div>}
                  {entry.note && <div>Note: {entry.note}</div>}
                </div>
              </div>
            ))}
          </div>
        )}

        {sortedTransfers.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">Transfers</p>
            {sortedTransfers.map((t, i) => (
              <div key={i} className="rounded-md border p-3 flex items-start gap-2">
                <ArrowRightLeft className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                <div className="text-xs text-muted-foreground">
                  <div className="text-foreground font-medium">Transferred — {fmtDateTime(t.date)}</div>
                  <div>
                    {t.fromEmployeeId ? (nameByCivilId.get(t.fromEmployeeId) || 'Unknown') : 'Unassigned'}
                    {' → '}
                    {t.toEmployeeId ? (nameByCivilId.get(t.toEmployeeId) || 'Unknown') : 'Unassigned'}
                  </div>
                  {t.transferredBy && <div>By {nameById.get(t.transferredBy) || 'Staff'}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
