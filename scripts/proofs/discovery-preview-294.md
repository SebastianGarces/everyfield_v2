# Discovery 294 preview preparation

Prepared, not executed. Root owns publication, authentication, fixture application, browser execution and teardown. This bundle changes no application code. Runtime under test is `7af503d5c7a44b173efb53284864c41a47ea8f66`; later artifact-only commits do not change it.

Migration0077 SHA256 is `5f637d2c8a79e0f323af645afb8a682fb6d2e8747031bba50c868c1e7196f521`, journal timestamp `1789106379915`. Earlier75/76 files remain frozen. Migration76 must not be applied to the shared database while PR825 Evry writers remain incompatible. Passing the isolated migration proof does not release this hold.

## Scope and hard gap

`discovery-preview-294-browser.mjs` prints its plan by default. It launches nothing unless root supplies `--execute` and the explicit inputs below. Successful invitation-bypass signup and association accept/decline/leave/sever are hard-blocked, without an override flag. The existing runtime has no provider-inert control for those paths. Read `discovery-preview-294-email-controls.md` for the call paths. Fake keys, `.invalid` addresses, disabled preferences and browser routing do not prevent server provider calls.

The prepared safe subset reads signup forms, pending invitations and role-scoped lists; checks canceled confirmation dialogs; performs the no-immediate-email plant transfer and existing-seat acceptance paths. It requires a dedicated database, all resolved fixture recipients under root ownership, and background dispatch disabled. It never creates/resends invitations through application actions. A safe-subset pass is not a signup or association-success pass.

## Root execution sequence

1. Resolve compatibility and provide a dedicated disposable database reachable only by the intended preview. Root applies versioned migrations through77 there, verifying the hash/time above. Do not point the preview at shared development or production. Keep dispatch jobs and other workloads away from this target.
2. Publish the reviewed runtime only when root authorizes it. Resolve the exact deployment using `scripts/preview-url.sh --wait --bypass <branch>` and record its commit evidence privately. Never log the bypass secret or reuse a URL from an earlier deployment. Do not start a local dev server.
3. Generate fixtures offline with `discovery-preview-294-fixture.mjs --help`. Use a fresh run namespace and a root-created password hash matching the password supplied to the browser. The generator has no database/network dependencies. Inspect its SQL, then root applies it to the dedicated target. This preparation has not applied it anywhere.
4. Run the generated baseline oracle before any browser action. Preserve its output privately. Do not rerun fixture setup against a partially used fixture; use a new namespace or finish scoped cleanup first.
5. Supply a private root-input JSON file with the fields below. The assertions are operator attestations, not evidence that the script has inspected deployment settings. Root must actually verify them. Use a fresh private output directory. A Playwright installation is provided outside this repo by absolute module path; do not change package/lock or symlink node_modules.
6. Root may run the safe subset once. The script uses fresh contexts for each account, real login forms, viewport1440×1000 and390×844, and a15-minute browser deadline. Every context and browser closes in `finally`. It saves decisive screenshots and a report with case outcomes, never storage state, cookies, HAR or bearer URLs.
7. Root runs the generated post-safe oracle, then capture SQL to discover browser-created user/plant IDs. Capture is by exact fixture email/actor, not a wildcard. Generate and inspect cleanup SQL from that capture. Close all browsers before cleanup. Cleanup runs on PASS or FAIL, affects only owned IDs and refuses mismatched captured rows. Preserve proof logs, then delete any unneeded screenshots/private token manifests.
8. Run the host accessibility audit on discovery home/settings before conversion. Require accessibility≥90; record unverified if the host has no audit. The runner does not invent a score. Review screenshots for clipping, readable copy, focus and mobile layout. Console errors fail the run except a verified403 from Vercel's own toolbar resource. Root SQL oracles are required for hidden ownership, profile, audit and wiki invariants; DOM alone cannot prove these.

Private root-input JSON shape:

```json
{
  "run": "the generated manifest run",
  "rootAuthorized": true,
  "isolatedDatabase": true,
  "schema77Hash": "5f637d2c8a79e0f323af645afb8a682fb6d2e8747031bba50c868c1e7196f521",
  "schema77When": 1789106379915,
  "runtimeCommit": "7af503d5c7a44b173efb53284864c41a47ea8f66",
  "deploymentEvidence": "private deployment-to-commit evidence path",
  "origin": "https://the-exact-deployment.vercel.app",
  "backgroundProviderWorkDisabled": true,
  "fixtureAppliedAndBaselineOraclePassed": true
}
```

