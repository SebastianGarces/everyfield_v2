import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { drizzle } from "drizzle-orm/pg-proxy";
import { PgDialect } from "drizzle-orm/pg-core";

// The repo's static reader — the one comment stripper and the one static import
// scan. Both were copied into this file; the copies were weaker (the page guard
// below saw 1 of 5 module-scope edges), and the module reaches only node
// builtins, so importing it costs this suite's no-DATABASE_URL seam nothing.
import {
  codeOf,
  staticValueSpecifiers,
} from "@/lib/auth/server-action-surface";
import {
  CHURCH_LEVEL_ROLES,
  OVERSIGHT_ROLES,
  isOversightRole,
} from "@/lib/auth/roles";
import type { User, UserRole } from "@/db/schema";

import { formatAssociationProvenance } from "./presentation";
import {
  RECENT_MEETING_WINDOW,
  getOversightPortfolio,
  portfolioPlantsStatement,
  sendingChurchesInNetwork,
} from "./read";
import { OVERSIGHT_SECTIONS } from "./sections";

// ============================================================================
// Structural guards for the oversight plants surface.
//
// The rules this unit has to hold — aggregates only, gate before query,
// membership before id — are properties of the SHAPE of the code, not of one
// return value, and none of them can be observed from a pure call. So they are
// asserted against the source, the way `crawler.test.ts` greps for a header
// name and `constant-time.test.ts` scans every route reading a secret. A guard
// that lives only in a comment is a guard that comes back.
// ============================================================================

const ROOT = process.cwd();
const LIB_DIR = path.join(ROOT, "src", "lib", "oversight");
const COMPONENT_DIR = path.join(ROOT, "src", "components", "oversight");
const PAGE_DIR = path.join(
  ROOT,
  "src",
  "app",
  "(dashboard)",
  "oversight",
  "plants"
);

function read(file: string): string {
  return readFileSync(file, "utf8");
}

/**
 * Source with comments removed.
 *
 * The identity scan below is about what the CODE reads, so the prose that
 * explains the rule ("no email, no phone, no id") must not trip it — otherwise
 * the cheapest way to pass the guard is to delete the explanation.
 *
 * `codeOf` is the repo's one stripper (`@/lib/auth/server-action-surface`), and
 * it is strictly stronger than the copy that stood here: it only strips `//`
 * at a line start or after whitespace, so a `//` inside a string literal —
 * the one case the copy got wrong — survives.
 */
const readCode = codeOf;

/**
 * Components in `src/components/oversight/` that the identity scan does NOT
 * cover, each with the reason it is out.
 *
 * NAMED, not filtered by prefix. This used to be `name.startsWith("plant")`,
 * which is a guess about what a file is called standing in for a statement
 * about what it does — and it silently dropped `association-history.tsx` and
 * `remove-plant-dialog.tsx`, both of which render on `/oversight/plants/[id]`,
 * out of the aggregates-only scan the moment they were added. An exemption
 * that is a naming convention is an exemption anybody can take by accident.
 */
const EXEMPT_COMPONENTS: Record<string, string> = {
  // #23's surface, and it DOES render an email address — the one the admin
  // typed into the invite form, which is the invitation's own subject and not a
  // record from any plant's people pipeline.
  "invitation-create-form.tsx": "renders the invitation's own invitee address",
  "invitations-list.tsx": "renders the invitation's own invitee address",
  // OV-009's surface, scanned by its own suite (`sending-churches.test.ts`)
  // against a STRICTER list — it may not name an invitee address either.
  "sending-churches-roster.tsx": "scanned by sending-churches.test.ts",
};

/**
 * Every file this unit owns.
 *
 * The component directory is WALKED and then filtered by the named exemptions
 * above, so a new component joins the scan by existing. The exempt set is
 * asserted EXACTLY below, so it cannot become a hiding place.
 */
function ownedFiles(): string[] {
  const lib = readdirSync(LIB_DIR)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => path.join(LIB_DIR, name));
  const components = readdirSync(COMPONENT_DIR)
    .filter((name) => !(name in EXEMPT_COMPONENTS))
    .map((name) => path.join(COMPONENT_DIR, name));
  const pages = [
    path.join(PAGE_DIR, "page.tsx"),
    path.join(PAGE_DIR, "[id]", "page.tsx"),
  ];
  return [...lib, ...components, ...pages];
}

