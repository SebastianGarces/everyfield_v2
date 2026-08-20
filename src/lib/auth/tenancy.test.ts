import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { associationOrgTypes } from "@/db/schema";
import type { OversightOrgType } from "@/lib/oversight/types";

import {
  isChurchLevelOwner,
  isChurchLevelUser,
  isOversightUser,
  isPlantOwner,
  oversightOrgOf,
  type SeatFields,
} from "./tenancy";
// The one comment stripper, the one static import scan and the one export-shape
// reader, imported rather than re-spelled. The copy this file used to carry
// (`^import\s+(?!type\b)`) could not see `export … from`, so the leaf could have
// re-served `@/db` and still passed the guard that exists to stop exactly that.
// What the scan itself can see is asserted once, in
// `./server-action-surface.test.ts`; what is local to this file is the LEAF, and
// that is all it asserts below.
import {
  TS_FILES,
  codeOf,
  rel,
  resolveModule,
  staticValueSpecifiers,
  valueExportStatements,
} from "./server-action-surface";

// ============================================================================
// ONE declaration of "which tenancy is this account in", and ONE import path
// to it.
//
// The predecessor of this file guarded the same property about a pair of ROLE
// tuples: `OVERSIGHT_ROLES` was declared twice — in `./access` and again in
// `@/lib/oversight/session` — and the two were reconciled by a regex over
// `access.ts`'s source text, which failed closed but pointed backwards. With
// `users.role` dropped (#494) there is no role list left to declare twice; what
// is declared once instead is the PREDICATE, and the property is the same one.
//
// A LEAF WHOSE CONTENTS ARE ALSO SERVED FROM THE TRUNK IS NOT A LEAF.
// `access.ts` briefly re-exported the old pair "so every existing consumer's
// import path is unchanged" — the `register-path.ts` failure verbatim
// (`memory/invariants.md` → Multi-Tenancy): a second, blessed import path to one
// authority policy, through a module whose first statement is `import { db }
// from "@/db"`. The guard below points forwards: it fails on the next
// re-export, wherever it is written.
// ============================================================================

const THE_ONE_DECLARATION = path.join(
  process.cwd(),
  "src",
  "lib",
  "auth",
  "tenancy.ts"
);

const TENANCY_POLICY_SYMBOLS = [
  "oversightOrgOf",
  "isOversightUser",
  "isChurchLevelUser",
  "isChurchLevelOwner",
  "isPlantOwner",
] as const;

test("tenancy.ts is the ONLY module that exports the tenancy policy", () => {
  // Not "nothing imports `@/lib/auth/access` for these", which is a property
  // about today's call sites: ONE declaration, ONE export, everywhere in `src/`.
  // Any alias is a second import path, and a second import path through a module
  // with `@/db` at the top of it is the leaf rule broken by re-export.
  //
  // Suites are skipped for the reason the sibling guard skips them
  // (`register-path.test.ts` §2): nothing imports a `*.test.ts`, so no bundle or
  // seam edge can come from one, and a suite has to be able to quote the shape
  // it forbids.
  const doors: string[] = [];

  for (const file of TS_FILES) {
    if (file === THE_ONE_DECLARATION) continue;
    if (/\.test\.tsx?$/.test(file)) continue;

    for (const statement of valueExportStatements(codeOf(file))) {
      const names = TENANCY_POLICY_SYMBOLS.some((symbol) =>
        new RegExp(`\\b${symbol}\\b`).test(statement)
      );
      const reservesTheLeaf = staticValueSpecifiers(statement).some(
        (specifier) => resolveModule(file, specifier) === THE_ONE_DECLARATION
      );

      if (names || reservesTheLeaf) doors.push(`${rel(file)} → ${statement}`);
    }
  }

  assert.deepEqual(
    doors,
    [],
    `the tenancy policy is exported from somewhere other than the leaf — a second import path to one authority policy, and through a module with imports of its own (\`access.ts\` opens with \`@/db\`) it is the import-free leaf broken by re-export:\n  ${doors.join("\n  ")}`
  );

  // …and the leaf really does still export them, so the check above is not
  // vacuously true of a policy that has been renamed out from under it.
  const leaf = codeOf(THE_ONE_DECLARATION);
  for (const symbol of TENANCY_POLICY_SYMBOLS) {
    assert.match(leaf, new RegExp(`export function ${symbol}\\b`));
  }
});

test("the leaf reaches no database, which is what lets every site import it", () => {
  // `./access` opens with `import { db } from "@/db"`. A value edge here puts
  // that back one hop away and forces the copy this file exists to prevent.
  assert.deepEqual(
    staticValueSpecifiers(codeOf(THE_ONE_DECLARATION)),
    [],
    "tenancy.ts gained a value import — it is no longer reachable from a no-database module"
  );
});

test("the org kinds are the association org kinds, under another name", () => {
  // The leaf's `OversightOrg` is keyed on `AssociationOrgType`, and
  // `@/lib/oversight/types` spells the same two-valued union `OversightOrgType`.
  // The leaf may not import the oversight domain, so the tie is here.
  const fromOversight: OversightOrgType[] = ["sending_church", "network"];
  assert.deepEqual(
    [...fromOversight].sort(),
    [...associationOrgTypes].sort(),
    "OversightOrgType and associationOrgTypes have drifted apart"
  );
});

