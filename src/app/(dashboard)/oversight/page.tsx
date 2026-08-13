// ============================================================================
// The oversight index — `/oversight`.
//
// The portfolio at a glance: how many plants, how they split either side of
// launch, and where they sit across the journey. It is deliberately NOT a second
// `/oversight/plants`: the projection stays the three columns it renders (#241),
// so adding a column here is a deliberate act rather than a `select()` dragging
// the whole `churches` row across the wire.
//
// THE ARITHMETIC IS NOT IN THIS FILE. The cards and the histogram used to count
// phases inline — `Array.from({ length: 7 })` for the bars and a bare `< 5` for
// the launch split — which was a second, hand-typed declaration of what
// `PHASES` already says. `churches.current_phase` is an unconstrained `integer`,
// so a value outside 0–6 was counted in the total, drawn in no bar, and
// bucketed as "launched" by accident. `summarizePortfolioPhases`
// (`@/lib/oversight/presentation`) derives the sequence from `PHASES` and folds
// any stray value in as its own row, so the bars always sum to the headline
// figure — and it is pure, so that promise is unit-tested.
// ============================================================================

import { inArray } from "drizzle-orm";
import Link from "next/link";

import { HeaderBreadcrumbs } from "@/components/header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { db } from "@/db";
import { churches } from "@/db/schema";
import { getAccessibleChurchIds } from "@/lib/auth/access";
import { scopeLabelForRole } from "@/lib/oversight/org-label";
import {
  LAUNCHED_CAPTION,
  PRE_LAUNCH_CAPTION,
  formatPhase,
  portfolioSpreadCaption,
  summarizePortfolioPhases,
} from "@/lib/oversight/presentation";
import { requireOversightUser } from "@/lib/oversight/session";

export default async function OversightDashboardPage() {
  // One guard, shared by every /oversight route (`@/lib/oversight/session`) —
  // this page used to carry its own copy of the role pair, as did the other
  // five.
  const user = await requireOversightUser();

  const churchIds = await getAccessibleChurchIds(user);

  // The projection is EXPLICIT (#241): this page renders three columns, and a
  // bare `select()` pulled the whole `churches` row — mission statement,
  // address, onboarding timestamps — across the wire on every load. That is
  // wasted bytes on an oversight surface whose whole point is that it shows
  // aggregates, and it is how a column nobody meant to expose ends up one
  // careless `{...plant}` away from the client. Adding a column here is now a
  // deliberate act.
  const plants =
    churchIds.length > 0
      ? await db
          .select({
            id: churches.id,
            name: churches.name,
            currentPhase: churches.currentPhase,
          })
          .from(churches)
          .where(inArray(churches.id, churchIds))
      : [];

  const portfolio = summarizePortfolioPhases(
    plants.map((plant) => plant.currentPhase)
  );

  const isNetwork = user.role === "network_admin";
  const scopeLabel = scopeLabelForRole(user.role);
  const title = isNetwork ? "Network Overview" : "Sending Church Portfolio";
  const description = isNetwork
    ? "Aggregate view across all church plants in your network"
    : "Overview of church plants sent by your church";

  return (
    <div className="space-y-6 p-6">
      {/*
        Same fix as /oversight/health (#261): without a declared trail the shell
        falls back to naming a different page ("Dashboard"). One crumb, because
        this IS the oversight index — nothing above it in the sidebar — and it
        carries the same role-derived `title` as the <h1> below, so the header
        and the page can never name different things. Renders nothing, so it
        does not participate in `space-y-6`.
      */}
      <HeaderBreadcrumbs items={[{ label: title }]} />
      <div>
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="text-muted-foreground mt-1">{description}</p>
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
            <p className="text-muted-foreground text-xs">
              {portfolio.total === 0
                ? "No church plants yet. Send invitations to get started."
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
            <p className="text-muted-foreground text-xs">{LAUNCHED_CAPTION}</p>
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
            <p className="text-muted-foreground py-8 text-center">
              No church plants associated yet.{" "}
              {/*
                This sentence named a page that did not exist until #23. Copy
                that points at a surface is a promise; the link is what keeps it.
              */}
              <Link
                href="/oversight/invitations"
                className="text-primary cursor-pointer underline underline-offset-4"
              >
                Invite a planter
              </Link>{" "}
              to get started.
            </p>
          ) : (
            <div className="space-y-3">
              {portfolio.distribution.map((row) => (
                <div key={row.phase} className="flex items-center gap-4">
                  <div className="w-48 text-sm font-medium">{row.label}</div>
                  {/*
                    A zero-count phase draws NO fill. The bar used to be
                    `Math.max(percentage, 2)%`, so every empty phase showed a
                    sliver — a visible claim that somebody is there, next to a
                    badge saying nobody is. An empty track is the honest answer,
                    and the count beside it is what carries the number.
                  */}
                  <div className="bg-muted h-2 flex-1 rounded-full">
                    {row.count > 0 ? (
                      <div
                        className="bg-primary h-2 rounded-full transition-all"
                        style={{ width: `${Math.max(row.percentage, 2)}%` }}
                      />
                    ) : null}
                  </div>
                  <Badge
                    variant="secondary"
                    className="min-w-12 justify-center tabular-nums"
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
                  <Badge variant="outline" className="shrink-0 tabular-nums">
                    Phase {plant.currentPhase}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
