import { Timestamp } from 'firebase/firestore';

// Universal function to safely convert any value to a Date
export function toDate(value: any): Date | null {
  if (!value) return null;
  
  // Firestore Timestamp
  if (value instanceof Timestamp) {
    return value.toDate();
  }
  
  // Date object
  if (value instanceof Date) {
    return value;
  }
  
  // String or number
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }
  
  // Object with toDate method (like Firestore Timestamp)
  if (value && typeof value.toDate === 'function') {
    return value.toDate();
  }
  
  return null;
}

// Format date safely
export function formatDate(value: any): string {
  const date = toDate(value);
  if (!date) return '';
  
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

// Format date with time
export function formatDateTime(value: any): string {
  const date = toDate(value);
  if (!date) return '';
  
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// Format relative time (e.g., "2 hours ago")
export function formatRelativeTime(value: any): string {
  const date = toDate(value);
  if (!date) return '';
  
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);
  
  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  if (diffHour < 24) return `${diffHour} hour${diffHour === 1 ? '' : 's'} ago`;
  if (diffDay < 7) return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
  
  return formatDate(date);
}

// Safe sort function for dates
export function sortByDate(a: any, b: any, field: string = 'createdAt', direction: 'asc' | 'desc' = 'desc'): number {
  const dateA = toDate(a[field])?.getTime() || 0;
  const dateB = toDate(b[field])?.getTime() || 0;
  
  return direction === 'asc' ? dateA - dateB : dateB - dateA;
}