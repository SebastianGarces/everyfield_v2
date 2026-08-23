import { redirect } from "next/navigation";

import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import type { ChurchLeadershipStatus } from "@/lib/onboarding/leadership";
import {
  resolveOnboardingStepRequest,
  resolveResumeStep,
} from "@/lib/onboarding/steps";
import { hasInitialPhaseDeclaration } from "@/lib/phase-engine/transitions";

/**
 * F12 / OB-001 — the onboarding flow as the dashboard's primary content, for a
 * planter who has not finished setting up: whether that means no church at all,
 * or a church created at step 1 and then abandoned. One of the two pages
 * `/dashboard` renders as; `page.tsx` holds the gate
 * (`shouldShowOnboarding`) and `plant-dashboard.tsx` is the other half.
 */
export async function OnboardingDashboard({
  step,
  churchId,
  leadershipStatus,
}: {
  /** The raw `?step=` value. Repeated params arrive as an array. */
  step: string | string[] | undefined;
  churchId: string | null;
  /** The church's recorded OB-004 answer, so step 2 opens on it. */
  leadershipStatus: ChurchLeadershipStatus | null | undefined;
}) {
  // The guard OB-004 carried, widened from one step to four and moved into a
  // pure function so it can be exercised by CALLING it (#373 fix pass): a URL
  // may name a later step only once step 1's church exists, and may name step
  // 1 only while it does not. Every rule, and why each answer is the one it
  // is, lives on `resolveOnboardingStepRequest`. Resolved BEFORE any query, so
  // a refused URL costs none — same ordering as the finished dashboard's half
  // of the rule.
  const stepRequest = resolveOnboardingStepRequest({ step, churchId });

  // Refusing is a REDIRECT, not a shrug (#373). The flow now reads its step
  // from the URL, so a refused value left sitting in the address bar would be
  // read by the client on the very next render and honoured there instead —
  // the server's answer has to be the one in the URL, and this is what makes
  // it so. Only `refuse` comes here: a plain `/dashboard`, an unrecognised
  // value and a closed `?step=basics` all resolve to `none` and are answered
  // by the resume rule below without a navigation.
  if (stepRequest.outcome === "refuse") {
    redirect("/dashboard");
  }

  // OB-003/005: step 3's evidence. Phase HISTORY is the only piece this half
  // reads, and the only piece it needs — inside a flow that has not finished,
  // a phase above 0 or a launch row can only have come FROM step 3, which
  // writes the declaration row in the same transaction. The finished
  // dashboard reads the other two because there the columns can arrive by
  // other paths (#675); the rule joining them is one function either way
  // (`JourneyEvidence`). Only asked when there is a church to ask about.
  const declaredInPhaseHistory = churchId
    ? await hasInitialPhaseDeclaration(churchId)
    : false;

  return (
    <div className="p-6">
      <OnboardingFlow
        initialStep={
          stepRequest.outcome === "honour"
            ? stepRequest.step
            : resolveResumeStep({
                churchId,
                leadershipStatus,
                journey: { declaredInPhaseHistory },
              })
        }
        leadershipStatus={leadershipStatus}
      />
    </div>
  );
}
