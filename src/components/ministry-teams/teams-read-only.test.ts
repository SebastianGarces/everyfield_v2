import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
// The two contexts `useRouter` and `useSearchParams` assert on. Several of
// these components refresh after an action, and outside a Next render
// `useRouter` throws "invariant expected app router to be mounted" before any
// assertion here runs — so the test mounts what the app mounts. The internal
// path is the only export of them; it is stable across the app-router releases
// and a rename fails loudly at import rather than quietly changing what is
// asserted.
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

import { ViewerCapabilitiesProvider } from "@/components/shared/viewer-capabilities";
import type { Capability } from "@/lib/auth/seat-rules";
import { namedButtons, parseElements } from "@/lib/testing/rendered-markup";

import { MeetingsTab } from "./meetings-tab";
import { MembersRolesTab } from "./members-roles-tab";
import { ResponsibilitiesTab } from "./responsibilities-tab";
import { TeamsDashboard } from "./teams-dashboard";
import { TrainingTab } from "./training-tab";

// ----------------------------------------------------------------------------
// MINISTRY TEAMS, AS A PLANT MEMBER SEES IT — AS-020 (#499).
//
// Row 8 of `@/lib/auth/read-only-surfaces`: the teams list, the members and
// roles tab, responsibilities, training and the team's own meetings. ONE verb
// governs all of it — `teams.write` — and the checklist's `governedBy` is where
// that comes from, not from anything decided here.
//
// THE ASSERTION IS AN ABSENCE, which is why every case renders the real
// component and reads the MARKUP. AS-020 says a write affordance a viewer may
// not use is HIDDEN, not disabled: a `disabled` button is still in the markup,
// still announced by a screen reader, and still tells a Member that a control
// exists which somebody else may press. A source scan for "Add Role" cannot
// tell those two apart; a markup scan can, and `noDisabledButtons` pins the
// disabled spelling specifically because it is the failure this issue exists to
// remove.
//
// EVERY CASE IS RENDERED TWICE. An over-hide is as much a drift as an
// under-hide, so each absence is paired with the same render holding
// `teams.write`, showing the control comes back. A gate that hid the control
// from everyone would pass the first half and fail the second.
//
// THE FRD'S THIRD EXCEPTION IS NOT TESTED HERE BECAUSE IT DOES NOT SHIP. "A
// team leader's writes on their own team stay" cannot be asked of any rendered
// surface: `ministry_teams.leader_id` references `persons.id`, a session names
// a `users.id`, and no column joins them until AS-013's registration link
// lands. `seat-rules.ts` records the server half of the same residual — every
// teams write sits at `teams.write` — so hiding all of them is what matches the
// server today.
//
// NONE OF THIS IS AUTHORIZATION. `requireSeat("teams.write")` refuses the POST
// that never rendered a button, and `seat-guard.test.ts` is what asserts that.
// A hidden control is a statement about what somebody is ASKED to do.
// ----------------------------------------------------------------------------

/** The read-only viewer: a plant Member, holding no teams verb. */
const MEMBER: readonly Capability[] = [];
/** The planter or an Admin — an ADMIN_PLUS seat (`seat-rules.ts`). */
const ADMIN: readonly Capability[] = ["teams.write"];

/**
 * A router that refuses every call. A STATIC render fires no handler, so
 * nothing here is ever reached — its job is to satisfy the mount invariant.
 * Throwing rather than no-op'ing means a render that DID navigate would say so
 * instead of passing silently.
 */
const STUB_ROUTER = new Proxy({} as never, {
  get() {
    return () => {
      throw new Error("a static render must not navigate");
    };
  },
});

function render(
  capabilities: readonly Capability[],
  element: ReactElement
): string {
  return renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: STUB_ROUTER },
      createElement(
        SearchParamsContext.Provider,
        { value: new URLSearchParams() },
        // `children` in the props bag, not as the third argument: the provider
        // declares it as a required prop, and `createElement`'s variadic
        // overload does not satisfy a required one.
        createElement(ViewerCapabilitiesProvider, {
          capabilities,
          children: element,
        })
      )
    )
  );
}

