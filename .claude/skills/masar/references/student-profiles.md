# Creating and shaping a student profile

Three live paths write to the `students` collection, all through server actions using the
Admin SDK, so `firestore.rules` never applies. The old JotForm webhook is dead — it
returns 404 (`src/app/api/jotform/webhook/route.ts:3`).

| Path | Entry | Action | Id format |
|---|---|---|---|
| Add New Student | `src/components/student/add-student-dialog.tsx` | `createStudent` (`actions.ts:1280`) | `U-<creatorCivilId>-<ts>` or `S-<rand>-<ts>` |
| JotForm | `src/app/(app)/jotform/page.tsx` | `submitJotformApplications` (`actions.ts:3605`) | client-generated, same shape |
| Bulk import | `src/components/student/import-list-dialog.tsx` | `bulkImportStudents` (`actions.ts:4711`) | `B-<rand>-<ts>` |

MCP reaches the first and third through `run_action`. `submitJotformApplications` is
excluded from the catalog because it takes `FormData`.

## createStudent

```ts
createStudent(
  values: { studentName, phone, targetCountries, studentEmail?, phone2?, phone3?,
            gender?, internalNumber?, highSchoolGrade?, schoolName?, schoolType?,
            otherCountry?, notes? },
  creatingUserId, creatingUserRole, creatingUserCivilId?, assignedEmployeeId?
)
```

`studentName` and `phone` are required and validated before Firestore is touched. The
input field is `studentName` but the stored field is `name`; likewise `studentEmail`
becomes `email`. Sending a top-level `name` is the single most common mistake, and it
used to surface as a Firestore error about an undefined field — the validation now names
the whole shape instead.

`assignedEmployeeId` is a **civil ID**, not a user id.

What the write sets that you might not expect:

- `schoolName` is stored at `jotformData.schoolName`, even for a non-JotForm student.
  That is the one place the app reads it from.
- `targetCountries` absorbs free-text `otherCountry`, so the array is not really
  `Country[]`.
- `notes` becomes the first entry in `adminNotes`.
- `profileCompletionStatus` is seeded with all ten gates `false`.
- `isNewForEmployee` is true only when an employee was assigned.

**Duplicate phones warn, they never block.** Three parallel `in` queries across `phone`,
`phone2` and `phone3` set `duplicatePhoneWarning` and `duplicateOfStudentIds` on the new
student only. The query is skipped when there are no phones, because Firestore rejects an
empty `in` array — that was a real crash.

**`accepted_list` is a side channel.** A student whose phone or civil ID was previously
bulk-imported silently inherits `acceptedInfo` and `importListName`. Lookup failures are
swallowed on purpose so they can never block creation.

**Side effects.** An initial-notes message is written into the chat thread. If the student
is unassigned, every admin gets a `system` task and a `new_student_added` WhatsApp.

## The JotForm path

Three forms: UK `240775032170045`, AU/NZ `241203903610442`, USA `242303620566450`.
Submissions are multipart POSTs to `submit.jotform.com`. **JotForm returns HTTP 200 on
rejection**, so success is detected by parsing the body for an error message. Never read a
submission id from the response URL.

Field requirements differ by country. Civil ID is required for **every** country, even
though only the UK and AU/NZ forms have a question for it, because the profile needs it
for duplicate checking and for the internal number. UK additionally needs school name,
and UK or AU/NZ need scholarship and acceptance type; USA needs semester and guardian
date of birth.

Things that will surprise you:

- **The JotForm posts go out before the profile is written.** If creation then throws, the
  applications exist at JotForm and `studentCreated: false` comes back. A retry creates a
  second submission.
- **Student ids are generated on the client** and used as Storage prefixes before the
  document exists.
- **Only passport files become real `documents[]` entries.** Everything else lives as URLs
  under `jotformData.documents`. `addCountryApplication` refuses to run without a
  passport there.
- **Transcript has no JotForm question**, so it is folded into Other Files both on the
  submission and in `jotformData.documents.otherFiles`.
- **Academic intake is hardcoded to 2027**, FALL when the UK is involved and SPRING
  otherwise, overwriting whatever the selects showed.
- **`employeeId` comes from a hardcoded Arabic-name table**, `STAFF_CIVIL_ID_MAP`,
  duplicated in the action and the page. A staff member missing from it produces an
  unassigned student, and this path sends no unassigned alert.
- A generated PDF summary of the whole application is attached to the profile,
  best-effort.
- Before any post, the five-schools-per-pathway-company limit is checked
  (`src/lib/school-quota.ts`), counted **across countries**, not per country.

The live duplicate check on the phone field judges by **civil ID only**. Siblings share
phone numbers, so a name match means nothing; same civil ID means the same person,
different civil ID means a relative.

## Bulk import

Positional spreadsheet columns, header row skipped: Arabic name, three phones, civil ID,
gender, country accepted, major accepted. CSV is decoded as UTF-8 explicitly, because the
XLSX reader guesses Latin-1 and mangles Arabic.

Rows are matched against existing students **by phone only**. A match updates the existing
student with acceptance info and merges new numbers into `phone2`/`phone3`, never touching
the primary. A miss creates a student whose `name` is the Arabic name, always unassigned,
with no duplicate check and no notifications.

Every row is also written to `accepted_list`, which is how later arrivals inherit
acceptance details. The whole import is one batch, so more than 500 operations will throw.

## The student document

- `studyLevel` is `'Foundation' | 'First Year' | 'Transfer Student'` or unset. Only the
  JotForm path sets it. **There is no "Bachelor" level** — First Year is bachelor entry,
  and more than half of all students have no level at all, so any filter on it excludes
  them.
- `applications[]` entries are `{ university, major, country, status, updatedAt }`.
  Country is one of `UK`, `USA`, `Australia`, `New Zealand`, `Ireland`. Status is
  `Pending`, `Submitted`, `Missing Items`, `Accepted` or `Rejected`.
- `targetCountries` is *not* type-safe despite its annotation: it holds
  `'Australia / New Zealand'` from JotForm and free text from Add Student. Only
  `applications[].country` is normalised.
- `pipelineStatus` is a colour, always `'none'` at creation.
- `isClosed` excludes a student from most aggregates.
- Counters like `chatUnreadCountByUser` and `newDocumentsForEmployee` are never set at
  creation; code must tolerate their absence.

## Invariants

1. **`employeeId` is a civil ID.** Resolve the user with
   `users.where('civilId','==',…)`. Some legacy documents hold a uid instead, so
   tolerant code checks both.
2. **Never pass `createStudent` flat arguments.** Everything goes inside `values`.
3. **Never run a Firestore `in` query without checking the array is non-empty.**
4. **Identity is the civil ID, never the name.** Names repeat across families.
5. **Duplicate flags are advisory.** `refreshStudentDuplicateWarning` fixes them up
   bidirectionally; `resolveDuplicate` clears them and is admin-only.
6. **Add New Student profiles have no civil ID at all**, so they can never be confirmed
   as duplicates of anyone.
