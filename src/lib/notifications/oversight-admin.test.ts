import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { oversightOrgOf } from "@/lib/auth/tenancy";
import { sourceReader, stripComments } from "@/lib/testing/source-span";

import { OVERSIGHT_ADMIN } from "./oversight-admin";

// ============================================================================
// #411 — the pairing table's three structural obligations.
//
// The table itself (`./oversight-admin.ts`) is what stops the SQL audience, the
// per-recipient gate and the recorded-relationship probe from answering "which
// column carries which kind of oversight org?" three different ways; the drift
// between them starved a plant of its daily digest. Its header says so once.
//
// Three things about the table are not visible to the compiler, so they are
// asserted here:
//
//   1. THE COLUMN SET IS NOT A SECOND OPINION. `@/lib/auth/tenancy` owns
//      `oversightOrgOf`, the one answer to "which org does this row's tenancy
//      name", which `isOversightUser` and the preference gate read. That module
//      belongs to a different workstream, so the pairing table cannot literally
//      DERIVE its columns — but the two may not disagree, in either direction,
//      and a test is what makes the disagreement loud instead of latent.
//
//   2. THE LEAF STAYS A LEAF. Type imports only. `@/lib/auth/access` opens with
//      `import { db } from "@/db"`, so hosting the pairing there made "which
//      column carries a network?" cost a Neon connection and put a database
//      client one import away from anything that wanted the answer.
//
//   3. EVERY READER GOES THROUGH IT. The table's largest obligation is about
//      its readers, so it is asserted here rather than in the suite of any one
//      of them: no reader in this domain spells an oversight FK column or an
//      org-kind literal for itself.
// ============================================================================

