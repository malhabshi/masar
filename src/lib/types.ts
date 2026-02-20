
export type UserRole = 'admin' | 'employee' | 'department';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl: string;
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
  documentsSubmittedToMohe: boolean;
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

export interface RequestType {
  id: string;
  name: string;
  description: string;
  defaultRecipientId: string;
}
