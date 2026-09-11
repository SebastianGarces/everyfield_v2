# Discovery preview email controls

Read-only code audit. No credentials, provider calls, database writes, deployment changes or browser runs performed. This document is preparation for the root-owned preview runner, not authorization to run it.

## Existing controls

`src/lib/email/client.ts` constructs Resend from `RESEND_API_KEY` and unconditionally calls `resend.emails.send()` when `sendEmail()` runs. There is **no runtime disable switch, recipient allowlist, preview gate or transport override** in this sender. `NODE_ENV=development` adds a success log; it does not disable sending. `EMAIL_FROM` and `EMAIL_REPLY_TO` change identity only. Missing credentials may fail module initialization; fake credentials still attempt provider requests. Neither is a no-provider-call control.

The optional `send` dependency on `announceDiscoveryAssociationChange()` and `sendInvitationEmail()` supports mocked unit tests. Production server actions do not inject it. Browser request interception cannot intercept these server-side calls.

`BETA_INVITE_CODE` controls registration eligibility. A valid, address-matching organization invitation bypasses that gate and is automatically redeemed. It is not an email suppression mechanism. `NEXT_PUBLIC_APP_URL` changes emailed links only.

## Paths exercised by a preview runner

| Action | Email path and recipients | Inert with existing app controls? |
|---|---|---|
| Discovery signup using organization-invitation bypass | `register/actions.ts` → `redeemRegistrationInvitation` → `acceptInvitationAs` → `respondDiscoveryInvitationAs` → `announceDiscoveryAssociationChange` → shared sender. Emails new discovery account and exact-tenancy org Owners. | No. Successful automatic acceptance sends receipts. |
| Create/resend organization invitation | `invitations/core.ts` → invitation email adapter → shared sender. Emails invitee. Discovery emails link to the authenticated dashboard. | No. Fixture creation through these actions also sends. |
| Accept/decline existing discovery invitation | `discovery/associations.ts` → postcommit notice adapter → shared sender. Emails discovery account and exact-tenancy org Owners. | No. |
| Leave/remove discovery association | Same adapter after the winning sever/audit row. Emails subject and exact-tenancy org Owners, including after the relationship ends. | No. |
| Create plant from an existing discovery session | `discovery-actions.ts` → `discoveryPlantCreationStatements`: account/plant/person/privacy/audit/invitation SQL only. | No immediate email path found. Does not make earlier invitation signup or later plant actions inert. |
| Accept an existing seat invitation | `acceptSeatInvitationAction` → `acceptSeatInvitationAs`: claim/retirement/grant/person SQL only. | No immediate email path found. Creating/resending that invitation separately sends through the seat email adapter. |
| Refused lifecycle requests | No winning row means no postcommit association notice. | Locally inert on refusal; cannot substitute for success-case verification. |

Discovery association receipts use **direct transactional email**, not an in-app notification category. Account notification preferences, digest cadence and plant sharing toggles cannot suppress them. They do not invent a church notification for a seatless user. Owners are resolved from current org tenancy; test isolation must cover every resolved Owner, not just the discovery mailbox.

Background notification/digest mail reaches the same sender through `notifications/dispatch.ts`. `/api/notifications/dispatch` requires `CRON_SECRET` and fails closed without it, but this does not affect direct association email. `vercel.json` has no cron jobs; `.github/workflows/notifications-dispatch.yml` targets the stable production alias. A preview sharing that database is not isolated from production dispatch merely because its own route is never called.

## Fail-closed runner prerequisites

Do not run successful invitation-bypass signup, invitation create/resend, or association accept/decline/leave/remove on a preview with the current default transport. Root must first establish a deployment-scoped no-egress/inert transport control independently; no such application control was found. Do not rely on `.invalid` addresses, provider idempotency, wrong keys, browser routing or disabled notification preferences.

With no additional control authorized, isolate those cases as blocked. A preauthorized existing test session can exercise reads, refused mutations, plant conversion and seat acceptance without an immediate mail call, provided fixture creation and background notification/digest dispatch are separately controlled. This does not authorize inserting fixtures or bypassing the real signup acceptance criterion.

The runner must also retain the schema hold: migration 76 shared application is blocked on compatible Evry writers. A local migration proof does not release shared database application or publication.
