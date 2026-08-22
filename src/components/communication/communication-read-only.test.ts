import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
// `ResendNonOpeners` navigates to the message the resend created, and outside a
// Next render `useRouter` throws "invariant expected app router to be mounted"
// before any assertion here runs — so the test mounts what the app mounts. The
// internal path is the only export of these contexts; it is stable across the
// app-router releases and a rename fails loudly at import rather than quietly
// changing what is asserted.
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";

import { ViewerCapabilitiesProvider } from "@/components/shared/viewer-capabilities";
import type { Capability } from "@/lib/auth/seat-rules";
import {
  assertInOrder,
  sourceReader,
  stripComments,
} from "@/lib/testing/source-span";

import { ResendNonOpeners } from "./resend-non-openers";

// ----------------------------------------------------------------------------
// COMMUNICATION, AS A PLANT MEMBER SEES IT — AS-020 (#499).
//
// Row 9 of `@/lib/auth/read-only-surfaces`: the hub, compose, the template
// catalog, the template editor and the message detail's resend. ONE verb
// governs all of it — `communication.send` — and the checklist's `governedBy`
// is where that comes from, not from anything decided here.
//
// TWO KINDS OF ASSERTION, AND THE SPLIT IS THE RSC BOUNDARY RATHER THAN A
// PREFERENCE.
//
//   * `ResendNonOpeners` is a client component, so its absence is asserted
//     where an absence is real: on RENDERED MARKUP, twice, once with the verb
//     and once without. That is the assertion AS-020 actually makes — a
//     `disabled` button is still in the markup, still announced by a screen
//     reader, and a source scan for "Resend" cannot tell hidden from disabled.
//
//   * The other four files are `async` SERVER components. Each one opens with
//     `verifySession()` and a database read, so `renderToStaticMarkup` cannot
//     reach their markup at all, and the property that matters for two of them
//     is a REDIRECT — control flow, not markup. Those are read off the source
//     through `sourceReader`, whose anchors THROW when they move instead of
//     silently widening the span (`seat-roster.test.ts` takes the same escape
//     hatch for the same reason, and documents why a render cannot replace it).
//
// The contract test in `read-only-surfaces.test.ts` is what pins that all five
// files name the verb at all; this file pins WHAT they do with it.
//
// NONE OF THIS IS AUTHORIZATION. `requireSeat("communication.send")` refuses
// the POST that never rendered a button, and `seat-guard.test.ts` asserts that.
// A hidden control is a statement about what somebody is ASKED to do.
// ----------------------------------------------------------------------------

/** The read-only viewer: a plant Member, holding no communication verb. */
const MEMBER: readonly Capability[] = [];
/** The planter or an Admin — an ADMIN_PLUS seat (`seat-rules.ts`). */
const ADMIN: readonly Capability[] = ["communication.send"];

/**
 * A router that refuses every call. A STATIC render fires no handler, so
 * nothing here is ever reached — its job is to satisfy the mount invariant.
 * Throwing rather than no-op'ing means a render that DID navigate would say so
 * instead of passing silently.
 */
const STUB_ROUTER = new Proxy({} as never, {
  get() {
    return () => {
      throw new Error("a static render must not navigate");
    };
  },
});

function render(
  capabilities: readonly Capability[],
  element: ReactElement
): string {
  return renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: STUB_ROUTER },
      createElement(
        SearchParamsContext.Provider,
        { value: new URLSearchParams() },
        // `children` in the props bag, not as the third argument: the provider
        // declares it as a required prop, and `createElement`'s variadic
        // overload does not satisfy a required one.
        createElement(ViewerCapabilitiesProvider, {
          capabilities,
          children: element,
        })
      )
    )
  );
}

/** Both renders of one component, so a case reads as the pair it is. */
function bothWays(build: () => ReactElement): {
  member: string;
  admin: string;
} {
  return { member: render(MEMBER, build()), admin: render(ADMIN, build()) };
}

// ----------------------------------------------------------------------------
// The resend — rendered, because a resend IS a send
// ----------------------------------------------------------------------------

