'use client';

import { useState, useMemo } from 'react';
import { useUser } from '@/hooks/use-user';
import { useCollection } from '@/firebase/client';
import type { Invoice, Student } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PlusCircle, Loader2, ReceiptText, Search, CreditCard, Clock, CheckCircle } from 'lucide-react';
import { InvoiceTable } from '@/components/invoices/invoice-table';
import { CreateInvoiceDialog } from '@/components/invoices/create-invoice-dialog';
import { Input } from '@/components/ui/input';

export default function InvoicesPage() {
  const { user: currentUser, isUserLoading } = useUser();
  const [searchQuery, setSearchQuery] = useState('');
  
  const { data: invoices, isLoading: invoicesLoading } = useCollection<Invoice>(currentUser ? 'invoices' : '');
  const { data: students } = useCollection<Student>(currentUser ? 'students' : '');

  const stats = useMemo(() => {
    if (!invoices) return { total: 0, paid: 0, unpaid: 0 };
    return invoices.reduce((acc, inv) => {
      if (inv.status === 'cancelled') return acc;
      acc.total += inv.totalAmount;
      if (inv.status === 'paid') acc.paid += inv.totalAmount;
      else acc.unpaid += inv.totalAmount;
      return acc;
    }, { total: 0, paid: 0, unpaid: 0 });
  }, [invoices]);

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
    return <p>Access Denied.</p>;
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

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Billed</CardTitle>
            <CreditCard className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total.toFixed(2)} KWD</div>
          </CardContent>
        </Card>
        <Card className="border-green-200 bg-green-50/30">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-green-700">Collected</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-700">{stats.paid.toFixed(2)} KWD</div>
          </CardContent>
        </Card>
        <Card className="border-orange-200 bg-orange-50/30">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-orange-700">Outstanding</CardTitle>
            <Clock className="h-4 w-4 text-orange-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-700">{stats.unpaid.toFixed(2)} KWD</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Invoices</CardTitle>
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
