






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
    uid: string;
    email: string;
    createdAt: string;
}

export interface Student {
  id: string;
  name: string;
  email: string;
  phone: string;
  employeeId: string | null;
  applications: Application[];
  employeeNotes?: Note[];
  adminNotes?: Note[];
  documents: Document[];
  createdAt: string;
  createdBy: string;
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
  term?: string;
  studentLogins?: StudentLogin[];
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

export type TaskStatus = 'new' | 'in-progress' | 'completed' | 'archived';

export interface Task {
  id: string;
  authorId: string;
  recipientId: string | 'all';
  content: string;
  createdAt: string;
  status: TaskStatus;
  replies?: TaskReply[];
  studentId?: string;
  studentName?: string;
  taskType?: string;
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
}

export interface ApprovedUniversity {
  id: string;
  country: Country;
  name: string;
  major: string;
  ieltsScore: number;
  isAvailable: boolean;
}

export interface RequestType {
  id: string;
  name: string;
  description: string;
  defaultRecipientId: string;
  isActive: boolean;
  requiredFields: string[];
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
