import assert from "node:assert/strict";
import { test } from "node:test";

import type { SeatFields } from "@/lib/auth/tenancy";
import {
  DEFAULT_SETTINGS_SECTION,
  isSettingsSectionId,
  RETIRED_SETTINGS_SECTIONS,
  SETTINGS_SECTIONS,
  sectionMatchesQuery,
  settingsSectionFromHash,
  settingsSectionHref,
  settingsSectionsFor,
  settingsSectionUrl,
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
//   * sharing — `isPlantOwner(user) && user.churchId`. #619 folded its panel
//     into Church, which carries the identical gate, and deleted the entry;
//     the panel INSIDE Church asks `sharing.toggle` for itself so that CS-006
//     can widen the section to plant Admins without widening the panel.
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
    // The only shape that reaches everything, the sharing panel included —
    // it lives inside `church` since #619.
    sees: ["account", "church", "team", "association", "notifications"],
  },
  {
    what: "a plant Admin",
    who: account({ churchId: PLANT, seat: "admin" }),
    // AS-014 gives an Admin the team surface, and CS-006 gives them CHURCH
    // (#618) — the widening #615 deferred by name, made in the issue that owns
    // it. `church.profile` is ADMIN_PLUS on a plant, and the section now asks
    // the capability table rather than spelling a seat set, so this row and the
    // four writes behind the section move together or not at all.
    //
    // SHARING IS STILL ABSENT and that is the whole point of the two-gate
    // split: an Admin may edit the plant's name, clocks and thresholds, and
    // consent to send its activity to a sending church remains the Owner's.
    sees: ["account", "church", "team", "notifications"],
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

test("every section is in the navigation", () => {
  // The ruled section list names five and all five are navigable since #619
  // retired the one unlisted entry (`sharing`, whose panel moved into Church).
  // A sixth nav entry would be a product change; an UNLISTED sixth is worse —
  // a section reachable only by a link somebody remembered to draw, which is
  // how `/settings/sharing`'s teaser came to be the copy that went stale.
  assert.deepEqual(
    SETTINGS_SECTIONS.filter((section) => !section.inNav).map((s) => s.id),
    []
  );
});

test("a retired id lands on the section that absorbed it", () => {
  // `/settings/sharing` was the consent panel's own address for two releases and
  // is the one id guaranteed to be in somebody's history. Bouncing it to the
  // default section would tell a planter their privacy controls were removed.
  assert.deepEqual(Object.keys(RETIRED_SETTINGS_SECTIONS), ["sharing"]);
  assert.equal(RETIRED_SETTINGS_SECTIONS.sharing, "church");

  // A retired id is RETIRED — it must not also be a live section, or the
  // redirect would shadow a real one.
  for (const [retired, target] of Object.entries(RETIRED_SETTINGS_SECTIONS)) {
    assert.equal(isSettingsSectionId(retired), false, retired);
    assert.ok(isSettingsSectionId(target), target);
  }
});

test("every section id resolves and nothing else does", () => {
  for (const section of SETTINGS_SECTIONS) {
    assert.ok(isSettingsSectionId(section.id));
    // A FRAGMENT since #657 (ruled 2026-08-22): settings opens over the current
    // screen, so a section's own address carries no path at all.
    assert.equal(settingsSectionHref(section.id), `#settings/${section.id}`);
    assert.equal(
      settingsSectionUrl(section.id),
      `/dashboard#settings/${section.id}`
    );
  }
  for (const bogus of ["", "nonsense", "Account", "team/", "../actions"]) {
    assert.equal(
      isSettingsSectionId(bogus),
      false,
      `"${bogus}" must not resolve to a section`
    );
  }
});

test("the fragment grammar: what opens settings, and on what", () => {
  // THE ADDRESS BAR IS UNTRUSTED INPUT and this is the parse. It is TOTAL —
  // every string a browser can put in `location.hash` has an answer — so the
  // interesting cases are the ones that must NOT be `null` and the ones that
  // must be.
  for (const section of SETTINGS_SECTIONS) {
    assert.equal(
      settingsSectionFromHash(`#settings/${section.id}`),
      section.id
    );
    // With and without the `#`, because `location.hash` carries one and the
    // redirect pages have already stripped theirs.
    assert.equal(settingsSectionFromHash(`settings/${section.id}`), section.id);
  }

  // A settings address that names no section still OPENS, on the section every
  // account has. This is the old `/settings` route's landing rule.
  assert.equal(settingsSectionFromHash("#settings"), DEFAULT_SETTINGS_SECTION);
  assert.equal(
    settingsSectionFromHash("#settings/nonsense"),
    DEFAULT_SETTINGS_SECTION
  );

  // A RETIRED id goes where its panel went, never to the default: `#settings/
  // sharing` was the consent panel's own address, and dropping its reader on
  // Account tells a planter their privacy controls were removed.
  for (const [retired, target] of Object.entries(RETIRED_SETTINGS_SECTIONS)) {
    assert.equal(settingsSectionFromHash(`#settings/${retired}`), target);
  }

  // AND EVERYTHING ELSE LEAVES THE MODAL SHUT. A fragment belongs to whoever
  // wrote it; a parser that treated an unrecognised one as "open settings"
  // would hijack every other anchor in the product.
  for (const other of [
    "",
    "#",
    "#top",
    "#settingsomething",
    "#not-settings/church",
    "#/settings/church",
    "#church",
  ]) {
    assert.equal(
      settingsSectionFromHash(other),
      null,
      `"${other}" must not open settings`
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
