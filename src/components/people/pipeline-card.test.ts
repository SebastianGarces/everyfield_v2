import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ViewerCapabilitiesProvider } from "@/components/shared/viewer-capabilities";
import type { PersonWithTags } from "@/lib/people/types";

import { PipelineCard } from "./pipeline-card";

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

test("old core-team activity alone never renders follow-up urgency", () => {
  const render = (followUpTasks: PersonWithTags["followUpTasks"]) =>
    renderToStaticMarkup(
      createElement(ViewerCapabilitiesProvider, {
        capabilities: [],
        children: createElement(PipelineCard, {
          person: person({
            lastActivityAt: new Date("2026-08-06T12:00:00.000Z"),
            followUpTasks,
          }),
          columnId: "core_group",
          inactivityThresholds: THRESHOLDS,
          now: NOW,
          timeZone: TIME_ZONE,
        }),
      })
    );
  assert.doesNotMatch(
    render([]),
    /lucide-triangle-alert|No activity|Follow-up/
  );
  assert.match(
    render([{ id: "due-task", dueDate: "2026-08-26" }]),
    /Follow-up overdue · 1/
  );
  assert.match(
    render([{ id: "future-task", dueDate: "2026-08-29" }]),
    /Follow-up due 2026-08-29/
  );
  assert.doesNotMatch(
    render([{ id: "undated", dueDate: null }]),
    /lucide-triangle-alert/
  );
});
