'use client';

import { useState, useMemo, useEffect } from 'react';
import { useUser } from '@/hooks/use-user';
import { useCollection } from '@/firebase/client';
import { firestore } from '@/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import type { GpaMajor } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { CheckCircle2, Printer, GraduationCap, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

const TRACKS = [
  { key: 'medicine',    label: 'Medicine',    math: 0.05, eng: 0.05, cumul: 0.90, desc: '5% + 5% + 90%' },
  { key: 'pharmacy',    label: 'Pharmacy',    math: 0.15, eng: 0.15, cumul: 0.70, desc: '15% + 15% + 70%' },
  { key: 'engineering', label: 'Engineering', math: 0.20, eng: 0.15, cumul: 0.65, desc: '20% + 15% + 65%' },
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
  const [companyInstagram, setCompanyInstagram] = useState('');
  const [companyTiktok, setCompanyTiktok] = useState('');
  const [companyEmail, setCompanyEmail] = useState('');

  const [labelGpa, setLabelGpa] = useState('GPA → Percentage');
  const [labelHighSchool, setLabelHighSchool] = useState('High School Cumulative');
  const [labelUnifiedExam, setLabelUnifiedExam] = useState('Unified Exam Percentage');
  const [labelQualifiedMajors, setLabelQualifiedMajors] = useState('Qualified Majors');
  const [selectedCountries, setSelectedCountries] = useState<Set<string>>(
    () => new Set(['UK', 'USA', 'Australia', 'New Zealand'])
  );

  useEffect(() => {
    setIsClient(true);
    try {
      const saved = localStorage.getItem('gpaLogo') || localStorage.getItem('customLogo');
      if (saved) setLogoSrc(saved);
    } catch {}
    getDoc(doc(firestore, 'gpa_settings', 'config'))
      .then(snap => {
        if (snap.exists()) {
          const d = snap.data();
          setPageTitle(d.pageTitle || '');
          setCompanyInstagram(d.instagram || '');
          setCompanyTiktok(d.tiktok || '');
          setCompanyEmail(d.email || '');
          setLabelGpa(d.labelGpa || 'GPA → Percentage');
          setLabelHighSchool(d.labelHighSchool || 'High School Cumulative');
          setLabelUnifiedExam(d.labelUnifiedExam || 'Unified Exam Percentage');
          setLabelQualifiedMajors(d.labelQualifiedMajors || 'Qualified Majors');
        }
      })
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
    const pool = lower
      ? majors.filter(m => m.name.toLowerCase().includes(lower) || m.country.toLowerCase().includes(lower))
      : majors;
    return cumulative !== null ? pool.filter(m => cumulative >= m.requiredPercentage) : pool;
  }, [majors, majorSearch, cumulative]);

  const majorsByCountry = useMemo(() => {
    const groups: Record<string, GpaMajor[]> = {};
    filteredMajors.forEach(m => {
      if (!groups[m.country]) groups[m.country] = [];
      groups[m.country].push(m);
    });
    Object.values(groups).forEach(g => g.sort((a, b) => {
      if (a.requiresUnifiedExam !== b.requiresUnifiedExam) return a.requiresUnifiedExam ? -1 : 1;
      return a.name.localeCompare(b.name);
    }));
    return groups;
  }, [filteredMajors]);

  const canEditLabels = user?.role === 'admin' || user?.role === 'adminplus';

  const saveLabel = async (key: string, value: string) => {
    if (!canEditLabels) return;
    try {
      await setDoc(doc(firestore, 'gpa_settings', 'config'), { [key]: value }, { merge: true });
    } catch {}
  };

  if (!isClient) return null;

  return (
    <>
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 8mm 10mm; }
          aside, [data-sidebar], .screen-only { display: none !important; }
          .print-only { display: flex !important; flex-direction: column !important; min-height: 100vh; }
          main { padding: 0 !important; overflow: visible !important; }
          body { background: white !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
        .print-only { display: none; }
      `}</style>

      {/* ═══ PDF / PRINT LAYOUT (full A4 page) ═══ */}
      <div className="print-only" style={{ fontFamily: "'Segoe UI', system-ui, -apple-system, sans-serif", color: '#111827', width: '100%', background: 'white' }}>

        {/* HEADER */}
        <div style={{ padding: '18px 0 14px', textAlign: 'center', borderBottom: '2px solid #f3f4f6' }}>
          {logoSrc ? (
            <img src={logoSrc} alt="Logo" style={{ height: 80, width: 80, objectFit: 'contain', display: 'block', margin: '0 auto 10px' }} />
          ) : (
            <div style={{ height: 80, width: 80, background: '#f5f3ff', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 10px', border: '1.5px solid #e0e7ff' }}>
              <GraduationCap style={{ height: 40, width: 40, color: '#6366f1' }} />
            </div>
          )}
          {pageTitle && (
            <div style={{ fontSize: 20, fontWeight: 800, color: '#111827', textAlign: 'center', letterSpacing: '-0.3px', lineHeight: 1.2 }}>
              {pageTitle}
            </div>
          )}
          <div style={{ fontSize: 8.5, color: '#9ca3af', marginTop: 5 }}>
            {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
          {(studentName || studentPhone) && (
            <div style={{ fontSize: 10, color: '#6b7280', marginTop: 4, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
              {studentName && <span style={{ fontWeight: 600, color: '#374151' }}>{studentName}</span>}
              {studentName && studentPhone && <span style={{ color: '#e5e7eb' }}>|</span>}
              {studentPhone && <span>{studentPhone}</span>}
            </div>
          )}
        </div>

        {/* BODY */}
        <div style={{ flex: 1, padding: '10px 0 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>

          {/* Row 1: GPA + High School — compact */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>

            {/* GPA */}
            <div style={{ border: '1.5px solid #e5e7eb', borderRadius: 10, padding: '7px 10px', background: '#fafafa', display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 7, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 1.2, color: '#6366f1', marginBottom: 4 }}>{labelGpa}</div>
              <div style={{ fontSize: 8.5, color: '#6b7280', marginBottom: 3 }}>
                GPA Score: <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: '#111827' }}>{gpa || '—'}</span>
              </div>
              <div style={{ fontSize: 7, color: '#c7d2fe', marginBottom: 6 }}>Formula: (GPA + 1) × 20</div>
              <div style={{ background: gpaPercentage !== null ? '#eef2ff' : '#f5f5f5', border: `1.5px solid ${gpaPercentage !== null ? '#c7d2fe' : '#e5e7eb'}`, borderRadius: 8, padding: '7px 8px', textAlign: 'center' as const, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ fontSize: 6.5, color: '#9ca3af', textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 3 }}>Result</div>
                <div style={{ fontSize: 24, fontWeight: 900, fontFamily: 'monospace', color: gpaPercentage !== null ? '#4f46e5' : '#d1d5db', lineHeight: 1 }}>
                  {gpaPercentage !== null ? `${gpaPercentage.toFixed(2)}%` : '—'}
                </div>
              </div>
            </div>

            {/* High School */}
            <div style={{ border: '1.5px solid #e5e7eb', borderRadius: 10, padding: '7px 10px', background: '#fafafa', display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 7, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 1.2, color: '#6366f1', marginBottom: 4 }}>{labelHighSchool}</div>
              <div style={{ fontSize: 7, color: '#c7d2fe', marginBottom: 4 }}>Formula: (G10 × 10%) + (G11 × 20%) + (G12 × 70%)</div>
              {[{ label: 'Grade 10', w: '10%', val: grade10 }, { label: 'Grade 11', w: '20%', val: grade11 }, { label: 'Grade 12', w: '70%', val: grade12 }].map(({ label, w, val }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3, padding: '3px 8px', background: '#f3f4f6', borderRadius: 6, fontSize: 8.5 }}>
                  <span style={{ color: '#6b7280' }}>{label} <span style={{ color: '#d1d5db', fontSize: 7 }}>({w})</span></span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 11, color: val ? '#111827' : '#d1d5db' }}>{val || '—'}</span>
                </div>
              ))}
              <div style={{ background: cumulative !== null ? '#eef2ff' : '#f5f5f5', border: `1.5px solid ${cumulative !== null ? '#c7d2fe' : '#e5e7eb'}`, borderRadius: 8, padding: '7px 8px', textAlign: 'center' as const, marginTop: 3, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ fontSize: 6.5, color: '#9ca3af', textTransform: 'uppercase' as const, letterSpacing: 1, marginBottom: 3 }}>Cumulative</div>
                <div style={{ fontSize: 24, fontWeight: 900, fontFamily: 'monospace', color: cumulative !== null ? '#4f46e5' : '#d1d5db', lineHeight: 1 }}>
                  {cumulative !== null ? `${cumulative.toFixed(2)}%` : '—'}
                </div>
              </div>
            </div>
          </div>

          {/* Row 2: Unified Exam — compact */}
          <div style={{ border: '1.5px solid #e5e7eb', borderRadius: 10, padding: '10px 12px', background: '#fafafa' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div style={{ fontSize: 7.5, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 1.2, color: '#6366f1' }}>{labelUnifiedExam}</div>
              {(mathScore || englishScore) && (
                <div style={{ fontSize: 8, color: '#9ca3af' }}>
                  Math: <strong style={{ color: '#374151' }}>{mathScore || 0}</strong> · English: <strong style={{ color: '#374151' }}>{englishScore || 0}</strong>
                </div>
              )}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {TRACKS.map(track => {
                const score = examScores ? examScores[track.key] : null;
                return (
                  <div key={track.key} style={{ background: score !== null ? '#eff6ff' : '#f5f5f5', border: `1.5px solid ${score !== null ? '#bfdbfe' : '#e5e7eb'}`, borderRadius: 8, padding: '10px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' as const }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#1e40af', marginBottom: 10 }}>{track.label}</div>
                    <div style={{ fontSize: 26, fontWeight: 900, fontFamily: 'monospace', color: score !== null ? '#1d4ed8' : '#d1d5db', lineHeight: 1 }}>
                      {score !== null ? `${score.toFixed(2)}%` : '—'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Row 3: Qualified Majors only */}
          {Object.keys(majorsByCountry).length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, paddingBottom: 6, borderBottom: '1.5px solid #e5e7eb' }}>
                <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 1.2, color: '#374151' }}>{labelQualifiedMajors}</div>
                {cumulative !== null && (
                  <div style={{ fontSize: 8, color: '#9ca3af' }}>
                    Cumulative: <strong style={{ color: '#4f46e5' }}>{cumulative.toFixed(2)}%</strong>
                  </div>
                )}
              </div>
              <div style={{ columnCount: 4, columnGap: 10 }}>
                {Object.entries(majorsByCountry).filter(([c]) => selectedCountries.has(c)).map(([country, countryMajors]) => (
                  <div key={country} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 7.5, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: 1, color: '#4f46e5', background: '#eef2ff', padding: '4px 8px', borderRadius: 5, marginBottom: 4 }}>
                      {country}
                    </div>
                    {countryMajors.map(m => (
                      <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 7px', marginBottom: 2.5, background: '#f0fdf4', borderRadius: 5, border: '1px solid #bbf7d0', breakInside: 'avoid' as const }}>
                        <span style={{ fontSize: 8, fontWeight: 600, color: '#15803d' }}>
                          {m.name}
                          {m.requiresUnifiedExam && <span style={{ fontSize: 6.5, color: '#d97706', marginLeft: 3, fontWeight: 700 }}>EXAM</span>}
                        </span>
                        <span style={{ fontSize: 7.5, fontFamily: 'monospace', color: '#6b7280', marginLeft: 4, flexShrink: 0 }}>{m.requiredPercentage}%</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* FOOTER */}
        <div style={{ borderTop: '2px solid #4f46e5', paddingTop: 11, marginTop: 'auto', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: 7, color: '#9ca3af', textTransform: 'uppercase' as const, letterSpacing: 0.8, marginBottom: 2 }}>Prepared by</div>
            <div style={{ fontWeight: 700, fontSize: 11, color: '#111827' }}>{employeeName || '—'}</div>
            {employeePhone && <div style={{ fontSize: 8.5, color: '#6b7280', marginTop: 1.5 }}>{employeePhone}</div>}
          </div>
          {(companyInstagram || companyTiktok || companyEmail) && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3.5 }}>
              {companyInstagram && (
                <div style={{ fontSize: 9, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontWeight: 800, color: '#e1306c', fontSize: 7.5, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>Instagram</span>
                  <span>@{companyInstagram}</span>
                </div>
              )}
              {companyTiktok && (
                <div style={{ fontSize: 9, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontWeight: 800, color: '#374151', fontSize: 7.5, textTransform: 'uppercase' as const, letterSpacing: 0.5 }}>TikTok</span>
                  <span>@{companyTiktok}</span>
                </div>
              )}
              {companyEmail && (
                <div style={{ fontSize: 9, color: '#6b7280' }}>{companyEmail}</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ═══ SCREEN LAYOUT ═══ */}
      <div className="screen-only max-w-3xl space-y-4 pb-8">

        {/* Header */}
        <div className="flex flex-col items-center text-center py-6 border-b mb-2">
          <div className="mb-3">
            {logoSrc ? (
              <img src={logoSrc} alt="Logo" className="h-36 w-36 object-contain" />
            ) : (
              <div className="bg-primary/10 rounded-2xl p-6 h-36 w-36 flex items-center justify-center">
                <GraduationCap className="h-16 w-16 text-primary" />
              </div>
            )}
          </div>
          {pageTitle && <h1 className="text-2xl font-bold">{pageTitle}</h1>}
        </div>

        {/* GPA + High School */}
        <div className="grid grid-cols-2 gap-4">
          <div className="border rounded-xl p-5 space-y-3 bg-card">
            {canEditLabels ? (
              <input value={labelGpa} onChange={e => setLabelGpa(e.target.value)} onBlur={() => saveLabel('labelGpa', labelGpa)} className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest bg-transparent border-b border-dashed border-muted-foreground/20 hover:border-muted-foreground/50 focus:border-primary outline-none w-full" />
            ) : (
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">{labelGpa}</p>
            )}
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

          <div className="border rounded-xl p-5 space-y-3 bg-card">
            {canEditLabels ? (
              <input value={labelHighSchool} onChange={e => setLabelHighSchool(e.target.value)} onBlur={() => saveLabel('labelHighSchool', labelHighSchool)} className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest bg-transparent border-b border-dashed border-muted-foreground/20 hover:border-muted-foreground/50 focus:border-primary outline-none w-full" />
            ) : (
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">{labelHighSchool}</p>
            )}
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

        {/* Unified Exam */}
        <div className="border rounded-xl p-5 space-y-4 bg-card">
          {canEditLabels ? (
            <input value={labelUnifiedExam} onChange={e => setLabelUnifiedExam(e.target.value)} onBlur={() => saveLabel('labelUnifiedExam', labelUnifiedExam)} className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest bg-transparent border-b border-dashed border-muted-foreground/20 hover:border-muted-foreground/50 focus:border-primary outline-none w-full" />
          ) : (
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">{labelUnifiedExam}</p>
          )}
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
                  <p className="text-xs font-semibold mb-3">{track.label}</p>
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
              {canEditLabels ? (
                <input value={labelQualifiedMajors} onChange={e => setLabelQualifiedMajors(e.target.value)} onBlur={() => saveLabel('labelQualifiedMajors', labelQualifiedMajors)} className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest bg-transparent border-b border-dashed border-muted-foreground/20 hover:border-muted-foreground/50 focus:border-primary outline-none shrink-0" />
              ) : (
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest shrink-0">{labelQualifiedMajors}</p>
              )}
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search majors..."
                  value={majorSearch}
                  onChange={e => setMajorSearch(e.target.value)}
                  className="pl-8 h-8 text-sm"
                />
              </div>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {['UK', 'USA', 'Australia', 'New Zealand'].map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setSelectedCountries(prev => {
                    const next = new Set(prev);
                    if (next.has(c)) next.delete(c); else next.add(c);
                    return next;
                  })}
                  className={cn(
                    'text-xs px-2.5 py-0.5 rounded-full border font-medium transition-colors',
                    selectedCountries.has(c)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'border-border text-muted-foreground hover:border-primary/50'
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
            {cumulative === null ? (
              <p className="text-sm text-muted-foreground">Enter high school grades to see which majors you qualify for.</p>
            ) : filteredMajors.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                {majorSearch ? `No qualified majors match "${majorSearch}"` : 'No majors qualify at this cumulative percentage.'}
              </p>
            ) : (
              <div className="space-y-5">
                {Object.entries(majorsByCountry).filter(([c]) => selectedCountries.has(c)).map(([country, countryMajors]) => (
                  <div key={country}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest shrink-0">{country}</span>
                      <div className="flex-1 border-t border-dashed" />
                      <span className="text-[10px] text-muted-foreground shrink-0">{countryMajors.length}</span>
                    </div>
                    <div className="space-y-1">
                      {countryMajors.map(m => (
                        <div key={m.id} className="flex items-center justify-between px-3 py-2 rounded-lg border border-green-200 bg-green-50 text-sm">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{m.name}</span>
                            {m.requiresUnifiedExam && (
                              <Badge variant="outline" className="text-[9px] py-0 h-4 border-amber-400 text-amber-700 bg-amber-50">
                                Exam
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-mono text-muted-foreground">{m.requiredPercentage}%</span>
                            <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Contact Information */}
        <div className="border rounded-xl p-5 space-y-4 bg-card">
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
        <div className="flex justify-end">
          <Button onClick={() => window.print()} className="gap-2">
            <Printer className="h-4 w-4" />
            Download as PDF
          </Button>
        </div>
      </div>
    </>
  );
}
