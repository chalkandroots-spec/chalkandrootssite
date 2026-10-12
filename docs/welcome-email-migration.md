# Chalk & Roots — Netlify + Resend welcome-email consolidation

Status: **design / review only**. Do not deploy or disable the Claude routine until verified.

## Scope
Netlify Forms is the intake; Netlify Functions is the only welcome-email sender; Resend sends; Airtable Leads records the submission and confirmation state. Claude/Gmail must not send any welcomes after cutover.

Sources: standards-generator, smart-contact, vault-signup, free-resource-gate, site-feedback, quiz-result, lesson-standard, contact, and gold-giveaway. The first eight have their existing resource/contact semantics; gold-giveaway has its separate giveaway confirmation. Anonymous poll forms must not be emailed.

## Existing code audit
- `submission-created.js` already calls Resend for contact and smart-contact general acknowledgements; the standards generator also sends generated documents. Do **not** add a generic welcome on top of those messages.
- `vault-signup`, `free-resource-gate`, and `quiz-result` currently write Airtable Leads without a visitor welcome. `lesson-standard` writes to a separate requests table and notifies the owner.
- `site-feedback` currently falls through to the skipped-form branch. Confirm whether feedback submitters should receive an acknowledgement before adding one.
- `smart-contact` routes by topic; only general inquiries already get a visitor acknowledgement.
- Giveaway draft currently fails closed when a prior unconfirmed record exists; it cannot guarantee uniqueness under arbitrary concurrent requests. Airtable is not an atomic lock.

## Non-negotiable delivery controls
1. Identify submissions by immutable Netlify submission ID; add an Airtable text field `Netlify Submission ID` (or a separate outbox table with unique constraints) and store the actual Resend email ID and state.
2. Before sending, reserve a **unique, atomic** send key (submission ID + message type, or email + campaign for one-per-email giveaway). Airtable lookups alone do not provide this. Select and test a durable store with conditional create / atomic uniqueness; do not claim exactly-once otherwise.
3. Send with stable Resend idempotency key, store the Resend email ID, and only mark `Welcomed` when Resend confirms acceptance. Acceptance is not proof of inbox delivery.
4. Distinguish `pending`, `accepted`, `failed`, and `unknown`; fail closed on unknown. Provide an owner-visible reconciliation report; no blind retries.
5. Never equate giveaway entry with newsletter subscription or promise a free flipbook to every entrant.
6. Verify sender domain, environment variables, webhook payload fields, Netlify form detection, and deployment logs in a controlled test.
7. Verify all nine forms and their existing resource links/attachments; preserve existing notifications to the owner and avoid sending both acknowledgement and welcome for the same submission.

## Cutover checklist
- [ ] Implement and mock-test unified send/outbox behavior for each form and simultaneous duplicate events.
- [ ] Verify a real email to the owner's address from a test submission, with Resend logs and Airtable state.
- [ ] Reconcile previously welcomed leads; do not replay historical submissions.
- [ ] Disable the Claude hourly lead sync + welcome routine **only at coordinated cutover**; verify Netlify is then the sole writer/sender. Keep unrelated Claude routines untouched unless separately approved.
- [ ] Monitor new submissions and failures; maintain a manual rollback plan.

## Operational note
Claude's routine reported `USAGE_LIMIT_REACHED`, so the old hourly path may already be failing. Do not rely on its running status as evidence that mail is delivered.

## October 11–12 draft implementation verification

- The opt-in resource handler covers `vault-signup`, `free-resource-gate`, and `quiz-result`. Its flag defaults off; no production rollout.
- Sequential same-submission replay in mocked network tests: one Airtable row and one Resend request.
- Concurrent same-submission delivery in mocked tests: **two Airtable rows and two Resend HTTP requests** with identical submission-derived idempotency keys. Mock tests **do not prove** that Resend deduplicates them. Verify Resend's actual behavior and key retention window; implement atomic uniqueness before declaring safe.
- Airtable read failure: no new row or email. Resend rejection: one pending row, `Welcomed` false, no retry.
- Current implementation requires `payload.id` / `payload.submission_id` / `payload.uuid`; validate actual Netlify event payload. The Netlify form callback may be invoked differently than expected.
- Airtable `Notes` is used to carry the submission ID, and the send-success PATCH preserves it. This is a temporary design, not an atomic unique index.
- Verify the existing `smart-contact` general acknowledgement, `contact` acknowledgement, and standards-generator document email before introducing any generic welcome for those forms. `site-feedback` currently has no visitor acknowledgement in this function.
- **Do not enable the flag, merge PR #26, or disable Claude until the remaining controls and live tests pass.**
