import { Sprout } from "lucide-react";

import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";

/**
 * What `/dashboard` says to a signed-in viewer with NO church — a coach, or a
 * team member whose plant link is gone. That viewer is neither redirected to
 * `/oversight` nor put through onboarding (`shouldShowOnboarding` is
 * planter-only), so this page is where they land, and until ruling 408-2B they
 * got a silently empty dashboard: zeroed metrics rendered as if a plant were
 * simply quiet, behind what used to be a `churchId!` assertion.
 *
 * Ruled 2026-08-12 (408-2B): say the state out loud and keep them here. The
 * page guards BEFORE any church-scoped read, so the empty state costs no
 * queries — and `plant-dashboard.tsx` now takes a proven non-null `churchId`,
 * which is what makes "every metric is about a real plant" a type-level fact.
 */
export function NoPlantEmptyState() {
  return (
    <PageCanvas>
      <WorkspacePanel className="flex min-h-full items-center justify-center p-6">
        <div className="mx-auto max-w-md text-center">
          <Sprout
            className="text-muted-foreground mx-auto h-10 w-10"
            aria-hidden="true"
          />
          <h1 className="mt-4 text-xl font-semibold tracking-tight">
            You are not attached to a plant yet
          </h1>
          <p className="text-muted-foreground mt-2">
            Ask your plant&apos;s leader for an invitation. As soon as you join
            a plant, its work shows up here.
          </p>
        </div>
      </WorkspacePanel>
    </PageCanvas>
  );
}
