'use client';

/**
 * Entry levels and what each one requires.
 *
 * Replaces the old plain tick-boxes. Ticking a level opens a block for that level only,
 * because the requirements genuinely differ between them — Foundation is usually where the
 * IELTS sits, and First Year usually asks for something else entirely.
 *
 * Two rules shape the handling:
 *
 * A blank box stays blank. It is never saved as 0, because "IELTS 0 required" is worse
 * than no answer at all, and a 0 would quietly pass a student who should be stopped.
 *
 * Unticking a level hides its block but keeps what was typed for as long as the dialog is
 * open, so an accidental untick does not destroy a paragraph of notes. Only ticked levels
 * are saved.
 */

import { useState } from 'react';
import * as z from 'zod';
import { useFormContext } from 'react-hook-form';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { cn } from '@/lib/utils';
import type { EntryLevelRequirement } from '@/lib/types';

export const ENTRY_LEVELS = ['Foundation', 'First Year', 'Bachelor Degree'];

/**
 * The level that gets its IELTS boxes without being asked.
 *
 * Foundation is where the English requirement almost always sits. Every other level is
 * asked first, because showing five empty boxes that are nearly always left empty invites
 * someone to put a number in one of them just because it is there.
 */
const IELTS_BY_DEFAULT = 'Foundation';

/** The four IELTS sections, in the order IELTS itself reports them. */
const BANDS = [
  { key: 'ieltsListening', label: 'Listening', short: 'L' },
  { key: 'ieltsReading', label: 'Reading', short: 'R' },
  { key: 'ieltsWriting', label: 'Writing', short: 'W' },
  { key: 'ieltsSpeaking', label: 'Speaking', short: 'S' },
] as const;

/** Every IELTS field on a level, overall included. */
const ALL_BAND_KEYS = ['ieltsOverall', ...BANDS.map(b => b.key)] as const;

/**
 * An IELTS band, or nothing.
 *
 * The empty string is accepted as a value in its own right rather than coerced, because
 * `Number('')` is 0 and a silent 0 here is a wrong requirement rather than a blank one.
 */
const optionalBand = z
  .union([z.literal(''), z.coerce.number().min(0, 'Between 0 and 9.').max(9, 'Between 0 and 9.')])
  .optional();

export const entryRequirementSchema = z.object({
  level: z.string(),
  ieltsOverall: optionalBand,
  ieltsListening: optionalBand,
  ieltsReading: optionalBand,
  ieltsWriting: optionalBand,
  ieltsSpeaking: optionalBand,
  otherRequirements: z.string().optional(),
});

export type EntryRequirementForm = z.infer<typeof entryRequirementSchema>;

/**
 * One row per entry level, always all three, always in the same order.
 *
 * Fixed positions mean the form fields can be addressed by index without hunting for the
 * matching level on every keystroke, and a level the school does not offer simply has an
 * untouched row that never gets saved.
 */
export function entryRequirementDefaults(existing?: EntryLevelRequirement[]): EntryRequirementForm[] {
  return ENTRY_LEVELS.map(level => {
    const found = existing?.find(r => r.level === level);
    return {
      level,
      ieltsOverall: found?.ieltsOverall ?? '',
      ieltsListening: found?.ieltsListening ?? '',
      ieltsReading: found?.ieltsReading ?? '',
      ieltsWriting: found?.ieltsWriting ?? '',
      ieltsSpeaking: found?.ieltsSpeaking ?? '',
      otherRequirements: found?.otherRequirements ?? '',
    };
  });
}

/**
 * Turn the form rows into what gets stored: ticked levels only, blank fields dropped
 * entirely rather than written as undefined — Firestore rejects undefined inside an array.
 */
export function cleanEntryRequirements(
  rows: EntryRequirementForm[] | undefined,
  entryLevels: string[],
): EntryLevelRequirement[] {
  return (rows || [])
    .filter(row => entryLevels.includes(row.level))
    .map(row => {
      const out: EntryLevelRequirement = { level: row.level };
      for (const key of ALL_BAND_KEYS) {
        const value = row[key as keyof EntryRequirementForm];
        if (typeof value === 'number' && Number.isFinite(value)) {
          out[key as keyof EntryLevelRequirement] = value as never;
        }
      }
      const other = (row.otherRequirements || '').trim();
      if (other) out.otherRequirements = other;
      return out;
    })
    // A level that was ticked but left empty carries no information worth storing.
    .filter(row => Object.keys(row).length > 1);
}

/**
 * The sections this level singles out, as letter and score kept apart.
 *
 * Split rather than joined into one string so the letter can be shown bolder than the
 * number — "L5.5 R5.5 W5.5 S5.5" is hard to scan when every character carries the same
 * weight.
 */
