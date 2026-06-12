'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useUser } from '@/hooks/use-user';
import type { ApprovedUniversity, Country, UniversityCategory, UniversityCompany } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MultiSelectFilter } from '@/components/ui/multi-select-filter';
import { PlusCircle, Search, Loader2, X } from 'lucide-react';
import { UniversitiesTable } from '@/components/universities/universities-table';
import { AddUniversityDialog } from '@/components/universities/add-university-dialog';
import { sendTask, deleteUniversity } from '@/lib/actions';
import { useCollection, addDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/client';
import { firestore } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { Skeleton } from '../ui/skeleton';
import { Badge } from '@/components/ui/badge';

export function ApprovedUniversitiesView() {
  const { user, isUserLoading: isUserLoadingHook } = useUser();
  const { toast } = useToast();

  const { data: universitiesData, isLoading: areUniversitiesLoading } = useCollection<ApprovedUniversity>(user ? 'approved_universities' : '');
  
  const isLoading = isUserLoadingHook || areUniversitiesLoading;

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery);
  const [countryFilter, setCountryFilter] = useState<string[]>([]);
  const [availabilityFilter, setAvailabilityFilter] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [companyFilter, setCompanyFilter] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('universities_filters');
      if (raw) {
        const f = JSON.parse(raw);
        if (f.searchQuery !== undefined)        { setSearchQuery(f.searchQuery); setDebouncedSearchQuery(f.searchQuery); }
        if (Array.isArray(f.countryFilter))     setCountryFilter(f.countryFilter);
        if (Array.isArray(f.availabilityFilter)) setAvailabilityFilter(f.availabilityFilter);
        if (Array.isArray(f.categoryFilter))    setCategoryFilter(f.categoryFilter);
        if (Array.isArray(f.companyFilter))     setCompanyFilter(f.companyFilter);
      }
    } catch {}
  }, []);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);

    return () => {
      clearTimeout(handler);
    };
  }, [searchQuery]);

  useEffect(() => {
    try {
      sessionStorage.setItem('universities_filters', JSON.stringify({ searchQuery, countryFilter, availabilityFilter, categoryFilter, companyFilter }));
    } catch {}
  }, [searchQuery, countryFilter, availabilityFilter, categoryFilter]);

  const handleClearFilters = () => {
    setSearchQuery('');
    setDebouncedSearchQuery('');
    setCountryFilter([]);
    setAvailabilityFilter([]);
    setCategoryFilter([]);
    setCompanyFilter([]);
    try {
      sessionStorage.removeItem('universities_filters');
    } catch {}
  };

  const isFiltered = searchQuery !== '' || countryFilter.length > 0 || availabilityFilter.length > 0 || categoryFilter.length > 0 || companyFilter.length > 0;

  const filteredUniversities = useMemo(() => {
    if (!universitiesData) return [];
    
    const searchWords = debouncedSearchQuery.toLowerCase().trim().split(/\s+/).filter(Boolean);

    const results = universitiesData.filter(uni => {
      const uniName = (uni.name || '').toLowerCase();
      const uniMajor = (uni.major || '').toLowerCase();
      const uniCountry = (uni.country || '').toLowerCase();
      const uniCategory = (uni.category || '').toLowerCase();
      const uniImportant = (uni.importantNote || '').toLowerCase();

      const matchesSearch = searchWords.every(word => 
        uniName.includes(word) || 
        uniMajor.includes(word) || 
        uniCountry.includes(word) || 
        uniCategory.includes(word) ||
        uniImportant.includes(word)
      );

      const matchesCountry = countryFilter.length === 0 || countryFilter.includes(uni.country);

      const matchesAvailability = availabilityFilter.length === 0 ||
        availabilityFilter.some(f => f === 'available' ? uni.isAvailable : !uni.isAvailable);

      const matchesCategory = categoryFilter.length === 0 || categoryFilter.includes(uni.category ?? '');
      const matchesCompany = companyFilter.length === 0 || companyFilter.includes(uni.company ?? '');

      return matchesSearch && matchesCountry && matchesAvailability && matchesCategory && matchesCompany;
    });

    const COMPANY_ORDER: Record<string, number> = {
      Into: 0, Studygroup: 1, Kaplan: 2, OnCampus: 3, Navitas: 4, Other: 5, Inhouse: 6,
    };

    return results.sort((a, b) => {
      const aComp = a.company ? (COMPANY_ORDER[a.company] ?? 99) : 99;
      const bComp = b.company ? (COMPANY_ORDER[b.company] ?? 99) : 99;
      if (aComp !== bComp) return aComp - bComp;
      const aSchool = a.schoolOrder ?? 999999;
      const bSchool = b.schoolOrder ?? 999999;
      if (aSchool !== bSchool) return aSchool - bSchool;
      const aMajor = a.majorOrder ?? 999999;
      const bMajor = b.majorOrder ?? 999999;
      if (aMajor !== bMajor) return aMajor - bMajor;
      const nameCompare = (a.name || '').localeCompare(b.name || '');
      if (nameCompare !== 0) return nameCompare;
      return (a.major || '').localeCompare(b.major || '');
    });
  }, [debouncedSearchQuery, countryFilter, availabilityFilter, categoryFilter, companyFilter, universitiesData]);

  const canManage = user?.role === 'admin' || user?.role === 'department';

  const handleAddUniversity = useCallback(async (newUniversity: Omit<ApprovedUniversity, 'id'>) => {
    if (!user) return;
    const universitiesCollection = collection(firestore, 'approved_universities');
    addDocumentNonBlocking(universitiesCollection, newUniversity);

    toast({
        title: "University Added",
        description: `${newUniversity.name} (${newUniversity.major}) has been added.`
    });

    const taskContent = `New approved university added: ${newUniversity.name} (${newUniversity.major}). Category: ${newUniversity.category || 'General'}`;
    await sendTask(user.id, 'all', taskContent, 'system');
  }, [user, toast]);

  const handleUpdateUniversity = useCallback(async (updatedUniversity: ApprovedUniversity) => {
    if (!user) return;
    const uniDocRef = doc(firestore, 'approved_universities', updatedUniversity.id);
    updateDocumentNonBlocking(uniDocRef, updatedUniversity);

    toast({
        title: "University Updated",
        description: `${updatedUniversity.name} has been updated.`
    });
  }, [user, toast]);

  const handleDeleteUniversity = useCallback(async (id: string) => {
    if (!user) return;
    const result = await deleteUniversity(id, user.id);
    if (result.success) {
      toast({ title: 'Deleted', description: result.message });
    } else {
      toast({ variant: 'destructive', title: 'Error', description: result.message });
    }
  }, [user, toast]);

  const countries: Country[] = ['UK', 'USA', 'Australia', 'New Zealand'];
  const companies: UniversityCompany[] = ['Into', 'Studygroup', 'Kaplan', 'OnCampus', 'Navitas', 'Other', 'Inhouse'];
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center p-10"><Loader2 className="h-8 w-8 animate-spin" /></div>
        </CardContent>
      </Card>
    )
  }

  if (!user) {
    return (
        <Card>
            <CardHeader>
                <CardTitle>Access Denied</CardTitle>
            </CardHeader>
            <CardContent>
                <p>You must be logged in to view this page.</p>
            </CardContent>
        </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
            <CardTitle className="flex items-center gap-3">
                Approved Universities
                <Badge variant="secondary" className="font-mono text-sm">
                    {filteredUniversities.length} {isFiltered ? 'Found' : 'Total'}
                </Badge>
            </CardTitle>
            <CardDescription>A master list of universities approved by MOHE and the Merit scholarship list.</CardDescription>
        </div>
        {canManage && (
            <AddUniversityDialog onAddUniversity={handleAddUniversity}>
                <Button>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Add University
                </Button>
            </AddUniversityDialog>
        )}
      </CardHeader>
      <CardContent>
        <div className="flex flex-col space-y-4 mb-6">
            <div className="flex flex-col md:flex-row gap-2">
                <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        type="search"
                        placeholder="Search by university name, major, country or category..."
                        className="pl-8"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>
                {isFiltered && (
                    <Button variant="ghost" onClick={handleClearFilters} className="gap-2">
                        <X className="h-4 w-4" />
                        Clear Filters
                    </Button>
                )}
            </div>
            <div className="flex flex-wrap gap-2">
                <MultiSelectFilter
                    label="Countries"
                    options={countries.map(c => ({ label: c, value: c }))}
                    selected={countryFilter}
                    onChange={setCountryFilter}
                    className="flex-1 min-w-[120px]"
                />
                <MultiSelectFilter
                    label="Categories"
                    options={[
                        { label: 'MOHE', value: 'MOHE' },
                        { label: 'Merit List', value: 'Merit' },
                        { label: 'General', value: 'General' },
                    ]}
                    selected={categoryFilter}
                    onChange={setCategoryFilter}
                    className="flex-1 min-w-[120px]"
                />
                <MultiSelectFilter
                    label="Availability"
                    options={[
                        { label: 'Available', value: 'available' },
                        { label: 'Closed/Unavailable', value: 'unavailable' },
                    ]}
                    selected={availabilityFilter}
                    onChange={setAvailabilityFilter}
                    className="flex-1 min-w-[120px]"
                />
                <MultiSelectFilter
                    label="Company"
                    options={companies.map(c => ({ label: c, value: c }))}
                    selected={companyFilter}
                    onChange={setCompanyFilter}
                    className="flex-1 min-w-[120px]"
                />
            </div>
        </div>
        <UniversitiesTable
          universities={filteredUniversities}
          onUpdateUniversity={canManage ? handleUpdateUniversity : undefined}
          onDeleteUniversity={canManage ? handleDeleteUniversity : undefined}
          isLoading={isLoading}
        />
      </CardContent>
    </Card>
  );
}
