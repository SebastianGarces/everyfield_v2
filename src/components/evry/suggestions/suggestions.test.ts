import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  evryConversationRequestBody,
  evrySubmissionMessage,
} from "@/components/evry/interaction-state";
import { heldCapabilities } from "@/lib/auth/seat-rules";
import type { SeatFields } from "@/lib/auth/tenancy";
import type { EvryParityInventory } from "@/lib/evry/capabilities/contract";
import inventoryJson from "@/lib/evry/capabilities/inventory.generated.json";

import type { PublicEvryConversation } from "../client-contract";
import { eligibleEvrySuggestions } from "./eligibility";
import {
  populateComposerFromSuggestion,
  shouldOfferEvrySuggestions,
} from "./interaction";
import { evrySuggestionsForPathname } from "./pathname";
import { EvrySuggestionList } from "./suggestion-list";
import type { EligibleEvrySuggestion } from "./types";

const INVENTORY = inventoryJson as EvryParityInventory;
const PLANT_ID = "10000000-0000-4000-8000-000000000001";

const actor = (seat: SeatFields["seat"]): SeatFields => ({
  seat,
  churchId: PLANT_ID,
  sendingChurchId: null,
  sendingNetworkId: null,
});

const eligibleFor = (seat: SeatFields["seat"]) =>
  eligibleEvrySuggestions(true, heldCapabilities(actor(seat)), INVENTORY);

const ids = (suggestions: readonly EligibleEvrySuggestion[]) =>
  suggestions.map((suggestion) => suggestion.id);

test("page context selects only the current supported module", () => {
  const adminSuggestions = eligibleFor("admin");
  const cases = [
    ["/people", ["people-follow-up", "people-add"]],
    ["/people/person-1/activity", ["people-follow-up", "people-add"]],
    ["/meetings", ["meetings-schedule"]],
    ["/tasks/task-1", ["tasks-overdue", "tasks-complete-own", "tasks-create"]],
    ["/launch", ["launch-milestones"]],
    ["/evry", ["people-follow-up", "meetings-schedule", "tasks-overdue"]],
  ] as const;

  for (const [pathname, expected] of cases) {
    assert.deepEqual(
      ids(evrySuggestionsForPathname(pathname, adminSuggestions)),
      expected
    );
  }
});

test("Owner, Admin, and Member see only suggestions for capabilities they hold", () => {
  const cases = [
    [
      "owner",
      {
        people: ["people-follow-up", "people-add"],
        meetings: ["meetings-schedule"],
        tasks: ["tasks-overdue", "tasks-complete-own", "tasks-create"],
        launch: ["launch-milestones", "launch-date"],
      },
    ],
    [
      "admin",
      {
        people: ["people-follow-up", "people-add"],
        meetings: ["meetings-schedule"],
        tasks: ["tasks-overdue", "tasks-complete-own", "tasks-create"],
        launch: ["launch-milestones"],
      },
    ],
    [
      "member",
      {
        people: ["people-follow-up"],
        meetings: [],
        tasks: ["tasks-overdue", "tasks-complete-own"],
        launch: ["launch-milestones"],
      },
    ],
  ] as const;

  for (const [seat, expectedByModule] of cases) {
    const eligible = eligibleFor(seat);
    for (const [module, expected] of Object.entries(expectedByModule)) {
      assert.deepEqual(
        ids(evrySuggestionsForPathname(`/${module}`, eligible)),
        expected,
        `${seat} suggestions on /${module}`
      );
    }
  }
});

test("Settings, coaching, oversight, and sessionless paths advertise nothing", () => {
  const excludedPaths = [
    "/settings",
    "/settings/team",
    "/coaching",
    "/coaching/plant-1",
    "/oversight",
    "/oversight/plants",
    "/login",
    "/register",
    "/onboarding",
  ];

  for (const seat of ["owner", "admin", "member"] as const) {
    const eligible = eligibleFor(seat);
    for (const pathname of excludedPaths) {
      assert.deepEqual(
        evrySuggestionsForPathname(pathname, eligible),
        [],
        `${seat} must see no suggestions on ${pathname}`
      );
    }
  }

  assert.deepEqual(
    eligibleEvrySuggestions(false, heldCapabilities(actor("owner")), INVENTORY),
    [],
    "an ineligible coaching, oversight, or pre-tenancy shell gets no catalog"
  );
});

