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
}: {
  plants: OversightPlantSummary[];
  /** "network" or "sending church" — the caller's own org, in their words. */
  scopeLabel: string;
}) {
  return (
    <div className="space-y-8 p-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Church plants</h1>
        <p className="text-muted-foreground max-w-2xl text-pretty">
          Every plant associated with your {scopeLabel}. All of them are listed
          here — what each one shares beyond this row is the plant&apos;s own
          decision, and you will see it on their page.
        </p>
      </header>

      {plants.length === 0 ? (
        <EmptyDirectory scopeLabel={scopeLabel} />
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
    <li className="hover:border-foreground/25 hover:bg-accent/40 relative rounded-lg border p-5 transition-colors">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">
            <Link
              href={`/oversight/plants/${plant.churchId}`}
              className="cursor-pointer after:absolute after:inset-0 after:content-['']"
            >
              {plant.name}
            </Link>
          </h2>
          <p className="text-muted-foreground text-sm">
            {plant.location ?? "Location not set"}
          </p>
        </div>
        <Badge variant="outline" className="shrink-0">
          {formatPhase(plant.currentPhase)}
        </Badge>
      </div>

      <PlantFacts
        plant={plant}
        className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3"
      />
    </li>
  );
}

function EmptyDirectory({ scopeLabel }: { scopeLabel: string }) {
  return (
    <div className="rounded-lg border border-dashed p-10 text-center">
      <h2 className="font-semibold">No plants yet</h2>
      <p className="text-muted-foreground mx-auto mt-2 max-w-md text-sm text-pretty">
        A plant appears here once its planter accepts an invitation from your{" "}
        {scopeLabel}.
      </p>
      <p className="mt-4 text-sm">
        <Link
          href="/oversight/invitations"
          className="text-primary cursor-pointer underline underline-offset-4"
        >
          Invite a planter
        </Link>
      </p>
    </div>
  );
}
