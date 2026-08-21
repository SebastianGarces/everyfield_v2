import { unstable_rethrow } from "next/navigation";

import {
  assignedPlantsFor,
  type AssignedPlant,
} from "@/lib/coaching/assignments";

// ============================================================================
// Failure isolation for the sidebar's Assigned plants section (#569).
//
// The same argument as the unread badge next door (`./notification-badge`), on
// the second read the layout does for EVERY dashboard route. A
// `coach_assignments ⨝ churches` join that fails does not take down /coaching,
// it takes down /people, /tasks, /meetings and everything else with it, because
// it is read in the layout rather than on a page — and it returns zero rows for
// nearly every account, which is to say almost nobody who pays that cost is
// getting anything back for it.
//
// So the coaching reach is treated the way the badge is: decoration the shell
// does not depend on. A read that cannot complete resolves to "no assignments",
// and the sidebar draws no Assigned plants section — which is what it already
// draws for the overwhelming majority of accounts.
//
// IT DEGRADES TO `[]` RATHER THAN TO A DISTINCT VALUE, and that is where this
// parts company with the badge. The badge refuses to spell its failure `0`
// because zero is a real answer ("none unread") that the header would print as
// a fact nobody read. Here the two states have the SAME correct render: no
// assignments and an unreadable assignments list both mean "do not draw the
// section". There is no sentence for a distinct value to protect, so adding one
// would only give every caller a second case to handle for no gain.
//
// What is deliberately NOT swallowed: Next.js control-flow errors. `redirect()`,
// `notFound()`, dynamic-usage bailouts and prerender interrupts are thrown as
// errors but MEAN something to the framework, so `unstable_rethrow` gets first
// refusal on every caught value.
// ============================================================================

/**
 * The assignments loader, injectable so the failure path is testable without a
 * database. Production always uses `assignedPlantsFor` — the one source of
 * truth for "which plants does this account coach", so the nav can never
 * disagree with the access check about which assignment is live.
 */
export type AssignedPlantsLoader = (
  coachUserId: string
) => Promise<AssignedPlant[]>;

/**
 * Read the coaching reach, reporting failure as an empty list rather than
 * throwing.
 *
 * Resolves for every input: a rejected loader and a loader that throws
 * synchronously both produce a list the sidebar can render. The only value that
 * escapes is a Next.js control-flow error.
 */
export async function assignedPlantsSafely(
  coachUserId: string,
  load: AssignedPlantsLoader = assignedPlantsFor
): Promise<readonly AssignedPlant[]> {
  try {
    return await load(coachUserId);
  } catch (error) {
    unstable_rethrow(error);
    console.error(
      "[COACHING] assigned plants read failed; rendering the sidebar without the section:",
      error
    );
    return [];
  }
}
