
'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import * as z from 'zod';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
  CardDescription,
} from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/hooks/use-user';
import { Loader2, LogIn, GraduationCap } from 'lucide-react';
import { useFirebase } from '@/firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { setDoc, doc } from 'firebase/firestore';
import type { User } from '@/lib/types';


const formSchema = z.object({
  email: z.string().email({ message: 'Please enter a valid email address.' }),
  password: z.string().min(8, { message: 'Password must be at least 8 characters.' }),
  civilId: z
    .string()
    .length(12, 'Civil ID must be 12 digits.')
    .regex(/^\d+$/, 'Civil ID must only contain digits.'),
});

export function LoginForm() {
  const { toast } = useToast();
  const { user } = useUser();
  const { auth, firestore } = useFirebase();
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    if (user) {
        if (user.role === 'admin') {
            router.replace('/user-management');
        } else {
            router.replace('/dashboard');
        }
    }
  }, [user, router]);

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true);

    if (!auth || !firestore) {
        toast({ variant: 'destructive', title: 'Firebase not initialized.' });
        setIsLoading(false);
        return;
    }

    try {
        await signInWithEmailAndPassword(auth, values.email, values.password);
        toast({
          title: 'Login Successful',
          description: `Welcome back!`,
        });
    } catch (error: any) {
        if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
            if (values.email.toLowerCase() === 'admin@uniapply.hub') {
                toast({
                    title: 'Admin Account Not Found',
                    description: 'Attempting to create first admin account...',
                });
                try {
                    const userCredential = await createUserWithEmailAndPassword(auth, values.email, values.password);
                    const authUser = userCredential.user;

                    const employeeId = values.civilId.slice(-5);
                    const newUserForDb: Omit<User, 'id'> = {
                        name: 'Admin User',
                        email: values.email,
                        phone: '00000000',
                        role: 'admin',
                        avatarUrl: `https://picsum.photos/seed/u1/100/100`,
                        civilId: values.civilId,
                        employeeId: employeeId,
                    };

                    await setDoc(doc(firestore, "users", authUser.uid), newUserForDb);
                    
                    toast({
                        title: 'Admin Account Created!',
                        description: 'You are now being logged in.',
                    });

                } catch (creationError: any) {
                    let description = creationError.message || 'An unexpected error occurred during account creation.';
                    if (creationError.code === 'auth/weak-password') {
                        description = 'The password is too weak. Please use at least 8 characters.';
                    }
                    toast({
                        variant: 'destructive',
                        title: 'Admin Creation Failed',
                        description: description,
                    });
                }
            } else {
                toast({
                    variant: 'destructive',
                    title: 'Login Failed',
                    description: 'Invalid credentials. Please check your email and password.',
                });
            }
        } else if (error.code === 'auth/too-many-requests') {
            toast({
                variant: 'destructive',
                title: 'Login Failed',
                description: 'Access to this account has been temporarily disabled due to many failed login attempts.',
            });
        } else {
            toast({
                variant: 'destructive',
                title: 'Login Failed',
                description: error.message || 'An unexpected error occurred.',
            });
        }
    } finally {
        setIsLoading(false);
    }
  }

  if (user) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <div className="flex justify-center mb-4">
          <div className="flex items-center gap-2 text-2xl font-bold text-foreground">
            <div className="bg-primary text-primary-foreground p-2 rounded-lg">
              <GraduationCap className="h-7 w-7" />
            </div>
            <span>UniApply Hub</span>
          </div>
        </div>
        <CardTitle className="text-xl">Sign In to Your Account</CardTitle>
        <CardDescription>
          Enter your credentials to access the dashboard.
        </CardDescription>
      </CardHeader>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="you@example.com"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type="password" placeholder="••••••••" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="civilId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Civil ID</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter your 12-digit Civil ID" {...field} maxLength={12} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={isLoading} className="w-full">
              {isLoading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <LogIn className="mr-2 h-4 w-4" />
              )}
              Sign In
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
