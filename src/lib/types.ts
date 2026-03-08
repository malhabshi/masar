export type UserRole = 'admin' | 'employee' | 'department' | 'student';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl?: string;
  phone?: string;
  civilId?: string;
  employeeId?: string;
  studentId?: string; // Links a student user to a student profile
  department?: string; // UK, Finance, Document, etc.
}

export type ApplicationStatus = 'Pending' | 'Submitted' | 'In Review' | 'Accepted' | 'Rejected';
export type Country = 'UK' | 'USA' | 'Australia' | 'New Zealand';

export interface Application {
  university: string;
  major: string;
  country: Country;
  status: ApplicationStatus;
  updatedAt: string;
}

export interface Note {
  id: string;
  authorId: string;
  content: string;
  createdAt: string;
}

export interface Document {
  id: string;
  name: string; // Custom name or original filename
  originalName: string; // Always the original filename
  size: number; // File size in bytes
  url: string;
  uploadedAt: string;
  authorId: string;
  isNew?: boolean;
}

export type PipelineStatus = 'green' | 'orange' | 'red' | 'none';

export interface ProfileCompletionStatus {
  submitUniversityApplication: boolean;
  applyMoheScholarship: boolean;
  submitKcoRequest: boolean;
  receivedCasOrI20: boolean;
  appliedForVisa: boolean;
  visaGranted: boolean;
  documentsSubmittedToMohe: boolean;
  medicalFitnessSubmitted: boolean;
  financialStatementsProvided: boolean;
  readyToTravel: boolean;
}

export interface StudentLogin {
    id: string;
    description: string;
    username: string;
    password?: string;
    notes?: string;
    createdAt: string;
}

export interface Student {
  id: string;
  name: string;
  email: string;
  phone: string;
  internalNumber?: string; // Internal use number
  employeeId: string | null;
  applications: Application[];
  employeeNotes?: Note[];
  adminNotes?: Note[];
  documents: Document[];
  createdAt: string;
  createdBy: string;
  lastActivityAt?: string; // Timestamp of the last significant action
  lastInactivityReminderSentAt?: string; // Track recurring 3hr reminders
  targetCountries?: Country[];
  missingItems?: string[];
  pipelineStatus?: PipelineStatus;
  transferHistory?: {
    fromEmployeeId: string | null;
    toEmployeeId: string;
    date: string;
    transferredBy: string;
  }[];
  unreadUpdates?: number;
  employeeUnreadMessages?: number;
  newDocumentsForEmployee?: number;
  newDocumentsForAdmin?: number;
  newDocumentsForAdminCount?: number; // legacy
  newDocumentsForEmployeeCount?: number; // legacy
  newMissingItemsForEmployee?: number;
  finalChoiceUniversity?: string;
  ieltsOverall?: number;
  profileCompletionStatus?: ProfileCompletionStatus;
  transferRequested?: boolean;
  deletionRequested?: {
    requestedBy: string;
    reason: string;
    requestedAt: string;
    status: 'pending' | 'approved' | 'rejected';
  };
  isNewForEmployee?: boolean;
  studentLogins?: StudentLogin[];
  duplicatePhoneWarning?: boolean;
  duplicateOfStudentIds?: string[] | null;
  academicIntakeSemester?: string;
  academicIntakeYear?: number;
  changeAgentRequired?: boolean;
  term?: string;
}

export interface ChatMessage {
  id: string;
  authorId: string;
  content: string;
  timestamp: string;
  document?: {
    name: string;
    url: string;
  };
}

export interface TimeLog {
  id: string;
  employeeId: string;
  date: string;
  clockIn: string;
  clockOut?: string | null;
  lastSeen?: string;
  notes?: string;
}

export interface TaskReply {
  id: string;
  authorId: string;
  content: string;
  createdAt: string;
}

export type TaskStatus = 'new' | 'in-progress' | 'completed' | 'denied';

export interface TaskViewRecord {
  userId: string;
  userName: string;
  timestamp: string;
}

export interface TaskNotification {
  fromId: string;
  fromName: string;
  message: string;
  timestamp: string;
}

export interface Task {
  id: string;
  authorId: string;
  authorName?: string;
  recipientId: string | 'all'; 
  recipientIds?: string[];
  requestTypeId?: string;
  content: string;
  createdAt: string;
  status: TaskStatus;
  replies?: TaskReply[];
  studentId?: string;
  studentName?: string;
  studentPhone?: string;
  taskType?: string;
  type?: string;
  category?: 'update' | 'system' | 'request';
  data?: any;
  viewedBy?: TaskViewRecord[];
  notifications?: TaskNotification[];
  isPrioritized?: boolean;
}

export interface ResourceLink {
  id: string;
  title: string;
  description: string;
  url: string;
  authorId: string;
  createdAt: string;
}

export interface UpcomingEvent {
  id: string;
  title: string;
  date: string;
  description: string;
  authorId: string;
  createdAt: string;
}

export interface PersonalTodo {
  id: string;
  userId: string;
  content: string;
  completed: boolean;
  createdAt: string;
}

