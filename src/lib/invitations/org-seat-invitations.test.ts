import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { InvitationsList } from "@/components/oversight/invitations-list";
import { SeatInviteForm } from "@/components/settings/seat-invite-form";
import { SeatRoster } from "@/components/settings/seat-roster";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import {
  isChurchLevelUser,
  oversightOrgOf,
  tenancyColumns,
  tenancyOf,
  type SeatFields,
  type SeatTenancy,
  type SeatTenancyType,
} from "@/lib/auth/tenancy";
import { namedButtons } from "@/lib/testing/rendered-markup";
import { sourceReader, stripComments } from "@/lib/testing/source-span";

import { ACCOUNT_NOT_INVITABLE_MESSAGE } from "./core";
import { inviteeRefusalFor, invitesFromTenancyToAddressQuery } from "./seat";
import { INVITED_AS_COPY, TENANCY_NOUN, invitedAsKey } from "./seat-copy";

// ============================================================================
// #500 / AS-005, AS-007, AS-010, AS-012, AS-014 — ORG-SIDE SEAT INVITATIONS.
//
// A sending church's or network's Owner or Admin invites staff into the ORG as
// Admin or Member, and an org Member signs in to full read parity with the
// Owner and zero admin actions.
//
// WHAT THIS FILE IS FOR, and what it deliberately is not. The sibling
// `./seat.test.ts` proves the seat-invitation machinery over a PLANT; this one
// proves that widening it to an org changed the TENANCY and nothing else. So
// almost every assertion here is a comparison: the same predicate, the same
// message, the same component, answered for three tenancies instead of one.
// A rule that had to be restated for the org side would be the drift AS-010's
// "one implementation, not a second copy" exists to prevent, and the shape of
// this file is what makes such a restatement visible.
//
// THE FOUR SHAPES, on the same footing as `./seat.test.ts`:
//
//   * EXECUTED — the pure decisions: the tenancy resolution, the refusal
//     predicate, the capability table.
//   * GENERATED SQL — the scope. "A sending-church Admin cannot reach a
//     network's rows" is a claim about a `WHERE`, and a `WHERE` is only honest
//     in `toSQL()`.
//   * RENDERED MARKUP — the controls. AC 7 is an ABSENCE ("no invite, revoke,
//     resend or remove control anywhere"), and an absence is only provable
//     against what a reader is actually served.
//   * SOURCE — the module graph and the guards each page applies, for the pages
//     that need a database to render.
//
// THE END-TO-END HALF IS `./seat-invitations-live.test.ts`, which walks an org
// invitation through registration against a real Postgres and asserts the
// account's tenancy FK, its seat and the untouched `persons` table (AC 1 and
// AC 3). It is in the `Live DB Race Suites` job; everything a real database is
// NOT needed for is here, because a suite that only runs with a container is a
// suite that stops running.
// ============================================================================

const SRC = path.join(process.cwd(), "src");
const read = (...segments: string[]) =>
  readFileSync(path.join(SRC, ...segments), "utf8");

const SEAT = sourceReader(
  stripComments(read("lib", "invitations", "seat.ts")),
  "seat.ts (stripped)"
);
const TEAM_PAGE = sourceReader(
  stripComments(read("app", "(dashboard)", "settings", "team", "page.tsx")),
  "settings/team/page.tsx (stripped)"
);
const ORG_INVITATIONS_PAGE = stripComments(
  read("app", "(dashboard)", "oversight", "invitations", "page.tsx")
);
const PLANT_DETAIL_PAGE = stripComments(
  read("app", "(dashboard)", "oversight", "plants", "[id]", "page.tsx")
);
const PLANT_DETAIL = stripComments(
  read("components", "oversight", "plant-detail.tsx")
);
const SENDING_CHURCHES_PAGE = stripComments(
  read("app", "(dashboard)", "oversight", "sending-churches", "page.tsx")
);
const ACCESS = stripComments(read("lib", "auth", "access.ts"));
const ACCOUNT_ENTITIES = stripComments(
  read("app", "(auth)", "register", "account-entities.ts")
);
const ASSOCIATION_PAGE = stripComments(
  read("app", "(dashboard)", "settings", "association", "page.tsx")
);

