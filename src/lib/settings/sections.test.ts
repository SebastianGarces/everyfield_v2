import assert from "node:assert/strict";
import { test } from "node:test";

import type { SeatFields } from "@/lib/auth/tenancy";
import {
  DEFAULT_SETTINGS_SECTION,
  isSettingsSectionId,
  SETTINGS_SECTIONS,
  sectionMatchesQuery,
  settingsSectionHref,
  settingsSectionsFor,
  type SettingsSectionId,
} from "./sections";

// ============================================================================
// THE SETTINGS REGISTRY (CS-001, CS-016, #615).
//
// WHY THIS FILE EXISTS. Before #615, reaching `/settings/team`,
// `/settings/association` or `/settings/sharing` was refused by a `redirect()`
// in each page body, and each of those redirects had a source-shaped guard
// pointed at it. The pages are gone and the refusal is now one table of
// predicates, so the guard has to move with it — otherwise the whole of this
// product's settings authorization is checked by nothing.
//
// `settingsSectionsFor` is a pure function of `SeatFields` with no I/O, so the
// table below is the real thing rather than a proxy for it: every account shape
// the product can produce, with the exact section list it must get back. A new
// entry whose gate nobody thought about fails here.
//
// The reference is what the DELETED pages did:
//
//   * team — `holdsSeatFor(user, "seat.invitation.manage")`, plus a redirect for
//     a null tenancy. That capability is `tenancy: "tenancy"`, so the second
//     half is already inside the first.
//   * association — `isPlantOwner(user) && user.churchId`, OR a sending church's
//     Owner. `isPlantOwner` already asserts the plant FK, so the `&&` was
//     redundant there too.
//   * sharing — `isPlantOwner(user) && user.churchId`.
//   * the index (account, notifications) — no gate at all.
// ============================================================================

const NO_TENANCY = {
  churchId: null,
  sendingChurchId: null,
  sendingNetworkId: null,
} as const;

const PLANT = "11111111-1111-4111-8111-111111111111";
const SENDING_CHURCH = "22222222-2222-4222-8222-222222222222";
const NETWORK = "33333333-3333-4333-8333-333333333333";

function account(fields: Partial<SeatFields>): SeatFields {
  return { ...NO_TENANCY, seat: null, ...fields } as SeatFields;
}

/** Every account shape the product can produce, and what settings it gets. */
const ACCOUNTS: {
  what: string;
  who: SeatFields;
  sees: SettingsSectionId[];
}[] = [
  {
    what: "a plant Owner",
    who: account({ churchId: PLANT, seat: "owner" }),
    // The only shape that reaches everything, sharing included.
    sees: [
      "account",
      "church",
      "team",
      "association",
      "notifications",
      "sharing",
    ],
  },
  {
    what: "a plant Admin",
    who: account({ churchId: PLANT, seat: "admin" }),
    // AS-014 gives an Admin the team surface. The Church section keeps the
    // Owner-only gate the old index block had; CS-006 is the issue that widens
    // it, and widening it here would be a permission change wearing a rename.
    sees: ["account", "team", "notifications"],
  },
  {
    what: "a plant Member",
    who: account({ churchId: PLANT, seat: "member" }),
    sees: ["account", "notifications"],
  },
  {
    what: "a registered plant Owner whose plant does not exist yet",
    who: account({ seat: "owner" }),
    // `seat.invitation.manage` is `tenancy: "tenancy"`, which is NOT `any`: it
    // refuses the account that holds a seat and names nothing to act on.
    sees: ["account", "notifications"],
  },
  {
    what: "a sending church's Owner",
    who: account({ sendingChurchId: SENDING_CHURCH, seat: "owner" }),
    // Association, because they answer `sending_church_to_network` (OV-013).
    // No Church: that section is a plant's.
    sees: ["account", "team", "association", "notifications"],
  },
  {
    what: "a sending church's Member",
    who: account({ sendingChurchId: SENDING_CHURCH, seat: "member" }),
    // AS-007 / ruling 185 (3): an org Member reads everything its Owner reads
    // and changes nothing. Every write behind Association is Owner-only, so the
    // section is ABSENT rather than rendered with refusing controls.
    sees: ["account", "notifications"],
  },
  {
    what: "a network's Owner",
    who: account({ sendingNetworkId: NETWORK, seat: "owner" }),
    // No Association: a network is nobody's invitee — `isSendingChurchAdminWithOrg`
    // names the sending church kind only, exactly as the deleted page did.
    sees: ["account", "team", "notifications"],
  },
  {
    what: "a coach (no tenancy, no seat)",
    who: account({}),
    sees: ["account", "notifications"],
  },
  {
    what: "a row naming two tenancies (the accepted data defect)",
    who: account({
      churchId: PLANT,
      sendingChurchId: SENDING_CHURCH,
      seat: "owner",
    }),
    // `memory/invariants.md` → Seats & Tenancy: such a row reaches NOTHING in
    // either direction, because `oversightOrgOf` and `isChurchLevelUser` are
    // both stated positively. It must not fall through to a plant's sections.
    sees: ["account", "notifications"],
  },
];

