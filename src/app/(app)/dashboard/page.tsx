'use client';

import { useUser } from '@/hooks/use-user';
import { Loader2 } from 'lucide-react';

// Import the new role-specific dashboard components
import AdminDashboard from '@/components/dashboard/admin-dashboard';
import EmployeeDashboard from '@/components/dashboard/employee-dashboard';
import DepartmentDashboard from '@/components/dashboard/department-dashboard';

function DashboardPageContent() {
    const { user: currentUser, isUserLoading: isCurrentUserLoading } = useUser();

    // The initial spinner only waits for the user to be identified.
    if (isCurrentUserLoading) {
        return (
            <div className="flex h-full w-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        );
    }
    
    if (!currentUser) return <p>You must be logged in to view the dashboard.</p>;
    
    // Render the appropriate dashboard based on the user's role.
    switch (currentUser.role) {
        case 'admin':
            return <AdminDashboard currentUser={currentUser} />;
        case 'employee':
            return <EmployeeDashboard currentUser={currentUser} />;
        case 'department':
            return <DepartmentDashboard currentUser={currentUser} />;
        default:
            return <p>Unknown user role. Cannot display dashboard.</p>;
    }
}

export default function DashboardPage() {
    return <DashboardPageContent />;
}
