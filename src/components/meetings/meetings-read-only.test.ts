import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
// The two contexts `useRouter` and `useSearchParams` assert on. Two of these
// components navigate, and outside a Next render `useRouter` throws "invariant
// expected app router to be mounted" before any assertion here runs — so the
// test mounts what the app mounts. The internal path is the only export of
// them; it is stable across the app-router releases and a rename fails loudly
// at import rather than quietly changing what is asserted.
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

import { MeetingDetails } from "@/app/(dashboard)/meetings/[id]/meeting-details-client";
import { ViewerCapabilitiesProvider } from "@/components/shared/viewer-capabilities";
import type { Capability } from "@/lib/auth/seat-rules";
import { namedButtons, parseElements } from "@/lib/testing/rendered-markup";

import { AgendaBuilder } from "./agenda-builder";
import { AttendanceCapture } from "./attendance-capture";
import { EvaluationForm } from "./evaluation-form";
import { GuestList } from "./guest-list";
import { MaterialsChecklist } from "./materials-checklist";
import { MeetingList } from "./meeting-list";

// ----------------------------------------------------------------------------
// THE MEETINGS SURFACE, AS A PLANT MEMBER SEES IT — AS-020 (#499).
//
// Row 5 and row 6 of `@/lib/auth/read-only-surfaces`: the meetings list, the
// meeting detail, and the attendance / evaluation / invitations / logistics
// tabs. One verb governs all of it — `meetings.write` — and the checklist's own
// `governedBy` is where that comes from, not from anything decided here.
//
// THE ASSERTION IS AN ABSENCE, which is why every one of these renders the real
// component and reads the MARKUP. AS-020 says a write affordance a viewer may
// not use is HIDDEN, not disabled: a `disabled` button is still in the markup,
// still announced by a screen reader, and still tells a Member that a control
// exists which somebody else may press. A source scan for "Finalize" cannot
// tell those two apart; a markup scan can, and `noDisabledButtons` below pins
// the disabled spelling specifically because it is the failure this issue
// exists to remove.
//
// EVERY CASE IS RENDERED TWICE. An over-hide is as much a drift as an
// under-hide, so each absence is paired with the same render under
// `["meetings.write"]` showing the control comes back. A gate that hid the
// control from everyone would pass the first half and fail the second.
//
// NONE OF THIS IS AUTHORIZATION. `requireSeat("meetings.write")` refuses the
// POST that never rendered a button, and `seat-guard.test.ts` is what asserts
// that. A hidden control is a statement about what somebody is ASKED to do.
//
// THE RSVP, WHICH IS THE ONE TRAP HERE. The toggle on the guest list is staff
// recording somebody ELSE's answer — `updateRsvpStatusAction` is
// `meetings.write` — so it hides with the rest, and the badge it wrapped stays
// as the read it always was. A Member's OWN RSVP is not on this surface at all:
// it is answered from the emailed link at `/rsvp/[token]`, a page outside
// `(dashboard)` authorised by the token, holding no session and no seat check.
// Nothing in this file touches it.
// ----------------------------------------------------------------------------

/** The read-only viewer: a plant Member, holding no meetings verb. */
const MEMBER: readonly Capability[] = [];
/**
 * The planter or an Admin. BOTH verbs, because an ADMIN_PLUS seat holds both
 * (`seat-rules.ts`) and the guest list's "Send Email" control leaves for
 * `/communication/compose`, so it is gated on the verb IT invokes rather than
 * on this card's own.
 */
const ADMIN: readonly Capability[] = ["meetings.write", "communication.send"];

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
        // `children` in the props bag, not as the third argument: the
        // provider declares it as a required prop, and `createElement`'s
        // variadic overload does not satisfy a required one.
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
  return {
    member: render(MEMBER, build()),
    admin: render(ADMIN, build()),
  };
}

/** Every `<button>`'s accessible name, which is what identifies the verb. */
function controlLabels(html: string): string[] {
  return namedButtons(html).map((button) => button.attrs["aria-label"]);
}

