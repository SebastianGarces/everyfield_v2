import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ViewerCapabilitiesProvider } from "@/components/shared/viewer-capabilities";

import {
  AttendanceCapture,
  attendanceCheckboxLabel,
  finalizeOutcomeMessage,
  guestFullName,
} from "./attendance-capture";

// ----------------------------------------------------------------------------
// Issue #159: the attendance row's Radix Checkbox renders as
// `<button role="checkbox">` with no text inside it, so it had no accessible
// name — Lighthouse's `button-name` audit flagged it and a screen-reader user
// could not tell whose attendance they were toggling.
//
// `renderToStaticMarkup` gives us the exact markup the browser receives, so
// reading the attributes off that markup is a real assertion about the rendered
// control — the same approach as `src/components/ui/progress.test.ts`, no jsdom
// needed for a contract that is entirely attributes.
// ----------------------------------------------------------------------------

interface RenderedElement {
  tag: string;
  attrs: Record<string, string>;
}

function parseElements(html: string): RenderedElement[] {
  const elements: RenderedElement[] = [];
  const tagPattern = /<([a-zA-Z][\w-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*\/?>/g;
  const attrPattern = /([\w:.-]+)="([^"]*)"/g;

  for (const match of html.matchAll(tagPattern)) {
    const attrs: Record<string, string> = {};
    for (const attr of (match[2] ?? "").matchAll(attrPattern)) {
      attrs[attr[1]] = attr[2];
    }
    elements.push({ tag: match[1], attrs });
  }

  return elements;
}

/** Every checkbox control in the markup, in document order. */
function checkboxes(html: string): RenderedElement[] {
  return parseElements(html).filter((el) => el.attrs["role"] === "checkbox");
}

type Guest = Parameters<typeof AttendanceCapture>[0]["guests"][number];

function guest(overrides: Partial<Guest> & { id: string }): Guest {
  return {
    personId: `person-${overrides.id}`,
    firstName: "Ada",
    lastName: "Lovelace",
    email: null,
    phone: null,
    attendanceStatus: "invited",
    responseStatus: null,
    ...overrides,
  };
}

/**
 * The PLANTER's render — every assertion in this file is about the controls a
 * viewer who may capture attendance is offered.
 *
 * The provider is not decoration since #499: `useCan` fails closed with none,
 * so an unwrapped render is now the read-only screen and every checkbox
 * assertion below would be asserting the absence it is meant to prove present.
 * What a Member sees instead is `meetings-read-only.test.ts`, next door.
 */
function renderCapture(guests: Guest[], finalized = false): string {
  return renderToStaticMarkup(
    createElement(ViewerCapabilitiesProvider, {
      capabilities: ["meetings.write"],
      children: createElement(AttendanceCapture, {
        meetingId: "meeting-1",
        guests,
        summary: {
          total: guests.length,
          firstTime: 0,
          returning: 0,
          coreGroup: 0,
        },
        finalized,
      }),
    })
  );
}

// ----------------------------------------------------------------------------
// The fix
// ----------------------------------------------------------------------------

test("each attendance checkbox is named after its own guest", () => {
  const html = renderCapture([
    guest({ id: "1", firstName: "Ada", lastName: "Lovelace" }),
    guest({
      id: "2",
      firstName: "Grace",
      lastName: "Hopper",
      attendanceStatus: "attended",
    }),
  ]);

  const boxes = checkboxes(html);
  assert.equal(boxes.length, 2);

  // The bug was a control with no accessible name at all.
  for (const box of boxes) {
    assert.ok(
      box.attrs["aria-label"],
      `expected an aria-label on the attendance checkbox, got: ${JSON.stringify(box.attrs)}`
    );
  }

  assert.equal(boxes[0].attrs["aria-label"], "Mark Ada Lovelace as attended");
  assert.equal(boxes[1].attrs["aria-label"], "Mark Grace Hopper as attended");

  // Two rows must not share one name — that is the whole point of naming them.
  assert.notEqual(boxes[0].attrs["aria-label"], boxes[1].attrs["aria-label"]);
});

