'use client';

import { useState, useMemo, useEffect } from 'react';
import { useUser } from '@/hooks/use-user';
import { useCollection } from '@/firebase/client';
import { firestore } from '@/firebase';
import { doc, getDoc } from 'firebase/firestore';
import type { GpaMajor } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { CheckCircle2, XCircle, Printer, GraduationCap, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function GpaPage() {
  const { user } = useUser();

  const [logoSrc, setLogoSrc] = useState<string | null>(null);
  const [pageTitle, setPageTitle] = useState('');
  const [isClient, setIsClient] = useState(false);

  // Section 1: GPA
  const [gpa, setGpa] = useState('');

  // Section 2: High School
  const [grade10, setGrade10] = useState('');
  const [grade11, setGrade11] = useState('');
  const [grade12, setGrade12] = useState('');

  // Section 3: Unified Exam
  const [examTrack, setExamTrack] = useState('');
  const [mathScore, setMathScore] = useState('');
  const [englishScore, setEnglishScore] = useState('');

  // Contact info
  const [studentName, setStudentName] = useState('');
  const [studentPhone, setStudentPhone] = useState('');
  const [employeeName, setEmployeeName] = useState('');
  const [employeePhone, setEmployeePhone] = useState('');

  useEffect(() => {
    setIsClient(true);
    try {
      const saved = localStorage.getItem('customLogo');
      if (saved) setLogoSrc(saved);
    } catch {}
    getDoc(doc(firestore, 'gpa_settings', 'config'))
      .then(snap => { if (snap.exists()) setPageTitle(snap.data().pageTitle || ''); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return;
    setEmployeeName(user.name || '');
    setEmployeePhone(user.phone || '');
  }, [user?.id]);

  const { data: majors } = useCollection<GpaMajor>('gpa_majors');

  // GPA → Percentage: (gpa + 1) × 20
  const gpaNum = parseFloat(gpa);
  const gpaPercentage = !isNaN(gpaNum) && gpa !== '' && gpaNum >= 0 && gpaNum <= 4
    ? (gpaNum + 1) * 20
    : null;

  // High School Cumulative: G10×10% + G11×20% + G12×70%
  const cumulative = useMemo(() => {
    const g10 = parseFloat(grade10);
    const g11 = parseFloat(grade11);
    const g12 = parseFloat(grade12);
    if (grade10 === '' && grade11 === '' && grade12 === '') return null;
    const v10 = isNaN(g10) ? 0 : Math.min(100, Math.max(0, g10));
    const v11 = isNaN(g11) ? 0 : Math.min(100, Math.max(0, g11));
    const v12 = isNaN(g12) ? 0 : Math.min(100, Math.max(0, g12));
    return (v10 * 0.10) + (v11 * 0.20) + (v12 * 0.70);
  }, [grade10, grade11, grade12]);

  // Unified Exam Score
  const unifiedScore = useMemo(() => {
    if (!examTrack || cumulative === null) return null;
    const math = parseFloat(mathScore);
    const eng = parseFloat(englishScore);
    if (isNaN(math) && isNaN(eng)) return null;
    const m = isNaN(math) ? 0 : Math.min(100, Math.max(0, math));
    const e = isNaN(eng) ? 0 : Math.min(100, Math.max(0, eng));
    switch (examTrack) {
      case 'medicine':    return (m * 0.05) + (e * 0.05) + (cumulative * 0.90);
      case 'pharmacy':    return (m * 0.15) + (e * 0.15) + (cumulative * 0.70);
      case 'engineering': return (m * 0.20) + (e * 0.15) + (cumulative * 0.65);
      default: return null;
    }
  }, [examTrack, mathScore, englishScore, cumulative]);

  const noExamMajors = useMemo(
    () => [...(majors || [])].filter(m => !m.requiresUnifiedExam).sort((a, b) => a.name.localeCompare(b.name)),
    [majors]
  );
  const examMajors = useMemo(
    () => [...(majors || [])].filter(m => m.requiresUnifiedExam).sort((a, b) => a.name.localeCompare(b.name)),
    [majors]
  );

  const qualifies = (required: number) => cumulative !== null && cumulative >= required;

  if (!isClient) return null;

  return (
    <>
      <style>{`
        @media print {
          aside, [data-sidebar], .print-hide { display: none !important; }
          main { padding: 8px !important; overflow: visible !important; }
          body { background: white !important; }
        }
      `}</style>

      <div className="max-w-3xl space-y-6">
        {/* Logo + Title */}
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <div className="bg-primary/10 p-4 rounded-2xl flex items-center justify-center h-20 w-20">
            {logoSrc ? (
              <img src={logoSrc} alt="Company Logo" className="h-14 w-14 object-contain" />
            ) : (
              <GraduationCap className="h-10 w-10 text-primary" />
            )}
          </div>
          {pageTitle && <h1 className="text-2xl font-bold">{pageTitle}</h1>}
        </div>

        {/* Section 1: GPA to Percentage */}
        <Card>
          <CardHeader><CardTitle>GPA to Percentage</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-end gap-4">
              <div className="flex-1 space-y-2">
                <Label>GPA (0.0 – 4.0)</Label>
                <Input
                  type="number" min={0} max={4} step={0.01}
                  placeholder="e.g. 3.50"
                  value={gpa}
                  onChange={e => setGpa(e.target.value)}
                />
              </div>
              <div className="text-2xl pb-2 text-muted-foreground font-light">=</div>
              <div className="flex-1 space-y-2">
                <Label>Percentage</Label>
                <div className={cn(
                  "h-10 px-3 rounded-md border flex items-center font-bold text-lg",
                  gpaPercentage !== null
                    ? "text-primary border-primary bg-primary/5"
                    : "text-muted-foreground bg-muted border-muted-foreground/20"
                )}>
                  {gpaPercentage !== null ? `${gpaPercentage.toFixed(2)}%` : '—'}
                </div>
              </div>
            </div>
            {gpaPercentage !== null && (
              <p className="text-xs text-muted-foreground">
                Formula: (GPA + 1) × 20 = ({gpaNum} + 1) × 20 = {gpaPercentage.toFixed(2)}%
              </p>
            )}
          </CardContent>
        </Card>

        {/* Section 2: High School Cumulative */}
        <Card>
          <CardHeader><CardTitle>High School Cumulative Percentage</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              {[
                { label: 'Grade 10', weight: '10%', value: grade10, set: setGrade10 },
                { label: 'Grade 11', weight: '20%', value: grade11, set: setGrade11 },
                { label: 'Grade 12', weight: '70%', value: grade12, set: setGrade12 },
              ].map(({ label, weight, value, set }) => (
                <div key={label} className="space-y-2">
                  <Label>
                    {label}{' '}
                    <span className="text-muted-foreground font-normal text-xs">({weight})</span>
                  </Label>
                  <Input
                    type="number" min={0} max={100} step={0.01}
                    placeholder="0–100"
                    value={value}
                    onChange={e => set(e.target.value)}
                  />
                </div>
              ))}
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="font-medium">Total Cumulative Percentage</span>
              <span className={cn(
                "text-2xl font-bold",
                cumulative !== null ? "text-primary" : "text-muted-foreground"
              )}>
                {cumulative !== null ? `${cumulative.toFixed(2)}%` : '—'}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Section 3: Unified Exam Percentage */}
        <Card>
          <CardHeader><CardTitle>Unified Exam Percentage</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Major Track</Label>
              <Select value={examTrack} onValueChange={setExamTrack}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a track to calculate..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="medicine">Medicine — 5% Math + 5% English + 90% Cumulative</SelectItem>
                  <SelectItem value="pharmacy">Pharmacy — 15% Math + 15% English + 70% Cumulative</SelectItem>
                  <SelectItem value="engineering">Engineering — 20% Math + 15% English + 65% Cumulative</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Math Score (0–100)</Label>
                <Input
                  type="number" min={0} max={100} step={0.01}
                  placeholder="e.g. 85"
                  value={mathScore}
                  onChange={e => setMathScore(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>English Score (0–100)</Label>
                <Input
                  type="number" min={0} max={100} step={0.01}
                  placeholder="e.g. 75"
                  value={englishScore}
                  onChange={e => setEnglishScore(e.target.value)}
                />
              </div>
            </div>
            {cumulative === null && (
              <p className="text-xs text-amber-600 flex items-center gap-1.5">
                <AlertCircle className="h-3 w-3 shrink-0" />
                Enter high school grades above first to calculate the cumulative percentage.
              </p>
            )}
            <Separator />
            <div className="flex items-center justify-between">
              <span className="font-medium">Unified Exam Score</span>
              <span className={cn(
                "text-2xl font-bold",
                unifiedScore !== null ? "text-primary" : "text-muted-foreground"
              )}>
                {unifiedScore !== null ? `${unifiedScore.toFixed(2)}%` : '—'}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Section 4: Major Qualifications */}
        {majors && majors.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Major Qualifications</CardTitle>
              {cumulative === null && (
                <p className="text-sm text-muted-foreground">Enter high school grades above to see your qualification status.</p>
              )}
            </CardHeader>
            <CardContent className="space-y-6">
              {noExamMajors.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                    Without Unified Exam
                  </p>
                  <div className="space-y-2">
                    {noExamMajors.map(m => (
                      <MajorRow key={m.id} major={m} qualified={cumulative !== null ? qualifies(m.requiredPercentage) : null} />
                    ))}
                  </div>
                </div>
              )}
              {examMajors.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Requires Unified Exam
                    </p>
                    <Badge variant="outline" className="text-xs border-amber-500 text-amber-700 bg-amber-50">
                      Unified Exam Required
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    {examMajors.map(m => (
                      <MajorRow key={m.id} major={m} qualified={cumulative !== null ? qualifies(m.requiredPercentage) : null} />
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Contact Information */}
        <Card>
          <CardHeader><CardTitle>Contact Information</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>
                  Student Name{' '}
                  <span className="text-muted-foreground font-normal text-xs">(optional)</span>
                </Label>
                <Input
                  placeholder="Student full name"
                  value={studentName}
                  onChange={e => setStudentName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>
                  Student Phone{' '}
                  <span className="text-muted-foreground font-normal text-xs">(optional)</span>
                </Label>
                <Input
                  placeholder="e.g. +965 1234 5678"
                  value={studentPhone}
                  onChange={e => setStudentPhone(e.target.value)}
                />
              </div>
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Employee Name</Label>
                <Input value={employeeName} onChange={e => setEmployeeName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Employee Phone</Label>
                <Input value={employeePhone} onChange={e => setEmployeePhone(e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* PDF Button */}
        <div className="print-hide flex justify-end pb-6">
          <Button onClick={() => window.print()} className="gap-2">
            <Printer className="h-4 w-4" />
            Download as PDF
          </Button>
        </div>
      </div>
    </>
  );
}

function MajorRow({ major, qualified }: { major: GpaMajor; qualified: boolean | null }) {
  return (
    <div className={cn(
      "flex items-center justify-between px-4 py-2.5 rounded-lg border",
      qualified === true  && "border-green-200 bg-green-50",
      qualified === false && "border-red-100 bg-red-50/60",
      qualified === null  && "border-border bg-muted/30"
    )}>
      <div className="flex items-center gap-2">
        <span className="font-medium">{major.name}</span>
        <span className="text-xs text-muted-foreground">{major.country}</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">Required: {major.requiredPercentage}%</span>
        {qualified === true  && <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />}
        {qualified === false && <XCircle className="h-5 w-5 text-red-500 shrink-0" />}
        {qualified === null  && <span className="text-xs text-muted-foreground w-5 text-center">—</span>}
      </div>
    </div>
  );
}