const PLANT = "11111111-1111-4111-8111-111111111111";
const NETWORK = "33333333-3333-4333-8333-333333333333";
const SENDING_CHURCH = "44444444-4444-4444-8444-444444444444";

/** A `users` row, in the shape every authority rule reads. */
function account(fields: Partial<SeatFields>): SeatFields {
  return {
    seat: null,
    churchId: null,
    sendingChurchId: null,
    sendingNetworkId: null,
    ...fields,
  };
}

const NETWORK_OWNER = account({ seat: "owner", sendingNetworkId: NETWORK });
const NETWORK_ADMIN = account({ seat: "admin", sendingNetworkId: NETWORK });
const NETWORK_MEMBER = account({ seat: "member", sendingNetworkId: NETWORK });
const SC_OWNER = account({ seat: "owner", sendingChurchId: SENDING_CHURCH });
const SC_ADMIN = account({ seat: "admin", sendingChurchId: SENDING_CHURCH });
const SC_MEMBER = account({ seat: "member", sendingChurchId: SENDING_CHURCH });
const PLANT_ADMIN = account({ seat: "admin", churchId: PLANT });

/** The two org tenancies, as the value every scoped query is built from. */
const ORG_TENANCIES = [
  ["a sending church", { type: "sending_church", id: SENDING_CHURCH }],
  ["a network", { type: "network", id: NETWORK }],
] as const satisfies readonly (readonly [string, SeatTenancy])[];

// ----------------------------------------------------------------------------
// 1. THE TENANCY, AS ONE VALUE — the structure the whole issue rests on
// ----------------------------------------------------------------------------

test("tenancyOf answers for all three kinds, and oversightOrgOf narrows it", () => {
  assert.deepEqual(tenancyOf(NETWORK_OWNER), { type: "network", id: NETWORK });
  assert.deepEqual(tenancyOf(SC_OWNER), {
    type: "sending_church",
    id: SENDING_CHURCH,
  });
  assert.deepEqual(tenancyOf(PLANT_ADMIN), { type: "church", id: PLANT });

  // ONE RESOLUTION, TWO READERS. `oversightOrgOf` is `tenancyOf` with the plant
  // removed, so the two can never disagree about which org a row names — which
  // is what lets the invitation layer and `requireOversightUser` scope by the
  // same fact.
  for (const who of [NETWORK_OWNER, NETWORK_MEMBER, SC_OWNER, SC_MEMBER]) {
    assert.deepEqual(oversightOrgOf(who), tenancyOf(who));
  }
  assert.equal(oversightOrgOf(PLANT_ADMIN), null);
});

test("a row naming two tenancies resolves to nothing, so it invites nowhere", () => {
  // The accepted residual (`memory/invariants.md` → Seats & Tenancy): nothing
  // in the schema holds an account to one tenancy, so the state is
  // REPRESENTABLE and every reader has to fail closed on it. `tenancyOf` is now
  // one of those readers, and the invitation layer's scope comes from it — so a
  // defective row has no `WHERE` to be given and reaches no rows in either org.
  const twoTenancies = account({
    seat: "owner",
    churchId: PLANT,
    sendingNetworkId: NETWORK,
  });

  assert.equal(tenancyOf(twoTenancies), null);
  assert.equal(
    holdsSeatFor(twoTenancies, "seat.invitation.manage"),
    false,
    "a row with a competing claim on two tenancies may staff neither"
  );
});

test("tenancyColumns sets ONE FK and NULLs the other two (AC 2)", () => {
  // AC 2 — "the invitation targets exactly one org and never a plant", read off
  // the one function that turns a tenancy back into columns. Both writers use
  // it (the invitation insert and the users insert at registration), so the
  // exactly-one CHECK is satisfied by construction rather than by each call
  // site remembering it.
  assert.deepEqual(
    tenancyColumns({ type: "sending_church", id: SENDING_CHURCH }),
    {
      churchId: null,
      sendingChurchId: SENDING_CHURCH,
      sendingNetworkId: null,
    }
  );
  assert.deepEqual(tenancyColumns({ type: "network", id: NETWORK }), {
    churchId: null,
    sendingChurchId: null,
    sendingNetworkId: NETWORK,
  });
  assert.deepEqual(tenancyColumns({ type: "church", id: PLANT }), {
    churchId: PLANT,
    sendingChurchId: null,
    sendingNetworkId: null,
  });

  // NULL, NOT ABSENT. An omitted key would leave a previous value standing on
  // any writer that spread this over an existing object, and would read as "we
  // did not think about that column" rather than "that column is empty".
  for (const [, tenancy] of ORG_TENANCIES) {
    assert.deepEqual(Object.keys(tenancyColumns(tenancy)).sort(), [
      "churchId",
      "sendingChurchId",
      "sendingNetworkId",
    ]);
  }
});