function resend(eligibility: {
  allowed: boolean;
  reason?: "notSent" | "tooSoon" | "alreadyResent";
}): ReactElement {
  return createElement(ResendNonOpeners, {
    communicationId: "comm-1",
    nonOpenerCount: 3,
    openedCount: 7,
    eligibility: eligibility as Parameters<
      typeof ResendNonOpeners
    >[0]["eligibility"],
  });
}

test("a Member is offered no resend on a delivered message", () => {
  const { member, admin } = bothWays(() => resend({ allowed: true }));

  assert.equal(
    member,
    "",
    "a resend is a send — `resendToNonOpenersAction` is communication.send — so the whole card goes, not just its button"
  );
  assert.ok(
    admin.includes("Resend to 3 who have not opened"),
    "the same card still offers the resend to somebody who may send — an over-hide is as much a drift as an under-hide"
  );
});

test("the DISABLED spelling of the resend is gone too, not merely re-disabled", () => {
  // THE TRAP THIS CASE EXISTS FOR. When the 24-hour gate has not passed, the
  // card renders its button `disabled` with the reason beside it — a legitimate
  // business-rule disable for an Admin, and exactly the failed hide AS-020
  // forbids for a Member, who would get a countdown to a power that never
  // becomes theirs.
  const { member, admin } = bothWays(() =>
    resend({ allowed: false, reason: "tooSoon" })
  );

  assert.equal(
    member,
    "",
    "AS-020: hidden means absent from the markup — a disabled button still announces the control"
  );
  assert.doesNotMatch(
    member,
    /<button[^>]*\bdisabled\b/,
    "and specifically not as a disabled button"
  );
  assert.match(
    admin,
    /<button[^>]*\bdisabled\b/,
    "an Admin still gets the disabled control and its reason — that disable is the 24-hour rule, not a permission"
  );
});

test("the read beside the resend is the PAGE's and survives the hide", () => {
  // `nonOpenerCount === 0` is the one branch that renders a sentence rather
  // than a control. It goes with the rest for a Member, and the delivery tiles
  // on `/communication/[id]` — which this component does not own — are where
  // the same fact is read.
  const { member, admin } = bothWays(() =>
    createElement(ResendNonOpeners, {
      communicationId: "comm-1",
      nonOpenerCount: 0,
      openedCount: 7,
      eligibility: { allowed: true } as Parameters<
        typeof ResendNonOpeners
      >[0]["eligibility"],
    })
  );

  assert.equal(member, "");
  assert.ok(admin.includes("Everyone opened this message"));
});

// ----------------------------------------------------------------------------
// The four server components — read off the source, because a render cannot
// reach an `async` component that opens with `verifySession()` and a query
// ----------------------------------------------------------------------------

function page(relativePath: string) {
  return sourceReader(
    stripComments(readFileSync(path.join(process.cwd(), relativePath), "utf8")),
    `${relativePath} (comments stripped)`
  );
}

const HUB = page("src/app/(dashboard)/communication/page.tsx");
const COMPOSE = page("src/app/(dashboard)/communication/compose/page.tsx");
const TEMPLATES = page("src/app/(dashboard)/communication/templates/page.tsx");
const TEMPLATE_EDITOR = page(
  "src/app/(dashboard)/communication/templates/[id]/edit/page.tsx"
);

test("the hub asks the same table the send action is refused by", () => {
  assert.match(
    HUB.code,
    /const canSend = holdsSeatFor\(user, "communication\.send"\)/,
    "a server component holds the session, so it asks `holdsSeatFor` directly — the same table `requireSeat` refuses the POST with, one hop fewer than the client transport"
  );
});

