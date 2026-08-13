import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { assertInOrder, sourceReader } from "@/lib/testing/source-span";
import {
  ROLE_ALREADY_FILLED_MESSAGE,
  PERSON_ALREADY_ASSIGNED_MESSAGE,
} from "@/lib/ministry-teams/membership-copy";
import {
  ROLE_ALREADY_FILLED_TOAST_MS,
  assignRefusalDelivery,
} from "@/components/ministry-teams/assign-refusal";

// ----------------------------------------------------------------------------
// #409 D1 — the seat refusal has to be READABLE, not merely produced.
//
// WHAT FAILED. The database half of #409 D1 was right and stayed right: the
// index refuses the second writer, the loser writes nothing, the role ends with
// exactly one active holder (`role-seat-race.test.ts`, live). The UI half was
// not. `member-assign-dialog.tsx` put the sentence in `setError`, rendered by an
// `<Alert>` inside `<DialogContent>`, and then called `router.refresh()` in the
// same handler — and `members-roles-tab.tsx` mounts `<MemberAssignDialog>` ONLY
// in the role card's Open arm. The refresh returns the seat Filled, the Open arm
// stops rendering, and the only node holding the sentence unmounts. Measured on
// the preview built from 16e9cf5 with a 40 ms DOM sampler installed before the
// losing click: present in `[role=dialog]` t=21641 ms → t=21761 ms (4 samples,
// ~120 ms), dialog CLOSED at t=21803 ms. The planter was left on a roles tab
// silently showing somebody else in the seat, having never read why.
//
// WHY THE SEAM IS A PURE FUNCTION. The branch had no assertion above
// `membershipConflictMessage` because there was nowhere to put one: the suite is
// `node:test` + tsx with no DOM, and importing the dialog pulls in
// `@/app/(dashboard)/teams/actions`, which opens a database connection at import
// time. `assignRefusalDelivery` is the decision — WHERE the refusal is shown —
// lifted out of an unreachable async click handler into a pure function over a
// string. §1–§3 exercise it directly. §4 holds the two source files to the
// contract it describes, because a correct decision the handler ignores is no
// fix at all.
// ----------------------------------------------------------------------------

/**
 * Repo-relative POSIX path → its source. Resolved against `process.cwd()`, the
 * convention every source-shaped suite here uses — `pnpm test` runs from the
 * repository root, and `import.meta.dirname` is undefined under tsx's CJS
 * output.
 */
function read(relative: string): string {
  return readFileSync(path.join(process.cwd(), ...relative.split("/")), "utf8");
}

const DIALOG_PATH = "src/components/ministry-teams/member-assign-dialog.tsx";
const TAB_PATH = "src/components/ministry-teams/members-roles-tab.tsx";

