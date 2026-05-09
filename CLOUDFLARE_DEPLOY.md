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
npx wrangler pages project create ope-assessor --production-branch main
```

The project name (`ope-assessor`) must match `name` in `wrangler.toml`.

### 4. Configure environment variables

Pages Functions read env vars from the project's settings, not from a `.env`
file. Set them once via the dashboard (Pages → ope-assessor → Settings →
Environment variables) **or** via wrangler:

```sh
npx wrangler pages secret put SUPABASE_URL
npx wrangler pages secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler pages secret put SUPER_ADMIN_EMAIL
npx wrangler pages secret put SUPER_ADMIN_PASSWORD
npx wrangler pages secret put SESSION_SECRET
```

Optional non-secret vars (set under "Environment variables", not "Secrets"):

| Variable | Default | Purpose |
| --- | --- | --- |
| `SUPABASE_TABLE_PREFIX` | `ope_` | Supabase table prefix |
| `ALLOWED_ORIGINS` | (none) | Comma-separated CORS allow-list, or `*` |
| `PUBLIC_BASE_URL` | (none) | Echoed by `/api/health` |
| `SESSION_TTL_MS` | `86400000` | Session lifetime in ms (24 h) |
| `PBKDF2_ITERATIONS` | `100000` | Password-hash iterations |

> **Carry over from Vercel.** If your Vercel project already has these set,
> copy the same values across so existing teacher passwords and student
> sessions keep working without forced resets.

### 5. (Optional) Custom domain

In the Pages dashboard → ope-assessor → Custom domains → Set up a custom
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
curl https://ope-assessor.pages.dev/api/health
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

## Known limitations

- **Server-side PDF export** (`/api/export/pdf`) returns `501` on Cloudflare
  the same way it did on Vercel. The browser fallback (jsPDF + html2canvas)
  handles PDF generation client-side. Running puppeteer on Workers would
  require Cloudflare Browser Rendering — out of scope for this migration.
- **CPU time per request**: Workers free tier allows 10ms CPU per invocation;
  paid tier 30s. Supabase round-trips are wall time, not CPU time, so they
  don't count against this budget. PBKDF2 with 100k iterations is the only
  real CPU consumer and stays well under 10ms.
