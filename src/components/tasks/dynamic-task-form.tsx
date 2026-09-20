
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import type { Student, RequestType, Application, ApprovedUniversity, Country, StudentLogin, UnifiedExamDate, UniversityCompany } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Calendar as CalendarIcon, GraduationCap, Building2, Search, Key, Paperclip, Users } from 'lucide-react';
import { addDays, format, startOfDay } from 'date-fns';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn, calculateAge } from '@/lib/utils';
import {
  COMPANY_LIMIT,
  buildCompanyLookup,
  countByCompany,
  schoolsAlreadyHeld,
  schoolsInOpenRequests,
  wouldExceedLimit,
} from '@/lib/school-quota';
import { UploadDocumentDialog } from '../student/upload-document-dialog';
import { Badge } from '../ui/badge';
import { useCollection } from '@/firebase/client';
import { useUser } from '@/hooks/use-user';
import { validateFile, ALLOWED_FILE_EXTENSIONS } from '@/lib/file-validation';
import { where } from 'firebase/firestore';
import { useState, useMemo, useEffect } from 'react';

interface DynamicTaskFormProps {
  student: Student;
  requestType: RequestType;
  onSubmit: (data: any) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

const COMPANY_ORDER: UniversityCompany[] = ['Into', 'Studygroup', 'Kaplan', 'OnCampus', 'Navitas', 'Other', 'Inhouse'];

/** Optional attachments on a UK First Year application. None of them is required. */
const FIRST_YEAR_ATTACHMENTS = [
  { key: 'shareCodeEvisa', label: 'Share Code + eVisa' },
  { key: 'casDocument', label: 'CAS (picture or PDF)' },
  { key: 'foundationTranscript', label: 'Foundation Transcript' },
] as const;

type TaskAttachment = { label: string; name: string; url: string };

/**
 * One optional attachment slot.
 *
 * The file goes to the student's own documents through the existing upload route, so
 * it lives on the profile as well as on this request — nothing is stranded inside a
 * task. The request keeps a link to it.
 */
function AttachmentSlot({
  student,
  label,
  value,
  onChange,
}: {
  student: Student;
  label: string;
  value: TaskAttachment | null;
  onChange: (next: TaskAttachment | null) => void;
}) {
  const { auth: authUser } = useUser();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    const check = validateFile(file);
    if (!check.isValid) { setError(check.message ?? 'Invalid file.'); return; }
    if (!authUser) { setError('Not signed in.'); return; }

    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('destination', 'student');
      fd.append('studentId', student.id);
      fd.append('customName', label);
      const token = await authUser.getIdToken();
      const res = await fetch('/api/upload', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result.error || 'Upload failed.');
      onChange({ label, name: result.document?.name || file.name, url: result.document?.url || '' });
    } catch (e: any) {
      setError(e?.message || 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1">
      <FormLabel className="text-xs font-semibold">{label} <span className="font-normal text-muted-foreground">(optional)</span></FormLabel>
      {value ? (
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5">
          <Paperclip className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="flex-1 truncate text-xs font-medium">{value.name}</span>
          <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => onChange(null)}>
            Remove
          </Button>
        </div>
      ) : (
        <Input
          type="file"
          className="text-xs"
          disabled={busy}
          accept={ALLOWED_FILE_EXTENSIONS}
          onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }}
        />
      )}
      {busy && <p className="flex items-center gap-1 text-[11px] text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Uploading…</p>}
      {error && <p className="text-[11px] font-semibold text-destructive">{error}</p>}
    </div>
  );
}
const COMPANY_COLORS: Record<string, string> = {
  Into:       'bg-blue-100 text-blue-800 border-blue-300',
  Studygroup: 'bg-violet-100 text-violet-800 border-violet-300',
  Kaplan:     'bg-red-100 text-red-800 border-red-300',
  OnCampus:   'bg-green-100 text-green-800 border-green-300',
  Navitas:    'bg-teal-100 text-teal-800 border-teal-300',
  Other:      'bg-gray-100 text-gray-700 border-gray-300',
  Inhouse:    'bg-amber-100 text-amber-800 border-amber-300',
};

// Default exam prices (KWD). TOEFL costs more than IELTS.
const IELTS_EXAM_PRICE = 94;
const TOEFL_EXAM_PRICE = 108;

const IELTS_COURSE_OPTIONS = [
  'One week "ielts" In-Person',
  'One week "ielts" Online',
  'One month "ielts" In-Person',
  'One on One class Inperson'
];

