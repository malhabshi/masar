
'use client';

import { useState, useMemo, useEffect } from 'react';
import type { Invoice, InvoiceTemplate } from '@/lib/types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, FileDown, GraduationCap, Printer, MapPin, Phone, Mail, User, Tag, RefreshCw } from 'lucide-react';
import { formatDate } from '@/lib/timestamp-utils';
import { useToast } from '@/hooks/use-toast';

interface InvoiceViewDialogProps {
  invoice: Invoice;
  templates: InvoiceTemplate[];
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InvoiceViewDialog({ invoice, templates, isOpen, onOpenChange }: InvoiceViewDialogProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [logoDataUri, setLogoDataUri] = useState<string | null>(null);
  const [isLogoLoading, setIsLogoLoading] = useState(false);
  const { toast } = useToast();
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  const selectedTemplate = useMemo(() => {
    if (!invoice.templateId) return null;
    return templates.find(t => t.id === invoice.templateId) || null;
  }, [invoice.templateId, templates]);

  // Pre-fetch logo as Data URI via our server proxy to bypass CORS
  useEffect(() => {
    async function fetchLogo() {
      if (selectedTemplate?.logoUrl && isOpen) {
        setIsLogoLoading(true);
        try {
          const response = await fetch(`/api/proxy-image?url=${encodeURIComponent(selectedTemplate.logoUrl)}`);
          if (response.ok) {
            const dataUri = await response.text();
            setLogoDataUri(dataUri);
          } else {
            throw new Error('Proxy failed');
          }
        } catch (error) {
          console.error('Failed to proxy logo:', error);
          setLogoDataUri(selectedTemplate.logoUrl);
        } finally {
          setIsLogoLoading(false);
        }
      } else {
        setLogoDataUri(null);
      }
    }
    fetchLogo();
  }, [selectedTemplate, isOpen]);

  const handleDownloadPDF = async () => {
    if (isLogoLoading) {
        toast({ title: 'Please wait', description: 'Logo is still loading...' });
        return;
    }

    setIsExporting(true);
    try {
      const { default: jsPDF } = await import('jspdf');
      const { default: html2canvas } = await import('html2canvas');
      
      const element = document.getElementById('invoice-render-area');
      if (!element) return;

      const images = element.getElementsByTagName('img');
      const loadPromises = Array.from(images).map(img => {
        if (img.complete) return Promise.resolve();
        return new Promise(resolve => {
          img.onload = resolve;
          img.onerror = resolve;
        });
      });
      await Promise.all(loadPromises);

      await new Promise(resolve => setTimeout(resolve, 800));

      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        logging: false,
        backgroundColor: '#ffffff',
        imageTimeout: 15000,
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

  const hasSecondary = !!(invoice.secondaryCurrency && invoice.conversionRate);
  const rate = Number(invoice.conversionRate) || 1;
  
  const subtotalKWD = (invoice.items || []).reduce((acc, item) => acc + (item.amount * item.quantity), 0);
  const discountKWD = invoice.discountAmount || 0;
  
  const subtotalSec = subtotalKWD * rate;
  const discountSec = discountKWD * rate;
  const totalSec = invoice.totalAmount * rate;

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-0 overflow-hidden flex flex-col max-h-[95vh]">
        <DialogHeader className="p-6 border-b bg-muted/10 flex flex-row items-center justify-between space-y-0">
          <div>
            <DialogTitle>Invoice Details</DialogTitle>
            <p className="text-xs text-muted-foreground font-mono mt-1">{invoice.invoiceNumber}</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handlePrint} className="print:hidden">
              <Printer className="h-4 w-4 mr-2" /> Print
            </Button>
            <Button size="sm" onClick={handleDownloadPDF} disabled={isExporting || isLogoLoading} className="print:hidden">
              {isExporting || isLogoLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileDown className="h-4 w-4 mr-2" />}
              {isLogoLoading ? 'Preparing Logo...' : 'Download PDF'}
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto bg-slate-100 p-4 md:p-8 flex justify-center">
          <div id="invoice-render-area" className="bg-white w-[210mm] min-h-[297mm] shadow-xl p-8 flex flex-col font-sans">
            {/* Invoice Header - Optimized Spacing */}
            <div className="flex justify-between items-center border-b-2 border-slate-900 pb-4 mb-6">
              <div className="flex items-center">
                <div className="h-40 w-80 flex items-center justify-start overflow-hidden">
                  {logoDataUri ? (
                    <img 
                      src={logoDataUri} 
                      alt="Logo" 
                      style={{ width: 'auto', height: '100%', maxWidth: '100%' }}
                      crossOrigin="anonymous"
                    />
                  ) : selectedTemplate?.logoUrl ? (
                    <img 
                      src={selectedTemplate.logoUrl} 
                      alt="Logo" 
                      style={{ width: 'auto', height: '100%', maxWidth: '100%' }}
                      crossOrigin="anonymous"
                    />
                  ) : (
                    <GraduationCap className="h-16 w-16 text-slate-300" />
                  )}
                </div>
              </div>
              <div className="text-right">
                <h2 className="text-4xl font-black text-slate-900 uppercase tracking-tighter leading-none mb-2">INVOICE</h2>
                <div className="space-y-0.5">
                  <p className="text-base font-black text-slate-900">{invoice.invoiceNumber}</p>
                  <p className="text-xs font-black text-black">
                    DATE: {isClient ? formatDate(invoice.createdAt) : '...'}
                  </p>
                </div>
              </div>
            </div>

            {/* Information Grid - Highlighted Name */}
            <div className="mb-6">
              <div className="space-y-3 bg-slate-50/50 p-4 rounded-lg border border-dashed border-slate-200">
                <div className="flex gap-2 items-baseline">
                  <span className="text-[10px] font-black uppercase text-slate-500 shrink-0">Name:</span>
                  <p className="text-base font-black text-black bg-yellow-50 px-1">
                    {invoice.studentName}
                  </p>
                </div>
                <div className="mt-1 space-y-0.5 text-xs text-slate-700 font-bold">
                  <p>Phone Number: {invoice.studentPhone}</p>
                  {invoice.studentEmail && <p>Email: {invoice.studentEmail}</p>}
                </div>
              </div>
            </div>

            {/* Items Table - Dual Currency Layout */}
            <div className="flex-1">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-900 text-white">
                    <th className="py-2 px-4 text-[9px] font-black uppercase tracking-widest w-12">#</th>
                    <th className="py-2 px-2 text-[9px] font-black uppercase tracking-widest">Description</th>
                    <th className="py-2 px-2 text-[9px] font-black uppercase tracking-widest text-center">Qty</th>
                    <th className="py-2 px-4 text-[9px] font-black uppercase tracking-widest text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 border-b border-slate-900">
                  {(invoice.items || []).map((item, index) => {
                    const lineKWD = item.amount * item.quantity;
                    const lineSec = lineKWD * rate;
                    return (
                      <tr key={item.id} className="group">
                        <td className="py-3 px-4 text-[10px] font-mono text-slate-400 align-top">{index + 1}</td>
                        <td className="py-3 px-2 align-top">
                          <p className="font-black text-slate-900 text-xs uppercase">{item.description}</p>
                          {item.details && (
                            <p className="text-[9px] text-slate-500 italic mt-0.5 font-medium whitespace-pre-wrap leading-tight">
                              {item.details}
                            </p>
                          )}
                        </td>
                        <td className="py-3 px-2 text-center text-slate-700 font-bold text-xs align-top">{item.quantity}</td>
                        <td className="py-3 px-4 text-right align-top">
                          <div className="text-xs font-black text-slate-900">{lineKWD.toFixed(2)} KWD</div>
                          {hasSecondary && (
                            <div className="text-[9px] font-bold text-slate-500">{lineSec.toFixed(2)} {invoice.secondaryCurrency}</div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Financial Summary - Compact */}
            <div className="mt-4 pt-4 flex justify-end">
              <div className="w-72 space-y-1.5">
                <div className="flex justify-between text-[10px] font-bold px-3">
                  <span className="text-slate-400 uppercase tracking-widest">Subtotal</span>
                  <div className="text-right">
                    <div className="text-slate-900">{subtotalKWD.toFixed(2)} KWD</div>
                    {hasSecondary && <div className="text-slate-400 text-[9px]">{subtotalSec.toFixed(2)} {invoice.secondaryCurrency}</div>}
                  </div>
                </div>
                
                {discountKWD > 0 && (
                  <div className="flex justify-between text-[10px] font-bold px-3 text-red-600">
                    <div className="flex items-center gap-1">
                      <Tag className="h-2.5 w-2.5" />
                      <span className="uppercase tracking-widest">Discount</span>
                    </div>
                    <div className="text-right">
                      <div>-{discountKWD.toFixed(2)} KWD</div>
                      {hasSecondary && <div className="text-[9px]">-{discountSec.toFixed(2)} {invoice.secondaryCurrency}</div>}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between bg-slate-50 border-2 border-slate-900 p-3 rounded-lg mt-1">
                  <div className="flex flex-col">
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Total Due</span>
                    {hasSecondary && <span className="text-[8px] italic font-bold text-slate-400">Rate Applied</span>}
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-black text-slate-900 leading-none">{invoice.totalAmount.toFixed(2)} <span className="text-xs">KWD</span></div>
                    {hasSecondary && (
                      <div className="text-sm font-black text-slate-500 mt-0.5">
                        {totalSec.toFixed(2)} <span className="text-[10px]">{invoice.secondaryCurrency}</span>
                      </div>
                    )}
                  </div>
                </div>
                
                {hasSecondary && (
                  <p className="text-[8px] text-slate-400 italic text-right px-3">
                    Exchange: 1 KWD = {rate.toFixed(4)} {invoice.secondaryCurrency}
                  </p>
                )}
              </div>
            </div>

            {/* Footer Notes & Agency Details - Compact */}
            <div className="mt-auto pt-6">
              {invoice.notes && (
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 mb-4">
                  <h4 className="text-[9px] font-black uppercase text-slate-900 mb-1.5 tracking-widest flex items-center gap-2">
                    <MapPin className="h-2.5 w-2.5" />
                    Payment Instructions
                  </h4>
                  <p className="text-[10px] text-slate-700 italic font-medium leading-tight whitespace-pre-wrap">{invoice.notes}</p>
                </div>
              )}
              
              <div className="text-center border-t pt-4">
                <p className="text-[9px] text-slate-400 font-black uppercase tracking-[0.2em] mb-2">Thank you for your business</p>
                
                <div className="space-y-0.5 text-[10px] text-slate-600 font-medium mb-3">
                  <p className="whitespace-pre-wrap">
                    {selectedTemplate?.companyAddress || 'Kuwait City, State of Kuwait'}
                  </p>
                  <div className="flex items-center justify-center gap-4 mt-1">
                    <span className="flex items-center gap-1"><Mail className="h-2.5 w-2.5 opacity-50" /> {selectedTemplate?.companyEmail || 'contact@uniapplyhub.com'}</span>
                    <span className="flex items-center gap-1"><span className="opacity-50 text-[8px] font-bold">Phone Number:</span> {selectedTemplate?.companyPhone || '+965 [Agency Phone]'}</span>
                  </div>
                </div>

                <p className="text-[8px] text-slate-300 font-bold italic">© {new Date().getFullYear()}. Generated electronically.</p>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
