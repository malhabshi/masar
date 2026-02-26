
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

  const admins = useMemo(() => users.filter(u => u.role === 'admin' && u.name.toLowerCase().includes(search.toLowerCase())), [users, search]);
  const deptUsers = useMemo(() => users.filter(u => u.role === 'department' && u.name.toLowerCase().includes(search.toLowerCase())), [users, search]);

  const isSelected = (type: 'user' | 'group' | 'department', id: string) => {
    return value.some(v => v.type === type && v.id === id);
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
    const members = users.filter(u => u.department === dept);
    
    if (isDeptSelected) {
      // Remove department and all individual members of this department
      const memberIds = new Set(members.map(m => m.id));
      onChange(value.filter(v => !(v.type === 'department' && v.id === dept) && !(v.type === 'user' && memberIds.has(v.id))));
    } else {
      // Add department and ensure individual members are not duplicates
      toggleSelection('department', dept, `${dept} Dept`);
    }
  };

  return (
    <div className="space-y-3">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-between">
            {value.length > 0 ? `${value.length} recipients selected` : "Select recipients..."}
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
              <div className="space-y-2">
                <div className="flex items-center space-x-2 hover:bg-muted p-1.5 rounded cursor-pointer" onClick={() => toggleSelection('group', 'admins', 'All Admins')}>
                  <Checkbox checked={isSelected('group', 'admins')} />
                  <span className="text-sm font-bold">All Admins (Group)</span>
                </div>
                <div className="pl-6 space-y-1">
                  {admins.map(user => (
                    <div key={user.id} className="flex items-center space-x-2 hover:bg-muted p-1 rounded cursor-pointer" onClick={() => toggleSelection('user', user.id, user.name)}>
                      <Checkbox checked={isSelected('user', user.id)} />
                      <span className="text-sm">{user.name}</span>
                    </div>
                  ))}
                </div>
              </div>

              {DEPARTMENTS.map(dept => {
                const members = deptUsers.filter(u => u.department === dept);
                if (members.length === 0 && search) return null;
                return (
                  <div key={dept} className="space-y-2">
                    <div className="flex items-center space-x-2 hover:bg-muted p-1.5 rounded cursor-pointer" onClick={() => toggleDepartment(dept)}>
                      <Checkbox checked={isSelected('department', dept)} />
                      <span className="text-sm font-bold">{dept} Department</span>
                    </div>
                    <div className="pl-6 space-y-1">
                      {members.map(user => (
                        <div key={user.id} className="flex items-center space-x-2 hover:bg-muted p-1 rounded cursor-pointer" onClick={() => toggleSelection('user', user.id, user.name)}>
                          <Checkbox checked={isSelected('user', user.id)} />
                          <span className="text-sm">{user.name}</span>
                        </div>
                      ))}
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
            <Badge key={idx} variant="secondary" className="flex items-center gap-1 pr-1">
              {config.name || config.id}
              <X className="h-3 w-3 cursor-pointer hover:text-destructive" onClick={() => toggleSelection(config.type, config.id)} />
            </Badge>
          ))}
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => onChange([])}>Clear all</Button>
        </div>
      )}
    </div>
  );
}
