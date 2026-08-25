// ============================================================================
// The oversight index — `/oversight`.
//
// The portfolio at a glance: how many plants, how they split either side of
// launch, and where they sit across the journey. It is deliberately NOT a second
// `/oversight/plants`.
//
// THE READ IS NOT IN THIS FILE, and that was the half that mattered. This page
// carried `db`, `churches` and `inArray` and ran its own tenant-scoped query,
// which made it the only surface in the domain reading the database from an RSC.
// Its tenancy and its #241 projection could then be pinned only by a regex over
// this file's TEXT — a test that broke on a variable rename, lived in a suite
// named for another module, and could not see the WHERE clause at all.
// `getOversightPortfolio` (`@/lib/oversight/read`) owns both decisions now,
// beside every other oversight read, and `read.test.ts` RENDERS the statement to
// assert them. Nothing below imports a data layer; this file only renders.
//
// THE ARITHMETIC IS NOT IN THIS FILE EITHER. The cards and the histogram used
// to count phases inline — `Array.from({ length: 7 })` for the bars and a bare
// `< 5` for the launch split — which was a second, hand-typed declaration of
// what `PHASES` already says. `churches.current_phase` is an unconstrained
// `integer`, so a value outside 0–6 was counted in the total, drawn in no bar,
// and bucketed as "launched" by accident. `summarizePortfolioPhases`
// (`@/lib/oversight/presentation`) derives the sequence from `PHASES` and folds
// any stray value in as its own row, so the bars always sum to the headline
// figure — and it is pure, so that promise is unit-tested.
// ============================================================================

import Link from "next/link";

import { HeaderBreadcrumbs } from "@/components/header";
import { PageCanvas } from "@/components/layout/page-frame";
import { EmptyPortfolio } from "@/components/oversight/empty-portfolio";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { scopeLabelForOrgType } from "@/lib/oversight/org-label";
import {
  EMPTY_PORTFOLIO_HEADLINE,
  LAUNCHED_CAPTION,
  PRE_LAUNCH_CAPTION,
  formatPhase,
  portfolioSpreadCaption,
  summarizePortfolioPhases,
} from "@/lib/oversight/presentation";
import { getOversightPortfolio } from "@/lib/oversight/read";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import { requireOversightUser } from "@/lib/oversight/session";

