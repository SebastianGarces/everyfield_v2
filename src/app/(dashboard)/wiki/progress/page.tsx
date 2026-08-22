import { getProgressStats, getLastInProgress } from "@/lib/wiki";
import { WikiBreadcrumb } from "@/components/wiki/wiki-breadcrumb";
import { WikiProgressCard } from "@/components/wiki/wiki-progress-card";

// Force dynamic rendering - no caching
export const dynamic = "force-dynamic";

// Sort order matches sidebar navigation
const CATEGORY_NAMES: Record<
  string,
  { name: string; phase?: number; sortOrder: number }
> = {
  // Getting Started first
  "getting-started": { name: "Getting Started", sortOrder: 0 },
  // The Journey - phases 0-6
  discovery: { name: "Discovery", phase: 0, sortOrder: 1 },
  "core-group": { name: "Core Group Development", phase: 1, sortOrder: 2 },
  "launch-team": { name: "Launch Team Formation", phase: 2, sortOrder: 3 },
  training: { name: "Training & Preparation", phase: 3, sortOrder: 4 },
  "pre-launch": { name: "Pre-Launch", phase: 4, sortOrder: 5 },
  "launch-sunday": { name: "Launch Sunday", phase: 5, sortOrder: 6 },
  "post-launch": { name: "Post-Launch", phase: 6, sortOrder: 7 },
  // Frameworks & Concepts
  frameworks: { name: "Frameworks & Concepts", sortOrder: 8 },
  // Reference (last)
  administrative: { name: "Reference", sortOrder: 9 },
};

export default async function WikiProgressPage() {
  // One read, one population (#631). `getProgressStats` counts the reader's
  // progress against the corpus its own church-scoped list can show, so the
  // totals below and the counts inside them cannot describe different sets of
  // articles — which is what let this page render "12 of 10 completed / 120%".
  const [progressStats, lastInProgress] = await Promise.all([
    getProgressStats(),
    getLastInProgress(),
  ]);

  // Build category rows for display
  const categoryRows = Object.entries(progressStats)
    .map(([category, stats]) => {
      const info = CATEGORY_NAMES[category] ?? {
        name: category,
        sortOrder: 99,
      };
      const percentage =
        stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

      return {
        category,
        name: info.name,
        phase: info.phase,
        sortOrder: info.sortOrder,
        total: stats.total,
        completed: stats.completed,
        inProgress: stats.inProgress,
        percentage,
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);

  // The overall numbers are the category rows summed, so the header and the
  // "By Section" list are the same arithmetic at two grains.
  let totalArticles = 0;
  let totalCompleted = 0;
  let totalInProgress = 0;

  for (const row of categoryRows) {
    totalArticles += row.total;
    totalCompleted += row.completed;
    totalInProgress += row.inProgress;
  }

  const overallPercentage =
    totalArticles > 0 ? Math.round((totalCompleted / totalArticles) * 100) : 0;

  const breadcrumbs = [
    { label: "Wiki", href: "/wiki" },
    { label: "My Progress", href: "/wiki/progress" },
  ];

  // Everything above is projection; the markup lives in the presentational
  // view so the marketing site can render the same surface from a fixture.
  return (
    <WikiProgressCard
      breadcrumbSlot={<WikiBreadcrumb items={breadcrumbs} />}
      totalArticles={totalArticles}
      totalCompleted={totalCompleted}
      totalInProgress={totalInProgress}
      overallPercentage={overallPercentage}
      sections={categoryRows}
      lastInProgress={lastInProgress}
    />
  );
}
