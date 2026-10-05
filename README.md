# Shiftboard — Timesheet replacement

Employee shift scheduling built with Next.js, TypeScript, Supabase Auth, and Supabase Postgres. The application lives in `web/` so the existing Timesheet Vercel project can keep **Root Directory: `web`**. It is intended to reuse the Timesheet Supabase project.

The replacement is merged into `main` in the [GitHub Timesheet repository](https://github.com/xhello/timesheet) and deployed at **https://timesheet-sable.vercel.app** through Vercel project `justicehires-projects/timesheet`. The existing Timesheet Supabase project has been resumed, the scheduler migration applied, and production authentication, email delivery settings, and server credentials configured. Create and verify the account matching the configured `ADMIN_EMAIL` to initialize the scheduler. The original local Timesheet checkout and its uncommitted changes remain intact; its pre-replacement base is `f9e735c`.

## Included

- Sunday–Saturday Front Desk schedule, including overnight and hotel-cleaning shifts.
- Employee shift preferences, custom admin priority, and optional hire-date seniority sorting.
- Live priority-based assignments when employees request shifts, with ranked requester lists visible to the team.
- Manual assignment and move controls that take precedence over automatic requests.
- One-tap employee requests and cancellation, inline admin assignment, and a daily view on phones.
- Create a week from any earlier week's shifts, with optional employee assignments, or use standard shifts.
- Configurable daily/weekly limits, defaulting to 8 and 40 hours, with explicit admin overrides.
- Verified email/password sign-in for the admin; employees sign in using their registered phone number alone.
- Admin-managed employee phone numbers and a copyable employee login link. No employee email, password, SMS verification, or invite code.
- Server-side authorization, private database access, and optimistic concurrency checks.

## Connect the Timesheet Supabase project

Production reuses the existing Timesheet Supabase project and its original keys. The project had been paused and was resumed during deployment. The following instructions document the configuration for future environments; production already has its **server-only service-role key** configured.

Production has the migrations in `supabase/migrations/` applied. For a fresh environment, run them in filename order in the project's SQL Editor. `0001_workspace.sql` creates the private scheduler store. `0002_employee_login_rate_limits.sql` adds shared login counters and a server-only rate-limit function. These additions do not change Timesheet attendance tables or import their records. If the table already exists, inspect its schema and data before making changes.

The scheduling table enables Row Level Security and revokes access from anonymous and authenticated browser clients. The server accesses it using the service role and enforces application permissions. Existing Timesheet tables and their policies remain unchanged.

The old destructive `supabase/schema.sql` was removed from this branch and remains in Git history at `f9e735c`. **Do not run it against the reused database:** it drops Timesheet tables with `CASCADE`.

Production account emails use the existing verified Resend provider. The Supabase Authentication configuration is:

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
| `ADMIN_EMAIL` | The only email allowed to register or sign in as administrator. |
| `EMPLOYEE_SESSION_SECRET` | A random server-only secret of at least 32 characters for employee sessions. Keep it stable across deployments. Changing it signs every employee out. |
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

Open `http://localhost:3000`. Full integration verification requires the configured database, migration, and Auth settings. Check verified admin setup, employee phone login, shift requests, priority assignment, hour-limit enforcement and override, sign-out, and admin password reset. Verify phone changes revoke existing employee sessions. Use designated test accounts for onboarding checks.

## Publish future changes to GitHub and Vercel

Use the existing `origin` remote, `https://github.com/xhello/timesheet.git`. Fetch its latest history before publishing changes:

```sh
git remote -v
git fetch origin
git log --oneline --all --decorate -20
```

Review the remote history and reconcile any differences. Commit the reviewed replacement files, excluding credentials and local artifacts. Push the replacement branch without rewriting remote history:

```sh
git push --set-upstream origin codex/replace-with-scheduler
```

Production tracks `main`. Merge future changes into that branch, using a pull request if the repository requires one. Preserve existing commits and reconcile any intervening changes without force-pushing.

The **existing Timesheet Vercel project** is already linked to GitHub `xhello/timesheet`. With access to that project, verify and configure:

- Framework: Next.js; Root Directory: `web`; Node.js: `24.x`.
- Install command: `npm ci`; build command: `npm run build`.
- The environment variables above for Production, and Preview when previews need the database. Keep the service-role key server-only.
- `NEXT_PUBLIC_SITE_URL` matching the actual production/custom domain, with matching Supabase Site URL and redirect allowlist.

Review a preview deployment and its database/authentication behavior before merging to the configured production branch. A preview using the production database can change shared schedule data; use designated test data when validating writes. After production deployment, verify both sign-in methods, schedule loading, and the URL copied by **Copy login link**. The existing public address is `https://timesheet-sable.vercel.app`; the replacement uses it after the production deployment succeeds.

## Data and account transition

Admin setup imports the original October 11–17, 2026 Front Desk spreadsheet snapshot: seven employees and 35 slots. Google Sheets is an initial snapshot, not live synchronization. No live Timesheet records or later edits from the earlier Sites-hosted schedule have been migrated.

The admin creates and verifies the account matching `ADMIN_EMAIL`, signs in through **Admin sign in**, and sets up the workspace. Existing admin accounts continue working. Under **Team**, edit each employee and save their phone number. Employees open `/login` and enter that number; no account registration or verification step is required. Old employee email identities and joining codes no longer grant employee access.

Use one unique phone number per active employee. US/Canada 10-digit numbers are normalized to +1; other numbers require an explicit +country code. Leaving a number blank disables employee login. Changing or clearing it invalidates existing sessions; ordinary name or hire-date edits preserve them. Employee sessions last up to seven days and cannot access admin controls or other employees' phone numbers.

Phone-only access is intentional: anyone who knows a registered number can sign in as that employee. Signed HttpOnly cookies and shared rate limits protect session integrity and limit guessing; they do not verify ownership of the number. Review roster details, priority, hire dates, and imported shifts before sharing the login link.

## Shift requests and priority

To create next week's schedule, navigate to an empty week and select **Create this week**. **Copy from** defaults to the previous week when available; choose any earlier saved week or **Standard shifts**. Copying keeps the shift names, times, and weekdays. **Include assigned employees** is optional and off by default; missing or inactive employees leave open shifts. The new week starts as a draft with fresh requests. Existing weeks stay unchanged. Copied assignments are checked against current hour limits and neighboring overnight shifts, and any exceptions require fresh admin approval.

Choose a complete order under **Team** before automatic request assignment begins. **Use this order** confirms the displayed initial order; moving an employee up or down saves immediately. For each open draft shift, the highest-priority eligible requester is provisionally assigned immediately. A later request from a higher-priority employee can replace that provisional assignment; withdrawal promotes the next eligible requester. Priority changes and work-hour setting changes also recalculate draft request assignments. Overlapping shifts and daily/weekly hour limits remain enforced automatically. Requests that cannot be assigned stay in the queue.

Employees see everyone requesting a shift in priority order, including provisional assignments before publication. Each employee's request notes remain visible only to that employee and the admin. Phone numbers and hire dates remain admin-only. The schedule refreshes periodically while users are not editing.

Employees request or cancel directly on a shift card, with optional notes under **Details**. Filters show all shifts, personal assignments, or personal requests. Phones show one day at a time with a day selector; desktops show the week. Admins assign employees directly on cards, with moves, time changes, and exceptions under Details. Publishing and reopening take one click unless hour-limit overrides need explicit approval.

Imported assignments, manual assignments, and published weeks are preserved. Explicitly clearing or moving an assignment holds the vacated shift open; **Auto-assign** under **More actions** includes those open shifts again. Publishing freezes the week's results; reopen it to collect and recalculate requests.

Hours use calendar days and Sunday–Saturday weeks. Overnight hours split at midnight; compatible overlapping duties count once. Auto-assignment fills requested open shifts and skips conflicts or hour-limit overages. Admins can explicitly override hour limits. Publishing closes requests; later schedule edits reopen affected weeks as drafts.

## Rollback

The pre-replacement Timesheet code is preserved at commit `f9e735c`. To prepare a separate rollback branch without resetting shared history:

```sh
git branch rollback/timesheet-before-scheduler f9e735c
```

For a deployed replacement, promote the previous known-good Timesheet deployment in Vercel, or deploy the rollback branch with the former app's environment configuration. The original local checkout also retains its uncommitted changes, which are not included in `f9e735c`. Keep both the legacy attendance tables and the new scheduling table; application rollback does not require deleting either dataset or rerunning the old schema.
