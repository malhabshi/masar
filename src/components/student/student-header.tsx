'use client';
import type { Student, User } from '@/lib/types';

export function StudentHeader({ student, currentUser }: { student: Student, currentUser: User }) {
    if (!student) return <div>Loading header...</div>
    return <h1>{student.name}</h1>;
}