export default async function OversightDashboardPage() {
  // One guard, shared by every /oversight route (`@/lib/oversight/session`) —
  // this page used to carry its own copy of the oversight test, as did the
  // other five. It hands back the caller's org as well as their row, so the
  // two lines below name it instead of re-deriving it.
  const { user, org } = await requireOversightUser();

  // Tenant scope and projection both belong to the read layer
  // (`@/lib/oversight/read`), which is where every other oversight surface asks
  // its question — and where the two decisions are assertable from a rendered
  // statement instead of from this file's text.
  const plants = await getOversightPortfolio(user);

  const portfolio = summarizePortfolioPhases(
    plants.map((plant) => plant.currentPhase)
  );

  const isNetwork = org.type === "network";
  const scopeLabel = scopeLabelForOrgType(org.type);
  const title = isNetwork ? "Network Overview" : "Sending Church Portfolio";
  const description = isNetwork
    ? "Aggregate view across all church plants in your network"
    : "Overview of church plants sent by your church";

  return (
    <>
      {/*
        Same fix as /oversight/health (#261): without a declared trail the shell
        falls back to naming a different page ("Dashboard"). One crumb, because
        this IS the oversight index — nothing above it in the sidebar — and it
        carries the same org-derived `title` as the <h1> below, so the header
        and the page can never name different things. Renders nothing, so it
        does not participate in `space-y-6`.
      */}
      <HeaderBreadcrumbs items={[{ label: title }]} />
      <PageCanvas context="none" contentFocusTarget>
        <div
          data-slot="oversight-sibling-surfaces"
          className="mx-auto min-h-full max-w-6xl space-y-6"
        >
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <p className="text-foreground mt-1 text-sm">{description}</p>
          </div>

          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Church Plants</CardDescription>
                <CardTitle className="text-4xl tabular-nums">
                  {portfolio.total}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/*
              ORIENTATION ONLY, in this slot (#636). The old caption ordered the
              reader to send invitations, which an org Member may not do. What
              replaces it is not the full sentence either: this is a 12px line
              in a third of a grid row, its other branch is a 15-character
              count, and the Plants by Phase block below already says the long
              version — the same sentence twice in one viewport reads as a
              rendering fault.
            */}
                <p className="text-muted-foreground text-xs">
                  {portfolio.total === 0
                    ? EMPTY_PORTFOLIO_HEADLINE
                    : portfolioSpreadCaption(portfolio)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Pre-Launch</CardDescription>
                <CardTitle className="text-4xl tabular-nums">
                  {portfolio.preLaunch}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {/*
              The caption names the BOUNDARY, not the phases either side of it:
              "Plants in phases 0-4" was a second copy of the phase list that
              went stale the moment `PHASES` grew.
            */}
                <p className="text-muted-foreground text-xs">
                  {PRE_LAUNCH_CAPTION}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Launched</CardDescription>
                <CardTitle className="text-4xl tabular-nums">
                  {portfolio.launched}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-xs">
                  {LAUNCHED_CAPTION}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Plants by Phase */}
          <Card>
            <CardHeader>
              <CardTitle>Plants by Phase</CardTitle>
              <CardDescription>
                Distribution of church plants across the launch journey
              </CardDescription>
            </CardHeader>
            <CardContent>
              {portfolio.total === 0 ? (
                /*
              The words and the seat gate belong to `EmptyPortfolio`, shared
              with `/oversight/plants` (#636). They were written out here as
              well, and the two copies had already drifted — which is the same
              way the Owner-only instruction in the card above outlived #500.
              Copy that points at a surface is a promise; the link is what keeps
              it, and since #500 the promise is only made to whoever can keep it
              (`org.invitation.manage` is Owner-only).
            */
                <div className="py-8 text-center">
                  <EmptyPortfolio
                    scopeLabel={scopeLabel}
                    canInvite={holdsSeatFor(user, "org.invitation.manage")}
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  {portfolio.distribution.map((row) => (
                    <div
                      key={row.phase}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 sm:grid-cols-[12rem_minmax(0,1fr)_auto] sm:gap-4"
                    >
                      <div className="min-w-0 text-sm font-medium">
                        {row.label}
                      </div>
                      {/*
                    A zero-count phase draws NO fill. The bar used to be
                    `Math.max(percentage, 2)%`, so every empty phase showed a
                    sliver — a visible claim that somebody is there, next to a
                    badge saying nobody is. An empty track is the honest answer,
                    and the count beside it is what carries the number.
                  */}
                      <div className="bg-muted col-span-2 row-start-2 h-2 rounded-full sm:col-span-1 sm:row-auto">
                        {row.count > 0 ? (
                          <div
                            className="bg-primary h-2 rounded-full transition-[width]"
                            style={{ width: `${Math.max(row.percentage, 2)}%` }}
                          />
                        ) : null}
                      </div>
                      <Badge
                        variant="secondary"
                        className="col-start-2 row-start-1 min-w-12 justify-center tabular-nums sm:col-auto sm:row-auto"
                      >
                        {row.count}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Church Plants List */}
          {portfolio.total > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Church Plants</CardTitle>
                <CardDescription>
                  All church plants in your {scopeLabel}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {plants.map((plant) => (
                    <div
                      key={plant.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="min-w-0">
                        {/*
                      The row links to the plant it names. It used to be inert —
                      the same plants are clickable one nav item away on
                      /oversight/plants, so a dead row here read as a surface
                      that had lost its links rather than as a summary.
                    */}
                        <p className="truncate font-medium">
                          <Link
                            href={`/oversight/plants/${plant.id}`}
                            className="cursor-pointer hover:underline hover:underline-offset-4"
                          >
                            {plant.name}
                          </Link>
                        </p>
                        {/*
                      `formatPhase`, never a bare `PHASES[...]` lookup: the
                      column is an unconstrained integer, and the raw lookup
                      rendered an out-of-range value as an empty cell.
                    */}
                        <p className="text-muted-foreground text-sm">
                          {formatPhase(plant.currentPhase)}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className="shrink-0 tabular-nums"
                      >
                        Phase {plant.currentPhase}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </PageCanvas>
    </>
  );
}
