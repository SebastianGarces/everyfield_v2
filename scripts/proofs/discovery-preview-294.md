# Discovery native release preview proof

Prepared only. Root owns deployment, infrastructure, credentials, fixture application and execution. Supply the final reviewed native runtime SHA through `DISCOVERY_PREVIEW_RUNTIME_COMMIT`. The runner requires that exact SHA in both the deployment record and the hashed evidence. Proof-only commits do not establish the runtime SHA. No worker browser, database, provider or provisioning run is claimed.

The runner now executes all three invitation-bypass Discovery signups, association accept/decline/Leave/Owner sever, role visibility, seat refusal/acceptance and plant transfer with wiki preservation. Success requires DOM observations, per-step SQL assertions and exact captured mail receipts. No approval flag substitutes for evidence of the authorized development database and inert transport.

## Required infrastructure

- A protected preview serving the exact runtime commit, with root-reviewed deployment-to-commit evidence and its current protection-bypass secret.
- The explicitly authorized existing development database through migration 0079. The discovery checks retain the frozen 0077/0078 prerequisite identities; later ledger entries are allowed. Production/customer databases are outside this authorization. Quiesce unrelated writers and provider dispatch for this bounded run; existing unrelated rows may remain. Root applies the actual versioned history using `pnpm db:migrate`. Preserve all applied migration bytes. The runner reads identity and migration assertions before launching a browser. The database must also contain the published global wiki article required by the fixture.
- A root-owned HTTPS capture service, with no forwarding or redirects. The locked Resend 6.10.0 SDK reads `RESEND_BASE_URL` at module initialization. Set it explicitly on this preview before initialization, and use the capture service's actual authentication token via `RESEND_API_KEY`, never a production provider key. No application code change is required. Missing/empty override restores the provider default and must fail root's deployment review.
- Verified configuration/canary evidence for the actual deployment and capture service. Root must establish no provider egress and collect real capture evidence before enabling the browser run. Hash-bound files prove integrity and agreement; they are not signatures, remote attestation, or a replacement for root's infrastructure review. Dummy keys, `.invalid` addresses, preferences and browser interception are not isolation evidence.
- Background provider work disabled. Do not schedule notification dispatch against this database; keep the preview dispatch route inaccessible. Transport capture covers direct notices, which bypass notification preferences.

Sebastian has authorized root to apply migrations and run bounded fixtures against the existing development database, and approved the temporary test-email tunnel. This offline preparation task does not execute those operations. No production migration or release permission follows from this proof. The final native release must include the schema baseline; coordinated application/schema rollout remains root-owned.

## Capture service contract

`POST /emails` accepts Resend's JSON request with the capture authentication token and Idempotency-Key header. It captures the request without forwarding, then returns HTTP 200 JSON `{ "id": "unique-capture-id" }`. Preserve actual attempts rather than hiding duplicate requests through deduplication; the runner must see accidental extra sends. Store captures privately and impose a bounded retention period.

A separate read credential authorizes `GET /proof/<run>?nonce=<fresh UUID>`. Return HTTP 200 without a redirect:

```json
{
  "run": "fixture-run",
  "serviceId": "root-owned-service-id",
  "nonce": "the-request-nonce",
  "canary": {"id":"verified-id","recipient":"owned-address","subject":"verified-canary","idempotencyKey":"verified-key"},
  "requests": [
    {"id":"unique-request-id","method":"POST","path":"/emails","to":["one-owned-address"],"subject":"Discovery association accepted","idempotencyKey":"discovery-association-...","bodySha256":"64-lowercase-hex","accepted":true}
  ]
}
```

The canary is independently verified before the run and excluded from `requests`. Run requests must initially be empty, stay immutable and append-only, and contain only this deployment/run's attempts. Root isolates routing to the run; the application does not add a run header. The runner rejects disappeared/changed receipts, unexpected recipients/subjects/keys, extra or missing attempts and non-200/redirected reads. Three signup acceptances plus lifecycle accept/decline/Leave/sever produce 14 requests, one per subject account and its org Owner. Seat/plant actions produce no new mail. This proves capture handoff, not provider delivery.

## Private evidence and inputs

`discovery-preview-294-evidence.mjs` documents and validates the complete JSON schema. Root supplies `approval.evidence={path,sha256}` for a reviewed evidence JSON binding run, origin, exact runtime, database host/port/name/username, schema78 hash/time and capture service identity. It references SHA256-pinned actual JSON records for deployment environment, sink configuration and canary receipt. All referenced files are private, bounded, and contain no credentials. Negative tests reject changed artifacts, provider-default endpoints, wrong deployment/database/run, invalid canary and stale schema evidence.

