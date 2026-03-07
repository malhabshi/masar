'use client';

import { useState } from 'react';
import type { Invoice } from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, FileDown, GraduationCap, Printer } from 'lucide-react';
import { formatDate } from '@/lib/timestamp-utils';
import { useToast } from '@/hooks/use-toast';

interface InvoiceViewDialogProps {
  invoice: Invoice;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InvoiceViewDialog({ invoice, isOpen, onOpenChange }: InvoiceViewDialogProps) {
  const [isExporting, setIsExporting] = useState(false);
  const { toast } = useToast();

  const handleDownloadPDF = async () => {
    setIsExporting(true);
    try {
      const { default: jsPDF } = await import('jspdf');
      const { default: html2canvas } = await import('html2canvas');
      
      const element = document.getElementById('invoice-render-area');
      if (!element) return;

      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff'
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`${invoice.invoiceNumber}_${invoice.studentName.replace(/\s+/g, '_')}.pdf`);
      
      toast({ title: 'PDF Downloaded' });
    } catch (error) {
      console.error('PDF Error:', error);
      toast({ variant: 'destructive', title: 'Download Failed' });
    } finally {
      setIsExporting(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-0 overflow-hidden flex flex-col max-h-[95vh]">
        <DialogHeader className="p-6 border-b bg-muted/10 flex flex-row items-center justify-between space-y-0">
          <div>
            <DialogTitle>View Invoice</DialogTitle>
            <p className="text-xs text-muted-foreground font-mono mt-1">{invoice.invoiceNumber}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handlePrint} className="print:hidden">
              <Printer className="h-4 w-4 mr-2" /> Print
            </Button>
            <Button size="sm" onClick={handleDownloadPDF} disabled={isExporting} className="print:hidden">
              {isExporting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileDown className="h-4 w-4 mr-2" />}
              Download PDF
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto bg-slate-100 p-8 flex justify-center">
          <div id="invoice-render-area" className="bg-white w-[210mm] min-h-[297mm] shadow-xl p-12 flex flex-col font-sans">
            {/* Invoice Header */}
            <div className="flex justify-between items-start border-b-2 border-primary pb-8 mb-8">
              <div className="flex items-center gap-3">
                <div className="bg-primary text-primary-foreground p-3 rounded-xl">
                  <GraduationCap className="h-10 w-10" />
                </div>
                <div>
                  <h1 className="text-3xl font-black tracking-tighter text-primary">UniApply Hub</h1>
                  <p className="text-xs text-muted-foreground uppercase font-bold tracking-widest">Educational Agency Services</p>
                </div>
              </div>
              <div className="text-right">
                <h2 className="text-4xl font-black text-slate-300 uppercase tracking-tighter">INVOICE</h2>
                <p className="text-sm font-bold text-slate-600 mt-1">{invoice.invoiceNumber}</p>
                <div className="mt-4 text-xs font-medium space-y-1">
                  <p><span className="text-muted-foreground">Date:</span> {formatDate(invoice.createdAt)}</p>
                  <p><span className="text-muted-foreground">Status:</span> <span className={`uppercase ${invoice.status === 'paid' ? 'text-green-600' : 'text-orange-600'}`}>{invoice.status}</span></p>
                </div>
              </div>
            </div>

            {/* Billing Info */}
            <div className="grid grid-cols-2 gap-12 mb-12">
              <div>
                <h3 className="text-xs font-bold uppercase text-primary mb-3 tracking-widest">Bill To</h3>
                <div className="space-y-1">
                  <p className="text-xl font-bold text-slate-800">{invoice.studentName}</p>
                  <p className="text-sm text-slate-600">{invoice.studentEmail}</p>
                  <p className="text-sm text-slate-600">{invoice.studentPhone}</p>
                </div>
              </div>
              <div className="text-right">
                <h3 className="text-xs font-bold uppercase text-primary mb-3 tracking-widest">Agency Details</h3>
                <div className="space-y-1 text-sm text-slate-600">
                  <p className="font-bold text-slate-800">UniApply Hub Management</p>
                  <p>Kuwait City, State of Kuwait</p>
                  <p>contact@uniapplyhub.com</p>
                </div>
              </div>
            </div>

            {/* Items Table */}
            <div className="flex-1">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b-2 border-slate-200">
                    <th className="py-4 text-xs font-black uppercase text-slate-500 tracking-widest">Description</th>
                    <th className="py-4 text-xs font-black uppercase text-slate-500 tracking-widest text-center">Qty</th>
                    <th className="py-4 text-xs font-black uppercase text-slate-500 tracking-widest text-right">Rate</th>
                    <th className="py-4 text-xs font-black uppercase text-slate-500 tracking-widest text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {invoice.items.map((item) => (
                    <tr key={item.id}>
                      <td className="py-5">
                        <p className="font-bold text-slate-800">{item.description}</p>
                      </td>
                      <td className="py-5 text-center text-slate-600 font-medium">{item.quantity}</td>
                      <td className="py-5 text-right text-slate-600 font-medium">{item.amount.toFixed(2)} KWD</td>
                      <td className="py-5 text-right font-bold text-slate-800">{(item.amount * item.quantity).toFixed(2)} KWD</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Footer Totals */}
            <div className="mt-12 pt-8 border-t-2 border-slate-100">
              <div className="flex justify-end">
                <div className="w-64 space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500 font-bold">Subtotal</span>
                    <span className="font-bold text-slate-800">{invoice.totalAmount.toFixed(2)} KWD</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500 font-bold">Tax (0%)</span>
                    <span className="font-bold text-slate-800">0.00 KWD</span>
                  </div>
                  <div className="flex justify-between items-center bg-primary text-primary-foreground p-4 rounded-xl mt-4">
                    <span className="text-xs font-black uppercase tracking-widest">Total Due</span>
                    <span className="text-2xl font-black">{invoice.totalAmount.toFixed(2)} KWD</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Terms & Notes */}
            <div className="mt-16 space-y-6">
              {invoice.notes && (
                <div className="bg-slate-50 p-6 rounded-xl border border-slate-100">
                  <h4 className="text-[10px] font-black uppercase text-slate-400 mb-2 tracking-widest">Payment Instructions / Notes</h4>
                  <p className="text-sm text-slate-600 italic whitespace-pre-wrap">{invoice.notes}</p>
                </div>
              )}
              <div className="text-center">
                <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Thank you for choosing UniApply Hub</p>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