test("the create writes its tenancy by spreading, and names no column", () => {
  const insert = SEAT.span(
    "const row: NewUserInvitation",
    "const [invitation]"
  );

  assert.match(
    insert,
    /\.\.\.tenancyColumns\(tenancy\)/,
    "the insert must spread the resolved tenancy — a named column here is a second place the exactly-one rule could be got wrong"
  );
  for (const column of ["churchId:", "sendingChurchId:", "sendingNetworkId:"]) {
    assert.ok(
      !insert.includes(column),
      `the invitation insert names ${column} directly; it must come from tenancyColumns`
    );
  }
});

test("a client says WHO and WHICH SEAT, and never which tenancy (AC 2)", () => {
  // THE TARGET IS NOT A PARAMETER, which is what makes "never a plant" a
  // property of the surface rather than of a validator. The tenancy is resolved
  // from the ACTOR's own session by `invitingTenancy`, so an org's invitation
  // cannot be aimed at a plant by any request: there is no field for one to
  // arrive in and no code path that reads one.
  const request = SEAT.span(
    "export type UserInvitationRequest",
    "function seatColumnFor"
  );

  for (const forbidden of [
    "churchId",
    "sendingChurchId",
    "sendingNetworkId",
    "tenancy",
  ]) {
    assert.ok(
      !request.includes(forbidden),
      `UserInvitationRequest carries ${forbidden} — the inviting tenancy is the actor's own and must never be a client field`
    );
  }

  assert.match(
    SEAT.after("async function createUserInvitationAs").slice(0, 900),
    /const tenancy = invitingTenancy\(actor\)/,
    "the create must resolve its tenancy from the actor"
  );
});

// ----------------------------------------------------------------------------
// 2. THE SCOPE — a `WHERE`, so it is asserted in SQL (AC 9)
// ----------------------------------------------------------------------------

const TENANCY_SQL_COLUMN: Record<SeatTenancyType, string> = {
  church: "church_id",
  sending_church: "sending_church_id",
  network: "sending_network_id",
};

test("every scoped read names the actor's OWN tenancy column, and only it", () => {
  // AC 9's second half, and the tenancy leak guard for the whole surface: a
  // network Admin manages the NETWORK's rows, and a sending-church Admin's
  // every query names `sending_church_id`, so a network's invitation is not
  // merely hidden from them — it matches no `WHERE` they can produce.
  for (const [what, tenancy] of [
    ...ORG_TENANCIES,
    ["a plant", { type: "church", id: PLANT } as const],
  ] as const) {
    const { sql, params } = invitesFromTenancyToAddressQuery(
      "seat",
      tenancy,
      "stranger@example.com",
      new Date("2026-07-21T12:00:00.000Z")
    ).toSQL();

    const mine = TENANCY_SQL_COLUMN[tenancy.type];
    assert.match(
      sql,
      new RegExp(`"user_invitations"\\."${mine}" = \\$`),
      `${what}: the cap must be scoped by ${mine}`
    );
    assert.ok(
      params.includes(tenancy.id),
      `${what}: the actor's own id must be a bound parameter`
    );

    // AND NOT THE OTHER TWO. A query that named a second tenancy column would
    // be one an id from elsewhere could satisfy.
    for (const other of Object.values(TENANCY_SQL_COLUMN)) {
      if (other === mine) continue;
      assert.ok(
        !sql.includes(`"${other}"`),
        `${what}: the cap also names ${other}`
      );
    }
  }
});

