'use client';

import { useState } from 'react';
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
import { useCollection, addDocumentNonBlocking, updateDocumentNonBlocking, deleteDocumentNonBlocking } from '@/firebase/client';
import { firestore } from '@/firebase';
import { useUser } from '@/hooks/use-user';
import { collection, doc } from 'firebase/firestore';
import { sortByDate } from '@/lib/timestamp-utils';

export function PersonalTodoList() {
    const { user, isUserLoading } = useUser();
    const { toast } = useToast();
    const [newTodo, setNewTodo] = useState('');

    const todosCollectionPath = user ? `users/${user.id}/personal_todos` : '';
    const { data: todos, isLoading: areTodosLoading, error } = useCollection<PersonalTodo>(todosCollectionPath);
    
    const isLoading = isUserLoading || (!!user && areTodosLoading);

    const sortedTodos = (todos || []).sort((a,b) => sortByDate(a,b, 'createdAt', 'asc'));

    const handleAddTodo = async () => {
        if (!newTodo.trim() || !user) return;
        
        const todosCollectionRef = collection(firestore, 'users', user.id, 'personal_todos');

        const newTodoItem: Omit<PersonalTodo, 'id'> = {
            userId: user.id,
            content: newTodo.trim(),
            completed: false,
            createdAt: new Date().toISOString(),
        };
        
        addDocumentNonBlocking(todosCollectionRef, newTodoItem);
        setNewTodo('');
        toast({ title: 'To-do added!' });
    };

    const handleToggleTodo = (todoId: string, completed: boolean) => {
        if (!user) return;
        const todoRef = doc(firestore, 'users', user.id, 'personal_todos', todoId);
        updateDocumentNonBlocking(todoRef, { completed: !completed });
    };
    
    const handleDeleteTodo = (todoId: string) => {
        if (!user) return;
        const todoRef = doc(firestore, 'users', user.id, 'personal_todos', todoId);
        deleteDocumentNonBlocking(todoRef);
        toast({ title: 'To-do removed.' });
    };
    
    if (isLoading) {
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
        );
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
                        {error && <p className="text-destructive text-center">Error: {error.message}</p>}
                        {!error && sortedTodos.length > 0 ? (
                            sortedTodos.map((todo) => (
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
                                        <Trash2 className="h-4 w-4 text-destructive" />
                                    </Button>
                                </div>
                            ))
                        ) : (
                            !error && (
                                <div className="text-center text-sm text-muted-foreground py-10">
                                    <ListTodo className="mx-auto h-8 w-8 mb-2" />
                                    Your to-do list is empty.
                                </div>
                            )
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
                        onKeyDown={(e) => {if (e.key === 'Enter') handleAddTodo();}}
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
