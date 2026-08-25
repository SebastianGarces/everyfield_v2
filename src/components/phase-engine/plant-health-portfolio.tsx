// ============================================================================
// PlantHealthPortfolio — the oversight plant-health surface, minus auth and
// data access (PE-017).
//
// The surface is organised for a scan, not a read: plants are grouped by how
// much attention they warrant and ordered by launch proximity within a group,
// so the operator's eye lands on this week's conversations first instead of on
// whichever plant happens to sort first alphabetically. The "observation, not a
// verdict" framing is stated once here, in the page description, rather than
// repeated under every card where it crowds out the observations themselves.
//
// Presentational and pure: it receives an already privacy-gated portfolio from
// the page, which owns the role guard and the read.
// ============================================================================

import {
  PlantHealthCard,
  PlantHealthRow,
} from "@/components/phase-engine/plant-health-card";
import {
  CLASSIFICATION_META,
  CLASSIFICATION_SCAN_ORDER,
  groupPlantsByNeed,
  type PlantHealthGroup,
} from "@/lib/phase-engine/oversight/health-presentation";
import type { PlantHealthSummary } from "@/lib/phase-engine/oversight/read";
import { cn } from "@/lib/utils";

export function PlantHealthPortfolio({
  plants,
  scopeLabel,
}: {
  plants: PlantHealthSummary[];
  /** "network" or "sending church" — the audience the share gate applies to. */
  scopeLabel: string;
}) {
  const groups = groupPlantsByNeed(plants);

  return (
    <div className="space-y-8 p-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Plant Health</h1>
        <p className="text-foreground mt-2 max-w-2xl text-pretty">
          Observations from each plant&apos;s latest assessment — not verdicts.
          Plants are ordered by how much attention they warrant, and each one
          shows your {scopeLabel} only what its planter has chosen to share.
        </p>
        {/* #485 (C20). The scope belongs where the verdict-shaped reading
            happens: a portfolio of eight-factor standings is exactly the
            surface somebody would mistake for a church-health scoreboard. */}
        <p className="text-foreground mt-1 max-w-2xl text-sm text-pretty">
          Assessments describe launch progress under the Playbook methodology,
          not church health.
        </p>
      </header>

      {plants.length === 0 ? (
        <EmptyPortfolio scopeLabel={scopeLabel} />
      ) : (
        <>
          <FocusSummary plants={plants} />
          {groups.map((group) => (
            <HealthSection key={group.classification} group={group} />
          ))}
        </>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Focus summary — the counts, as jump links.
//
// The counts were previously three full-height cards holding a single number
// each, which pushed the plants themselves below the fold. Compressing them to
// one row buys back that space, and making each count a link means the number
// answers "how many" and "take me there" at once.
// ----------------------------------------------------------------------------

/** The count colour restates what the label already says; never the only cue. */
const COUNT_TONE: Record<string, string> = {
  readiness: "text-attention-high-ink",
  watch: "text-attention-medium-ink",
  // NEUTRAL, deliberately (#480). A plant sharing nothing is not a plant in
  // trouble; a warning colour here would turn a planter's privacy into a red
  // number on their overseer's dashboard, which is not what Bryan asked for.
  "limited-visibility": "text-muted-foreground",
  "on-track": "text-foreground",
};

function FocusSummary({ plants }: { plants: PlantHealthSummary[] }) {
  const items = CLASSIFICATION_SCAN_ORDER.map((classification) => ({
    classification,
    meta: CLASSIFICATION_META[classification],
    count: plants.filter((p) => p.classification === classification).length,
  }));

  return (
    <nav aria-label="Jump to a health group">
      <ul className="flex flex-wrap gap-2">
        {items.map(({ classification, meta, count }) => (
          <li key={classification}>
            {count === 0 ? (
              <span className="text-muted-foreground bg-card flex items-baseline gap-2 rounded-lg border px-4 py-2.5 text-sm">
                <span className="text-lg font-semibold tabular-nums">0</span>
                {meta.label}
              </span>
            ) : (
              <a
                href={`#${meta.anchor}`}
                className="focus-visible:ring-ring bg-card hover:bg-accent flex cursor-pointer items-baseline gap-2 rounded-lg border px-4 py-2.5 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                <span
                  className={cn(
                    "text-lg font-semibold tabular-nums",
                    COUNT_TONE[classification]
                  )}
                >
                  {count}
                </span>
                {meta.label}
              </a>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ----------------------------------------------------------------------------
// One classification's plants.
// ----------------------------------------------------------------------------

function HealthSection({ group }: { group: PlantHealthGroup }) {
  const headingId = `${group.meta.anchor}-heading`;
  // On-track plants are, by definition, the ones not asking for anything this
  // cycle. They stay listed — a portfolio view that hides its healthy plants is
  // lying about its size — but at a density that matches their claim on
  // attention, with their observations one disclosure away.
  const isCompact = group.classification === "on-track";

  return (
    <section
      id={group.meta.anchor}
      aria-labelledby={headingId}
      className="scroll-mt-6"
    >
      <h2 id={headingId} className="text-lg font-semibold">
        {group.meta.label}
        <span className="text-muted-foreground ms-2 font-normal tabular-nums">
          {group.plants.length}
        </span>
      </h2>
      <p className="text-foreground mt-1 max-w-2xl text-sm text-pretty">
        {group.meta.description}
      </p>

      {isCompact ? (
        <ul className="mt-4 space-y-2">
          {group.plants.map((plant) => (
            <PlantHealthRow key={plant.churchId} plant={plant} />
          ))}
        </ul>
      ) : (
        /* Column packing rather than a grid: cards differ in height by however
           many observations a plant has, and a grid reserves the tallest card's
           height in every row — on a 12-plant portfolio that was screenfuls of
           dead space between the very cards the operator is meant to compare.
           DOM order stays urgency order, so the first card is still the one
           needing attention most. */
        <div className="mt-4 gap-4 lg:columns-2 2xl:columns-3 [&>*]:mb-4 [&>*]:break-inside-avoid">
          {group.plants.map((plant) => (
            <PlantHealthCard key={plant.churchId} plant={plant} />
          ))}
        </div>
      )}
    </section>
  );
}

// ----------------------------------------------------------------------------

function EmptyPortfolio({ scopeLabel }: { scopeLabel: string }) {
  return (
    <div className="bg-card rounded-xl border p-8 text-center">
      <p className="font-medium">No church plants yet</p>
      <p className="text-muted-foreground mx-auto mt-1 max-w-md text-sm text-pretty">
        Once plants are associated with your {scopeLabel}, their health
        observations appear here after each plant&apos;s first assessment.
      </p>
    </div>
  );
}
