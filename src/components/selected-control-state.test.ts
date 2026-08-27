import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

import { CommitmentForm } from "@/components/people/commitment-form";
import { ScoreSelector } from "@/components/people/assessment-form";
import { StatusSelector } from "@/components/people/interview-form";
import {
  nextProficiency,
  ProficiencySelector,
} from "@/components/people/skills-form";
import { ViewToggle } from "@/components/people/view-toggle";
import { LocationPicker } from "@/components/meetings/location-picker";
import { MeetingList } from "@/components/meetings/meeting-list";
import { parseElements } from "@/lib/testing/rendered-markup";

const ROUTER = new Proxy({} as never, {
  get() {
    return () => {
      throw new Error("a static render must not navigate");
    };
  },
});

function render(element: ReactElement, search = ""): string {
  return renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: ROUTER },
      createElement(SearchParamsContext.Provider, {
        value: new URLSearchParams(search),
        children: element,
      })
    )
  );
}

function group(html: string, label: string) {
  const found = parseElements(html).find(
    (element) =>
      element.attrs.role === "group" && element.attrs["aria-label"] === label
  );
  assert.ok(found, `missing accessible group name "${label}"`);
}

function pressedButtons(html: string) {
  return parseElements(html).filter(
    (element) =>
      element.tag === "button" && element.attrs["aria-pressed"] !== undefined
  );
}

test("assessment score choices expose a named group and the verbal score label", () => {
  const html = render(
    createElement(ScoreSelector, {
      label: "Committed",
      value: 4,
      onChange: () => {},
    })
  );

  group(html, "Committed score");
  const buttons = pressedButtons(html);
  assert.equal(buttons.length, 5);
  assert.equal(
    buttons.find(
      (button) => button.attrs["aria-label"] === "4: Consistently demonstrates"
    )?.attrs["aria-pressed"],
    "true"
  );
});

test("interview status choices expose their selected state", () => {
  const html = render(
    createElement(StatusSelector, {
      label: "Maturity",
      value: "concern",
      onChange: () => {},
    })
  );

  group(html, "Maturity status");
  assert.equal(
    pressedButtons(html).find(
      (button) => button.attrs["aria-pressed"] === "true"
    )?.attrs["aria-pressed"],
    "true"
  );
});

test("commitment, proficiency, and people-view choices expose their selected state", () => {
  const commitment = render(
    createElement(CommitmentForm, {
      person: { id: "person-1", status: "interviewed" } as never,
    })
  );
  group(commitment, "Commitment type");
  assert.equal(
    pressedButtons(commitment).filter(
      (button) => button.attrs["aria-pressed"] === "true"
    ).length,
    1
  );

  const proficiency = render(
    createElement(ProficiencySelector, {
      value: "advanced",
      onChange: () => {},
    })
  );
  group(proficiency, "Proficiency level");
  assert.equal(
    pressedButtons(proficiency).filter(
      (button) => button.attrs["aria-pressed"] === "true"
    ).length,
    1
  );

  const view = render(createElement(ViewToggle, { currentView: "pipeline" }));
  group(view, "People view");
  assert.equal(
    pressedButtons(view).find(
      (button) => button.attrs["aria-pressed"] === "true"
    )?.attrs["aria-pressed"],
    "true"
  );
});

test("meeting filter and view choices expose their URL-selected state", () => {
  const html = render(
    createElement(MeetingList, {
      upcomingMeetings: [],
      pastMeetings: [],
      hasMeetingHistory: false,
      initialView: "upcoming",
      timeZone: "America/New_York",
      now: new Date("2026-08-01T00:00:00Z"),
    }),
    "type=vision_meeting&view=past"
  );

  group(html, "Filter meetings by type");
  group(html, "Filter meetings by time");
  assert.equal(
    pressedButtons(html).filter(
      (button) => button.attrs["aria-pressed"] === "true"
    ).length,
    2
  );
});

test("location mode exposes its selected state", () => {
  const html = render(
    createElement(LocationPicker, {
      locations: [],
      defaultLocationName: "Community Center",
    })
  );

  group(html, "Location mode");
  assert.equal(
    pressedButtons(html).filter(
      (button) => button.attrs["aria-pressed"] === "true"
    ).length,
    1
  );
});

test("proficiency remains optional when its selected choice is pressed again", () => {
  assert.equal(nextProficiency("advanced", "advanced"), "");
  assert.equal(nextProficiency("advanced", "expert"), "expert");
});
