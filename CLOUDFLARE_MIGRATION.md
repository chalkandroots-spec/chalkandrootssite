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
3. Website forms remain a cutover blocker. Several pages POST to `/` using Netlify Forms conventions; those submissions are not automatically handled by Cloudflare Pages. Airtable and Resend are retired and must not be recreated. Gmail is the intended interim destination, but a secure delivery mechanism and credentials have not yet been configured. Do not claim forms work on Cloudflare until the replacement handler is implemented and tested end to end.
4. The Standards Generator endpoint and document-generation function remain out of scope for this migration.
5. Test the Cloudflare preview without changing the live domain. Only after approval should DNS be changed. Keep Netlify available for rollback until the Cloudflare production site is verified.

## Current state

This branch is preparation only. Chalky Sage remains outside this migration. Website forms are still a blocker. No production deployment, DNS change, or Netlify cancellation is authorized by this file.
