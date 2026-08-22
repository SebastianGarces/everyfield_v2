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
// visible. The index's third, link-less declaration of the same fact was
// missed. So the guard here is a RENDER, not a grep: the question is never
// "does this function return an order" — a one-line template literal cannot —
// but "does this surface put an order in front of a reader who cannot follow
// it", and only markup answers that.
// ============================================================================

import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { OversightPlantSummary } from "@/lib/oversight/types";

import { EmptyPortfolio } from "./empty-portfolio";
import { PlantsDirectory } from "./plants-directory";

/** Every way this product has of telling somebody to go and invite a planter. */
const AN_INSTRUCTION = /send invitations|invite|get started/i;

function emptyPortfolio(canInvite: boolean): string {
  return renderToStaticMarkup(
    createElement(EmptyPortfolio, { scopeLabel: "sending church", canInvite })
  );
}

/** The same component through the surface that frames it — the real path. */
function directory(canInvite: boolean): string {
  return renderToStaticMarkup(
    createElement(PlantsDirectory, {
      plants: [] as OversightPlantSummary[],
      scopeLabel: "sending church",
      canInvite,
    })
  );
}

// -- the reader who cannot act ------------------------------------------------

test("a read-only reader is told what is true and asked to do nothing (#636)", () => {
  for (const markup of [emptyPortfolio(false), directory(false)]) {
    // The whole rendered surface, not one sentence pulled out of it. This is
    // the assertion the defect would have failed.
    assert.doesNotMatch(markup, AN_INSTRUCTION);
    assert.doesNotMatch(markup, /\/oversight\/invitations/);
    // …and it still says what IS true, so the screen is not merely blank.
    assert.match(markup, /No plants yet/);
    assert.match(
      markup,
      /A plant appears here once its planter accepts an invitation from your sending church\./
    );
  }
});

test("the caption names the reader's own kind of org", () => {
  assert.match(emptyPortfolio(false), /your sending church/);
  assert.match(
    renderToStaticMarkup(
      createElement(EmptyPortfolio, { scopeLabel: "network", canInvite: false })
    ),
    /your network/
  );
});

// -- the reader who can ------------------------------------------------------

test("a reader who can invite gets the same sentence AND the invitation", () => {
  for (const markup of [emptyPortfolio(true), directory(true)]) {
    assert.match(
      markup,
      /A plant appears here once its planter accepts an invitation from your sending church\./
    );
    assert.match(markup, /Invite a planter/);
    assert.match(markup, /href="\/oversight\/invitations"/);
    // No cursor assertion here: the call to action is an `a[href]`, which
    // `components/ui/cursor-pointer.test.ts` already guards for the whole repo.
  }
});

test("both renders are real, so no assertion above is passing on an empty page", () => {
  for (const markup of [
    emptyPortfolio(false),
    emptyPortfolio(true),
    directory(false),
    directory(true),
  ]) {
    assert.match(markup, /No plants yet/);
  }
  // The two gated renders genuinely differ — a component that ignored
  // `canInvite` would satisfy every match above.
  assert.notEqual(emptyPortfolio(false), emptyPortfolio(true));
});