test("all three of the hub's routes into compose are gated, not just the header CTA", () => {
  // THE ONE THAT IS EASY TO MISS is the quick-action grid: four cards that look
  // like a template gallery and are each a link INTO the compose form. Hiding
  // "New Message" and leaving them up is a Member two clicks from a redirect.
  assertInOrder(
    HUB.code,
    "communication/page.tsx",
    [
      "{canSend && (",
      "New Message",
      "{canSend && quickActions.length > 0 && (",
      "Recent Messages",
      "Compose Message",
    ],
    "the header CTA, the quick-action grid and the empty state's CTA are three separate write affordances on one page"
  );

  assert.equal(
    HUB.code.split("canSend").length - 1,
    // The declaration, the SUBTITLE (#666), the header CTA, the quick actions,
    // the empty state's copy and its button, and the two for `DeliveryOverview`
    // — the prop and its value. Two of those eight are sentences rather than
    // controls: that card's empty state SAID "Send your first message…" to a
    // reader who cannot, and the page's own subtitle said "Send messages and
    // track communication…". Both branch on the same flag rather than growing a
    // second.
    8,
    "eight sites: `canSend` is declared once and read at every affordance — a new link into /compose, or a new sentence naming the verb, that does not read it is the drift this count catches"
  );
});

test("the hub's two capability-matched sentences come from the presentation module", () => {
  // WHAT THEY SAY is `presentation.test.ts`'s subject, because the repo's
  // node:test harness has no DOM and cannot reach an `async` server component's
  // markup — which is the whole reason the copy is a pure `.ts` helper at all.
  // What THIS file pins is that the page still calls them, and still passes the
  // seat: a page that inlined either sentence back would go quiet here.
  for (const helper of [
    "communicationHubSubtitle(canSend)",
    "communicationEmptyStateLine(canSend)",
  ]) {
    assert.ok(
      HUB.code.includes(helper),
      `the hub no longer reads ${helper} — its copy is capability-matched in src/lib/communication/presentation.ts (#666), and inlining it here is how the header came to tell a Member to send messages`
    );
  }
});

test("the compose ROUTE is refused, not merely unlinked", () => {
  // Rule 3 of the sweep: a hidden button that leaves `/communication/compose`
  // reachable by URL is a screen a Member walks into, picks recipients on,
  // writes a message in, and is refused at submit.
  assertInOrder(
    COMPOSE.code,
    "communication/compose/page.tsx",
    [
      'if (!holdsSeatFor(user, "communication.send"))',
      'redirect("/communication")',
    ],
    "the door shuts on the same verb `sendCommunicationAction` refuses with"
  );

  // AND BEFORE THE WORK. A gate under the queries still runs them, and a gate
  // under the render is not a gate.
  const beforeGate = COMPOSE.span(
    "const { user } = await verifySession();",
    'if (!holdsSeatFor(user, "communication.send"))'
  );
  assert.doesNotMatch(
    beforeGate,
    /await Promise\.all|db\s*\n?\s*\.select/,
    "the refusal sits above every read this page would otherwise pay for"
  );
});

test("the template-editor ROUTE is refused, and lands back on the catalog", () => {
  assertInOrder(
    TEMPLATE_EDITOR.code,
    "communication/templates/[id]/edit/page.tsx",
    [
      'if (!holdsSeatFor(user, "communication.send"))',
      'redirect("/communication/templates")',
    ],
    "opening the editor on a system template forks a church-owned copy on first save, so arriving here is a write in waiting — and the catalog is where the same body is read"
  );
});

test("the template CATALOG stays readable — only its two controls go", () => {
  assert.match(
    TEMPLATES.code,
    /const canSend = holdsSeatFor\(user, "communication\.send"\)/
  );

  // NO REDIRECT HERE, and that is the distinction rule 2 draws. What a template
  // says is worth knowing to anybody in the plant; "Use" and "Edit" are not.
  // Gating the page would be an over-hide, which is as much a drift as an
  // under-hide.
  assert.doesNotMatch(
    TEMPLATES.code,
    /if \(!holdsSeatFor/,
    "the catalog is a read and the route stays open to every seat"
  );

  const card = TEMPLATES.span("{canSend && (", "templates.length === 0");
  for (const verb of ["Use", "Edit"]) {
    assert.match(
      card,
      new RegExp(`>\\s*${verb}\\s*<`),
      `"${verb}" sits inside the gate — both leave for a route that is now refused on the same verb`
    );
  }
});