test("the list, the revoke, the resend and the sweep share ONE predicate", () => {
  // The authority IS the `WHERE`, and it is one function — so what an Admin
  // sees, closes, re-emails and expires is exactly one population. Four
  // spellings would be four chances for one of them to lose its tenancy term.
  for (const [where, span] of [
    [
      "listUserInvitationsFor",
      SEAT.span(
        "export async function listUserInvitationsFor",
        "async function loadOurs"
      ),
    ],
    [
      "loadOurs",
      SEAT.span(
        "async function loadOurs",
        "export async function revokeUserInvitationAs"
      ),
    ],
    [
      "revokeUserInvitationAs",
      SEAT.span(
        "export async function revokeUserInvitationAs",
        "export async function resendUserInvitationEmailAs"
      ),
    ],
    [
      "expireLapsedUserInvitations",
      SEAT.after("export async function expireLapsedUserInvitations"),
    ],
  ] as const) {
    assert.match(
      span,
      /oursFilter\(actor\)/,
      `${where} must scope through the shared predicate, never a hand-written column`
    );
  }

  assert.match(
    SEAT.span(
      "function oursFilter",
      "export async function listUserInvitationsFor"
    ),
    /tenancyMatches\(invitingTenancy\(actor\)\)/,
    "and that predicate resolves the actor's tenancy rather than reading a column off them"
  );
});

// ----------------------------------------------------------------------------
// 3. THE ONE NEUTRAL REFUSAL — unchanged by the widening (AC 4)
// ----------------------------------------------------------------------------

test("an org seat invitation to an existing account gets the ONE message", () => {
  // AC 4. The refusal is a property of the KIND and not of the tenancy: a seat
  // invitation would MOVE an account between tenancies wherever it points, so
  // an org's is register-only on exactly the same footing as a plant's.
  assert.equal(
    inviteeRefusalFor("seat", { id: "whoever" }),
    ACCOUNT_NOT_INVITABLE_MESSAGE
  );
  assert.equal(inviteeRefusalFor("seat", null), null);

  // THE EXACT CONSTANT, IMPORTED. A second sentence that happened to read the
  // same is the drift this asserts against — it would diverge the first time
  // either was reworded.
  assert.equal(
    ACCOUNT_NOT_INVITABLE_MESSAGE,
    "We cannot invite that email address — check your plants and pending invitations, or invite the planter's own address, or one that has not signed up yet"
  );

  // IMPORTED, NEVER RESTATED. A second sentence that happened to read the same
  // would diverge the first time either was reworded, and AS-010's "one
  // implementation, not a second copy" is exactly what this file exists to
  // check for the org side.
  assert.ok(
    !SEAT.code.includes("We cannot invite that email address"),
    "the refusal must be the imported constant, never a literal restated in the seat module"
  );
});

test("nothing below the address lookup varies on the tenancy", () => {
  // The positional rule holds for an org exactly as it does for a plant: every
  // check that can compose a LEGIBLE message reads the caller's own rows, above
  // the lookup. Below it there is one sentence, and a branch on the tenancy
  // down there would be a second fact about a stranger.
  const belowTheLookup = SEAT.span(
    "const [existingAccount]",
    "const token = newUserInvitationToken()"
  );

  assert.ok(
    !belowTheLookup.includes("tenancy"),
    "the refusal below the lookup must not vary on which tenancy is inviting"
  );
});

// ----------------------------------------------------------------------------
// 4. WHO MAY DO WHAT — the capability table, for an org's three seats (AC 7)
// ----------------------------------------------------------------------------

test("an org Owner and Admin may staff the org; a Member may not (AS-005)", () => {
  for (const [what, who] of [
    ["a network Owner", NETWORK_OWNER],
    ["a network Admin", NETWORK_ADMIN],
    ["a sending-church Owner", SC_OWNER],
    ["a sending-church Admin", SC_ADMIN],
  ] as const) {
    assert.equal(
      holdsSeatFor(who, "seat.invitation.manage"),
      true,
      `${what} may not invite into their own org`
    );
  }

  for (const [what, who] of [
    ["a network Member", NETWORK_MEMBER],
    ["a sending-church Member", SC_MEMBER],
  ] as const) {
    assert.equal(
      holdsSeatFor(who, "seat.invitation.manage"),
      false,
      `${what} may create a seat invitation`
    );
  }
});

