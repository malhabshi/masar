

export type UserRole = 'admin' | 'employee' | 'department';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl?: string;
  phone?: string;
  civilId?: string;
  employeeId?: string;
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
  name: string;
  url: string;
  uploadedAt: string;
  authorId: string;
  isNew?: boolean;
}

export type PipelineStatus = 'green' | 'orange' | 'red' | 'none';

export interface IeltsScore {
  overall: number;
  listening: number;
  reading: number;
  writing: number;
  speaking: number;
  uploadedDocumentId?: string;
}

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

export interface Student {
  id: string;
  name: string;
  email: string;
  phone: string;
  employeeId: string | null;
  avatarUrl: string;
  applications: Application[];
  notes: Note[];
  documents: Document[];
  createdAt: string;
  createdBy?: string;
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
  ielts?: IeltsScore;
  profileCompletionStatus?: ProfileCompletionStatus;
  transferRequested?: boolean;
  deletionRequested?: boolean;
  isNewForEmployee?: boolean;
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