/** Both renders of one component, so a case reads as the pair it is. */
function bothWays(build: () => ReactElement): {
  member: string;
  admin: string;
} {
  return { member: render(MEMBER, build()), admin: render(ADMIN, build()) };
}

/** Every `<button>`'s accessible name, which is what identifies the verb. */
function controlLabels(html: string): string[] {
  return namedButtons(html).map((button) => button.attrs["aria-label"]);
}

/**
 * The markup with React's entities decoded, for reading COPY out of it.
 *
 * `renderToStaticMarkup` escapes an apostrophe to `&#x27;`, and every one of
 * the read-only sentences below is a possessive ("your plant's admins"). An
 * assertion written from the source string silently never matches without this.
 */
function copy(html: string): string {
  return html.replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
}

/**
 * THE SPELLING A "HIDDEN" CONTROL IS MOST OFTEN GOT WRONG AS.
 *
 * `disabled` still appears for a legitimate reason on an ADMIN's render — a
 * pending transition, an empty selection — so this is asserted on the MEMBER's
 * render only, where there is no such reason left.
 */
function noDisabledButtons(html: string, what: string): void {
  assert.doesNotMatch(
    html,
    /<button[^>]*\bdisabled\b/,
    `AS-020: ${what} must be ABSENT for a Member, not disabled — a disabled button still announces a control`
  );
}

// ----------------------------------------------------------------------------
// The teams list — create a team, and set the ten core teams up
// ----------------------------------------------------------------------------

const STAFFING = {
  totalTeams: 1,
  totalRoles: 2,
  filledRoles: 1,
  staffingPercentage: 50,
};

/**
 * The dashboard reads four columns off a team row; the fixture supplies those
 * and is widened once, here at the boundary of the test, rather than
 * reproducing every audit column a persisted team carries.
 */
function teamsDashboard(teams: unknown[]): ReactElement {
  return createElement(TeamsDashboard, {
    teams: teams as Parameters<typeof TeamsDashboard>[0]["teams"],
    staffingSummary: STAFFING,
  });
}

const ONE_TEAM = [
  {
    id: "team-1",
    name: "Worship",
    description: "Sunday music",
    type: "predefined",
    templateKey: "worship",
    filledRoles: 1,
    totalRoles: 2,
    leaderName: "Ada Lovelace",
  },
];

test("a Member is offered no way to create a team from the list", () => {
  const { member, admin } = bothWays(() => teamsDashboard(ONE_TEAM));

  assert.equal(
    member.includes("Create Custom Team"),
    false,
    "`createTeamAction` is teams.write, so the staffing banner's CTA must not render"
  );
  noDisabledButtons(member, "the staffing banner's create control");

  assert.ok(
    admin.includes("Create Custom Team"),
    "the same banner still offers it to somebody who may create a team — an over-hide is as much a drift as an under-hide"
  );
});

test("a Member still reads the roster and the staffing numbers", () => {
  const { member } = bothWays(() => teamsDashboard(ONE_TEAM));

  // The absence is of the CONTROLS, not of the information.
  for (const shown of ["Worship", "1 of 2 roles filled", "Org Chart"]) {
    assert.ok(
      member.includes(shown),
      `"${shown}" is a read every seat holds and stays on the page`
    );
  }
});

test("the empty teams list offers a Member neither setup control", () => {
  const { member, admin } = bothWays(() => teamsDashboard([]));

  for (const verb of ["Set Up Ministry Teams", "Create Custom Team"]) {
    assert.equal(
      member.includes(verb),
      false,
      `"${verb}" writes teams and must be absent from a Member's empty state`
    );
  }
  noDisabledButtons(member, "the empty state's controls");

  for (const verb of ["Set Up Ministry Teams", "Create Custom Team"]) {
    assert.ok(admin.includes(verb), `${verb} still renders for an Admin`);
  }
});

