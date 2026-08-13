import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { networkAdminNavItems, sendingChurchNavItems } from "../navigation";

// ============================================================================
// Structural guards for the sending-churches roster (OV-009).
//
// The rules this unit has to hold — network admins only, counts inside the
// caller's tenancy, aggregates only, no dead links — are properties of the
// SHAPE of the code rather than of one return value, and none of them can be
// observed from a pure call (every function here needs a DATABASE_URL). So they
// are asserted against the source, the way `read.test.ts` does for the plants
// surface and `crawler.test.ts` does for a header name. A guard that lives only
// in a comment is a guard that comes back.
// ============================================================================

const ROOT = process.cwd();
const READ_FILE = path.join(
  ROOT,
  "src",
  "lib",
  "oversight",
  "sending-churches.ts"
);
const PAGE_FILE = path.join(
  ROOT,
  "src",
  "app",
  "(dashboard)",
  "oversight",
  "sending-churches",
  "page.tsx"
);
const COMPONENT_FILE = path.join(
  ROOT,
  "src",
  "components",
  "oversight",
  "sending-churches-roster.tsx"
);

function read(file: string): string {
  return readFileSync(file, "utf8");
}

/**
 * Source with comments removed — the scans below are about what the CODE does,
 * so the prose explaining a rule must not satisfy it. (Same stripper, and same
 * reasoning, as `read.test.ts`.)
 */
function readCode(file: string): string {
  return read(file)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

// ----------------------------------------------------------------------------
// Network admins only (OV-009)
// ----------------------------------------------------------------------------

test("the read refuses every role but network_admin before it queries", () => {
  const source = readCode(READ_FILE);

  const guardAt = source.indexOf('user.role !== "network_admin"');
  const firstQueryAt = source.indexOf(".select(");
  assert.ok(guardAt > 0, "the read does not check the caller's role");
  assert.ok(
    firstQueryAt > 0,
    "the source scan found no select — this test has gone stale"
  );
  assert.ok(
    guardAt < firstQueryAt,
    "a query runs before the caller's role is checked"
  );
  // A role check alone is not enough: a network id must be present too, and the
  // refusal is an empty roster rather than a partial one.
  assert.match(source, /!user\.sendingNetworkId\) return \[\];/);
});

test("the route 404s a sending-church admin and never redirects them onward", () => {
  const source = readCode(PAGE_FILE);

  // Church-level roles are bounced by the guard every /oversight route shares
  // (`@/lib/oversight/session`; `session.test.ts` pins that no page re-spells
  // the role pair and that /login and /dashboard stay distinct refusals).
  const guardAt = source.indexOf("await requireOversightUser()");
  assert.ok(guardAt > 0, "the page does not bounce church-level roles");

  // The oversight-but-wrong-org refusal is this page's OWN rule and stays here:
  // a 404, because "this page exists but is not for you" is itself information
  // about the network's surfaces.
  const notFoundAt = source.indexOf("notFound();");
  const readAt = source.indexOf("listNetworkSendingChurches(user)");
  assert.ok(notFoundAt > 0, "a sending-church admin is not refused at all");
  assert.ok(
    readAt > 0,
    "the page no longer reads the roster this test expects"
  );
  assert.ok(
    guardAt < notFoundAt,
    "the network-only refusal runs before the caller is known to be an oversight user"
  );
  assert.ok(
    notFoundAt < readAt,
    "the roster is read before the network-only guard runs"
  );
  assert.match(
    source,
    /user\.role !== "network_admin"\s*\)\s*\{\s*notFound\(\);/
  );
});

test("the nav item and the guard agree about who may see the roster", () => {
  // Two halves of one rule (#260): a link nobody can open is a 404 with no way
  // back, and a page with no link is unreachable for the role that may use it.
  const hrefs = (items: typeof networkAdminNavItems) =>
    items.map((item) => item.href);

  assert.ok(
    hrefs(networkAdminNavItems).includes("/oversight/sending-churches")
  );
  assert.ok(
    !hrefs(sendingChurchNavItems).includes("/oversight/sending-churches")
  );
});

// ----------------------------------------------------------------------------
// The counts stay inside the caller's tenancy
// ----------------------------------------------------------------------------

test("a plant counts only when it is in the caller's own network", () => {
  const source = readCode(READ_FILE);

  // The network predicate `getAccessibleChurchIds` uses for a network admin,
  // applied to the count as well — otherwise the roster reports plants the
  // network cannot open and disagrees with /oversight/plants.
  assert.match(source, /eq\(churches\.sendingNetworkId, networkId\)/);
  assert.match(source, /inArray\(churches\.sendingChurchId, memberIds\)/);
  // The member list itself is derived from the caller's network, never from a
  // parameter naming an org.
  assert.match(
    source,
    /eq\(sendingChurches\.sendingNetworkId, networkId\)/,
    "the member list is not scoped to the caller's network"
  );
  assert.ok(
    !/function listNetworkSendingChurches\([^)]*(orgId|networkId|sendingChurchId)/.test(
      source
    ),
    "the read takes an organization id as an argument — there must be nothing to ask with"
  );
});