test("§1 the pairing's columns are the columns oversightOrgOf resolves", () => {
  const paired = Object.entries(OVERSIGHT_ADMIN);

  // Both directions, over a row that names EXACTLY the pairing's column. An
  // org kind whose column `oversightOrgOf` does not resolve would build an
  // audience the rest of the product disowns; a column that resolves to a kind
  // with no pairing row has no FK for any builder to name.
  const resolved = paired.map(([kind, { fk }]) => {
    const row = {
      churchId: null,
      sendingChurchId: null,
      sendingNetworkId: null,
      [fk]: "11111111-1111-4111-8111-111111111111",
    };
    return [kind, oversightOrgOf(row)?.type] as const;
  });

  assert.deepEqual(
    resolved,
    paired.map(([kind]) => [kind, kind]),
    "OVERSIGHT_ADMIN and oversightOrgOf must agree on which column carries which kind"
  );

  // No duplicates: two org kinds carried by one column would make the inverse
  // lookup (`recipientOrgOf`) return whichever row it scanned last.
  const columns = paired.map(([, { fk }]) => fk);
  assert.equal(new Set(columns).size, columns.length);

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

const NOTIFICATIONS_DIR = path.join(process.cwd(), "src/lib/notifications");

/**
 * The readers §3 does NOT sweep, each with the reason it cannot be swept.
 *
 * AN ALLOW-LIST, NOT A SILENCE. The swept set is the directory minus these, so
 * every file that is not checked is a claim somebody made out loud and a
 * reviewer can disagree with — the four-file hand-list this replaced exempted
 * eighteen modules by saying nothing about them.
 *
 * `sweptReaders()` fails when an entry names a file that is not in the directory
 * any more: a renamed exemption goes on exempting nothing, while the file it was
 * written for either slips into the sweep unannounced or slips out of it.
 */
const SWEEP_EXEMPTIONS = new Map<string, string>([
  [
    "oversight-admin.ts",
    "the pairing table itself — it is the ONE file that spells both role literals and both FK column names, and §3 exists to say so",
  ],
]);

/** A shipped module of this directory: a `.ts` that is not a suite. */
function isReader(name: string): boolean {
  return /\.ts$/.test(name) && !/\.test\.ts$/.test(name);
}

/**
 * Every reader in `src/lib/notifications/` bar the named exemptions, comments
 * stripped, keyed by file name.
 *
 * DERIVED FROM THE DIRECTORY, which is the whole point: a module that lands
 * tomorrow is swept tomorrow, rather than on the day somebody notices the list
 * is short. The idiom is the one `src/lib/tasks/notifications.test.ts` uses for
 * "every module that inserts into `tasks` asks for its notifications" —
 * `readdirSync`, drop the suites, read what is left.
 */
function sweptReaders(): Map<string, string> {
  const present = readdirSync(NOTIFICATIONS_DIR).filter(isReader);

  for (const [name, why] of SWEEP_EXEMPTIONS) {
    assert.ok(
      present.includes(name),
      `the §3 exemption list names ${name}, which is no longer in src/lib/notifications/ — point the entry at the file's new name or delete it (its stated reason: ${why})`
    );
  }

  return new Map(
    present
      .filter((name) => !SWEEP_EXEMPTIONS.has(name))
      .sort()
      .map((name) => [
        name,
        stripComments(readFileSync(path.join(NOTIFICATIONS_DIR, name), "utf8")),
      ])
  );
}

/**
 * One swept reader by name, for the assertions that are about a PARTICULAR file.
 *
 * Throws when the name is not in the derived set, so a renamed or newly exempted
 * reader takes its own per-file assertions down with it instead of leaving them
 * asserting nothing — the rule `sourceReader` applies to a moved anchor, applied
 * to a moved file.
 */
function sweptReader(swept: Map<string, string>, name: string): string {
  const code = swept.get(name);

  assert.ok(
    code !== undefined,
    `§3 asserts something about ${name} in particular, and the derived sweep has no such file`
  );

  return code;
}

/**
 * An oversight FK reached BY NAME off a row — the half-pairing §3 forbids.
 *
 * RECEIVERS, not bare column names, and that is deliberate: selecting
 * `churches.sendingChurchId` is reading a PLANT's own hierarchy, which every
 * digest and audience query legitimately does. What is banned is deciding WHICH
 * column a role or an org kind implies, which is what a `table`/`recipient`/`org`
 * receiver means here.
 */
const FK_BY_NAME = /(?:table|recipient|org)\.sending(?:Church|Network)Id/;

/** An oversight role spelled out instead of read off the pairing row. */
const ROLE_LITERAL = /"sending_church_admin"|"network_admin"/;

/**
 * The same half-pairing wearing a constructor: `{ sendingChurchId: null,
 * sendingNetworkId: id }` names one FK, nulls the other by hand, and a third org
 * kind leaves it quietly returning an audience missing a key.
 * `oversightOrgOfKind` takes the KIND and lets the table pick the column.
 */
const HAND_NULLED_FK = /sendingChurchId: null|sendingNetworkId: null/;

test("§3a the sweep's exemptions are a named allow-list with reasons", () => {
  // The allow-list is load-bearing, so it is asserted rather than assumed: an
  // EMPTY one would mean §3 had quietly become unexemptable (and the pairing
  // table's own source cannot pass the general ban), and an entry with no reason
  // is the four-file hand-list back in a new spelling.
  assert.ok(
    SWEEP_EXEMPTIONS.size > 0,
    "the pairing table itself must be exempt, so an empty allow-list means the sweep is mis-wired"
  );

  for (const [name, why] of SWEEP_EXEMPTIONS) {
    assert.match(name, /\.ts$/, `${name} is not a reader of this directory`);
    assert.ok(
      why.trim().length > 20,
      `the §3 exemption for ${name} states no reason for itself`
    );
  }

  // And an exemption genuinely leaves the swept set — plus, inside
  // `sweptReaders`, every name still resolves to a file on disk.
  const swept = sweptReaders();
  for (const name of SWEEP_EXEMPTIONS.keys()) {
    assert.ok(!swept.has(name), `${name} is exempt and must not be swept`);
  }
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
  // SO THE SWEPT SET IS THE DIRECTORY, and the list grows with it because
  // nothing here writes it out: `sweptReaders()` reads `src/lib/notifications/`
  // and drops only the named exemptions above. That sentence was prose for one
  // round — four files were read by hand under a comment claiming otherwise, so
  // `oversight-audience.ts` was swept because somebody remembered to add it, and
  // the nineteenth module would not have been. It is now true of the code.
  //
  // AND THE SWEEP STOPS AT THIS DIRECTORY, deliberately, in two ways. The one
  // hand-built `OversightOrgIds` left in the repo is outside it —
  // `announceAssociationEndedFor` in `src/lib/invitations/core.ts` — and this
  // sweep neither reaches it nor may edit it: that file belongs to another
  // workstream. The walk is also FLAT, so `channels/` (the delivery layer, which
  // renders already-resolved facts and resolves no org) is outside it too; widen
  // the walk on the day a pairing reader lands in a subdirectory. So do not read
  // a green §3 as "no half-pairing exists"; it says "none exists in the modules
  // directly under `src/lib/notifications/`". The residual is recorded on
  // `OversightOrgIds` itself (`./oversight-admin.ts`), where the by-construction
  // claim is scoped to this directory, and it is compile-guarded rather than
  // fail-open: a third `OVERSIGHT_ADMIN` row widens the type's keys and that
  // literal stops compiling.
  const swept = sweptReaders();

  assert.ok(
    swept.size >= 10,
    "the directory scan found almost nothing to sweep — the filter is wrong"
  );

  // TIER ONE — the general ban, over EVERY reader the directory holds. No reader
  // names an oversight FK column, spells an oversight role literal, or builds an
  // org audience by nulling another kind's FK by hand.
  for (const [label, code] of swept) {
    assert.doesNotMatch(
      code,
      FK_BY_NAME,
      `${label} reaches an oversight FK through the pairing table, not by name`
    );
    assert.doesNotMatch(
      code,
      ROLE_LITERAL,
      `${label} names no oversight role literal`
    );
    assert.doesNotMatch(
      code,
      HAND_NULLED_FK,
      `${label} builds an org audience from the pairing table, not from a hand-nulled literal`
    );
  }

  // `oversight-digest.ts` is IN that set and passes it unchanged, which is the
  // `churches.sending_*_id` allowance holding: the digest sweep selects both
  // columns off `churches` to find a plant's oversight orgs, and reading a
  // plant's hierarchy is not deciding which column a role implies.
  assert.ok(
    swept.has("oversight-digest.ts"),
    "the digest sweep must be swept too — its churches.sending_*_id reads are the allowance this ban is shaped around"
  );

  const emitters = sweptReader(swept, "oversight.ts");
  const audience = sweptReader(swept, "oversight-audience.ts");
  const gate = sweptReader(swept, "enqueue.ts");
  const probe = sweptReader(swept, "oversight-relationship.ts");

  // TIER TWO — the recorded-relationship probe is stricter than the general ban:
  // it holds no `users` FK name and no org-kind literal ANYWHERE, because its
  // audit arm reads the kind off the pairing row's key for
  // `association_events.org_type`.
  assert.doesNotMatch(
    probe,
    /sendingChurchId|sendingNetworkId|"sending_church"|"network"/,
    "oversight-relationship.ts writes no oversight FK name and no org-kind literal"
  );

  // The positives: each reader is table-BUILT, not merely free of the bans. A
  // file deleted or renamed out from under these fails in `sweptReader` above.
  assert.match(emitters, /oversightOrgOfKind\(/);
  assert.match(emitters, /noOversightOrg\(\)/);
  assert.match(audience, /OVERSIGHT_ADMIN_ROWS/);

  // And the gate has no ORG-KIND ternary left — that else-branch WAS the silent
  // absorber. Spanned through the reader rather than grepped module-wide: the
  // module legitimately discriminates `anchor.type === "church"` elsewhere (a
  // plant is not an org), and a moved anchor THROWS instead of quietly matching
  // nothing (`src/lib/testing/source-span.ts`).
  const administersOrg = sourceReader(gate, "enqueue.ts").span(
    "export function recipientAdministersOrg(",
    "export const dbEnqueueDeps"
  );
  assert.doesNotMatch(administersOrg, /anchor\.type === "/);
  assert.match(administersOrg, /oversightOrgOf\(recipient\)/);

  // The pairing itself still says which FK goes with which kind, in one place.
  assert.deepEqual(OVERSIGHT_ADMIN, {
    sending_church: { fk: "sendingChurchId" },
    network: { fk: "sendingNetworkId" },
  });

  // The table's ORDER is load-bearing: the SQL arms render in it and the
  // bound-parameter assertions in `anchor.test.ts` read them positionally.
  assert.deepEqual(Object.keys(OVERSIGHT_ADMIN), ["sending_church", "network"]);

  // The tie to `oversightOrgOf` — the one tenancy answer `@/lib/auth/tenancy`
  // owns — is asserted in §1 above, in both directions.
});
