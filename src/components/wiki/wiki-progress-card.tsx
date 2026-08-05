// ============================================================================
// WikiProgressCard — the "My Wiki Progress" surface, as a pure view.
//
// Presentational server component. It does NO data access: everything it draws
// arrives as props, projected by whoever renders it. The dashboard page
// (app/(dashboard)/wiki/progress/page.tsx) projects it from `getArticles`,
// `getProgressStats` and `getLastInProgress`; the marketing site projects the
// same shape from a static fixture, so the landing page shows the real app
// surface rather than a redrawn imitation of it (#296).
//
// Constraints this file is written against:
//
// 1. NO CLIENT BOUNDARY, NO SERVER IMPORTS. There is no `"use client"` here and
//    nothing imported at value level reaches the database. `wikiHref` comes
//    from `@/lib/wiki/href` — the deliberately dependency-free module — and not
//    from the `@/lib/wiki` barrel, which re-exports the DB-backed progress
//    queries.
//
// 2. INTERACTIVITY ARRIVES AS A SLOT. The breadcrumb above the header is a
//    client component and is route-specific, so it is injected rather than
//    imported. Omitting it renders nothing at all, which is what an embed of
//    this surface wants.
//
// 3. THE PROPS ARE JSON. Plain scalars, arrays and nulls — no class instances,
//    no Dates — so a fixture can be written by hand and type-checked.
// ============================================================================

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";

import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { wikiHref } from "@/lib/wiki/href";
import type { ArticleType } from "@/lib/wiki/types";

/** One row of the "By Section" list: a wiki category and how far it is read. */
export interface WikiProgressSection {
  /** Category slug — the React key, never rendered. */
  category: string;
  /** Human label for the category. */
  name: string;
  /** Journey phase number, when the category is one of the seven phases. */
  phase?: number;
  total: number;
  completed: number;
  /** Whole percent, already rounded by the projector. */
  percentage: number;
}

/** The article the reader left off in, as the "Continue Reading" card needs it. */
export interface WikiProgressContinueItem {
  slug: string;
  title: string;
  description?: string | null;
  type: ArticleType | string;
  readTime: number;
  /** 0–1 fraction of the article scrolled. */
  scrollPosition?: number | null;
}

export interface WikiProgressCardProps {
  totalArticles: number;
  totalCompleted: number;
  totalInProgress: number;
  /** Whole percent, already rounded by the projector. */
  overallPercentage: number;
  /** Category rows in display order — this view does not sort. */
  sections: WikiProgressSection[];
  lastInProgress: WikiProgressContinueItem | null;
  /** Route-specific breadcrumb (a client component in the app). */
  breadcrumbSlot?: ReactNode;
}

export function WikiProgressCard({
  totalArticles,
  totalCompleted,
  totalInProgress,
  overallPercentage,
  sections,
  lastInProgress,
  breadcrumbSlot,
}: WikiProgressCardProps) {
  return (
    <div className="space-y-8">
      {breadcrumbSlot}

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
          <CardTitle className="text-lg font-medium">
            Overall Progress
          </CardTitle>
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
          {sections.map((row) => (
            <div
              key={row.category}
              className="flex items-center gap-4 rounded-lg border p-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {row.phase !== undefined && (
                    <span className="text-muted-foreground text-xs">
                      Phase {row.phase}:
                    </span>
                  )}
                  <span className="truncate font-medium">{row.name}</span>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <Progress value={row.percentage} className="h-2 w-32" />
                <div className="text-muted-foreground flex w-24 items-center justify-end gap-1 text-sm">
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
                <div className="min-w-0 flex-1 space-y-1">
                  <h3 className="truncate font-medium">
                    {lastInProgress.title}
                  </h3>
                  {lastInProgress.description && (
                    <p className="text-muted-foreground line-clamp-1 text-sm">
                      {lastInProgress.description}
                    </p>
                  )}
                  <div className="text-muted-foreground flex items-center gap-3 text-xs">
                    <span className="capitalize">{lastInProgress.type}</span>
                    <span>{lastInProgress.readTime} min read</span>
                    <span>
                      {Math.round((lastInProgress.scrollPosition ?? 0) * 100)}%
                      complete
                    </span>
                  </div>
                </div>
                <Button asChild>
                  <Link href={wikiHref(lastInProgress.slug)}>
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
