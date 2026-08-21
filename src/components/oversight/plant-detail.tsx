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
//
// THE STATS ARE A LEDGER, NOT A TILE GRID. Every section carries a different
// number of stats — eight for people, five for meetings, three for tasks and
// teams — so any fixed column count left one card with a clean rectangle and
// the next with an orphan, and the page had no rhythm down its length. A
// label-left / value-right row is identical in every card whatever the count.
// This is the case `better-layout` reserves a separator line for: the pair sits
// at opposite ends of a wide card and space alone cannot bind the two, so a
// single hairline between rows does the work no amount of margin can.
// ============================================================================

import { ChevronLeft, EyeOff, Inbox } from "lucide-react";
import Link from "next/link";

import { AssociationHistory } from "@/components/oversight/association-history";
import { PlantFacts } from "@/components/oversight/plant-facts";
import { RemovePlantDialog } from "@/components/oversight/remove-plant-dialog";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AssociationHistoryEntry } from "@/lib/invitations/history";
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
  history,
  canSever,
}: {
  detail: OversightPlantDetail;
  /** "network" or "sending church" — the caller's own org, in their words. */
  scopeLabel: string;
  /**
   * WHETHER THIS READER MAY REMOVE THE PLANT FROM THE PORTFOLIO (#500).
   *
   * The page used to render the dialog unconditionally, and its own comment
   * said why that was safe: an oversight admin reached a plant only through
   * their org's own FK, so the button appeared exactly when the caller's org
   * held the plant. That argument was about the PLANT and is still true. What
   * changed is the READER — an org now has Members, who reach this page in full
   * and may sever nothing (`org.association.sever` is Owner-only) — so the
   * question is no longer "is this plant yours" but "may you do this", and the
   * caller asks the capability table.
   */
  canSever: boolean;
  /**
   * This plant's association events WITH THE CALLER'S OWN ORG (OV-011), already
   * scoped by the read. Never another org's history.
   */
  history: AssociationHistoryEntry[];
}) {
  const { plant, sections } = detail;
  const sharedCount = sections.filter(
    (section) => section.state === "shared"
  ).length;

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <Link
        href="/oversight/plants"
        className="text-foreground hover:text-muted-foreground inline-flex cursor-pointer items-center gap-1 text-sm font-medium transition-colors"
      >
        <ChevronLeft className="size-4" aria-hidden="true" />
        All church plants
      </Link>

      {/*
        Identity and facts share ONE card rather than a bare header above a
        facts card. Two reasons, and the second is why it is a structural fix
        and not a preference: the name, its location, its phase and its four
        facts are one record and should read as one object; and the shell paints
        `bg-background`, where the muted role token measures 4.39:1 — under WCAG
        AA for normal text. On the card's white it measures 4.74:1 and passes.
        Putting the record on its own surface is what earns the secondary text
        its contrast, rather than promoting every gray to ink.
      */}
      <Card className="gap-0 py-0 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b p-6">
          <div className="min-w-0 space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {plant.name}
            </h1>
            {/*
              Stated even when absent, unlike the directory row: here it is the
              one plant the reader chose, so "we do not have this" is an answer
              rather than a line repeated down a list.
            */}
            <p className="text-muted-foreground text-sm">
              {plant.location ?? "Location not set"}
            </p>
          </div>
          {/*
            The badge and the sever sit together at the end of the header row —
            one is what this plant IS to the reader, the other is the only thing
            on this page that changes it. The destructive action is an outline
            button rather than a filled one, and it is nowhere near the top of
            the reading order: it is the rarest thing an admin does here.
          */}
          <div className="flex shrink-0 flex-wrap items-center gap-3">
            <Badge variant="secondary" className="font-medium">
              {formatPhase(plant.currentPhase)}
            </Badge>
            {/*
              OV-007b. Rendered from the SAME provenance the page's org scoping
              is built from, so the button appears exactly when the caller's own
              org holds this plant — which, on this page, is always: an oversight
              admin reaches a plant only through their org's own FK
              (`getAccessibleChurchIds`). Hiding it is never the control; the
              authority rule and the tenancy assertion are server-side.
            */}
            {canSever && (
              <RemovePlantDialog
                churchId={plant.churchId}
                plantName={plant.name}
                orgType={plant.provenance.orgType}
                orgName={plant.provenance.orgName}
              />
            )}
          </div>
        </div>
        <div className="p-6">
          <PlantFacts plant={plant} />
        </div>
      </Card>

      <section aria-labelledby="plant-aggregates" className="space-y-4">
        <div className="space-y-1">
          <h2
            id="plant-aggregates"
            className="text-lg font-semibold tracking-tight"
          >
            What {plant.name} shares
          </h2>
          {/*
            Ink, not the muted role. This sentence sits on the shell's
            `bg-background`, where muted measures 4.39:1 — below AA for normal
            text — and it is body copy that states the page's whole privacy
            contract, so it is the last thing that should be hard to read. Its
            hierarchy comes from size against the heading above it, not from
            being faded.
          */}
          <p className="text-foreground max-w-2xl text-sm text-pretty">
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

      {/*
        The heading this points at is the card's own visible title (design
        pass, #304). It used to be a `sr-only` h2 here duplicating that title
        word for word, so the section announced its name twice.
      */}
      <section aria-labelledby="plant-association-history">
        <AssociationHistory entries={history} plantName={plant.name} />
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
    <Card className="shadow-sm">
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
          <StatLedger stats={section.stats} />
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
    <div className="bg-muted/50 flex gap-3 rounded-lg border border-dashed p-4">
      <span className="text-muted-foreground mt-0.5 shrink-0">{icon}</span>
      <div className="space-y-1">
        <p className="text-foreground text-sm font-semibold">{headline}</p>
        <p className="text-muted-foreground text-sm text-pretty">{body}</p>
      </div>
    </div>
  );
}

function StatLedger({ stats }: { stats: OversightStat[] }) {
  return (
    <dl className="divide-border -my-2.5 divide-y">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="flex items-baseline justify-between gap-6 py-2.5"
        >
          <dt className="text-muted-foreground min-w-0 text-sm">
            {stat.label}
          </dt>
          {/*
            Value and hint share one <dd>: a `dl > div` wrapper may contain only
            `dt` and `dd`, so a sibling <p> here would be invalid markup and
            would break the term/description pairing a screen reader walks. The
            hint sits INLINE beside the number rather than under it — stacked
            and shrunk, "of 106 tasks" was a second tiny line the eye skipped.
          */}
          <dd className="flex shrink-0 items-baseline gap-2 text-right">
            <span className="text-foreground text-sm font-semibold tabular-nums">
              {stat.value}
            </span>
            {stat.hint ? (
              <span className="text-muted-foreground text-xs">{stat.hint}</span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
