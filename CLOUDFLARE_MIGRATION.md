# Cloudflare Pages migration notes

## Scope

This branch prepares the existing Chalk & Roots main website for a parallel Cloudflare Pages deployment. The production Netlify site remains the live site until the Cloudflare preview is verified and the owner approves a domain cutover.

## Pages deployment settings

- Git repository: `chalkandroots-spec/chalkandrootssite`
- Branch: `cloudflare-migration` for preview validation
- Framework preset: None
- Build command: none (static HTML/CSS/JS site)
- Build output directory: `.` (repository root)
- Static redirects: preserve the existing root `_redirects` file
- Wrangler configuration: `wrangler.toml`

## Explicit exclusions

- Do not migrate or recreate Airtable.
- Do not migrate or recreate Resend.
- Do not repair or rebuild the Standards Generator in this migration. Its current Netlify function and document-generation library are not being ported.
- Do not merge PR #26 or PR #22 as part of this work.
- Do not change GoDaddy nameservers, Cloudflare DNS, the production domain, or the Netlify deployment during preview preparation.

## Items requiring validation before a production cutover

1. Compare all public pages, images, videos, downloadable assets, and SEO files on the Cloudflare preview against the live Netlify site.
2. Verify all 66 redirect rules, especially `/go/tutoring`, `/generator`, and the resource links.
3. The active homepage forms now POST to `/api/submit`, implemented as a Cloudflare Pages Function at `functions/api/submit.js`. The function accepts only `vault-signup` and `quiz-result`, validates the same-origin request and fields, and persists the submission to D1 before returning success. The schema is in `migrations/0001_website_submissions.sql`. Configure a Cloudflare D1 database and bind it to the Pages project as `SUBMISSIONS_DB`, then apply the migration before testing. Do not claim forms work until the D1 binding and preview submissions have been tested.
4. Email notification is intentionally separate from persistence. New records are saved with `notification_status='pending'`; Gmail API OAuth delivery and retry processing are not implemented yet. Do not claim email notifications are delivered. Do not recreate Airtable or Resend.
5. The Standards Generator endpoint and document-generation function remain out of scope for this migration.
6. Test the Cloudflare preview without changing the live domain. Only after approval should DNS be changed. Keep Netlify available for rollback until the Cloudflare production site is verified.

## D1 setup for preview

1. Create a D1 database in the Cloudflare account for this site.
2. In the Pages project settings, add a D1 binding named `SUBMISSIONS_DB` pointing to that database.
3. Apply `migrations/0001_website_submissions.sql` to the database using the Cloudflare dashboard SQL console or Wrangler.
4. Deploy the `cloudflare-migration` branch as a preview and test both homepage forms. A form may show success only after the endpoint confirms the D1 insert.
5. Confirm rows appear in `website_submissions`. Confirm email notifications remain marked pending until the separately approved Gmail delivery worker is configured.

## Current state

This branch is preparation only. Chalky Sage remains outside this migration. Website forms are still a blocker. No production deployment, DNS change, or Netlify cancellation is authorized by this file.
