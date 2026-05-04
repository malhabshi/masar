'use client';

import { useState, useMemo, useEffect } from 'react';
import { useUser } from '@/hooks/use-user';
import { useCollection } from '@/firebase/client';
import { firestore } from '@/firebase';
import { doc, getDoc } from 'firebase/firestore';
import type { GpaMajor } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { CheckCircle2, XCircle, Printer, GraduationCap, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

const TRACKS = [
  { key: 'medicine',    label: 'Medicine',    math: 0.05, eng: 0.05, cumul: 0.90, desc: '5% Math + 5% Eng + 90% Cumul' },
  { key: 'pharmacy',    label: 'Pharmacy',    math: 0.15, eng: 0.15, cumul: 0.70, desc: '15% Math + 15% Eng + 70% Cumul' },
  { key: 'engineering', label: 'Engineering', math: 0.20, eng: 0.15, cumul: 0.65, desc: '20% Math + 15% Eng + 65% Cumul' },
] as const;

export default function GpaPage() {
  const { user } = useUser();

  const [logoSrc, setLogoSrc] = useState<string | null>(null);
  const [pageTitle, setPageTitle] = useState('');
  const [isClient, setIsClient] = useState(false);

  const [gpa, setGpa] = useState('');
  const [grade10, setGrade10] = useState('');
  const [grade11, setGrade11] = useState('');
  const [grade12, setGrade12] = useState('');
  const [mathScore, setMathScore] = useState('');
  const [englishScore, setEnglishScore] = useState('');
  const [studentName, setStudentName] = useState('');
  const [studentPhone, setStudentPhone] = useState('');
  const [employeeName, setEmployeeName] = useState('');
  const [employeePhone, setEmployeePhone] = useState('');
  const [majorSearch, setMajorSearch] = useState('');

  useEffect(() => {
    setIsClient(true);
    try {
      const saved = localStorage.getItem('gpaLogo') || localStorage.getItem('customLogo');
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

  const gpaNum = parseFloat(gpa);
  const gpaPercentage = !isNaN(gpaNum) && gpa !== '' && gpaNum >= 0 && gpaNum <= 4
    ? (gpaNum + 1) * 20
    : null;

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

  const examScores = useMemo(() => {
    if (cumulative === null) return null;
    if (mathScore === '' && englishScore === '') return null;
    const math = parseFloat(mathScore);
    const eng = parseFloat(englishScore);
    const m = isNaN(math) ? 0 : Math.min(100, Math.max(0, math));
    const e = isNaN(eng) ? 0 : Math.min(100, Math.max(0, eng));
    return {
      medicine:    (m * 0.05) + (e * 0.05) + (cumulative * 0.90),
      pharmacy:    (m * 0.15) + (e * 0.15) + (cumulative * 0.70),
      engineering: (m * 0.20) + (e * 0.15) + (cumulative * 0.65),
    };
  }, [cumulative, mathScore, englishScore]);

  const filteredMajors = useMemo(() => {
    if (!majors) return [];
    const lower = majorSearch.toLowerCase();
    return lower
      ? majors.filter(m => m.name.toLowerCase().includes(lower) || m.country.toLowerCase().includes(lower))
      : majors;
  }, [majors, majorSearch]);

  const majorsByCountry = useMemo(() => {
    const groups: Record<string, GpaMajor[]> = {};
    filteredMajors.forEach(m => {
      if (!groups[m.country]) groups[m.country] = [];
      groups[m.country].push(m);
    });
    Object.values(groups).forEach(g => g.sort((a, b) => a.name.localeCompare(b.name)));
    return groups;
  }, [filteredMajors]);

  const qualifies = (required: number) => cumulative !== null && cumulative >= required;

  if (!isClient) return null;

  return (
    <>
      <style>{`
        @media print {
          aside, [data-sidebar], .print-hide { display: none !important; }
          .print-only { display: block !important; }
          main { padding: 8px !important; overflow: visible !important; }
          body { background: white !important; }
        }
        .print-only { display: none; }
      `}</style>

      <div className="max-w-3xl space-y-4 pb-8">

        {/* Header: Logo + (print-only employee info) + Title */}
        <div className="flex flex-col items-center text-center py-6 border-b mb-2">
          <div className="mb-3">
            {logoSrc ? (
              <img src={logoSrc} alt="Logo" className="h-20 w-20 object-contain" />
            ) : (
              <div className="bg-primary/10 rounded-2xl p-4 h-20 w-20 flex items-center justify-center">
                <GraduationCap className="h-10 w-10 text-primary" />
              </div>
            )}
          </div>
          {/* Print-only employee info — appears under logo, above title */}
          <div className="print-only mb-2">
            {employeeName && <p className="font-semibold text-sm">{employeeName}</p>}
            {employeePhone && <p className="text-sm text-gray-500">{employeePhone}</p>}
          </div>
          {pageTitle && <h1 className="text-2xl font-bold">{pageTitle}</h1>}
        </div>

        {/* Row 1: GPA + High School side by side */}
        <div className="grid grid-cols-2 gap-4">

          {/* GPA → Percentage */}
          <div className="border rounded-xl p-5 space-y-3 bg-card">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">GPA → Percentage</p>
            <div className="space-y-1.5">
              <Label>GPA (0.0 – 4.0)</Label>
              <Input
                type="number" min={0} max={4} step={0.01}
                placeholder="e.g. 3.50"
                value={gpa}
                onChange={e => setGpa(e.target.value)}
                className="text-lg font-mono text-center"
              />
            </div>
            <div className={cn(
              "rounded-xl py-5 text-center border transition-all",
              gpaPercentage !== null ? "bg-primary/5 border-primary/20" : "bg-muted/40 border-transparent"
            )}>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Result</p>
              <p className={cn("text-4xl font-bold font-mono tracking-tight", gpaPercentage !== null ? "text-primary" : "text-muted-foreground/30")}>
                {gpaPercentage !== null ? `${gpaPercentage.toFixed(2)}%` : '—'}
              </p>
            </div>
          </div>

          {/* High School Cumulative */}
          <div className="border rounded-xl p-5 space-y-3 bg-card">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">High School Cumulative</p>
            <div className="space-y-2">
              {[
                { label: 'Grade 10', weight: '10%', value: grade10, set: setGrade10 },
                { label: 'Grade 11', weight: '20%', value: grade11, set: setGrade11 },
                { label: 'Grade 12', weight: '70%', value: grade12, set: setGrade12 },
              ].map(({ label, weight, value, set }) => (
                <div key={label} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-16 shrink-0">{label}</span>
                  <span className="text-xs font-mono text-muted-foreground/50 w-9 shrink-0 text-right">{weight}</span>
                  <Input
                    type="number" min={0} max={100} step={0.01}
                    placeholder="0–100"
                    value={value}
                    onChange={e => set(e.target.value)}
                    className="font-mono h-8 text-sm"
                  />
                </div>
              ))}
            </div>
            <div className={cn(
              "rounded-xl py-5 text-center border transition-all",
              cumulative !== null ? "bg-primary/5 border-primary/20" : "bg-muted/40 border-transparent"
            )}>
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-1">Cumulative</p>
              <p className={cn("text-4xl font-bold font-mono tracking-tight", cumulative !== null ? "text-primary" : "text-muted-foreground/30")}>
                {cumulative !== null ? `${cumulative.toFixed(2)}%` : '—'}
              </p>
            </div>
          </div>
        </div>

        {/* Unified Exam — all 3 tracks */}
        <div className="border rounded-xl p-5 space-y-4 bg-card">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">Unified Exam Percentage</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Math Score (0–100)</Label>
              <Input
                type="number" min={0} max={100} step={0.01}
                placeholder="e.g. 85"
                value={mathScore}
                onChange={e => setMathScore(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label>English Score (0–100)</Label>
              <Input
                type="number" min={0} max={100} step={0.01}
                placeholder="e.g. 75"
                value={englishScore}
                onChange={e => setEnglishScore(e.target.value)}
                className="font-mono"
              />
            </div>
          </div>
          {cumulative === null && (
            <p className="text-xs text-amber-600">Enter high school grades above first to calculate.</p>
          )}
          <div className="grid grid-cols-3 gap-3">
            {TRACKS.map(track => {
              const score = examScores ? examScores[track.key] : null;
              return (
                <div key={track.key} className={cn(
                  "rounded-xl p-4 text-center border transition-all",
                  score !== null ? "bg-blue-50/80 border-blue-200" : "bg-muted/40 border-transparent"
                )}>
                  <p className="text-xs font-semibold mb-0.5">{track.label}</p>
                  <p className="text-[10px] text-muted-foreground/60 mb-3">{track.desc}</p>
                  <p className={cn("text-2xl font-bold font-mono tracking-tight", score !== null ? "text-blue-700" : "text-muted-foreground/30")}>
                    {score !== null ? `${score.toFixed(2)}%` : '—'}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Major Qualifications */}
        {majors && majors.length > 0 && (
          <div className="border rounded-xl p-5 space-y-4 bg-card">
            <div className="flex items-center gap-3">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest shrink-0">Major Qualifications</p>
              <div className="relative flex-1 print-hide">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search majors..."
                  value={majorSearch}
                  onChange={e => setMajorSearch(e.target.value)}
                  className="pl-8 h-8 text-sm"
                />
              </div>
            </div>
            {cumulative === null && (
              <p className="text-sm text-muted-foreground">Enter high school grades to see qualification status.</p>
            )}
            <div className="space-y-5">
              {Object.entries(majorsByCountry).map(([country, countryMajors]) => (
                <div key={country}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest shrink-0">{country}</span>
                    <div className="flex-1 border-t border-dashed" />
                    <span className="text-[10px] text-muted-foreground shrink-0">{countryMajors.length}</span>
                  </div>
                  <div className="space-y-1">
                    {countryMajors.map(m => (
                      <MajorRow key={m.id} major={m} qualified={cumulative !== null ? qualifies(m.requiredPercentage) : null} />
                    ))}
                  </div>
                </div>
              ))}
              {Object.keys(majorsByCountry).length === 0 && majorSearch && (
                <p className="text-center text-sm text-muted-foreground py-4">No majors match &ldquo;{majorSearch}&rdquo;</p>
              )}
            </div>
          </div>
        )}

        {/* Contact Information — screen only */}
        <div className="border rounded-xl p-5 space-y-4 bg-card print-hide">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">Contact Information</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Student Name <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
              <Input placeholder="Student full name" value={studentName} onChange={e => setStudentName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Student Phone <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
              <Input placeholder="+965 XXXX XXXX" value={studentPhone} onChange={e => setStudentPhone(e.target.value)} />
            </div>
          </div>
          <Separator />
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Employee Name</Label>
              <Input value={employeeName} onChange={e => setEmployeeName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Employee Phone</Label>
              <Input value={employeePhone} onChange={e => setEmployeePhone(e.target.value)} />
            </div>
          </div>
        </div>

        {/* PDF Button */}
        <div className="print-hide flex justify-end">
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
      "flex items-center justify-between px-3 py-2 rounded-lg border text-sm",
      qualified === true  && "border-green-200 bg-green-50",
      qualified === false && "border-red-100 bg-red-50/50",
      qualified === null  && "border-border bg-muted/20"
    )}>
      <div className="flex items-center gap-2">
        <span className="font-medium">{major.name}</span>
        {major.requiresUnifiedExam && (
          <Badge variant="outline" className="text-[9px] py-0 h-4 border-amber-400 text-amber-700 bg-amber-50">
            Exam
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs font-mono text-muted-foreground">{major.requiredPercentage}%</span>
        {qualified === true  && <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />}
        {qualified === false && <XCircle className="h-4 w-4 text-red-500 shrink-0" />}
        {qualified === null  && <span className="text-muted-foreground/40 w-4 text-center text-xs">—</span>}
      </div>
    </div>
  );
}
