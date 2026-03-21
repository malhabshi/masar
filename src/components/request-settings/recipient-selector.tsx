
'use client';

import { useState, useMemo } from 'react';
import type { User, RecipientConfig } from '@/lib/types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { ChevronsUpDown, Search, X, Users as UsersIcon } from 'lucide-react';

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

  // Grouping logic: Group users by their department field
  const groups = useMemo(() => {
    const map = new Map<string, User[]>();
    
    users.forEach(user => {
      const matchSearch = !search || 
        user.name.toLowerCase().includes(search.toLowerCase()) || 
        user.email.toLowerCase().includes(search.toLowerCase());
      
      if (!matchSearch) return;

      const dept = user.department || 'Unassigned';
      if (!map.has(dept)) map.set(dept, []);
      map.get(dept)!.push(user);
    });

    // Sort groups: Departments alphabetically, then Unassigned at the end
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === 'Unassigned') return 1;
      if (b === 'Unassigned') return -1;
      return a.localeCompare(b);
    });
  }, [users, search]);

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

  return (
    <div className="space-y-3">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-between h-auto min-h-[40px] py-2 text-left">
            <div className="flex flex-wrap gap-1 items-center">
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
              {/* Shortcut: All Admins */}
              {!search && (
                <div className="space-y-2 pb-2 border-b">
                  <div 
                    className="flex items-center space-x-2 hover:bg-muted p-1.5 rounded cursor-pointer transition-colors"
                    onClick={() => toggleSelection('group', 'admins', 'All Admins')}
                  >
                    <Checkbox checked={isSelected('group', 'admins')} onCheckedChange={() => {}} />
                    <span className="text-sm font-bold text-primary flex items-center gap-2">
                      <UsersIcon className="h-3.5 w-3.5" />
                      All Admins (Group)
                    </span>
                  </div>
                </div>
              )}

              {/* Dynamic Groupings by Department */}
              {groups.map(([dept, members]) => (
                <div key={dept} className="space-y-2">
                  <div 
                    className={`flex items-center justify-between p-1.5 rounded transition-colors ${dept !== 'Unassigned' ? 'hover:bg-muted cursor-pointer' : ''}`}
                    onClick={() => {
                      if (dept === 'Unassigned') return;
                      toggleSelection('department', dept, `${dept} Department`);
                    }}
                  >
                    <div className="flex items-center space-x-2">
                      {dept !== 'Unassigned' && (
                        <Checkbox checked={isSelected('department', dept)} onCheckedChange={() => {}} />
                      )}
                      <span className="text-sm font-bold">
                        {dept === 'Unassigned' ? 'Unassigned' : `${dept} Department`}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">({members.length} {members.length === 1 ? 'user' : 'users'})</span>
                      </span>
                    </div>
                  </div>
                  <div className="pl-6 space-y-1">
                    {members.map(user => (
                      <div 
                        key={user.id} 
                        className="flex items-center space-x-2 hover:bg-muted p-1 rounded cursor-pointer transition-colors" 
                        onClick={() => toggleSelection('user', user.id, user.name)}
                      >
                        <Checkbox checked={isUserSelected(user)} onCheckedChange={() => {}} />
                        <span className="text-sm">
                          {user.name} <span className="text-xs text-muted-foreground">({user.role})</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {groups.length === 0 && (
                <div className="text-center py-10 text-muted-foreground text-sm">
                  No staff members found matching "{search}"
                </div>
              )}
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
