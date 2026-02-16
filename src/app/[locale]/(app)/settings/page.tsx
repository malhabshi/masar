
'use client';

import { useUser } from '@/hooks/use-user';
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from '@/components/ui/card';
import { Loader2, RefreshCw, ExternalLink, Send, Bell } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { sendTestNotification } from '@/lib/actions';
import { Switch } from '@/components/ui/switch';

// --- Helper Functions (previously in theme-settings-form) ---

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return null;

  let r = parseInt(result[1], 16) / 255;
  let g = parseInt(result[2], 16) / 255;
  let b = parseInt(result[3], 16) / 255;

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

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

function hslToHex(h: number, s: number, l: number): string {
    l /= 100;
    const a = s * Math.min(l, 1 - l) / 100;
    const f = (n: number) => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
}

const DEFAULT_COLORS = {
    background: { h: 231, s: 60, l: 95 },
    primary: { h: 231, s: 48, l: 48 },
    accent: { h: 265, s: 39, l: 55 },
};

const DEFAULT_NOTIFICATION_SETTINGS = {
    newDocumentUpload: true,
};

export default function SettingsPage() {
  const { user, isUserLoading } = useUser();
  const { toast } = useToast();
  const [isMounted, setIsMounted] = useState(false);

  // --- Theme State ---
  const [primaryColor, setPrimaryColor] = useState(() => hslToHex(DEFAULT_COLORS.primary.h, DEFAULT_COLORS.primary.s, DEFAULT_COLORS.primary.l));
  const [backgroundColor, setBackgroundColor] = useState(() => hslToHex(DEFAULT_COLORS.background.h, DEFAULT_COLORS.background.s, DEFAULT_COLORS.background.l));
  const [accentColor, setAccentColor] = useState(() => hslToHex(DEFAULT_COLORS.accent.h, DEFAULT_COLORS.accent.s, DEFAULT_COLORS.accent.l));
  const [logo, setLogo] = useState<string | null>(null);

  // --- Notification State ---
  const [notificationSettings, setNotificationSettings] = useState(DEFAULT_NOTIFICATION_SETTINGS);

  // --- WhatsApp State ---
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [testPhoneNumber, setTestPhoneNumber] = useState('');

  // Mount effect to prevent hydration errors
  useEffect(() => {
    setIsMounted(true);
  }, []);
  
  const applyTheme = useCallback((colors: any, logoUrl: string | null) => {
      const root = document.documentElement;
      if (colors.primary) root.style.setProperty('--primary', `${colors.primary.h} ${colors.primary.s}% ${colors.primary.l}%`);
      if (colors.background) root.style.setProperty('--background', `${colors.background.h} ${colors.background.s}% ${colors.background.l}%`);
      if (colors.accent) root.style.setProperty('--accent', `${colors.accent.h} ${colors.accent.s}% ${colors.accent.l}%`);
      window.dispatchEvent(new CustomEvent('logo-updated', { detail: logoUrl }));
  }, []);
  
  // Load ALL settings from localStorage once mounted
  useEffect(() => {
    if (isMounted) {
      // Load Theme settings
      try {
          const savedColorsJSON = localStorage.getItem('themeColors');
          const savedLogo = localStorage.getItem('customLogo');
          let colors = DEFAULT_COLORS;
          if (savedColorsJSON) {
              const parsedColors = JSON.parse(savedColorsJSON);
              if (parsedColors.primary && parsedColors.background && parsedColors.accent) {
                  colors = parsedColors;
              }
          }
          setPrimaryColor(hslToHex(colors.primary.h, colors.primary.s, colors.primary.l));
          setBackgroundColor(hslToHex(colors.background.h, colors.background.s, colors.background.l));
          setAccentColor(hslToHex(colors.accent.h, colors.accent.s, colors.accent.l));
          if (savedLogo) setLogo(savedLogo);
          applyTheme(colors, savedLogo);

          const savedNotifications = localStorage.getItem('notificationSettings');
          if (savedNotifications) {
            setNotificationSettings(JSON.parse(savedNotifications));
          }

      } catch (error) {
          console.error("Failed to load theme from local storage.", error);
          applyTheme(DEFAULT_COLORS, null);
      }
      
      // Load WhatsApp settings
      if (user?.phone) setTestPhoneNumber(user.phone);
    }
  }, [isMounted, user, applyTheme]);


  // --- Theme Handlers ---
  const handleColorChange = (colorType: 'primary' | 'background' | 'accent', hexValue: string) => {
      const hslValue = hexToHsl(hexValue);
      if (!hslValue) return;

      const stateSetter = { primary: setPrimaryColor, background: setBackgroundColor, accent: setAccentColor }[colorType];
      stateSetter(hexValue);
      
      document.documentElement.style.setProperty(`--${colorType}`, `${hslValue.h} ${hslValue.s}% ${hslValue.l}%`);
  };

  const handleLogoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file?.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onloadend = () => {
              const dataUrl = reader.result as string;
              setLogo(dataUrl);
              localStorage.setItem('customLogo', dataUrl);
              window.dispatchEvent(new CustomEvent('logo-updated', { detail: dataUrl }));
              toast({ title: 'Logo Updated' });
          };
          reader.readAsDataURL(file);
      } else {
          toast({ variant: 'destructive', title: 'Invalid File' });
      }
  };

  const handleSaveTheme = () => {
      try {
          const colorsToSave = {
              primary: hexToHsl(primaryColor),
              background: hexToHsl(backgroundColor),
              accent: hexToHsl(accentColor)
          };
          localStorage.setItem('themeColors', JSON.stringify(colorsToSave));
          toast({ title: 'Theme Saved!' });
      } catch (error) {
           toast({ variant: 'destructive', title: 'Error', description: 'Could not save theme.' });
      }
  };

  const handleResetTheme = () => {
      try {
          localStorage.removeItem('themeColors');
          localStorage.removeItem('customLogo');
          applyTheme(DEFAULT_COLORS, null);
          setPrimaryColor(hslToHex(DEFAULT_COLORS.primary.h, DEFAULT_COLORS.primary.s, DEFAULT_COLORS.primary.l));
          setBackgroundColor(hslToHex(DEFAULT_COLORS.background.h, DEFAULT_COLORS.background.s, DEFAULT_COLORS.background.l));
          setAccentColor(hslToHex(DEFAULT_COLORS.accent.h, DEFAULT_COLORS.accent.s, DEFAULT_COLORS.accent.l));
          setLogo(null);
          toast({ title: 'Theme Reset' });
      } catch(error) {
           toast({ variant: 'destructive', title: 'Error', description: 'Could not reset theme.' });
      }
  };

  // --- Notification Handler ---
  const handleNotificationChange = (key: keyof typeof notificationSettings, value: boolean) => {
    setNotificationSettings(prev => {
        const newSettings = { ...prev, [key]: value };
        try {
            localStorage.setItem('notificationSettings', JSON.stringify(newSettings));
            toast({ title: 'Notification settings saved' });
        } catch (error) {
            toast({ variant: 'destructive', title: 'Error', description: 'Could not save settings.' });
        }
        return newSettings;
    });
  };
  
  // --- WhatsApp Handler ---
  const handleSendTest = async () => {
      if (!user) {
          toast({ variant: "destructive", title: "Error", description: "You must be logged in." });
          return;
      }
      setIsSendingTest(true);
      setTestResult(null);
      toast({ title: "Sending Test...", description: "Attempting to send a notification." });
      try {
        const result = await sendTestNotification(testPhoneNumber, "admin");
        setTestResult({
          type: result.success ? "success" : "error",
          message: result.message
        });
        toast({
          variant: result.success ? "default" : "destructive",
          title: result.success ? "Test Message Dispatched" : "Test Notification Failed",
          description: result.message,
          duration: 10000,
        });
      } catch (error: any) {
          const message = error.message || "An unexpected client-side error occurred.";
          setTestResult({ type: 'error', message });
          toast({ variant: "destructive", title: "Client-Side Error", description: message });
      }
      setIsSendingTest(false);
  };
  
  if (!isMounted || isUserLoading) {
    return (
        <div className="max-w-4xl mx-auto space-y-6">
            <Card><CardHeader><Skeleton className="h-8 w-64" /></CardHeader><CardContent><Skeleton className="h-40 w-full" /></CardContent></Card>
            <Card><CardHeader><Skeleton className="h-8 w-64" /></CardHeader><CardContent><Skeleton className="h-64 w-full" /></CardContent></Card>
            <Card><CardHeader><Skeleton className="h-8 w-64" /></CardHeader><CardContent><Skeleton className="h-48 w-full" /></CardContent></Card>
        </div>
    );
  }

  if (!user || user.role !== 'admin') {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">You do not have permission to view this page.</p>
      </div>
    );
  }
  
  return (
    <div className="max-w-4xl mx-auto space-y-6">
        {/* --- Theme Settings Card --- */}
        <Card>
            <CardHeader>
                <CardTitle>Appearance Settings</CardTitle>
                <CardDescription>
                    Customize the look and feel of the application. Changes are saved to your browser.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
                 <div className="grid md:grid-cols-3 gap-6">
                     <div className="space-y-2">
                        <Label htmlFor="primary-color">Primary Color</Label>
                        <div className="flex items-center gap-2">
                            <Input id="primary-color" type="color" value={primaryColor} onChange={e => handleColorChange('primary', e.target.value)} className="p-1 h-10 w-14"/>
                            <Input type="text" value={primaryColor} onChange={e => handleColorChange('primary', e.target.value)} />
                        </div>
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="background-color">Background Color</Label>
                         <div className="flex items-center gap-2">
                            <Input id="background-color" type="color" value={backgroundColor} onChange={e => handleColorChange('background', e.target.value)} className="p-1 h-10 w-14"/>
                            <Input type="text" value={backgroundColor} onChange={e => handleColorChange('background', e.target.value)} />
                        </div>
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="accent-color">Accent Color</Label>
                        <div className="flex items-center gap-2">
                            <Input id="accent-color" type="color" value={accentColor} onChange={e => handleColorChange('accent', e.target.value)} className="p-1 h-10 w-14"/>
                            <Input type="text" value={accentColor} onChange={e => handleColorChange('accent', e.target.value)} />
                        </div>
                    </div>
                </div>
                 <div>
                    <Label>Logo</Label>
                    <div className="flex items-center gap-4 mt-2">
                        <div className="w-24 h-24 border rounded-md flex items-center justify-center bg-muted">
                            {logo ? <img src={logo} alt="Custom Logo" className="object-contain h-full w-full" /> : <span className="text-xs text-muted-foreground">No Logo</span>}
                        </div>
                        <div className="flex-1">
                            <Input id="logo-upload" type="file" accept="image/*" onChange={handleLogoUpload} className="w-full" />
                        </div>
                    </div>
                </div>
            </CardContent>
            <CardFooter className="flex justify-end gap-2 border-t pt-6">
                <Button variant="ghost" onClick={handleResetTheme}>
                    <RefreshCw className="mr-2 h-4 w-4" /> Reset to Default
                </Button>
                <Button onClick={handleSaveTheme}>Save Theme</Button>
            </CardFooter>
        </Card>

        {/* --- Notification Settings Card --- */}
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Bell className="h-5 w-5" />
                    Notification Settings
                </CardTitle>
                <CardDescription>
                    Control which events trigger a WhatsApp notification to the admin.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
                <div className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                        <Label htmlFor="doc-upload-notif" className="font-medium">New Document Upload</Label>
                        <p className="text-sm text-muted-foreground">
                            Receive a notification when an employee uploads a new document for a student.
                        </p>
                    </div>
                    <Switch
                        id="doc-upload-notif"
                        checked={notificationSettings.newDocumentUpload}
                        onCheckedChange={(checked) => handleNotificationChange('newDocumentUpload', checked)}
                    />
                </div>
            </CardContent>
        </Card>

        {/* --- WhatsApp Settings Card --- */}
        <Card>
            <CardHeader>
                <CardTitle>WhatsApp Integration</CardTitle>
                <CardDescription>
                    Connect to a WhatsApp API provider to send real-time notifications.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                 <Alert>
                    <AlertTitle>How to Connect to WhatsApp API</AlertTitle>
                    <AlertDescription className="space-y-4">
                        <p>This application uses WANotifier.com for sending WhatsApp messages. You must provide your Webhook URL.</p>
                        <ol className="list-decimal list-inside space-y-2">
                             <li>Go to <a href="https://app.wanotifier.com/login" target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline">WANotifier.com</a> and log in.</li>
                             <li>Find your full <strong>Webhook URL</strong> in your WANotifier dashboard.</li>
                             <li>Set the Webhook URL as a secret in your hosting environment named <code>WANOTIFIER_WEBHOOK_URL</code>.</li>
                        </ol>
                        <Button variant="outline" asChild size="sm" className="mt-2">
                            <a href="https://app.wanotifier.com/login" target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-4 w-4" /> Go to WANotifier.com</a>
                        </Button>
                    </AlertDescription>
                </Alert>
                <div className="border-t pt-6">
                    <h3 className="text-lg font-medium">Test Your Connection</h3>
                    <p className="text-sm text-muted-foreground mb-4">Enter your full WhatsApp number to test your template: "HI {`{{1}}`} PLEASE FIND A NEW NOTIFICATION". The value for {`{{1}}`} will be the word "admin".</p>
                    <div className="space-y-2 mb-4">
                        <Label htmlFor="test-phone-number">Test Phone Number</Label>
                        <Input id="test-phone-number" placeholder="e.g., 96512345678" value={testPhoneNumber} onChange={(e) => setTestPhoneNumber(e.target.value)} />
                    </div>
                    <Button onClick={handleSendTest} disabled={isSendingTest || !testPhoneNumber}>
                        {isSendingTest ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                        Send Test Notification
                    </Button>
                    {testResult && (
                        <div className="mt-4">
                            <Alert variant={testResult.type === 'error' ? 'destructive' : 'default'}>
                                <AlertTitle>{testResult.type === 'error' ? 'Error' : 'Success'}</AlertTitle>
                                <AlertDescription>{testResult.message}</AlertDescription>
                            </Alert>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    </div>
  );
}
