
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { LifeBuoy } from 'lucide-react';

export default function SupportPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Support</CardTitle>
        <CardDescription>
          Get help and support for UniApply Hub.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center h-64 text-center text-muted-foreground bg-muted/50 rounded-lg">
            <LifeBuoy className="h-12 w-12 mb-4" />
            <h3 className="text-lg font-semibold">Contact Support</h3>
            <p className="text-sm">For any issues, please contact the administrator at <a href="mailto:admin@uniapply.hub" className="text-primary underline">admin@uniapply.hub</a>.</p>
        </div>
      </CardContent>
    </Card>
  );
}
