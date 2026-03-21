'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useUser } from '@/hooks/use-user';
import type { ApprovedUniversity, Country, UniversityCategory } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  const [countryFilter, setCountryFilter] = useState('all');
  const [availabilityFilter, setAvailabilityFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState<UniversityCategory | 'all'>('all');

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);

    return () => {
      clearTimeout(handler);
    };
  }, [searchQuery]);

  const handleClearFilters = () => {
    setSearchQuery('');
    setCountryFilter('all');
    setAvailabilityFilter('all');
    setCategoryFilter('all');
  };

  const isFiltered = searchQuery !== '' || countryFilter !== 'all' || availabilityFilter !== 'all' || categoryFilter !== 'all';

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

      const matchesCountry = countryFilter === 'all' || uni.country === countryFilter;
      
      const matchesAvailability = 
        availabilityFilter === 'all' || 
        (availabilityFilter === 'available' && uni.isAvailable) ||
        (availabilityFilter === 'unavailable' && !uni.isAvailable);

      const matchesCategory = categoryFilter === 'all' || uni.category === categoryFilter;

      return matchesSearch && matchesCountry && matchesAvailability && matchesCategory;
    });

    return results.sort((a, b) => {
        const nameCompare = (a.name || '').localeCompare(b.name || '');
        if (nameCompare !== 0) return nameCompare;
        return (a.major || '').localeCompare(b.major || '');
    });
  }, [debouncedSearchQuery, countryFilter, availabilityFilter, categoryFilter, universitiesData]);

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
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Select value={countryFilter} onValueChange={setCountryFilter}>
                    <SelectTrigger>
                        <SelectValue placeholder="All Countries" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Countries</SelectItem>
                        {countries.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as any)}>
                    <SelectTrigger>
                        <SelectValue placeholder="All Categories" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Categories</SelectItem>
                        <SelectItem value="MOHE">MOHE Only</SelectItem>
                        <SelectItem value="Merit">Merit List Only</SelectItem>
                        <SelectItem value="General">General Only</SelectItem>
                    </SelectContent>
                </Select>
                <Select value={availabilityFilter} onValueChange={setAvailabilityFilter}>
                    <SelectTrigger>
                        <SelectValue placeholder="All Statuses" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        <SelectItem value="available">Available</SelectItem>
                        <SelectItem value="unavailable">Closed/Unavailable</SelectItem>
                    </SelectContent>
                </Select>
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