test("an org Member is refused EVERY state-changing org verb (AC 7)", () => {
  // The acceptance criterion's five, each read off the one capability table
  // rather than off the surface that renders it — so a new control wired to any
  // of these verbs inherits the refusal instead of having to re-earn it.
  const stateChanging = [
    // invite, resend and revoke an ASSOCIATION invitation
    "org.invitation.manage",
    // invite, resend and revoke a SEAT invitation
    "seat.invitation.manage",
    // sever a plant from the portfolio
    "org.association.sever",
    // leave a network
    "org.association.leave",
    // roster edit: appoint, demote, remove
    "seat.manage",
    // org settings and billing
    "org.settings",
  ] as const;

  for (const capability of stateChanging) {
    for (const [what, who] of [
      ["a network Member", NETWORK_MEMBER],
      ["a sending-church Member", SC_MEMBER],
    ] as const) {
      assert.equal(
        holdsSeatFor(who, capability),
        false,
        `${what} holds ${capability}`
      );
    }
  }
});

test("…and reaches every READ, which is the whole of the grant (AC 6)", () => {
  // AS-007 / ruling 185 (3): an org Member reads everything its Owner reads.
  // The read verbs carry `seats: null` — a session is the whole rule — so the
  // parity is structural rather than a list somebody has to keep in step.
  for (const capability of ["read", "self.write"] as const) {
    for (const who of [NETWORK_MEMBER, SC_MEMBER, NETWORK_OWNER, SC_OWNER]) {
      assert.equal(holdsSeatFor(who, capability), true);
    }
  }
});

test("the reach itself never branches on the seat (AC 6)", () => {
  // THE READ PARITY IS ONE LINE, AND IT IS THIS ONE. `getAccessibleChurchIds`
  // resolves the org from the tenancy FK alone, so a Member and an Owner of one
  // org are handed the identical church-id list and every oversight read —
  // the directory, plant detail, the health portfolio, the sending-church
  // roster — is built from it. A seat test anywhere in that path would be the
  // thing that breaks AS-007, so its ABSENCE is what is asserted.
  const orgArm = sourceReader(ACCESS, "access.ts (stripped)").span(
    "export async function getAccessibleChurchIds",
    "export async function requireChurchAccess"
  );

  assert.match(orgArm, /const org = oversightOrgOf\(user\)/);
  assert.ok(
    !orgArm.includes("user.seat ==="),
    "the org arm must not compare a seat — an org Member reads what its Owner reads"
  );

  // And the two accounts genuinely resolve to the same org, which is what makes
  // "identical list" true rather than merely intended.
  assert.deepEqual(
    oversightOrgOf(NETWORK_MEMBER),
    oversightOrgOf(NETWORK_OWNER)
  );
  assert.deepEqual(oversightOrgOf(SC_MEMBER), oversightOrgOf(SC_OWNER));
});

test("an org Member is NOT church-level, so the share_* gate still applies (AC 8)", () => {
  // `canAccessFeatureData` exempts CHURCH-LEVEL accounts and gates everybody
  // else on the six toggles. An org Member is an oversight account by its FK,
  // so the gate reaches them for the same reason it reaches the Owner — this
  // issue gives a second seat the Owner's existing reach and not one inch more.
  for (const who of [NETWORK_MEMBER, SC_MEMBER, NETWORK_OWNER, SC_OWNER]) {
    assert.equal(isChurchLevelUser(who), false);
  }
});

// ----------------------------------------------------------------------------
// 5. THE CONTROLS AN ORG MEMBER IS SERVED — an absence, so it is rendered
// ----------------------------------------------------------------------------

