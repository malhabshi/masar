'use client';

import { useState, useRef } from 'react';
import { useUser } from '@/hooks/use-user';
import { useToast } from '@/hooks/use-toast';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Loader2, Upload } from 'lucide-react';
import { updateUserAvatar } from '@/lib/actions';
import { MAX_FILE_SIZE_MB } from '@/lib/file-validation';

export function AvatarUpload() {
  const { user, auth } = useUser();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user || !auth) return;

    const imageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!imageTypes.includes(file.type)) {
      toast({
        variant: 'destructive',
        title: 'Invalid File Type',
        description: 'Please upload a PNG, JPG, or GIF image.',
      });
      return;
    }

    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      toast({
        variant: 'destructive',
        title: 'File Too Large',
        description: `Please upload an image smaller than ${MAX_FILE_SIZE_MB}MB.`,
      });
      return;
    }

    setIsLoading(true);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('destination', 'user_avatar');

    try {
      const token = await auth.getIdToken();
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'Failed to upload avatar.');
      }

      const { downloadURL } = result;

      // Now call server action to update user doc
      const updateResult = await updateUserAvatar(user.id, downloadURL);

      if (updateResult.success) {
        toast({
          title: 'Avatar Updated',
          description: 'Your new profile picture has been saved.',
        });
        // The useUser hook will refresh automatically due to Firestore listener
      } else {
        throw new Error(updateResult.message);
      }
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Update Failed',
        description: error.message || 'An unexpected error occurred.',
      });
    } finally {
      setIsLoading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const triggerFileSelect = () => {
    fileInputRef.current?.click();
  };

  if (!user) return null;

  return (
    <div className="flex items-center gap-4">
      <Avatar className="h-20 w-20">
        <AvatarImage src={user.avatarUrl} alt={user.name} />
        <AvatarFallback className="text-2xl">{user.name.charAt(0)}</AvatarFallback>
      </Avatar>
      <div className="flex flex-col gap-2">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          className="hidden"
          accept="image/png, image/jpeg, image/gif, image/webp"
        />
        <Button onClick={triggerFileSelect} disabled={isLoading}>
          {isLoading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-2 h-4 w-4" />
          )}
          {isLoading ? 'Uploading...' : 'Upload New Picture'}
        </Button>
        <p className="text-xs text-muted-foreground">
          PNG, JPG, GIF up to {MAX_FILE_SIZE_MB}MB.
        </p>
      </div>
    </div>
  );
}
