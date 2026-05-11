# Cloudflare Pages Deployment

The OPE Assessor is hosted on Cloudflare Pages. The static site is served by
Pages and the API routes (`/api/**`) run as Pages Functions on the Workers
runtime.

## Architecture

```
Browser  ─►  Cloudflare Pages
                ├── Static assets (index.html, app.js, style.css, …) served from dist/
                └── /api/*  →  Pages Functions in functions/api/** (Workers runtime)
                                  └── Supabase  (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)
```

- `functions/api/_lib/shared.js` — request/response helpers, env-aware Supabase store.
- `functions/api/_lib/auth.js` — HMAC-signed sessions + PBKDF2 password hashing
  (uses `node:crypto` via `nodejs_compat` so existing teacher hashes and
  session tokens keep working after the cutover).
- `state-store.js` — shared module also used by the local Node `server.js`.
  On Pages it's only invoked through the Supabase backend; the file-backed
  branch is unreachable on Workers.

## One-time setup

### 1. Create a Cloudflare account

1. Go to https://dash.cloudflare.com/sign-up and create an account with
   `hredostate@gmail.com` (or whatever email you prefer for billing).
2. Verify the email link.

### 2. Install wrangler and authenticate

```sh
npm install            # installs wrangler as a devDependency
npx wrangler login     # opens a browser to authorize wrangler
```

### 3. Create the Pages project

```sh
npx wrangler pages project create opeassessor --production-branch main
```

The project name (`opeassessor`) must match `name` in `wrangler.toml`.

### 4. Configure environment variables

Pages Functions read env vars from the project's settings, not from a `.env`
file. Set them once via the dashboard (Pages → opeassessor → Settings →
Variables and Secrets) **or** via wrangler:

```sh
npx wrangler pages secret put SUPABASE_URL
npx wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler pages secret put SUPER_ADMIN_EMAIL
npx wrangler pages secret put SUPER_ADMIN_PASSWORD
npx wrangler pages secret put SESSION_SECRET
```

> **All five secrets above are required.** The deploy intentionally has *no*
> fallback values for `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD`, or
> `SESSION_SECRET` — if any are missing, the super-admin login endpoint
> returns 503 and every other auth endpoint refuses to mint a session.
> This is to prevent a deployment with secrets left blank from silently
> using known-bad defaults that an attacker could derive from the source.

`SESSION_SECRET` should be a long random string (32+ chars), unique per
deployment. Generate one with:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

If you rotate `SESSION_SECRET` after the initial deploy, every existing
teacher session is invalidated and they have to log in again.

Optional non-secret vars (set under "Environment variables", not "Secrets"):

| Variable | Default | Purpose |
| --- | --- | --- |
| `SUPABASE_TABLE_PREFIX` | `ope_` | Supabase table prefix |
| `ALLOWED_ORIGINS` | (none) | Comma-separated CORS allow-list, or `*` |
| `PUBLIC_BASE_URL` | (none) | Echoed by `/api/health` |
| `SESSION_TTL_MS` | `86400000` | Session lifetime in ms (24 h) |
| `PBKDF2_ITERATIONS` | `100000` | Password-hash iterations |

### 5. (Optional) Custom domain

In the Pages dashboard → opeassessor → Custom domains → Set up a custom
domain. Cloudflare will auto-issue a TLS cert. You can either:

- Move the domain's nameservers to Cloudflare (full DNS control), or
- Add a CNAME at your existing DNS provider pointing to the Pages
  `*.pages.dev` URL.

## Local development

```sh
npm run cf:dev
```

This starts `wrangler pages dev` against the project root. The static site
lives at `http://localhost:8788/`, and `/api/*` routes hit the local Pages
Functions runtime with the same `nodejs_compat` flag the production deploy
uses.