test("the accessible name contains the guest's name, and the state stays in aria-checked", () => {
  const html = renderCapture([
    guest({
      id: "1",
      firstName: "Grace",
      lastName: "Hopper",
      attendanceStatus: "attended",
    }),
    guest({ id: "2", firstName: "Alan", lastName: "Turing" }),
  ]);

  const [attended, notAttended] = checkboxes(html);

  assert.ok(attended.attrs["aria-label"].includes("Grace Hopper"));
  assert.ok(notAttended.attrs["aria-label"].includes("Alan Turing"));

  // The name must not flip with the state — a control whose name changes reads
  // as a different control. `aria-checked` carries the state instead.
  assert.equal(attended.attrs["aria-checked"], "true");
  assert.equal(notAttended.attrs["aria-checked"], "false");
  assert.equal(attended.attrs["aria-label"], "Mark Grace Hopper as attended");
});

test("the checkbox is a real control and keeps its toggle wiring", () => {
  const html = renderCapture([guest({ id: "1" })]);
  const [box] = checkboxes(html);

  assert.equal(box.tag, "button");
  assert.equal(box.attrs["disabled"], undefined);
});

// ----------------------------------------------------------------------------
// Name assembly — a quick-added walk-in can arrive with a blank last name.
// ----------------------------------------------------------------------------

test("a guest with no last name gets a clean name, on screen and in the label", () => {
  assert.equal(guestFullName({ firstName: "Ada", lastName: "" }), "Ada");
  assert.equal(guestFullName({ firstName: "Ada", lastName: "  " }), "Ada");
  assert.equal(
    guestFullName({ firstName: "Ada", lastName: "Lovelace" }),
    "Ada Lovelace"
  );

  const html = renderCapture([
    guest({ id: "1", firstName: "Ada", lastName: "" }),
  ]);
  assert.equal(checkboxes(html)[0].attrs["aria-label"], "Mark Ada as attended");
});

test("a nameless guest still leaves the control with an accessible name", () => {
  // Never fall back to an empty label: an unnamed button is the bug itself.
  assert.equal(attendanceCheckboxLabel(""), "Mark this guest as attended");
  assert.equal(attendanceCheckboxLabel("   "), "Mark this guest as attended");
});

test("no guests means no unnamed controls sneak in through the empty state", () => {
  const html = renderCapture([]);

  assert.equal(checkboxes(html).length, 0);
  assert.ok(html.includes("No guests on the list yet"));
});

// ----------------------------------------------------------------------------
// Issue #361: the guest list was a grid of divs with a "Table header" comment,
// so "Here", "RSVP" and "Status" were headers only to someone who could see
// which column a cell sat under. A screen reader announced a bare badge with no
// idea what it measured. Real table semantics are what associate the two.
// ----------------------------------------------------------------------------

interface RenderedCell {
  tag: string;
  attrs: Record<string, string>;
  text: string;
}

/** Every `<th>` / `<td>` in the markup, in document order, with its text. */
function cells(html: string): RenderedCell[] {
  const cellPattern = /<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/g;
  const attrPattern = /([\w:.-]+)="([^"]*)"/g;

  return [...html.matchAll(cellPattern)].map((match) => {
    const attrs: Record<string, string> = {};
    for (const attr of (match[2] ?? "").matchAll(attrPattern)) {
      attrs[attr[1]] = attr[2];
    }
    // Drop nested markup (badges, icons) — only the cell's own words matter.
    const text = (match[3] ?? "").replace(/<[^>]*>/g, "").trim();
    return { tag: match[1], attrs, text };
  });
}

test("the guest list is a real table, and every column header is a th[scope=col]", () => {
  const html = renderCapture([guest({ id: "1" })]);

  assert.ok(/<table\b/.test(html), "the guest list must be a <table>");
  assert.ok(/<thead\b/.test(html), "the column headers must live in a <thead>");

  const columnHeaders = cells(html).filter(
    (cell) => cell.tag === "th" && cell.attrs["scope"] === "col"
  );

  assert.deepEqual(
    columnHeaders.map((cell) => cell.text),
    ["Here", "Name", "Contact", "RSVP", "Status"],
    "all five columns must be scoped headers — a cell is only meaningful when it is announced with its header"
  );
});

