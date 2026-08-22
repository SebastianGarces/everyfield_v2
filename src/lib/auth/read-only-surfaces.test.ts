import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { SRC, TS_FILES, codeOf, rel } from "@/lib/auth/server-action-surface";
import {
  mainNavItems,
  networkAdminNavItems,
  sendingChurchNavItems,
} from "@/lib/navigation";
import {
  READ_ONLY_SURFACE_CHECKLIST,
  REACH,
  type ChecklistRow,
} from "@/lib/auth/read-only-surfaces";
import { ALL_CAPABILITIES, requiresPlantTenancy } from "@/lib/auth/seat-rules";

// ============================================================================
// THE CHECKLIST IS WALKED BY A TEST, NOT BY A PERSON — AS-020 (#499).
//
// The FRD says the quiet part itself: "AS-020 is verifiable only against a
// list." A list somebody walked once is a claim with a shelf life of one
// commit. Three assertions below turn it into a property:
//
//   1. PARITY. The FRD's markdown table and `READ_ONLY_SURFACE_CHECKLIST` are
//      compared row for row, both columns, as strings. Neither side can be
//      edited alone — which is the "a reviewer can diff the two" the acceptance
//      criteria ask for, done by the suite instead of by the reviewer.
//
//   2. REACH. Every plant surface refuses an account with no `church_id`. This
//      is the strongest thing in the file: it proves the COACH and the ORG
//      MEMBER halves of AS-020 structurally, for all of rows 2-13 at once, and
//      it keeps proving them for routes nobody has written yet. A hidden button
//      is a promise; a route that redirects is a wall.
//
//   3. GATES. Every row this sweep fixed names the files it fixed, and each of
//      those files still asks for one of the row's verbs. A gate deleted in a
//      later refactor fails here rather than going quiet.
//
// WHAT THIS FILE DOES NOT CLAIM. None of it is authorization. `requireSeat`
// refuses the POST and `seat-guard.test.ts` is what asserts that. Everything
// here is about what a person is ASKED to do.
// ============================================================================

const FRD = path.join(
  process.cwd(),
  "product-docs/features/accounts-and-seats/frd.md"
);

/**
 * The FRD's table, parsed to the two columns it declares.
 *
 * Deliberately strict about where the table starts: the heading, then the
 * header row, then the `|---|---|` rule. A parser that hunted for "any table
 * with two columns" would silently follow the FRD's OTHER tables if this one
 * were renamed, and report parity against the wrong list.
 */
function frdChecklistRows(): { surface: string; mustNotRender: string }[] {
  const lines = readFileSync(FRD, "utf8").split("\n");
  const heading = lines.indexOf("## Read-only surface checklist");
  assert.notEqual(
    heading,
    -1,
    "the FRD's '## Read-only surface checklist' heading is gone — repoint this test at wherever the checklist moved"
  );

  const header = lines.findIndex(
    (line, i) => i > heading && line.startsWith("| Surface |")
  );
  assert.notEqual(header, -1, "no '| Surface |' header row under the heading");

  const rows: { surface: string; mustNotRender: string }[] = [];
  // +2 skips the header and the `|---|---|` rule under it.
  for (let i = header + 2; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("|")) break;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    assert.equal(
      cells.length,
      2,
      `checklist row ${rows.length + 1} has ${cells.length} columns, expected 2: ${line}`
    );
    rows.push({ surface: cells[0], mustNotRender: cells[1] });
  }
  return rows;
}

test("the checklist in code is the FRD's checklist, row for row", () => {
  const frd = frdChecklistRows();

  assert.ok(
    frd.length >= 20,
    `only ${frd.length} rows parsed out of the FRD — the parser is reading the wrong table`
  );
  assert.equal(
    READ_ONLY_SURFACE_CHECKLIST.length,
    frd.length,
    `the FRD lists ${frd.length} surfaces and read-only-surfaces.ts lists ${READ_ONLY_SURFACE_CHECKLIST.length}. A row was added to one side only.`
  );

  frd.forEach((expected, i) => {
    const actual = READ_ONLY_SURFACE_CHECKLIST[i];
    assert.equal(
      actual.surface,
      expected.surface,
      `row ${i + 1}: surface differs from the FRD`
    );
    assert.equal(
      actual.mustNotRender,
      expected.mustNotRender,
      `row ${i + 1} (${expected.surface}): the "must not render" column differs from the FRD`
    );
  });
});

