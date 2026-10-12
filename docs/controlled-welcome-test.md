# Controlled welcome-email verification (no production changes)

## Confirmed so far
- Resend sending domain `chalkandroots.com` verified by account owner.
- `RESEND_API_KEY` exists in Netlify, with different deploy-context values. **Presence is not a credential test.**
- Existing production `submission-created` had two HTTP 200 requests on Oct 10. This does not establish email delivery.
- PR #26 preview builds completed; no live migration test yet.

## Safe test procedure — requires operator approval
1. Keep PR #26 **draft** and keep production `RESOURCE_WELCOME_EMAILS_ENABLED` unset/false. Do not disable Claude until cutover.
2. Inspect one *redacted* Netlify form submission's actual event shape to confirm stable `payload.id` or `payload.submission_id`. Do not paste full personal data, secrets or raw submission payload into GitHub.
3. Check the Netlify Blobs SDK version and actual conditional `onlyIfNew` behavior **on the preview deploy** before allowing email. Simulate two parallel identical submissions and a storage failure. Require one verified claim, not just HTTP 200.
4. Verify the preview context has a valid Resend API key and sending permission, without displaying the key.
5. Use the owner's authorized recipient `chalkandroots@gmail.com` only. Use a *new unique* preview test submission ID and a preview-specific record. Avoid historical lead replay. No real subscriber addresses.
6. Enable `RESOURCE_WELCOME_EMAILS_ENABLED=true` **only for Deploy Previews**, after confirming the preview has a separate, working credential and its forms do not write unintended production leads. Verify the preview's webhook routing and form submission event format.
7. Submit once; check Netlify execution logs, the Airtable test record, Resend message ID/status, and Gmail inbox. Test a duplicate event only after first-send reconciliation.
8. Return preview flag to false. Record evidence without personal data; only then decide whether to merge and perform a coordinated cutover.

## Stop conditions
- Any ambiguity about preview isolation, claim semantics, credential scopes, sender, or recipient: **do not send**.
- A successful build, 200 function response, or Resend API acceptance alone is not evidence of delivered email.
- Current resource copy is generic and does not include verified personalized resource URLs; confirm actual resource delivery before enabling.
- Claims intentionally hold ambiguous sends. Build a reconciliation/alert workflow before launch; never silently retry.
- No deployment, sending, or enabling has been authorized by this document.
