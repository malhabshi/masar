'use client';

import { useFirebase, useCollection } from '@/firebase';
import { collection } from 'firebase/firestore';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { FileText, Link } from 'lucide-react';

interface Resource {
  id: string;
  title: string;
  url: string;
  type: 'document' | 'link';
}

export default function ResourcesPage() {
  const { firestore } = useFirebase();
  const { data: resources } = useCollection<Resource>(collection(firestore, 'resources'));

  return (
    <div className="p-6">
      <Card>
        <CardHeader>
          <CardTitle>Resources</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {resources?.map((resource) => (
              <div key={resource.id} className="flex items-center gap-2 p-2 border rounded">
                {resource.type === 'document' ? 
                  <FileText className="h-4 w-4" /> : 
                  <Link className="h-4 w-4" />
                }
                <a href={resource.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                  {resource.title}
                </a>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
