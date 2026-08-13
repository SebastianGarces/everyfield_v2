import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { OVERSIGHT_ROLES } from "@/lib/auth/access";

import { OVERSIGHT_ADMIN } from "./oversight-admin";

// ============================================================================
// #411 — the pairing table's two structural obligations.
//
// The table itself (`./oversight-admin.ts`) is what stops the SQL audience, the
// per-recipient gate and the recorded-relationship probe from answering "which
// role administers which kind of oversight org?" three different ways; the drift
// between them starved a plant of its daily digest. Its header says so once.
//
// Two things about the table are not visible to the compiler, so they are
// asserted here:
//
//   1. THE ROLE SET IS NOT A SECOND OPINION. `@/lib/auth/access` owns
//      `OVERSIGHT_ROLES`, the flat "roles with oversight access" list that
//      `isOversightUser` and the preference gate read. That module belongs to a
//      different workstream, so the pairing table cannot literally DERIVE the
//      list — but the two may not disagree, in either direction, and a test is
//      what makes the disagreement loud instead of latent.
//
//   2. THE LEAF STAYS A LEAF. Type imports only. `@/lib/auth/access` opens with
//      `import { db } from "@/db"`, so hosting the pairing there made "which
//      role administers a network?" cost a Neon connection and put a database
//      client one import away from anything that wanted the answer.
// ============================================================================

test("§1 the pairing names exactly the roles OVERSIGHT_ROLES names", () => {
  const paired = Object.values(OVERSIGHT_ADMIN).map(({ role }) => role);

  // Both directions. A role added to the flat list without a pairing row has no
  // org kind to administer and would be admitted by nothing; a pairing row
  // whose role is missing from the flat list would build an audience that
  // `isOversightUser` and the oversight preference default disown.
  assert.deepEqual(
    [...paired].sort(),
    [...OVERSIGHT_ROLES].sort(),
    "OVERSIGHT_ADMIN and OVERSIGHT_ROLES must name the same roles"
  );

  // No duplicates: two org kinds administered by one role would make the
  // inverse lookup (`recipientOrgOf`) return whichever row it scanned last.
  assert.equal(new Set(paired).size, paired.length);

  // And the pairing is exhaustive over the anchor kinds by construction — the
  // `satisfies Record<AssociationOrgType, …>` in the table does that half — so
  // this only pins the ORDER the SQL arms are rendered in.
  assert.deepEqual(Object.keys(OVERSIGHT_ADMIN), ["sending_church", "network"]);
});

test("§2 the pairing table is a value-import-free leaf", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src/lib/notifications/oversight-admin.ts"),
    "utf8"
  );

  const imports = [...source.matchAll(/^import\s[\s\S]*?from\s+"([^"]+)";/gm)];

  assert.ok(imports.length > 0, "expected the type import to be found at all");

  for (const statement of imports) {
    assert.match(
      statement[0],
      /^import type\s/,
      `oversight-admin.ts may only import types; found: ${statement[0]}`
    );
  }

  // Named for the trap it exists to prevent rather than by the general rule
  // above: the pairing lived beside `getAccessibleChurchIds` and inherited its
  // `@/db` import. Comments are STRIPPED first — unlike the copy sweeps in
  // `register-path.test.ts`, this rule is about what the module loads, and the
  // header legitimately quotes the import it exists to avoid.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");

  assert.doesNotMatch(code, /from\s+"@\/db"/);
  assert.doesNotMatch(code, /from\s+"@\/lib\/auth\/access"/);
});
