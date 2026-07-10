'use client';

import { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import { useCollection } from '@/firebase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Loader2, Upload, Download, CheckCircle2, UserPlus, ListPlus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { bulkImportStudents } from '@/lib/actions';
import type { Student } from '@/lib/types';

interface ImportRow {
  arabicName: string;
  phone: string;
  phone2?: string;
  phone3?: string;
  civilId?: string;
  gender?: 'M' | 'F';
  country: string;
  major: string;
}

interface MatchedStudent {
  studentId: string;
  systemName: string;
  acceptedInfo: { country: string; major: string };
  phone2?: string; // merged extra numbers (original primary is kept untouched)
  phone3?: string;
}

interface NewStudent extends ImportRow {
  importListName: string;
}

interface ImportListDialogProps {
  creatingUserId: string;
}

function normalizePhone(p?: string) {
  if (!p) return '';
  return p.toString().replace(/\D/g, '').replace(/^965/, '');
}

function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['Arabic Name', 'Phone 1', 'Phone 2', 'Phone 3', 'Civil ID', 'Gender (M/F)', 'Country Accepted', 'Major Accepted'],
    ['محمد علي', '55001234', '99887766', '', '285031234', 'M', 'UK', 'Business Management'],
  ]);
  ws['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 24 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Import Template');
  XLSX.writeFile(wb, 'import_template.xlsx');
}

