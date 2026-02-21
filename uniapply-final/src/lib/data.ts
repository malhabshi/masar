// This file is kept for structural reference only.
// All application data should be fetched directly from Firestore.
// Do not add mock or fallback data here as it will cause inconsistencies.

import type { User, Student, ChatMessage, TimeLog, Task, ResourceLink, UpcomingEvent, PersonalTodo, SharedDocument, ApprovedUniversity, RequestType } from './types';

// All data collections are intentionally left empty.
// Data is managed exclusively through Firestore to ensure consistency.
export const users: User[] = [];
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
