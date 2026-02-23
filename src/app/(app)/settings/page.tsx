'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { useUser } from '@/hooks/use-user';

export default function SettingsPage() {
  const { toast } = useToast();
  const { user, isUserLoading } = useUser();
  
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
    </div>
  );
}
