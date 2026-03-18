'use client';

import { useState, useMemo, useEffect } from 'react';
import { useCollection } from '@/firebase/client';
import { useUser } from '@/hooks/use-user';
import type { Student, Application, Country, ApplicationStatus } from '@/lib/types';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Search, Globe, Loader2, User as UserIcon, Building2, Calendar, GraduationCap, AlertTriangle } from 'lucide-react';
import { useUserCacheByCivilId } from '@/hooks/use-user-cache';
import Link from 'next/link';
import { formatDate } from '@/lib/timestamp-utils';
import { cn } from '@/lib/utils';

interface FlattenedApplication {
  id: string; // Unique key for row
  studentId: string;
  studentName: string;
  studentPhone: string;
  internalNumber?: string;
  employeeId: string | null;
  application: Application;
}

const statusColors: Record<string, string> = {
  Pending: 'bg-yellow-500',
  Submitted: 'bg-blue-500',
  'Missing Items': 'bg-purple-500',
  Accepted: 'bg-green-500',
  Rejected: 'bg-red-500',
};

const ALL_STATUSES: ApplicationStatus[] = ['Pending', 'Submitted', 'Missing Items', 'Accepted', 'Rejected'];

export function AllApplicationsView() {
  const { user: currentUser, effectiveRole } = useUser();
  const [searchQuery, setSearchQuery] = useState('');
  const [countryFilter, setCountryFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const { data: students, isLoading: studentsLoading } = useCollection<Student>('students');

  // Identify duplicate phones across all students
  const duplicatePhoneSet = useMemo(() => {
    if (!students) return new Set<string>();
    const counts = new Map<string, number>();
    students.forEach(s => {
      if (s.phone) {
        counts.set(s.phone, (counts.get(s.phone) || 0) + 1);
      }
    });
    const duplicates = new Set<string>();
    counts.forEach((count, phone) => {
      if (count > 1) duplicates.add(phone);
    });
    return duplicates;
  }, [students]);

  // Flatten students into a list of applications
  const allFlattened = useMemo(() => {
    if (!students) return [];
    
    const flattened: FlattenedApplication[] = [];
    students.forEach(student => {
      (student.applications || []).forEach((app, idx) => {
        flattened.push({
          id: `${student.id}-${idx}`,
          studentId: student.id,
          studentName: student.name,
          studentPhone: student.phone,
          internalNumber: student.internalNumber,
          employeeId: student.employeeId,
          application: app,
        });
      });
    });
    return flattened;
  }, [students]);

  // Apply Role-Based and UI Filters
  const filteredApplications = useMemo(() => {
    return allFlattened.filter(item => {
      // 1. Regional Filtering for Departments
      if (effectiveRole === 'department' && currentUser?.department) {
        const dept = currentUser.department;
        const country = item.application.country;
        const isMatch = (dept === 'UK' && country === 'UK') || 
                        (dept === 'USA' && country === 'USA') || 
                        (dept === 'AU/NZ' && (country === 'Australia' || country === 'New Zealand'));
        if (!isMatch) return false;
      }

      // 2. UI Search (Student Name)
      const matchesSearch = !searchQuery || 
        item.studentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.application.university.toLowerCase().includes(searchQuery.toLowerCase());

      // 3. UI Country Filter (Only for Admins, Departments are already filtered)
      const matchesCountry = countryFilter === 'all' || item.application.country === countryFilter;

      // 4. UI Status Filter
      const matchesStatus = statusFilter === 'all' || item.application.status === statusFilter;

      return matchesSearch && matchesCountry && matchesStatus;
    }).sort((a, b) => new Date(b.application.updatedAt).getTime() - new Date(a.application.updatedAt).getTime());
  }, [allFlattened, currentUser, effectiveRole, searchQuery, countryFilter, statusFilter]);

  // Fetch unique employee IDs for name mapping
  const employeeCivilIds = useMemo(() => {
    return [...new Set(filteredApplications.map(a => a.employeeId).filter((id): id is string => !!id))];
  }, [filteredApplications]);

  const { userMap: employeeMap } = useUserCacheByCivilId(employeeCivilIds);

  const countries: Country[] = ['UK', 'USA', 'Australia', 'New Zealand'];

  const isFiltered = searchQuery !== '' || (effectiveRole === 'admin' && countryFilter !== 'all') || statusFilter !== 'all';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-3">
              <Globe className="h-6 w-6 text-primary" />
              University Applications List
              {!studentsLoading && (
                <Badge variant="secondary" className="font-mono text-sm bg-primary/10 text-primary border-primary/20">
                  {filteredApplications.length} {isFiltered ? 'Found' : 'Total'}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              {effectiveRole === 'department' 
                ? `Tracking all applications for the ${currentUser?.department} region.` 
                : 'A comprehensive log of every university application across all regions.'}
            </CardDescription>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 w-full lg:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search student or school..."
                className="pl-8"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-40">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {ALL_STATUSES.map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {effectiveRole === 'admin' && (
              <Select value={countryFilter} onValueChange={setCountryFilter}>
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue placeholder="All Countries" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Countries</SelectItem>
                  {countries.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {studentsLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student Name</TableHead>
                    <TableHead>University & Major</TableHead>
                    <TableHead>Country</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Assigned Agent</TableHead>
                    <TableHead className="text-right">Last Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredApplications.length > 0 ? (
                    filteredApplications.map((item) => {
                      const employee = item.employeeId ? employeeMap.get(item.employeeId) : null;
                      const isDuplicate = duplicatePhoneSet.has(item.studentPhone);
                      
                      return (
                        <TableRow key={item.id} className="group">
                          <TableCell>
                            <div className="flex flex-col">
                              <Link href={`/student/${item.studentId}`} className="hover:underline">
                                <div className="flex items-center gap-2">
                                  {item.internalNumber && (
                                    <Badge variant="outline" className="text-[10px] h-5 bg-muted font-mono">
                                      #{item.internalNumber}
                                    </Badge>
                                  )}
                                  <span className="font-bold text-sm">{item.studentName}</span>
                                </div>
                              </Link>
                              {isDuplicate && (
                                <div className="mt-1">
                                  <Badge className="bg-blue-900 hover:bg-blue-800 text-white text-[9px] h-4 py-0 font-black uppercase tracking-tighter gap-1">
                                    <AlertTriangle className="h-2 w-2" />
                                    Duplicate Profile
                                  </Badge>
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-1.5 font-semibold text-xs">
                                <Building2 className="h-3 w-3 text-muted-foreground" />
                                {item.application.university}
                              </div>
                              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground font-medium">
                                <GraduationCap className="h-3 w-3" />
                                {item.application.major}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="font-mono text-[10px] uppercase">
                              {item.application.country}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge className={cn("text-white text-[10px] font-bold uppercase", statusColors[item.application.status])}>
                              {item.application.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2 text-xs">
                              <UserIcon className="h-3 w-3 text-muted-foreground" />
                              <span className="font-medium">{employee?.name || 'Unassigned'}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right text-[10px] font-medium text-muted-foreground">
                            <div className="flex items-center justify-end gap-1.5">
                              <Calendar className="h-3 w-3" />
                              {isClient ? formatDate(item.application.updatedAt) : '...'}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} className="h-32 text-center text-muted-foreground italic">
                        No student applications found matching your criteria.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
