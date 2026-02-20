'use client';

import { useUser } from '@/hooks/use-user';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

export default function SettingsPage() {
  const { user } = useUser();

  return (
    <div className="p-6">
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h3 className="font-medium mb-2">Your Profile</h3>
            <p>Name: {user?.name}</p>
            <p>Role: {user?.role}</p>
            <p>Civil ID: {user?.civilId}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
