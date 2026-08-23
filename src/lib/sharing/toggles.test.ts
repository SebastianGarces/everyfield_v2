import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { CAPABILITY_BY_EXPORT } from "@/lib/auth/capability-map";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import type { SeatFields } from "@/lib/auth/tenancy";
import {
  OVERSIGHT_SHARING_FEATURE,
  OVERSIGHT_SHARING_TOGGLE,
} from "@/lib/notifications/categories";

import {
  isSharingFeature,
  SHARING_PANEL_INTRO,
  SHARING_PULL_TOGGLES,
} from "./toggles";

// ============================================================================
// THE SHARING PANEL (CS-010/011/012, #619).
//
// Two properties are tested here, and both are ones a browser pass cannot show
// you: WHO may write a toggle, and whether the copy beside it is true.
//
//   * Owner-only is walked over every account shape the product can produce,
//     because "an Admin sees no panel" is a rendering fact and "an Admin cannot
//     WRITE one" is the fact that matters — the panel is hidden by the same
//     predicate `requireSeat` throws on, so the walk below is the refusal.
//   * The copy is held to `memory/invariants.md` line 84: the six pull toggles
//     gate FEATURE data, and the portfolio listing (name, phase, launch
//     countdown, health) returns to an oversight admin with no privacy gate at
//     all. A panel of switches that reads as "turn these off and they see
//     nothing" is a consent control overstating its own reach, which is worse
//     than no promise — the planter decides on a guarantee we do not offer.
// ============================================================================

const PLANT = "11111111-1111-4111-8111-111111111111";
const SENDING_CHURCH = "22222222-2222-4222-8222-222222222222";
const NETWORK = "33333333-3333-4333-8333-333333333333";

const NO_TENANCY = {
  churchId: null,
  sendingChurchId: null,
  sendingNetworkId: null,
} as const;

function account(fields: Partial<SeatFields>): SeatFields {
  return { ...NO_TENANCY, seat: null, ...fields } as SeatFields;
}

// ----------------------------------------------------------------------------
// Owner-only (CS-010, ruling 185 (1))
// ----------------------------------------------------------------------------

test("only a plant Owner may write a sharing toggle", () => {
  // THE NEGATIVE HALF IS THE POINT. An Admin is inside the plant and runs its
  // day-to-day; what leaves the plant is still not their decision. A coach and
  // an oversight admin are refused for a stronger reason — either deciding what
  // a plant shares would be the setting authorising itself.
  const refused: [string, SeatFields][] = [
    ["a plant Admin", account({ churchId: PLANT, seat: "admin" })],
    ["a plant Member", account({ churchId: PLANT, seat: "member" })],
    ["a coach with no tenancy", account({ seat: null })],
    [
      "a sending church's Owner",
      account({ sendingChurchId: SENDING_CHURCH, seat: "owner" }),
    ],
    [
      "a network's Owner",
      account({ sendingNetworkId: NETWORK, seat: "owner" }),
    ],
    [
      "a network Member",
      account({ sendingNetworkId: NETWORK, seat: "member" }),
    ],
    [
      "a row naming two tenancies",
      account({ churchId: PLANT, sendingNetworkId: NETWORK, seat: "owner" }),
    ],
    ["a registered Owner with no plant yet", account({ seat: "owner" })],
  ];

  for (const [what, who] of refused) {
    assert.equal(
      holdsSeatFor(who, "sharing.toggle"),
      false,
      `${what} was allowed to change what this plant shares`
    );
  }

  assert.equal(
    holdsSeatFor(account({ churchId: PLANT, seat: "owner" }), "sharing.toggle"),
    true,
    "the plant Owner cannot change their own plant's sharing"
  );
});

test("the panel's write is guarded by the capability the panel asks for", () => {
  // The two must be the same string or the panel renders a control guaranteed
  // to refuse its reader — the visible half of a permission drift. The Church
  // section calls `holdsSeatFor(user, "sharing.toggle")` and the action calls
  // `requireSeat("sharing.toggle")`, and the capability map is what the
  // repo-wide guard walks.
  assert.equal(
    CAPABILITY_BY_EXPORT[
      "src/app/(dashboard)/settings/actions.ts → setSharingToggleAction"
    ],
    "sharing.toggle"
  );

  // THE GATE MOVED INTO THE READ (#657) and became a SHAPE. `readChurch` asks
  // `holdsSeatFor(user, "sharing.toggle")` and hands the section
  // `sharing: null` when the answer is no, so the section has nothing to
  // evaluate — there is no view reaching it that carries toggle state an Admin
  // could be shown.
  const read = readFileSync(
    path.join(process.cwd(), "src/lib/settings/section-data.ts"),
    "utf8"
  );
  assert.match(read, /holdsSeatFor\(user, "sharing\.toggle"\)/);
  assert.match(
    read,
    /sharing: mayShare\s*\?/,
    "the sharing block must be absent from the view, not merely unrendered"
  );

  const section = readFileSync(
    path.join(
      process.cwd(),
      "src/components/settings/sections/church-section.tsx"
    ),
    "utf8"
  );

  // …and the panel is ABSENT rather than disabled for anyone else (ruling
  // 185 (7)). A `disabled` switch beside consent copy reads as "we decided this
  // for you", which is the opposite of what the panel is for.
  //
  // Comments are stripped first: the section's header explains the rule by
  // NAMING the shape it forbids, so documenting it would break the test that
  // enforces it — the technique `actions.test.ts` uses for the same reason.
  const rendered = section
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
  assert.doesNotMatch(rendered, /disabled/);

  // The gate is the PANEL'S own, not the section's. CS-006 opens this section
  // to plant Admins; if the panel leant on the section's visibility it would
  // widen silently on the day that lands.
  const actions = readFileSync(
    path.join(process.cwd(), "src/app/(dashboard)/settings/actions.ts"),
    "utf8"
  );
  assert.match(actions, /requireSeat\("sharing\.toggle"\)/);
});

