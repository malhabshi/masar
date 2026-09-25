# Deploying masar, and proving a change actually landed

Production is https://studio--studio-9484431255-91d96.us-central1.hosted.app, served by
Firebase App Hosting from the GitHub repo `malhabshi/masar`.

## Pushing is deploying

**A push to `main` deploys to production.** There is no staging environment and no
approval step. Rollout takes roughly six to eight minutes.

The owner reviews work before it ships, so commit locally and wait for them to say
"push". They ask "is it pushed?" often — answer with `git rev-parse origin/main` and the
unpushed count, not from memory.

`vercel.json` exists but nothing reads it. Its cron entries never run. Scheduled work is
Cloud Scheduler hitting `/api/cron/*` with a bearer token from `CRON_SECRET`.

## Local builds must match the deploy, or they prove nothing

App Hosting builds with `output: 'standalone'`, which `next.config.mjs` now pins so a
local build behaves the same way. Two bugs shipped because a normal `npm run build`
passed and standalone did not:

- **Leftover packages.** A dependency present in local `node_modules` but absent from
  `package.json` works locally and is missing in production. Check with `npm ls <pkg>` —
  "extraneous" means it will not be installed on the server.
- **File tracing.** Standalone copies only files it can trace through imports. A file
  loaded by a computed path (pdfjs loads its worker that way) is silently left out. Name
  such files in `experimental.outputFileTracingIncludes`, keyed by route.

Before claiming a server-side change works:

```bash
rm -rf .next && npm run build
cp -r .next/static .next/standalone/.next/
cd .next/standalone && FIREBASE_SERVICE_ACCOUNT_KEY_BASE64="$KEY" PORT=3200 node server.js
```

Then exercise the real route against that server.

## Never build while the dev server runs

`npm run build` and `npm run dev` share `.next`. Running both corrupts it and the site
fails with "Cannot find module './8948.js'". Kill dev first, `rm -rf .next`, then build.

## Verifying a deploy

Do not compare chunk hashes. Local and Google builds hash differently, so identical code
looks changed and vice versa. Instead **grep the served bundle for the actual logic**:

```bash
html=$(curl -s "$BASE/dashboard")
for c in $(echo "$html" | grep -o '/_next/static/chunks/[^"]*\.js' | sort -u); do
  curl -s "$BASE$c" | grep -q "some new string from your change" && echo "live: $c"
done
```

For server-side changes, call the route and check the response.

`gh api repos/malhabshi/masar/commits/<sha>/check-runs` reports the App Hosting rollout,
though it is not always posted.

**Users keep stale JavaScript.** After a rollout the owner often sees no change until a
hard refresh or a new tab. Say so rather than re-investigating.

## Type-checking

`next build` type-checks strictly. Run a complete `npx tsc --noEmit -p tsconfig.json` —
never a timeout-limited one, which can exit before it finds anything.

## Firestore indexes

`firestore.indexes.json` is empty; composite indexes are managed outside the repo. A
query needing one throws at runtime, and `useCollection` logs the error rather than
surfacing it, so the feature just silently shows nothing. When adding a multi-field
query, create the index first and wait for it to be READY.

## Running scripts against production data

There is no separate database. Local scripts talk to production. Use a throwaway `.mjs`
in the repo root reading `FIREBASE_SERVICE_ACCOUNT_KEY_BASE64` from `.env.local`, call
`db.settings({ preferRest: true })`, and delete the file when done. Prefer `.count()`
aggregations and `.select()` field masks over reading whole collections.

Never leave test records behind. If you create one to prove a write path works, delete it
and verify it is gone.