test("every row names verbs that exist, and a verdict the sweep can defend", () => {
  for (const row of READ_ONLY_SURFACE_CHECKLIST) {
    for (const capability of row.governedBy) {
      assert.ok(
        ALL_CAPABILITIES.includes(capability),
        `${row.surface}: "${capability}" is not a capability in seat-rules.ts`
      );
    }
    // A row that claims nothing must say why in prose, because "no verb, no
    // files, nothing fixed" is indistinguishable from a row nobody looked at.
    if (row.governedBy.length === 0) {
      assert.ok(
        row.note,
        `${row.surface}: no governing verb and no note — say why the row needs none`
      );
    }
    if (row.verdict === "fixed-here") {
      assert.ok(
        row.gatedIn.length > 0,
        `${row.surface}: verdict is "fixed-here" but no file is named`
      );
    }
    if (row.verdict === "deferred") {
      assert.match(
        row.note ?? "",
        /#\d+/,
        `${row.surface}: a deferred row must name the issue that owns it`
      );
    }
  }
});

// ----------------------------------------------------------------------------
// 2. REACH — the wall behind rows 2 through 13.
// ----------------------------------------------------------------------------

/**
 * The plant surfaces: every route group under `(dashboard)` that reads a
 * plant's own records.
 *
 * Enumerated from the filesystem rather than listed, so a NEW plant surface
 * joins the assertion by existing. The exclusions are the routes that
 * deliberately serve an account with no plant, and each one is named with its
 * reason — an unexplained exclusion is how this test would rot into a list of
 * whatever currently passes.
 */
const NOT_PLANT_SURFACES: Readonly<Record<string, string>> = {
  oversight: "the org's own surface — rows 20-22, gated on org verbs instead",
  coaching: "the coach's one aggregate page, reached BY having no plant",
  settings: "account settings must stay reachable with no plant (row 15)",
  wiki: "readable with no session at all, by design",
  notifications: "self-scoped, and a churchless account simply has none",
  admin: "the platform-operator allowlist, not a tenancy surface",
  documents: "no plant records — template generation, guarded as `read`",
  feedback: "product feedback, self-scoped",
  "verify-email": "an account flow — it runs before any tenancy is known",
};

