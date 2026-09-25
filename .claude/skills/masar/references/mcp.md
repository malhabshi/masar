# The masar MCP server

`/api/mcp` exposes masar to an MCP client. Built in `src/lib/mcp/handler.ts`, created
lazily so Next's build-time page-data collection does not import the heavy MCP graph.

## Two kinds of surface

**Dedicated tools**, registered directly and named in snake_case: `list_students`,
`get_student`, `get_student_chat`, `list_tasks`, `count_tasks`, `list_student_documents`,
`read_student_document`, `list_accepted_offers`, `get_offer_document_candidates`, and
others.

**Everything else**, through two tools: `list_capabilities` for discovery and
`run_action` to execute any of the 112 server actions in `src/lib/actions.ts`. The
catalog in `src/lib/mcp/action-catalog.ts` is generated from the real signatures and
records argument order, which parameter receives the caller's identity, and whether an
action is destructive. Destructive actions need `confirm: true`.

A tool registered directly will never appear in `list_capabilities`, and an action in the
catalog will never appear in `tools/list`. Look in the right place before concluding
something did not ship.

## Calling run_action correctly

`args` keys are **parameter** names. When a parameter is an object, every field goes
inside that object. `list_capabilities` prints object shapes for exactly this reason:

```
createStudent(values: { studentName: string; phone: string; targetCountries: string[]; … },
              creatingUserId=<you>, creatingUserRole=<auto>, …)
```

`<you>` and `<auto>` are filled from the caller's identity; do not pass them.

## Identity

mcp-handler v2 does not thread `authInfo` into a tool's `extra`, so the bearer token is
read from `extra.http.req.headers` and re-resolved against the `mcp_tokens` collection.
A token document carries `userId`, `role` and `readonly`. A readonly token can discover
and read but every write is refused.

## Reading documents

`get_student` returns storage URLs, and an MCP client cannot fetch a URL that came out of
a tool result. Use `read_student_document` instead: it returns extracted text for PDFs
and an image block for photos. `src/lib/mcp/document-tools.ts` resolves the storage path
from the document record, so only a document on that student's profile can be read.

pdfjs needs browser globals that Node lacks; `installPdfGlobals()` supplies a 2-D matrix
and two stubs rather than pulling in a native canvas build that could fail to deploy.

## Finding offers

`list_accepted_offers` scans every student server-side and groups by university, major
and country, because `list_students` caps at 100 with no pagination and cannot filter by
application country or status. Each row carries `sampleStudentId` and `sampleDocumentId`
ready for `read_student_document`, plus `allStudentIds` so a caller can try another
student when a letter turns out to be a scan. Grouping normalises case, whitespace and
curly apostrophes, all of which vary in this data.

## Adding a tool

Register it in `handler.ts` with a Zod **v4** schema — the bundled MCP SDK requires v4,
which is aliased as `zod-v4`; the rest of the app is on Zod v3. Return
`{ content: [{ type: 'text', text }] }`, and catch errors so a failure comes back as a
readable message rather than a stack trace.