export function DynamicTaskForm({ student, requestType, onSubmit, onCancel, isSubmitting }: DynamicTaskFormProps) {
  const config = requestType.specialConfig;
  const [uniSearch, setUniSearch] = useState('');

  // Under-18 students need a parent/guardian on the IELTS/TOEFL exam registration.
  const studentAge = calculateAge(student.jotformData?.dob);
  const isMinor = studentAge != null && studentAge < 18;
  
  // Fetch master universities list
  const { data: globalUniversities, isLoading: unisLoading } = useCollection<ApprovedUniversity>(
    config?.useApprovedUniversitiesList ? 'approved_universities' : ''
  );

  // This student's own requests. Schools are chosen one request at a time, so five
  // separate open requests would otherwise slip past the company limit together.
  const { data: studentRequests } = useCollection<{ status?: string; category?: string; data?: unknown }>(
    config?.useApprovedUniversitiesList ? 'tasks' : '',
    where('studentId', '==', student.id),
  );

  // Fetch unified exam dates
  const { data: unifiedExamDates } = useCollection<UnifiedExamDate>(
    config?.examTypes?.includes('unified_exam') ? 'unified_exam_dates' : ''
  );
  const activeExamDates = (unifiedExamDates || []).filter(d => d.isActive);

  // Dynamic Schema Builder
  const schemaFields: any = {
    notes: z.string().optional(),
  };

  if (requestType.isSpecialTask && config) {
    if (config.examTypes?.includes('ielts') || config.examTypes?.includes('toefl')) {
      schemaFields.examType = z.enum(['ielts', 'toefl', 'ielts_retake', 'ielts_course'] as any).optional();
      schemaFields.ieltsSubtype = z.string().optional();
      // LRW (Listening/Reading/Writing) sitting time for a new IELTS/TOEFL exam.
      schemaFields.lrwTime = z.enum(['10:00 AM', '1:30 PM', '5:00 PM']).optional();
      schemaFields.requestedDate = z.date().optional();
      schemaFields.amount = z.coerce.number().optional();
      // Parent/guardian details (required at runtime for under-18 students).
      schemaFields.guardianFirstNameEn = z.string().optional();
      schemaFields.guardianLastNameEn = z.string().optional();
      schemaFields.guardianDob = z.string().optional();
      schemaFields.guardianPhone = z.string().optional();
      // Employee can supply the student DOB here when it's missing from the profile.
      schemaFields.studentDob = z.string().optional();
    }

    if (config.examTypes?.includes('ielts_retake')) {
      schemaFields.examType = z.literal('ielts_retake').optional();
      schemaFields.idpUsername = z.string().min(1, 'IDP Username is required');
      schemaFields.idpPassword = z.string().min(1, 'IDP Password is required');
      schemaFields.retakeSection = z.string({ required_error: 'Select a section to retake' });
      schemaFields.preferredDate = z.date({ required_error: 'Preferred date is required' });
      schemaFields.preferredTime = z.enum(['10:00 AM', '1:30 PM', '5:00 PM'], { required_error: 'Preferred time is required' });
      schemaFields.originalExamDate = z.date({ required_error: 'Original exam date is required' });
    }

    if (config.examTypes?.includes('ielts_course')) {
      schemaFields.examType = z.literal('ielts_course').optional();
      schemaFields.courseOption = z.string({ required_error: 'Please select a course option' });
      schemaFields.courseStartDate = z.date({ required_error: 'Course start date is required' });
    }

    if (config.examTypes?.includes('unified_exam')) {
      schemaFields.examType = z.literal('unified_exam').optional();
      schemaFields.unifiedExamDateId = z.string({ required_error: 'Please select an exam date' }).min(1, 'Please select an exam date');
      schemaFields.unifiedExamDateLabel = z.string().optional();
      schemaFields.unifiedExamDelivery = z.enum(['Online', 'In-Person'], { required_error: 'Please select Online or In-Person' });
    }

    if (config.studentInfo?.passportNameField) {
      schemaFields.passportName = z.string().optional();
    }
    if (config.documents?.allowSelection) {
      schemaFields.selectedDocuments = config.documents.requireAtLeastOne
        ? z.array(z.string()).min(1, 'Please select at least one document')
        : z.array(z.string()).default([]);
    }
    if (config.allowPortalReferenceSelection) {
      schemaFields.selectedPortalId = z.string().optional();
      schemaFields.selectedPortalDetails = z.any().optional();
    }
  }

  if (config?.requireUniversitySelection) {
    schemaFields.selectedApplicationId = z.string({ required_error: 'Please select a university application' }).min(1, 'Selection is required');
    schemaFields.selectedApplicationDetails = z.any().optional();
  }

  // Every First Year extra is optional by design — the employee fills in whatever the
  // student has so far, and the request is never blocked on a missing document.
  if (config?.firstYearUkFields) {
    schemaFields.ukPhone = z.string().optional();
    schemaFields.ukAddress = z.string().optional();
    schemaFields.reference1Name = z.string().optional();
    schemaFields.reference1Email = z.string().optional();
    schemaFields.reference2Name = z.string().optional();
    schemaFields.reference2Email = z.string().optional();
    schemaFields.attachments = z.array(z.any()).optional();
  }

  if (config?.useApprovedUniversitiesList) {
    if (config.allowMultipleUniversitySelection) {
      schemaFields.selectedGlobalUniversityIds = z.array(z.string()).min(1, 'Please select at least one university');
      schemaFields.selectedGlobalUniversities = z.array(z.any()).optional();
    } else {
      schemaFields.selectedGlobalUniversityId = z.string({ required_error: 'Please select a university from the list' }).min(1, 'Selection is required');
      schemaFields.selectedGlobalUniversityDetails = z.any().optional();
    }
  }

  const formSchema = z.object(schemaFields).refine(data => {
    if (data.examType === 'ielts' && config?.ielts) {
      if (config.ielts.showSubtypes && !data.ieltsSubtype) return false;
      if (config.ielts.showDates && !data.requestedDate) return false;
      if (config.ielts.showAmount && !data.amount) return false;
    }
    if (data.examType === 'toefl' && config?.ielts?.showAmount && !data.amount) return false;
    return true;
  }, {
    message: "Please fill in all required exam details.",
    path: ["examType"]
  }).refine(data => {
    // New IELTS/TOEFL exams must specify the LRW sitting time.
    if (data.examType !== 'ielts' && data.examType !== 'toefl') return true;
    return !!data.lrwTime;
  }, {
    message: "Please select the LRW time.",
    path: ["lrwTime"]
  }).refine(data => {
    // For under-18 students, parent/guardian info is mandatory on IELTS/TOEFL exams.
    if (!isMinor) return true;
    if (data.examType !== 'ielts' && data.examType !== 'toefl') return true;
    return !!(data.guardianFirstNameEn?.trim() && data.guardianLastNameEn?.trim() && data.guardianDob && data.guardianPhone?.trim());
  }, {
    message: "Parent/guardian details are required for students under 18.",
    path: ["guardianFirstNameEn"]
  });

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      notes: '',
      selectedDocuments: [],
      selectedGlobalUniversityIds: [],
      retakeSection: undefined,
      courseOption: undefined,
      idpUsername: '',
      idpPassword: '',
      preferredTime: undefined,
      lrwTime: undefined,
      originalExamDate: undefined,
      preferredDate: undefined,
      examType: config?.examTypes?.length === 1 ? config.examTypes[0] : undefined,
      // Pre-filled from the profile so a second application doesn't ask again.
      ukPhone: student.jotformData?.ukPhone || '',
      ukAddress: student.jotformData?.ukAddress || '',
      reference1Name: student.jotformData?.reference1Name || '',
      reference1Email: student.jotformData?.reference1Email || '',
      reference2Name: student.jotformData?.reference2Name || '',
      reference2Email: student.jotformData?.reference2Email || '',
      attachments: [],
      selectedApplicationId: '',
      selectedGlobalUniversityId: '',
      selectedPortalId: '',
      unifiedExamDateId: '',
      unifiedExamDateLabel: '',
      unifiedExamDelivery: undefined,
      amount: (config?.ielts?.showAmount) ? IELTS_EXAM_PRICE : undefined,
      // Pre-fill parent/guardian info from the student record so a returning
      // under-18 student doesn't need it re-entered every time.
      guardianFirstNameEn: student.jotformData?.guardianFirstNameEn ?? '',
      guardianLastNameEn: student.jotformData?.guardianLastNameEn ?? '',
      guardianDob: student.jotformData?.guardianDob ?? '',
      guardianPhone: student.jotformData?.guardianPhone ?? '',
      studentDob: student.jotformData?.dob ?? '',
    },
  });

  const watchExamType = form.watch('examType');

  // Age handling: the profile DOB may be missing. If so, the employee enters it here and
  // we derive age reactively from the entered value.
  const profileDob = student.jotformData?.dob;
  const watchStudentDob = form.watch('studentDob');
  const effectiveDob = profileDob || watchStudentDob;
  const effectiveAge = calculateAge(effectiveDob);
  const effectiveIsMinor = effectiveAge != null && effectiveAge < 18;
  const isExamTask = !!(requestType.isSpecialTask && config?.examTypes);
  // Parent/guardian details exist for one reason: the exam board requires them to register
  // an under-18 candidate for a NEW IELTS/TOEFL sitting. Courses, retakes and the unified
  // exam carry no such requirement, so they must never ask for a guardian — or for the DOB
  // that only exists to decide whether a guardian is needed.
  const isNewExamBooking = watchExamType === 'ielts' || watchExamType === 'toefl';
  const requiresGuardian = isNewExamBooking && effectiveIsMinor;
  const needsDobEntry = isNewExamBooking && !profileDob;

  // Block submission of a new exam booking until DOB is known, and require guardian info for minors.
  const handleGuardedSubmit = (values: any) => {
    if (isNewExamBooking) {
      if (!effectiveDob) {
        form.setError('studentDob', { type: 'manual', message: "Please add the student's date of birth." });
        return;
      }
      if (effectiveIsMinor) {
        const ok = values.guardianFirstNameEn?.trim() && values.guardianLastNameEn?.trim() && values.guardianDob && values.guardianPhone?.trim();
        if (!ok) {
          form.setError('guardianFirstNameEn', { type: 'manual', message: 'Parent/guardian details are required for students under 18.' });
          return;
        }
      }
    }
    onSubmit(values);
  };

  // Keep the exam price aligned with the chosen exam: TOEFL is 108 KWD, IELTS is 94 KWD.
  useEffect(() => {
    if (!config?.ielts?.showAmount) return;
    if (watchExamType === 'toefl') {
      form.setValue('amount', TOEFL_EXAM_PRICE);
    } else if (watchExamType === 'ielts') {
      form.setValue('amount', IELTS_EXAM_PRICE);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchExamType]);

  const watchDocs = form.watch('selectedDocuments') || [];
  const watchMultiUnis = form.watch('selectedGlobalUniversityIds') || [];

  // The company limit applies to Foundation students on any form that picks from the
  // approved list. It used to also require config.allowMultipleUniversitySelection,
  // which is not set on ANY request type — so the limit never actually ran.
  // skipCompanyLimit exempts a request type entirely — the First Year application is
  // not part of a pathway company's allocation.
  const companyLimitApplies =
    student.studyLevel === 'Foundation' &&
    !!config?.useApprovedUniversitiesList &&
    !config?.skipCompanyLimit;

  /** Which company each approved school belongs to, keyed so spelling variants agree. */
  const companyLookup = useMemo(() => buildCompanyLookup(globalUniversities || []), [globalUniversities]);

  /**
   * Schools the student ALREADY holds. Counted against the limit, so five Kaplan
   * schools spread over three separate requests is still five — and removing one from
   * the profile frees its place straight away.
   */
  const heldSchools = useMemo(
    () => (companyLimitApplies
      ? [
          ...schoolsAlreadyHeld(student.applications, companyLookup),
          ...schoolsInOpenRequests(studentRequests, companyLookup),
        ]
      : []),
    [companyLimitApplies, student.applications, studentRequests, companyLookup],
  );

  /** Everything counted: already held, plus what is being picked right now. */
  const companySchoolSets = useMemo(() => {
    if (!companyLimitApplies) return {} as Record<string, Set<string>>;
    const picked = (watchMultiUnis as string[])
      .map(id => globalUniversities?.find(g => g.id === id))
      .filter((u): u is ApprovedUniversity => !!u && !!u.company)
      .map((u: ApprovedUniversity) => ({ name: u.name, company: u.company as string }));
    return countByCompany([...heldSchools, ...picked]);
  }, [companyLimitApplies, watchMultiUnis, globalUniversities, heldSchools]);

  const companySchoolCounts = useMemo(
    () => Object.fromEntries(Object.entries(companySchoolSets).map(([k, v]) => [k, v.size])),
    [companySchoolSets],
  );

  /** Companies with no places left. */
  const fullCompanies = useMemo(
    () => Object.entries(companySchoolSets).filter(([, v]) => v.size >= COMPANY_LIMIT).map(([c]) => c),
    [companySchoolSets],
  );

  /** How many of a company's places were already taken before this request. */
  const heldCounts = useMemo(
    () => Object.fromEntries(Object.entries(countByCompany(heldSchools)).map(([k, v]) => [k, v.size])),
    [heldSchools],
  );

  const handleDocToggle = (docId: string) => {
    const current = form.getValues('selectedDocuments') || [];
    if (current.includes(docId)) {
      form.setValue('selectedDocuments', current.filter((id: string) => id !== docId));
    } else {
      form.setValue('selectedDocuments', [...current, docId]);
    }
  };

  const handleMultiUniToggle = (uni: ApprovedUniversity) => {
    const currentIds = form.getValues('selectedGlobalUniversityIds') || [];
    const currentDetails = form.getValues('selectedGlobalUniversities') || [];

    if (currentIds.includes(uni.id)) {
      form.setValue('selectedGlobalUniversityIds', currentIds.filter((id: string) => id !== uni.id));
      form.setValue('selectedGlobalUniversities', currentDetails.filter((d: any) => d.id !== uni.id));
    } else {
      // Enforce the company limit, counting the schools already on the student.
      if (companyLimitApplies && wouldExceedLimit(uni, companySchoolSets)) return;
      form.setValue('selectedGlobalUniversityIds', [...currentIds, uni.id]);
      form.setValue('selectedGlobalUniversities', [...currentDetails, {
        id: uni.id,
        name: uni.name,
        major: uni.major,
        country: uni.country,
        category: uni.category,
        company: uni.company,
      }]);
    }
  };

  const filteredGlobalUnis = useMemo(() => {
    if (!globalUniversities) return [];
    
    // Start with universities from the correct country (if filtered)
    let list = globalUniversities;
    
    if (config?.countryFilter && config.countryFilter !== 'all') {
      list = list.filter(u => u.country === config.countryFilter);
    }

    // Apply searchable keywords fuzzy logic
    if (uniSearch) {
      const searchWords = uniSearch.toLowerCase().trim().split(/\s+/).filter(Boolean);
      list = list.filter(u => {
        const uName = (u.name || '').toLowerCase();
        const uMajor = (u.major || '').toLowerCase();
        const uImportant = (u.importantNote || '').toLowerCase();
        return searchWords.every(word => uName.includes(word) || uMajor.includes(word) || uImportant.includes(word));
      });
    }

    return list.sort((a, b) => {
      const aComp = a.company ? COMPANY_ORDER.indexOf(a.company) : 99;
      const bComp = b.company ? COMPANY_ORDER.indexOf(b.company) : 99;
      if (aComp !== bComp) return aComp - bComp;
      const aSchool = a.schoolOrder ?? 999999;
      const bSchool = b.schoolOrder ?? 999999;
      if (aSchool !== bSchool) return aSchool - bSchool;
      const aMajor = a.majorOrder ?? 999999;
      const bMajor = b.majorOrder ?? 999999;
      if (aMajor !== bMajor) return aMajor - bMajor;
      return (a.name || '').localeCompare(b.name || '');
    }).slice(0, 500);
  }, [globalUniversities, uniSearch, config?.countryFilter]);

  const handleGlobalUniSelect = (uni: ApprovedUniversity) => {
    form.setValue('selectedGlobalUniversityId', uni.id);
    form.setValue('selectedGlobalUniversityDetails', {
      id: uni.id,
      name: uni.name,
      major: uni.major,
      country: uni.country,
      category: uni.category
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleGuardedSubmit)} className="space-y-6 py-4">
        {/* Student Info Read-Only Section */}
        <div className="bg-muted/30 p-4 rounded-lg border border-dashed space-y-3">
          <h4 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Student Information</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Name</p>
              <p className="font-semibold">{student.name}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Email</p>
              <p className="font-semibold">{student.email || 'N/A'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Phone</p>
              <p className="font-semibold">{student.phone}</p>
            </div>
          </div>
          {config?.studentInfo?.passportNameField && (
            <FormField
              control={form.control}
              name="passportName"
              render={({ field }) => (
                <FormItem className="pt-2">
                  <FormLabel>Passport Name (If different)</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter full name as shown on passport" {...field} />
                  </FormControl>
                  <FormDescription>Fill this if required for the official registration.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>

        {/* External Portal Reference Selection */}
        {config?.allowPortalReferenceSelection && (
          <div className="space-y-4 border-t pt-4">
            <FormLabel className="text-base font-bold flex items-center gap-2">
                <Key className="h-5 w-5 text-accent" />
                Select Portal Reference (Optional)
            </FormLabel>
            <FormField
              control={form.control}
              name="selectedPortalId"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormControl>
                    <RadioGroup
                      onValueChange={(val) => {
                        field.onChange(val);
                        const portal = student.studentLogins?.find(p => p.id === val);
                        if (portal) {
                          form.setValue('selectedPortalDetails', {
                            description: portal.description,
                            username: portal.username,
                            password: portal.password,
                            notes: portal.notes
                          });
                        } else {
                          form.setValue('selectedPortalDetails', null);
                        }
                      }}
                      value={field.value}
                      className="grid grid-cols-1 md:grid-cols-2 gap-3"
                    >
                      {student.studentLogins && student.studentLogins.length > 0 ? (
                        student.studentLogins.map((portal) => (
                          <FormItem key={portal.id} className="flex items-center space-x-3 space-y-0 border p-3 rounded-lg bg-background hover:bg-muted/20 transition-colors cursor-pointer">
                            <FormControl>
                              <RadioGroupItem value={portal.id} />
                            </FormControl>
                            <FormLabel className="font-medium cursor-pointer flex-1">
                              <span className="block text-sm font-bold">{portal.description}</span>
                              <span className="block text-[10px] text-muted-foreground truncate">{portal.username}</span>
                            </FormLabel>
                          </FormItem>
                        ))
                      ) : (
                        <div className="col-span-full text-center py-6 border rounded-lg border-dashed bg-muted/5">
                            <p className="text-xs text-muted-foreground italic">No portal references saved for this student.</p>
                        </div>
                      )}
                      {field.value && (
                        <Button 
                          type="button" 
                          variant="ghost" 
                          size="sm" 
                          className="h-7 text-[10px] font-bold text-destructive"
                          onClick={() => { field.onChange(''); form.setValue('selectedPortalDetails', null); }}
                        >
                          Clear Selection
                        </Button>
                      )}
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}

        {/* Existing Application Selection */}
        {config?.requireUniversitySelection && (
          <div className="space-y-4 border-t pt-4">
            <FormLabel className="text-base font-bold flex items-center gap-2">
                <GraduationCap className="h-5 w-5 text-primary" />
                Select Targeted University Application *
            </FormLabel>
            <FormField
              control={form.control}
              name="selectedApplicationId"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormControl>
                    <RadioGroup
                      onValueChange={(val) => {
                        field.onChange(val);
                        const [uni, major] = val.split('|');
                        const app = student.applications.find(a => a.university === uni && a.major === major);
                        if (app) {
                          form.setValue('selectedApplicationDetails', {
                            university: app.university,
                            major: app.major,
                            country: app.country,
                            status: app.status
                          });
                        }
                      }}
                      value={field.value}
                      className="grid grid-cols-1 gap-3"
                    >
                      {student.applications && student.applications.length > 0 ? (
                        student.applications.map((app, idx) => (
                          <FormItem key={idx} className="flex items-center space-x-3 space-y-0 border p-4 rounded-lg bg-background hover:bg-muted/20 transition-colors cursor-pointer">
                            <FormControl>
                              <RadioGroupItem value={`${app.university}|${app.major}`} />
                            </FormControl>
                            <FormLabel className="font-medium cursor-pointer flex-1 grid grid-cols-1 md:grid-cols-2 gap-2">
                              <div>
                                <span className="block text-sm font-bold">{app.university}</span>
                                <span className="block text-xs text-muted-foreground">{app.major}</span>
                              </div>
                              <div className="flex items-center gap-2 md:justify-end">
                                <Badge variant="outline" className="text-[10px] uppercase font-mono">{app.country}</Badge>
                                <Badge variant="secondary" className="text-[10px] uppercase">{app.status}</Badge>
                              </div>
                            </FormLabel>
                          </FormItem>
                        ))
                      ) : (
                        <div className="text-center py-8 border rounded-lg border-dashed bg-red-50 text-red-600">
                            <p className="text-sm font-bold">No active applications found for this student.</p>
                            <p className="text-xs mt-1">Please add a university application to the profile first.</p>
                        </div>
                      )}
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}

        {/* Master Universities List Selection */}
        {config?.useApprovedUniversitiesList && (
          <div className="space-y-4 border-t pt-4">
            <FormLabel className="text-base font-bold flex items-center gap-2">
                <Building2 className="h-5 w-5 text-primary" />
                {config.allowMultipleUniversitySelection ? 'Choose Multiple Schools/Majors *' : 'Choose School & Major from Approved List *'}
            </FormLabel>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search by school name, major, or important notes..." 
                className="pl-8"
                value={uniSearch}
                onChange={(e) => setUniSearch(e.target.value)}
              />
            </div>
            
            <div className="space-y-3">
              {/* Named up front, so the reason a school is greyed out is never a mystery. */}
              {companyLimitApplies && fullCompanies.length > 0 && (
                <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm">
                  <p className="font-bold text-red-800">
                    Limit reached for {fullCompanies.join(' and ')}.
                  </p>
                  <p className="text-xs text-red-700">
                    This student already has {COMPANY_LIMIT} schools with{' '}
                    {fullCompanies.length > 1 ? 'each of those companies' : fullCompanies[0]}, so those schools
                    cannot be chosen. Remove one from the student to free a place. Other companies are unaffected.
                  </p>
                </div>
              )}

              {/* Company quota summary — Foundation students only. Counts the schools
                  already on the student as well as the ones being picked here. */}
              {companyLimitApplies && Object.keys(companySchoolCounts).length > 0 && (
                <div className="flex flex-wrap gap-2 p-2 bg-muted/30 rounded-lg border text-xs">
                  <span className="font-bold text-muted-foreground w-full text-[10px] uppercase tracking-wide">
                    Company Limits — {COMPANY_LIMIT} schools each, including schools already on this student
                  </span>
                  {COMPANY_ORDER.filter(c => c !== 'Inhouse').map(company => {
                    const count = companySchoolCounts[company] || 0;
                    if (count === 0) return null;
                    const held = heldCounts[company] || 0;
                    const atLimit = count >= COMPANY_LIMIT;
                    return (
                      <Badge key={company} variant="outline" className={cn('text-[10px] font-bold', atLimit ? 'bg-red-100 text-red-800 border-red-400' : COMPANY_COLORS[company])}>
                        {company}: {count}/{COMPANY_LIMIT}
                        {held > 0 ? ` (${held} already)` : ''}
                        {atLimit ? ' FULL' : ''}
                      </Badge>
                    );
                  })}
                </div>
              )}

              {unisLoading ? (
                <div className="flex items-center justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : (
                <div className="grid grid-cols-1 gap-0 max-h-80 overflow-y-auto border rounded-lg bg-muted/5">
                  {filteredGlobalUnis.length > 0 ? (
                    filteredGlobalUnis.map((uni, idx) => {
                      const prevUni = filteredGlobalUnis[idx - 1];
                      const showGroupHeader = !prevUni || prevUni.company !== uni.company;
                      const isSelected = watchMultiUnis.includes(uni.id);

                      // Would picking this one break the company limit? Another major at
                      // a school already counted is always allowed — it takes no new place.
                      // This covers BOTH pickers: the multi-select one and the single
                      // checkbox below, which is what these forms actually render.
                      const singleSelected = form.watch('selectedGlobalUniversityId') === uni.id;
                      const alreadyChosen = isSelected || singleSelected;
                      const isDisabled =
                        !alreadyChosen && companyLimitApplies && wouldExceedLimit(uni, companySchoolSets);

                      return (
                        <div key={uni.id}>
                          {showGroupHeader && uni.company && (
                            <div className={cn('px-3 py-1.5 flex items-center justify-between border-b', COMPANY_COLORS[uni.company] || 'bg-muted/40')}>
                              <span className="text-[10px] font-black uppercase tracking-wider">{uni.company}</span>
                              {uni.company !== 'Inhouse' && companyLimitApplies && (
                                <span className={cn('text-[10px] font-bold', (companySchoolCounts[uni.company] || 0) >= COMPANY_LIMIT ? 'text-red-700' : 'opacity-70')}>
                                  {companySchoolCounts[uni.company] || 0}/{COMPANY_LIMIT} schools
                                </span>
                              )}
                            </div>
                          )}
                          <div className={cn('flex items-center space-x-3 border-b last:border-b-0 p-3 bg-background transition-colors', isDisabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-muted/20')}>
                            {config.allowMultipleUniversitySelection ? (
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => !isDisabled && handleMultiUniToggle(uni)}
                                disabled={isDisabled}
                              />
                            ) : (
                              <Checkbox
                                checked={singleSelected}
                                onCheckedChange={() => !isDisabled && handleGlobalUniSelect(uni)}
                                disabled={isDisabled}
                              />
                            )}
                            <div className="flex-1 flex flex-col md:flex-row md:items-center justify-between gap-2">
                              <div className="space-y-0.5">
                                <span className="block text-sm font-bold">{uni.name}</span>
                                <span className="block text-xs text-muted-foreground">{uni.major}</span>
                                {isDisabled && (
                                  <span className="block text-[11px] font-bold text-red-700">
                                    Limit reached — this student already has {COMPANY_LIMIT} {uni.company} schools.
                                    Remove one to add another.
                                  </span>
                                )}
                                {uni.importantNote && <span className="block text-[10px] text-red-600 font-black uppercase">⚠️ {uni.importantNote}</span>}
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <Badge variant="outline" className="text-[10px] font-mono">{uni.country}</Badge>
                                {uni.category !== 'General' && <Badge className={cn("text-[10px] font-bold", uni.category === 'Merit' ? "bg-yellow-500 text-black" : "bg-blue-600 text-white")}>{uni.category}</Badge>}
                                {!uni.isAvailable && <Badge variant="destructive" className="text-[10px]">CLOSED</Badge>}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-8 text-muted-foreground italic">
                      No matching universities found{config.countryFilter !== 'all' ? ` in ${config.countryFilter}` : ''}.
                    </div>
                  )}
                </div>
              )}
              {config.allowMultipleUniversitySelection && watchMultiUnis.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2">
                  <span className="text-xs font-bold text-muted-foreground">Selected:</span>
                  <Badge variant="secondary" className="bg-primary text-primary-foreground">{watchMultiUnis.length} choices</Badge>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Student age — shown as context on exam tasks. The guardian warning is reserved for
            a new IELTS/TOEFL booking, the only case that actually needs a parent. */}
        {isExamTask && (
          <div className={cn(
            "flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-bold",
            requiresGuardian ? "border-amber-300 bg-amber-50 text-amber-800" : "border-muted bg-muted/30 text-foreground"
          )}>
            <CalendarIcon className="h-4 w-4" />
            Student Age: {effectiveAge != null ? `${effectiveAge} years` : 'N/A (no date of birth on file)'}
            {requiresGuardian && <span className="uppercase tracking-wide text-[11px]">· Under 18 — guardian required</span>}
          </div>
        )}

        {/* Prompt the employee to add DOB when it's missing from the profile. */}
        {needsDobEntry && (
          <FormField
            control={form.control}
            name="studentDob"
            render={({ field }) => (
              <FormItem className="rounded-md border border-amber-300 bg-amber-50 p-3">
                <FormLabel className="font-bold text-amber-800">Student Date of Birth * (missing from profile)</FormLabel>
                <FormControl>
                  <Input type="date" max={new Date().toISOString().slice(0, 10)} className="max-w-[220px]" {...field} />
                </FormControl>
                <FormDescription className="text-amber-700">
                  This student has no date of birth on file. Add it to confirm their age{effectiveAge != null ? ` (currently ${effectiveAge})` : ''}. If under 18, parent/guardian details are required below. It will be saved to the profile.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {/* Exam Type Selection */}
        {requestType.isSpecialTask && config?.examTypes && config.examTypes.length > 1 && (
          <FormField
            control={form.control}
            name="examType"
            render={({ field }) => (
              <FormItem className="space-y-3">
                <FormLabel>Select Exam/Course Category *</FormLabel>
                <FormControl>
                  <RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="flex flex-col space-y-1">
                    {config.examTypes.map((type: string) => (
                      <FormItem key={type} className="flex items-center space-x-3 space-y-0">
                        <FormControl><RadioGroupItem value={type} /></FormControl>
                        <FormLabel className="font-normal uppercase">{type.replace('_', ' ')}</FormLabel>
                      </FormItem>
                    ))}
                  </RadioGroup>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        {/* IELTS / TOEFL Logic */}
        {(watchExamType === 'ielts' || watchExamType === 'toefl') && config && (
          <div className="space-y-4 border-t pt-4 animate-in fade-in">
            {watchExamType === 'ielts' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {config.ielts?.showSubtypes && (
                  <FormField
                    control={form.control}
                    name="ieltsSubtype"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="font-bold">IELTS Type *</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue placeholder="Select subtype" /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="academic">Academic</SelectItem>
                            <SelectItem value="ukvi">UKVI</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                {config.ielts?.showDates && (
                  <FormField
                    control={form.control}
                    name="requestedDate"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Requested Date *</FormLabel>
                        <Popover>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button variant={"outline"} className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>
                                {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                                <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start" onOpenAutoFocus={(e: Event) => e.preventDefault()}>
                            <Calendar
                              mode="single"
                              selected={field.value}
                              onSelect={field.onChange}
                              disabled={(date) => {
                                const today = startOfDay(new Date());
                                const rule = config.ielts?.dateRule || '5_days_from_today';
                                const minDate = rule === '5_days_from_today' ? addDays(today, 5) : today;
                                return date < minDate;
                              }}
                            />
                          </PopoverContent>
                        </Popover>
                        <FormDescription>Min 5 days from today.</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
                {config.ielts?.showAmount && (
                  <FormField
                    control={form.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Exam Price ({config.ielts.amountCurrency || 'KWD'}) *</FormLabel>
                        <FormControl><Input type="number" step="0.01" placeholder="0.00" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>
            )}
            {watchExamType === 'toefl' && config.ielts?.showAmount && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Exam Price ({config.ielts.amountCurrency || 'KWD'}) *</FormLabel>
                      <FormControl><Input type="number" step="0.01" placeholder="0.00" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            )}

            <FormField
              control={form.control}
              name="lrwTime"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel className="font-bold">LRW Time (Listening / Reading / Writing) *</FormLabel>
                  <FormControl>
                    <RadioGroup onValueChange={field.onChange} value={field.value} className="flex flex-wrap gap-4">
                      {['10:00 AM', '1:30 PM', '5:00 PM'].map((time) => (
                        <FormItem key={time} className="flex items-center space-x-2 space-y-0 border p-3 rounded-md">
                          <FormControl><RadioGroupItem value={time} /></FormControl>
                          <FormLabel className="font-medium cursor-pointer">{time}</FormLabel>
                        </FormItem>
                      ))}
                    </RadioGroup>
                  </FormControl>
                  <FormDescription>Preferred time for the Listening, Reading &amp; Writing sitting.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {requiresGuardian && (
              <div className="space-y-4 rounded-md border border-amber-300 bg-amber-50 p-4">
                <div className="space-y-0.5">
                  <p className="text-sm font-bold text-amber-800">
                    Parent / Guardian details required (student is {effectiveAge})
                  </p>
                  <p className="text-xs text-amber-700">
                    The student is under 18. Enter the parent/guardian information in English for the exam registration.
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="guardianFirstNameEn"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Parent First Name (English) *</FormLabel>
                        <FormControl><Input placeholder="First name" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="guardianLastNameEn"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Parent Last Name (English) *</FormLabel>
                        <FormControl><Input placeholder="Last name" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="guardianDob"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Parent Date of Birth *</FormLabel>
                        <FormControl>
                          <Input type="date" max={new Date().toISOString().slice(0, 10)} {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="guardianPhone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Parent Phone Number *</FormLabel>
                        <FormControl><Input type="tel" inputMode="tel" placeholder="Phone number" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* IELTS RETAKE LOGIC */}
        {watchExamType === 'ielts_retake' && config && (
          <div className="space-y-6 border-t pt-4 animate-in fade-in">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="idpUsername"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>IDP Username *</FormLabel>
                    <FormControl><Input placeholder="Enter username" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="idpPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>IDP Password *</FormLabel>
                    <FormControl><Input type="text" placeholder="Enter password" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="space-y-3">
              <FormLabel>Select Section to Retake *</FormLabel>
              <FormField
                control={form.control}
                name="retakeSection"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {['Listening', 'Reading', 'Writing', 'Speaking'].map((section) => (
                          <FormItem key={section} className="flex items-center space-x-2 space-y-0 border p-3 rounded-md">
                            <FormControl><RadioGroupItem value={section} /></FormControl>
                            <FormLabel className="font-medium cursor-pointer">{section}</FormLabel>
                          </FormItem>
                        ))}
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="originalExamDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Original Exam Date *</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button variant="outline" className={cn("pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>
                            {field.value ? format(field.value, "PPP") : <span>Select date</span>}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start" onOpenAutoFocus={(e: Event) => e.preventDefault()}>
                        <Calendar mode="single" selected={field.value} onSelect={field.onChange} disabled={(date) => date > new Date()} />
                      </PopoverContent>
                    </Popover>
                    <FormDescription>Date of the exam you wish to retake.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="preferredDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Preferred Exam Date *</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button variant="outline" className={cn("pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>
                            {field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start" onOpenAutoFocus={(e: Event) => e.preventDefault()}>
                        <Calendar mode="single" selected={field.value} onSelect={field.onChange} disabled={(date) => date < addDays(startOfDay(new Date()), 3)} />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="preferredTime"
                render={({ field }) => (
                  <FormItem className="space-y-3">
                    <FormLabel>Preferred Time *</FormLabel>
                    <FormControl>
                      <RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="flex gap-4">
                        {['10:00 AM', '1:30 PM', '5:00 PM'].map((time) => (
                          <FormItem key={time} className="flex items-center space-x-2 space-y-0">
                            <FormControl><RadioGroupItem value={time} /></FormControl>
                            <FormLabel className="font-normal">{time}</FormLabel>
                          </FormItem>
                        ))}
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
        )}

        {/* IELTS COURSE LOGIC */}
        {watchExamType === 'ielts_course' && config && (
          <div className="space-y-6 border-t pt-4 animate-in fade-in">
            <FormField
              control={form.control}
              name="courseOption"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel>Select Course Option *</FormLabel>
                  <FormControl>
                    <RadioGroup onValueChange={field.onChange} defaultValue={field.value} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {IELTS_COURSE_OPTIONS.map((option) => (
                        <FormItem key={option} className="flex items-center space-x-3 space-y-0 border p-4 rounded-lg bg-muted/20">
                          <FormControl><RadioGroupItem value={option} /></FormControl>
                          <FormLabel className="font-medium cursor-pointer">{option}</FormLabel>
                        </FormItem>
                      ))}
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="courseStartDate"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Course Start Date (Sundays Only) *</FormLabel>
                  <Popover>
                    <PopoverTrigger asChild>
                      <FormControl>
                        <Button variant="outline" className={cn("w-full pl-3 text-left font-normal", !field.value && "text-muted-foreground")}>
                          {field.value ? format(field.value, "PPP") : <span>Select a Sunday</span>}
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </FormControl>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start" onOpenAutoFocus={(e: Event) => e.preventDefault()}>
                      <Calendar mode="single" selected={field.value} onSelect={field.onChange} disabled={(date) => date.getDay() !== 0 || date < startOfDay(new Date())} />
                    </PopoverContent>
                  </Popover>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}

        {/* UNIFIED EXAM LOGIC */}
        {watchExamType === 'unified_exam' && config && (
          <div className="space-y-6 border-t pt-4 animate-in fade-in">
            <FormField
              control={form.control}
              name="unifiedExamDateId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Exam Date *</FormLabel>
                  <Select
                    onValueChange={(val) => {
                      field.onChange(val);
                      const selected = activeExamDates.find(d => d.id === val);
                      if (selected) form.setValue('unifiedExamDateLabel', selected.label);
                    }}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select an exam date" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {activeExamDates.length > 0 ? (
                        activeExamDates.map((d) => (
                          <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>
                        ))
                      ) : (
                        <SelectItem value="none" disabled>No exam dates available</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="unifiedExamDelivery"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel>Delivery Method *</FormLabel>
                  <FormControl>
                    <RadioGroup onValueChange={field.onChange} value={field.value} className="flex gap-6">
                      {['Online', 'In-Person'].map((method) => (
                        <FormItem key={method} className="flex items-center space-x-2 space-y-0 border px-4 py-3 rounded-lg bg-muted/20 cursor-pointer">
                          <FormControl><RadioGroupItem value={method} /></FormControl>
                          <FormLabel className="font-medium cursor-pointer">{method}</FormLabel>
                        </FormItem>
                      ))}
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}

        {/* UK First Year extras — every field optional. */}
        {config?.firstYearUkFields && (
          <div className="space-y-4 border-t pt-4">
            <FormLabel className="text-base font-bold flex items-center gap-2">
              <Paperclip className="h-5 w-5 text-primary" />
              Supporting Documents & UK Details
              <span className="text-xs font-normal text-muted-foreground">all optional</span>
            </FormLabel>

            <div className="grid gap-3 md:grid-cols-3">
              {FIRST_YEAR_ATTACHMENTS.map(slot => {
                const current: TaskAttachment[] = form.watch('attachments') || [];
                const existing = current.find(a => a.label === slot.label) ?? null;
                return (
                  <AttachmentSlot
                    key={slot.key}
                    student={student}
                    label={slot.label}
                    value={existing}
                    onChange={next => {
                      const rest = current.filter(a => a.label !== slot.label);
                      form.setValue('attachments', next ? [...rest, next] : rest);
                    }}
                  />
                );
              })}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <FormField control={form.control} name="ukPhone" render={({ field }) => (
                <FormItem>
                  <FormLabel>UK Phone Number</FormLabel>
                  <FormControl><Input placeholder="e.g. +44 7700 900000" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="ukAddress" render={({ field }) => (
                <FormItem>
                  <FormLabel>UK Address</FormLabel>
                  <FormControl><Input placeholder="Street, city, postcode" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>

            <div className="space-y-3">
              <FormLabel className="flex items-center gap-2 text-sm font-bold">
                <Users className="h-4 w-4 text-primary" />
                References
              </FormLabel>
              {[1, 2].map(n => (
                <div key={n} className="grid gap-4 md:grid-cols-2 rounded-md border bg-muted/20 p-3">
                  <FormField control={form.control} name={`reference${n}Name`} render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Reference {n} — Name</FormLabel>
                      <FormControl><Input placeholder="Full name" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name={`reference${n}Email`} render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Reference {n} — Email</FormLabel>
                      <FormControl><Input type="email" placeholder="name@school.edu" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Document Selection Section */}
        {config?.documents?.allowSelection && (
          <div className="space-y-4 border-t pt-4">
            <div className="flex items-center justify-between">
              <FormLabel>Select Documents</FormLabel>
              {config.documents.allowUpload && <UploadDocumentDialog student={student} initialCustomName="IELTS Invoice" />}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-48 overflow-y-auto p-2 border rounded-md bg-muted/10">
              {student.documents?.length > 0 ? (
                student.documents.map((doc) => (
                  <div key={doc.id} className="flex items-center space-x-3 p-2 rounded hover:bg-muted/50 transition-colors">
                    <Checkbox id={`doc-${doc.id}`} checked={watchDocs.includes(doc.id)} onCheckedChange={() => handleDocToggle(doc.id)} />
                    <label htmlFor={`doc-${doc.id}`} className="text-xs truncate cursor-pointer flex-1">{doc.name}</label>
                  </div>
                ))
              ) : <p className="text-xs text-muted-foreground col-span-2 text-center py-4">No documents available.</p>}
            </div>
          </div>
        )}

        <FormField
          control={form.control}
          name="notes"
          render={({ field }) => (
            <FormItem className="border-t pt-4">
              <FormLabel>Additional Notes</FormLabel>
              <FormControl><Textarea placeholder="Any specific instructions or context..." {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="sticky bottom-0 bg-background pt-4 border-t flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>Cancel</Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Submit Request
          </Button>
        </div>
      </form>
    </Form>
  );
}
