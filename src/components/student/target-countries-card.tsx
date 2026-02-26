'use client';

import { useState, useMemo } from 'react';
import type { Student, Country } from '@/lib/types';
import type { AppUser } from '@/hooks/use-user';
import { updateStudentTargetCountries } from '@/lib/actions';
import { useToast } from '@/hooks/use-toast';

// UI Components
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Globe, FilePenLine, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';

interface TargetCountriesCardProps {
  student: Student;
  currentUser: AppUser;
}

const countryList: Country[] = ['UK', 'USA', 'Australia', 'New Zealand'];

const countryEmojis: Record<Country, string> = {
  UK: '🇬🇧',
  USA: '🇺🇸',
  Australia: '🇦🇺',
  'New Zealand': '🇳🇿',
};

export function TargetCountriesCard({ student, currentUser }: TargetCountriesCardProps) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedCountries, setSelectedCountries] = useState<Country[]>(student.targetCountries || []);

  const canManage = ['admin', 'department'].includes(currentUser.role);

  // Compute union of explicit target countries and application countries
  const displayCountries = useMemo(() => {
    const explicit = student.targetCountries || [];
    const appCountries = student.applications?.map((a) => a.country) || [];
    return [...new Set([...explicit, ...appCountries])] as Country[];
  }, [student.targetCountries, student.applications]);

  const handleToggleCountry = (country: Country) => {
    setSelectedCountries((prev) =>
      prev.includes(country)
        ? prev.filter((c) => c !== country)
        : [...prev, country]
    );
  };

  const handleSave = async () => {
    setIsLoading(true);
    const result = await updateStudentTargetCountries(student.id, selectedCountries, currentUser.id);

    if (result.success) {
      toast({ title: 'Countries Updated', description: result.message });
      setIsOpen(false);
    } else {
      toast({ variant: 'destructive', title: 'Update Failed', description: result.message });
    }
    setIsLoading(false);
  };

  return (
    <Card className="bg-primary/5 border-primary/20">
      <CardHeader className="flex flex-row items-center justify-between py-4">
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5 text-primary" />
          <CardTitle className="text-lg">Target Countries</CardTitle>
        </div>
        {canManage && (
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm" onClick={() => setSelectedCountries(student.targetCountries || [])}>
                <FilePenLine className="h-4 w-4 mr-2" />
                Edit
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Target Countries</DialogTitle>
                <DialogDescription>
                  Select the primary countries this student is interested in.
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-4 py-4">
                {countryList.map((country) => (
                  <div key={country} className="flex items-center space-x-3 space-y-0 rounded-md border p-3">
                    <Checkbox
                      id={`country-${country}`}
                      checked={selectedCountries.includes(country)}
                      onCheckedChange={() => handleToggleCountry(country)}
                    />
                    <Label htmlFor={`country-${country}`} className="flex items-center gap-2 cursor-pointer font-medium">
                      <span>{countryEmojis[country]}</span>
                      <span>{country}</span>
                    </Label>
                  </div>
                ))}
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline" type="button">Cancel</Button>
                </DialogClose>
                <Button onClick={handleSave} disabled={isLoading}>
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save Changes
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent>
        {displayCountries.length > 0 ? (
          <div className="flex flex-wrap gap-3">
            {displayCountries.map((country) => (
              <div
                key={country}
                className="flex items-center gap-2 bg-background border px-3 py-1.5 rounded-full shadow-sm"
              >
                <span className="text-xl">{countryEmojis[country]}</span>
                <span className="font-semibold text-sm">{country}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">No target countries selected.</p>
        )}
      </CardContent>
    </Card>
  );
}