export function bandParts(req: EntryLevelRequirement): { short: string; value: string }[] {
  return BANDS.flatMap(b => {
    const value = req[b.key];
    return typeof value === 'number' ? [{ short: b.short, value: value.toFixed(1) }] : [];
  });
}

/** True when this level says nothing at all and should fall back to the row's IELTS. */
export function isEmptyRequirement(req: EntryLevelRequirement): boolean {
  return Object.keys(req).length <= 1;
}

/**
 * The open block for one ticked entry level.
 *
 * Foundation shows its IELTS boxes straight away. Every other level is asked whether it
 * even has its own requirement, and answering no clears whatever was typed — leaving a
 * stale number behind while the answer says "no" would mean saving a requirement the
 * school never set.
 *
 * The "other requirements" box is always shown, because that is the part First Year
 * usually needs.
 */
function LevelDetails({ level, index }: { level: string; index: number }) {
  const form = useFormContext();
  const isDefaultLevel = level === IELTS_BY_DEFAULT;

  const [wantsIelts, setWantsIelts] = useState<boolean>(() => {
    if (isDefaultLevel) return true;
    // Already has scores recorded, so the question was answered yes last time.
    const row = form.getValues(`entryRequirements.${index}`) || {};
    return ALL_BAND_KEYS.some(key => {
      const value = row[key];
      return value !== '' && value !== null && value !== undefined;
    });
  });

  const clearBands = () => {
    for (const key of ALL_BAND_KEYS) {
      form.setValue(`entryRequirements.${index}.${key}`, '');
    }
  };

  return (
    <div className="space-y-3 border-t px-3 py-3">
      {!isDefaultLevel && (
        <div className="flex items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
          <div className="space-y-0.5">
            <p className="text-xs font-medium">
              Does {level} have its own IELTS requirement?
            </p>
            <p className="text-[10px] text-muted-foreground">
              Most schools only set one for Foundation. Leave this off and the general score
              above applies.
            </p>
          </div>
          <Switch
            checked={wantsIelts}
            onCheckedChange={value => {
              setWantsIelts(value);
              if (!value) clearBands();
            }}
          />
        </div>
      )}

      {wantsIelts && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <FormField
            control={form.control}
            name={`entryRequirements.${index}.ieltsOverall`}
            render={({ field: band }) => (
              <FormItem>
                <FormLabel className="text-[11px] font-semibold uppercase tracking-wide">
                  Overall
                </FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    step="0.5"
                    min="0"
                    max="9"
                    placeholder="—"
                    className="h-8"
                    value={band.value ?? ''}
                    onChange={e => band.onChange(e.target.value)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {BANDS.map(b => (
            <FormField
              key={b.key}
              control={form.control}
              name={`entryRequirements.${index}.${b.key}`}
              render={({ field: band }) => (
                <FormItem>
                  <FormLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {b.label}
                  </FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.5"
                      min="0"
                      max="9"
                      placeholder="—"
                      className="h-8"
                      value={band.value ?? ''}
                      onChange={e => band.onChange(e.target.value)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
        </div>
      )}

      <FormField
        control={form.control}
        name={`entryRequirements.${index}.otherRequirements`}
        render={({ field: other }) => (
          <FormItem>
            <FormLabel className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Other requirements for {level}
            </FormLabel>
            <FormControl>
              <Textarea
                placeholder="e.g. High school average 70%+. Maths required."
                className="min-h-[56px] text-sm"
                value={other.value ?? ''}
                onChange={other.onChange}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

export function EntryRequirementsField() {
  const form = useFormContext();
  const entryLevels: string[] = form.watch('entryLevels') || [];

  return (
    <FormField
      control={form.control}
      name="entryLevels"
      render={({ field }) => (
        <FormItem>
          <div className="mb-2">
            <FormLabel>Entry Levels &amp; Requirements</FormLabel>
            <FormDescription>
              Tick the levels this school offers, then fill in what each one asks for. Leave a
              box blank if the school does not ask for it.
            </FormDescription>
          </div>

          <div className="space-y-2">
            {ENTRY_LEVELS.map((level, index) => {
              const checked = entryLevels.includes(level);
              return (
                <div
                  key={level}
                  className={cn(
                    'rounded-md border transition-colors',
                    checked ? 'bg-muted/30' : 'hover:bg-muted/50',
                  )}
                >
                  <label className="flex flex-row items-center space-x-3 p-2 cursor-pointer">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={isChecked => {
                        field.onChange(
                          isChecked
                            ? [...entryLevels, level]
                            : entryLevels.filter((l: string) => l !== level),
                        );
                      }}
                    />
                    <span className="text-sm font-medium w-full">{level}</span>
                  </label>

                  {checked && <LevelDetails level={level} index={index} />}
                </div>
              );
            })}
          </div>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
