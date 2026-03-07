'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Database, Download } from 'lucide-react';
import { useUser } from '@/hooks/use-user';
import { AvatarUpload } from '@/components/user-management/avatar-upload';
import { getFullSystemBackup } from '@/lib/actions';

export default function SettingsPage() {
  const { toast } = useToast();
  const { user, isUserLoading } = useUser();
  
  // Backup state
  const [isBackingUp, setIsBackingUp] = useState(false);

  // Theme Settings
  const [primaryColor, setPrimaryColor] = useState('#5E60A4');
  const [backgroundColor, setBackgroundColor] = useState('#EFF1F9');
  const [accentColor, setAccentColor] = useState('#7A6DA9');
  const [logo, setLogo] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedPrimary = localStorage.getItem('themePrimaryColor') || '#5E60A4';
      const savedBackground = localStorage.getItem('themeBackgroundColor') || '#EFF1F9';
      const savedAccent = localStorage.getItem('themeAccentColor') || '#7A6DA9';
      const savedLogo = localStorage.getItem('customLogo');
      setPrimaryColor(savedPrimary);
      setBackgroundColor(savedBackground);
      setAccentColor(savedAccent);
      if(savedLogo) setLogoPreview(savedLogo);
    }
  }, []);

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

  const handleDownloadBackup = async () => {
    if (!user) return;
    setIsBackingUp(true);
    const result = await getFullSystemBackup(user.id);
    
    if (result.success && result.data) {
      const dataStr = JSON.stringify(result.data, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename || 'system_backup.json';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast({ title: 'Backup Successful', description: 'The complete system data has been downloaded.' });
    } else {
      toast({ variant: 'destructive', title: 'Backup Failed', description: result.message });
    }
    setIsBackingUp(false);
  };
  
  if (isUserLoading || !user) {
    return <div className="flex h-full w-full items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>
  }
  
  const canManageTheme = user.role === 'admin';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Profile Settings</CardTitle>
          <CardDescription>Update your profile picture.</CardDescription>
        </CardHeader>
        <CardContent>
          <AvatarUpload />
        </CardContent>
      </Card>
      
      {canManageTheme && (
        <>
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-primary" />
                <CardTitle>Data Management & Safety</CardTitle>
              </div>
              <CardDescription>Secure your data by downloading a full system backup of all students, tasks, and settings.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button 
                onClick={handleDownloadBackup} 
                disabled={isBackingUp}
                className="gap-2 font-bold"
              >
                {isBackingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Download Complete System Backup (.JSON)
              </Button>
              <p className="text-[10px] text-muted-foreground mt-2 italic">
                Note: This file contains raw system data and can be used for manual auditing or offline records.
              </p>
            </CardContent>
          </Card>

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
        </>
      )}
    </div>
  );
}
