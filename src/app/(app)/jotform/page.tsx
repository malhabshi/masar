'use client';

import { useState, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Send, CheckCircle2, RotateCcw, Paperclip, X } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const ACCEPTANCE_OPTIONS = ['Foundation', 'First Year', 'General English', 'ESL', 'ESL + Foundation', 'Masters'];
import { cn } from '@/lib/utils';
import { submitJotformApplications } from '@/lib/actions';
import { useUser } from '@/hooks/use-user';
import { firestore, storage } from '@/firebase/init';
import { doc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const STAFF_NAMES = [
  'طلال', 'محمد سليمان', 'خالد الشمري', 'يوسف سليمان', 'عبدالرحمن العنزي',
  'طلال العنزي', 'زينب دشتي', 'دنيا', 'عايشه', 'مريم العنزي',
  'حنان الكندري', 'فاطمه الشمري', 'خالد الهدهود',
];

const SCHOLARSHIP_OPTIONS = [
  'MOHE - التعليم العالي', 'خطة الايفاد', 'بعثه متميزه',
  'طلبة الثانويه العامه', 'PAEET - التطبيقي', 'Self Funded - حساب الخاص',
];

const COUNTRIES = ['UK', 'Australia / New Zealand', 'USA'];

const USA_SEMESTER_OPTIONS = ['Spring 2026 / 1', 'Summer 2026 / 6', 'Fall 2026/9'];

interface DocField {
  key: string;
  label: string;
  labelAr: string;
}

const DOC_FIELDS: DocField[] = [
  { key: 'passport',           label: 'Passport Photo *',                  labelAr: 'صورة الجواز' },
  { key: 'secondaryCerts',     label: 'Secondary Certificates (English) *', labelAr: 'صورة شهادات الثانوية' },
  { key: 'ieltsFile',          label: 'IELTS Test File',                   labelAr: 'اختبار الأيلتس' },
  { key: 'universityDegree',   label: 'University Degree / Diploma',       labelAr: 'الشهادة الجامعية أو الدبلوم' },
  { key: 'recommendationLetter', label: 'Recommendation Letter',           labelAr: 'رسالة تزكية' },
  { key: 'personalStatement',  label: 'Personal Statement',                labelAr: 'Personal Statement' },
  { key: 'otherFiles',         label: 'Other Files',                       labelAr: 'ملفات أخرى' },
];

const emptyFiles = (): Record<string, File[]> =>
  Object.fromEntries(DOC_FIELDS.map(f => [f.key, []]));

export default function JotformPage() {
  const { toast } = useToast();
  const { user } = useUser();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedTo, setSubmittedTo] = useState<string[] | null>(null);

  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [email, setEmail] = useState('');
  const [major, setMajor] = useState('');
  const [universities, setUniversities] = useState('');
  const [kuwaitAddress, setKuwaitAddress] = useState('');
  const [kuwaitPhone, setKuwaitPhone] = useState('');
  const [civilId, setCivilId] = useState('');
  const [schoolName, setSchoolName] = useState('');
  const [scholarshipType, setScholarshipType] = useState('');
  const [acceptanceType, setAcceptanceType] = useState('');
  const [ieltsScore, setIeltsScore] = useState('');
  const [followUpPerson, setFollowUpPerson] = useState('');
  const [guardianName, setGuardianName] = useState('');
  const [guardianEmail, setGuardianEmail] = useState('');
  const [guardianPhone, setGuardianPhone] = useState('');
  const [guardianDob, setGuardianDob] = useState('');
  const [semester, setSemester] = useState('');
  const [files, setFiles] = useState<Record<string, File[]>>(emptyFiles());

  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const isUK = selectedCountries.includes('UK');
  const isUSA = selectedCountries.includes('USA');
  const isUKorAUNZ = selectedCountries.includes('UK') || selectedCountries.includes('Australia / New Zealand');

  const toggleCountry = (c: string) =>
    setSelectedCountries(prev => prev.includes(c) ? prev.filter(x => x !== c) : [...prev, c]);

  const handleFileChange = (key: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (!picked.length) return;
    setFiles(prev => ({ ...prev, [key]: [...prev[key], ...picked] }));
    // Reset input so the same file can be re-added after removal if needed
    if (fileRefs.current[key]) fileRefs.current[key]!.value = '';
  };

  const removeFile = (key: string, index: number) => {
    setFiles(prev => ({ ...prev, [key]: prev[key].filter((_, i) => i !== index) }));
  };

  const handleReset = () => {
    setSubmittedTo(null);
    setSelectedCountries([]);
    setFirstName(''); setLastName(''); setDob(''); setEmail('');
    setMajor(''); setUniversities(''); setKuwaitAddress(''); setKuwaitPhone('');
    setCivilId(''); setSchoolName(''); setScholarshipType(''); setAcceptanceType('');
    setIeltsScore(''); setFollowUpPerson(''); setGuardianName('');
    setGuardianEmail(''); setGuardianPhone(''); setGuardianDob(''); setSemester('');
    setFiles(emptyFiles());
    Object.values(fileRefs.current).forEach(input => { if (input) input.value = ''; });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedCountries.length === 0) {
      toast({ variant: 'destructive', title: 'Select at least one country' });
      return;
    }
    if (isUKorAUNZ && !scholarshipType) {
      toast({ variant: 'destructive', title: 'Scholarship Type is required' });
      return;
    }
    if (isUKorAUNZ && !acceptanceType) {
      toast({ variant: 'destructive', title: 'Application Type is required' });
      return;
    }
    if (isUSA && !semester) {
      toast({ variant: 'destructive', title: 'Academic Semester is required for USA' });
      return;
    }
    if (isUSA && !guardianDob) {
      toast({ variant: 'destructive', title: "Guardian's Date of Birth is required for USA" });
      return;
    }
    if (!followUpPerson) {
      toast({ variant: 'destructive', title: 'Follow-up Person is required' });
      return;
    }
    if (!guardianName) {
      toast({ variant: 'destructive', title: "Guardian's Name is required" });
      return;
    }
    if (!guardianEmail) {
      toast({ variant: 'destructive', title: "Guardian's Email is required" });
      return;
    }
    if (!guardianPhone) {
      toast({ variant: 'destructive', title: "Guardian's Phone is required" });
      return;
    }
    if (kuwaitPhone.replace(/\D/g, '').length !== 8) {
      toast({ variant: 'destructive', title: 'Kuwaiti Phone must be 8 digits' });
      return;
    }
    if (isUKorAUNZ && civilId.replace(/\D/g, '').length !== 12) {
      toast({ variant: 'destructive', title: 'Civil ID must be 12 digits' });
      return;
    }
    if (guardianPhone.replace(/\D/g, '').length !== 8) {
      toast({ variant: 'destructive', title: "Guardian's Phone must be 8 digits" });
      return;
    }
    if (files['passport'].length === 0) {
      toast({ variant: 'destructive', title: 'Passport Photo is required' });
      return;
    }
    if (files['secondaryCerts'].length === 0) {
      toast({ variant: 'destructive', title: 'Secondary Certificates are required' });
      return;
    }

    setIsSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('selectedCountries', JSON.stringify(selectedCountries));
      fd.append('firstName', firstName);
      fd.append('lastName', lastName);
      fd.append('dob', dob);
      fd.append('email', email);
      fd.append('major', major);
      fd.append('universities', universities);
      fd.append('kuwaitAddress', kuwaitAddress);
      fd.append('kuwaitPhone', kuwaitPhone);
      fd.append('civilId', civilId);
      fd.append('schoolName', schoolName);
      fd.append('ieltsScore', ieltsScore);
      fd.append('followUpPerson', followUpPerson);
      fd.append('guardianName', guardianName);
      fd.append('guardianEmail', guardianEmail);
      fd.append('guardianPhone', guardianPhone);
      fd.append('scholarshipType', scholarshipType);
      fd.append('acceptanceType', acceptanceType);
      fd.append('semester', semester);
      fd.append('guardianDob', guardianDob);
      fd.append('creatingUserId', user?.id || '');
      fd.append('creatingUserCivilId', user?.civilId || '');

      // Append all files for each doc field (multiple per key)
      Object.entries(files).forEach(([key, fileList]) => {
        fileList.forEach(file => fd.append(key, file, file.name));
      });

      const { jotformResults, studentData } = await submitJotformApplications(fd);

      const failed = jotformResults.filter(r => !r.success).map(r => r.country);
      if (failed.length === 0) {
        // Create student profile client-side using authenticated Firestore SDK
        let studentCreated = false;
        if (studentData.firstName || studentData.lastName) {
          try {
            const now = new Date().toISOString();
            const idPrefix = studentData.creatingUserCivilId ? `U-${studentData.creatingUserCivilId}` : `S-${Math.random().toString(36).substring(2, 9)}`;
            const newStudentId = `${idPrefix}-${Date.now()}`;
            const studentDoc: Record<string, unknown> = {
              id: newStudentId,
              name: `${studentData.firstName} ${studentData.lastName}`.trim(),
              email: studentData.email || '',
              phone: studentData.phone || '',
              employeeId: studentData.employeeId,
              applications: [],
              employeeNotes: [],
              adminNotes: [],
              documents: [],
              createdAt: now,
              lastActivityAt: now,
              createdBy: user?.id || 'jotform',
              targetCountries: studentData.targetCountries,
              missingItems: [],
              pipelineStatus: 'none',
              isNewForEmployee: !!studentData.employeeId,
              jotform: true,
              academicIntakeSemester: 'September 2026',
              academicIntakeYear: 2026,
              profileCompletionStatus: {
                submitUniversityApplication: false,
                applyMoheScholarship: false,
                submitKcoRequest: false,
                receivedCasOrI20: false,
                appliedForVisa: false,
                documentsSubmittedToMohe: false,
                readyToTravel: false,
                financialStatementsProvided: false,
                visaGranted: false,
                medicalFitnessSubmitted: false,
              },
            };
            if (studentData.studyLevel) studentDoc.studyLevel = studentData.studyLevel;

            // Upload passport files and attach as named documents (admin section)
            const passportFiles = files['passport'] || [];
            const passportDocs = await Promise.all(
              passportFiles.map(async (file, i) => {
                const storagePath = `students/${newStudentId}/documents/${Date.now()}_${i}_${file.name}`;
                const storageRef = ref(storage, storagePath);
                await uploadBytes(storageRef, file);
                const url = await getDownloadURL(storageRef);
                return {
                  id: `passport-${Date.now()}-${i}`,
                  name: 'Passport',
                  originalName: file.name,
                  size: file.size,
                  url,
                  uploadedAt: now,
                  authorId: user?.id || 'jotform',
                };
              })
            );
            if (passportDocs.length > 0) studentDoc.documents = passportDocs;

            await setDoc(doc(firestore, 'students', newStudentId), studentDoc);
            studentCreated = true;
          } catch (err) {
            console.error('[Jotform] Client-side student creation failed:', err);
          }
        }

        setSubmittedTo(jotformResults.map(r => r.country));
        toast({
          title: 'Submitted!',
          description: `Sent to: ${jotformResults.map(r => r.country).join(', ')}${studentCreated ? ' — Student profile created.' : ''}`,
        });
      } else {
        toast({ variant: 'destructive', title: 'Partial failure', description: `Failed for: ${failed.join(', ')}` });
      }
    } catch {
      toast({ variant: 'destructive', title: 'Error', description: 'Something went wrong. Please try again.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submittedTo) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-5 text-center">
        <CheckCircle2 className="h-20 w-20 text-green-500" />
        <div>
          <h2 className="text-2xl font-bold">Application Submitted!</h2>
          <p className="text-muted-foreground mt-1">Successfully sent to: <strong>{submittedTo.join(', ')}</strong></p>
        </div>
        <Button onClick={handleReset} variant="outline" className="gap-2">
          <RotateCcw className="h-4 w-4" /> Submit Another Application
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-3xl mx-auto pb-12">
      <div>
        <h1 className="text-2xl font-bold">Jotform</h1>
        <p className="text-muted-foreground text-sm mt-1">Fill once — data will be sent to all selected country forms.</p>
      </div>

      {/* Country Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Target Countries *</CardTitle>
          <CardDescription>Select all countries this student is applying to</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3 flex-wrap">
            {COUNTRIES.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => toggleCountry(c)}
                className={cn(
                  'px-6 py-2.5 rounded-lg border-2 font-semibold transition-all text-sm',
                  selectedCountries.includes(c)
                    ? 'border-primary bg-primary text-primary-foreground shadow-md'
                    : 'border-border bg-background hover:border-primary/40 text-foreground'
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {selectedCountries.length > 0 && (
        <>
          {/* Application Details */}
          <Card>
            <CardHeader>
              <CardTitle>Application Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {isUKorAUNZ && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Scholarship Type (نوع البعثه) *</Label>
                    <Select value={scholarshipType} onValueChange={setScholarshipType}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent>
                        {SCHOLARSHIP_OPTIONS.map(opt => (
                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Application Type (نوع القبول / يرجى اختيار) *</Label>
                    <Select value={acceptanceType} onValueChange={setAcceptanceType}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select..." />
                      </SelectTrigger>
                      <SelectContent>
                        {ACCEPTANCE_OPTIONS.map(opt => (
                          <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {isUSA && (
                <div className="space-y-2">
                  <Label>Academic Semester (الفصل الدراسي) *</Label>
                  <Select value={semester} onValueChange={setSemester}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select semester..." />
                    </SelectTrigger>
                    <SelectContent>
                      {USA_SEMESTER_OPTIONS.map(opt => (
                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>IELTS Score</Label>
                  <Input value={ieltsScore} onChange={e => setIeltsScore(e.target.value)} placeholder="e.g. 6.5" />
                </div>
                <div className="space-y-2">
                  <Label>Follow-up Person *</Label>
                  <Select value={followUpPerson} onValueChange={setFollowUpPerson}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select person" />
                    </SelectTrigger>
                    <SelectContent>
                      {STAFF_NAMES.map(name => (
                        <SelectItem key={name} value={name}>{name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Student Info */}
          <Card>
            <CardHeader>
              <CardTitle>Student Information</CardTitle>
              <CardDescription>All fields as per passport, in English</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>First Name *</Label>
                  <Input value={firstName} onChange={e => setFirstName(e.target.value)} required placeholder="As in passport" />
                </div>
                <div className="space-y-2">
                  <Label>Last Name *</Label>
                  <Input value={lastName} onChange={e => setLastName(e.target.value)} required placeholder="As in passport" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Date of Birth *</Label>
                  <Input type="date" value={dob} onChange={e => setDob(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label>Email *</Label>
                  <Input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="student@email.com" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Major (in English) *</Label>
                  <Input value={major} onChange={e => setMajor(e.target.value)} required placeholder="e.g. Computer Science" />
                </div>
                <div className="space-y-2">
                  <Label>University Name(s) *</Label>
                  <Input value={universities} onChange={e => setUniversities(e.target.value)} required placeholder="e.g. University of London" />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Full Kuwaiti Address (in English) *</Label>
                <Input value={kuwaitAddress} onChange={e => setKuwaitAddress(e.target.value)} required placeholder="Block, Street, House No., Area" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Kuwaiti Phone Number *</Label>
                  <Input value={kuwaitPhone} onChange={e => setKuwaitPhone(e.target.value)} required placeholder="8-digit number" maxLength={8} inputMode="numeric" />
                </div>
                {isUKorAUNZ && (
                  <div className="space-y-2">
                    <Label>Civil ID Number *</Label>
                    <Input value={civilId} onChange={e => setCivilId(e.target.value)} required placeholder="12-digit Civil ID" maxLength={12} inputMode="numeric" />
                  </div>
                )}
              </div>
              {isUK && (
                <div className="space-y-2">
                  <Label>School Name (Secondary Stage) *</Label>
                  <Input value={schoolName} onChange={e => setSchoolName(e.target.value)} required placeholder="High school name" />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Guardian Info */}
          <Card>
            <CardHeader>
              <CardTitle>Guardian Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Guardian&apos;s Name (in English) *</Label>
                  <Input value={guardianName} onChange={e => setGuardianName(e.target.value)} required placeholder="Full name" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Guardian&apos;s Email *</Label>
                  <Input type="email" value={guardianEmail} onChange={e => setGuardianEmail(e.target.value)} required placeholder="guardian@email.com" />
                </div>
                <div className="space-y-2">
                  <Label>Guardian&apos;s Phone *</Label>
                  <Input value={guardianPhone} onChange={e => setGuardianPhone(e.target.value)} required placeholder="8-digit number" maxLength={8} inputMode="numeric" />
                </div>
              </div>
              {isUSA && (
                <div className="space-y-2">
                  <Label>Guardian&apos;s Date of Birth *</Label>
                  <Input type="date" value={guardianDob} onChange={e => setGuardianDob(e.target.value)} required />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Documents */}
          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
              <CardDescription>Upload student documents — all optional but will be attached to the Jotform submission</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {DOC_FIELDS.map(({ key, label, labelAr }) => (
                <div key={key} className="space-y-1.5">
                  <Label className="text-sm">
                    {label} <span className="text-muted-foreground text-xs">({labelAr})</span>
                  </Label>

                  {/* Uploaded files list */}
                  {files[key].length > 0 && (
                    <div className="space-y-1">
                      {files[key].map((file, i) => (
                        <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-md border bg-muted/30 text-sm">
                          <Paperclip className="h-3.5 w-3.5 text-primary shrink-0" />
                          <span className="truncate flex-1 text-foreground">{file.name}</span>
                          <button
                            type="button"
                            onClick={() => removeFile(key, i)}
                            className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* File picker — always visible so more files can be added */}
                  <input
                    type="file"
                    multiple
                    ref={el => { fileRefs.current[key] = el; }}
                    onChange={e => handleFileChange(key, e)}
                    className="block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={isSubmitting} size="lg" className="gap-2 font-bold px-8">
              {isSubmitting
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Submitting...</>
                : <><Send className="h-4 w-4" /> Submit to {selectedCountries.join(' + ')}</>
              }
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
