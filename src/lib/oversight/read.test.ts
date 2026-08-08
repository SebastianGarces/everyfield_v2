import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";

import { formatAssociationProvenance } from "./presentation";
import { RECENT_MEETING_WINDOW, sendingChurchesInNetwork } from "./read";
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
 * the cheapest way to pass the guard is to delete the explanation. None of
 * these files contains a `//` inside a string literal, which is the one case
 * this crude stripper would get wrong.
 */
function readCode(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/**
 * Every file this unit owns.
 *
 * The two invitation components in `src/components/oversight/` are excluded
 * deliberately: they belong to #23 and they DO render an email address — the
 * one the admin typed into the invite form, which is the invitation's own
 * subject and not a record from any plant's people pipeline.
 */
function ownedFiles(): string[] {
  const lib = readdirSync(LIB_DIR)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => path.join(LIB_DIR, name));
  const components = readdirSync(COMPONENT_DIR)
    .filter((name) => name.startsWith("plant"))
    .map((name) => path.join(COMPONENT_DIR, name));
  const pages = [
    path.join(PAGE_DIR, "page.tsx"),
    path.join(PAGE_DIR, "[id]", "page.tsx"),
  ];
  return [...lib, ...components, ...pages];
}

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
  const firstReadAt = body.indexOf("listOversightPlants(user, asOf)");
  assert.ok(membershipAt > 0, "the detail read does not check membership");
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

test("the detail page turns a refusal into a 404, not a message", () => {
  const source = read(path.join(PAGE_DIR, "[id]", "page.tsx"));
  assert.match(source, /if \(!detail\) \{\s*notFound\(\);/);
});

// ----------------------------------------------------------------------------
// Role guard on both routes
// ----------------------------------------------------------------------------

test("both plants routes are oversight-only", () => {
  for (const file of [
    path.join(PAGE_DIR, "page.tsx"),
    path.join(PAGE_DIR, "[id]", "page.tsx"),
  ]) {
    const source = read(file);
    assert.match(
      source,
      /user\.role !== "sending_church_admin" && user\.role !== "network_admin"/,
      `${path.relative(ROOT, file)} does not guard the oversight roles`
    );
    assert.match(source, /redirect\("\/dashboard"\)/);
    assert.match(source, /redirect\("\/login"\)/);
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
// Bounded reads
// ----------------------------------------------------------------------------

test("the meeting averages are taken over a bounded window", () => {
  assert.ok(RECENT_MEETING_WINDOW > 1);
  const source = read(path.join(LIB_DIR, "read.ts"));
  assert.match(source, /\.limit\(RECENT_MEETING_WINDOW\)/);
});
