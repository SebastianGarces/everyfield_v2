import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ViewerCapabilitiesProvider } from "@/components/shared/viewer-capabilities";
import type { PersonWithTags } from "@/lib/people/types";

import { getInactivityInfo, PipelineCard } from "./pipeline-card";

const NOW = new Date("2026-08-27T12:00:00.000Z");
const THRESHOLDS = { warningDays: 7, alertDays: 14 };
const TIME_ZONE = "America/Chicago";

function person(overrides: Partial<PersonWithTags> = {}): PersonWithTags {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    churchId: "00000000-0000-4000-8000-0000000000c1",
    firstName: "Mel",
    lastName: "Okafor",
    email: "mel@plant.test",
    phone: null,
    status: "core_group",
    source: "vision_meeting",
    sourceDetails: null,
    notes: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    postalCode: null,
    country: "US",
    backgroundCheckStatus: "not_started",
    photoSrc: undefined,
    householdId: null,
    householdRole: null,
    pipelineSortOrder: 0,
    createdBy: "00000000-0000-4000-8000-0000000000a1",
    createdAt: new Date("2026-08-17T12:00:00.000Z"),
    updatedAt: NOW,
    deletedAt: null,
    tags: [],
    lastActivityAt: null,
    ...overrides,
  };
}

test("inactivity keeps the actual whole-day count and existing threshold branches", () => {
  assert.deepEqual(
    getInactivityInfo(
      person({ lastActivityAt: new Date("2026-08-17T12:00:00.000Z") }),
      THRESHOLDS,
      NOW,
      TIME_ZONE
    ),
    { level: "warning", daysSince: 10 }
  );
  assert.deepEqual(
    getInactivityInfo(
      person({ lastActivityAt: new Date("2026-08-20T12:00:00.000Z") }),
      THRESHOLDS,
      NOW,
      TIME_ZONE
    ),
    { level: "warning", daysSince: 7 }
  );
  assert.deepEqual(
    getInactivityInfo(
      person({ lastActivityAt: new Date("2026-08-13T12:00:00.000Z") }),
      THRESHOLDS,
      NOW,
      TIME_ZONE
    ),
    { level: "alert", daysSince: 14 }
  );
  assert.equal(
    getInactivityInfo(
      person({ lastActivityAt: new Date("2026-08-21T12:00:00.000Z") }),
      THRESHOLDS,
      NOW,
      TIME_ZONE
    ),
    null
  );
});

test("inactivity compares church calendar days across midnight and DST", () => {
  const oneDayWarning = { warningDays: 1, alertDays: 2 };

  assert.deepEqual(
    getInactivityInfo(
      person({ lastActivityAt: new Date("2026-08-27T04:30:00.000Z") }),
      oneDayWarning,
      new Date("2026-08-27T05:30:00.000Z"),
      TIME_ZONE
    ),
    { level: "warning", daysSince: 1 },
    "one elapsed hour across Chicago midnight is one inactive calendar day"
  );
  assert.deepEqual(
    getInactivityInfo(
      person({ lastActivityAt: new Date("2026-03-08T06:30:00.000Z") }),
      oneDayWarning,
      new Date("2026-03-09T05:30:00.000Z"),
      TIME_ZONE
    ),
    { level: "warning", daysSince: 1 },
    "the 23-hour spring-forward day is still one inactive calendar day"
  );
});

test("an inactive pipeline card renders its day count without a hover", () => {
  const daysSince = 21;
  const html = renderToStaticMarkup(
    createElement(ViewerCapabilitiesProvider, {
      capabilities: [],
      children: createElement(PipelineCard, {
        person: person({
          lastActivityAt: new Date("2026-08-06T12:00:00.000Z"),
        }),
        columnId: "core_group",
        inactivityThresholds: THRESHOLDS,
        now: NOW,
        timeZone: TIME_ZONE,
      }),
    })
  );

  assert.match(html, new RegExp(`No activity · ${daysSince}d`));
  assert.match(html, /lucide-triangle-alert/);
  assert.doesNotMatch(html, /title="No activity in/);
});
