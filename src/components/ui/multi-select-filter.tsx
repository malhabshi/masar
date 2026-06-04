'use client';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface MultiSelectOption {
  label: string;
  value: string;
}

interface MultiSelectFilterProps {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  className?: string;
}

export function MultiSelectFilter({ label, options, selected, onChange, className }: MultiSelectFilterProps) {
  const allSelected = selected.length === 0;

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      const next = selected.filter(v => v !== value);
      onChange(next);
    } else {
      onChange([...selected, value]);
    }
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  const triggerLabel = allSelected
    ? `All ${label}`
    : selected.length === 1
      ? (options.find(o => o.value === selected[0])?.label ?? selected[0])
      : `${selected.length} ${label}`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn('h-9 gap-1.5 font-normal text-sm justify-between min-w-[120px]', className)}
        >
          <span className="truncate">{triggerLabel}</span>
          <div className="flex items-center gap-1 shrink-0">
            {!allSelected && (
              <span
                role="button"
                tabIndex={0}
                onClick={clear}
                onKeyDown={(e) => e.key === 'Enter' && onChange([])}
                className="rounded-full hover:bg-muted p-0.5"
              >
                <X className="h-3 w-3" />
              </span>
            )}
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-2">
        <div className="space-y-1">
          <button
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
            onClick={() => onChange([])}
          >
            <Checkbox checked={allSelected} onCheckedChange={() => onChange([])} className="pointer-events-none" />
            <span className="font-medium">All {label}</span>
          </button>
          <div className="my-1 border-t" />
          {options.map(opt => {
            const checked = selected.includes(opt.value);
            return (
              <button
                key={opt.value}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                onClick={() => toggle(opt.value)}
              >
                <Checkbox checked={checked} onCheckedChange={() => toggle(opt.value)} className="pointer-events-none" />
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
