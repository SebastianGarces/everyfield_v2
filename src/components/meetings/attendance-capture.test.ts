import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  AttendanceCapture,
  attendanceCheckboxLabel,
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

function renderCapture(guests: Guest[]): string {
  return renderToStaticMarkup(
    createElement(AttendanceCapture, {
      meetingId: "meeting-1",
      guests,
      summary: {
        total: guests.length,
        firstTime: 0,
        returning: 0,
        coreGroup: 0,
      },
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

test("the checkbox is still a cursor-pointer control and keeps its toggle wiring", () => {
  const html = renderCapture([guest({ id: "1" })]);
  const [box] = checkboxes(html);

  assert.equal(box.tag, "button");
  assert.ok(box.attrs["class"]?.includes("cursor-pointer"));
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