test("the component exemptions are named, not inferred from a filename", () => {
  const present = readdirSync(COMPONENT_DIR);
  // Every exemption still refers to a file that exists — a stale entry silently
  // exempts nothing and hides that the reason has gone.
  for (const name of Object.keys(EXEMPT_COMPONENTS)) {
    assert.ok(
      present.includes(name),
      `${name} is exempted but no longer exists — drop the exemption`
    );
  }
  // …and every component that is NOT exempt is scanned. This is the half the
  // old `startsWith("plant")` filter got wrong.
  const scanned = ownedFiles().map((file) => path.basename(file));
  for (const name of present) {
    assert.ok(
      name in EXEMPT_COMPONENTS || scanned.includes(name),
      `${name} is neither scanned nor named in EXEMPT_COMPONENTS`
    );
  }
});

// ----------------------------------------------------------------------------
// Aggregates only (memory/invariants.md → Hierarchical Access Control)
// ----------------------------------------------------------------------------

/**
 * Columns that identify or contact an individual from a plant's own records.
 * None of them may be named anywhere on this surface — not read, not passed,
 * not rendered.
 */
const PERSON_IDENTIFYING_COLUMNS = [
  "firstName",
  "lastName",
  "phone",
  "photoUrl",
  "addressLine1",
  "addressLine2",
  "postalCode",
  "inviteeEmail",
];

test("no oversight plants file names an individual's identity or contact", () => {
  const files = ownedFiles();
  assert.ok(files.length >= 8, "the file walker found nothing to check");

  for (const file of files) {
    const source = readCode(file);
    for (const column of PERSON_IDENTIFYING_COLUMNS) {
      assert.ok(
        !source.includes(column),
        `${path.relative(ROOT, file)} names "${column}" — oversight is aggregates only`
      );
    }
  }
});

test("the only identity on the surface is the planter's name, from users", () => {
  const source = readCode(path.join(LIB_DIR, "read.ts"));
  // `persons` is read for COUNTS. The one name selected anywhere is
  // `users.name` for the plant's planter — the org's counterparty (OV-001),
  // not a record from the plant's pipeline.
  assert.ok(source.includes("name: users.name"));
  assert.ok(
    !/persons\.(firstName|lastName|email|phone)/.test(source),
    "a persons identity column reached the oversight read"
  );
});

// ----------------------------------------------------------------------------
// Gate before query (OV-002)
// ----------------------------------------------------------------------------

test("a withheld section is never queried", () => {
  const source = read(path.join(LIB_DIR, "read.ts"));

  const gateAt = source.indexOf("canAccessFeatureData(");
  const firstAggregateAt = source.indexOf("readPeopleAggregate(");
  assert.ok(gateAt > 0, "the read does not consult canAccessFeatureData");
  assert.ok(
    gateAt < firstAggregateAt,
    "an aggregate is computed before the privacy gate is asked"
  );
  // The refusal returns a result with no numbers on it at all.
  assert.match(source, /!allowed[\s\S]{0,120}state: "withheld"/);
});

test("every declared section is handled by the read's switch", () => {
  const source = read(path.join(LIB_DIR, "read.ts"));
  for (const section of OVERSIGHT_SECTIONS) {
    assert.match(
      source,
      new RegExp(`case "${section.key}":`),
      `section "${section.key}" is declared but never resolved`
    );
  }
});

// ----------------------------------------------------------------------------
// Membership before id, and one indistinguishable refusal (OV-001 tenancy)
// ----------------------------------------------------------------------------

