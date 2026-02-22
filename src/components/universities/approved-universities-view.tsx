'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useUser } from '@/hooks/use-user';
import type { ApprovedUniversity, Country } from '@/lib/types';
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
import { PlusCircle, Search, Loader2 } from 'lucide-react';
import { UniversitiesTable } from '@/components/universities/universities-table';
import { AddUniversityDialog } from '@/components/universities/add-university-dialog';
import { sendTask } from '@/lib/actions';
import { firestore, useCollection, addDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/client';
import { collection, doc } from 'firebase/firestore';
import { Skeleton } from '../ui/skeleton';

export function ApprovedUniversitiesView() {
  const { user, isUserLoading: isUserLoadingHook } = useUser();
  const { toast } = useToast();

  const { data: universitiesData, isLoading: areUniversitiesLoading } = useCollection<ApprovedUniversity>('approved_universities');
  
  const isLoading = isUserLoadingHook || areUniversitiesLoading;

  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery);
  const [countryFilter, setCountryFilter] = useState('all');
  const [availabilityFilter, setAvailabilityFilter] = useState('all');

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);

    return () => {
      clearTimeout(handler);
    };
  }, [searchQuery]);

  const filteredUniversities = useMemo(() => {
    if (!universitiesData) return [];
    return universitiesData.filter(uni => {
      const searchLower = debouncedSearchQuery.toLowerCase();
      const matchesSearch =
        uni.name.toLowerCase().includes(searchLower) ||
        uni.major.toLowerCase().includes(searchLower);

      const matchesCountry = countryFilter === 'all' || uni.country === countryFilter;
      
      const matchesAvailability = 
        availabilityFilter === 'all' || 
        (availabilityFilter === 'available' && uni.isAvailable) ||
        (availabilityFilter === 'unavailable' && !uni.isAvailable);

      return matchesSearch && matchesCountry && matchesAvailability;
    });
  }, [debouncedSearchQuery, countryFilter, availabilityFilter, universitiesData]);

  const canManage = user?.role === 'admin' || user?.role === 'department';

  const handleAddUniversity = useCallback(async (newUniversity: Omit<ApprovedUniversity, 'id'>) => {
    if (!user) return;
    const universitiesCollection = collection(firestore, 'approved_universities');
    addDocumentNonBlocking(universitiesCollection, newUniversity);

    toast({
        title: "University Added",
        description: `${newUniversity.name} has been added to the list.`
    });

    const taskContent = `New approved university added: ${newUniversity.name} (${newUniversity.major}).`;
    await sendTask(user.id, 'all', taskContent);
    
    const tasksCollection = collection(firestore, 'tasks');
    addDocumentNonBlocking(tasksCollection, { authorId: user.id, recipientId: 'all', content: taskContent, createdAt: new Date().toISOString(), status: 'new' as const, replies: [] });

    toast({
      title: "Employees Notified",
      description: "A task has been sent to all employees about the new university."
    });
  }, [user, toast]);

  const handleUpdateUniversity = useCallback(async (updatedUniversity: ApprovedUniversity) => {
    if (!user) return;
    const uniDocRef = doc(firestore, 'approved_universities', updatedUniversity.id);
    updateDocumentNonBlocking(uniDocRef, updatedUniversity);

    toast({
        title: "University Updated",
        description: `${updatedUniversity.name} has been updated.`
    });

    const taskContent = `Approved university updated: ${updatedUniversity.name} (${updatedUniversity.major}). Please review the changes.`;
    await sendTask(user.id, 'all', taskContent);
    
    const tasksCollection = collection(firestore, 'tasks');
    addDocumentNonBlocking(tasksCollection, { authorId: user.id, recipientId: 'all', content: taskContent, createdAt: new Date().toISOString(), status: 'new' as const, replies: [] });

    toast({
      title: "Employees Notified",
      description: "A task has been sent to all employees about the university update."
    });
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
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
            <CardTitle>Approved Universities</CardTitle>
            <CardDescription>A list of universities that can be applied to.</CardDescription>
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
        <div className="flex flex-col md:flex-row gap-4 justify-between items-center mb-4">
            <div className="relative w-full md:max-w-sm">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                    type="search"
                    placeholder="Search by university or major..."
                    className="pl-8"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
            </div>
            <div className="flex gap-2 w-full md:w-auto">
                <Select value={countryFilter} onValueChange={setCountryFilter}>
                    <SelectTrigger className="w-full md:w-[180px]">
                        <SelectValue placeholder="Filter by country" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Countries</SelectItem>
                        {countries.map(c => (
                            <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <Select value={availabilityFilter} onValueChange={setAvailabilityFilter}>
                    <SelectTrigger className="w-full md:w-[180px]">
                        <SelectValue placeholder="Filter by availability" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        <SelectItem value="available">Available</SelectItem>
                        <SelectItem value="unavailable">Unavailable</SelectItem>
                    </SelectContent>
                </Select>
            </div>
        </div>
        <UniversitiesTable
          universities={filteredUniversities}
          onUpdateUniversity={canManage ? handleUpdateUniversity : undefined}
          isLoading={isLoading}
        />
      </CardContent>
    </Card>
  );
}
