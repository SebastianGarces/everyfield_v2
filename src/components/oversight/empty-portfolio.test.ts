// ============================================================================
// WHAT THE EMPTIEST OVERSIGHT SCREEN SAYS, AND WHO IT SAYS IT TO (#636).
//
// An org Member is read-only by design: #500 gave them a seat that reads the
// portfolio and changes nothing, and every write control on every oversight
// surface is gated behind `org.invitation.manage`. The empty state was the one
// place still speaking to an Owner — "No church plants yet. Send invitations to
// get started", above a page carrying no invite control at all. An instruction
// the screen does not let you follow does not read as a suggestion; it reads as
// a page that is broken.
//
// #500 fixed the two empty states that carried a LINK, because a link is
// visible. The bare sentence in the headline card was a third declaration of
// the same fact, and the copy is always the one that misses the fix — so the
// sentence is one function now, and these tests hold both halves: the sentence
// says nothing only an Owner can act on, and no surface spells its own.
// ============================================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { emptyPortfolioCaption } from "@/lib/oversight/presentation";
import type { OversightPlantSummary } from "@/lib/oversight/types";

import { PlantsDirectory } from "./plants-directory";

const SRC = join(process.cwd(), "src");
const OVERSIGHT_INDEX = join(
  SRC,
  "app",
  "(dashboard)",
  "oversight",
  "page.tsx"
);

/** Every way this product has of telling somebody to go and invite a planter. */
const AN_INSTRUCTION = /send invitations|invite|get started/i;

// -- the sentence -------------------------------------------------------------

test("the empty caption states a condition, it does not issue an order", () => {
  const caption = emptyPortfolioCaption("sending church");

  // True whoever is reading, which is why it needs no seat branch of its own.
  assert.doesNotMatch(caption, AN_INSTRUCTION);
  // …and it still says whose sending church, in the reader's own word for it.
  assert.match(caption, /your sending church/);
  assert.match(emptyPortfolioCaption("network"), /your network/);
});

// -- the surfaces -------------------------------------------------------------

test("the oversight index renders the caption, it does not spell one (#636)", () => {
  const source = readFileSync(OVERSIGHT_INDEX, "utf8");

  // BOTH empty states on this page, from the one function. The page said the
  // same thing twice in two different wordings, and only one of them was fixed
  // when the Member's seat landed.
  assert.equal(
    (source.match(/emptyPortfolioCaption\(scopeLabel\)/g) ?? []).length,
    2,
    "an empty state on /oversight is spelling its own sentence again"
  );
  assert.doesNotMatch(
    source,
    /No church plants/,
    "the hand-typed empty copy is back on /oversight"
  );
});

// -- the call to action, which IS gated ---------------------------------------

function directory(canInvite: boolean): string {
  return renderToStaticMarkup(
    createElement(PlantsDirectory, {
      plants: [] as OversightPlantSummary[],
      scopeLabel: "sending church",
      canInvite,
    })
  );
}

test("a read-only reader is told what is true, and asked to do nothing", () => {
  const markup = directory(false);

  assert.match(markup, /A plant appears here once its planter accepts/);
  assert.doesNotMatch(markup, /Invite a planter/);
  assert.doesNotMatch(markup, /\/oversight\/invitations/);
});

test("a reader who can invite gets the same sentence AND the invitation", () => {
  const markup = directory(true);

  assert.match(markup, /A plant appears here once its planter accepts/);
  assert.match(markup, /Invite a planter/);
  assert.match(markup, /\/oversight\/invitations/);
});

test("both renders are real, so neither assertion is passing on an empty page", () => {
  for (const markup of [directory(false), directory(true)]) {
    assert.match(markup, /No plants yet/);
  }
});