test("a plant id is checked against the caller's own list before any query", () => {
  const source = read(path.join(LIB_DIR, "read.ts"));
  const detailAt = source.indexOf(
    "export async function getOversightPlantDetail"
  );
  assert.ok(detailAt > 0);

  const body = source.slice(detailAt);
  const membershipAt = body.indexOf("accessibleIds.includes(churchId)");
  const firstReadAt = body.indexOf(
    "buildPlantSummaries(user, [churchId], asOf)"
  );
  assert.ok(membershipAt > 0, "the detail read does not check membership");
  assert.ok(
    firstReadAt > 0,
    "the detail read no longer builds its summary the way this test expects"
  );
  assert.ok(
    membershipAt < firstReadAt,
    "the plant id reaches a query before it is checked against the caller's list"
  );
  // Same answer for another org's plant, a missing plant, and a non-uuid.
  assert.match(
    body,
    /accessibleIds\.includes\(churchId\)\)\s*return null;/,
    "a failed membership check must return null, not a partial plant"
  );
});

test("one plant's page reads one plant, not the whole portfolio", () => {
  // The header is built by the same code path as the directory row — that part
  // is deliberate — but it used to get there by calling `listOversightPlants`
  // and discarding every row but one, which is five queries over every plant in
  // the org on every detail page load, growing with the org.
  const source = read(path.join(LIB_DIR, "read.ts"));
  const detailAt = source.indexOf(
    "export async function getOversightPlantDetail"
  );
  assert.ok(detailAt > 0);
  const body = source.slice(detailAt);

  assert.ok(
    !body.includes("listOversightPlants("),
    "the detail read builds the org's entire roster to render one plant"
  );
  // The shared builder takes the ids it is given, so it cannot widen its own
  // scope: the membership check above is what makes the one id safe.
  assert.match(
    source,
    /async function buildPlantSummaries\(\s*user: User,\s*churchIds: string\[\],/,
    "the shared summary builder no longer takes its church ids as an argument"
  );
  assert.ok(
    !/export async function buildPlantSummaries/.test(source),
    "the summary builder is exported — it is not an authority boundary and must stay private"
  );
});

test("the detail page turns a refusal into a 404, not a message", () => {
  const source = read(path.join(PAGE_DIR, "[id]", "page.tsx"));
  assert.match(source, /if \(!detail\) \{\s*notFound\(\);/);
});

// ----------------------------------------------------------------------------
// Role guard on both routes
// ----------------------------------------------------------------------------

test("both plants routes are oversight-only", () => {
  // The rule itself lives in `@/lib/oversight/session` now — one copy for all
  // six routes, with `session.test.ts` asserting that no page re-spells it and
  // that both refusals (/login, /dashboard) are still distinct. What these two
  // pages owe is that they go through it before anything else runs.
  for (const file of [
    path.join(PAGE_DIR, "page.tsx"),
    path.join(PAGE_DIR, "[id]", "page.tsx"),
  ]) {
    const source = readCode(file);
    const guardAt = source.indexOf("await requireOversightUser()");
    assert.ok(
      guardAt > 0,
      `${path.relative(ROOT, file)} does not guard the oversight roles`
    );
    const firstReadAt = source.indexOf("await listOversightPlants");
    const firstDetailAt = source.indexOf("await getOversightPlantDetail");
    const readAt = Math.max(firstReadAt, firstDetailAt);
    assert.ok(
      readAt > 0,
      `${path.relative(ROOT, file)} no longer reads what this test expects`
    );
    assert.ok(
      guardAt < readAt,
      `${path.relative(ROOT, file)} reads before it checks the caller's role`
    );
  }
});

// ----------------------------------------------------------------------------
// Provenance stays inside the caller's tenancy
// ----------------------------------------------------------------------------

test("the 'through' qualifier can only name a sending church in the caller's network", () => {
  // A plant's `sending_church_id` may name ANY sending church, including one in
  // a different network — the two association FKs are independent. Resolving it
  // to a name unscoped would print a third org's name to a caller who is not
  // party to that relationship, so the network id is part of the predicate and
  // not a filter applied afterwards.
  const { sql, params } = new PgDialect().sqlToQuery(
    sendingChurchesInNetwork("network-1", ["in-network", "outsider"])!
  );

  assert.match(sql, /"sending_churches"\."sending_network_id" = \$\d/);
  assert.match(sql, /"sending_churches"\."id" in /);
  assert.ok(
    params.includes("network-1"),
    "the caller's own network id is not bound into the lookup"
  );
});

test("a plant whose sending church is outside the network renders no qualifier", () => {
  // The predicate above means such a sending church never comes back from the
  // query, so it is absent from the name map. This is the consequence at the
  // call site: absent → null → the provenance line has no "through" clause.
  const namesInNetwork = new Map<string, string>([["in-network", "Grace"]]);
  const outsiderName = namesInNetwork.get("outsider") ?? null;
  assert.equal(outsiderName, null);

  const line = formatAssociationProvenance({
    orgType: "network",
    orgName: "North Texas Network",
    viaSendingChurchName: outsiderName,
    associatedAt: new Date("2026-08-03T15:00:00.000Z"),
  });
  assert.ok(!line.includes("through"), line);
  assert.ok(!line.includes("·"), line);
  assert.match(line, /^Joined North Texas Network on /);
});

test("the network lookup is the only way a sending church name reaches provenance", () => {
  const source = readCode(path.join(LIB_DIR, "read.ts"));
  // One reader of `sendingChurches.name`, and it goes through the scoped
  // predicate. A second unscoped select would reopen the leak silently.
  assert.equal(
    source.match(/name: sendingChurches\.name/g)?.length,
    2,
    "an unexpected number of reads of a sending church's name — one is the caller's OWN org (resolveCallerOrg), one is the scoped network lookup"
  );
  assert.match(
    source,
    /\.where\(sendingChurchesInNetwork\(org\.orgId, sendingChurchIds\)\)/,
    "the sending-church name lookup is not scoped to the caller's network"
  );
});

// ----------------------------------------------------------------------------
// The index's projection and tenancy (#241) — asserted off the STATEMENT
// ----------------------------------------------------------------------------
//
// Both decisions used to live inline in `src/app/(dashboard)/oversight/page.tsx`
// — the one surface in this domain that read the database from an RSC — and
// were pinned by a regex over that page's source in a suite named for another
// module (`sending-churches.test.ts`). It matched `id: churches.id` and scanned
// `\b(?:plant|p)\.(\w+)`, so a variable rename broke it, and it could not see
// the WHERE clause at all: the tenancy predicate on a portfolio read had no
// test that observed it.
//
// `portfolioPlantsStatement` takes the DATABASE, so the statement can be
// RENDERED here and a regression that widens the projection or drops the scope
// fails a test that executed the query builder rather than one that read a
// string.
//
// The instance below is drizzle's `pg-proxy` driver over a callback that is
// never called: `.toSQL()` renders, it does not connect, and no `DATABASE_URL`
// is read — which is what keeps this suite's no-database seam
// (`read-imports.test.ts`) intact while asserting the real statement.

const offlineDb = drizzle(async () => {
  throw new Error("the projection tests render SQL; they never execute it");
});

/** The rendered statement, for a caller whose accessible list is these ids. */
function renderedPortfolio(churchIds: string[] = ["church-a", "church-b"]) {
  return portfolioPlantsStatement(offlineDb, churchIds).toSQL();
}

// ----------------------------------------------------------------------------
// The index read refuses on its own
// ----------------------------------------------------------------------------

/** A session user of `role`, carrying every id a church-level role can hold. */
function callerWithRole(role: UserRole): User {
  return {
    id: "user-1",
    role,
    // Real ids, deliberately: `getAccessibleChurchIds` turns `churchId` into a
    // one-element accessible list for `planter` and `team_member`, so a caller
    // with NO ids would pass this test for the wrong reason.
    churchId: "church-mine",
    sendingChurchId: "sending-church-1",
    sendingNetworkId: "network-1",
  } as unknown as User;
}

test("the index read refuses every church-level role itself", async () => {
  // The docblock used to say `getAccessibleChurchIds` decided this. It does
  // not: it returns `[user.churchId]` for a planter and a team member, and the
  // coach's assignments for a coach — ids that would have reached the `in (...)`
  // and rendered a portfolio for a caller with no oversight org.
  //
  // This case needs NO DATABASE. If the refusal is removed, the very next line
  // is `await import("@/lib/auth/access")`, which opens `@/db`, so a regression
  // fails here rather than quietly returning rows.
  for (const role of CHURCH_LEVEL_ROLES) {
    assert.deepEqual(
      await getOversightPortfolio(callerWithRole(role)),
      [],
      `${role} reached the oversight index read — the route guard is not the only guard`
    );
  }
});

test("the refusal admits exactly the two oversight roles", () => {
  // Pinned to the ONE declaration rather than to a copy of the pair, so a
  // sixth role joins whichever list `@/lib/auth/roles` puts it in and this
  // assertion follows it.
  for (const role of CHURCH_LEVEL_ROLES)
    assert.equal(isOversightRole(role), false);
  for (const role of OVERSIGHT_ROLES) assert.equal(isOversightRole(role), true);

  // …and the read states its gate in those terms, not in a role literal of its
  // own: a hand-written `role !== "planter"` is the drift this pins.
  const source = readCode(path.join(LIB_DIR, "read.ts"));
  assert.match(
    source,
    /if \(!isOversightRole\(user\.role\)\) return \[\];/,
    "getOversightPortfolio no longer refuses non-oversight roles before resolving ids"
  );
});

test("the index selects exactly the three columns it renders", () => {
  const { sql } = renderedPortfolio();

  const projection = /^select (.+?) from "churches"/.exec(sql);
  assert.ok(
    projection,
    `the statement is not the shape this test reads: ${sql}`
  );
  assert.deepEqual(
    projection[1].split(", "),
    ['"id"', '"name"', '"current_phase"'],
    `the oversight index's projection changed — every added column ships on every load (#241). Rendered: ${sql}`
  );
  assert.doesNotMatch(
    sql,
    /select \*/,
    "the index is back to a bare select(), which pulls the whole churches row (#241)"
  );
});

test("the index reads only the churches the caller may reach", () => {
  const { sql, params } = renderedPortfolio(["mine-1", "mine-2"]);

  assert.match(
    sql,
    /where "churches"\."id" in \(\$1, \$2\)$/,
    `the tenant scope is not an id list on the statement's WHERE. Rendered: ${sql}`
  );
  assert.deepEqual(
    params,
    ["mine-1", "mine-2"],
    "the accessible-id list is not what the WHERE clause binds"
  );

  // …and the list is the ONLY predicate: a second clause would mean the scope
  // is being decided somewhere this assertion cannot see.
  const where = sql.slice(sql.indexOf("where "));
  assert.ok(
    !/\band\b|\bor\b/.test(where),
    `the index's WHERE grew a clause beyond the accessible-id list: ${where}`
  );
});

test("the index page holds no data-layer import at all", () => {
  // The read moved out of the RSC, and this is what that bought: a page that
  // only renders. A `db`/`churches`/`inArray` import here is the read coming
  // back to a file where no test can see its WHERE clause.
  const specifiers = staticValueSpecifiers(
    readCode(
      path.join(ROOT, "src", "app", "(dashboard)", "oversight", "page.tsx")
    )
  );
  assert.ok(specifiers.length > 0, "the import scan found nothing to check");
  for (const specifier of ["drizzle-orm", "@/db", "@/db/schema"]) {
    assert.ok(
      !specifiers.includes(specifier),
      `the oversight index imports ${specifier} — its read belongs in @/lib/oversight/read`
    );
  }
});

test("the page guard sees every static way the read could come back", () => {
  // The copy that stood here read `^import\s+[^;]*?from\s+"([^"]+)"` and saw
  // ONE of the five module-scope edges to `@/db`. Four ways to put the read
  // back on the page passed it, which makes the guard above a comment with a
  // test around it rather than a test.
  for (const [shape, line] of [
    ["single quotes", "import { db } from '@/db';"],
    ["indented import", '  import { db } from "@/db";'],
    ["side effect", 'import "@/db";'],
    ["re-export", 'export { churches } from "@/db/schema";'],
  ] as const) {
    assert.notDeepEqual(
      staticValueSpecifiers(line),
      [],
      `the page guard cannot see a ${shape} — the read could return to the RSC and still pass`
    );
  }
});

// ----------------------------------------------------------------------------
// Bounded reads
// ----------------------------------------------------------------------------

test("the meeting averages are taken over a bounded window", () => {
  assert.ok(RECENT_MEETING_WINDOW > 1);
  const source = read(path.join(LIB_DIR, "read.ts"));
  assert.match(source, /\.limit\(RECENT_MEETING_WINDOW\)/);
});
