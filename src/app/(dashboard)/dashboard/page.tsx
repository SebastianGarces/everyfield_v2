import { getCurrentSession, getCurrentUserChurch } from "@/lib/auth";
import {
  resolveFinishedDashboardStepRequest,
  shouldShowOnboarding,
} from "@/lib/onboarding/steps";
import { redirect } from "next/navigation";
import { NoPlantEmptyState } from "./no-plant-empty-state";
import { OnboardingDashboard } from "./onboarding-dashboard";
import { PlantDashboard } from "./plant-dashboard";
import { isOversightUser } from "@/lib/auth/tenancy";

export const dynamic = "force-dynamic";

/**
 * `/dashboard` is two pages sharing one route, and this file is only the fork:
 * the onboarding flow (`./onboarding-dashboard.tsx`) while
 * `onboarding_completed_at` is null, and the finished plant dashboard
 * (`./plant-dashboard.tsx`) after. Each half owns its own reads; what lives
 * here is what both need — the session, the church row (request-cached, so
 * handing it down costs the halves nothing) and the `?step=` resolution for
 * the finished half, placed before the fork's queries so a refused URL costs
 * none.
 */
export default async function DashboardPage({
  searchParams,
}: {
  // Next hands a REPEATED query param back as an array (`?step=a&step=b`), so
  // this is the honest type rather than the convenient one. Narrowing is the
  // guard's job — the two resolvers in `@/lib/onboarding/steps` — and typing
  // it as a plain string is what let a repeated param slip past that guard
  // entirely.
  searchParams: Promise<{
    churchCreated?: string | string[];
    step?: string | string[];
  }>;
}) {
  const [{ user }, resolvedSearchParams] = await Promise.all([
    getCurrentSession(),
    searchParams,
  ]);
  const { churchCreated, step } = resolvedSearchParams;

  // Redirect an oversight tenancy to its dedicated dashboard
  if (user && isOversightUser(user)) {
    redirect("/oversight");
  }

  // The proxy already bounces unauthenticated requests to /login
  // (`PROTECTED_ROUTE_PREFIXES`); a null session here is a request that
  // slipped past it, and it gets the same answer.
  if (!user) {
    redirect("/login");
  }

  // F12 / OB-001: the onboarding flow is the primary dashboard content for a
  // planter who has not finished setting up — whether that means no church at
  // all, or a church created at step 1 and then abandoned. `getCurrentUserChurch`
  // is request-cached, so reading it here does not cost the halves a query.
  const church = await getCurrentUserChurch();

  if (
    shouldShowOnboarding({
      seat: user.seat,
      churchId: user.churchId,
      sendingChurchId: user.sendingChurchId,
      sendingNetworkId: user.sendingNetworkId,
      onboardingCompletedAt: church?.onboardingCompletedAt,
    })
  ) {
    return (
      <OnboardingDashboard
        step={step}
        churchId={user.churchId}
        leadershipStatus={church?.leadershipStatus}
      />
    );
  }

  // Onboarding is OVER from here down, and the flow's own `?step=` refusal
  // stopped running with it — so this is its other half (#373, AC 3), one call
  // to the canonical resolver (`memory/invariants.md` → Onboarding: a `?step=`
  // value becomes a step in exactly ONE place). `leadership` is the one value
  // a finished dashboard honours (OB-004's re-entry); everything else is
  // scrubbed by redirect, before any query runs.
  const stepRequest = resolveFinishedDashboardStepRequest(step);
  if (stepRequest.outcome === "refuse") {
    redirect("/dashboard");
  }

  // Ruled 2026-08-12 (408-2B): a viewer with no church — a coach, or a Member
  // whose plant link is gone — is told so explicitly and kept here.
  // The guard sits BEFORE the finished dashboard so none of its church-scoped
  // reads run, and `PlantDashboard` takes a proven non-null `churchId`.
  if (!user.churchId) {
    return <NoPlantEmptyState />;
  }

  return (
    <PlantDashboard
      viewer={{
        id: user.id,
        seat: user.seat,
        churchId: user.churchId,
        sendingChurchId: user.sendingChurchId,
        sendingNetworkId: user.sendingNetworkId,
      }}
      church={church}
      wantsLeadershipStep={stepRequest.outcome === "leadership"}
      showConfetti={churchCreated === "true"}
    />
  );
}
