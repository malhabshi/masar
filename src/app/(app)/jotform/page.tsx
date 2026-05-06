'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Send, CheckCircle2, RotateCcw, Paperclip, X } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';

const ACCEPTANCE_OPTIONS = ['Foundation', 'First Year', 'General English', 'ESL', 'ESL + Foundation', 'Masters'];
import { cn } from '@/lib/utils';
import { submitJotformApplications } from '@/lib/actions';
import { useUser } from '@/hooks/use-user';
import { useCollection } from '@/firebase';
import type { ApprovedUniversity, Application } from '@/lib/types';

const STAFF_NAMES = [
  'طلال', 'محمد سليمان', 'خالد الشمري', 'يوسف سليمان', 'عبدالرحمن العنزي',
  'طلال العنزي', 'زينب دشتي', 'دنيا', 'عايشه', 'مريم العنزي',
  'حنان الكندري', 'فاطمه الشمري', 'خالد الهدهود',
];

const SCHOLARSHIP_OPTIONS = [
  'MOHE - التعليم العالي', 'خطة الايفاد', 'بعثه متميزه',
  'طلبة الثانويه العامه', 'PAEET - التطبيقي', 'Self Funded - حساب الخاص',
];

const COUNTRIES = ['UK', 'Australia / New Zealand', 'USA'];

const USA_SEMESTER_OPTIONS = ['Spring 2026 / 1', 'Summer 2026 / 6', 'Fall 2026/9'];

interface DocField {
  key: string;
  label: string;
  labelAr: string;
}

const DOC_FIELDS: DocField[] = [
  { key: 'passport',           label: 'Passport Photo *',                  labelAr: 'صورة الجواز' },
  { key: 'secondaryCerts',     label: 'Secondary Certificates (English) *', labelAr: 'صورة شهادات الثانوية' },
  { key: 'ieltsFile',          label: 'IELTS Test File',                   labelAr: 'اختبار الأيلتس' },
  { key: 'universityDegree',   label: 'University Degree / Diploma',       labelAr: 'الشهادة الجامعية أو الدبلوم' },
  { key: 'recommendationLetter', label: 'Recommendation Letter',           labelAr: 'رسالة تزكية' },
  { key: 'personalStatement',  label: 'Personal Statement',                labelAr: 'Personal Statement' },
  { key: 'otherFiles',         label: 'Other Files',                       labelAr: 'ملفات أخرى' },
];

const emptyFiles = (): Record<string, File[]> =>
  Object.fromEntries(DOC_FIELDS.map(f => [f.key, []]));

interface CountryPick {
  majorSearch: string;
  showSugs: boolean;
  addedMajors: string[];
  selectedUniNamesByMajor: Record<string, string[]>;
  uniExtra: string;
}
const emptyPick = (): CountryPick => ({ majorSearch: '', showSugs: false, addedMajors: [], selectedUniNamesByMajor: {}, uniExtra: '' });

const COUNTRY_KEY_LABEL: Record<string, string> = { UK: 'UK', AUNZ: 'AU / NZ', USA: 'USA' };