test("a lapsed invitation is not counted as pending", () => {
  const source = readCode(READ_FILE);

  assert.match(source, /eq\(organizationInvitations\.status, "pending"\)/);
  // Expiry is lazy: a lapsed row keeps reading `pending` until somebody tries
  // to answer it, so status alone overstates what the org is waiting on.
  assert.match(
    source,
    /expiresAt\} is null or \$\{organizationInvitations\.expiresAt\} > \$\{asOf\}/,
    "the pending count does not exclude invitations whose window has closed"
  );
});

// ----------------------------------------------------------------------------
// Aggregates only (memory/invariants.md → Hierarchical Access Control)
// ----------------------------------------------------------------------------

/**
 * Columns that identify or contact an individual. None of them may be named
 * anywhere on this surface — not read, not passed, not rendered. `inviteeEmail`
 * is included and is the pointed one: `/oversight/invitations` does render it,
 * because that surface is scoped to the caller's OWN invitations, while this
 * one counts a MEMBER org's.
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
  "inviterUserId",
];

test("no sending-churches file names an individual's identity or contact", () => {
  for (const file of [READ_FILE, PAGE_FILE, COMPONENT_FILE]) {
    const source = readCode(file);
    for (const column of PERSON_IDENTIFYING_COLUMNS) {
      assert.ok(
        !source.includes(column),
        `${path.relative(ROOT, file)} names "${column}" — oversight is aggregates only`
      );
    }
  }
});

test("both roster reads count rows rather than selecting them", () => {
  const source = readCode(READ_FILE);
  const selects = source.match(/\.select\(\{[\s\S]*?\}\)/g) ?? [];
  assert.equal(
    selects.length,
    3,
    "the roster's query count changed — re-check what each one selects"
  );
  // One select names the member orgs; the other two are `count()` grouped by
  // the member org. Nothing selects a row from another table wholesale.
  assert.equal(
    selects.filter((select) => select.includes("count()")).length,
    2
  );
  assert.ok(
    !/\.select\(\)/.test(source),
    "a bare select() pulls every column of a table (#241)"
  );
});

// ----------------------------------------------------------------------------
// No dead links (#260)
// ----------------------------------------------------------------------------

test("the roster links only to a page that exists", () => {
  const source = readCode(COMPONENT_FILE);
  const hrefs = [...source.matchAll(/href="([^"]+)"/g)].map(
    (match) => match[1]
  );
  // There is no per-sending-church page in alpha, so no row may link to one.
  assert.deepEqual(hrefs, ["/oversight/invitations"]);
  assert.ok(
    !source.includes("/oversight/sending-churches/"),
    "a row links into a per-sending-church route that does not exist"
  );
});

test("every link on the roster carries cursor-pointer", () => {
  const source = read(COMPONENT_FILE);
  const links = [...source.matchAll(/<Link[\s\S]*?>/g)];
  assert.ok(links.length > 0, "the link scan found nothing to check");
  for (const [link] of links) {
    assert.ok(
      link.includes("cursor-pointer"),
      `a <Link> on the roster has no cursor-pointer:\n${link}`
    );
  }
});

// ----------------------------------------------------------------------------
// #241 — explicit projection on the oversight index
// ----------------------------------------------------------------------------

test("the oversight index selects only the columns it renders", () => {
  const source = readCode(
    path.join(ROOT, "src", "app", "(dashboard)", "oversight", "page.tsx")
  );

  assert.ok(
    !/\.select\(\)/.test(source),
    "the oversight index is back to a bare select() (#241)"
  );
  assert.match(source, /id: churches\.id/);
  assert.match(source, /name: churches\.name/);
  assert.match(source, /currentPhase: churches\.currentPhase/);
  // The projection has to cover everything the page reads off a plant, or the
  // narrowing is a runtime `undefined` rather than a saving. Both names the
  // page uses for a row are scanned — `plant` in the list, `p` in the filters.
  const rendered = [...source.matchAll(/\b(?:plant|p)\.(\w+)/g)].map(
    (match) => match[1]
  );
  assert.ok(rendered.length > 0, "the property scan found nothing to check");
  for (const property of new Set(rendered)) {
    assert.ok(
      ["id", "name", "currentPhase"].includes(property),
      `the page reads plant.${property}, which the projection does not select`
    );
  }
});