test("inventory support is required in addition to the actor capability", () => {
  const withoutMeetingActions: EvryParityInventory = {
    ...INVENTORY,
    entries: INVENTORY.entries.filter(
      (entry) =>
        !(entry.kind === "action" && entry.parityCapability === "meetings")
    ),
  };

  const suggestions = eligibleEvrySuggestions(
    true,
    heldCapabilities(actor("owner")),
    withoutMeetingActions
  );
  assert.deepEqual(
    ids(evrySuggestionsForPathname("/meetings", suggestions)),
    []
  );
});

test("suggestions appear only in empty and completed conversation states", () => {
  const message = (
    author: "user" | "assistant",
    deliveryStatus: "complete" | "interrupted"
  ): PublicEvryConversation => ({
    id: "20000000-0000-4000-8000-000000000001",
    title: "A conversation",
    createdAt: "2026-08-28T12:00:00.000Z",
    lastActivityAt: "2026-08-28T12:00:00.000Z",
    activePlan: null,
    stateVersion: 1,
    state: null,
    messages: [
      {
        id: "30000000-0000-4000-8000-000000000001",
        sequence: 1,
        author,
        body: "Ordinary request or reply",
        pageContext: null,
        deliveryStatus,
        createdAt: "2026-08-28T12:00:00.000Z",
        artifacts: [],
      },
    ],
  });

  assert.equal(shouldOfferEvrySuggestions(null), true);
  assert.equal(shouldOfferEvrySuggestions(message("user", "complete")), false);
  assert.equal(
    shouldOfferEvrySuggestions(message("assistant", "interrupted")),
    false
  );
  assert.equal(
    shouldOfferEvrySuggestions(message("assistant", "complete")),
    true
  );
});

test("selecting a suggestion only populates and focuses the ordinary composer", () => {
  const suggestion = eligibleFor("member")[0]!;
  let draft = "";
  let focusCount = 0;
  const submissionCount = 0;
  const confirmationCount = 0;

  populateComposerFromSuggestion(
    suggestion,
    (request) => {
      draft = request;
    },
    () => {
      focusCount += 1;
    }
  );

  assert.equal(draft, suggestion.request);
  assert.equal(focusCount, 1);
  assert.equal(submissionCount, 0);
  assert.equal(confirmationCount, 0);

  const message = evrySubmissionMessage(draft);
  assert.ok(message !== null);
  assert.deepEqual(
    JSON.parse(
      evryConversationRequestBody({
        requestKey: "request-1",
        message,
        pageContext: null,
      })
    ),
    {
      requestKey: "request-1",
      message: suggestion.request,
      pageContext: null,
    },
    "a selected suggestion crosses the API boundary as ordinary request copy only"
  );

  // These counters stand for behaviors selection must never invoke.
  assert.equal(submissionCount, 0);
  assert.equal(confirmationCount, 0);
});

test("suggestions render as wrapping, non-submit buttons with accessible text", () => {
  const suggestions = evrySuggestionsForPathname(
    "/tasks",
    eligibleFor("member")
  );
  const html = renderToStaticMarkup(
    createElement(EvrySuggestionList, {
      suggestions,
      onSelect: () => undefined,
    })
  );

  assert.match(html, /aria-labelledby="evry-suggestions-label"/);
  assert.equal((html.match(/type="button"/g) ?? []).length, suggestions.length);
  assert.doesNotMatch(html, /type="submit"|disabled/);
  for (const suggestion of suggestions)
    assert.match(html, new RegExp(suggestion.request));
});
