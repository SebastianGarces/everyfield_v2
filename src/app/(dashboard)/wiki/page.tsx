import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ArticleProgressBadge } from "@/components/wiki/article-progress-badge";
import { BookmarkIndicator } from "@/components/wiki/bookmark-indicator";
import { PhaseTimeline } from "@/components/wiki/phase-timeline";
import { getCurrentUserChurch } from "@/lib/auth";
import {
  getArticles,
  getArticlesProgress,
  getBookmarkedSlugs,
} from "@/lib/wiki";
import { BarChart3, BookOpen, Compass, Rocket } from "lucide-react";
import Link from "next/link";

// Force dynamic rendering for progress data
export const dynamic = "force-dynamic";

const PHASE_NAMES: Record<number, string> = {
  0: "Discovery",
  1: "Core Group Development",
  2: "Launch Team Formation",
  3: "Training & Preparation",
  4: "Pre-Launch",
  5: "Launch Sunday",
  6: "Post-Launch",
};

export default async function WikiPage() {
  const [articles, church] = await Promise.all([
    getArticles(),
    getCurrentUserChurch(),
  ]);

  // Default to phase 0 if no church
  const currentPhase = church?.currentPhase ?? 0;

  // Get articles for the current phase
  const phaseArticles = articles.filter((a) => a.phase === currentPhase);

  // Get progress and bookmarks for all phase articles
  const articleSlugs = phaseArticles.map((a) => a.slug);
  const [progressMap, bookmarkedSlugs] = await Promise.all([
    getArticlesProgress(articleSlugs),
    getBookmarkedSlugs(articleSlugs),
  ]);

  // Filter out completed articles and take first 6
  const displayedArticles = phaseArticles
    .filter((a) => progressMap.get(a.slug)?.status !== "completed")
    .slice(0, 6);

  return (
    <div className="space-y-10">
      {/* Hero */}
      <div className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">
          Welcome to the Wiki
        </h1>
        <p className="text-muted-foreground text-lg">
          Your comprehensive guide to launching a healthy, fruitful church.
        </p>
      </div>

      {/* Quick Start Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Link href="/wiki/getting-started/welcome-to-the-launch-playbook">
          <Card className="hover:bg-muted/50 h-full transition-colors">
            <CardHeader>
              <Rocket className="text-primary mb-2 h-8 w-8" />
              <CardTitle>Quick Start</CardTitle>
              <CardDescription>
                New to EveryField? Start here to get oriented.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/wiki/getting-started/launch-process-goals">
          <Card className="hover:bg-muted/50 h-full transition-colors">
            <CardHeader>
              <Compass className="text-primary mb-2 h-8 w-8" />
              <CardTitle>What Phase Am I In?</CardTitle>
              <CardDescription>
                Learn about the phases and where you are in the journey.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/wiki/progress">
          <Card className="hover:bg-muted/50 h-full transition-colors">
            <CardHeader>
              <BarChart3 className="text-primary mb-2 h-8 w-8" />
              <CardTitle>My Progress</CardTitle>
              <CardDescription>
                Track your reading progress across all wiki content.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>

      {/* The Journey - Phase Timeline */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">The Journey</h2>
        <div className="bg-muted/40 rounded-lg border p-6">
          <PhaseTimeline currentPhase={currentPhase} />
          <div className="mt-4 text-center">
            <p className="text-muted-foreground text-sm">
              You are currently in{" "}
              <span className="text-foreground font-medium">
                Phase {currentPhase}: {PHASE_NAMES[currentPhase]}
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* Recommended for Current Phase */}
      {phaseArticles.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-semibold tracking-tight">
              Recommended for You
              <span className="text-muted-foreground ml-2 text-lg font-normal">
                (Phase {currentPhase}: {PHASE_NAMES[currentPhase]})
              </span>
            </h2>
          </div>
          <div className="grid gap-3">
            {displayedArticles.map((article) => {
              const progress = progressMap.get(article.slug);
              const isBookmarked = bookmarkedSlugs.has(article.slug);
              return (
                <Link
                  key={article.slug}
                  href={`/wiki/${article.slug}`}
                  className="group hover:bg-muted/50 block rounded-lg border p-4 transition-colors"
                >
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <h3 className="group-hover:text-primary font-medium">
                        {article.title}
                      </h3>
                      <p className="text-muted-foreground line-clamp-2 text-sm">
                        {article.description}
                      </p>
                      <div className="mt-2 flex items-center gap-2">
                        {isBookmarked && <BookmarkIndicator />}
                        <ArticleProgressBadge
                          status={progress?.status ?? "not_started"}
                        />
                      </div>
                    </div>
                    <div className="text-muted-foreground ml-4 flex shrink-0 flex-col items-end gap-1 text-xs">
                      <span className="bg-muted rounded-full px-2 py-0.5 capitalize">
                        {article.type}
                      </span>
                      <span>{article.readTime} min</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
          {phaseArticles.length > 6 && (
            <p className="text-muted-foreground text-sm">
              View more Phase {currentPhase} articles in the sidebar navigation.
            </p>
          )}
        </div>
      )}

      {/* Empty State */}
      {articles.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <BookOpen className="text-muted-foreground mx-auto h-12 w-12" />
          <h3 className="mt-4 text-lg font-medium">No articles yet</h3>
          <p className="text-muted-foreground mt-2 text-sm">
            Wiki articles will appear here once they&apos;re added to the wiki
            directory.
          </p>
        </div>
      )}
    </div>
  );
}
