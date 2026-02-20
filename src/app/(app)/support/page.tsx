import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LifeBuoy, Mail, Phone } from 'lucide-react';

export default function SupportPage() {
  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LifeBuoy className="h-6 w-6" />
          Support & Contact
        </CardTitle>
        <CardDescription>
          Need help? Here's how you can get in touch with our support team.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-4">
          <Mail className="h-6 w-6 text-muted-foreground mt-1" />
          <div>
            <h3 className="font-semibold">Email Support</h3>
            <p className="text-muted-foreground">
              For general inquiries and technical issues, please email us.
            </p>
            <a href="mailto:support@uniapply.hub" className="text-primary hover:underline">
              support@uniapply.hub
            </a>
          </div>
        </div>
        <div className="flex items-start gap-4">
          <Phone className="h-6 w-6 text-muted-foreground mt-1" />
          <div>
            <h3 className="font-semibold">Phone Support</h3>
            <p className="text-muted-foreground">
              For urgent matters, you can call our support line during business hours (9 AM - 5 PM, Sunday - Thursday).
            </p>
            <p className="font-medium">+965 2222 3333</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
