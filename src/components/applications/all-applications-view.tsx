'use client';

import { useState, useMemo, useEffect } from 'react';
import { useCollection } from '@/firebase/client';
import { useUser } from '@/hooks/use-user';
import type { Student, Application, Country, User } from '@/lib/types';
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
import { Search, Globe, Loader2, User as UserIcon, Building2, Calendar, GraduationCap } from 'lucide-react';
import { useUserCacheByCivilId } from '@/hooks/use-user-cache';
import Link from 'next/link';
import { formatDate } from '@/lib/timestamp-utils';
import { cn } from '@/lib/utils';

interface FlattenedApplication {
  id: string; // Unique key for row
  studentId: string;
  studentName: string;
  internalNumber?: string;
  employeeId: string | null;
  application: Application;
}

const statusColors: Record<string, string> = {
  Pending: 'bg-yellow-500',
  Submitted: 'bg-blue-500',
  'In Review': 'bg-purple-500',
  Accepted: 'bg-green-500',
  Rejected: 'bg-red-500',
};

export function AllApplicationsView() {
  const { user: currentUser, effectiveRole } = useUser();
  const [searchQuery, setSearchQuery] = useState('');
  const [countryFilter, setCountryFilter] = useState<string>('all');
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const { data: students, isLoading: studentsLoading } = useCollection<Student>('students');

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

      return matchesSearch && matchesCountry;
    }).sort((a, b) => new Date(b.application.updatedAt).getTime() - new Date(a.application.updatedAt).getTime());
  }, [allFlattened, currentUser, effectiveRole, searchQuery, countryFilter]);

  // Fetch unique employee IDs for name mapping
  const employeeCivilIds = useMemo(() => {
    return [...new Set(filteredApplications.map(a => a.employeeId).filter((id): id is string => !!id))];
  }, [filteredApplications]);

  const { userMap: employeeMap } = useUserCacheByCivilId(employeeCivilIds);

  const countries: Country[] = ['UK', 'USA', 'Australia', 'New Zealand'];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-6 w-6 text-primary" />
              University Applications List
            </CardTitle>
            <CardDescription>
              {effectiveRole === 'department' 
                ? `Tracking all applications for the ${currentUser?.department} region.` 
                : 'A comprehensive log of every university application across all regions.'}
            </CardDescription>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search student or school..."
                className="pl-8"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
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
                      return (
                        <TableRow key={item.id} className="group">
                          <TableCell>
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
