'use client';

import { useState, useMemo } from 'react';
import { useUser } from '@/hooks/use-user';
import { useCollection } from '@/firebase/client';
import type { Invoice, Student } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle, Loader2, ReceiptText, Search } from 'lucide-react';
import { InvoiceTable } from '@/components/invoices/invoice-table';
import { CreateInvoiceDialog } from '@/components/invoices/create-invoice-dialog';
import { Input } from '@/components/ui/input';

export default function InvoicesPage() {
  const { user: currentUser, isUserLoading } = useUser();
  const [searchQuery, setSearchQuery] = useState('');
  
  const { data: invoices, isLoading: invoicesLoading } = useCollection<Invoice>(currentUser ? 'invoices' : '');
  const { data: students } = useCollection<Student>(currentUser ? 'students' : '');

  const filteredInvoices = useMemo(() => {
    if (!invoices) return [];
    const query = searchQuery.toLowerCase();
    return invoices.filter(inv => 
      inv.invoiceNumber.toLowerCase().includes(query) ||
      inv.studentName.toLowerCase().includes(query)
    ).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [invoices, searchQuery]);

  if (isUserLoading || invoicesLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (!currentUser || !['admin', 'department'].includes(currentUser.role)) {
    return <p className="p-8 text-center text-muted-foreground">Access Denied. Only management can view invoices.</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <ReceiptText className="h-8 w-8 text-primary" />
            Invoice Management
          </h1>
          <p className="text-muted-foreground mt-1">Generate and track student billing records.</p>
        </div>
        <CreateInvoiceDialog currentUser={currentUser} students={students || []}>
          <Button className="font-bold">
            <PlusCircle className="mr-2 h-4 w-4" />
            Create Invoice
          </Button>
        </CreateInvoiceDialog>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Invoice Records</CardTitle>
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by student or invoice #..."
                className="pl-8"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <InvoiceTable invoices={filteredInvoices} currentUser={currentUser} />
        </CardContent>
      </Card>
    </div>
  );
}
