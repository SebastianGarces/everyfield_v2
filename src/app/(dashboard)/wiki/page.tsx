import Link from "next/link";
import { BookOpen, Compass, Rocket } from "lucide-react";
import { getArticles } from "@/lib/wiki";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function WikiPage() {
  const articles = await getArticles();

  // Group articles by phase for display
  const phase1Articles = articles.filter((a) => a.phase === 1);

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">
          Welcome to the Wiki
        </h1>
        <p className="text-lg text-muted-foreground">
          Your comprehensive guide to launching a healthy, fruitful church.
          Learn from predecessors, customize your approach, and contribute back.
        </p>
      </div>

      {/* Quick Start Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="transition-colors hover:bg-muted/50">
          <CardHeader>
            <Rocket className="mb-2 h-8 w-8 text-primary" />
            <CardTitle>Quick Start</CardTitle>
            <CardDescription>
              New to EveryField? Start here to get oriented.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card className="transition-colors hover:bg-muted/50">
          <CardHeader>
            <Compass className="mb-2 h-8 w-8 text-primary" />
            <CardTitle>What Phase Am I In?</CardTitle>
            <CardDescription>
              Not sure which phase you're in? Let's figure it out together.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card className="transition-colors hover:bg-muted/50">
          <CardHeader>
            <BookOpen className="mb-2 h-8 w-8 text-primary" />
            <CardTitle>Browse Topics</CardTitle>
            <CardDescription>
              Explore all wiki content organized by topic.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

      {/* Phase 1 Articles */}
      {phase1Articles.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold tracking-tight">
            Phase 1: Core Group Development
          </h2>
          <div className="grid gap-3">
            {phase1Articles.map((article) => (
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
        </div>
      )}

      {/* Empty State */}
      {articles.length === 0 && (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <BookOpen className="mx-auto h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium">No articles yet</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Wiki articles will appear here once they're added to the wiki
            directory.
          </p>
        </div>
      )}
    </div>
  );
}