test("the empty teams list EXPLAINS to a Member instead of inviting them", () => {
  const { member, admin } = bothWays(() => teamsDashboard([]));

  // The FACT survives — it is what the Member came to find out.
  assert.ok(
    member.includes("No ministry teams yet"),
    "a Member still learns there are no teams"
  );
  // What changes is the sentence under it: who does the thing, not an
  // instruction the viewer cannot follow.
  assert.ok(
    copy(member).includes("admins set up the ministry teams"),
    "the read-only copy names who sets the teams up rather than asking the viewer to"
  );
  assert.equal(
    member.includes("Set up the 10 core ministry teams"),
    false,
    "the inviting copy belongs to the viewer who can act on it"
  );
  assert.ok(admin.includes("Set up the 10 core ministry teams"));
});

// ----------------------------------------------------------------------------
// Members & roles — the single choke point for five controls
// ----------------------------------------------------------------------------

const FILLED_ROLE = {
  id: "role-1",
  name: "Worship Leader",
  description: "Leads the set",
  isLeadershipRole: true,
  timeCommitment: "weekly",
  assignedPerson: {
    membershipId: "membership-1",
    id: "person-1",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    phone: null,
    backgroundCheckStatus: "not_required",
  },
};

const OPEN_ROLE = {
  id: "role-2",
  name: "Sound Engineer",
  description: null,
  isLeadershipRole: false,
  timeCommitment: null,
  assignedPerson: null,
};

/**
 * The tab reads a handful of columns off the team and its roles; the fixture
 * supplies those and is widened once at the test's boundary rather than
 * inventing every audit column a persisted team carries.
 */
function membersRoles(
  roles: unknown[] = [FILLED_ROLE, OPEN_ROLE]
): ReactElement {
  return createElement(MembersRolesTab, {
    team: {
      id: "team-1",
      // "Worship Team" EXACTLY, because `RoleTemplateImport` finds its template
      // by matching this name against the catalog and renders nothing when it
      // misses — a fixture named "Worship" would make the import control absent
      // for BOTH viewers and the positive half of the pair vacuous.
      name: "Worship Team",
      type: "predefined",
      templateKey: "worship",
      roles,
    } as unknown as Parameters<typeof MembersRolesTab>[0]["team"],
    people: [],
    teamCounts: {},
  });
}

test("a Member is offered no role control on the members and roles tab", () => {
  const { member, admin } = bothWays(() => membersRoles());

  // ADD and IMPORT — the two header controls.
  for (const verb of ["Add Role", "Import Templates"]) {
    assert.equal(
      member.includes(verb),
      false,
      `"${verb}" is teams.write and must be absent from a Member's markup`
    );
  }
  // EDIT and DELETE — the per-role pair behind the divider.
  assert.deepEqual(
    controlLabels(member),
    [],
    "no edit, no delete, and no per-person remove survives as a named control"
  );
  noDisabledButtons(member, "the roles tab's controls");

  for (const verb of ["Add Role", "Import Templates"]) {
    assert.ok(admin.includes(verb), `${verb} still renders for an Admin`);
  }
  assert.deepEqual(
    controlLabels(admin).sort(),
    [
      "Edit Sound Engineer",
      "Edit Worship Leader",
      "Remove Ada Lovelace from Worship Leader",
      "Remove the Sound Engineer role",
      "Remove the Worship Leader role",
    ].sort(),
    "all five come back with the verb — the gate is one question, not a blanket"
  );
});

test("a Member cannot assign anybody to an open role, which is how a leader is named", () => {
  const { member, admin } = bothWays(() => membersRoles());

  assert.equal(
    member.includes("Assign"),
    false,
    "`assignMemberAction` is teams.write; `assignTeamLeaderAction` has no UI caller at all, so a leader is named through THIS control plus the role form's leadership box — gating the two covers 'set leader'"
  );
  assert.ok(admin.includes("Assign"));
});

test("a Member still reads who holds which role, and which are open", () => {
  const { member } = bothWays(() => membersRoles());

  for (const shown of [
    "Worship Leader",
    "Ada Lovelace",
    "ada@example.com",
    "Leadership",
    "Filled",
    "Sound Engineer",
    "Open",
  ]) {
    assert.ok(
      member.includes(shown),
      `"${shown}" is the read this tab exists for and stays`
    );
  }
});

