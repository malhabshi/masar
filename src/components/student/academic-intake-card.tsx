
'use client';

import { useState } from 'react';
import type { Student } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { updateStudentAcademicIntake } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';

// UI Components
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar, Loader2, FilePenLine, CheckCircle, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface AcademicIntakeCardProps {
  student: Student;
  currentUser: AppUser;
}

const semesters = [
  'FALL (8/9)',
  'SPRING (1/2)',
  'MARCH (3)',
  'SUMMER (6/7)'
];

const years = [2026, 2027, 2028, 2029, 2030];

export function AcademicIntakeCard({ student, currentUser }: AcademicIntakeCardProps) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [tempSemester, setTempSemester] = useState<string>(student.academicIntakeSemester || '');
  const [tempYear, setTempYear] = useState<string>(student.academicIntakeYear?.toString() || '');

  const isAdminOrDept = ['admin', 'department'].includes(currentUser.role);

  if (!isAdminOrDept) return null;

  const handleSave = async () => {
    if (!tempSemester || !tempYear) {
      toast({ variant: 'destructive', title: 'Error', description: 'Please select both semester and year.' });
      return;
    }

    setIsLoading(true);
    const result = await updateStudentAcademicIntake(student.id, tempSemester, parseInt(tempYear), currentUser.id);

    if (result.success) {
      toast({ title: 'Success', description: result.message });
      setIsEditing(false);
    } else {
      toast({ variant: 'destructive', title: 'Update Failed', description: result.message });
    }
    setIsLoading(false);
  };

  const handleCancel = () => {
    setTempSemester(student.academicIntakeSemester || '');
    setTempYear(student.academicIntakeYear?.toString() || '');
    setIsEditing(false);
  };

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="flex flex-row items-center justify-between py-4">
        <div className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Academic Intake</CardTitle>
          <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-[10px] h-5">
            Admin/Dept Only
          </Badge>
        </div>
        {!isEditing && (
          <Button variant="ghost" size="sm" onClick={() => setIsEditing(true)}>
            <FilePenLine className="h-4 w-4 mr-2" />
            {student.academicIntakeSemester ? 'Edit' : 'Add Intake'}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {!isEditing ? (
          <div className="flex items-center gap-3">
            {student.academicIntakeSemester ? (
              <div className="flex items-center gap-2 bg-background border px-4 py-2 rounded-full shadow-sm">
                <span className="font-bold text-primary">{student.academicIntakeSemester}</span>
                <span className="font-mono text-muted-foreground">{student.academicIntakeYear}</span>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">No academic intake set for this student.</p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase">Semester</label>
              <Select value={tempSemester} onValueChange={setTempSemester}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Semester" />
                </SelectTrigger>
                <SelectContent>
                  {semesters.map(s => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-muted-foreground uppercase">Year</label>
              <Select value={tempYear} onValueChange={setTempYear}>
                <SelectTrigger>
                  <SelectValue placeholder="Select Year" />
                </SelectTrigger>
                <SelectContent>
                  {years.map(y => (
                    <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}
      </CardContent>
      {isEditing && (
        <CardFooter className="flex justify-end gap-2 border-t pt-4">
          <Button variant="outline" size="sm" onClick={handleCancel} disabled={isLoading}>
            <XCircle className="h-4 w-4 mr-2" />
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
            Save Intake
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
