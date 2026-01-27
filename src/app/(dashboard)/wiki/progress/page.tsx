import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { getArticles, getProgressStats, getLastInProgress } from "@/lib/wiki";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WikiBreadcrumb } from "@/components/wiki/wiki-breadcrumb";

// Force dynamic rendering - no caching
export const dynamic = "force-dynamic";

// Sort order matches sidebar navigation
const CATEGORY_NAMES: Record<string, { name: string; phase?: number; sortOrder: number }> = {
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
  const [articles, progressStats, lastInProgress] = await Promise.all([
    getArticles(),
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
      const stats = progressStats?.[category] ?? { completed: 0, inProgress: 0 };
      const info = CATEGORY_NAMES[category] ?? { name: category, sortOrder: 99 };
      const percentage = total > 0 ? Math.round((stats.completed / total) * 100) : 0;

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

  return (
    <div className="space-y-8">
      <WikiBreadcrumb items={breadcrumbs} />

      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">My Wiki Progress</h1>
        <p className="text-muted-foreground">
          Track your reading progress across all wiki content.
        </p>
      </div>

      {/* Overall Progress */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-medium">Overall Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                {totalCompleted} of {totalArticles} articles completed
              </span>
              <span className="font-medium">{overallPercentage}%</span>
            </div>
            <Progress value={overallPercentage} className="h-3" />
          </div>
        </CardContent>
      </Card>

      {/* By Category */}
      <div className="space-y-4">
        <h2 className="text-xl font-semibold">By Section</h2>
        <div className="space-y-3">
          {categoryRows.map((row) => (
            <div
              key={row.category}
              className="flex items-center gap-4 rounded-lg border p-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {row.phase !== undefined && (
                    <span className="text-xs text-muted-foreground">
                      Phase {row.phase}:
                    </span>
                  )}
                  <span className="font-medium truncate">{row.name}</span>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <Progress value={row.percentage} className="w-32 h-2" />
                <div className="flex items-center gap-1 text-sm text-muted-foreground w-24 justify-end">
                  {row.percentage === 100 ? (
                    <span className="flex items-center gap-1 text-green-600 dark:text-green-500">
                      <Check className="h-4 w-4" />
                      Complete
                    </span>
                  ) : (
                    <span>
                      {row.completed}/{row.total} ({row.percentage}%)
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Continue Reading */}
      {lastInProgress && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Continue Reading</h2>
          <Card>
            <CardContent className="p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1 flex-1 min-w-0">
                  <h3 className="font-medium truncate">{lastInProgress.title}</h3>
                  {lastInProgress.description && (
                    <p className="text-sm text-muted-foreground line-clamp-1">
                      {lastInProgress.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="capitalize">{lastInProgress.type}</span>
                    <span>{lastInProgress.readTime} min read</span>
                    <span>
                      {Math.round((lastInProgress.scrollPosition ?? 0) * 100)}%
                      complete
                    </span>
                  </div>
                </div>
                <Button asChild>
                  <Link href={`/wiki/${lastInProgress.slug}`}>
                    Continue
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Empty state */}
      {totalCompleted === 0 && totalInProgress === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="text-muted-foreground">
              You haven&apos;t started reading any wiki articles yet.
            </p>
            <Button asChild className="mt-4">
              <Link href="/wiki">Browse Wiki</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
