'use client';

import { Button } from '@/components/ui/button';
import { UploadCloud } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function StudentPage() {
  return (
    <Card className="max-w-4xl mx-auto">
      <CardHeader>
        <CardTitle className="text-3xl">Student Profile</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p>Hello! This is a simple student page to resolve the loading error.</p>
        <Button asChild>
          <a href="https://file-upload-app-omega.vercel.app/upload-page" target="_blank" rel="noopener noreferrer">
            <UploadCloud className="mr-2 h-4 w-4" />
            Upload Documents
          </a>
        </Button>
      </CardContent>
    </Card>
  );
}
