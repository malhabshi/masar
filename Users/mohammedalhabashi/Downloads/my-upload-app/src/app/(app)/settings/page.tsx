'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { sendTestNotification } from '@/lib/actions';
import { Loader2 } from 'lucide-react';
import { useUser } from '@/hooks/use-user';

export default function SettingsPage() {
  const { toast } = useToast();
  const { user, isUserLoading } = useUser();
  const [isClient, setIsClient] = useState(false);

  // Jotform Settings
  const [jotformApiKey, setJotformApiKey] = useState('');
  const [jotformFormId, setJotformFormId] = useState('');
  
  // WhatsApp Settings
  const [wanotifierWebhookUrl, setWanotifierWebhookUrl] = useState('');
  const [testPhoneNumber, setTestPhoneNumber] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  
  // Theme Settings
  const [primaryColor, setPrimaryColor] = useState('#5E60A4');
  const [backgroundColor, setBackgroundColor] = useState('#EFF1F9');
  const [accentColor, setAccentColor] = useState('#7A6DA9');
  const [logo, setLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  // Notification Toggle Settings
  const [notificationSettings, setNotificationSettings] = useState({
    newStudentApplication: true,
    applicationStatusChange: true,
    newDocumentUpload: true,
    taskAssigned: true,
  });

  useEffect(() => {
    setIsClient(true);
    if (typeof window !== 'undefined') {
      const savedJotformApi = localStorage.getItem('jotformApiKey') || '';
      const savedJotformForm = localStorage.getItem('jotformFormId') || '';
      const savedWanotifier = localStorage.getItem('wanotifierWebhookUrl') || '';
      const savedNotifications = localStorage.getItem('notificationSettings');
      
      setJotformApiKey(savedJotformApi);
      setJotformFormId(savedJotformForm);
      setWanotifierWebhookUrl(savedWanotifier);
      
      if (savedNotifications) {
        setNotificationSettings(JSON.parse(savedNotifications));
      }
      
      const savedPrimary = localStorage.getItem('themePrimaryColor') || '#5E60A4';
      const savedBackground = localStorage.getItem('themeBackgroundColor') || '#EFF1F9';
      const savedAccent = localStorage.getItem('themeAccentColor') || '#7A6DA9';
      const savedLogo = localStorage.getItem('customLogo');
      setPrimaryColor(savedPrimary);
      setBackgroundColor(savedBackground);
      setAccentColor(savedAccent);
      if(savedLogo) setLogoPreview(savedLogo);
      
      // Apply theme on load
      applyTheme({ primary: savedPrimary, background: savedBackground, accent: savedAccent });
    }
  }, []);

  const handleSaveJotform = () => {
    localStorage.setItem('jotformApiKey', jotformApiKey);
    localStorage.setItem('jotformFormId', jotformFormId);
    toast({ title: 'Jotform settings saved!' });
  };

  const handleSaveWhatsApp = () => {
    localStorage.setItem('wanotifierWebhookUrl', wanotifierWebhookUrl);
    toast({ title: 'WhatsApp settings saved!' });
  };
  
  const handleTestWhatsApp = async () => {
    if (!testPhoneNumber) {
        toast({ variant: 'destructive', title: 'Phone number is required for testing.'});
        return;
    }
    setIsTesting(true);
    const result = await sendTestNotification(testPhoneNumber, user?.name || 'User');
    if (result.success) {
        toast({ title: 'Test Sent!', description: 'Check the provided phone number for a message.' });
    } else {
        toast({ variant: 'destructive', title: 'Test Failed', description: result.message });
    }
    setIsTesting(false);
  }

  const handleNotificationToggle = (key: keyof typeof notificationSettings, value: boolean) => {
    const newSettings = { ...notificationSettings, [key]: value };
    setNotificationSettings(newSettings);
    localStorage.setItem('notificationSettings', JSON.stringify(newSettings));
    toast({ title: 'Notification settings updated.' });
  };

  const hexToHsl = (hex: string): string => {
    let r = 0, g = 0, b = 0;
    if (hex.length === 4) {
      r = parseInt(hex[1] + hex[1], 16);
      g = parseInt(hex[2] + hex[2], 16);
      b = parseInt(hex[3] + hex[3], 16);
    } else if (hex.length === 7) {
      r = parseInt(hex.substring(1, 3), 16);
      g = parseInt(hex.substring(3, 5), 16);
      b = parseInt(hex.substring(5, 7), 16);
    }
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        case b: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
  };

  const applyTheme = (colors: { primary: string, background: string, accent: string }) => {
    if(typeof document === 'undefined') return;
    document.documentElement.style.setProperty('--primary', hexToHsl(colors.primary));
    document.documentElement.style.setProperty('--background', hexToHsl(colors.background));
    document.documentElement.style.setProperty('--accent', hexToHsl(colors.accent));
  };
  
  const handleSaveTheme = () => {
    applyTheme({ primary: primaryColor, background: backgroundColor, accent: accentColor });
    localStorage.setItem('themePrimaryColor', primaryColor);
    localStorage.setItem('themeBackgroundColor', backgroundColor);
    localStorage.setItem('themeAccentColor', accentColor);

    if (logo) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        localStorage.setItem('customLogo', base64String);
        setLogoPreview(base64String);
        window.dispatchEvent(new CustomEvent('logo-updated', { detail: base64String }));
        toast({ title: 'Theme and logo saved!' });
      };
      reader.readAsDataURL(logo);
    } else {
      toast({ title: 'Theme saved!' });
    }
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      setLogo(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setLogoPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };
  
  if (isUserLoading) {
    return <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>
  }
  
  if (user?.role !== 'admin') {
      return (
          <Card>
              <CardHeader>
                  <CardTitle>Permission Denied</CardTitle>
                  <CardDescription>You do not have permission to view settings.</CardDescription>
              </CardHeader>
          </Card>
      )
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Theme Customization</CardTitle>
          <CardDescription>Customize the look and feel of the application.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="space-y-2 flex-1">
              <Label htmlFor="primary-color">Primary Color</Label>
              <Input id="primary-color" type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} />
            </div>
            <div className="space-y-2 flex-1">
              <Label htmlFor="background-color">Background Color</Label>
              <Input id="background-color" type="color" value={backgroundColor} onChange={(e) => setBackgroundColor(e.target.value)} />
            </div>
            <div className="space-y-2 flex-1">
              <Label htmlFor="accent-color">Accent Color</Label>
              <Input id="accent-color" type="color" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="logo-upload">Custom Logo</Label>
            <div className="flex items-center gap-4">
              <Input id="logo-upload" type="file" accept="image/*" onChange={handleLogoChange} className="flex-1" />
              {logoPreview && <img src={logoPreview} alt="Logo Preview" className="h-10 w-10 object-contain rounded-md border p-1" />}
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button onClick={handleSaveTheme}>Save Theme</Button>
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Notification Settings</CardTitle>
          <CardDescription>Toggle which WhatsApp notifications are sent.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
            {isClient && Object.entries(notificationSettings).map(([key, value]) => (
                <div key={key} className="flex items-center justify-between">
                    <Label htmlFor={`notif-${key}`} className="capitalize">
                        {key.replace(/([A-Z])/g, ' $1')}
                    </Label>
                    <Switch
                        id={`notif-${key}`}
                        checked={value}
                        onCheckedChange={(checked) => handleNotificationToggle(key as keyof typeof notificationSettings, checked)}
                    />
                </div>
            ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>WhatsApp Settings</CardTitle>
          <CardDescription>Configure the WANotifier.com webhook URL.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="wanotifier-url">Webhook URL</Label>
            <Input id="wanotifier-url" type="url" placeholder="https://wanotifier.com/api/v1/webhook/..." value={wanotifierWebhookUrl} onChange={(e) => setWanotifierWebhookUrl(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <div className="space-y-2 flex-1">
                <Label htmlFor="wanotifier-test-phone">Test Phone Number</Label>
                <Input id="wanotifier-test-phone" type="tel" placeholder="e.g., 96512345678" value={testPhoneNumber} onChange={(e) => setTestPhoneNumber(e.target.value)} />
            </div>
            <Button onClick={handleTestWhatsApp} className="self-end" disabled={isTesting}>
                {isTesting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Send Test
            </Button>
          </div>
        </CardContent>
        <CardFooter>
          <Button onClick={handleSaveWhatsApp}>Save WhatsApp Settings</Button>
        </CardFooter>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Jotform Integration</CardTitle>
          <CardDescription>Connect to Jotform to receive new student submissions via webhook.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="jotform-api-key">API Key</Label>
            <Input id="jotform-api-key" type="password" placeholder="Enter your Jotform API key" value={jotformApiKey} onChange={(e) => setJotformApiKey(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="jotform-form-id">Form ID</Label>
            <Input id="jotform-form-id" type="text" placeholder="Enter the ID of your form" value={jotformFormId} onChange={(e) => setJotformFormId(e.target.value)} />
          </div>
        </CardContent>
        <CardFooter>
          <Button onClick={handleSaveJotform}>Save Jotform Settings</Button>
        </CardFooter>
      </Card>
    </div>
  );
}
