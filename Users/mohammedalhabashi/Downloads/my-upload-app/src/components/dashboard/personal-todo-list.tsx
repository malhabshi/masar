'use client';

import { useState, useMemo } from 'react';
import type { PersonalTodo } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { PlusCircle, Trash2, ListTodo } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { useFirebase, useCollection, addDocumentNonBlocking, updateDocumentNonBlocking, deleteDocumentNonBlocking, useUser } from '@/firebase';
import { collection, doc } from 'firebase/firestore';

export function PersonalTodoList() {
    const { user, isUserLoading } = useUser();
    const { firestore } = useFirebase();
    const { toast } = useToast();
    const [newTodo, setNewTodo] = useState('');

    const todosCollection = useMemo(() => {
        if (!firestore || !user?.auth) return null;
        return collection(firestore, 'users', user.auth.uid, 'personal_todos');
    }, [firestore, user?.auth]);

    const { data: todosData, isLoading: areTodosLoading } = useCollection<PersonalTodo>(todosCollection);

    const userTodos = useMemo(() => {
        if (!todosData) return [];
        return todosData.sort((a, b) => {
             if (a.completed === b.completed) {
                return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            }
            return a.completed ? 1 : -1;
        });
    }, [todosData]);

    const handleAddTodo = () => {
        if (!newTodo.trim() || !user?.auth || !todosCollection) return;

        const newTodoItem: Omit<PersonalTodo, 'id'> = {
            userId: user.auth.uid,
            content: newTodo.trim(),
            completed: false,
            createdAt: new Date().toISOString(),
        };

        addDocumentNonBlocking(todosCollection, newTodoItem);
        setNewTodo('');
        toast({ title: 'To-do added!' });
    };

    const handleToggleTodo = (todoId: string, completed: boolean) => {
        if (!firestore || !todosCollection) return;
        const todoDocRef = doc(todosCollection, todoId);
        updateDocumentNonBlocking(todoDocRef, { completed: !completed });
    };
    
    const handleDeleteTodo = (todoId: string) => {
        if (!firestore || !todosCollection) return;
        const todoDocRef = doc(todosCollection, todoId);
        deleteDocumentNonBlocking(todoDocRef);
        toast({ title: 'To-do removed.' });
    };
    
    if (isUserLoading || areTodosLoading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>My To-Do List</CardTitle>
                    <CardDescription>A private checklist to organize your tasks.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-3 pr-4 h-72">
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                        <Skeleton className="h-8 w-full" />
                    </div>
                </CardContent>
                <CardFooter className="border-t pt-4">
                     <div className="flex w-full items-center space-x-2">
                         <Input disabled placeholder="Add a new to-do..." value="" />
                         <Button disabled>
                             <PlusCircle className="mr-2 h-4 w-4" />
                             Add
                         </Button>
                     </div>
                </CardFooter>
            </Card>
        )
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>My To-Do List</CardTitle>
                <CardDescription>A private checklist to organize your tasks.</CardDescription>
            </CardHeader>
            <CardContent>
                <ScrollArea className="h-72">
                    <div className="space-y-3 pr-4">
                        {userTodos.length > 0 ? (
                            userTodos.map(todo => (
                                <div key={todo.id} className="flex items-center gap-3 p-2 rounded-md transition-colors hover:bg-muted/50">
                                    <Checkbox 
                                        id={`todo-${todo.id}`}
                                        checked={todo.completed} 
                                        onCheckedChange={() => handleToggleTodo(todo.id, todo.completed)} 
                                    />
                                    <label 
                                        htmlFor={`todo-${todo.id}`}
                                        className={cn(
                                            "flex-1 text-sm cursor-pointer",
                                            todo.completed && 'line-through text-muted-foreground'
                                        )}
                                    >
                                        {todo.content}
                                    </label>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => handleDeleteTodo(todo.id)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))
                        ) : (
                            <div className="text-center text-sm text-muted-foreground py-10">
                                <ListTodo className="mx-auto h-8 w-8 mb-2" />
                                Your to-do list is empty.
                            </div>
                        )}
                    </div>
                </ScrollArea>
            </CardContent>
            <CardFooter className="border-t pt-4">
                <div className="flex w-full items-center space-x-2">
                    <Input
                        placeholder="Add a new to-do..."
                        value={newTodo}
                        onChange={(e) => setNewTodo(e.target.value)}
                        onKeyDown={(e) => {if (e.key === 'Enter') handleAddTodo()}}
                    />
                    <Button onClick={handleAddTodo} disabled={!newTodo.trim()}>
                        <PlusCircle className="mr-2 h-4 w-4" />
                        Add
                    </Button>
                </div>
            </CardFooter>
        </Card>
    );
}
