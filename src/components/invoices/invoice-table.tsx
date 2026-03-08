'use client';

import { useState } from 'react';
import type { Invoice, InvoiceStatus, AppUser, InvoiceTemplate, Student } from '@/lib/types';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  MoreHorizontal, 
  Eye, 
  CheckCircle, 
  XCircle, 
  Trash2, 
  Loader2,
  Clock,
  Pencil
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import { updateInvoiceStatus, deleteInvoice } from '@/lib/actions';
import { formatDate } from '@/lib/timestamp-utils';
import { 
  AlertDialog, 
  AlertDialogAction, 
  AlertDialogCancel, 
  AlertDialogContent, 
  AlertDialogDescription, 
  AlertDialogFooter, 
  AlertDialogHeader, 
  AlertDialogTitle 
} from '@/components/ui/alert-dialog';
import { InvoiceViewDialog } from './invoice-view-dialog';
import { EditInvoiceDialog } from './edit-invoice-dialog';
import { useCollection } from '@/firebase/client';

interface InvoiceTableProps {
  invoices: Invoice[];
  templates: InvoiceTemplate[];
  currentUser: AppUser;
}

const statusVariants: Record<InvoiceStatus, string> = {
  paid: 'bg-green-100 text-green-700 hover:bg-green-100 border-green-200',
  unpaid: 'bg-orange-100 text-orange-700 hover:bg-orange-100 border-orange-200',
  cancelled: 'bg-muted text-muted-foreground hover:bg-muted border-transparent',
};

export function InvoiceTable({ invoices, templates, currentUser }: InvoiceTableProps) {
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [viewingInvoice, setViewingInvoice] = useState<Invoice | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);

  const { data: students } = useCollection<Student>(currentUser ? 'students' : '');

  const handleStatusChange = async (invoiceId: string, status: InvoiceStatus) => {
    setIsProcessing(invoiceId);
    const result = await updateInvoiceStatus(invoiceId, status, currentUser.id);
    if (result.success) toast({ title: 'Status Updated' });
    else toast({ variant: 'destructive', title: 'Error', description: result.message });
    setIsProcessing(null);
  };

  const handleDelete = async () => {
    if (!deletingId) return;
    setIsProcessing(deletingId);
    const result = await deleteInvoice(deletingId, currentUser.id);
    if (result.success) toast({ title: 'Invoice Deleted' });
    else toast({ variant: 'destructive', title: 'Error', description: result.message });
    setIsProcessing(null);
    setDeletingId(null);
  };

  return (
    <>
      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice #</TableHead>
              <TableHead>Student</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Total Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.length > 0 ? (
              invoices.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-mono font-bold text-xs">{inv.invoiceNumber}</TableCell>
                  <TableCell>
                    <div>
                      <div className="font-medium">{inv.studentName}</div>
                      <div className="text-[10px] text-muted-foreground">{inv.studentPhone}</div>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">{formatDate(inv.createdAt)}</TableCell>
                  <TableCell className="font-bold">
                    {inv.totalAmount.toFixed(2)} {inv.currency || 'KWD'}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={statusVariants[inv.status]}>
                      {isProcessing === inv.id ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                      {inv.status.toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="ghost" size="icon" onClick={() => setViewingInvoice(inv)}>
                        <Eye className="h-4 w-4" />
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setViewingInvoice(inv)}>
                            <Eye className="h-4 w-4 mr-2" /> View PDF
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setEditingInvoice(inv)}>
                            <Pencil className="h-4 w-4 mr-2" /> Edit Invoice
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => handleStatusChange(inv.id, 'paid')} disabled={inv.status === 'paid'}>
                            <CheckCircle className="h-4 w-4 mr-2 text-green-600" /> Mark as Paid
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleStatusChange(inv.id, 'unpaid')} disabled={inv.status === 'unpaid'}>
                            <Clock className="h-4 w-4 mr-2 text-orange-600" /> Mark as Unpaid
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleStatusChange(inv.id, 'cancelled')} disabled={inv.status === 'cancelled'}>
                            <XCircle className="h-4 w-4 mr-2 text-muted-foreground" /> Cancel Invoice
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem className="text-destructive" onClick={() => setDeletingId(inv.id)}>
                            <Trash2 className="h-4 w-4 mr-2" /> Delete Record
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">No invoices found.</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {viewingInvoice && (
        <InvoiceViewDialog 
          invoice={viewingInvoice} 
          templates={templates}
          isOpen={!!viewingInvoice} 
          onOpenChange={(open) => !open && setViewingInvoice(null)} 
        />
      )}

      {editingInvoice && (
        <EditInvoiceDialog
          currentUser={currentUser}
          invoice={editingInvoice}
          students={students || []}
          templates={templates}
          isOpen={!!editingInvoice}
          onOpenChange={(open) => !open && setEditingInvoice(null)}
        />
      )}

      <AlertDialog open={!!deletingId} onOpenChange={(open) => !open && setDeletingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Invoice?</AlertDialogTitle>
            <AlertDialogDescription>This will permanently remove the billing record. This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-white hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
