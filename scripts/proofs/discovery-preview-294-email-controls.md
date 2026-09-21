# Discovery preview email controls

Read-only code audit. No credentials, provider calls, database writes, deployment changes or browser runs performed. This document is preparation for the root-owned preview runner, not authorization to run it.

## Existing controls and corrected SDK finding

The application has no no-send switch. However, the aggregate locks Resend 6.10.0, whose CJS and ESM SDK builds read `RESEND_BASE_URL` at module initialization. A verified, nonempty deployment-scoped override can direct the real sender to a root-owned authenticated capture service. It must never forward or redirect requests. Use its actual credential via `RESEND_API_KEY`, not a production provider credential. Root must verify actual environment, sink configuration, canary and runtime capture receipts; a wrong key is not proof.

Missing/empty override restores `https://api.resend.com`. Missing credentials can fail initialization; fake keys still attempt requests. `NODE_ENV`, sender identity and notification preferences do not suppress direct mail. Unit dependency injection is not used by deployed server actions, and browser interception cannot intercept server sends.

## Paths exercised by a preview runner

| Action | Email path and recipients | Inert with existing app controls? |
|---|---|---|
| Discovery signup using organization-invitation bypass | `register/actions.ts` → `redeemRegistrationInvitation` → `acceptInvitationAs` → `respondDiscoveryInvitationAs` → `announceDiscoveryAssociationChange` → shared sender. Emails new discovery account and exact-tenancy org Owners. | Only with verified SDK capture transport; automatic acceptance sends receipts. |
| Create/resend organization invitation | `invitations/core.ts` → invitation email adapter → shared sender. Emails invitee. Discovery emails link to the authenticated dashboard. | Only with verified SDK capture transport; fixture actions also send. |
| Accept/decline existing discovery invitation | `discovery/associations.ts` → postcommit notice adapter → shared sender. Emails discovery account and exact-tenancy org Owners. | Only with verified SDK capture transport. |
| Leave/remove discovery association | Same adapter after the winning sever/audit row. Emails subject and exact-tenancy org Owners, including after the relationship ends. | Only with verified SDK capture transport. |
| Create plant from an existing discovery session | `discovery-actions.ts` → `discoveryPlantCreationStatements`: account/plant/person/privacy/audit/invitation SQL only. | No immediate email path found. Does not make earlier invitation signup or later plant actions inert. |
| Accept an existing seat invitation | `acceptSeatInvitationAction` → `acceptSeatInvitationAs`: claim/retirement/grant/person SQL only. | No immediate email path found. Creating/resending that invitation separately sends through the seat email adapter. |
| Refused lifecycle requests | No winning row means no postcommit association notice. | Locally inert on refusal; cannot substitute for success-case verification. |

Discovery association receipts use **direct transactional email**, not an in-app notification category. Account notification preferences, digest cadence and plant sharing toggles cannot suppress them. They do not invent a church notification for a seatless user. Owners are resolved from current org tenancy; test isolation must cover every resolved Owner, not just the discovery mailbox.

Background notification/digest mail reaches the same sender through `notifications/dispatch.ts`. `/api/notifications/dispatch` requires `CRON_SECRET` and fails closed without it, but this does not affect direct association email. `vercel.json` has no cron jobs; `.github/workflows/notifications-dispatch.yml` targets the stable production alias. A preview sharing that database is not isolated from production dispatch merely because its own route is never called.

## Fail-closed runner prerequisites

The version 2 runner requires hash-bound reviewed deployment/environment/sink/canary evidence, actual development database identity/schema checks and an authenticated fresh capture challenge before browser launch. See `discovery-preview-294.md` and the evidence module for the precise protocol. Do not accept an approval flag alone as proof of transport isolation.

Sebastian explicitly authorizes root to use the existing development database and apply migrations through 0079. The proof retains frozen 0077/0078 checks and permits later ledger entries. A dedicated database is not required. Run-scoped fixture identity and cleanup remain mandatory; production/customer data remain outside scope. Quiesce background provider dispatch on every environment reaching this database, including stable scheduled aliases, for the proof window. Other development rows must not be included in fixture cleanup.

With transport verified, the real signup and lifecycle success paths execute with exact captured-mail assertions. Without it they remain unverified and execution must fail before the browser launches. Captured requests prove email handoff, never provider delivery. No worker provisioning or actual browser/database/provider execution is performed by preparing this bundle.
