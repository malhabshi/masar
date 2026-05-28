'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Globe, CheckCircle2, FileCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { addCountryApplication } from '@/lib/actions';
import type { Student } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';

const ALL_COUNTRIES = ['UK', 'Australia / New Zealand', 'USA'];

interface AddCountryFormProps {
  student: Student;
  currentUser: AppUser;
  onSuccess: () => void;
  onCancel: () => void;
}

export function AddCountryForm({ student, currentUser, onSuccess, onCancel }: AddCountryFormProps) {
  const { toast } = useToast();
  const [country, setCountry] = useState('');
  const [major, setMajor] = useState('');
  const [universities, setUniversities] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const alreadyApplied = new Set<string>(student.targetCountries || []);
  const availableCountries = ALL_COUNTRIES.filter(c => !alreadyApplied.has(c));

  const jd = student.jotformData;
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

  const handleSubmit = async () => {
    if (!country || !major.trim()) return;
    setIsSubmitting(true);
    const result = await addCountryApplication(student.id, country, major.trim(), universities.trim(), currentUser.id);
    if (result.success) {
      toast({ title: 'Application Submitted', description: result.message });
      onSuccess();
    } else {
      toast({ variant: 'destructive', title: 'Submission Failed', description: result.message });
    }
    setIsSubmitting(false);
  };

  return (
    <div className="space-y-5 py-2">
      {/* Already applied countries */}
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

      {/* Pre-filled documents summary */}
      {docSummary.length > 0 && (
        <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
          <p className="text-xs font-medium flex items-center gap-1.5 text-muted-foreground">
            <FileCheck className="h-3.5 w-3.5" />
            Documents that will be pre-filled from original submission:
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
          <Select onValueChange={setCountry} value={country}>
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

      {/* Major */}
      <div className="space-y-2">
        <Label htmlFor="add-country-major">Major <span className="text-destructive">*</span></Label>
        <Input
          id="add-country-major"
          placeholder="e.g. Computer Science"
          value={major}
          onChange={e => setMajor(e.target.value)}
        />
      </div>

      {/* Universities (optional) */}
      <div className="space-y-2">
        <Label htmlFor="add-country-unis">Universities <span className="text-xs text-muted-foreground">(optional)</span></Label>
        <Input
          id="add-country-unis"
          placeholder="e.g. University of Toronto, McGill University"
          value={universities}
          onChange={e => setUniversities(e.target.value)}
        />
      </div>

      <div className="flex gap-2 pt-2">
        <Button
          variant="outline"
          className="flex-1"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button
          className="flex-1"
          disabled={!country || !major.trim() || availableCountries.length === 0 || isSubmitting}
          onClick={handleSubmit}
        >
          {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          Submit Application
        </Button>
      </div>
    </div>
  );
}