test("the pending list offers a Member no resend and no revoke (AC 7)", () => {
  const rows = [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      inviteeEmail: "invitee@example.com",
      status: "pending" as const,
      sentLabel: "Aug 21, 2026",
      expiresLabel: "Sep 20, 2026",
    },
  ];

  const asMember = renderToStaticMarkup(
    createElement(InvitationsList, { rows, canAct: false })
  );
  const asOwner = renderToStaticMarkup(
    createElement(InvitationsList, { rows, canAct: true })
  );

  // THE ROW IS STILL THERE — the Member reads the list in full, which is the
  // parity half of the ruling. What is gone is the pair of verbs.
  assert.ok(asMember.includes("invitee@example.com"));
  assert.ok(asOwner.includes("invitee@example.com"));

  // THE TWO VERBS, BY THE WORDS ON THEM. They are submit buttons inside their
  // own forms rather than icon buttons, so what identifies them to a reader is
  // their text — and the absence of that text is the absence of the control.
  for (const verb of ["Resend", "Revoke"]) {
    assert.ok(
      asOwner.includes(verb),
      `the Owner must still be served ${verb} — otherwise this test would pass on a broken list`
    );
    assert.ok(
      !asMember.includes(verb),
      `an org Member must be served no ${verb} control on a pending invitation`
    );
  }

  // AND NO FORM TO POST FROM. The refusal that matters is `requireSeat` in the
  // action; what this asserts is that the Member is not invited to meet it.
  assert.ok(
    !asMember.includes('name="invitationId"'),
    "a Member's list must carry no hidden invitation id for a control to submit"
  );
});

