import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { organizationInvitationTypes } from "@/db/schema/organization-invitation";
import { stripComments } from "@/lib/testing/source-span";

// ============================================================================
// OV-003b (#293) — ONE implementation of "who invited them", in the invitations
// domain.
//
// The defect this file closes: the inviting org's name was resolved twice, by
// two copies of the same policy — `lookupInvitingOrgName` in `./core.ts` (for
// the invitation email) and a private twin in `(auth)/register/beta-gate.ts`
// (for the invitee's register screen). Identical queries against
// `sendingChurches.name` / `sendingNetworks.name`, identical null semantics,
// and already diverged: core was exhaustive over `OrganizationInvitationType`
// with a `const … : never` guard, while the copy took `type: string` and fell
// through to `null`. Adding a fourth invitation type therefore broke the build
// in one place and silently blanked the org name in the other — proven by
// adding `"church_to_church"` to the enum, which produced six `never` errors in
// `core.ts` and NOT ONE in `beta-gate.ts`.
//
// Two rules, one test each below:
//
//   1. NOBODY RE-READS THE FK COLUMNS. No source file outside `./core.ts`
//      selects a name from `sendingChurches` / `sendingNetworks` to answer this
//      question. Source-shaped for the same reason `register-path.test.ts` is:
//      the thing being pinned IS a call site, and an app-route module that runs
//      its own SQL against another domain's tables cannot be executed here.
//   2. THE `never` GUARD SURVIVES. The one implementation stays exhaustive over
//      the type union. The guard is what makes a single implementation SAFE —
//      widen its parameter back to `type: string` and the copy's silent
//      fall-through is reintroduced inside the survivor.
// ============================================================================

const ROOT = path.join(process.cwd(), "src");

function read(...segments: string[]): string {
  return readFileSync(path.join(ROOT, ...segments), "utf8");
}

// ----------------------------------------------------------------------------
// 1. One reader of the org-name columns
// ----------------------------------------------------------------------------

/**
 * Every module that has ever wanted the inviting org's name. Each must reach it
 * through `@/lib/invitations/core`, never with its own SQL.
 */
const CONSUMERS = [
  // The invitee's register screen — the copy this file was written to bury.
  ["app", "(auth)", "register", "beta-gate.ts"],
] as const;

test("no consumer re-reads sendingChurches/sendingNetworks for the org name", () => {
  for (const segments of CONSUMERS) {
    const source = stripComments(read(...segments));
    const where = segments.join("/");

    assert.match(
      source,
      /lookupInvitingOrgName/,
      `${where} must resolve the inviting org's name through @/lib/invitations/core`
    );

    // The two tables the copy queried. Named, not inferred: a `select` against
    // either of these from outside the invitations domain is the copy coming
    // back, whatever it ends up being called.
    for (const table of ["sendingChurches", "sendingNetworks"]) {
      assert.doesNotMatch(
        source,
        new RegExp(`\\b${table}\\b`),
        `${where} runs its own SQL against ${table} — the org-name decision has ONE implementation (lib/invitations/core.ts)`
      );
    }

    assert.doesNotMatch(
      source,
      /\bfrom "@\/db"/,
      `${where} must reach the invitations domain through its exports, not with its own database handle`
    );
  }
});

// ----------------------------------------------------------------------------
// 2. The survivor stays exhaustive
// ----------------------------------------------------------------------------

test("lookupInvitingOrgName is exhaustive over the invitation types", () => {
  const source = stripComments(read("lib", "invitations", "core.ts"));

  const signature = source.match(
    /export async function lookupInvitingOrgName\(invitation: \{[\s\S]*?\}\): Promise<string \| null> \{([\s\S]*?)\n\}/
  );
  assert.ok(
    signature,
    "lookupInvitingOrgName must stay an exported function in lib/invitations/core.ts"
  );

  const [declaration, body] = [signature[0], signature[1]];

  // The parameter is narrowed to the union, NOT `string`. `type: string` is
  // precisely what let the deleted copy fall through to `null` for a type it
  // did not know about, and it is what the `never` guard below cannot catch.
  assert.match(
    declaration,
    /type: OrganizationInvitationType;/,
    "the parameter's `type` must be OrganizationInvitationType — `type: string` reintroduces the silent fall-through"
  );

  // A fourth type must break the BUILD, not the email.
  assert.match(
    body,
    /const \w+: never = invitation\.type;/,
    "the switch must end in a `never` guard so a new OrganizationInvitationType is a compile error"
  );

  // And every type known today has to be handled, or the guard is unreachable
  // for it and the build stays green while the name comes back null.
  for (const type of organizationInvitationTypes) {
    assert.match(
      body,
      new RegExp(`case "${type}":`),
      `lookupInvitingOrgName does not name the "${type}" invitation type`
    );
  }
});