test("every plant surface refuses an account with no churchId", () => {
  const dashboard = path.join(SRC, "app/(dashboard)");

  const groups = readdirSync(dashboard, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("@"))
    .map((entry) => entry.name)
    .filter((name) => !(name in NOT_PLANT_SURFACES));

  assert.ok(
    groups.length >= 8,
    `only ${groups.length} plant surfaces found under (dashboard) — the scan is broken`
  );

  const ungated: string[] = [];
  for (const group of groups) {
    const page = path.join(dashboard, group, "page.tsx");
    if (!existsSync(page)) continue;
    const code = codeOf(page);
    // The guard's shape is `if (!user.churchId) redirect(…)`, and variants
    // spell the subject differently (`viewer`, a destructured `churchId`). What
    // every one of them has in common is that the file both READS churchId and
    // REDIRECTS, so that pair is what is asserted — a page that reads it and
    // renders anyway would pass this and is caught by the render tests instead.
    const reads = /churchId/.test(code);
    const redirects = /redirect\(/.test(code);
    if (!reads || !redirects) ungated.push(rel(page));
  }

  assert.deepEqual(
    ungated,
    [],
    `these plant surfaces do not refuse an account with no churchId, so a coach and an org Member render them:\n${ungated.join("\n")}\n\nAdd the guard, or name the route in NOT_PLANT_SURFACES with the reason it serves a churchless account.`
  );
});

test("the two churchless contexts are recorded as unable to reach a plant surface", () => {
  assert.equal(REACH.coach.plantSurfaces, false);
  assert.equal(REACH["org-member"].plantSurfaces, false);
  assert.equal(REACH["plant-member"].plantSurfaces, true);

  // The rows the wall covers must not claim a churchless context reaches them,
  // or the verdict table would be promising a hide on a screen nobody renders.
  //
  // WHICH ROWS THOSE ARE IS DERIVED, not listed: a row governed by a
  // `tenancy: "plant"` verb is by definition one an account with no `church_id`
  // is refused, and the route guard above is the same fact spelled at the door.
  // An index range here would be a third copy of the checklist's order and
  // would quietly test the wrong rows the day the FRD reorders one.
  const plantRows = READ_ONLY_SURFACE_CHECKLIST.filter((row) =>
    row.governedBy.some(requiresPlantTenancy)
  );
  assert.ok(
    plantRows.length >= 8,
    `only ${plantRows.length} rows derive as plant-guarded — the derivation is broken`
  );
  for (const row of plantRows) {
    for (const context of row.reachedBy) {
      assert.ok(
        REACH[context].plantSurfaces,
        `${row.surface} claims to be reached by a ${context}, but that context is refused by every plant route's churchId guard`
      );
    }
  }
});

// ----------------------------------------------------------------------------
// 3. GATES — the files this sweep changed still ask the question.
// ----------------------------------------------------------------------------

/** Does `file` ask for any of `row`'s verbs, in either transport? */
function asksForAVerb(row: ChecklistRow, code: string): boolean {
  return row.governedBy.some((capability) =>
    // `useCan("x")`, `holdsSeatFor(user, "x")` and `<Can do="x">` all spell the
    // capability as a string literal beside the control, which is the whole
    // reason both transports take one: the gate is greppable from the file that
    // renders the thing being gated.
    new RegExp(`["']${capability.replace(".", "\\.")}["']`).test(code)
  );
}

test("every file a fixed row names still gates on one of that row's verbs", () => {
  const missing: string[] = [];

  for (const row of READ_ONLY_SURFACE_CHECKLIST) {
    if (row.verdict !== "fixed-here") continue;
    for (const file of row.gatedIn) {
      const full = path.join(process.cwd(), file);
      if (!existsSync(full)) {
        missing.push(`${row.surface} → ${file} (file does not exist)`);
        continue;
      }
      if (!asksForAVerb(row, codeOf(full))) {
        missing.push(
          `${row.surface} → ${file} (names none of: ${row.governedBy.join(", ")})`
        );
      }
    }
  }

  assert.deepEqual(
    missing,
    [],
    `the sweep claims these files hide a write affordance, but none of them asks for the row's capability any more:\n${missing.join("\n")}`
  );
});

// ----------------------------------------------------------------------------
// 4. NO DISABLED CONTROL STANDS IN FOR A HIDDEN ONE.
// ----------------------------------------------------------------------------

test("no checklist surface gates a control on `disabled` instead of hiding it", () => {
  // "Hidden, not merely disabled" is the requirement's own wording, and the
  // failure mode has a SHAPE: a capability boolean spent on the `disabled`
  // attribute rather than on whether the element renders. That is what this
  // matches — `disabled={!canWrite}`, `disabled={!can…}`, and the same fused
  // with a pending flag (`disabled={!canWrite || isPending}`), which is the
  // sneakier spelling because it looks like ordinary busy handling.
  //
  // It deliberately does NOT match `disabled={isPending}`, `disabled={!isComplete}`
  // or any other transient or business-rule disable. Those are legitimate and
  // the sweep must leave them alone; a test that flagged them would be asking
  // every author to justify a correct line.
  const failedHide = /disabled=\{[^}]*!\s*can[A-Za-z]*/;

  const offenders: string[] = [];
  for (const row of READ_ONLY_SURFACE_CHECKLIST) {
    // A deferred row names no files, by type — its owner sweeps them, and this
    // suite claims nothing about what they contain.
    if (row.verdict === "deferred") continue;
    for (const file of row.gatedIn ?? []) {
      const full = path.join(process.cwd(), file);
      if (!existsSync(full)) continue;
      const code = codeOf(full);
      if (failedHide.test(code)) offenders.push(`${file} (${row.surface})`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `these files spend a capability on \`disabled\` instead of on whether the control renders — a disabled button is a failed hide (AS-020):\n${offenders.join("\n")}`
  );
});

// ----------------------------------------------------------------------------
// 5. THE POSITIVE ROWS — what the sweep must NOT have taken away.
// ----------------------------------------------------------------------------

test("global navigation carries no create, seat-management or destructive entry", () => {
  // ASSERTED ON THE DATA, NOT ON A RENDER, because the navigation IS data: three
  // exported arrays of `{ title, href }`. Rendering `AppSidebar` in three
  // contexts would prove the same thing through a router stub and a pile of
  // props, and would go quiet the day an item is added to a list the test
  // happened not to render. Reading the tables reaches every item by
  // construction — which is what "in each of the three contexts" actually
  // needs, since the three contexts differ only in WHICH of these tables they
  // are shown.
  const tables = {
    "plant nav (a plant Member sees this)": mainNavItems,
    "sending-church nav (an org Member sees this)": sendingChurchNavItems,
    "network nav (an org Member sees this)": networkAdminNavItems,
  };

  // A verb in a nav entry means the nav is offering to CHANGE something. Every
  // legitimate item here names a place.
  const verbs = /\b(new|create|add|delete|remove|invite|compose|schedule)\b/i;

  const offenders: string[] = [];
  for (const [label, items] of Object.entries(tables)) {
    for (const item of items) {
      if (verbs.test(item.title) || verbs.test(item.href ?? "")) {
        offenders.push(`${label}: "${item.title}" → ${item.href}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `navigation offers a write to a read-only context:\n${offenders.join("\n")}`
  );

  // The seat-management page is reached through the settings registry, never
  // the sidebar. If an href to it ever appears here, the registry's gate stops
  // being the only door and this row needs re-deciding.
  for (const [label, items] of Object.entries(tables)) {
    for (const item of items) {
      assert.notEqual(
        item.href,
        "/settings/team",
        `${label} links the seat-management page directly, bypassing the settings registry's seat.invitation.manage gate`
      );
    }
  }
});

test("there is still no command palette to gate", () => {
  // The checklist names one, and this product does not have one. That is a
  // finding with a shelf life: the day somebody adds a ⌘K palette with a
  // "New person" entry, the nav row above stops covering it. This fails then,
  // and the failure message says what to do about it.
  const palettes = TS_FILES.filter((file) => {
    if (file.includes("/wiki/")) return false; // the article search — a read
    // MOUNTING one, not defining or describing one. `src/components/ui/command.tsx`
    // is the shadcn primitive every palette would be built FROM, and this very
    // file's row 1 note names it in prose; a match on the bare word flags both
    // and the test that cries wolf gets deleted by the next person.
    return /<CommandDialog[\s/>]/.test(codeOf(file));
  }).map(rel);

  assert.deepEqual(
    palettes,
    [],
    `a command palette now exists in:\n${palettes.join("\n")}\nRow 1 of the read-only surface checklist covers it — gate its create and destructive entries on the capability each one invokes, and update the row's note, which currently says no palette exists.`
  );
});

test("a Member's own RSVP is reached by a route that has no seat gate at all", () => {
  // The FRD's first surviving affordance. It survives by CONSTRUCTION rather
  // than by a gate: /rsvp/[token] sits outside (dashboard), is authorised by
  // the emailed token, and holds no session to read a seat from. So the thing
  // to assert is an ABSENCE OF GATING — a well-meaning sweep that added
  // `useCan` here would break the one control AS-020 promises to keep, and
  // would break it for the recipients who are not accounts at all.
  const rsvp = TS_FILES.filter((file) => rel(file).startsWith("src/app/rsvp/"));
  assert.ok(rsvp.length > 0, "src/app/rsvp/ is gone — repoint this test");

  for (const file of rsvp) {
    const code = codeOf(file);
    assert.doesNotMatch(
      code,
      /useCan|holdsSeatFor|requireSeat/,
      `${rel(file)} gates the token RSVP on a seat. It must not: this page serves invitees who hold no account, and it is the one control the read-only checklist keeps.`
    );
  }
});

test("account settings are gated on nothing — an account always edits its own", () => {
  // The checklist's only POSITIVE row (15): "Nothing hidden". The two forms
  // behind it are `self.write`, which carries no seat set and no tenancy, so
  // all three read-only contexts hold it. The way this row fails is by a sweep
  // being tidy — adding a gate here because every other section has one.
  const section = path.join(
    SRC,
    "components/settings/sections/account-section.tsx"
  );
  assert.ok(
    existsSync(section),
    "the account section moved — repoint this test"
  );

  assert.doesNotMatch(
    codeOf(section),
    /useCan\(|holdsSeatFor\(/,
    "account settings are now gated on a capability. Row 15 says nothing here is hidden: an account always edits its own account, in every read-only context."
  );
});

test("the client transport is mounted, so useCan can answer at all", () => {
  const layout = path.join(SRC, "app/(dashboard)/layout.tsx");
  const code = codeOf(layout);

  // `useCan` FAILS CLOSED with no provider (see viewer-capabilities.tsx for
  // why that beats throwing). The cost of failing closed is that a layout which
  // stopped mounting the provider would hide every gated control in the product
  // and break no test — a bug that reads as "the buttons are gone" and gets
  // diagnosed as a permissions problem. This is that missing alarm.
  assert.match(
    code,
    /<ViewerCapabilitiesProvider/,
    "the dashboard layout no longer mounts ViewerCapabilitiesProvider — every useCan() in the product now answers false"
  );
  assert.match(
    code,
    /heldCapabilities\(user\)/,
    "the provider is no longer seeded from heldCapabilities(user)"
  );
});