export default function JotformPage() {
  const { toast } = useToast();
  const { user } = useUser();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedTo, setSubmittedTo] = useState<string[] | null>(null);

  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [email, setEmail] = useState('');
  const [picks, setPicks] = useState<Record<string, CountryPick>>({});
  const [kuwaitAddress, setKuwaitAddress] = useState('');
  const [kuwaitPhone, setKuwaitPhone] = useState('');
  const [civilId, setCivilId] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [scholarshipType, setScholarshipType] = useState('');
  const [acceptanceType, setAcceptanceType] = useState('');
  const [ieltsScore, setIeltsScore] = useState('');
  const [followUpPerson, setFollowUpPerson] = useState('');
  const [guardianName, setGuardianName] = useState('');
  const [guardianEmail, setGuardianEmail] = useState('');
  const [guardianPhone, setGuardianPhone] = useState('');
  const [guardianDob, setGuardianDob] = useState('');
  const [semester, setSemester] = useState('');
  const [files, setFiles] = useState<Record<string, File[]>>(emptyFiles());

  // Default follow-up person to the logged-in user if their name is in the staff list
  useEffect(() => {
    if (user?.name && STAFF_NAMES.includes(user.name)) {
      setFollowUpPerson(user.name);
    }
  }, [user?.name]);

  const { data: allApprovedUnis } = useCollection<ApprovedUniversity>('approved_universities');

  // Per-country approved university lists (UK only when Foundation)
  const unisByCountry = useMemo((): Record<string, ApprovedUniversity[]> => {
    if (!allApprovedUnis) return {};
    const result: Record<string, ApprovedUniversity[]> = {};
    if (selectedCountries.includes('UK')) {
      result['UK'] = acceptanceType === 'Foundation'
        ? allApprovedUnis.filter(u => {
            if (!u.isAvailable || u.country !== 'UK') return false;
            if (u.entryLevels && u.entryLevels.length > 0 && !u.entryLevels.includes('Foundation')) return false;
            return true;
          })
        : [];
    }
    if (selectedCountries.includes('Australia / New Zealand')) {
      result['AUNZ'] = allApprovedUnis.filter(u => u.isAvailable && (u.country === 'Australia' || u.country === 'New Zealand'));
    }
    if (selectedCountries.includes('USA')) {
      result['USA'] = allApprovedUnis.filter(u => u.isAvailable && u.country === 'USA');
    }
    return result;
  }, [allApprovedUnis, selectedCountries, acceptanceType]);

  // Ordered country keys matching selected countries order
  const allCountryKeys = useMemo(() =>
    selectedCountries.map(c => c === 'Australia / New Zealand' ? 'AUNZ' : c === 'UK' ? 'UK' : 'USA'),
  [selectedCountries]);

  const getPick = (key: string): CountryPick => picks[key] || emptyPick();

  const updPick = (key: string, update: Partial<CountryPick> | ((prev: CountryPick) => Partial<CountryPick>)) => {
    setPicks(prev => {
      const current = prev[key] || emptyPick();
      const changes = typeof update === 'function' ? update(current) : update;
      return { ...prev, [key]: { ...current, ...changes } };
    });
  };

  const getFinalPick = (key: string) => {
    const pick = getPick(key);
    const BU = 'Best University';
    let bestUniUsed = false;
    const uniParts: string[] = [];
    for (const major of pick.addedMajors) {
      const selected = pick.selectedUniNamesByMajor[major] || [];
      for (const uni of selected) {
        if (uni.toLowerCase().trim() === BU.toLowerCase()) { bestUniUsed = true; }
        else { uniParts.push(`${uni} (${major})`); }
      }
    }
    const extras = pick.uniExtra.split(',').map(s => s.trim()).filter(Boolean);
    return {
      universities: [...(bestUniUsed ? [BU] : []), ...uniParts, ...extras].join(', '),
      major: pick.addedMajors.join(', '),
    };
  };

  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const isUK = selectedCountries.includes('UK');
  const isUSA = selectedCountries.includes('USA');
  const isUKorAUNZ = selectedCountries.includes('UK') || selectedCountries.includes('Australia / New Zealand');

  const toggleCountry = (c: string) =>
    setSelectedCountries(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);

  const handleFileChange = (key: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (!picked.length) return;
    setFiles(prev => ({ ...prev, [key]: [...prev[key], ...picked] }));
    // Reset input so the same file can be re-added after removal if needed
    if (fileRefs.current[key]) fileRefs.current[key]!.value = '';
  };

  const removeFile = (key: string, index: number) => {
    setFiles(prev => ({ ...prev, [key]: prev[key].filter((_, i) => i !== index) }));
  };

  const handleReset = () => {
    setSubmittedTo(null);
    setSelectedCountries([]);
    setFirstName(''); setLastName(''); setDob(''); setEmail('');
    setPicks({}); setKuwaitAddress(''); setKuwaitPhone('');
    setCivilId(''); setSchoolName(''); setScholarshipType(''); setAcceptanceType('');
    setIeltsScore(''); setFollowUpPerson(''); setGuardianName('');
    setGuardianEmail(''); setGuardianPhone(''); setGuardianDob(''); setSemester('');
    setFiles(emptyFiles());
    Object.values(fileRefs.current).forEach(input => { if (input) input.value = ''; });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedCountries.length === 0) {
      toast({ variant: 'destructive', title: 'Select at least one country' });
      return;
    }
    if (isUKorAUNZ && !scholarshipType) {
      toast({ variant: 'destructive', title: 'Scholarship Type is required' });
      return;
    }
    if (isUKorAUNZ && !acceptanceType) {
      toast({ variant: 'destructive', title: 'Application Type is required' });
      return;
    }
    if (isUSA && !semester) {
      toast({ variant: 'destructive', title: 'Academic Semester is required for USA' });
      return;
    }
    if (isUSA && !guardianDob) {
      toast({ variant: 'destructive', title: "Guardian's Date of Birth is required for USA" });
      return;
    }
    if (!followUpPerson) {
      toast({ variant: 'destructive', title: 'Follow-up Person is required' });
      return;
    }
    if (!guardianName) {
      toast({ variant: 'destructive', title: "Guardian's Name is required" });
      return;
    }
    if (!guardianEmail) {
      toast({ variant: 'destructive', title: "Guardian's Email is required" });
      return;
    }
    if (!guardianPhone) {
      toast({ variant: 'destructive', title: "Guardian's Phone is required" });
      return;
    }
    if (kuwaitPhone.replace(/\D/g, '').length !== 8) {
      toast({ variant: 'destructive', title: 'Kuwaiti Phone must be 8 digits' });
      return;
    }
    if (isUKorAUNZ && civilId.replace(/\D/g, '').length !== 12) {
      toast({ variant: 'destructive', title: 'Civil ID must be 12 digits' });
      return;
    }
    if (guardianPhone.replace(/\D/g, '').length !== 8) {
      toast({ variant: 'destructive', title: "Guardian's Phone must be 8 digits" });
      return;
    }
    if (files['passport'].length === 0) {
      toast({ variant: 'destructive', title: 'Passport Photo is required' });
      return;
    }
    if (files['secondaryCerts'].length === 0) {
      toast({ variant: 'destructive', title: 'Secondary Certificates are required' });
      return;
    }

    setIsSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('selectedCountries', JSON.stringify(selectedCountries));
      fd.append('firstName', firstName);
      fd.append('lastName', lastName);
      fd.append('dob', dob);
      fd.append('email', email);
      const ukFinal = getFinalPick('UK');
      const aunzFinal = getFinalPick('AUNZ');
      const usaFinal = getFinalPick('USA');
      fd.append('ukMajor', ukFinal.major);
      fd.append('ukUniversities', ukFinal.universities);
      fd.append('aunzMajor', aunzFinal.major);
      fd.append('aunzUniversities', aunzFinal.universities);
      fd.append('usaMajor', usaFinal.major);
      fd.append('usaUniversities', usaFinal.universities);
      fd.append('kuwaitAddress', kuwaitAddress);
      fd.append('kuwaitPhone', kuwaitPhone);
      fd.append('civilId', civilId);
      fd.append('schoolName', schoolName);
      fd.append('ieltsScore', ieltsScore);
      fd.append('followUpPerson', followUpPerson);
      fd.append('guardianName', guardianName);
      fd.append('guardianEmail', guardianEmail);
      fd.append('guardianPhone', guardianPhone);
      fd.append('scholarshipType', scholarshipType);
      fd.append('acceptanceType', acceptanceType);
      fd.append('semester', semester);
      fd.append('guardianDob', guardianDob);
      fd.append('creatingUserId', user?.id || '');

      // Build applications from selected majors/universities per country and pass to server
      const countryDefault: Record<string, 'UK' | 'USA' | 'Australia' | 'New Zealand'> = { UK: 'UK', USA: 'USA', AUNZ: 'Australia' };
      const builtApplications: Application[] = [];
      const nowIso = new Date().toISOString();
      for (const key of allCountryKeys) {
        const pick = getPick(key);
        const unis = unisByCountry[key] || [];
        const defaultCountry = countryDefault[key] ?? 'Australia';
        for (const major of pick.addedMajors) {
          for (const uniName of pick.selectedUniNamesByMajor[major] || []) {
            let appCountry: 'UK' | 'USA' | 'Australia' | 'New Zealand' = defaultCountry;
            if (key === 'AUNZ') {
              const dbUni = unis.find(u => u.name.toLowerCase().trim() === uniName.toLowerCase().trim());
              if (dbUni) appCountry = dbUni.country;
            }
            builtApplications.push({ university: uniName, major, country: appCountry, status: 'Pending', updatedAt: nowIso });
          }
        }
        for (const uniName of (pick.uniExtra.split(',').map(s => s.trim()).filter(Boolean))) {
          builtApplications.push({ university: uniName, major: pick.addedMajors.join(', '), country: defaultCountry, status: 'Pending', updatedAt: nowIso });
        }
      }
      const idPrefix = user?.civilId ? `U-${user.civilId}` : `S-${Math.random().toString(36).substring(2, 9)}`;
      fd.append('newStudentId', `${idPrefix}-${Date.now()}`);
      fd.append('builtApplications', JSON.stringify(builtApplications));

      // Append all files for each doc field (multiple per key)
      Object.entries(files).forEach(([key, fileList]) => {
        fileList.forEach(file => fd.append(key, file, file.name));
      });

      const { jotformResults, studentCreated } = await submitJotformApplications(fd);

      const failed = jotformResults.filter(r => !r.success).map(r => r.country);
      if (failed.length === 0) {
        setSubmittedTo(jotformResults.map(r => r.country));
        toast({
          title: 'Submitted!',
          description: `Sent to: ${jotformResults.map(r => r.country).join(', ')}${studentCreated ? ' — Student profile created.' : ''}`,
        });
      } else {
        toast({ variant: 'destructive', title: 'Partial failure', description: `Failed for: ${failed.join(', ')}` });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Something went wrong. Please try again.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submittedTo) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-5 text-center">
        <CheckCircle2 className="h-20 w-20 text-green-500" />
        <div>
          <h2 className="text-2xl font-bold">Application Submitted!</h2>
          <p className="text-muted-foreground mt-1">Successfully sent to: <strong>{submittedTo.join(', ')}</strong></p>
        </div>
        <Button onClick={handleReset} variant="outline" className="gap-2">
          <RotateCcw className="h-4 w-4" /> Submit Another Application
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl mx-auto pb-12">
      <div>
        <h1 className="text-2xl font-bold">Jotform</h1>
        <p className="text-muted-foreground text-sm mt-1">Fill once — data will be sent to all selected country forms.</p>
      </div>

      {/* Country Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Target Countries *</CardTitle>
          <CardDescription>Select all countries this student is applying to</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3 flex-wrap">
            {COUNTRIES.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => toggleCountry(c)}
                className={cn(
                  'px-6 py-2.5 rounded-lg border-2 font-semibold transition-all text-sm',
                  selectedCountries.includes(c)
                    ? 'border-primary bg-primary text-primary-foreground shadow-md'
                    : 'border-border bg-background hover:border-primary/40 text-foreground'
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {selectedCountries.length > 0 && (
        <>
          {/* Application Details */}
          <Card>
            <CardHeader>
              <CardTitle>Application Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {isUKorAUNZ && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Scholarship Type (نوع البعثه) *</Label>
                    <Select value={scholarshipType} onValueChange={setScholarshipType}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent>
                        {SCHOLARSHIP_OPTIONS.map(opt => (
                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Application Type (نوع القبول / يرجى اختيار) *</Label>
                    <Select value={acceptanceType} onValueChange={setAcceptanceType}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent>
                        {ACCEPTANCE_OPTIONS.map(opt => (
                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {isUSA && (
                <div className="space-y-2">
                  <Label>Academic Semester (الفصل الدراسي) *</Label>
                  <Select value={semester} onValueChange={setSemester}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select semester..." />
                    </SelectTrigger>
                    <SelectContent>
                      {USA_SEMESTER_OPTIONS.map(opt => (
                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>IELTS Score</Label>
                  <Input value={ieltsScore} onChange={e => setIeltsScore(e.target.value)} placeholder="e.g. 6.5" />
                </div>
                <div className="space-y-2">
                  <Label>Follow-up Person *</Label>
                  <Select value={followUpPerson} onValueChange={setFollowUpPerson}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select person" />
                    </SelectTrigger>
                    <SelectContent>
                      {STAFF_NAMES.map(name => (
                        <SelectItem key={name} value={name}>{name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Student Info */}
          <Card>
            <CardHeader>
              <CardTitle>Student Information</CardTitle>
              <CardDescription>All fields as per passport, in English</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>First Name *</Label>
                  <Input value={firstName} onChange={e => setFirstName(e.target.value)} required placeholder="As in passport" />
                </div>
                <div className="space-y-2">
                  <Label>Last Name *</Label>
                  <Input value={lastName} onChange={e => setLastName(e.target.value)} required placeholder="As in passport" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Date of Birth *</Label>
                  <Input type="date" value={dob} onChange={e => setDob(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>Email *</Label>
                  <Input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="student@email.com" />
                </div>
              </div>
              {/* Per-country major + university selection */}
              {allCountryKeys.map(key => {
                const pick = getPick(key);
                const unis = unisByCountry[key] || [];
                const BEST_UNI = 'Best University';
                const showBestUni = (key === 'UK' && unis.length > 0) || key === 'AUNZ';

                // All unique majors in DB for this country (for autocomplete)
                const allMajorsInDB = [...new Set(unis.map(u => u.major.trim()))].sort();
                const majorSugs = pick.majorSearch.trim()
                  ? allMajorsInDB.filter(m => m.toLowerCase().includes(pick.majorSearch.toLowerCase()))
                  : allMajorsInDB;

                const addMajor = (m: string) => {
                  const trimmed = m.trim();
                  if (!trimmed) return;
                  updPick(key, prev => ({
                    addedMajors: prev.addedMajors.includes(trimmed) ? prev.addedMajors : [...prev.addedMajors, trimmed],
                    majorSearch: '',
                    showSugs: false,
                  }));
                };

                const removeMajor = (major: string) => {
                  updPick(key, prev => {
                    const newByMajor = { ...prev.selectedUniNamesByMajor };
                    delete newByMajor[major];
                    return { addedMajors: prev.addedMajors.filter(m => m !== major), selectedUniNamesByMajor: newByMajor };
                  });
                };

                // Set of university names (normalised) already selected under any other major
                const selectedElsewhere = (targetMajor: string) => new Set(
                  pick.addedMajors
                    .filter(m => m !== targetMajor)
                    .flatMap(m => (pick.selectedUniNamesByMajor[m] || []).map(n => n.toLowerCase().trim()))
                );

                const toggleUni = (major: string, uniName: string) => {
                  updPick(key, prev => {
                    const current = prev.selectedUniNamesByMajor[major] || [];
                    const norm = uniName.toLowerCase().trim();
                    const isSelected = current.some(n => n.toLowerCase().trim() === norm);
                    // Selecting Best University clears all specific schools for this major
                    if (norm === BEST_UNI.toLowerCase() && !isSelected) {
                      return { selectedUniNamesByMajor: { ...prev.selectedUniNamesByMajor, [major]: [BEST_UNI] } };
                    }
                    return {
                      selectedUniNamesByMajor: {
                        ...prev.selectedUniNamesByMajor,
                        [major]: isSelected
                          ? current.filter(n => n.toLowerCase().trim() !== norm)
                          : [...current, uniName],
                      },
                    };
                  });
                };

                const { universities: finalUnis, major: finalMajor } = getFinalPick(key);

                return (
                  <div key={key} className="border rounded-lg p-4 space-y-3 bg-muted/10">
                    <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{COUNTRY_KEY_LABEL[key]}</div>

                    {/* Major search */}
                    <div className="flex gap-2 items-start">
                      <div className="flex-1 relative">
                        <Input
                          placeholder={unis.length > 0 ? 'Search or type a major…' : 'Type a major and press Enter…'}
                          value={pick.majorSearch}
                          onChange={e => updPick(key, { majorSearch: e.target.value, showSugs: true })}
                          onFocus={() => updPick(key, { showSugs: true })}
                          onBlur={() => setTimeout(() => updPick(key, { showSugs: false }), 150)}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addMajor(pick.majorSearch); } }}
                        />
                        {pick.showSugs && majorSugs.length > 0 && (
                          <div className="absolute z-50 w-full border rounded-md bg-background shadow-md mt-0.5 max-h-48 overflow-auto">
                            {majorSugs.map(m => (
                              <button key={m} type="button"
                                className="w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors"
                                onMouseDown={() => addMajor(m)}
                              >{m}</button>
                            ))}
                          </div>
                        )}
                      </div>
                      <Button type="button" variant="outline" size="sm" className="shrink-0"
                        disabled={!pick.majorSearch.trim() || pick.addedMajors.includes(pick.majorSearch.trim())}
                        onClick={() => addMajor(pick.majorSearch)}
                      >+ Add</Button>
                    </div>

                    {/* Added majors — each shows its university list */}
                    {pick.addedMajors.map(major => {
                      // Case-insensitive dedup of universities that offer this major
                      const rawMatches = unis.filter(u => u.major.toLowerCase().trim() === major.toLowerCase().trim());
                      const seen = new Set<string>();
                      const matchingUniNames: string[] = [];
                      for (const u of rawMatches) {
                        const k = u.name.toLowerCase().trim();
                        if (!seen.has(k)) { seen.add(k); matchingUniNames.push(u.name); }
                      }
                      matchingUniNames.sort();

                      const elsewhere = selectedElsewhere(major);
                      const selectedForMajor = pick.selectedUniNamesByMajor[major] || [];

                      return (
                        <div key={major} className="border rounded-md p-3 space-y-2 bg-background">
                          <div className="flex items-center justify-between">
                            <span className="text-base font-bold">{major}</span>
                            <button type="button" onClick={() => removeMajor(major)}
                              className="text-muted-foreground hover:text-destructive transition-colors">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          <div className="grid gap-1.5">
                            {/* Best University — top item for UK Foundation and AU/NZ */}
                            {showBestUni && (() => {
                              const bestSelected = selectedForMajor.some(n => n.toLowerCase().trim() === BEST_UNI.toLowerCase());
                              return (
                                <label className="flex items-center gap-2.5 text-sm cursor-pointer select-none">
                                  <Checkbox checked={bestSelected} onCheckedChange={() => toggleUni(major, BEST_UNI)} />
                                  <span className="font-bold">{BEST_UNI}</span>
                                </label>
                              );
                            })()}

                            {(() => {
                              const bestActive = selectedForMajor.some(n => n.toLowerCase().trim() === BEST_UNI.toLowerCase());
                              return matchingUniNames.length > 0 ? matchingUniNames.map(uniName => {
                                const norm = uniName.toLowerCase().trim();
                                const isSelected = selectedForMajor.some(n => n.toLowerCase().trim() === norm);
                                const conflict = !isSelected && elsewhere.has(norm);
                                const disabledByBest = bestActive && !isSelected;
                                const disabled = conflict || disabledByBest;
                                return (
                                  <label key={uniName} className={cn('flex items-center gap-2.5 text-sm select-none', disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer')}>
                                    <Checkbox checked={isSelected} disabled={disabled} onCheckedChange={() => !disabled && toggleUni(major, uniName)} />
                                    <span className="flex-1">{uniName}</span>
                                    {conflict && <span className="text-xs text-muted-foreground italic">taken</span>}
                                  </label>
                                );
                              }) : (
                                <p className="text-xs text-muted-foreground italic">No approved universities for this major — add them below.</p>
                              );
                            })()}
                          </div>
                        </div>
                      );
                    })}

                    {/* Free-text extra universities */}
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Additional universities (comma-separated)</Label>
                      <Input value={pick.uniExtra} onChange={e => updPick(key, { uniExtra: e.target.value })}
                        placeholder="e.g. University of London, UCL" />
                    </div>

                    {/* Preview */}
                    {(finalUnis || finalMajor) && (
                      <div className="text-xs bg-muted/40 rounded p-2 space-y-0.5 text-muted-foreground">
                        {finalUnis && <div><span className="font-medium text-foreground">Universities:</span> {finalUnis}</div>}
                        {finalMajor && <div><span className="font-medium text-foreground">Majors:</span> {finalMajor}</div>}
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="space-y-2">
                <Label>Full Kuwaiti Address (in English) *</Label>
                <Input value={kuwaitAddress} onChange={e => setKuwaitAddress(e.target.value)} required placeholder="Block, Street, House No., Area" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Kuwaiti Phone Number *</Label>
                  <Input value={kuwaitPhone} onChange={e => setKuwaitPhone(e.target.value)} required placeholder="8-digit number" maxLength={8} inputMode="numeric" />
                </div>
                {isUKorAUNZ && (
                  <div className="space-y-2">
                    <Label>Civil ID Number *</Label>
                    <Input value={civilId} onChange={e => setCivilId(e.target.value)} required placeholder="12-digit Civil ID" maxLength={12} inputMode="numeric" />
                  </div>
                )}
              </div>
              {isUK && (
                <div className="space-y-2">
                  <Label>School Name (Secondary Stage) *</Label>
                  <Input value={schoolName} onChange={e => setSchoolName(e.target.value)} required placeholder="High school name" />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Guardian Info */}
          <Card>
            <CardHeader>
              <CardTitle>Guardian Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Guardian&apos;s Name (in English) *</Label>
                  <Input value={guardianName} onChange={e => setGuardianName(e.target.value)} required placeholder="Full name" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Guardian&apos;s Email *</Label>
                  <Input type="email" value={guardianEmail} onChange={e => setGuardianEmail(e.target.value)} required placeholder="guardian@email.com" />
                </div>
                <div className="space-y-2">
                  <Label>Guardian&apos;s Phone *</Label>
                  <Input value={guardianPhone} onChange={e => setGuardianPhone(e.target.value)} required placeholder="8-digit number" maxLength={8} inputMode="numeric" />
                </div>
              </div>
              {isUSA && (
                <div className="space-y-2">
                  <Label>Guardian&apos;s Date of Birth *</Label>
                  <Input type="date" value={guardianDob} onChange={e => setGuardianDob(e.target.value)} required />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Documents */}
          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
              <CardDescription>Upload student documents — all optional but will be attached to the Jotform submission</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {DOC_FIELDS.map(({ key, label, labelAr }) => (
                <div key={key} className="space-y-1.5">
                  <Label className="text-sm">
                    {label} <span className="text-muted-foreground text-xs">({labelAr})</span>
                  </Label>

                  {/* Uploaded files list */}
                  {files[key].length > 0 && (
                    <div className="space-y-1">
                      {files[key].map((file, i) => (
                        <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-md border bg-muted/30 text-sm">
                          <Paperclip className="h-3.5 w-3.5 text-primary shrink-0" />
                          <span className="truncate flex-1 text-foreground">{file.name}</span>
                          <button
                            type="button"
                            onClick={() => removeFile(key, i)}
                            className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* File picker — always visible so more files can be added */}
                  <input
                    type="file"
                    multiple
                    ref={el => { fileRefs.current[key] = el; }}
                    onChange={e => handleFileChange(key, e)}
                    className="block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={isSubmitting} size="lg" className="gap-2 font-bold px-8">
              {isSubmitting
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Submitting...</>
                : <><Send className="h-4 w-4" /> Submit to {selectedCountries.join(' + ')}</>
              }
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
