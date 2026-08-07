// ============================================================================
// PlantDetail — `/oversight/plants/[id]` (OV-002), minus auth and data access.
//
// Presentational and pure: the page owns the role guard, the membership check
// and the privacy-gated read. By the time a section reaches this file the
// decision has already been made — a `withheld` section arrives with NO
// numbers attached, so there is nothing here that could render them by mistake.
//
// THE THREE STATES A SECTION CAN BE IN, and why they are three and not two:
//
//   shared, with data → the numbers.
//   shared, empty     → "Nothing recorded yet". They opened this to you; there
//                       is simply nothing in it.
//   withheld          → "Not shared", plus who decides that (the plant).
//
// Collapsing the middle one into the last would tell an admin that a plant is
// hiding something when it is not — the misreading most likely to cost the
// relationship a conversation. Neither empty state is ever a bare blank, which
// is the requirement OV-002 states outright.
// ============================================================================

import { ChevronLeft, EyeOff, Inbox } from "lucide-react";
import Link from "next/link";

import { PlantFacts } from "@/components/oversight/plant-facts";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatPhase } from "@/lib/oversight/presentation";
import {
  EMPTY_HEADLINE,
  OVERSIGHT_SECTIONS_BY_KEY,
  WITHHELD_HEADLINE,
  emptyExplanation,
  sectionsIntro,
  withheldExplanation,
} from "@/lib/oversight/sections";
import type {
  OversightPlantDetail,
  OversightSectionResult,
  OversightStat,
} from "@/lib/oversight/types";

export function PlantDetail({
  detail,
  scopeLabel,
}: {
  detail: OversightPlantDetail;
  /** "network" or "sending church" — the caller's own org, in their words. */
  scopeLabel: string;
}) {
  const { plant, sections } = detail;
  const sharedCount = sections.filter(
    (section) => section.state === "shared"
  ).length;

  return (
    <div className="space-y-8 p-6">
      <header className="space-y-4">
        <Link
          href="/oversight/plants"
          className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1 text-sm"
        >
          <ChevronLeft className="size-4" aria-hidden="true" />
          All church plants
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h1 className="text-3xl font-bold tracking-tight">{plant.name}</h1>
            <p className="text-muted-foreground">
              {plant.location ?? "Location not set"}
            </p>
          </div>
          <Badge variant="outline" className="shrink-0">
            {formatPhase(plant.currentPhase)}
          </Badge>
        </div>

        <PlantFacts plant={plant} />
      </header>

      <section aria-labelledby="plant-aggregates" className="space-y-4">
        <div className="space-y-1">
          <h2
            id="plant-aggregates"
            className="text-lg font-semibold tracking-tight"
          >
            What {plant.name} shares
          </h2>
          <p className="text-muted-foreground max-w-2xl text-sm text-pretty">
            {sectionsIntro(plant.name, scopeLabel, sharedCount)}
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {sections.map((section) => (
            <SectionCard
              key={section.key}
              section={section}
              plantName={plant.name}
              scopeLabel={scopeLabel}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function SectionCard({
  section,
  plantName,
  scopeLabel,
}: {
  section: OversightSectionResult;
  plantName: string;
  scopeLabel: string;
}) {
  const definition = OVERSIGHT_SECTIONS_BY_KEY[section.key];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{definition.title}</CardTitle>
        <CardDescription className="text-pretty">
          {definition.description}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {section.state === "withheld" ? (
          <SectionNotice
            icon={<EyeOff className="size-4" aria-hidden="true" />}
            headline={WITHHELD_HEADLINE}
            body={withheldExplanation(definition, plantName, scopeLabel)}
          />
        ) : section.isEmpty ? (
          <SectionNotice
            icon={<Inbox className="size-4" aria-hidden="true" />}
            headline={EMPTY_HEADLINE}
            body={emptyExplanation(definition, plantName)}
          />
        ) : (
          <StatGrid stats={section.stats} />
        )}
      </CardContent>
    </Card>
  );
}

/**
 * An explain-why empty state. Always a headline AND a reason — a headline on
 * its own ("Not shared") leaves the admin to guess whether that is a setting,
 * a bug, or something they can change themselves.
 */
function SectionNotice({
  icon,
  headline,
  body,
}: {
  icon: React.ReactNode;
  headline: string;
  body: string;
}) {
  return (
    <div className="bg-muted/40 text-muted-foreground flex gap-3 rounded-md border border-dashed p-4">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="space-y-1">
        <p className="text-foreground text-sm font-medium">{headline}</p>
        <p className="text-sm text-pretty">{body}</p>
      </div>
    </div>
  );
}

function StatGrid({ stats }: { stats: OversightStat[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
      {stats.map((stat) => (
        <div key={stat.label} className="min-w-0 space-y-0.5">
          <dt className="text-muted-foreground text-xs tracking-wide uppercase">
            {stat.label}
          </dt>
          {/*
            The hint lives INSIDE the <dd>: a `dl > div` wrapper may contain
            only `dt` and `dd`, so a sibling <p> here would be invalid markup
            and would break the term/description pairing a screen reader walks.
          */}
          <dd className="text-lg font-semibold tabular-nums">
            {stat.value}
            {stat.hint ? (
              <span className="text-muted-foreground block text-xs font-normal">
                {stat.hint}
              </span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
