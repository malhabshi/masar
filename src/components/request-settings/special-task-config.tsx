
'use client';

import { useFormContext } from 'react-hook-form';
import { FormControl, FormField, FormItem, FormLabel, FormDescription, FormMessage } from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Separator } from '../ui/separator';

export function SpecialTaskConfigSection({ form }: { form: any }) {
  const watchExamTypes = form.watch('specialConfig.examTypes') || [];

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h3 className="text-lg font-bold">Special Task Configuration</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Exam Type Options</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {['ielts', 'toefl', 'ielts_retake', 'ielts_course'].map((exam) => (
                <FormField key={exam} control={form.control} name="specialConfig.examTypes" render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                    <FormControl>
                      <Checkbox 
                        checked={field.value?.includes(exam)} 
                        onCheckedChange={(checked) => {
                          const current = field.value || [];
                          field.onChange(checked ? [...current, exam] : current.filter((v: string) => v !== exam));
                        }} 
                      />
                    </FormControl>
                    <FormLabel className="uppercase font-mono">{exam.replace('_', ' ')}</FormLabel>
                  </FormItem>
                )} />
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Logic & Selection</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <FormField control={form.control} name="specialConfig.requireUniversitySelection" render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                  <FormControl><Checkbox checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel className="text-xs">Select from existing student applications</FormLabel>
                    <FormDescription className="text-[10px]">Employee must pick one of the student's existing applications.</FormDescription>
                  </div>
                </FormItem>
              )} />
              
              <Separator className="my-2" />

              <FormField control={form.control} name="specialConfig.useApprovedUniversitiesList" render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                  <FormControl><Checkbox checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel className="text-xs font-bold text-primary">Use Master Universities List</FormLabel>
                    <FormDescription className="text-[10px]">Employee picks a new school and major from the master Approved Universities list.</FormDescription>
                  </div>
                </FormItem>
              )} />

              {form.watch('specialConfig.useApprovedUniversitiesList') && (
                <div className="pl-7 space-y-3">
                  <FormField control={form.control} name="specialConfig.allowMultipleUniversitySelection" render={({ field }) => (
                    <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                      <FormControl><Checkbox checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
                      <FormLabel className="text-[10px] font-bold text-blue-600">Allow Multiple Selections</FormLabel>
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="specialConfig.countryFilter" render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[10px] font-bold uppercase">Filter list by Country</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value || 'all'}>
                        <FormControl>
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Select country" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="all">All Countries</SelectItem>
                          <SelectItem value="UK">United Kingdom</SelectItem>
                          <SelectItem value="USA">USA</SelectItem>
                          <SelectItem value="Australia">Australia</SelectItem>
                          <SelectItem value="New Zealand">New Zealand</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                </div>
              )}

              <Separator className="my-2" />

              <FormField control={form.control} name="specialConfig.allowPortalReferenceSelection" render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                  <FormControl><Checkbox checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel className="text-xs font-bold text-accent">Allow Portal Reference Selection</FormLabel>
                    <FormDescription className="text-[10px]">Employee can optionally pick a saved portal login (e.g. MOHE, UCAS) from the profile.</FormDescription>
                  </div>
                </FormItem>
              )} />
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Student Data Fields</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {['pullName', 'pullEmail', 'pullPhone', 'passportNameField'].map((f) => (
                <FormField key={f} control={form.control} name={`specialConfig.studentInfo.${f}`} render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                    <FormControl><Checkbox checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
                    <FormLabel className="text-xs">{f.replace(/([A-Z])/g, ' $1').trim()}</FormLabel>
                  </FormItem>
                )} />
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Document Selection</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 gap-4">
              {['allowSelection', 'requireAtLeastOne', 'allowUpload'].map((f) => (
                <FormField key={f} control={form.control} name={`specialConfig.documents.${f}`} render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                    <FormControl><Checkbox checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
                    <FormLabel className="text-xs">{f.replace(/([A-Z])/g, ' $1').trim()}</FormLabel>
                  </FormItem>
                )} />
              ))}
            </CardContent>
          </Card>
        </div>

        {watchExamTypes.includes('ielts') && (
          <Card className="border-blue-200 bg-blue-50/10">
            <CardHeader><CardTitle className="text-sm text-blue-700">IELTS Specific Logic</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <FormField control={form.control} name="specialConfig.ielts.showSubtypes" render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                    <FormControl><Checkbox checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
                    <FormLabel className="text-xs">Show Subtypes (UKVI/Acad)</FormLabel>
                  </FormItem>
                )} />
                <FormField control={form.control} name="specialConfig.ielts.showDates" render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                    <FormControl><Checkbox checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
                    <FormLabel className="text-xs">Show Available Dates</FormLabel>
                  </FormItem>
                )} />
                <FormField control={form.control} name="specialConfig.ielts.showAmount" render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                    <FormControl><Checkbox checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
                    <FormLabel className="text-xs">Show Amount Field</FormLabel>
                  </FormItem>
                )} />
              </div>
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">Currency:</span>
                  <FormField control={form.control} name="specialConfig.ielts.amountCurrency" render={({ field }) => (
                    <Input placeholder="KWD" className="h-7 w-16 text-xs" {...field} />
                  )} />
                </div>
                <FormField control={form.control} name="specialConfig.ielts.dateRule" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs">Date restriction</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value || '5_days_from_today'}>
                      <FormControl>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Select rule" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="5_days_from_today">Min 5 days from today</SelectItem>
                        <SelectItem value="any">Any future date</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
              </div>
            </CardContent>
          </Card>
        )}

        {watchExamTypes.includes('ielts_retake') && (
          <Card className="border-orange-200 bg-orange-50/10">
            <CardHeader><CardTitle className="text-sm text-orange-700">IELTS Retake Logic</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                {['showIdpCredentials', 'showSections'].map((f) => (
                  <FormField key={f} control={form.control} name={`specialConfig.ielts_retake.${f}`} render={({ field }) => (
                    <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                      <FormControl><Checkbox checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
                      <FormLabel className="text-xs">{f.replace(/([A-Z])/g, ' $1').trim()}</FormLabel>
                    </FormItem>
                  )} />
                ))}
              </div>
              <div className="space-y-3">
                {['showPreferredTime', 'showOriginalDate'].map((f) => (
                  <FormField key={f} control={form.control} name={`specialConfig.ielts_retake.${f}`} render={({ field }) => (
                    <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                      <FormControl><Checkbox checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
                      <FormLabel className="text-xs">{f.replace(/([A-Z])/g, ' $1').trim()}</FormLabel>
                    </FormItem>
                  )} />
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {watchExamTypes.includes('ielts_course') && (
          <Card className="border-green-200 bg-green-50/10">
            <CardHeader><CardTitle className="text-sm text-green-700">IELTS Course Logic</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <FormField control={form.control} name="specialConfig.ielts_course.showOptions" render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                    <FormControl><Checkbox checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
                    <FormLabel className="text-xs">Show Course Duration/Mode Options</FormLabel>
                  </FormItem>
                )} />
                <FormField control={form.control} name="specialConfig.ielts_course.showSundaysOnly" render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                    <FormControl><Checkbox checked={!!field.value} onCheckedChange={field.onChange} /></FormControl>
                    <FormLabel className="text-xs">Restrict Dates to Sundays Only</FormLabel>
                  </FormItem>
                )} />
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