test("the roles empty state EXPLAINS to a Member instead of inviting them", () => {
  const { member, admin } = bothWays(() => membersRoles([]));

  assert.ok(member.includes("No roles defined"));
  assert.ok(
    copy(member).includes("admins define this team's roles"),
    "the read-only copy names who defines a role"
  );
  assert.equal(
    member.includes("Import role templates"),
    false,
    "the inviting copy belongs to the viewer who can act on it"
  );
  assert.ok(admin.includes("Import role templates"));
});

// ----------------------------------------------------------------------------
// Responsibilities — add, tick, edit, delete
// ----------------------------------------------------------------------------

function responsibilities(items: unknown[]): ReactElement {
  return createElement(ResponsibilitiesTab, {
    teamId: "team-1",
    responsibilities: items as Parameters<
      typeof ResponsibilitiesTab
    >[0]["responsibilities"],
  });
}

const CHECKLIST = [
  { id: "resp-1", title: "Book the sound desk", completedAt: null },
  {
    id: "resp-2",
    title: "Print the set list",
    completedAt: new Date("2026-03-01T12:00:00Z"),
  },
];

test("a Member cannot add, edit or delete a responsibility", () => {
  const { member, admin } = bothWays(() => responsibilities(CHECKLIST));

  assert.equal(
    member.includes("New responsibility"),
    false,
    "the add form is `createResponsibilityAction` — teams.write — and goes whole, field and button"
  );
  assert.deepEqual(
    controlLabels(member),
    [],
    "no per-row edit or delete control survives"
  );
  noDisabledButtons(member, "the responsibilities controls");

  assert.ok(admin.includes("New responsibility"));
  assert.deepEqual(
    controlLabels(admin).sort(),
    [
      "Delete Book the sound desk",
      "Delete Print the set list",
      "Edit Book the sound desk",
      "Edit Print the set list",
    ].sort(),
    "both rows keep both controls for somebody who may write"
  );
});

test("a Member cannot TICK a responsibility, but still reads which are done", () => {
  const { member, admin } = bothWays(() => responsibilities(CHECKLIST));

  assert.equal(
    /role="checkbox"/.test(member),
    false,
    "ticking is `setResponsibilityCompleteAction` — teams.write — so the box is not a control any more"
  );
  // THE STATE IS THE READ AND IT SURVIVES, in both halves: the strike-through
  // for a sighted reader, and a named marker for a screen reader that no longer
  // has a checkbox to hear it from.
  assert.ok(
    member.includes("line-through"),
    "the completed row still reads as completed"
  );
  assert.ok(
    member.includes('aria-label="Complete"'),
    "and the completion is still announced, without offering a control"
  );
  assert.ok(member.includes('aria-label="Not complete"'));
  assert.ok(member.includes("1 of 2 complete"), "the progress read stays");

  assert.ok(
    /role="checkbox"/.test(admin),
    "the box is still tickable by somebody who may write"
  );
});

test("the responsibilities empty state EXPLAINS instead of inviting", () => {
  const { member, admin } = bothWays(() => responsibilities([]));

  assert.ok(member.includes("No responsibilities yet"));
  assert.ok(copy(member).includes("admins record what this team owns"));
  assert.equal(
    member.includes("Add what this team owns"),
    false,
    "the inviting copy belongs to the viewer who can act on it"
  );
  assert.ok(admin.includes("Add what this team owns"));
});

// ----------------------------------------------------------------------------
// Training — the program dialog, and the mark-complete cell
// ----------------------------------------------------------------------------

const PROGRAMS = [{ id: "program-1", name: "Child Safety", isRequired: true }];
const MATRIX = [
  {
    personId: "person-1",
    personName: "Ada Lovelace",
    completions: { "program-1": false },
  },
];

function training(programs: unknown[], matrix: unknown[]): ReactElement {
  return createElement(TrainingTab, {
    teamId: "team-1",
    programs: programs as Parameters<typeof TrainingTab>[0]["programs"],
    matrix: matrix as Parameters<typeof TrainingTab>[0]["matrix"],
  });
}

test("a Member is offered no Add Program control", () => {
  const { member, admin } = bothWays(() => training(PROGRAMS, MATRIX));

  assert.equal(
    member.includes("Add Program"),
    false,
    "`createTrainingProgramAction` is teams.write"
  );
  assert.ok(admin.includes("Add Program"));
});