// ============================================================================
// The grid. Four tenancy shapes × four seats, every predicate answered.
// ============================================================================

const PLANT = "11111111-1111-4111-8111-111111111111";
const SENDING_CHURCH = "22222222-2222-4222-8222-222222222222";
const NETWORK = "33333333-3333-4333-8333-333333333333";

function account(overrides: Partial<SeatFields> = {}): SeatFields {
  return {
    seat: null,
    churchId: null,
    sendingChurchId: null,
    sendingNetworkId: null,
    ...overrides,
  };
}

test("oversightOrgOf names the org for a single oversight tenancy", () => {
  assert.deepEqual(
    oversightOrgOf(account({ sendingChurchId: SENDING_CHURCH })),
    { type: "sending_church", id: SENDING_CHURCH }
  );
  assert.deepEqual(oversightOrgOf(account({ sendingNetworkId: NETWORK })), {
    type: "network",
    id: NETWORK,
  });
});

test("oversightOrgOf names nothing for a plant tenancy or for none at all", () => {
  assert.equal(oversightOrgOf(account({ churchId: PLANT })), null);
  assert.equal(oversightOrgOf(account()), null);
});

test("a row naming TWO tenancies reaches nothing, in either direction", () => {
  // The defect migration 0050 §1 repaired twelve of. With `users.role` gone
  // there is nothing left to break the tie with, so it is not broken: the row
  // is neither oversight nor church-level, and both authority questions fail
  // closed on it. A precedence order would hand one tenancy's reach to an
  // account that has a competing claim on the other.
  const plantAndNetwork = account({
    seat: "owner",
    churchId: PLANT,
    sendingNetworkId: NETWORK,
  });
  assert.equal(oversightOrgOf(plantAndNetwork), null);
  assert.equal(isOversightUser(plantAndNetwork), false);
  assert.equal(isChurchLevelUser(plantAndNetwork), false);
  assert.equal(isPlantOwner(plantAndNetwork), false);

  const bothOrgs = account({
    seat: "owner",
    sendingChurchId: SENDING_CHURCH,
    sendingNetworkId: NETWORK,
  });
  assert.equal(oversightOrgOf(bothOrgs), null);
  assert.equal(isOversightUser(bothOrgs), false);
  assert.equal(isChurchLevelUser(bothOrgs), false);
});

test("isOversightUser admits the two oversight tenancies", () => {
  // THE POSITIVE HALF. The grid below asserts what is refused, which passes
  // just as well for a predicate that refuses everything — these two are what
  // keep it from being vacuous.
  assert.equal(
    isOversightUser(
      account({ seat: "owner", sendingChurchId: SENDING_CHURCH })
    ),
    true,
    "a sending church's Owner"
  );
  assert.equal(
    isOversightUser(account({ seat: "member", sendingNetworkId: NETWORK })),
    true,
    "a network Member — the SEAT is not what makes a tenancy oversight"
  );
});

test("church-level is a plant tenancy or no tenancy — never an oversight one", () => {
  assert.equal(isChurchLevelUser(account({ churchId: PLANT })), true);
  // A coach: no tenancy, no seat. The FRD's coach-only account.
  assert.equal(isChurchLevelUser(account()), true);
  assert.equal(
    isChurchLevelUser(account({ sendingChurchId: SENDING_CHURCH })),
    false
  );
  assert.equal(
    isChurchLevelUser(account({ sendingNetworkId: NETWORK })),
    false
  );
});

test("isPlantOwner wants BOTH halves, and the org Owner has only one", () => {
  assert.equal(
    isPlantOwner(account({ seat: "owner", churchId: PLANT })),
    true,
    "the plant's Owner"
  );
  assert.equal(
    isPlantOwner(account({ seat: "admin", churchId: PLANT })),
    false,
    "a plant Admin is not its Owner"
  );
  assert.equal(
    isPlantOwner(account({ seat: "member", churchId: PLANT })),
    false,
    "a plant Member is not its Owner"
  );
  assert.equal(
    isPlantOwner(account({ seat: null, churchId: PLANT })),
    false,
    "a seatless account in a plant is not its Owner"
  );
  assert.equal(
    isPlantOwner(account({ seat: "owner", sendingNetworkId: NETWORK })),
    false,
    "a network's Owner holds `owner` and is not any plant's Owner"
  );
});

test("isChurchLevelOwner admits the plant Owner who has no plant YET", () => {
  // Registration mints exactly this row and `runCreateChurch` reads it: the
  // Owner seat, no tenancy, about to create one.
  const beforeTheChurch = account({ seat: "owner" });
  assert.equal(isChurchLevelOwner(beforeTheChurch), true);
  assert.equal(isPlantOwner(beforeTheChurch), false);

  // …and it is still not a door for an oversight org's Owner.
  assert.equal(
    isChurchLevelOwner(
      account({ seat: "owner", sendingChurchId: SENDING_CHURCH })
    ),
    false
  );
});
