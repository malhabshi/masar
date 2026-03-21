'use client';

import { useMemo } from 'react';
import type { Student } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { User, Building2 } from 'lucide-react';
import { useUserCacheByCivilId } from '@/hooks/use-user-cache';

interface AssignmentCardProps {
  student: Student;
}

export function AssignmentCard({ student }: AssignmentCardProps) {
  const { userMap } = useUserCacheByCivilId(student.employeeId ? [student.employeeId] : []);
  const employee = student.employeeId ? userMap.get(student.employeeId) : null;

  const relevantDepts = useMemo(() => {
    const depts = new Set<string>();
    (student.applications || []).forEach(app => {
      if (app.country === 'UK') depts.add('UK');
      if (app.country === 'USA') depts.add('USA');
      if (app.country === 'Australia' || app.country === 'New Zealand') depts.add('AU/NZ');
    });
    return Array.from(depts);
  }, [student.applications]);

  return (
    <Card className="border-primary/20 shadow-sm">
      <CardHeader className="py-4 border-b bg-muted/5">
        <CardTitle className="text-sm font-bold uppercase tracking-widest flex items-center gap-2 text-muted-foreground">
          <User className="h-4 w-4 text-primary" />
          Assignment Information
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 pt-6">
        {/* Employee Section */}
        <div className="space-y-3">
          <p className="text-[10px] font-black uppercase text-muted-foreground tracking-tighter">Assigned Portfolio Agent</p>
          {student.employeeId ? (
            <div className="flex items-center gap-3 bg-background p-3 rounded-lg border shadow-sm">
              <Avatar className="h-10 w-10 border-2 border-primary/10">
                <AvatarImage src={employee?.avatarUrl} />
                <AvatarFallback className="bg-primary/5 text-primary text-xs font-bold">
                  {employee?.name?.charAt(0) || '?'}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="font-bold text-sm truncate leading-none mb-1">{employee?.name || 'Loading...'}</p>
                <p className="text-[10px] text-muted-foreground font-mono">Civil ID: {student.employeeId}</p>
              </div>
            </div>
          ) : (
            <div className="p-3 border-2 border-dashed border-orange-200 rounded-lg bg-orange-50 text-orange-700 text-xs font-black flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-orange-500 animate-pulse" />
              UNASSIGNED LEAD
            </div>
          )}
        </div>

        {/* Handling Departments Section */}
        <div className="space-y-3 border-t pt-4">
          <p className="text-[10px] font-black uppercase text-muted-foreground tracking-tighter">Handling Departments</p>
          <div className="flex flex-wrap gap-2">
            {relevantDepts.length > 0 ? (
              relevantDepts.map(dept => (
                <Badge key={dept} variant="secondary" className="bg-primary text-primary-foreground hover:bg-primary px-3 py-1 gap-1.5 h-7 font-bold">
                  <Building2 className="h-3 w-3" />
                  {dept}
                </Badge>
              ))
            ) : (
              <p className="text-[10px] text-muted-foreground italic font-medium">
                No active applications - No regional routing
              </p>
            )}
          </div>
          <p className="text-[8px] text-muted-foreground leading-tight italic">
            * Routing is determined automatically by the country of active university applications.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