test("a Member reads the training matrix but marks nothing complete", () => {
  const { member, admin } = bothWays(() => training(PROGRAMS, MATRIX));

  // The GRID is the read — who has completed what — and it survives whole.
  for (const shown of ["Child Safety", "Required", "Ada Lovelace"]) {
    assert.ok(member.includes(shown), `"${shown}" is the read and stays`);
  }

  // The interactive host injects its button through `incompleteCell`;
  // withholding it is the grid's own documented read-only render, so the cell
  // keeps its marker and loses the button around it.
  assert.equal(
    member.includes("Mark as complete"),
    false,
    "the mark-complete cell is `markTrainingCompleteAction` — teams.write"
  );
  assert.equal(
    /<button/.test(member),
    false,
    "and it was the only button in the grid"
  );

  assert.ok(
    controlLabels(admin).includes(
      "Mark Ada Lovelace as complete for Child Safety"
    ),
    "the cell names the member and program for somebody who may record training"
  );
});

test("the training matrix names its headers, completion states, and write controls", () => {
  const mixedMatrix = [
    ...MATRIX,
    {
      personId: "person-2",
      personName: "Grace Hopper",
      completions: { "program-1": true },
    },
  ];
  const { member, admin } = bothWays(() => training(PROGRAMS, mixedMatrix));
  const headers = parseElements(member).filter(
    (element) => element.tag === "th"
  );

  assert.deepEqual(
    headers.map((header) => header.attrs.scope),
    ["col", "col", "row", "row"],
    "the first row supplies column headers and each person supplies a row header"
  );
  assert.match(member, /class="sr-only">Not complete<\/span>/);
  assert.match(member, /class="sr-only">Complete<\/span>/);
  assert.ok(
    controlLabels(admin).includes(
      "Mark Ada Lovelace as complete for Child Safety"
    ),
    "the mark-complete control names the exact member and training program"
  );
});

test("the training empty state EXPLAINS instead of inviting", () => {
  const { member, admin } = bothWays(() => training([], []));

  assert.ok(member.includes("No training programs"));
  assert.ok(
    copy(member).includes("admins set up this team's training programs")
  );
  assert.equal(
    member.includes("Add training programs to track completion"),
    false,
    "the inviting copy belongs to the viewer who can act on it"
  );
  assert.ok(admin.includes("Add training programs to track completion"));
});

// ----------------------------------------------------------------------------
// The team's meetings — teams.write, NOT meetings.write
// ----------------------------------------------------------------------------

function teamMeetings(meetings: unknown[]): ReactElement {
  return createElement(MeetingsTab, {
    teamId: "team-1",
    meetings: meetings as Parameters<typeof MeetingsTab>[0]["meetings"],
  });
}

const TEAM_MEETING = [
  {
    id: "meeting-1",
    title: "Rehearsal",
    datetime: new Date("2026-03-10T23:00:00Z"),
    durationMinutes: 60,
    locationName: "Room 201",
    meetingSubtype: "rehearsal",
  },
];

test("a Member cannot schedule a team meeting", () => {
  const { member, admin } = bothWays(() => teamMeetings(TEAM_MEETING));

  assert.equal(
    member.includes("Schedule Meeting"),
    false,
    "this dialog posts to `createMeetingAction` in the TEAMS actions file, so the verb is teams.write — the control asks for what the server will refuse it with, not for what the noun suggests"
  );
  noDisabledButtons(member, "the schedule-a-meeting dialog");

  // The meeting itself is the read.
  assert.ok(member.includes("Rehearsal"), "the meeting card stays");

  assert.ok(admin.includes("Schedule Meeting"));
});

test("the team meetings empty state EXPLAINS instead of inviting", () => {
  const { member, admin } = bothWays(() => teamMeetings([]));

  assert.ok(member.includes("No meetings scheduled"));
  assert.ok(copy(member).includes("admins schedule this team's meetings"));
  assert.equal(
    member.includes("Schedule team meetings to coordinate"),
    false,
    "the inviting copy belongs to the viewer who can act on it"
  );
  assert.ok(admin.includes("Schedule team meetings to coordinate"));
});