/** Source with its comments removed — prose that NAMES a rule is not a copy of it. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

// ============================================================================
// §1 — the seat refusal leaves the dying subtree
// ============================================================================

test("§1 the seat refusal is toasted, never left inline where the refresh can unmount it", () => {
  const delivery = assignRefusalDelivery(ROLE_ALREADY_FILLED_MESSAGE);

  assert.equal(
    delivery.toast?.message,
    ROLE_ALREADY_FILLED_MESSAGE,
    "#409 D1 rules this sentence — the toast carries it verbatim, never a re-wording"
  );
  assert.equal(
    delivery.inline,
    null,
    "the inline <Alert> lives inside <DialogContent>, which this same delivery closes and the refresh unmounts — a copy there is the defect, not a belt-and-braces"
  );
});

test("§1b the refresh still fires, and is not held behind a dismissal", () => {
  const delivery = assignRefusalDelivery(ROLE_ALREADY_FILLED_MESSAGE);

  assert.equal(
    delivery.refreshRoles,
    true,
    "the roles tab underneath says Open and is wrong; refreshing it is the whole reason this refusal is special"
  );
  assert.equal(
    delivery.closeDialog,
    true,
    "the Open seat this dialog was opened beside no longer exists"
  );
});

test("§1c the toast outlives the refresh it fires beside", () => {
  const { toast } = assignRefusalDelivery(ROLE_ALREADY_FILLED_MESSAGE);
  assert.ok(toast, "§1 already proved this, but narrow the type honestly");

  // The acceptance criterion is that the sentence is still readable AFTER the
  // refresh settles — a server round-trip — not that it was rendered once.
  assert.ok(
    toast.durationMs >= 2_000,
    `the sentence must survive the refresh by at least 2s; got ${toast.durationMs}ms`
  );
  assert.equal(toast.durationMs, ROLE_ALREADY_FILLED_TOAST_MS);
  assert.ok(
    ROLE_ALREADY_FILLED_TOAST_MS > 4_000,
    "sonner's 4s default is the value this constant exists to override"
  );
});

// ============================================================================
// §2 — every OTHER refusal stays exactly where it was
// ============================================================================

test("§2 an ordinary failure stays inline, closes nothing and refreshes nothing", () => {
  for (const message of [
    "Failed to assign member",
    "Person not found",
    PERSON_ALREADY_ASSIGNED_MESSAGE,
  ]) {
    assert.deepEqual(
      assignRefusalDelivery(message),
      {
        toast: null,
        inline: message,
        closeDialog: false,
        refreshRoles: false,
      },
      `${message}: the roles tab is unchanged, so the dialog is still standing and the <Alert> beside the chosen person is the better home — Confirm is one click away`
    );
  }
});

test("§2b the person-level duplicate is NOT collapsed into the seat refusal", () => {
  // Two different sentences with two different next moves (#409 D1). They are
  // produced by two different indexes and `membershipConflictMessage` keeps them
  // apart; this is the same rule one layer up.
  assert.notEqual(PERSON_ALREADY_ASSIGNED_MESSAGE, ROLE_ALREADY_FILLED_MESSAGE);
  assert.equal(
    assignRefusalDelivery(PERSON_ALREADY_ASSIGNED_MESSAGE).toast,
    null
  );
});

// ============================================================================
// §3 — the sentence is read from the leaf that rules it
// ============================================================================

test("§3 the delivery matches on the ruled constant, not a re-typed string", () => {
  const source = read("src/components/ministry-teams/assign-refusal.ts");

  assert.match(
    source,
    /import \{ ROLE_ALREADY_FILLED_MESSAGE \} from "@\/lib\/ministry-teams\/membership-copy"/,
    "#409 D1: the sentence is imported from the import-free copy leaf, never re-typed — a re-typed copy drifts and the delivery silently falls through to `inline`"
  );
  // Comments stripped: the header QUOTES the sentence while telling the story
  // of the defect, and quoting it in prose is not a second implementation of it
  // (`ruled-guards.test.ts` §4c's `code()`).
  assert.doesNotMatch(
    stripComments(source),
    /"Role is already filled"/,
    "a literal here is the second copy of the ruled sentence"
  );
  // The seam is imported by a `"use client"` component, so it must stay as thin
  // as the leaf it reads: `@/lib/ministry-teams/service` opens with `@/db`.
  assert.doesNotMatch(
    source,
    /^import .*(@\/db|@\/lib\/ministry-teams\/(service|memberships))/m,
    "this module reaches a browser chunk — importing the trunk ships the database client with it"
  );
});

// ============================================================================
// §4 — the dialog actually obeys the delivery
// ============================================================================

test("§4 the dialog raises the seat refusal through the toaster, and still refreshes", () => {
  const dialog = read(DIALOG_PATH);

  assert.match(
    dialog,
    /import \{ toast \} from "sonner"/,
    "#409 D1: the sentence has to leave this component's subtree — `src/app/layout.tsx` mounts <Toaster> at the root, a sibling of the whole page"
  );

  // The ORDER is the property: decide, toast, then refresh. A refresh ahead of
  // the toast is the bug returning by another route.
  assertInOrder(
    dialog,
    DIALOG_PATH,
    [
      "const delivery = assignRefusalDelivery(result.error)",
      "toast.error(delivery.toast.message",
      "duration: delivery.toast.durationMs",
      "if (delivery.refreshRoles) router.refresh()",
    ],
    "#409 D1: decide, raise the sentence out of this subtree, THEN refresh — a refresh ahead of the toast is the defect returning by another route"
  );

  assert.doesNotMatch(
    dialog,
    /setError\(result\.error\)/,
    "every refusal used to land in the dialog-local <Alert>; the seat one must not"
  );
  assert.match(
    dialog,
    /setError\(delivery\.inline\)/,
    "the inline slot is still the home for every OTHER refusal — the fix narrows it, it does not remove it"
  );
});

test("§4b the roles tab still mounts the dialog only in the Open arm — which is WHY the toast is required", () => {
  const tab = read(TAB_PATH);

  // This is the premise of the whole fix, pinned so it cannot quietly stop
  // being true and leave the toast looking like an arbitrary preference. If a
  // later change hoists <MemberAssignDialog> out of the ternary, re-read
  // `assign-refusal.ts`'s header before simplifying anything here.
  assertInOrder(
    tab,
    TAB_PATH,
    ["role.assignedPerson ? (", "<MemberRemoveButton", "<MemberAssignDialog"],
    "the dialog holding the refusal is mounted only beside an OPEN seat, so the refresh that reveals the occupant is the thing that unmounts it"
  );

  // Everything the OCCUPIED arm renders sits before the single mount site, so
  // the arm the refresh switches to has no dialog in it at all.
  const occupiedArm = sourceReader(tab, TAB_PATH).span(
    "role.assignedPerson ? (",
    "<MemberAssignDialog"
  );
  assert.match(occupiedArm, /Filled/, "that arm is the Filled badge's");
  assert.match(occupiedArm, /<MemberRemoveButton/);

  assert.equal(
    tab.split("<MemberAssignDialog").length - 1,
    1,
    "one mount site — the Open arm; the Filled arm the refresh switches to has none"
  );
});
