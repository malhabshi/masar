'use client';

import { useState, useMemo } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useUser } from '@/hooks/use-user';
import { ArrowUpRight, PlusCircle, FileText, Download, UploadCloud, Loader2, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { SharedDocument, Country, ResourceLink } from '@/lib/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useCollection, addDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/client';
import { firestore } from '@/firebase';
import { collection, doc } from 'firebase/firestore';
import { AddLinkDialog } from '@/components/resources/add-link-dialog';
import { EditLinkDialog } from '@/components/resources/edit-link-dialog';
import { EditDocumentDialog } from '@/components/resources/edit-document-dialog';
import { useUserCacheById } from '@/hooks/use-user-cache';


export default function ResourcesPage() {
  const { user, auth: authUser, isUserLoading } = useUser();
  const { toast } = useToast();
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [country, setCountry] = useState<string>('all');

  const { data: documents, isLoading: documentsLoading } = useCollection<SharedDocument>(user ? 'shared_documents' : '');
  const { data: resourceLinks, isLoading: linksLoading } = useCollection<ResourceLink>('resource_links');

  const authorIds = useMemo(() => {
    const docAuthors = (documents || []).map(d => d.authorId);
    const linkAuthors = (resourceLinks || []).map(l => l.authorId);
    return [...new Set([...docAuthors, ...linkAuthors])];
  }, [documents, resourceLinks]);

  const { userMap, isLoading: usersLoading } = useUserCacheById(authorIds);

  const pageIsLoading = isUserLoading || documentsLoading || usersLoading || linksLoading;

  const canManage = user?.role === 'admin' || user?.role === 'department';

  const handleUpload = async () => {
    if (!name || !description || !file || !authUser) {
      toast({
        variant: 'destructive',
        title: 'Missing information',
        description: 'Please provide a name, description, and select a file.',
      });
      return;
    }
    setIsUploading(true);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('destination', 'shared');
    formData.append('customName', name);
    formData.append('description', description);
    formData.append('country', country);

    try {
        const token = await authUser.getIdToken();

        const response = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData,
        });
        
        const result = await response.json();

        if (!response.ok || !result.success) {
            throw new Error(result.error || 'Failed to upload document.');
        }

        toast({
            title: 'Document Uploaded',
            description: `The document '${name}' has been added to the list.`,
        });

        setName('');
        setDescription('');
        setFile(null);
        setCountry('all');
        setIsDialogOpen(false);

    } catch (error: any) {
        console.error("Upload error in ResourcesPage:", error);
        toast({
            variant: 'destructive',
            title: 'Upload failed',
            description: error.message || 'Could not upload the file.'
        });
    } finally {
        setIsUploading(false);
    }
  };
  
  const handleAddLink = (link: Omit<ResourceLink, 'id' | 'authorId' | 'createdAt'>) => {
    if (!user) return;
    const newLink = {
      ...link,
      authorId: user.id,
      createdAt: new Date().toISOString()
    };
    const resourceLinksCollection = collection(firestore, 'resource_links');
    addDocumentNonBlocking(resourceLinksCollection, newLink);
    toast({
      title: "Link Added",
      description: `"${link.title}" has been added to the resources.`
    });
  }

  const handleDeleteLink = (linkId: string) => {
    const linkDocRef = doc(firestore, 'resource_links', linkId);
    deleteDocumentNonBlocking(linkDocRef);
    toast({
      title: "Link Deleted",
      description: "The resource link has been removed.",
    });
  };

  const handleDeleteDocument = (docId: string) => {
    const docRef = doc(firestore, 'shared_documents', docId);
    deleteDocumentNonBlocking(docRef);
    toast({
      title: "Document Deleted",
      description: "The shared document has been removed.",
    });
  };

  if (pageIsLoading) {
      return (
          <div className="space-y-6">
              <Card>
                  <CardHeader>
                      <Skeleton className="h-8 w-64" />
                      <Skeleton className="h-4 w-96" />
                  </CardHeader>
                  <CardContent>
                      <Skeleton className="h-32 w-full" />
                  </CardContent>
              </Card>
              <Card>
                  <CardHeader>
                      <Skeleton className="h-8 w-64" />
                      <Skeleton className="h-4 w-96" />
                  </CardHeader>
                  <CardContent>
                      <Skeleton className="h-48 w-full" />
                  </CardContent>
              </Card>
          </div>
      )
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Please sign in to view this page.</p>
      </div>
    );
  }

  const countries: Country[] = ['UK', 'USA', 'Australia', 'New Zealand'];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Helpful Resources</CardTitle>
            <CardDescription>
              A collection of third-party links and resources for employees.
            </CardDescription>
          </div>
          {user.role === 'admin' && (
            <AddLinkDialog onAddLink={handleAddLink}>
              <Button>
                <PlusCircle className="mr-2 h-4 w-4" />
                Add Link
              </Button>
            </AddLinkDialog>
          )}
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
              {resourceLinks && resourceLinks.map((resource) => (
                  <div key={resource.id} className="border p-4 rounded-lg flex items-center justify-between hover:bg-muted/50 transition-colors">
                      <div>
                          <h3 className="font-semibold">{resource.title}</h3>
                          <p className="text-sm text-muted-foreground">{resource.description}</p>
                      </div>
                      <div className="flex items-center gap-1">
                          {canManage && (
                              <>
                                <EditLinkDialog link={resource} />
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                This will permanently delete the link "{resource.title}".
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => handleDeleteLink(resource.id)}>Delete</AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                              </>
                          )}
                          <Button variant="ghost" size="icon" asChild>
                              <a href={resource.url} target="_blank" rel="noopener noreferrer">
                                  <ArrowUpRight className="h-4 w-4" />
                              </a>
                          </Button>
                      </div>
                  </div>
              ))}
          </div>
          {(!resourceLinks || resourceLinks.length === 0) && (
              <div className="text-center text-muted-foreground py-10">
                  No resources have been added yet.
              </div>
          )}
        </CardContent>
      </Card>
      
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
            <div>
            <CardTitle>Shared Documents</CardTitle>
            <CardDescription>
                Documents accessible to all employees and departments.
            </CardDescription>
            </div>
            {canManage && (
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                <Button>
                    <PlusCircle className="mr-2 h-4 w-4" />
                    Add Document
                </Button>
                </DialogTrigger>
                <DialogContent>
                <DialogHeader>
                    <DialogTitle>Add New Shared Document</DialogTitle>
                    <DialogDescription>
                    This document will be visible to all users.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="space-y-2">
                    <Label htmlFor="doc-name">Document Name</Label>
                    <Input id="doc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., Company Policy Update" />
                    </div>
                    <div className="space-y-2">
                    <Label htmlFor="doc-desc">Description</Label>
                    <Textarea id="doc-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A short description of the document's content." />
                    </div>
                     <div className="space-y-2">
                        <Label htmlFor="doc-country">Country (Optional)</Label>
                        <Select value={country} onValueChange={setCountry}>
                            <SelectTrigger id="doc-country">
                                <SelectValue placeholder="Assign to a country" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Countries</SelectItem>
                                {countries.map(c => (
                                    <SelectItem key={c} value={c}>{c}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="space-y-2">
                    <Label htmlFor="doc-file">File</Label>
                    <Input id="doc-file" type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                    </div>
                </div>
                <DialogFooter>
                    <DialogClose asChild>
                    <Button variant="outline">Cancel</Button>
                    </DialogClose>
                    <Button onClick={handleUpload} disabled={isUploading}>
                    {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UploadCloud className="mr-2 h-4 w-4" />}
                    Upload Document
                    </Button>
                </DialogFooter>
                </DialogContent>
            </Dialog>
            )}
        </CardHeader>
        <CardContent>
            <div className="rounded-lg border">
                <Table>
                    <TableHeader>
                        <TableRow>
                        <TableHead>Document</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Country</TableHead>
                        <TableHead>Uploaded By</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                    {documents && documents.length > 0 ? (
                        documents.map((doc) => {
                            const author = userMap.get(doc.authorId);
                            return (
                                <TableRow key={doc.id}>
                                    <TableCell className="font-medium flex items-center gap-2">
                                        <FileText className="h-4 w-4 text-muted-foreground" />
                                        {doc.name}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">{doc.description}</TableCell>
                                    <TableCell>
                                        {doc.country || 'All Countries'}
                                    </TableCell>
                                    <TableCell>
                                    {author ? (
                                        <div className="flex items-center gap-2">
                                        <Avatar className="h-6 w-6">
                                            <AvatarImage src={author.avatarUrl} alt={author.name} />
                                            <AvatarFallback>{author.name.charAt(0)}</AvatarFallback>
                                        </Avatar>
                                        <span className="text-sm">{author.name}</span>
                                        </div>
                                    ) : <Skeleton className="h-6 w-24" />}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end items-center">
                                            {canManage && (
                                                <>
                                                    <EditDocumentDialog document={doc} />
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                                                <AlertDialogDescription>
                                                                    This will permanently delete the document "{doc.name}".
                                                                </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                <AlertDialogAction onClick={() => handleDeleteDocument(doc.id)}>Delete</AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                </>
                                            )}
                                            <Button variant="ghost" size="icon" asChild>
                                                <a href={doc.url} download={doc.name} target="_blank" rel="noopener noreferrer">
                                                    <Download className="h-4 w-4" />
                                                </a>
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            );
                        })
                    ) : (
                        <TableRow>
                            <TableCell colSpan={5} className="h-24 text-center">
                                No shared documents yet.
                            </TableCell>
                        </TableRow>
                    )}
                    </TableBody>
                </Table>
            </div>
        </CardContent>
      </Card>
    </div>
  );
}
