
'use client';

import { useState, useMemo } from 'react';
import type { User, RecipientConfig } from '@/lib/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ChevronsUpDown, Search, X } from 'lucide-react';

const DEPARTMENTS = ['UK', 'Finance', 'Document'];

export function RecipientSelector({ 
  value, 
  onChange, 
  users 
}: { 
  value: RecipientConfig[], 
  onChange: (val: RecipientConfig[]) => void, 
  users: User[] 
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  // Admins group
  const admins = useMemo(() => 
    users.filter(u => u.role === 'admin' && u.name.toLowerCase().includes(search.toLowerCase())), 
    [users, search]
  );

  // Any user with a department (regardless of role, usually department users or employees)
  const usersByDept = useMemo(() => 
    users.filter(u => u.department && u.name.toLowerCase().includes(search.toLowerCase())), 
    [users, search]
  );

  const isSelected = (type: 'user' | 'group' | 'department', id: string) => {
    return value.some(v => v.type === type && v.id === id);
  };

  // Helper to determine if a user is selected (either directly or via a group they belong to)
  const isUserSelected = (user: User) => {
    if (isSelected('user', user.id)) return true;
    if (user.role === 'admin' && isSelected('group', 'admins')) return true;
    if (user.department && isSelected('department', user.department)) return true;
    return false;
  };

  const toggleSelection = (type: 'user' | 'group' | 'department', id: string, name?: string) => {
    const exists = isSelected(type, id);
    if (exists) {
      onChange(value.filter(v => !(v.type === type && v.id === id)));
    } else {
      onChange([...value, { type, id, name }]);
    }
  };

  const toggleDepartment = (dept: string) => {
    const isDeptSelected = isSelected('department', dept);
    if (isDeptSelected) {
      // Remove department. We don't remove individual users because they might have been 
      // selected manually before the department was selected.
      onChange(value.filter(v => !(v.type === 'department' && v.id === dept)));
    } else {
      // Add department
      toggleSelection('department', dept, `${dept} Dept`);
    }
  };

  return (
    <div className="space-y-3">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-between h-auto min-h-[40px] py-2">
            <div className="flex flex-wrap gap-1 items-center text-left">
                {value.length > 0 ? (
                    <span className="font-medium text-sm">{value.length} recipients selected</span>
                ) : (
                    <span className="text-muted-foreground">Select recipients...</span>
                )}
            </div>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[400px] p-0" align="start">
          <div className="p-3 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search staff..." 
                className="pl-8 h-9" 
                value={search} 
                onChange={(e) => setSearch(e.target.value)} 
              />
            </div>
          </div>
          <ScrollArea className="h-80">
            <div className="p-4 space-y-6">
              {/* ADMINS GROUP */}
              <div className="space-y-2">
                <div className="flex items-center space-x-2 hover:bg-muted p-1.5 rounded cursor-pointer transition-colors" onClick={() => toggleSelection('group', 'admins', 'All Admins')}>
                  <Checkbox checked={isSelected('group', 'admins')} onCheckedChange={() => {}} />
                  <span className="text-sm font-bold">All Admins (Group)</span>
                </div>
                <div className="pl-6 space-y-1">
                  {admins.map(user => (
                    <div key={user.id} className="flex items-center space-x-2 hover:bg-muted p-1 rounded cursor-pointer transition-colors" onClick={() => toggleSelection('user', user.id, user.name)}>
                      <Checkbox checked={isUserSelected(user)} onCheckedChange={() => {}} />
                      <span className="text-sm">{user.name}</span>
                    </div>
                  ))}
                  {admins.length === 0 && !search && <div className="text-xs text-muted-foreground italic pl-1">No admins found</div>}
                </div>
              </div>

              {/* DEPARTMENTS */}
              {DEPARTMENTS.map(dept => {
                const members = usersByDept.filter(u => u.department === dept);
                if (members.length === 0 && search) return null;
                
                return (
                  <div key={dept} className="space-y-2">
                    <div className="flex items-center space-x-2 hover:bg-muted p-1.5 rounded cursor-pointer transition-colors" onClick={() => toggleDepartment(dept)}>
                      <Checkbox checked={isSelected('department', dept)} onCheckedChange={() => {}} />
                      <span className="text-sm font-bold">{dept} Department</span>
                    </div>
                    <div className="pl-6 space-y-1">
                      {members.map(user => (
                        <div key={user.id} className="flex items-center space-x-2 hover:bg-muted p-1 rounded cursor-pointer transition-colors" onClick={() => toggleSelection('user', user.id, user.name)}>
                          <Checkbox checked={isUserSelected(user)} onCheckedChange={() => {}} />
                          <span className="text-sm">{user.name}</span>
                        </div>
                      ))}
                      {members.length === 0 && <div className="text-xs text-muted-foreground italic pl-1">No members in this department</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>

      {value.length > 0 && (
        <div className="flex flex-wrap gap-2 p-2 border rounded-md bg-muted/20">
          {value.map((config, idx) => (
            <Badge key={idx} variant="secondary" className="flex items-center gap-1 pr-1 h-7">
              <span className="text-xs">{config.name || config.id}</span>
              <X className="h-3 w-3 cursor-pointer hover:text-destructive" onClick={() => toggleSelection(config.type, config.id)} />
            </Badge>
          ))}
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs hover:bg-destructive/10 hover:text-destructive" onClick={() => onChange([])}>Clear all</Button>
        </div>
      )}
    </div>
  );
}
