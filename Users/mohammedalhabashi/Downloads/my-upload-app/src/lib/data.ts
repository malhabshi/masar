import type { User, Student, ChatMessage, TimeLog, Task, ResourceLink, UpcomingEvent, PersonalTodo, SharedDocument, ApprovedUniversity, RequestType } from './types';

// This file is intended for static data, but all dynamic application data,
// including users, students, etc., should be fetched from and managed in Firestore.
// The empty arrays below are kept as harmless fallbacks but should not be populated.

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
