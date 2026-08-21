// ============================================================================
// THE NETWORK REGISTER — coaching, never verdict (#482, C15/C16/C24/C25).
//
// Bryan on the v0 network samples: "This feels too clinical/organizational to
// me. It sounds like an underperforming business unit. I would prefer something
// like, 'Core-group momentum has slowed. This may be worth a coaching
// conversation around vision cadence, invitations, and follow-up.' Still
// direct, but it sounds like church planting and coaching rather than corporate
// intervention."
//
// And on what the network may be told at all: "The planter should never
// discover the diagnosis through his overseer… The network should see patterns
// that warrant conversation, not conclusions about causes."
//
// TWO RULES, BOTH STRUCTURAL. The rubric says them in prose, which is what
// teaches the model; these are what stop a bad response being STORED:
//
//   1. No verdict verbs in network-audience text.
//   2. Every network concern is also a planter concern.
//
// Both are checked as zod refinements on the judge's output (schema.ts), so a
// violation is a failed parse and `runPacedCall` retries the generation. An
// insight that breaks either rule never reaches the database.
//
// PURE AND IO-FREE, so the register itself is unit-testable and so the ban-list
// has exactly one spelling.
// ============================================================================

import type { Insight } from "./schema";

/**
 * Verdict language the network audience may not use.
 *
 * Each entry is a phrase Bryan flagged, or the framing it hides in. They are
 * matched case-insensitively on word boundaries, against title AND body.
 *
 * WHY THESE AND NOT A TONE CLASSIFIER: the failure is a small set of specific
 * words that turn an observation into a verdict about a plant, and a list is
 * checkable, testable and arguable. A model asked to "sound less clinical" will
 * comply on average and slip on the plant that most needs care.
 */
export const NETWORK_VERDICT_PHRASES = [
  "intervention",
  "failing",
  "critical",
  "lack of",
  "needs to be addressed",
  "must be addressed",
  "underperform",
  "at risk of failure",
  "is behind",
] as const;

/** One banned phrase found in one network insight. */
export interface RegisterViolation {
  /** The insight's title, so a retry log names which one. */
  title: string;
  /** The phrase that matched. */
  phrase: string;
}

function matches(text: string, phrase: string): boolean {
  // Word boundaries, so "critical" is caught and "critical mass" — the CSF's
  // own name — is not. That exception is the reason this is not a substring
  // scan: the rubric's third lens is literally called Critical Mass, and the
  // network is allowed to say it.
  return new RegExp(`\\b${phrase.replace(/\s+/g, "\\s+")}\\b`, "i").test(text);
}

/**
 * `critical mass` is the name of CSF-3 and may be said to anyone. Stripped
 * before the scan so the ban on "critical" does not ban the lens.
 */
function withoutAllowedIdioms(text: string): string {
  return text.replace(/\bcritical\s+mass\b/gi, "");
}

/** Every banned phrase in this insight's title or body. */
export function findVerdictLanguage(
  insight: Pick<Insight, "title" | "body">
): RegisterViolation[] {
  const text = withoutAllowedIdioms(`${insight.title}\n${insight.body}`);

  return NETWORK_VERDICT_PHRASES.filter((phrase) => matches(text, phrase)).map(
    (phrase) => ({ title: insight.title, phrase })
  );
}

/** Every network-audience insight in this output that breaks the register. */
export function findNetworkRegisterViolations(
  insights: readonly Insight[]
): RegisterViolation[] {
  return insights
    .filter((insight) => insight.audience === "network")
    .flatMap(findVerdictLanguage);
}

/**
 * Network concerns the planter was not told about (C16/C25).
 *
 * Bryan: "I would not want the network receiving a negative conclusion that the
 * planter was never shown." The audiences may word it differently — they should
 * — so the pairing is on the CONCERN, which in this vocabulary is the rubric
 * category. If the network hears about critical mass, the planter hears about
 * critical mass.
 *
 * POSITIVE NETWORK INSIGHTS ARE EXEMPT. The rule exists so a planter is not
 * ambushed by a negative conclusion; being told their plant is doing well is
 * not an ambush, and requiring a paired planter item for it would spend one of
 * the three focus slots (#478) on something that is not work.
 *
 * @returns the unpaired network categories, empty when the output is clean.
 */
export function findUnpairedNetworkCategories(
  insights: readonly Insight[]
): string[] {
  const planterConcerns = new Set(
    insights
      .filter((insight) => insight.audience === "planter")
      .map((insight) => insight.category)
  );

  const unpaired = new Set(
    insights
      .filter(
        (insight) =>
          insight.audience === "network" && insight.severity !== "positive"
      )
      .map((insight) => insight.category)
      .filter((category) => !planterConcerns.has(category))
  );

  return [...unpaired].sort();
}