/**
 * THE SPELLING A "HIDDEN" CONTROL IS MOST OFTEN GOT WRONG AS.
 *
 * `disabled` still appears for a legitimate reason on an ADMIN's render — a
 * pending transition, an empty form — so this is asserted on the MEMBER's
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
// Row 5 — the meetings list
// ----------------------------------------------------------------------------

const NO_MEETINGS = {
  upcomingMeetings: [],
  pastMeetings: [],
  hasMeetingHistory: false,
  initialView: "upcoming" as const,
  timeZone: "America/New_York",
  now: new Date("2026-03-01T12:00:00Z"),
};

const FOUR_PAST_MEETINGS = Array.from(
  { length: 4 },
  () => ({}) as Parameters<typeof MeetingList>[0]["pastMeetings"][number]
);

const UPCOMING_MEETING = {
  id: "meeting-1",
  title: "Vision Night",
  type: "vision_meeting" as const,
  status: "planning" as const,
  datetime: new Date("2026-03-10T23:00:00Z"),
  meetingNumber: 1,
  locationName: null,
  location: null,
  teamName: null,
  actualAttendance: null,
  estimatedAttendance: null,
  newAttendees: 0,
} as Parameters<typeof MeetingList>[0]["upcomingMeetings"][number];

test("four completed meetings with no upcoming result do not render a first-meeting empty state", () => {
  const { member, admin } = bothWays(() =>
    createElement(MeetingList, {
      ...NO_MEETINGS,
      pastMeetings: FOUR_PAST_MEETINGS,
      hasMeetingHistory: true,
    })
  );

  for (const html of [member, admin]) {
    assert.ok(html.includes("No upcoming meetings scheduled."));
    assert.equal(html.includes("No meetings yet"), false);
    assert.equal(html.includes("Schedule your first meeting"), false);
  }
});

test("the history signal survives the page omitting the non-selected result bucket", () => {
  // On the Upcoming view, the page avoids loading past rows. History is a
  // separate fact so that optimization cannot turn this into "first meeting".
  const html = render(
    ADMIN,
    createElement(MeetingList, {
      ...NO_MEETINGS,
      hasMeetingHistory: true,
    })
  );

  assert.ok(html.includes("No upcoming meetings scheduled."));
  assert.equal(html.includes("No meetings yet"), false);
  assert.equal(html.includes("Schedule your first meeting"), false);
});

test("a visible meeting wins over a stale false history signal", () => {
  const html = render(
    ADMIN,
    createElement(MeetingList, {
      ...NO_MEETINGS,
      upcomingMeetings: [UPCOMING_MEETING],
    })
  );

  assert.equal(html.includes("No meetings yet"), false);
  assert.ok(html.includes('href="/meetings/meeting-1"'));
});

test("the meetings empty state offers no create CTA to a Member", () => {
  const { member, admin } = bothWays(() =>
    createElement(MeetingList, NO_MEETINGS)
  );

  assert.equal(
    member.includes("/meetings/new"),
    false,
    "the empty state's Schedule Meeting link is a write affordance and must not render"
  );
  assert.equal(
    member.includes("Schedule Meeting"),
    false,
    "and the verb must not survive as text either"
  );

  assert.ok(
    admin.includes("/meetings/new"),
    "the same empty state still offers the CTA to somebody who may schedule — an over-hide is as much a drift as an under-hide"
  );
});

test("the empty state EXPLAINS to a Member instead of inviting them", () => {
  const { member, admin } = bothWays(() =>
    createElement(MeetingList, NO_MEETINGS)
  );

  // The FACT survives — it is what the Member came to find out.
  assert.ok(
    member.includes("No meetings yet"),
    "a Member still learns there are no meetings"
  );
  // What changes is the sentence under it: who does the thing, not an
  // instruction the viewer cannot follow.
  assert.ok(
    member.includes("admins schedule meetings"),
    "the read-only copy names who schedules a meeting rather than asking the viewer to"
  );
  assert.equal(
    member.includes("Schedule your first meeting"),
    false,
    "the inviting copy belongs to the viewer who can act on it"
  );
  assert.ok(admin.includes("Schedule your first meeting"));
});

// ----------------------------------------------------------------------------
// Row 6 — the meeting detail's own actions bar
// ----------------------------------------------------------------------------

const MEETING = {
  id: "meeting-1",
  churchId: "church-1",
  title: "Vision Night",
  type: "vision_meeting" as const,
  status: "planning" as const,
  datetime: new Date("2026-03-10T23:00:00Z"),
  meetingNumber: 1,
};

function meetingDetails(): ReactElement {
  // The component reads a handful of columns off the row; the fixture supplies
  // those and is cast at the boundary of the test rather than reproducing every
  // audit column a persisted meeting carries.
  return createElement(MeetingDetails, {
    meeting: MEETING as unknown as Parameters<
      typeof MeetingDetails
    >[0]["meeting"],
    locations: [],
  });
}

test("a Member is offered no edit, delete or status transition on a meeting", () => {
  const { member, admin } = bothWays(meetingDetails);

  for (const verb of ["Edit", "Delete", "Mark as Ready"]) {
    assert.equal(
      member.includes(verb),
      false,
      `AS-020: "${verb}" is a meetings.write control and must be absent from a Member's markup`
    );
  }
  noDisabledButtons(member, "the meeting's actions bar");

  for (const verb of ["Edit", "Delete", "Mark as Ready"]) {
    assert.ok(admin.includes(verb), `${verb} still renders for an Admin`);
  }
});

test("a Member still READS the meeting — it is the controls that go", () => {
  const { member } = bothWays(meetingDetails);

  for (const card of ["Location", "Attendance"]) {
    assert.ok(
      member.includes(card),
      `the ${card} summary card is the read and it stays; the absence is of the actions bar`
    );
  }
});

// ----------------------------------------------------------------------------
// Row 6 — the guest list, and the RSVP trap
// ----------------------------------------------------------------------------

const GUESTS = [
  {
    id: "guest-1",
    personId: "person-1",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    phone: null,
    attendanceStatus: "invited",
    responseStatus: "confirmed",
  },
];

function guestList(): ReactElement {
  return createElement(GuestList, { meetingId: "meeting-1", guests: GUESTS });
}

test("guest-list actions stack under the heading before the small breakpoint", () => {
  const { admin } = bothWays(guestList);

  assert.match(
    admin,
    /class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"/,
    "the heading must occupy its own row below 640px, where three actions do not fit beside it"
  );
  assert.match(
    admin,
    /class="flex flex-wrap items-center gap-2"/,
    "the action group must wrap instead of clipping when all three actions are available"
  );
  assert.ok(
    admin.indexOf("Send Email (1)") < admin.indexOf("Quick Add Person") &&
      admin.indexOf("Quick Add Person") < admin.indexOf("Add Existing"),
    "responsive layout preserves the existing action order and recipient count"
  );
});

test("a Member cannot toggle somebody else's RSVP from the guest list", () => {
  const { member, admin } = bothWays(guestList);

  assert.equal(
    controlLabels(member).some((label) => label.startsWith("Change RSVP")),
    false,
    "the RSVP toggle is `updateRsvpStatusAction` — meetings.write — and is staff recording somebody ELSE's answer, so it hides with the rest"
  );
  assert.ok(
    controlLabels(admin).includes("Change RSVP for Ada Lovelace"),
    "an Admin still records a guest's answer"
  );
});

test("the RSVP BADGE survives — hiding the toggle must not hide the read", () => {
  const { member } = bothWays(guestList);

  assert.ok(
    member.includes("Confirmed"),
    "who has confirmed is a read every seat holds; only the control around it is the write"
  );
});

test("a Member is offered no invitation, add or remove control on the guest list", () => {
  const { member, admin } = bothWays(guestList);

  for (const verb of [
    "Send Email",
    "Quick Add Person",
    "Add Existing",
    "Actions",
  ]) {
    assert.equal(
      member.includes(verb),
      false,
      `"${verb}" must be absent for a Member — and "Actions" with it, because a column header over nothing announces a set of controls that is not there`
    );
  }
  assert.equal(
    controlLabels(member).some((label) => label.startsWith("Remove ")),
    false,
    "no per-row remove control"
  );
  noDisabledButtons(member, "the guest list's controls");

  for (const verb of ["Send Email", "Quick Add Person", "Add Existing"]) {
    assert.ok(admin.includes(verb), `${verb} still renders for an Admin`);
  }
  assert.ok(
    controlLabels(admin).includes("Remove Ada Lovelace from the guest list"),
    "and the per-row remove comes back with the verb"
  );
});

// ----------------------------------------------------------------------------
// Row 6 — attendance capture
// ----------------------------------------------------------------------------

function attendance(): ReactElement {
  return createElement(AttendanceCapture, {
    meetingId: "meeting-1",
    guests: [{ ...GUESTS[0], attendanceStatus: "attended" }],
    summary: { total: 1, firstTime: 1, returning: 0, coreGroup: 0 },
    showResponseCards: true,
    responseCards: { "person-1": "ready_commit" as const },
  });
}

test("attendance actions and finalization stack without changing the register gate", () => {
  const { admin, member } = bothWays(attendance);

  assert.equal(
    (
      admin.match(
        /class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"/g
      ) ?? []
    ).length,
    2,
    "both the walk-in controls and the attended-count/finalize row stack below 640px"
  );
  assert.match(admin, /class="flex flex-wrap items-center gap-2"/);
  assert.ok(
    admin.indexOf("Quick Add Person") < admin.indexOf("Add Existing"),
    "the walk-in actions keep their current order"
  );
  assert.match(admin, /Finalize Attendance[^]*?\(1\)/);
  assert.equal(
    member.includes("Finalize Attendance"),
    false,
    "the responsive wrapper does not expose the write-only finalization action"
  );
});

test("a Member is offered no Finalize Attendance control", () => {
  const { member, admin } = bothWays(attendance);

  assert.equal(
    member.includes("Finalize Attendance"),
    false,
    "finalizing writes the register and mints follow-up tasks — meetings.write"
  );
  assert.ok(admin.includes("Finalize Attendance"));
});

test("a Member cannot tick the register, add a walk-in or quick-add a person", () => {
  const { member, admin } = bothWays(attendance);

  assert.equal(
    parseElements(member).some((el) => el.attrs["role"] === "checkbox"),
    false,
    "the attendance checkbox is the register's own write"
  );
  for (const verb of ["Add Walk-in", "Quick Add Person", "Add Existing"]) {
    assert.equal(
      member.includes(verb),
      false,
      `"${verb}" must be absent for a Member`
    );
  }
  assert.equal(
    member.includes(">Here<"),
    false,
    "the Here column goes with the checkbox in it"
  );
  noDisabledButtons(member, "the attendance controls");

  assert.ok(
    parseElements(admin).some((el) => el.attrs["role"] === "checkbox"),
    "the register is still tickable by somebody who may capture attendance"
  );
  assert.ok(admin.includes("Add Walk-in"));
});

test("a Member reads the response card but is offered no picker to change it", () => {
  const { member, admin } = bothWays(attendance);

  assert.equal(
    controlLabels(member).some((label) =>
      label.startsWith("Response card for")
    ),
    false,
    "recording an outcome is `recordResponseCardAction` — meetings.write"
  );
  // VM-014's read survives: what was handed in is still on the row.
  assert.ok(
    member.includes("Ready to commit"),
    "the recorded card is a read and stays; only the Select around it goes"
  );
  assert.ok(
    controlLabels(admin).includes("Response card for Ada Lovelace"),
    "the picker comes back with the verb"
  );
});

// ----------------------------------------------------------------------------
// Row 6 — evaluation, logistics, agenda
// ----------------------------------------------------------------------------

test("a Member is offered no evaluation to submit", () => {
  const { member, admin } = bothWays(() =>
    createElement(EvaluationForm, {
      meetingId: "meeting-1",
      title: "Vision Night",
    })
  );

  assert.equal(
    member.includes("Save Evaluation"),
    false,
    "submitting an evaluation is meetings.write"
  );
  assert.equal(
    /<form\b/.test(member),
    false,
    "and the whole form goes with it — the page renders this component only when there is no evaluation to read"
  );
  assert.ok(
    member.includes("has not been evaluated yet"),
    "the read-only render states the fact instead"
  );

  assert.ok(admin.includes("Save Evaluation"));
});

test("a Member reads the logistics checklist but ticks nothing", () => {
  const items = [
    {
      id: "item-1",
      itemName: "Chairs",
      category: "setup" as const,
      isChecked: true,
    },
  ];
  const { member, admin } = bothWays(() =>
    createElement(MaterialsChecklist, {
      // The host takes the persisted row; the VIEW's narrower
      // `MaterialsChecklistItemView` is what it actually reads, so the fixture
      // supplies those four fields and is widened once, here at the boundary,
      // rather than inventing audit columns nothing renders.
      items: items as unknown as Parameters<
        typeof MaterialsChecklist
      >[0]["items"],
      summary: { total: 1, checked: 1 },
    })
  );

  // The state is the read — what is ready and what is not — and it survives.
  assert.ok(member.includes("Chairs"));
  assert.ok(member.includes("1/1"));

  // The interactive host injects its checkbox through `renderControl`; omitting
  // it is the view's own documented read-only render, so the toggle wiring is
  // what disappears rather than the row.
  assert.equal(
    /onCheckedChange/.test(member),
    false,
    "no toggle handler reaches a Member's markup"
  );
  assert.ok(admin.includes("Chairs"));
});

test("a Member reads the agenda and edits none of it", () => {
  const sections = [{ id: "section-1", title: "Welcome", minutes: 10 }];
  const { member, admin } = bothWays(() =>
    createElement(AgendaBuilder, {
      meetingId: "meeting-1",
      sections,
      saveAction: async () => ({ success: true as const, sections }),
    })
  );

  // The running order is the read.
  assert.ok(member.includes("Welcome"));
  assert.ok(member.includes("10"));

  // Every way out of this card lands on `saveAgendaAction`.
  assert.equal(
    /<input\b/.test(member),
    false,
    "the name and length fields are edits, so a Member gets the values as text"
  );
  assert.equal(
    member.includes("Add section"),
    false,
    "and the add-a-section form goes with them"
  );
  assert.equal(
    controlLabels(member).length,
    0,
    "no move-up, move-down or remove control survives"
  );
  noDisabledButtons(member, "the agenda controls");

  assert.ok(admin.includes("Add section"));
  assert.deepEqual(
    controlLabels(admin).sort(),
    ["Move Welcome down", "Move Welcome up", "Remove Welcome"],
    "an Admin still reorders and removes"
  );
});
