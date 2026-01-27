import Link from "next/link";
import { BookOpen, Compass, Rocket } from "lucide-react";
import { getArticles } from "@/lib/wiki";
import { getCurrentUserChurch } from "@/lib/auth";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PhaseTimeline } from "@/components/wiki/phase-timeline";

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

  return (
    <div className="space-y-10">
      {/* Hero */}
      <div className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">
          Welcome to the Wiki
        </h1>
        <p className="text-lg text-muted-foreground">
          Your comprehensive guide to launching a healthy, fruitful church.
        </p>
      </div>

      {/* Quick Start Cards */}
      <div className="grid gap-4 md:grid-cols-2">
        <Link href="/wiki/getting-started/welcome-to-the-launch-playbook">
          <Card className="h-full transition-colors hover:bg-muted/50">
            <CardHeader>
              <Rocket className="mb-2 h-8 w-8 text-primary" />
              <CardTitle>Quick Start</CardTitle>
              <CardDescription>
                New to EveryField? Start here to get oriented.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>

        <Link href="/wiki/getting-started/launch-process-goals">
          <Card className="h-full transition-colors hover:bg-muted/50">
            <CardHeader>
              <Compass className="mb-2 h-8 w-8 text-primary" />
              <CardTitle>What Phase Am I In?</CardTitle>
              <CardDescription>
                Learn about the phases and where you are in the journey.
              </CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>

      {/* The Journey - Phase Timeline */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold tracking-tight">The Journey</h2>
        <div className="rounded-lg border bg-muted/30 p-6">
          <PhaseTimeline currentPhase={currentPhase} />
          <div className="mt-4 text-center">
            <p className="text-sm text-muted-foreground">
              You are currently in{" "}
              <span className="font-medium text-foreground">
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
              <span className="ml-2 text-lg font-normal text-muted-foreground">
                (Phase {currentPhase}: {PHASE_NAMES[currentPhase]})
              </span>
            </h2>
          </div>
          <div className="grid gap-3">
            {phaseArticles.slice(0, 6).map((article) => (
              <Link
                key={article.slug}
                href={`/wiki/${article.slug}`}
                className="group block rounded-lg border p-4 transition-colors hover:bg-muted/50"
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <h3 className="font-medium group-hover:text-primary">
                      {article.title}
                    </h3>
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {article.description}
                    </p>
                  </div>
                  <div className="ml-4 flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                    <span className="rounded-full bg-muted px-2 py-0.5 capitalize">
                      {article.type}
                    </span>
                    <span>{article.readTime} min</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
          {phaseArticles.length > 6 && (
            <p className="text-sm text-muted-foreground">
              View more Phase {currentPhase} articles in the sidebar navigation.
            </p>
          )}
        </div>
      )}

      {/* Empty State */}
      {articles.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <BookOpen className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium">No articles yet</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Wiki articles will appear here once they&apos;re added to the wiki
            directory.
          </p>
        </div>
      )}
    </div>
  );
}
