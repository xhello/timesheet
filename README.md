# Shiftboard — Timesheet replacement

Employee shift scheduling built with Next.js, TypeScript, Supabase Auth, and Supabase Postgres. The application lives in `web/` so the existing Timesheet Vercel project can keep **Root Directory: `web`**. It is intended to reuse the Timesheet Supabase project.

The prepared branch is `codex/replace-with-scheduler`, based on Timesheet commit `f9e735c`, in the [GitHub Timesheet repository](https://github.com/xhello/timesheet). Its `origin` remote is `https://github.com/xhello/timesheet.git`. The original Timesheet checkout and its uncommitted changes were left untouched. GitHub is already connected to Vercel project `justicehires-projects/timesheet`, whose current public address is `https://timesheet-sable.vercel.app`. Completing the replacement still requires Vercel configuration access and working Timesheet Supabase configuration, including the missing server-only service-role key.

## Included

- Sunday–Saturday Front Desk schedule, including overnight and hotel-cleaning shifts.
- Employee shift preferences, custom admin priority, and optional hire-date seniority sorting.
- Automatic assignment plus manual assignment and drag/move controls.
- Configurable daily/weekly limits, defaulting to 8 and 40 hours, with explicit admin overrides.
- Email/password accounts, verified-email admin setup, and one-use employee joining codes.
- Copyable invitations containing the deployment URL, joining code, and instructions.
- Server-side authorization, private database access, and optimistic concurrency checks.

## Connect the Timesheet Supabase project

The saved Timesheet Supabase hostname did not resolve during preparation. Check its active project URL and matching public API key in Supabase project settings, and configure its missing **server-only service-role key**.

Run only `supabase/migrations/0001_workspace.sql` from this repository in that project's SQL Editor. This additive migration creates `public.schedule_workspace`; it does not change Timesheet attendance tables or import their records. Apply it once. If the table already exists, inspect its schema and data before making changes.

The scheduling table enables Row Level Security and revokes access from anonymous and authenticated browser clients. The server accesses it using the service role and enforces application permissions. Existing Timesheet tables and their policies remain unchanged.

The old destructive `supabase/schema.sql` was removed from this branch and remains in Git history at `f9e735c`. **Do not run it against the reused database:** it drops Timesheet tables with `CASCADE`.

In Supabase Authentication:

1. Enable email/password accounts and email confirmation.
2. Configure production SMTP for confirmation and password-reset emails. The former app's `RESEND_API_KEY` environment variable does not configure Supabase Auth email delivery. See the [Supabase SMTP guide](https://supabase.com/docs/guides/auth/auth-smtp).
3. Set the Site URL to the confirmed production app URL. Allow that exact origin's `/auth/callback` and `/auth/confirm` URLs, plus `http://localhost:3000/auth/callback` and `http://localhost:3000/auth/confirm` for local development.

For confirmation links that work across devices, use `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` in the Confirm signup email template. Use `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery` in Reset password. The app also supports PKCE callback links.

## Configure and check the application

Use Node.js 24. Copy `web/.env.example` to `web/.env.local` if a local configuration file does not already exist, then fill in:

| Variable | Value to configure |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | The existing Timesheet Supabase project's active URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | That project's public API key. The existing `NEXT_PUBLIC_SUPABASE_ANON_KEY` variable is also supported. |
| `SUPABASE_SERVICE_ROLE_KEY` | That same project's server-only service-role key. Never prefix it with `NEXT_PUBLIC_`. |
| `ADMIN_EMAIL` | The email of the administrator who will verify their account and initialize the workspace. |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` locally; the confirmed HTTPS app URL in production. |

Never commit `web/.env.local`, service-role keys, or deployment credentials. A successful build without these values does not establish a working database or sign-in flow.

From the repository root:

```sh
cd web
nvm use
npm ci
npm test
npm run build
npm run typecheck
npm run dev
```

Open `http://localhost:3000`. Full integration verification requires the configured database, migration, and Auth settings. Check verified admin setup, an employee joining with a fresh code, shift requests, priority assignment, hour-limit enforcement and override, sign-out, and password reset. Use designated test accounts for onboarding checks.

## Upload to GitHub and replace the Vercel app

Use the existing `origin` remote, `https://github.com/xhello/timesheet.git`. Fetch its latest history before publishing the prepared replacement branch:

```sh
git remote -v
git fetch origin
git log --oneline --all --decorate -20
```

Review the remote history and reconcile any differences. Commit the reviewed replacement files, excluding credentials and local artifacts. Push the replacement branch without rewriting remote history:

```sh
git push --set-upstream origin codex/replace-with-scheduler
```

Merge the replacement into the branch configured for production in Vercel, using a pull request if the repository requires one. Preserve existing commits and reconcile any intervening changes without force-pushing.

The **existing Timesheet Vercel project** is already linked to GitHub `xhello/timesheet`. With access to that project, verify and configure:

- Framework: Next.js; Root Directory: `web`; Node.js: `24.x`.
- Install command: `npm ci`; build command: `npm run build`.
- The environment variables above for Production, and Preview when previews need the database. Keep the service-role key server-only.
- `NEXT_PUBLIC_SITE_URL` matching the actual production/custom domain, with matching Supabase Site URL and redirect allowlist.

Review a preview deployment and its database/authentication behavior before merging to the configured production branch. A preview using the production database can change shared schedule data; use designated test data when validating writes. After production deployment, verify sign-in, schedule loading, and the URL copied by **Copy invite**. The existing public address is `https://timesheet-sable.vercel.app`; the replacement uses it after the production deployment succeeds.

## Data and account transition

Admin setup imports the original October 11–17, 2026 Front Desk spreadsheet snapshot: seven employees and 35 slots. Google Sheets is an initial snapshot, not live synchronization. No live Timesheet records or later edits from the earlier Sites-hosted schedule have been migrated.

Timesheet business codes, client-side password hashes, and face profiles are not Supabase Auth accounts. Create and verify the account matching `ADMIN_EMAIL`, sign in, and select **Set up my admin workspace**. Employees create verified accounts and use fresh joining codes to link to roster entries. Old Timesheet or ChatGPT identities and old invitation codes do not grant access.

Codes expire after seven days and work once; issuing a new code invalidates the prior unused code. Account creation alone gives no schedule access. Review roster details, priority, hire dates, and imported shifts before inviting the team.

Hours use calendar days and Sunday–Saturday weeks. Overnight hours split at midnight; compatible overlapping duties count once. Auto-assignment fills requested open shifts and skips conflicts or hour-limit overages. Admins can explicitly override hour limits. Publishing closes requests; later schedule edits reopen affected weeks as drafts.

## Rollback

The pre-replacement Timesheet code is preserved at commit `f9e735c`. To prepare a separate rollback branch without resetting shared history:

```sh
git branch rollback/timesheet-before-scheduler f9e735c
```

For a deployed replacement, promote the previous known-good Timesheet deployment in Vercel, or deploy the rollback branch with the former app's environment configuration. The original local checkout also retains its uncommitted changes, which are not included in `f9e735c`. Keep both the legacy attendance tables and the new scheduling table; application rollback does not require deleting either dataset or rerunning the old schema.