Approval also includes `rootAuthorized:true`, `developmentDatabaseAuthorized:true`, `backgroundProviderWorkDisabled:true`, `fixtureAppliedAndBaselineOraclePassed:true`, matching run/origin/runtimeCommit, `deploymentEvidence`, schema77Hash and schema77When. These retained operator fields do not bypass evidence checks.

Frozen identities:

- 77 SHA256 `5f637d2c8a79e0f323af645afb8a682fb6d2e8747031bba50c868c1e7196f521`, timestamp 1789106379915.
- 78 SHA256 `430c2f5881e6237e0e1df6755cfa3e06b75050a2ae5b00d4a2dbea0594e566d2`, timestamp 1789502632040.

Required environment names:

- `DISCOVERY_PREVIEW_RUNTIME_COMMIT`: full 40-character lowercase Git SHA independently reviewed for the native release. No default or branch name is accepted.
- `DISCOVERY_PREVIEW_MANIFEST`: generated version 2 manifest.
- `DISCOVERY_PREVIEW_ROOT_INPUTS`: private approval/evidence reference file.
- `DISCOVERY_PREVIEW_ORIGIN`: exact HTTPS Vercel preview origin.
- `DISCOVERY_PREVIEW_PASSWORD`: matches fixture Argon2id hash and signup password.
- `VERCEL_AUTOMATION_BYPASS_SECRET`: deployment bypass secret.
- `DISCOVERY_PREVIEW_OUTPUT`: new private output directory.
- `PLAYWRIGHT_MODULE`: absolute external Playwright module path.
- `PG_MODULE`: absolute external node-postgres module path.
- `DISCOVERY_PREVIEW_DATABASE_URL`: exact authorized development database connection matching evidence, used only for read-only assertions.
- `DISCOVERY_CAPTURE_PROOF_TOKEN`: separate capture evidence read credential.

No credentials go into tracked files or shell transcripts. Neither dependency requires package/lock edits or a node_modules symlink.

## Root execution and cleanup

1. Prepare and verify deployment/database authorization and capture isolation. Fetch a fresh preview URL by branch with `scripts/preview-url.sh --wait --bypass`; record commit evidence privately. No local dev server.
2. Generate version 2 fixtures offline per `discovery-preview-294-fixture.md`. Review SQL, then root applies it only to the authorized development database. There are no seeded sessions or passwordless bypasses. Run schema/baseline assertion SQL and record results. Use a new namespace after any partially used fixture.
3. Supply the reviewed evidence files and credentials. `node scripts/proofs/discovery-preview-294-browser.mjs` prints the plan without network. `--execute` is root's explicit execution request. Before Chromium launches, the runner validates file hashes, binds database identity, runs schema/baseline assertions and challenges the capture service with a fresh nonce.
4. The runner drives actual forms, reloads and dialogs using fresh authenticated browser contexts. Each signup submits Create account and checks discovery/association state. Lifecycle success actions assert the resulting DOM, then SQL and captured mail. Member/foreign-Owner UI restrictions remain checked. Seat and transfer cases assert database invariants and absence of new mail. SQL executes in read-only transactions. A 15-minute browser deadline, per-query/network timeouts and receipt limits bound execution.
5. Review `report.json`, decisive screenshots and SQL/capture phase results. Capture records themselves stay on the private service; the report stores only event/count metadata and evidence hash. Raw browser errors, bearer URLs, cookies, HAR and storage state are never written. Console/page errors fail except the verified Vercel toolbar 403.
6. Run the host accessibility audit on the discovery page/settings before its account converts. Accessibility ≥90 is required; report unverified if unavailable. Review desktop/mobile overflow, focus, modal refresh persistence and copy. The final automated status explicitly leaves accessibility pending; it is not a complete release gate.
7. On PASS or FAIL, stop the browser before cleanup. Each session teardown first probes the authenticated settings endpoint using its own cookie jar. A 401 records `NOT_AUTHENTICATED` and skips logout. A 200 requires the normal Account menu → Log out action, navigation to login, and an explicit 401 from that endpoint; the case records `LOGGED_OUT_VERIFIED` only after those checks. Probe/UI failures record `FAIL` and fail the run without replacing an earlier case failure reason. Browser context closure still runs in finally even if logout fails. Browser and SQL client closures also occur in finally. Root runs capture.sql, regenerates cleanup using exact generated IDs, inspects and applies it. Cleanup refuses foreign/uncaptured roots and unexpected dependencies; no trigger disabling or broad CASCADE. Delete private capture records, credentials and unneeded screenshots after evidence retention. The runner never performs fixture cleanup or infrastructure changes automatically.

No full browser pass can be inferred from offline tests or fixture post-state. Transport/deployment failure leaves successful signup/association acceptance unverified.
