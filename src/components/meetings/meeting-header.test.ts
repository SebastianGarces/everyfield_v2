import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { MeetingWithCounts } from "@/lib/meetings/types";
import { parseElements } from "@/lib/testing/rendered-markup";

import { MeetingHeader } from "./meeting-header";

const MEETING = {
  id: "00000000-0000-4000-8000-000000000001",
  churchId: "00000000-0000-4000-8000-000000000002",
  type: "vision_meeting",
  title: null,
  datetime: new Date("2030-08-15T12:00:00.000Z"),
  status: "completed",
  locationId: null,
  locationName: null,
  locationAddress: null,
  meetingNumber: 4,
  teamId: null,
  meetingSubtype: null,
  estimatedAttendance: 100,
  actualAttendance: 95,
  durationMinutes: 90,
  notes: null,
  agenda: null,
  createdBy: "00000000-0000-4000-8000-000000000003",
  createdAt: new Date("2030-08-01T12:00:00.000Z"),
  updatedAt: new Date("2030-08-01T12:00:00.000Z"),
  totalAttendees: 95,
  newAttendees: 5,
  returningAttendees: 90,
  location: null,
  teamName: null,
} satisfies MeetingWithCounts;

test("the meeting header uses the shared detail-header hierarchy", () => {
  const html = renderToStaticMarkup(
    createElement(MeetingHeader, { meeting: MEETING, timeZone: "UTC" })
  );
  const slots = parseElements(html)
    .map((element) => element.attrs["data-slot"])
    .filter(
      (slot): slot is string => slot?.startsWith("detail-header") ?? false
    );

  for (const slot of [
    "detail-header",
    "detail-header-eyebrow",
    "detail-header-title",
    "detail-header-metadata",
    "detail-header-trailing",
  ]) {
    assert.ok(slots.includes(slot), `${slot} must stay in the meeting header`);
  }

  const responsiveRow = parseElements(html).find((element) => {
    const className = element.attrs["class"];
    return className?.includes("flex-col") && className.includes("md:flex-row");
  });
  assert.ok(
    responsiveRow,
    "the title and trailing status must stack before the desktop breakpoint"
  );

  assert.ok(
    html.indexOf("Vision Meeting</span>") <
      html.indexOf("Vision Meeting #4</h1>") &&
      html.indexOf("Vision Meeting #4</h1>") < html.indexOf("No location set"),
    "the meeting type belongs above the title and the metadata below it"
  );
});