// ----------------------------------------------------------------------------
// The rows, and what they claim (CS-011)
// ----------------------------------------------------------------------------

test("there are six pull rows, and the seventh toggle is the push one", () => {
  assert.deepEqual(
    SHARING_PULL_TOGGLES.map((toggle) => toggle.feature),
    [
      "people",
      "meetings",
      "tasks",
      "financials",
      "ministry_teams",
      "facilities",
    ]
  );

  // `share_wiki` (#62) joins by widening `PrivacyFeatureKey`, which fails the
  // BUILD in `toggles.ts` until it has a row — this assertion is the one that
  // has to be updated deliberately when it does.
  //
  // That the push toggle is NOT a pull row needs no assertion: `SharingPullFeature`
  // subtracts it, so `toggle.feature === OVERSIGHT_SHARING_FEATURE` does not
  // compile. The write boundary is what is worth checking here.
  assert.equal(isSharingFeature(OVERSIGHT_SHARING_FEATURE), true);
  assert.equal(isSharingFeature("everything"), false);
  assert.equal(isSharingFeature("share_people"), false);
});

test("no row claims the plant is hidden — the listing is ungated (line 84)", () => {
  const prose = [
    SHARING_PANEL_INTRO,
    ...SHARING_PULL_TOGGLES.flatMap((toggle) => [toggle.label, toggle.summary]),
  ]
    .join(" ")
    .toLowerCase();

  // The specific false claims that have shipped on a consent surface before.
  for (const overclaim of [
    /sees? nothing/,
    /invisible/,
    /hidden from/,
    /they cannot see this plant/,
  ]) {
    assert.doesNotMatch(prose, overclaim, `the panel copy claims too much`);
  }

  // And it says the true thing OUT LOUD, once, at the top. A panel of six
  // switches with no such line makes the overclaim by LAYOUT rather than by a
  // sentence, which no phrase-level guard would catch.
  assert.match(SHARING_PANEL_INTRO, /always see this plant listed/i);
  for (const fact of ["name", "current phase", "launch date"]) {
    assert.ok(
      SHARING_PANEL_INTRO.toLowerCase().includes(fact),
      `the intro never names "${fact}", which they see regardless`
    );
  }
});

test("every row says what is opened AND what stays closed", () => {
  for (const toggle of SHARING_PULL_TOGGLES) {
    // "Lets them see" is permission language on purpose: `financials` and
    // `facilities` gate a read with no oversight section drawn for it yet, so
    // "they see X" would describe a screen that does not exist.
    assert.match(
      toggle.summary,
      /^Lets them see /,
      `${toggle.feature} does not say what turning it on permits`
    );
    // The never-clause is the half a planter is actually deciding on. A row
    // that only says what opens invites the reader to imagine the worst.
    assert.match(
      toggle.summary,
      /\bNever\b/,
      `${toggle.feature} never says what stays closed`
    );

    // Control labels, not sentences.
    assert.ok(!toggle.label.endsWith("."), toggle.label);
    assert.ok(toggle.summary.endsWith("."), toggle.summary);
  }
});

test("the push row keeps its own copy, and the panel does not restate it", () => {
  // The push toggle's copy lives beside the gate `enqueue` enforces
  // (`OVERSIGHT_SHARING_TOGGLE`) and is rendered whole. Nothing in this module
  // may paraphrase it — that is exactly how the deleted teaser went stale.
  const pullProse = SHARING_PULL_TOGGLES.map((t) => t.summary).join(" ");
  for (const line of OVERSIGHT_SHARING_TOGGLE.detail) {
    assert.ok(
      !pullProse.includes(line),
      "a pull row restates the push toggle's copy"
    );
  }
  assert.ok(!pullProse.includes(OVERSIGHT_SHARING_TOGGLE.summary));
});
