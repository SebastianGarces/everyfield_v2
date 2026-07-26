// ============================================================================
// Judge prompt construction (AC-PE-5 / NFR-PE-1 / PE-012).
//
// Pure, deterministic prompt building — no I/O, no LLM call — so it is unit
// testable. The system prompt embeds the WHOLE active rubric and hard-constrains
// the model to:
//   1. Reason ONLY over the supplied fact snapshot (never invent a count/date).
//   2. Cite, for every insight, the exact facts that drove it.
//   3. Produce BOTH planter- and network-audience insights (PE-012).
//   4. Ground advice in the supplied methodology passages (cite their slugs).
//
// The fact snapshot is flattened into an explicit `key=value` fact ledger so the
// model has a closed vocabulary to cite from — and so a reviewer (or a future
// guard) can check that every `citedFacts` entry corresponds to a real fact.
// ============================================================================

import type { PlantFactSnapshot } from "@/lib/phase-engine/signals";
import type { RetrievedPassage } from "@/lib/phase-engine/rag";
import type { Rubric } from "@/lib/phase-engine/rubric";

/** One flattened, citable fact: a dotted path and its primitive value. */
export interface FactLine {
  key: string;
  value: string;
}

/**
 * Flatten the snapshot into a stable list of `key=value` fact lines. This is the
 * closed set of facts the judge is allowed to cite (NFR-PE-1). Nested objects
 * are dotted (e.g. `coreGroup.committedCount`); arrays index their elements
 * (e.g. `ministryRoles.roles.0.filled`). Deterministic key order.
 */
export function flattenFacts(snapshot: PlantFactSnapshot): FactLine[] {
  const lines: FactLine[] = [];

  const walk = (prefix: string, value: unknown): void => {
    if (value === null || value === undefined) {
      lines.push({ key: prefix, value: "null" });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(`${prefix}.${i}`, item));
      return;
    }
    if (typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(prefix ? `${prefix}.${k}` : k, v);
      }
      return;
    }
    lines.push({ key: prefix, value: String(value) });
  };

  walk("", snapshot);
  return lines;
}

/** Render the fact ledger the model must reason from and cite. */
function renderFactLedger(snapshot: PlantFactSnapshot): string {
  return flattenFacts(snapshot)
    .map((f) => `- ${f.key} = ${f.value}`)
    .join("\n");
}

/** Render the methodology passages, tagged with their citable article slug. */
function renderPassages(passages: RetrievedPassage[]): string {
  if (passages.length === 0) {
    return "(no methodology passages retrieved)";
  }
  return passages
    .map((p, i) => {
      const slug = p.articleSlug ?? "(no-slug)";
      const section = p.section ? ` — ${p.section}` : "";
      return `[${i + 1}] slug=${slug}${section}\n${p.content.trim()}`;
    })
    .join("\n\n");
}

/**
 * The system prompt: role + the whole rubric + the hard grounding constraints.
 * Constant across plants for a given rubric version, so it caches well and keeps
 * the per-plant user message focused on facts.
 */
export function buildSystemPrompt(rubric: Rubric): string {
  return `You are the Plant Intelligence judge for a church-planting platform. You assess a single church plant's health and produce grounded, actionable insights.

You reason against the rubric below. The rubric is the authoritative evaluation framework (version ${rubric.version}).

GROUNDING RULES — these are absolute:
1. Reason ONLY over the FACTS provided in the user message. The facts are computed deterministically by the system; they are the single source of truth.
2. NEVER invent, estimate, or infer a count, date, percentage, or any number that is not present verbatim in the FACTS. If a needed fact is absent or null, say it is unknown — do not fabricate it.
3. Every insight MUST cite, in its citedFacts array, the exact fact keys/values from the FACTS that drove it (e.g. "coreGroup.committedCount=22"). An insight with no cited fact is invalid.
4. Ground advice in the supplied METHODOLOGY passages where relevant and put the cited passages' article slugs in relatedArticleSlugs. Only use slugs that appear in the METHODOLOGY block. If none apply, leave the array empty.
5. Produce insights for BOTH audiences:
   - "planter": direct, encouraging, actionable coaching — the next concrete step.
   - "network": conservative, observational health reads in aggregate only. Never reference individual people by name or id to the network audience. Frame as observation, not verdict.
   You MUST include at least one planter insight AND at least one network insight.
6. Prioritize through the lens of the plant's CURRENT PHASE (see Part B). What matters most right now leads.
7. Be concise and specific. Reinforce what is going well (severity "positive") as well as flagging risks.

=== RUBRIC (version ${rubric.version}) ===
${rubric.body}
=== END RUBRIC ===`;
}

/** Per-plant user message: the phase, the fact ledger, and the RAG passages. */
export function buildUserPrompt(
  snapshot: PlantFactSnapshot,
  passages: RetrievedPassage[]
): string {
  const coldStart = snapshot.isColdStart
    ? "\nNOTE: This plant is at COLD START (little or no activity yet). Favor onboarding guidance over numeric analysis; do not imply numbers that aren't in the FACTS.\n"
    : "";

  return `CURRENT PHASE: ${snapshot.currentPhase}
SNAPSHOT GENERATED AT: ${snapshot.generatedAt}
${coldStart}
=== FACTS (the only facts you may reason over or cite) ===
${renderFactLedger(snapshot)}
=== END FACTS ===

=== METHODOLOGY (cite these article slugs in relatedArticleSlugs when relevant) ===
${renderPassages(passages)}
=== END METHODOLOGY ===

Produce the assessment now. Remember: cite real facts only, no invented numbers, and include both planter and network insights.`;
}

/**
 * Build a focused retrieval query from the snapshot so RAG passages are
 * phase- and need-relevant. Pure helper (no I/O); the pipeline runs the actual
 * `retrieve()`. Pulls the levers most likely to need methodology grounding.
 */
export function buildRetrievalQuery(snapshot: PlantFactSnapshot): string {
  const parts: string[] = [
    `phase ${snapshot.currentPhase} church plant health`,
  ];

  if (snapshot.isColdStart) {
    parts.push("getting started onboarding first steps discovery foundations");
  }
  if (
    snapshot.visionMeetings.isEmpty ||
    snapshot.visionMeetings.totalCompleted === 0
  ) {
    parts.push("vision meeting cadence growing core group");
  }
  if (!snapshot.coreGroup.isEmpty && snapshot.coreGroup.committedCount < 50) {
    parts.push("building core group critical mass committed adults");
  }
  if (snapshot.ministryRoles.filledCount < snapshot.ministryRoles.totalRoles) {
    parts.push("ministry team leadership roles launch team");
  }
  if (snapshot.followUp.staleCount > 0) {
    parts.push("follow up warm contacts");
  }
  if (snapshot.launch.launchDate && snapshot.currentPhase >= 3) {
    parts.push("training preparation pre-launch readiness");
  }

  return parts.join("; ");
}