export function ImportListDialog({ creatingUserId }: ImportListDialogProps) {
  const { toast } = useToast();
  const { data: allStudents } = useCollection<Student>('students');
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [listName, setListName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [matched, setMatched] = useState<MatchedStudent[]>([]);
  const [newStudents, setNewStudents] = useState<NewStudent[]>([]);
  const [parseError, setParseError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  function handleReset() {
    setStep(1);
    setListName('');
    setMatched([]);
    setNewStudents([]);
    setParseError('');
    if (fileRef.current) fileRef.current.value = '';
  }

  function handleClose(open: boolean) {
    if (!open) handleReset();
    setIsOpen(open);
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    setParseError('');
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target!.result as ArrayBuffer);
        // CSV files carry no encoding metadata, so SheetJS guesses the codepage and
        // defaults to Latin-1 — which turns UTF-8 Arabic into mojibake ("Ø§Ù..."). Decode
        // CSV explicitly as UTF-8. XLSX/XLS embed their own encoding, so keep the byte path.
        const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
        const wb = isCsv
          ? XLSX.read(new TextDecoder('utf-8').decode(data), { type: 'string' })
          : XLSX.read(data, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

        // Skip header row
        const dataRows = rows.slice(1).filter(r => r.some(c => c !== ''));

        if (dataRows.length === 0) {
          setParseError('The file appears to be empty. Please use the template and fill in student data.');
          return;
        }

        const importRows: ImportRow[] = dataRows.map(r => ({
          arabicName: String(r[0] || '').trim(),
          phone: normalizePhone(String(r[1] || '')),
          phone2: normalizePhone(String(r[2] || '')) || undefined,
          phone3: normalizePhone(String(r[3] || '')) || undefined,
          civilId: String(r[4] || '').trim() || undefined,
          gender: (String(r[5] || '').toUpperCase() === 'M' ? 'M' : String(r[5] || '').toUpperCase() === 'F' ? 'F' : undefined) as 'M' | 'F' | undefined,
          country: String(r[6] || '').trim(),
          major: String(r[7] || '').trim(),
        })).filter(r => r.phone && r.country && r.major);

        if (importRows.length === 0) {
          setParseError('No valid rows found. Make sure Phone 1, Country, and Major columns are filled.');
          return;
        }

        // Build phone lookup for existing students
        const phoneToStudent = new Map<string, Student>();
        for (const s of allStudents ?? []) {
          if (s.phone) phoneToStudent.set(normalizePhone(s.phone), s);
          if (s.phone2) phoneToStudent.set(normalizePhone(s.phone2), s);
          if (s.phone3) phoneToStudent.set(normalizePhone(s.phone3), s);
        }

        const matchedList: MatchedStudent[] = [];
        const newList: NewStudent[] = [];
        const seenStudentIds = new Set<string>();

        for (const row of importRows) {
          const importPhones = [row.phone, row.phone2, row.phone3].filter(Boolean) as string[];
          let foundStudent: Student | undefined;
          for (const p of importPhones) {
            if (phoneToStudent.has(p)) { foundStudent = phoneToStudent.get(p)!; break; }
          }

          if (foundStudent) {
            if (!seenStudentIds.has(foundStudent.id)) {
              seenStudentIds.add(foundStudent.id);
              // Keep the student's ORIGINAL primary number (foundStudent.phone) as-is.
              // Add any new numbers from the import as extra numbers, without duplicates.
              const primaryNorm = normalizePhone(foundStudent.phone);
              const existingExtras = [foundStudent.phone2, foundStudent.phone3].map(normalizePhone).filter(Boolean);
              const importExtras = importPhones.map(normalizePhone).filter(Boolean);
              const mergedExtras = Array.from(new Set([...existingExtras, ...importExtras]))
                .filter(p => p && p !== primaryNorm);
              matchedList.push({
                studentId: foundStudent.id,
                systemName: foundStudent.name,
                acceptedInfo: { country: row.country, major: row.major },
                phone2: mergedExtras[0],
                phone3: mergedExtras[1],
              });
            }
          } else {
            newList.push({ ...row, importListName: listName });
          }
        }

        setMatched(matchedList);
        setNewStudents(newList);
        setStep(3);
      } catch (err) {
        setParseError('Failed to read the file. Please make sure it is a valid Excel (.xlsx) or CSV file.');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  async function handleConfirm() {
    setIsLoading(true);
    const result = await bulkImportStudents(
      listName,
      matched.map(m => ({ studentId: m.studentId, acceptedInfo: m.acceptedInfo, importListName: listName, phone2: m.phone2, phone3: m.phone3 })),
      newStudents.map(s => ({
        arabicName: s.arabicName,
        phone: s.phone,
        phone2: s.phone2,
        phone3: s.phone3,
        gender: s.gender,
        acceptedInfo: { country: s.country, major: s.major },
        importListName: s.importListName,
      })),
      creatingUserId,
    );
    setIsLoading(false);

    if (result.success) {
      toast({
        title: 'Import Complete',
        description: `${result.updated} existing student(s) updated · ${result.created} new profile(s) created.`,
      });
      handleClose(false);
    } else {
      toast({ variant: 'destructive', title: 'Import Failed', description: result.message });
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <ListPlus className="mr-2 h-4 w-4" />
          Import List
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Accepted Students List</DialogTitle>
        </DialogHeader>

        {/* Step 1: List name */}
        {step === 1 && (
          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <Label htmlFor="listName">List Name</Label>
              <Input
                id="listName"
                placeholder="e.g. MOHE June 2026"
                value={listName}
                onChange={e => setListName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">This name will appear in purple above new student names so you can identify which batch they came from.</p>
            </div>
            <div className="flex items-center gap-3 rounded-lg border p-4 bg-muted/30">
              <Download className="h-5 w-5 text-muted-foreground shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium">Download Template</p>
                <p className="text-xs text-muted-foreground">Fill in student data using the provided Excel template.</p>
              </div>
              <Button variant="secondary" size="sm" onClick={downloadTemplate}>Download</Button>
            </div>
            <Button className="w-full" disabled={!listName.trim()} onClick={() => setStep(2)}>
              Next: Upload File
            </Button>
          </div>
        )}

        {/* Step 2: Upload */}
        {step === 2 && (
          <div className="space-y-5 py-2">
            <p className="text-sm text-muted-foreground">
              List: <span className="font-semibold text-purple-600">{listName}</span>
            </p>
            <div className="space-y-2">
              <Label htmlFor="file">Upload Filled Excel / CSV</Label>
              <Input
                id="file"
                type="file"
                accept=".xlsx,.xls,.csv"
                ref={fileRef}
                onChange={handleFileUpload}
              />
              {parseError && <p className="text-xs text-destructive">{parseError}</p>}
            </div>
            <Button variant="ghost" className="w-full" onClick={() => setStep(1)}>Back</Button>
          </div>
        )}

        {/* Step 3: Preview & Confirm */}
        {step === 3 && (
          <div className="space-y-5 py-2">
            <p className="text-sm text-muted-foreground">
              List: <span className="font-semibold text-purple-600">{listName}</span>
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border p-4 space-y-1 bg-green-50 border-green-200">
                <div className="flex items-center gap-2 text-green-700">
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="font-semibold text-sm">Matched</span>
                </div>
                <p className="text-2xl font-bold text-green-700">{matched.length}</p>
                <p className="text-xs text-green-600">Existing profiles — accepted info will be added</p>
              </div>
              <div className="rounded-lg border p-4 space-y-1 bg-blue-50 border-blue-200">
                <div className="flex items-center gap-2 text-blue-700">
                  <UserPlus className="h-4 w-4" />
                  <span className="font-semibold text-sm">New</span>
                </div>
                <p className="text-2xl font-bold text-blue-700">{newStudents.length}</p>
                <p className="text-xs text-blue-600">New profiles will be created with "{listName}" label</p>
              </div>
            </div>

            {matched.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Matched Students</p>
                <div className="max-h-40 overflow-y-auto space-y-1 rounded-lg border p-2">
                  {matched.map(m => (
                    <div key={m.studentId} className="flex items-center justify-between text-sm px-1">
                      <span className="font-medium truncate">{m.systemName}</span>
                      <Badge variant="outline" className="text-[10px] shrink-0 ml-2">{m.acceptedInfo.country} · {m.acceptedInfo.major}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {newStudents.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">New Students</p>
                <div className="max-h-40 overflow-y-auto space-y-1 rounded-lg border p-2">
                  {newStudents.map((s, i) => (
                    <div key={i} className="flex items-center justify-between text-sm px-1">
                      <span className="font-medium truncate">{s.arabicName || s.phone}</span>
                      <Badge variant="outline" className="text-[10px] shrink-0 ml-2">{s.country} · {s.major}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setStep(2)}>Back</Button>
              <Button className="flex-1" onClick={handleConfirm} disabled={isLoading || (matched.length === 0 && newStudents.length === 0)}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirm Import
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
