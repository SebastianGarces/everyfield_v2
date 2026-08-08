import { getCurrentSession } from "@/lib/auth";
import { getArticles, getProgressStats, getLastInProgress } from "@/lib/wiki";
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
  // Scoped to the reader's church (#317). The denominators on this page are
  // counts of articles, so an unscoped read would measure progress against a
  // corpus the user cannot see: a church with its own articles would show a
  // percentage that can never reach 100.
  const { user } = await getCurrentSession();

  const [articles, progressStats, lastInProgress] = await Promise.all([
    getArticles(user?.churchId ?? null),
    getProgressStats(),
    getLastInProgress(),
  ]);

  // Group articles by category to get totals
  const articlesByCategory: Record<string, number> = {};
  for (const article of articles) {
    const category = article.slug.split("/")[0] ?? "other";
    articlesByCategory[category] = (articlesByCategory[category] ?? 0) + 1;
  }

  // Calculate overall stats
  const totalArticles = articles.length;
  let totalCompleted = 0;
  let totalInProgress = 0;

  if (progressStats) {
    for (const stats of Object.values(progressStats)) {
      totalCompleted += stats.completed;
      totalInProgress += stats.inProgress;
    }
  }

  const overallPercentage =
    totalArticles > 0 ? Math.round((totalCompleted / totalArticles) * 100) : 0;

  // Build category rows for display
  const categoryRows = Object.entries(articlesByCategory)
    .map(([category, total]) => {
      const stats = progressStats?.[category] ?? {
        completed: 0,
        inProgress: 0,
      };
      const info = CATEGORY_NAMES[category] ?? {
        name: category,
        sortOrder: 99,
      };
      const percentage =
        total > 0 ? Math.round((stats.completed / total) * 100) : 0;

      return {
        category,
        name: info.name,
        phase: info.phase,
        sortOrder: info.sortOrder,
        total,
        completed: stats.completed,
        inProgress: stats.inProgress,
        percentage,
      };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);

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