test("/oversight/invitations gates the form and the row verbs on ONE rule", () => {
  // Not rendered: the page reads the database. What is asserted is that the
  // form and the list take their flag from the capability table and not from a
  // seat comparison, so the page and `./actions.ts` cannot disagree.
  assert.match(
    ORG_INVITATIONS_PAGE,
    /holdsSeatFor\(user, "org\.invitation\.manage"\)/,
    "the page must ask the same verb its actions guard with"
  );
  assert.match(
    ORG_INVITATIONS_PAGE,
    /\{canManageInvitations && \(\s*<InvitationCreateForm/,
    "the create form is the Owner's; a Member must not be served it"
  );
  assert.match(
    ORG_INVITATIONS_PAGE,
    /<InvitationsList rows=\{rows\} canAct=\{canManageInvitations\} \/>/,
    "and the row verbs ride the same flag"
  );
});

test("the sever is the Owner's, on the page and in the component (AC 7)", () => {
  assert.match(
    PLANT_DETAIL_PAGE,
    /canSever=\{holdsSeatFor\(user, "org\.association\.sever"\)\}/,
    "the plant page must ask the capability table whether to render the sever"
  );
  assert.match(
    PLANT_DETAIL,
    /\{canSever && \(\s*<RemovePlantDialog/,
    "and the component must honour it"
  );
});

test("the association screen asks the SEAT as well as the tenancy (AC 7)", () => {
  // Every write behind `/settings/association` is Owner-only. It used to admit
  // on the sending-church FK alone, which was the same row while an org had one
  // account; with Members it would render accept, decline and leave to somebody
  // all three refuse.
  assert.match(
    ASSOCIATION_PAGE,
    /org\?\.type === "sending_church" && isOrgOwner\(user\)/,
    "a sending-church Member must be redirected, not served three refused controls"
  );
});

// ----------------------------------------------------------------------------
// 6. `/settings/team` AS AN ORG'S SCREEN (AC 5)
// ----------------------------------------------------------------------------

test("the invite form is the org's, with the org's own words (AC 5)", () => {
  for (const [what, tenancy] of ORG_TENANCIES) {
    const html = renderToStaticMarkup(
      createElement(SeatInviteForm, {
        expiryDays: 30,
        tenancyType: tenancy.type,
      })
    );

    // THE SEAT REACHES THE POST UNDER THE NAME THE ACTION PARSES, and it
    // defaults to the narrower of the two. The chooser itself is a Radix Select
    // whose items live in a portal, so they are not in static markup — WHAT the
    // words are is asserted off the source below, and that the table is total
    // is a compile error rather than a test.
    assert.ok(
      html.includes('name="seat" value="member"'),
      `${what}: the chosen seat must reach the request, defaulting to Member`
    );

    // AND THE FORM NAMES NO TENANCY. The org is the actor's own; a field here
    // would be a target a forged POST could re-aim (AC 2).
    for (const forbidden of [
      "sendingChurchId",
      "sendingNetworkId",
      "churchId",
    ]) {
      assert.ok(
        !html.includes(forbidden),
        `${what}: the form must not carry a ${forbidden} field`
      );
    }

    // The noun is the org's, so the form does not tell a network they are
    // staffing a church plant.
    assert.ok(
      html.includes(TENANCY_NOUN[tenancy.type]),
      `${what}: the copy must name the tenancy being staffed`
    );
    assert.ok(
      !html.includes("this church plant"),
      `${what}: the plant's copy must not reach an org`
    );
  }

  // THE SEAT DESCRIPTIONS ARE A TABLE AND NOT A TERNARY, on the same footing as
  // `INVITED_AS_COPY`: `seat-guard.test.ts` bans a hand-compared seat outside
  // the permissions module even where the branch is only copy, because a reader
  // cannot tell an authority rule from a noun by looking at it.
  const form = stripComments(
    read("components", "settings", "seat-invite-form.tsx")
  );

  assert.match(
    form,
    /satisfies Record<SeatTenancyType, Record<InvitableSeat, string>>/,
    "the chooser's copy must be total over both seats in all three tenancies"
  );
  assert.doesNotMatch(
    form,
    /seat\s*(?:===|!==)\s*["']/,
    "the invite form must not compare a seat by hand"
  );

  // …and an org's Admin line describes an ORG's Admin, not a plant's.
  assert.match(form, /Admin — can run the plant with you/);
  assert.match(form, /Admin — reads everything and can invite others/);
});

test("the roster renders for an org, and its removal promises the right cascade", () => {
  const rows = [
    {
      userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      name: "Ola Overseer",
      email: "ola@example.com",
      seat: "member" as const,
      joinedLabel: "Aug 1, 2026",
      isSelf: false,
    },
  ];
  const actions = {
    appoint: async () => ({ success: true }) as const,
    demote: async () => ({ success: true }) as const,
    remove: async () => ({ success: true }) as const,
  };

  const html = renderToStaticMarkup(
    createElement(SeatRoster, {
      rows,
      canManageSeats: true,
      tenancyType: "network",
      actions,
    })
  );

  assert.ok(html.includes("Ola Overseer"), "the org's roster lists its seats");
  const labels = namedButtons(html).map((el) => el.attrs["aria-label"]);
  assert.ok(
    labels.includes("Remove Ola Overseer from this network"),
    `the Owner's controls are addressed with the org's own noun; got ${JSON.stringify(labels)}`
  );

  // THE DIALOG MAY ONLY PROMISE WHAT THE BATCH DOES. An org's removal is the
  // sessions delete and the marker; the plant's task reassignment and leader
  // slot are not in that batch, so the copy must not name them.
  assert.ok(
    !html.includes("open tasks come to you"),
    "an org removal must not promise a plant's cascade"
  );
  assert.ok(
    !html.includes("people directory"),
    "an org has no people directory for a removal to preserve"
  );
});

test("the coach sections are the plant's alone, and absent for an org (AC 5)", () => {
  // ABSENT RATHER THAN EMPTY. `coach.assignment.manage` is `tenancy: "plant"`,
  // so an org cannot create a coach invitation and `listPlantCoaches` refuses
  // one outright — an empty "Coaches" card on a network would be a section that
  // can never fill.
  const page = TEAM_PAGE.code;

  assert.match(
    page,
    /const isPlant = tenancy\.type === "church";/,
    "the page must decide plant-only sections from the resolved tenancy"
  );
  assert.match(
    page,
    /\{isPlant && <CoachInviteForm/,
    "the coach invite form is plant-only"
  );
  assert.match(
    page,
    /\{isPlant && \(\s*<PlantCoachList/,
    "and so is the coach list"
  );
  assert.match(
    page,
    /isPlant \? listPlantCoaches\(seatActor\)\s*: Promise\.resolve\(\[\]\)/,
    "the coach read is not even issued for an org"
  );
  assert.match(
    page,
    /\{isPlant && coachRows\.length > 0 && \(/,
    "and neither is the coach invitation list"
  );

  // THE THREE SECTIONS AC 5 NAMES ARE NOT CONDITIONAL. An org gets the invite
  // form, the roster and the pending list on the same footing as a plant — so
  // none of them may sit behind `isPlant`.
  for (const section of ["SeatInviteForm", "SeatRoster"]) {
    assert.ok(
      !page.includes(`{isPlant && <${section}`),
      `${section} must render for every tenancy`
    );
    assert.match(
      page,
      new RegExp(`\\n\\s*<${section}`),
      `${section} must be rendered unconditionally`
    );
  }

  // The pending seat list is the FIRST `InvitationsList` and is unconditional;
  // only the second (the coach one) is plant-gated.
  assert.match(
    page,
    /\n\s*<InvitationsList\n\s*rows=\{seatRows\}/,
    "the pending seat list must render for every tenancy"
  );
});

// ----------------------------------------------------------------------------
// 7. AC 9 — a network's roster is the network's
// ----------------------------------------------------------------------------

test("a sending-church account cannot reach the network's roster page", () => {
  // The page's own rule, and it is a 404 rather than a redirect: this is the
  // one place where the ROUTE's existence is itself the disclosure. It is
  // seat-blind on purpose — a sending church's Owner and its Member are equally
  // not a network.
  assert.match(
    SENDING_CHURCHES_PAGE,
    /if \(org\.type !== "network"\) \{\s*notFound\(\);/,
    "only a network reaches the sending-church roster"
  );
});

test("a network Admin staffs the network, and a sending-church Admin staffs theirs", () => {
  // AC 9 at the authority layer: both hold the verb, and what separates them is
  // the tenancy their queries are scoped by — asserted in SQL above. Neither
  // can name the other's id, because neither surface has a field for one.
  assert.equal(holdsSeatFor(NETWORK_ADMIN, "seat.invitation.manage"), true);
  assert.equal(holdsSeatFor(SC_ADMIN, "seat.invitation.manage"), true);

  assert.deepEqual(tenancyOf(NETWORK_ADMIN), { type: "network", id: NETWORK });
  assert.deepEqual(tenancyOf(SC_ADMIN), {
    type: "sending_church",
    id: SENDING_CHURCH,
  });
});

// ----------------------------------------------------------------------------
// 8. AC 3 — no person record, anywhere on the org path
// ----------------------------------------------------------------------------

test("the org arm of the registration planner cannot write a persons row", () => {
  // The executed proof is in `./seat.test.ts` ("an org seat invitation grants
  // the ORG's FK and writes no person row"). This is the structural half: the
  // person link is reachable only from the church branch, so a future edit
  // cannot hoist it above the narrowing without this failing.
  const seatArm = sourceReader(ACCOUNT_ENTITIES, "account-entities.ts").span(
    "const tenancy = userInvitation.tenancy",
    "switch (accountType)"
  );

  assert.match(
    seatArm,
    /tenancy\.type === "church"\s*\?\s*accountPersonLinkStatements\(/,
    "the AS-013 link must sit behind the church narrowing"
  );
  assert.match(
    seatArm,
    /:\s*\[\],/,
    "and an org seat must plan an empty statement list"
  );
});

// ----------------------------------------------------------------------------
// 9. THE WORDS AN ORG INVITEE READS
// ----------------------------------------------------------------------------

test("the copy key is the PAIR, so an org seat is described as one", () => {
  assert.equal(
    invitedAsKey({ kind: "seat", seat: "member" }, "church"),
    "member"
  );
  assert.equal(
    invitedAsKey({ kind: "seat", seat: "member" }, "sending_church"),
    "org_member"
  );
  assert.equal(
    invitedAsKey({ kind: "seat", seat: "admin" }, "network"),
    "org_admin"
  );

  // THE TWO ORG KINDS SHARE THEIR COPY, deliberately: a sending church's Admin
  // and a network's Admin do the same things over a different portfolio, and
  // the org's own NAME is what tells the invitee which they are joining.
  assert.equal(
    invitedAsKey({ kind: "seat", seat: "admin" }, "sending_church"),
    invitedAsKey({ kind: "seat", seat: "admin" }, "network")
  );

  // An org Member's sentence states the limit rather than leaving it to be
  // discovered — the account has every read and no write.
  assert.match(INVITED_AS_COPY.org_member.accepting, /read-only/);
  assert.ok(
    !INVITED_AS_COPY.org_member.accepting.includes("plant's people"),
    "an org Member joins no plant's directory"
  );
});
