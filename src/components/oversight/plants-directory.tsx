// ============================================================================
// PlantsDirectory — `/oversight/plants` (OV-001), minus auth and data access.
//
// Presentational and pure: it receives the already-scoped roster from the page,
// which owns the role guard and the read. Nothing here decides who may see a
// plant.
//
// THE LISTING IS NOT PRIVACY-GATED, and that is deliberate rather than an
// oversight: a plant appears here for its associated org whatever its six
// `share_*` toggles say, because those gate feature data INSIDE a plant, not
// the plant's existence (memory/invariants.md → Hierarchical Access Control).
// The header says so in one line, so an admin is never left guessing whether a
// short list means "few plants" or "several hiding".
//
// THE PAGE IS CAPPED, NOT FLUID. `container mx-auto max-w-6xl` is the same
// wrapper `/phase` uses — the app's existing shape for a read-dense page. Left
// fluid, a row spread its three facts across ~2000px on a wide display and the
// eye could no longer carry a label to its value.
//
// A ROW IS A SURFACE, NOT A HAIRLINE. The dashboard shell paints
// `bg-background`, so a row drawn with `border` alone was a 1.17:1 edge on a
// near-identical field — invisible at arm's length. Rows now use the same
// `bg-card` + `border` + `shadow-sm` recipe as the panels on /people and
// /tasks, so the card carries a real surface and the elevation does the
// separating.
//
// The whole card is clickable through the title link's `after:` overlay rather
// than by wrapping the card in an anchor: the accessible name of the link stays
// the plant's name instead of a paragraph of facts read aloud in sequence.
// ============================================================================

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { PlantFacts } from "@/components/oversight/plant-facts";
import { formatPhase } from "@/lib/oversight/presentation";
import type { OversightPlantSummary } from "@/lib/oversight/types";

export function PlantsDirectory({
  plants,
  scopeLabel,
  canInvite,
}: {
  plants: OversightPlantSummary[];
  /** "network" or "sending church" — the caller's own org, in their words. */
  scopeLabel: string;
  /**
   * WHETHER THIS READER MAY ACTUALLY SEND THAT INVITATION (#500).
   *
   * The empty state's call to action is a promise, and an org MEMBER cannot
   * keep it — `org.invitation.manage` is Owner-only, so the form behind the
   * link is not rendered for them. Without this the emptiest screen in the
   * product would hand a Member the one control they may not use.
   */
  canInvite: boolean;
}) {
  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Church plants
        </h1>
        {/*
          Ink, not the muted role: this paragraph sits on the shell's
          `bg-background`, where muted measures 4.39:1 — below WCAG AA for
          normal text. Its subordination to the heading comes from size, which
          is free, rather than from a gray that costs legibility.
        */}
        <p className="text-foreground max-w-2xl text-sm text-pretty">
          Every plant associated with your {scopeLabel}. All of them are listed
          here — what each one shares beyond this row is the plant&apos;s own
          decision, and you will see it on their page.
        </p>
      </header>

      {plants.length === 0 ? (
        <EmptyDirectory scopeLabel={scopeLabel} canInvite={canInvite} />
      ) : (
        <ul className="grid gap-4">
          {plants.map((plant) => (
            <PlantRow key={plant.churchId} plant={plant} />
          ))}
        </ul>
      )}
    </div>
  );
}

function PlantRow({ plant }: { plant: OversightPlantSummary }) {
  return (
    <li className="bg-card hover:border-foreground/20 relative space-y-4 rounded-xl border p-5 shadow-sm transition-[border-color,box-shadow] hover:shadow-md">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-xl font-semibold tracking-tight">
            <Link
              href={`/oversight/plants/${plant.churchId}`}
              className="cursor-pointer after:absolute after:inset-0 after:content-['']"
            >
              {plant.name}
            </Link>
          </h2>
          {/*
            An unset location renders NOTHING here rather than "Location not
            set". Repeated verbatim down every row, that line carried no
            information and competed with the plant's own name for the eye. The
            detail page still states it outright — there it is a fact about the
            one plant you are reading, not noise multiplied by the row count.
          */}
          {plant.location ? (
            <p className="text-muted-foreground text-sm">{plant.location}</p>
          ) : null}
        </div>
        {/*
          Filled, not outlined. Phase is the one attribute an admin compares
          straight down the list, so it holds a fixed trailing position and
          needs enough weight to be found there — an outline chip on a white
          card had neither containment nor presence.
        */}
        <Badge variant="secondary" className="shrink-0 font-medium">
          {formatPhase(plant.currentPhase)}
        </Badge>
      </div>

      <PlantFacts plant={plant} />
    </li>
  );
}

function EmptyDirectory({
  scopeLabel,
  canInvite,
}: {
  scopeLabel: string;
  canInvite: boolean;
}) {
  return (
    <div className="bg-card rounded-xl border border-dashed p-10 text-center">
      <h2 className="font-semibold">No plants yet</h2>
      <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm text-pretty">
        A plant appears here once its planter accepts an invitation from your{" "}
        {scopeLabel}.
      </p>
      {/* The sentence above is true for everyone; the call to action is only
          offered to whoever can answer it. */}
      {canInvite && (
        <p className="mt-4 text-sm">
          <Link
            href="/oversight/invitations"
            className="text-primary cursor-pointer font-medium underline underline-offset-4"
          >
            Invite a planter
          </Link>
        </p>
      )}
    </div>
  );
}
