'use client';

import { useState, useEffect } from 'react';
import { useUser } from '@/hooks/use-user';
import { useCollection } from '@/firebase/client';
import { firestore } from '@/firebase';
import { collection, addDoc, deleteDoc, doc, updateDoc, setDoc, getDoc } from 'firebase/firestore';
import type { GpaMajor, Country } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Plus, Trash2, Save } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
const COUNTRIES: Country[] = ['UK', 'USA', 'Australia', 'New Zealand', 'Ireland'];

export default function GpaSettingsPage() {
  const { user } = useUser();
  const { toast } = useToast();

  const [logoSrc, setLogoSrc] = useState<string | null>(null);
  const [pageTitle, setPageTitle] = useState('');
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const [isTitleLoaded, setIsTitleLoaded] = useState(false);

  const [instagram, setInstagram] = useState('');
  const [tiktok, setTiktok] = useState('');
  const [companyEmail, setCompanyEmail] = useState('');
  const [isSavingCompanyInfo, setIsSavingCompanyInfo] = useState(false);

  const [labelExamBadge, setLabelExamBadge] = useState('EXAM');
  const [isSavingLabels, setIsSavingLabels] = useState(false);

  const [newName, setNewName] = useState('');
  const [newCountry, setNewCountry] = useState<Country | ''>('');
  const [newRequired, setNewRequired] = useState('');
  const [requiresExam, setRequiresExam] = useState(false);
  const [isAdding, setIsAdding] = useState(false);

  const { data: majors, isLoading } = useCollection<GpaMajor>('gpa_majors');

  useEffect(() => {
    try {
      const saved = localStorage.getItem('gpaLogo');
      if (saved) setLogoSrc(saved);
    } catch {}
    getDoc(doc(firestore, 'gpa_settings', 'config'))
      .then(snap => {
        if (snap.exists()) {
          const d = snap.data();
          setPageTitle(d.pageTitle || '');
          setInstagram(d.instagram || '');
          setTiktok(d.tiktok || '');
          setCompanyEmail(d.email || '');
          setLabelExamBadge(d.labelExamBadge || 'EXAM');
        }
        setIsTitleLoaded(true);
      })
      .catch(() => setIsTitleLoaded(true));
  }, []);

  if (!user || !['admin', 'adminplus'].includes(user.role)) {
    return <div className="p-8 text-center text-muted-foreground">Access Denied.</div>;
  }

  const handleSaveTitle = async () => {
    if (!pageTitle.trim()) return;
    setIsSavingTitle(true);
    try {
      await setDoc(doc(firestore, 'gpa_settings', 'config'), { pageTitle: pageTitle.trim() }, { merge: true });
      toast({ title: 'Title saved' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Failed to save', description: e.message });
    } finally {
      setIsSavingTitle(false);
    }
  };

  const handleSaveCompanyInfo = async () => {
    setIsSavingCompanyInfo(true);
    try {
      await setDoc(doc(firestore, 'gpa_settings', 'config'), {
        instagram: instagram.trim(),
        tiktok: tiktok.trim(),
        email: companyEmail.trim(),
      }, { merge: true });
      toast({ title: 'Company info saved' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Failed to save', description: e.message });
    } finally {
      setIsSavingCompanyInfo(false);
    }
  };

  const handleSaveLabels = async () => {
    setIsSavingLabels(true);
    try {
      await setDoc(doc(firestore, 'gpa_settings', 'config'), {
        labelExamBadge: labelExamBadge.trim() || 'EXAM',
      }, { merge: true });
      toast({ title: 'Labels saved' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Failed to save', description: e.message });
    } finally {
      setIsSavingLabels(false);
    }
  };

  const handleAddMajor = async () => {
    if (!newName.trim() || !newCountry || !newRequired) return;
    const req = parseFloat(newRequired);
    if (isNaN(req) || req < 0 || req > 100) return;
    setIsAdding(true);
    try {
      await addDoc(collection(firestore, 'gpa_majors'), {
        name: newName.trim(),
        country: newCountry,
        requiredPercentage: req,
        requiresUnifiedExam: requiresExam,
        createdAt: new Date().toISOString(),
      });
      setNewName('');
      setNewCountry('');
      setNewRequired('');
      setRequiresExam(false);
      toast({ title: 'Major added' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Failed to add', description: e.message });
    } finally {
      setIsAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(firestore, 'gpa_majors', id));
      toast({ title: 'Major removed' });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Failed to delete', description: e.message });
    }
  };

  const handleToggleExam = async (id: string, current: boolean) => {
    try {
      await updateDoc(doc(firestore, 'gpa_majors', id), { requiresUnifiedExam: !current });
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Failed to update', description: e.message });
    }
  };

  const sorted = [...(majors || [])].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold">GPA Calculator Settings</h1>
        <p className="text-muted-foreground mt-1">
          Configure the page title and manage major requirements shown on the GPA calculator.
        </p>
      </div>

      {/* Logo Upload */}
      <Card>
        <CardHeader>
          <CardTitle>Page Logo</CardTitle>
          <CardDescription>Upload a logo to display on the GPA calculator page. Saved locally on this device.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {logoSrc && (
            <div className="flex items-center gap-4">
              <img src={logoSrc} alt="Current logo" className="h-16 w-16 object-contain border rounded-lg p-1 bg-muted/30" />
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  try { localStorage.removeItem('gpaLogo'); } catch {}
                  setLogoSrc(null);
                }}
              >
                Remove
              </Button>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="logo-upload">Upload Image</Label>
            <Input
              id="logo-upload"
              type="file"
              accept="image/*"
              onChange={e => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = ev => {
                  const result = ev.target?.result as string;
                  try { localStorage.setItem('gpaLogo', result); } catch {}
                  setLogoSrc(result);
                };
                reader.readAsDataURL(file);
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Page Title */}
      <Card>
        <CardHeader>
          <CardTitle>Page Title</CardTitle>
          <CardDescription>Displayed at the top of the GPA calculator page.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="e.g. Kuwait University GPA Calculator"
              value={pageTitle}
              disabled={!isTitleLoaded}
              onChange={e => setPageTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSaveTitle(); }}
            />
            <Button onClick={handleSaveTitle} disabled={isSavingTitle || !pageTitle.trim()}>
              {isSavingTitle ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Company Info */}
      <Card>
        <CardHeader>
          <CardTitle>Company Info</CardTitle>
          <CardDescription>Displayed in the PDF footer — Instagram handle, TikTok handle, and company email.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Instagram Handle</Label>
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-muted-foreground">@</span>
                <Input
                  placeholder="yourhandle"
                  value={instagram}
                  onChange={e => setInstagram(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>TikTok Handle</Label>
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-muted-foreground">@</span>
                <Input
                  placeholder="yourhandle"
                  value={tiktok}
                  onChange={e => setTiktok(e.target.value)}
                />
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Company Email</Label>
            <Input
              type="email"
              placeholder="info@yourcompany.com"
              value={companyEmail}
              onChange={e => setCompanyEmail(e.target.value)}
            />
          </div>
          <Button onClick={handleSaveCompanyInfo} disabled={isSavingCompanyInfo}>
            {isSavingCompanyInfo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Company Info
          </Button>
        </CardContent>
      </Card>

      {/* Labels */}
      <Card>
        <CardHeader>
          <CardTitle>Labels</CardTitle>
          <CardDescription>Customize text labels shown on the GPA calculator page and PDF.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Unified Exam Badge Text</Label>
            <p className="text-xs text-muted-foreground">Shown next to majors that require the unified exam (e.g. "EXAM", "اختبار وطني").</p>
            <div className="flex gap-2">
              <Input
                placeholder="EXAM"
                value={labelExamBadge}
                onChange={e => setLabelExamBadge(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveLabels(); }}
              />
              <Button onClick={handleSaveLabels} disabled={isSavingLabels}>
                {isSavingLabels ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Add Major */}
      <Card>
        <CardHeader>
          <CardTitle>Add Major</CardTitle>
          <CardDescription>
            Add a major with its required high school cumulative percentage. Toggle "Requires Unified Exam" for medicine, dentistry, and engineering majors.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Major Name</Label>
              <Input
                placeholder="e.g. Medicine"
                value={newName}
                onChange={e => setNewName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Country</Label>
              <Select value={newCountry} onValueChange={v => setNewCountry(v as Country)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select country..." />
                </SelectTrigger>
                <SelectContent>
                  {COUNTRIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 items-end">
            <div className="space-y-2">
              <Label>Required Cumulative % (0–100)</Label>
              <Input
                type="number" min={0} max={100} step={0.01}
                placeholder="e.g. 85"
                value={newRequired}
                onChange={e => setNewRequired(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-3 pb-2">
              <Switch id="requires-exam" checked={requiresExam} onCheckedChange={setRequiresExam} />
              <Label htmlFor="requires-exam">Requires Unified Exam</Label>
            </div>
          </div>
          <Button
            onClick={handleAddMajor}
            disabled={isAdding || !newName.trim() || !newCountry || !newRequired}
          >
            {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add Major
          </Button>
        </CardContent>
      </Card>

      {/* Majors List */}
      <Card>
        <CardHeader><CardTitle>Majors</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : sorted.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No majors added yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Major</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead className="text-center">Required %</TableHead>
                  <TableHead className="text-center">Unified Exam</TableHead>
                  <TableHead className="w-[60px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map(m => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell>{m.country}</TableCell>
                    <TableCell className="text-center font-mono">{m.requiredPercentage}%</TableCell>
                    <TableCell className="text-center">
                      <div className="flex justify-center">
                        <Switch
                          checked={m.requiresUnifiedExam}
                          onCheckedChange={() => handleToggleExam(m.id, m.requiresUnifiedExam)}
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(m.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