For env vars during local dev, create `.dev.vars` at the project root with
the same `KEY=value` format as `.env`:

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
SUPER_ADMIN_EMAIL=...
SUPER_ADMIN_PASSWORD=...
SESSION_SECRET=...
```

`.dev.vars` is gitignored by convention — keep it out of source control.

## Deploying

```sh
npm run cf:deploy
```

This runs `scripts/build-cf-pages.js` (which stages production-only static
assets into `dist/`) and then `wrangler pages deploy` (which uploads `dist/`
plus `functions/`).

The first deploy creates a `*.pages.dev` URL. Subsequent deploys update the
production branch (or create preview URLs for non-main branches).

## Verifying the deployment

After deploy, smoke-test:

```sh
curl https://opeassessor.pages.dev/api/health
```

Expected: `200` with JSON containing `"runtime":"cloudflare-pages"`,
`"storageBackend":"supabase"`, and `"supabaseConfigured":true`.

Then open the site, log in as a teacher, edit a quiz question, and confirm:
- The save succeeds (per-quiz sync still goes through `PUT /api/quizzes/<id>`).
- Stored attempts re-grade against the new answer key.
- Facility index reflects the edit.

## Files removed during the migration

- `vercel.json` — replaced by `_redirects` and `_routes.json`.
- `.vercelignore` — replaced by the curated `dist/` build step.
- `api/` directory — replaced by `functions/api/`.
- `scripts/verify-quizzes-endpoint.js` — Vercel-only test harness; use
  `npm run cf:dev` to smoke-test locally instead.

## Security model

The auth layer enforces these rules:

| Endpoint | Method | Auth required |
| --- | --- | --- |
| `/api/health` | GET | none |
| `/api/auth/super-admin/login` | POST | none (validates email + password against env vars) |
| `/api/auth/teacher/login` | POST | none (validates email + password against `ope_teachers`) |
| `/api/auth/teacher/register` | POST | none |
| `/api/auth/teacher/change-password` | POST | teacher session |
| `/api/auth/teacher/admin-reset-password` | POST | super-admin session |
| `/api/auth/logout` | POST | none (stateless tokens) |
| `/api/quizzes/<id>` | GET | teacher session — returns `{ quiz, submissions }` for that quiz only, scoped by `teacher_id` (super-admin sees any) |
| `/api/quizzes/<id>` | PUT/POST | teacher session (must own the quiz, or super-admin). Body shapes accepted: (a) bare `<quiz>` for legacy per-quiz save, (b) `{ quiz?, submissions? }` bundle — submissions get upserted with `submission_id` upsert; each must have `quizId === <id>` or 400. Submissions-only body is allowed if the quiz already exists. Used to be served by bulk PUT /api/state/{quizzes,submissions} — now those bulk endpoints are no-ops for teacher sessions. |
| `/api/submissions/share/<shareKey>` | GET | **public** — returns `{ submission, quiz }` for the given share key. No session: the random share key IS the access token. Used by the SPA's `/student-correction/<shareKey>` route so a student opening the link from WhatsApp / email on a different device can load their correction. |
| `/api/state` | GET | session required; teacher sessions see only their own rows; super-admin sees all (password hashes redacted either way) |
| `/api/state/teachers` | GET (any session) / PUT (super-admin only) | teachers GET returns only the caller's own row unless super-admin |
| `/api/state/submissions` | GET (session) / PUT (anonymous OK) | mixed — students need to submit without an account; GET is filtered to the teacher's own quizzes |
| `/api/state/quizzes`, `students`, `tokenTransactions` | GET/PUT | any teacher session; GET filtered to caller's `teacher_id` (or `user_id` for `tokenTransactions`) |
| `/api/export/pdf` | GET/POST | none (returns 501 stub) |

Sessions are stateless HMAC-SHA256 signed JWT-style tokens. No server-side
session store — rotating `SESSION_SECRET` is how you globally invalidate
all sessions.

### Recovering from a security incident

If you suspect a credential leak (e.g., a prior deploy ran with secrets
unset, or `SUPABASE_SERVICE_ROLE_KEY` was committed to git):

1. **Rotate everything.** Supabase dashboard → Project Settings → API → roll
   the service-role key. Generate a fresh `SESSION_SECRET`. Pick a new
   `SUPER_ADMIN_PASSWORD`. Update all three on Cloudflare.
2. **Force teacher re-logins** by changing `SESSION_SECRET` (every old
   token becomes invalid).
3. **Reset teacher passwords** via the admin-reset endpoint if you suspect
   any teacher account was compromised. Their `passwordHash` may have
   leaked from `/api/state` GET before that endpoint required auth.
4. **Audit the `ope_teachers` table** for any rows you didn't create —
   prior to the auth-on-state fix, `PUT /api/state/teachers` was open to
   anonymous writes and an attacker could have inserted rows.

## Known limitations

- **Server-side PDF export** (`/api/export/pdf`) returns `501`. The browser
  fallback (jsPDF + html2canvas) handles PDF generation client-side.
  Running puppeteer on Workers would require Cloudflare Browser Rendering
  — out of scope for now.
- **CPU time per request**: Workers free tier allows 10ms CPU per invocation;
  paid tier 30s. Supabase round-trips are wall time, not CPU time, so they
  don't count against this budget. PBKDF2 with 100k iterations is the only
  real CPU consumer and stays well under 10ms.
- **Submissions PUT is anonymous.** Anyone can `POST` a fabricated
  submission to `/api/state/submissions` with a fake score. This is by
  design (students take quizzes without accounts), but means teachers must
  spot-check submissions for impossible names / scores. A future hardening
  step is server-side scoring so the score field is recomputed from the
  answer key on submit instead of trusted from the client.
- **Quiz answer keys travel in the bulk state response.** Any logged-in
  teacher receives every other teacher's answer keys via `/api/state`.
  Acceptable for a single-school deployment; not acceptable for a
  multi-tenant SaaS. Refactor to a per-teacher scope if that's the goal.

## Recovering quizzes / submissions from a teacher's browser

The app is localStorage-first: every teacher's browser holds the canonical
copy of their own quizzes and the submissions they've graded. If the
Supabase tables get wiped or are restored from an older backup, the
teacher just has to log into the live site from their usual browser and
the per-quiz sync ([app.js:1810](app.js#L1810)) plus the bulk reconciler
re-push everything to the cloud within ~30 seconds.

Order to follow when recovering:

1. Restore the most recent file backup with
   `SOURCE_DATA_FILE=path/to/backup.json npm run migrate:supabase`. This
   merges the snapshot into Supabase using the smart-merge logic in
   [state-store.js:154](state-store.js#L154) — it never overwrites a newer
   record with an older one.
2. Have each teacher log in from the device they normally use. Their
   localStorage will push any data created since the backup snapshot.
3. Spot-check the row counts in Supabase SQL Editor:
   ```sql
   select count(*) from public.ope_quizzes;
   select count(*) from public.ope_submissions;
   select count(*) from public.ope_teachers;
   ```
