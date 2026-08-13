import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { OVERSIGHT_ROLES } from "@/lib/auth/roles";
import { sourceReader } from "@/lib/testing/source-span";

import { OVERSIGHT_ADMIN } from "./oversight-admin";

// ============================================================================
// #411 — the pairing table's three structural obligations.
//
// The table itself (`./oversight-admin.ts`) is what stops the SQL audience, the
// per-recipient gate and the recorded-relationship probe from answering "which
// role administers which kind of oversight org?" three different ways; the drift
// between them starved a plant of its daily digest. Its header says so once.
//
// Three things about the table are not visible to the compiler, so they are
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
//
//   3. EVERY READER GOES THROUGH IT. The table's largest obligation is about
//      its readers, so it is asserted here rather than in the suite of any one
//      of them: no reader in this domain spells an oversight FK column or an
//      oversight role literal for itself.
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

test("§3 each oversight FK column is named ONCE, in the pairing table", () => {
  // FIX 2's structural half. The role was hoisted into `OVERSIGHT_ADMIN` while
  // the FK stayed spelled per site — three hand-written `kind === "…" ? fkA :
  // fkB` switches whose else-branch absorbs a new org kind in silence, beside a
  // table whose comment claimed "a compile error at every reader". Half a
  // pairing is a pairing written per site.
  //
  // Now every reader indexes or enumerates the table, so the column names
  // appear only in the table itself (and in the `OversightOrgIds` shape they are
  // the derived KEYS of, which is a type, not a branch).
  //
  // THE PROBE FILE IS IN THIS SWEEP TOO, and its absence was the hole the #411
  // re-review found: the pairing was hoisted for three readers while FOUR more
  // hand-written pairings survived in `oversight-relationship.ts` and
  // `oversight.ts` — `RecipientOrg`, `invitationRelationship`,
  // `auditRelationship` (with two org-kind literals of its own) and
  // `networkAudience` — beside a `memory/` paragraph claiming every site read
  // the table. A sweep that names two of the three files is how that happens.
  //
  // AND THE LIST STOPS AT THIS DIRECTORY, deliberately. The one hand-built
  // `OversightOrgIds` left in the repo is outside it —
  // `announceAssociationEndedFor` in `src/lib/invitations/core.ts` — and this
  // sweep neither reaches it nor may edit it: that file belongs to another
  // workstream. So do not read a green §3 as "no half-pairing exists"; it says
  // "none exists in `src/lib/notifications/`". The residual is recorded on
  // `OversightOrgIds` itself (`./oversight-admin.ts`), where the by-construction
  // claim is now scoped to this directory, and it is compile-guarded rather than
  // fail-open: a third `OVERSIGHT_ADMIN` row widens the type's keys and that
  // literal stops compiling.
  const noComments = (code: string) =>
    code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");

  const read = (relative: string) =>
    noComments(readFileSync(path.join(process.cwd(), relative), "utf8"));

  const audience = read("src/lib/notifications/oversight.ts");
  const gate = read("src/lib/notifications/enqueue.ts");
  const probe = read("src/lib/notifications/oversight-relationship.ts");

  // No reader names an oversight FK column or an oversight role literal.
  for (const [label, code] of [
    ["oversight.ts", audience],
    ["enqueue.ts", gate],
    ["oversight-relationship.ts", probe],
  ] as const) {
    assert.doesNotMatch(
      code,
      /table\.sendingChurchId|table\.sendingNetworkId|recipient\.sendingChurchId|recipient\.sendingNetworkId|org\.sendingChurchId|org\.sendingNetworkId/,
      `${label} reaches an oversight FK through the pairing table, not by name`
    );
    assert.doesNotMatch(
      code,
      /"sending_church_admin"|"network_admin"/,
      `${label} names no oversight role literal`
    );
  }

  // The recorded-relationship probe is the strictest of the three: it holds no
  // `users` FK name and no org-kind literal ANYWHERE, because its audit arm
  // reads the kind off the pairing row's key for `association_events.org_type`.
  assert.doesNotMatch(
    probe,
    /sendingChurchId|sendingNetworkId|"sending_church"|"network"/,
    "oversight-relationship.ts writes no oversight FK name and no org-kind literal"
  );

  // The audience CONSTRUCTORS are table-built too. `{ sendingChurchId: null,
  // sendingNetworkId: id }` written by hand is the same half-pairing wearing a
  // constructor: it names one FK, nulls the other by hand, and a third org kind
  // leaves it silently returning an audience missing a key. `oversightOrgOfKind`
  // takes the KIND and lets the table pick the column, so no `: null` for
  // another kind's FK is written anywhere in the module.
  assert.doesNotMatch(
    audience,
    /sendingChurchId: null|sendingNetworkId: null/,
    "oversight.ts builds an org audience from the pairing table, not from a hand-nulled literal"
  );
  assert.match(audience, /oversightOrgOfKind\(/);
  assert.match(audience, /noOversightOrg\(\)/);

  // And the gate has no ORG-KIND ternary left — that else-branch WAS the silent
  // absorber. Spanned through the reader rather than grepped module-wide: the
  // module legitimately discriminates `anchor.type === "church"` elsewhere (a
  // plant is not an org), and a moved anchor THROWS instead of quietly matching
  // nothing (`src/lib/testing/source-span.ts`).
  const administersOrg = sourceReader(gate, "enqueue.ts").span(
    "export function recipientAdministersOrg(",
    "export const dbEnqueueDeps"
  );
  assert.doesNotMatch(administersOrg, /anchor\.type === /);
  assert.match(administersOrg, /OVERSIGHT_ADMIN\[anchor\.type\]/);

  // The pairing itself still says which role goes with which FK, in one place.
  assert.deepEqual(OVERSIGHT_ADMIN, {
    sending_church: { role: "sending_church_admin", fk: "sendingChurchId" },
    network: { role: "network_admin", fk: "sendingNetworkId" },
  });

  // The table's ORDER is load-bearing: the SQL arms render in it and the
  // bound-parameter assertions in `anchor.test.ts` read them positionally.
  assert.deepEqual(Object.keys(OVERSIGHT_ADMIN), ["sending_church", "network"]);

  // The tie to `OVERSIGHT_ROLES` — the flat list `@/lib/auth/access` owns — is
  // asserted in §1 above, in both directions.
  assert.deepEqual(OVERSIGHT_ROLES, ["sending_church_admin", "network_admin"]);
});