Required environment variable names are `DISCOVERY_PREVIEW_MANIFEST`, `DISCOVERY_PREVIEW_ROOT_INPUTS`, `DISCOVERY_PREVIEW_ORIGIN`, `DISCOVERY_PREVIEW_PASSWORD`, `VERCEL_AUTOMATION_BYPASS_SECRET`, `DISCOVERY_PREVIEW_OUTPUT`, and `PLAYWRIGHT_MODULE`. Supply secrets through root's existing private mechanism. Do not put values in checked-in scripts or command transcripts. After setup, the invocation is `node scripts/proofs/discovery-preview-294-browser.mjs --execute`.

## Cases and decisive assertions

| Case | Prepared interaction | Required outcome |
|---|---|---|
| Invitation bypass, all3 original organization types | Open each seeded `/register?invitation=…`; Tab to the checked radio, use ArrowDown to select Discovery; fill name/password; stop before submit | Discovery selected; invited email read-only; no invite-code or organization-name field. Registration itself remains blocked. |
| Discovery reload/navigation | Real login; open dashboard, reload; open create form by keyboard and cancel; open Association settings | Discovery heading and scoped settings persist; create form focuses name; no horizontal overflow. SQL baseline confirms no seat/tenancy/person ownership. |
| Pending association answers | Open lifecycle account settings with one invitation for each slot | Both orgs expose Accept/Decline with discovery consequences. Neither success button is clicked. |
| Leave dialog | Desktop/mobile Tab→Enter on Leave network; wrong confirmation; Escape | Commit disabled for wrong name; no sever; Escape closes and returns focus. |
| Oversight roles | Owner, same-org Member and foreign Owner use separate real sessions | Owner sees owned associate and sever dialog; Member sees associate with no sever button; foreign Owner sees neither that associate email nor its action. This proves UI visibility only; server forged-request coverage remains in the existing SQL/policy tests. |
| Associated seat refusal | Open seeded seat invitation as associated discovery; submit | Refusal alert and Manage associations and leave link; oracle confirms invite still pending, profile+slot intact, no seat/person grant. |
| Empty-profile seat acceptance | Open other seeded invitation as empty discovery; submit; reload | Leaves discovery home; oracle confirms one seat, expected tenancy/person, profile retired, invitation accepted and coaching preserved. |
| Plant transfer | Existing dual-associated discovery; verify saved wiki article; Create plant on mobile; review both orgs; Tab/Space consent; submit; reload and revisit wiki | Discovery home gone; bookmark remains; oracle checks canonical Owner/person/privacy including share_wiki, both transferred orgs, four audits, profile retirement, pending invitation retarget and unchanged wiki completion/coaching. |

## Blocked success recipes, ready for a future inert deployment

These are not executable under the current transport. Root must separately establish and review an actual deployment-scoped inert sender or no-egress control before enabling any future runner implementation. This bundle adds no such control.

* Signup: for each of3 original org invitation types, select Discovery and submit Create account. Assert redirect to Explore church planting; reload; open associations and see the inviting org in its correct slot. Read exact-email user/profile/invitation/audit rows: no seat or tenancy, profile belongs to new user, invitation targeted/bound and accepted exactly once. Verify no person/church was minted. Capture each new account ID for cleanup.
* Accept: as lifecycle discovery, accept the network invitation. Its pending card disappears; network association appears. Reload. Oracle: accepted response/user, one network slot, sending-church slot unaffected, one associated audit. A replay cannot duplicate audit or change tenancy.
* Decline: decline the sending-church invitation. Card disappears; network remains. Oracle: declined response/user, sending slot stays empty, no associated/disassociated audit for a decline. This is a distinct case from canceling a dialog.
* Leave: type the exact network name, commit Leave network, then reload. Network association disappears; account remains discovery with wiki data unchanged. Oracle: only that slot cleared and one disassociated audit; no deletion of account or other slot.
* Owner sever: use a separately associated fixture subject. Owner types that subject's exact name and commits End association. The row disappears from its own portfolio; the subject remains available and loses only this org slot. Member/foreign Owner controls must remain unavailable. To prove server refusal beyond the UI, use a separately reviewed authenticated action harness bound to that exact build, not guessed Next action IDs. Audit and scope assertions are mandatory.

Record these five paths as BLOCKED_PROVIDER_CONTROL, never PASS from fixture post-state. Existing hermetic/SQL proofs remain separate evidence and do not replace the missing real preview interactions.