export interface SharedDocument {
  id: string;
  name: string;
  description: string;
  url: string;
  uploadedAt: string;
  authorId: string;
  country?: Country;
  size: number;
}

export interface RecipientConfig {
  type: 'user' | 'group' | 'department';
  id: string;
  name?: string;
}

export interface SpecialTaskConfig {
  examTypes: ('ielts' | 'toefl' | 'ielts_retake' | 'ielts_course')[];
  ielts: {
    showSubtypes: boolean;
    subtypes: ('academic' | 'ukvi')[];
    showDates: boolean;
    dateRule: '5_days_from_today' | 'any';
    showAmount: boolean;
    amountCurrency: string;
  };
  toefl: {
    showSubtypes: boolean;
    showDates: boolean;
    showAmount: boolean;
  };
  ielts_retake?: {
    showIdpCredentials: boolean;
    showSections: boolean;
    showPreferredTime: boolean;
    showOriginalDate: boolean;
  };
  ielts_course?: {
    showOptions: boolean;
    showSundaysOnly: boolean;
  };
  requireUniversitySelection?: boolean;
  useApprovedUniversitiesList?: boolean; // Toggles selection from Global Approved Universities
  allowMultipleUniversitySelection?: boolean; // Allow picking more than one school
  countryFilter?: Country | 'all'; // Filters the selection list by country
  allowPortalReferenceSelection?: boolean; // Optional selection of stored student logins
  studentInfo: {
    pullName: boolean;
    pullEmail: boolean;
    pullPhone: boolean;
    passportNameField: boolean;
  };
  documents: {
    allowSelection: boolean;
    requireAtLeastOne: boolean;
    allowUpload: boolean;
  };
  commonFields: {
    showNotes: boolean;
  };
}

export interface RequestType {
  id: string;
  name: string;
  description: string;
  recipients: RecipientConfig[];
  isActive: boolean;
  requiredFields: string[];
  isSpecialTask?: boolean;
  specialConfig?: SpecialTaskConfig;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
}

export interface ApplicationQuestion {
  id: string;
  questionText: string;
  questionType: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox';
  options?: string[];
  isRequired: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt?: string;
}

export interface ReportStats {
  totalStudents: number;
  totalApplications: number;
  totalEmployees: number;
  applicationStatusData: { name: string; count: number }[];
  studentEmployeeData: { name: string; count: number }[];
  studentGrowthData: { date: string; count: number }[];
  applicationCountryData: { name: string; count: number }[];
  employeeHoursData: { name: string; hours: number }[];
}

export interface EmployeeDailyCount {
  date: string;
  count: number;
}

export interface EmployeeMonthlyTotal {
  month: string;
  count: number;
}

export interface EmployeeStats {
  employeeId: string;
  employeeName: string;
  totalStudents: number;
  dailyCounts: EmployeeDailyCount[];
  monthlyTotals: EmployeeMonthlyTotal[];
}

export type NotificationType = 
  | 'new_task_assigned'
  | 'task_reply_received'
  | 'new_student_added'
  | 'student_assigned'
  | 'task_reminder'
  | 'admin_update'
  | 'document_uploaded_admin'
  | 'document_uploaded_employee'
  | 'document_uploaded_student'
  | 'task_status_in_progress'
  | 'task_status_completed'
  | 'task_status_denied'
  | 'ielts_course_registration'
  | 'ielts_retake_request'
  | 'payment_received'
  | 'scholarship_approved'
  | 'visa_update'
  | 'inactivity_reminder'
  | 'change_agent_enabled';

export interface NotificationTemplate {
  id: string;
  notificationType: NotificationType;
  templateName: string;
  message: string;
  webhookUrl?: string;
  variables: string[];
  variableMapping?: Record<string, string>; // Maps "1", "2", "3" to descriptive system variable names
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
}

export type UniversityCategory = 'MOHE' | 'Merit' | 'General';

export interface ApprovedUniversity {
  id: string;
  name: string;
  major: string;
  country: Country;
  ieltsScore: number;
  isAvailable: boolean;
  notes?: string;
  importantNote?: string; // High-priority red note
  category?: UniversityCategory;
  entryLevels?: string[]; // Foundation, First Year, Bachelor Degree
}

export interface AcademicTerm {
  id: string;
  name: string;
  startDate?: string;
  endDate?: string;
  isActive?: boolean;
  applicationDeadline?: string;
  createdAt?: string;
  authorId?: string;
}

export type InvoiceStatus = 'paid' | 'unpaid' | 'cancelled';

export interface InvoiceItem {
  id: string;
  description: string;
  details?: string;
  amount: number;
  quantity: number;
}

export interface InvoiceTemplate {
  id: string;
  name: string;
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  logoUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  templateId?: string;
  studentId: string;
  studentName: string;
  studentEmail?: string;
  studentPhone?: string;
  items: InvoiceItem[];
  totalAmount: number;
  discountAmount?: number;
  status: InvoiceStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  authorName?: string;
}
