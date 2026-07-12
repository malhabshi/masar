'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Globe, CheckCircle2, FileCheck, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useCollection } from '@/firebase/client';
import { addCountryApplication } from '@/lib/actions';
import type { Student, ApprovedUniversity } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { cn } from '@/lib/utils';

const ALL_COUNTRIES = ['UK', 'Australia / New Zealand', 'USA', 'Ireland'];
const BEST_UNI = 'Best Option';
const USA_SEMESTER_OPTIONS = ['Spring 2026 / 1', 'Summer 2026 / 6', 'Fall 2026/9'];

interface CountryPick {
  majorSearch: string;
  showSugs: boolean;
  addedMajors: string[];
  selectedUniNamesByMajor: Record<string, string[]>;
  uniExtra: string;
}
const emptyPick = (): CountryPick => ({
  majorSearch: '', showSugs: false, addedMajors: [], selectedUniNamesByMajor: {}, uniExtra: '',
});

interface AddCountryFormProps {
  student: Student;
  currentUser: AppUser;
  onSuccess: () => void;
  onCancel: () => void;
}

export function AddCountryForm({ student, currentUser, onSuccess, onCancel }: AddCountryFormProps) {
  const { toast } = useToast();
  const [country, setCountry] = useState('');
  const [semester, setSemester] = useState('');
  const [guardianDob, setGuardianDob] = useState('');
  const [pick, setPick] = useState<CountryPick>(emptyPick());
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: allApprovedUnis } = useCollection<ApprovedUniversity>('approved_universities');

  const alreadyApplied = new Set<string>(student.targetCountries || []);
  const availableCountries = ALL_COUNTRIES.filter(c => !alreadyApplied.has(c));

  const jd = student.jotformData;
  const acceptanceType = jd?.acceptanceType || '';
  const countryKey = country === 'Australia / New Zealand' ? 'AUNZ' : country === 'UK' ? 'UK' : country === 'USA' ? 'USA' : country === 'Ireland' ? 'Ireland' : '';
  const showBestUni = countryKey !== 'USA';

  // Filter approved universities for the selected country
  const unis = useMemo((): ApprovedUniversity[] => {
    if (!allApprovedUnis || !countryKey) return [];
    if (countryKey === 'UK') {
      if (acceptanceType !== 'Foundation') return [];
      return allApprovedUnis.filter(u => {
        if (!u.isAvailable || u.country !== 'UK') return false;
        if (u.entryLevels && u.entryLevels.length > 0 && !u.entryLevels.includes('Foundation')) return false;
        return true;
      });
    }
    if (countryKey === 'AUNZ') {
      return allApprovedUnis.filter(u => u.isAvailable && (u.country === 'Australia' || u.country === 'New Zealand'));
    }
    if (countryKey === 'USA') {
      return allApprovedUnis.filter(u => u.isAvailable && u.country === 'USA');
    }
    if (countryKey === 'Ireland') {
      return allApprovedUnis.filter(u => u.isAvailable && u.country === 'Ireland');
    }
    return [];
  }, [allApprovedUnis, countryKey, acceptanceType]);

  const allMajorsInDB = useMemo(() => [...new Set(unis.map(u => u.major.trim()))].sort(), [unis]);
  const majorSugs = pick.majorSearch.trim()
    ? allMajorsInDB.filter(m => m.toLowerCase().includes(pick.majorSearch.toLowerCase()))
    : allMajorsInDB;

  const updPick = (update: Partial<CountryPick> | ((prev: CountryPick) => Partial<CountryPick>)) => {
    setPick(prev => {
      const changes = typeof update === 'function' ? update(prev) : update;
      return { ...prev, ...changes };
    });
  };

  const addMajor = (m: string) => {
    const trimmed = m.trim();
    if (!trimmed) return;
    updPick(prev => ({
      addedMajors: prev.addedMajors.includes(trimmed) ? prev.addedMajors : [...prev.addedMajors, trimmed],
      majorSearch: '',
      showSugs: false,
    }));
  };

  const removeMajor = (major: string) => {
    updPick(prev => {
      const newByMajor = { ...prev.selectedUniNamesByMajor };
      delete newByMajor[major];
      return { addedMajors: prev.addedMajors.filter(m => m !== major), selectedUniNamesByMajor: newByMajor };
    });
  };

  const toggleUni = (major: string, uniName: string) => {
    updPick(prev => {
      const current = prev.selectedUniNamesByMajor[major] || [];
      const norm = uniName.toLowerCase().trim();
      const isSelected = current.some(n => n.toLowerCase().trim() === norm);
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

  const selectedElsewhere = (targetMajor: string) => new Set(
    pick.addedMajors
      .filter(m => m !== targetMajor)
      .flatMap(m => (pick.selectedUniNamesByMajor[m] || []).map(n => n.toLowerCase().trim()))
  );

  const getFinal = () => {
    let bestUniUsed = false;
    const uniParts: string[] = [];
    const entries: { university: string; major: string }[] = [];
    for (const m of pick.addedMajors) {
      const selected = pick.selectedUniNamesByMajor[m] || [];
      for (const uni of selected) {
        if (uni.toLowerCase().trim() === BEST_UNI.toLowerCase()) {
          bestUniUsed = true;
          entries.push({ university: BEST_UNI, major: m });
        } else {
          uniParts.push(`${uni} (${m})`);
          entries.push({ university: uni, major: m });
        }
      }
    }
    const extras = pick.uniExtra.split(',').map(s => s.trim()).filter(Boolean);
    for (const extra of extras) {
      entries.push({ university: extra, major: pick.addedMajors[0] || '' });
    }
    return {
      universities: [...(bestUniUsed ? [BEST_UNI] : []), ...uniParts, ...extras].join(', '),
      major: pick.addedMajors.join(', '),
      entries,
    };
  };

  const handleCountryChange = (val: string) => {
    setCountry(val);
    setSemester('');
    setGuardianDob('');
    setPick(emptyPick());
  };

  const handleSubmit = async () => {
    const { universities, major, entries } = getFinal();
    if (!country || !major) return;
    if (country === 'USA' && !semester) return;
    if (country === 'USA' && !guardianDob && !jd?.guardianDob) return;

    // Enrich each entry with the actual Firestore country
    const applicationEntries = entries.map(e => {
      let entryCountry: string;
      if (countryKey === 'UK') entryCountry = 'UK';
      else if (countryKey === 'USA') entryCountry = 'USA';
      else {
        const uniRecord = unis.find(u => u.name === e.university);
        entryCountry = uniRecord?.country || 'Australia';
      }
      return { ...e, country: entryCountry };
    });

    setIsSubmitting(true);
    const result = await addCountryApplication(student.id, country, major, universities, currentUser.id, semester || undefined, guardianDob || undefined, applicationEntries);
    if (result.success) {
      toast({ title: 'Application Submitted', description: result.message });
      onSuccess();
    } else {
      toast({ variant: 'destructive', title: 'Submission Failed', description: result.message });
    }
    setIsSubmitting(false);
  };

  const { universities: finalUnis, major: finalMajor } = getFinal();
  const storedDocs = jd?.documents;
  const docSummary = [
    { label: 'Passport', has: !!storedDocs?.passport?.length },
    { label: 'Secondary Certs', has: !!storedDocs?.secondaryCerts?.length },
    { label: 'IELTS File', has: !!storedDocs?.ieltsFile?.length },
    { label: 'University Degree', has: !!storedDocs?.universityDegree?.length },
    { label: 'Recommendation Letter', has: !!storedDocs?.recommendationLetter?.length },
    { label: 'Personal Statement', has: !!storedDocs?.personalStatement?.length },
    { label: 'Other Files', has: !!storedDocs?.otherFiles?.length },
  ].filter(d => d.has);

  return (
    <div className="space-y-5 py-2">
      {/* Already applied */}
      {alreadyApplied.size > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground font-medium">Already applied to:</p>
          <div className="flex flex-wrap gap-1.5">
            {[...alreadyApplied].map(c => (
              <Badge key={c} variant="secondary" className="text-xs gap-1">
                <CheckCircle2 className="h-3 w-3 text-green-500" />
                {c}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Pre-filled docs summary */}
      {docSummary.length > 0 && (
        <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
          <p className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground">
            <FileCheck className="h-3.5 w-3.5" />
            Documents pre-filled from original submission:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {docSummary.map(d => (
              <Badge key={d.label} variant="outline" className="text-[10px]">{d.label}</Badge>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground italic">
            Personal info (name, DOB, contact, guardian) will also be pre-filled.
          </p>
        </div>
      )}

      {/* Country selector */}
      <div className="space-y-2">
        <Label>New Country <span className="text-destructive">*</span></Label>
        {availableCountries.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">All countries have already been applied to.</p>
        ) : (
          <Select onValueChange={handleCountryChange} value={country}>
            <SelectTrigger>
              <SelectValue placeholder="Select a country" />
            </SelectTrigger>
            <SelectContent>
              {availableCountries.map(c => (
                <SelectItem key={c} value={c}>
                  <span className="flex items-center gap-2">
                    <Globe className="h-3.5 w-3.5 text-muted-foreground" />
                    {c}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Major + University picker (only when country is selected) */}
      {country && (
        <div className="border rounded-lg p-4 space-y-3 bg-muted/10">
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {countryKey === 'AUNZ' ? 'AU / NZ' : countryKey}
          </div>

          {/* Semester + Guardian DOB — USA only */}
          {countryKey === 'USA' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Academic Semester <span className="text-destructive">*</span></Label>
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
              {!jd?.guardianDob && (
                <div className="space-y-1.5">
                  <Label>Guardian Date of Birth <span className="text-destructive">*</span></Label>
                  <Input type="date" value={guardianDob} onChange={e => setGuardianDob(e.target.value)} />
                </div>
              )}
            </div>
          )}

          {/* Major search */}
          <div className="flex gap-2 items-start">
            <div className="flex-1 relative">
              <Input
                placeholder={unis.length > 0 ? 'Search or type a major…' : 'Type a major and press Enter…'}
                value={pick.majorSearch}
                onChange={e => updPick({ majorSearch: e.target.value, showSugs: true })}
                onFocus={() => updPick({ showSugs: true })}
                onBlur={() => setTimeout(() => updPick({ showSugs: false }), 150)}
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
            const bestActive = selectedForMajor.some(n => n.toLowerCase().trim() === BEST_UNI.toLowerCase());

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
                  {showBestUni && (() => {
                    const bestSelected = selectedForMajor.some(n => n.toLowerCase().trim() === BEST_UNI.toLowerCase());
                    return (
                      <label className="flex items-center gap-2.5 text-sm cursor-pointer select-none">
                        <Checkbox checked={bestSelected} onCheckedChange={() => toggleUni(major, BEST_UNI)} />
                        <span className="font-bold">{BEST_UNI}</span>
                        <span className="text-xs text-muted-foreground italic">(schools will be added manually)</span>
                      </label>
                    );
                  })()}

                  {matchingUniNames.length > 0 ? matchingUniNames.map(uniName => {
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
                  )}
                </div>
              </div>
            );
          })}

          {/* Free-text extra universities */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Additional universities (comma-separated)</Label>
            <Input value={pick.uniExtra} onChange={e => updPick({ uniExtra: e.target.value })}
              placeholder="e.g. University of London, UCL" />
          </div>

          {/* Preview */}
          {(finalUnis || finalMajor) && (
            <div className="text-xs bg-muted/40 rounded p-2 space-y-0.5 text-muted-foreground">
              {finalMajor && <div><span className="font-medium text-foreground">Major:</span> {finalMajor}</div>}
              {finalUnis && <div><span className="font-medium text-foreground">Universities:</span> {finalUnis}</div>}
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <Button variant="outline" className="flex-1" onClick={onCancel} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button
          className="flex-1"
          disabled={!country || !finalMajor || availableCountries.length === 0 || isSubmitting || (country === 'USA' && !semester) || (country === 'USA' && !jd?.guardianDob && !guardianDob)}
          onClick={handleSubmit}
        >
          {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          Submit Application
        </Button>
      </div>
    </div>
  );
}
