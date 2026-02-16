
import type { User, Student, ChatMessage, TimeLog, Task, ResourceLink, UpcomingEvent, PersonalTodo, SharedDocument, ApprovedUniversity, RequestType } from './types';

export const users: User[] = [
  {
    id: 'user-1',
    name: 'Admin User',
    email: 'admin@uniapply.hub',
    role: 'admin',
    avatarUrl: 'https://picsum.photos/seed/u1/100/100',
    phone: '+96597730579',
    civilId: '111111111111',
    employeeId: '11111',
  },
  {
    id: 'user-2',
    name: 'Brenda Smith',
    email: 'brenda@uniapply.hub',
    role: 'employee',
    avatarUrl: 'https://picsum.photos/seed/u2/100/100',
    phone: '+15555555552',
    civilId: '222222222222',
    employeeId: '22222',
  },
  {
    id: 'user-3',
    name: 'John Doe',
    email: 'john@uniapply.hub',
    role: 'employee',
    avatarUrl: 'https://picsum.photos/seed/u3/100/100',
    phone: '+15555555553',
    civilId: '333333333333',
    employeeId: '33333',
  },
  {
    id: 'user-4',
    name: 'Diane Green',
    email: 'diane@uniapply.hub',
    role: 'department',
    avatarUrl: 'https://picsum.photos/seed/u4/100/100',
    phone: '+15555555554',
    civilId: '444444444444',
    employeeId: '44444',
  },
  {
    id: 'user-5',
    name: 'Charles Bing',
    email: 'charles@uniapply.hub',
    role: 'admin',
    avatarUrl: 'https://picsum.photos/seed/u5/100/100',
    phone: '+15555555555',
    civilId: '555555555555',
    employeeId: '55555',
  },
];

// The following data is now managed in Firestore and is kept here only as a fallback or for initial structure reference.
export const academicTerms: string[] = [];
export const students: Student[] = [];
export const chatMessages: Record<string, ChatMessage[]> = {};
export const applicationQuestions: string[] = [];
export const timeLogs: TimeLog[] = [];
export const tasks: Task[] = [];
export const upcomingEvents: UpcomingEvent[] = [];
export const personalTodos: PersonalTodo[] = [];
export const sharedDocuments: SharedDocument[] = [];
export const approvedUniversities: ApprovedUniversity[] = [];
export const requestTypes: RequestType[] = [];
export const resourceLinks: ResourceLink[] = [];
