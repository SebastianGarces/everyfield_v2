import { getCurrentUserChurch } from "@/lib/auth";
import { listTeams } from "@/lib/ministry-teams/service";
import type { ChurchLeadershipStatus } from "@/lib/onboarding/leadership";
import type { OnboardingStepId } from "@/lib/onboarding/steps";

import { OnboardingFlowClient } from "./onboarding-flow-client";

/**
 * F12 / OB-001 + OB-015 — the onboarding flow as a call site sees it: give it
 * the two things only the page knows (where to land, and the recorded
 * leadership answer) and it resolves the rest itself.
 *
 * WHY THERE IS A SERVER HALF AT ALL (ruling 2026-08-09). OB-015's offer is
 * gated on two facts about the PLANT — the phase it declared and whether it
 * already has teams — and both of them outlive the visit that produced them.
 * The first build read the phase from a variable set by step 3, so a planter
 * who declared phase 3, closed the tab, and resumed the next day reached the
 * end of onboarding with no offer: their answer was on the church row the whole
 * time and nothing was reading it. Resolving both facts here makes the offer
 * state-driven — the same answer however the planter arrived — and keeps them
 * out of client state entirely (`memory/contracts/data-patterns.md`: server
 * data flows through props).
 *
 * BOTH READS ARE CHEAP AT THIS POINT IN THE PRODUCT. `getCurrentUserChurch` is
 * `React.cache()`d and the dashboard page has already called it, so it costs
 * this render nothing. `listTeams` is a single indexed select while a plant has
 * no teams — which is every plant that will be shown the offer — and it is only
 * reached at all while onboarding is unfinished.
 */
export async function OnboardingFlow({
  initialStep,
  leadershipStatus,
}: {
  initialStep: OnboardingStepId;
  /** The church's recorded OB-004 answer, so step 2 opens on it. */
  leadershipStatus: ChurchLeadershipStatus | null | undefined;
}) {
  // Step 1 may not have run yet, in which case there is no plant to ask about
  // and no offer to make. `getCurrentUserChurch` is the session's own church,
  // so nothing here takes a church from the caller (`memory/invariants.md` →
  // Multi-Tenancy).
  const church = await getCurrentUserChurch();
  const teams = church ? await listTeams(church.id) : [];

  return (
    <OnboardingFlowClient
      initialStep={initialStep}
      leadershipStatus={leadershipStatus}
      declaredPhase={church?.currentPhase ?? null}
      // ANY team means the initialization would do nothing —
      // `initializeTeamsWithRolesAction` refuses a church that already has
      // teams, and `initializePredefinedTeams` would skip every template it
      // already holds anyway (`ON CONFLICT … DO NOTHING`, migration 0034). The
      // card and the action therefore ask the same question.
      teamsInitialized={teams.length > 0}
    />
  );
}
