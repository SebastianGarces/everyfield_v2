import { redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
import { TaskTemplatePicker } from "@/components/tasks/template-picker";
import { getCurrentUserChurch, verifySession } from "@/lib/auth";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import type { PhaseNumber } from "@/lib/constants";
import { PHASES } from "@/lib/constants";
import { TEMPLATES_LINK_LABEL } from "@/lib/tasks/templates";

// ============================================================================
// T-011 / T-012 — where a planter reaches the checklist catalog.
//
// THE CATALOG NEEDS A URL OF ITS OWN. The phase prompt (T-020) offers one
// stage's checklists at the moment the stage changes, and then it is gone —
// declining it, or changing stage twice in a week, must not be the only way a
// planter ever sees the catalog. This is the standing route: every phase,
// always reachable, linked from the /tasks header.
//
// A STATIC SEGMENT, DELIBERATELY. `/tasks/[id]` sits beside this directory, so
// without this page `/tasks/templates` resolved to a task whose id is the word
// "templates" and answered 500. A literal segment wins over a dynamic sibling,
// which is what makes the URL safe to link and to bookmark.
//
// NOTHING IS FETCHED FOR THE CATALOG ITSELF — it is code (`lib/tasks/
// templates.ts`). The one read here is the plant's own stage, which only marks
// the group the planter is standing in.
// ============================================================================

export const dynamic = "force-dynamic";

export const metadata = {
  title: TEMPLATES_LINK_LABEL,
};

/**
 * The stored phase, narrowed to a phase the catalog can group by.
 *
 * `churches.current_phase` is a plain integer column, so a value outside 0–6
 * is representable. It marks a heading and nothing else, so an unknown number
 * means "mark nothing" rather than a crash on a page that would otherwise
 * render perfectly.
 */
function toPhaseNumber(value: number | undefined | null): PhaseNumber | null {
  if (value === null || value === undefined) return null;
  return value in PHASES ? (value as PhaseNumber) : null;
}

export default async function TaskTemplatesPage() {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  // A WRITE-ONLY ROUTE (AS-020, recipe rule 3). The catalog is a list of things
  // to CREATE — every row's only control is Import, which is `tasks.write` — so
  // a viewer who cannot import has nothing to do here and is sent back to the
  // list, rather than shown nineteen checklists with no way to take one.
  if (!holdsSeatFor(user, "tasks.write")) {
    redirect("/tasks");
  }

  // Church-scoped by construction: `getCurrentUserChurch` selects by the
  // session user's own `churchId` and is `React.cache`d, so the dashboard
  // layout has usually already paid for this read.
  const church = await getCurrentUserChurch();
  const breadcrumbs = [
    { label: "Tasks", href: "/tasks" },
    { label: TEMPLATES_LINK_LABEL },
  ];

  return (
    <>
      <HeaderBreadcrumbs items={breadcrumbs} />
      <PageCanvas
        contextAttachment="attached"
        contextItems={breadcrumbs}
        frameClassName="mx-auto w-full max-w-3xl"
      >
        <WorkspacePanel className="p-4 sm:p-6">
          <TaskTemplatePicker
            headingLevel="h1"
            currentPhase={toPhaseNumber(church?.currentPhase)}
          />
        </WorkspacePanel>
      </PageCanvas>
    </>
  );
}