for (const { what, who, sees } of ACCOUNTS) {
  test(`${what} sees exactly: ${sees.join(", ")}`, () => {
    assert.deepEqual(
      settingsSectionsFor(who).map((section) => section.id),
      sees
    );
  });
}

test("every account can open the default section", () => {
  // The routes bounce an ungated section to `DEFAULT_SETTINGS_SECTION`, so a
  // shape that could not see it would redirect to itself for ever.
  for (const { what, who } of ACCOUNTS) {
    assert.ok(
      settingsSectionsFor(who).some(
        (section) => section.id === DEFAULT_SETTINGS_SECTION
      ),
      `${what} cannot open ${DEFAULT_SETTINGS_SECTION}, so its bounce would loop`
    );
  }
});

test("the visible sections keep registry order, whoever is asking", () => {
  // The nav, the search results and the tab order are one sequence that no
  // consumer sorts for itself.
  const order = SETTINGS_SECTIONS.map((section) => section.id);
  for (const { what, who } of ACCOUNTS) {
    const seen = settingsSectionsFor(who).map((section) => section.id);
    assert.deepEqual(
      seen,
      order.filter((id) => seen.includes(id)),
      `${what} gets the sections out of registry order`
    );
  }
});

test("only `sharing` is addressable without appearing in the navigation", () => {
  // The ruled section list names five. A sixth nav entry would be a product
  // change, and a section that is neither navigable nor linked is unreachable.
  assert.deepEqual(
    SETTINGS_SECTIONS.filter((section) => !section.inNav).map((s) => s.id),
    ["sharing"]
  );
});

test("every section id resolves and nothing else does", () => {
  for (const section of SETTINGS_SECTIONS) {
    assert.ok(isSettingsSectionId(section.id));
    assert.equal(settingsSectionHref(section.id), `/settings/${section.id}`);
  }
  for (const bogus of ["", "nonsense", "Account", "team/", "../actions"]) {
    assert.equal(
      isSettingsSectionId(bogus),
      false,
      `"${bogus}" must not resolve to a section`
    );
  }
});

test("search matches a section by its label and by the entries inside it", () => {
  const church = SETTINGS_SECTIONS.find((s) => s.id === "church")!;

  // The label, case-folded from either side.
  assert.ok(sectionMatchesQuery(church, "church"));
  assert.ok(sectionMatchesQuery(church, "CHURCH"));

  // And the entries, which is the half the labels cannot carry: "timezone" is
  // in a section called "Church" (CS-016).
  assert.ok(sectionMatchesQuery(church, "zone"));
  assert.ok(sectionMatchesQuery(church, "digest"));
  assert.ok(!sectionMatchesQuery(church, "zzzz"));

  // An empty or blank query filters nothing.
  assert.ok(sectionMatchesQuery(church, ""));
  assert.ok(sectionMatchesQuery(church, "   "));
});

test("a keyword is matched however it is capitalised", () => {
  // Every keyword happens to be lowercase today, so folding only the query
  // would pass — until the first entry that writes "Sunday" or "UTC", which
  // would then be silently unsearchable with nothing to fail.
  const withCapital = {
    ...SETTINGS_SECTIONS[0],
    keywords: ["UTC", "Sunday"] as const,
  };
  assert.ok(sectionMatchesQuery(withCapital, "utc"));
  assert.ok(sectionMatchesQuery(withCapital, "sund"));
});

test("every section carries the copy the modal renders", () => {
  for (const section of SETTINGS_SECTIONS) {
    assert.ok(section.label.length > 0, `${section.id} has no label`);
    assert.ok(
      section.description.length > 0,
      `${section.id} has no description, so its pane would open with a bare heading`
    );
    assert.ok(
      section.keywords.length > 0,
      `${section.id} is searchable by its label alone`
    );
  }
});
