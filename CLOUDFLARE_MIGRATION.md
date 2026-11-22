# Cloudflare Pages cutover

The `cloudflare-cutover` branch combines the existing main site with the Cloudflare Pages form endpoint. The Pages project binds `SUBMISSIONS_DB` to `chalk-roots-submissions`. Keep the notification secret in encrypted Pages settings.

Verify form persistence and notifications on the production Pages URL before attaching the custom domain.
