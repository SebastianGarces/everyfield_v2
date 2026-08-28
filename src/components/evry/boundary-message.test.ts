import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { parseElements } from "@/lib/testing/rendered-markup";
import type { EvrySettingsHandoffArtifact } from "@/lib/evry/policy/artifacts";
import {
  failClosedEvryPolicyDecision,
  resolveEvryPolicyDecision,
} from "@/lib/evry/policy/core";
import { evryPolicyModelOutputSchema } from "@/lib/evry/policy/schema";

import { EvryBoundaryMessage } from "./boundary-message";

function renderClassification(
  classification:
    | "theology_or_spiritual_guidance"
    | "unrelated"
    | "mixed"
    | "ambiguous"
): string {
  const decision = resolveEvryPolicyDecision(
    "fixture request",
    evryPolicyModelOutputSchema.parse({ decision: { classification } }).decision
  );
  assert.equal("artifact" in decision, true);
  if (!("artifact" in decision)) return "";
  return renderToStaticMarkup(
    createElement(EvryBoundaryMessage, { artifact: decision.artifact })
  );
}

test("prohibited and unrelated requests render the same soft boundary", () => {
  const theology = renderClassification("theology_or_spiritual_guidance");
  const unrelated = renderClassification("unrelated");

  assert.equal(theology, unrelated);
  assert.match(theology, /Ask Evry about EveryField/);
  assert.match(theology, /Find overdue tasks/);
  assert.match(theology, /Create a meeting/);
});

test("all refusals keep one native, non-interactive public shape", () => {
  const renders = [
    renderClassification("theology_or_spiritual_guidance"),
    renderClassification("unrelated"),
    renderClassification("mixed"),
    renderClassification("ambiguous"),
  ];

  const tagShape = (html: string) => parseElements(html).map(({ tag }) => tag);
  for (const html of renders) {
    assert.deepEqual(tagShape(html), tagShape(renders[0]));
    assert.deepEqual(
      parseElements(html).filter(({ tag }) =>
        ["button", "form", "input", "script"].includes(tag)
      ),
      []
    );
  }
});

test("provider failure renders the ordinary ambiguity message", () => {
  const failure = failClosedEvryPolicyDecision();
  const html = renderToStaticMarkup(
    createElement(EvryBoundaryMessage, { artifact: failure.artifact })
  );

  assert.equal(html, renderClassification("ambiguous"));
  assert.doesNotMatch(html, /provider|schema|error/i);
});

test("Settings renders one descriptive native destination and no control", () => {
  const decision = resolveEvryPolicyDecision(
    "Turn off my digest.",
    evryPolicyModelOutputSchema.parse({
      decision: {
        classification: "settings",
        settingsSectionId: "notifications",
      },
    }).decision
  );
  assert.equal(decision.classification, "settings");
  const html = renderToStaticMarkup(
    createElement(EvryBoundaryMessage, { artifact: decision.artifact })
  );
  const links = parseElements(html).filter(({ tag }) => tag === "a");

  assert.equal(links.length, 1);
  assert.equal(
    links[0]?.attrs.href,
    "#settings/notifications",
    "SettingsLink resolves the validated section id to its canonical href"
  );
  assert.match(html, />Open Notifications settings<\/a>/);
  assert.deepEqual(
    parseElements(html).filter(({ tag }) =>
      ["button", "form", "input"].includes(tag)
    ),
    []
  );
});

test("an unknown serialized Settings id renders no destination", () => {
  const malformed: EvrySettingsHandoffArtifact = {
    kind: "settings_handoff",
    title: "Open Unknown settings",
    message:
      "Review or change this in EveryField Settings. Evry has not read or changed the setting.",
    destination: { sectionId: "not-a-settings-section" },
  };
  const html = renderToStaticMarkup(
    createElement(EvryBoundaryMessage, { artifact: malformed })
  );

  assert.deepEqual(
    parseElements(html).filter(({ tag }) => tag === "a"),
    [],
    "the UI must validate the serialized id before it reaches SettingsLink"
  );
});

test("a retired serialized Settings id follows its canonical live destination", () => {
  const retired: EvrySettingsHandoffArtifact = {
    kind: "settings_handoff",
    title: "Open Sharing settings",
    message:
      "Review or change this in EveryField Settings. Evry has not read or changed the setting.",
    destination: { sectionId: "sharing" },
  };
  const html = renderToStaticMarkup(
    createElement(EvryBoundaryMessage, { artifact: retired })
  );
  const links = parseElements(html).filter(({ tag }) => tag === "a");

  assert.equal(links.length, 1);
  assert.equal(links[0]?.attrs.href, "#settings/church");
  assert.match(html, />Open Church settings<\/a>/);
});