test("each guest row carries the person's name as its row header", () => {
  const html = renderCapture([
    guest({ id: "1", firstName: "Ada", lastName: "Lovelace" }),
    guest({ id: "2", firstName: "Grace", lastName: "Hopper" }),
  ]);

  const rowHeaders = cells(html).filter(
    (cell) => cell.tag === "th" && cell.attrs["scope"] === "row"
  );

  // Without this, "Confirmed" read on its own never says whose RSVP it is.
  assert.deepEqual(
    rowHeaders.map((cell) => cell.text),
    ["Ada Lovelace", "Grace Hopper"]
  );
});

test("a row's cells stay in the order its headers promise", () => {
  const html = renderCapture([
    guest({
      id: "1",
      firstName: "Grace",
      lastName: "Hopper",
      email: "grace@example.com",
      responseStatus: "confirmed",
      attendanceStatus: "attended",
    }),
  ]);

  // Everything after the five column headers is the single guest row: the
  // checkbox cell, the name row-header, then contact / RSVP / status.
  const row = cells(html).filter((cell) => cell.attrs["scope"] !== "col");

  assert.equal(row.length, 5);
  assert.equal(row[1].text, "Grace Hopper");
  assert.equal(row[2].text, "grace@example.com");
  assert.equal(row[3].text, "Confirmed");
  assert.equal(row[4].text, "Attended");
});

test("the running attendance total is announced, not just repainted", () => {
  const html = renderCapture([
    guest({ id: "1", attendanceStatus: "attended" }),
    guest({ id: "2" }),
  ]);

  const region = /<p([^>]*\brole="status"[^>]*)>([\s\S]*?)<\/p>/.exec(html);
  assert.ok(region, "the attendance total must sit in a live region");
  assert.match(region[1], /aria-live="polite"/);
  assert.equal(
    region[2]
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim(),
    "1 of 2 marked as attended"
  );
});

// ----------------------------------------------------------------------------
// #323 WS3 (from #158) — the button used to say "Finalize Attendance" forever,
// and reported the same silent success whatever the press actually did. A
// planter who finalized Ann and Bob, spotted Cy, added him and pressed again got
// a success and — before this issue — no follow-up task for Cy. Two things had
// to change: the control has to say which job it is doing, and the outcome has
// to say which job it did.
// ----------------------------------------------------------------------------

test("before a finalize the control offers to finalize", () => {
  const html = renderCapture([
    guest({ id: "1", attendanceStatus: "attended" }),
  ]);

  assert.ok(html.includes("Finalize Attendance"));
  assert.equal(html.includes("Update Attendance"), false);
});

test("after a finalize the control offers to UPDATE, not to finalize again", () => {
  const html = renderCapture(
    [guest({ id: "1", attendanceStatus: "attended" })],
    true
  );

  assert.ok(
    html.includes("Update Attendance"),
    "a second press reconciles the register; calling it Finalize hides that"
  );
  assert.equal(html.includes("Finalize Attendance"), false);
});

test("each outcome is reported as the different thing it is", () => {
  const finalized = finalizeOutcomeMessage("finalized", 3);
  const reconciled = finalizeOutcomeMessage("reconciled", 3);
  const unchanged = finalizeOutcomeMessage("already_finalized", 3);

  // Three distinct sentences: the bug was one success message for all three.
  assert.equal(new Set([finalized, reconciled, unchanged]).size, 3);

  // Each one carries the count it is talking about.
  for (const message of [finalized, reconciled, unchanged]) {
    assert.match(message, /3 attended/);
  }

  // The one that did nothing must not read as success.
  assert.match(unchanged, /Nothing to update/);
  assert.equal(/finalized:/.test(unchanged), false);

  // The one that DID something for the late-added attendee says so.
  assert.match(reconciled, /added since/);
});

test("the outcome is announced politely, not as an error", () => {
  // It shares the region role with the running count, so a planter using a
  // screen reader hears the result of their press without it interrupting.
  const source = readFileSync(
    path.join(process.cwd(), "src/components/meetings/attendance-capture.tsx"),
    "utf8"
  );

  assert.match(
    source,
    /data-testid="finalize-outcome"/,
    "the outcome line is addressable, so a browser check can assert on it"
  );
  assert.match(
    source,
    /\{finalizeOutcome && \(\s*<p\s+role="status"\s+aria-live="polite"/,
    "the outcome is a polite status region, never an alert"
  );
});
