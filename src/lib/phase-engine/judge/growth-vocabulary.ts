// ============================================================================
// THE GROWTH VOCABULARY FLOOR (#538, closing C02/#471 the way #482 closed C15).
//
// Bryan, on the v0 line that flagged three flat weeks as stalled: "Three weeks
// feels a little aggressive. I'd probably say 'momentum has slowed' sooner, but
// I wouldn't confidently label growth 'stalled' until roughly four weeks,
// especially because one vision-meeting cycle can radically change things."
//
// #471 wrote that into the rubric as two levels with a floor under each, and
// left it as prose. The fleet pass over the twelve eval plants is what showed
// prose was not enough: EIGHT of twelve assessments called growth "stalled"
// when the clock did not earn the word — including the launch-ready exemplar,
// three days after somebody committed, and a just-launched plant at four days.
// A planter reading "your growth has stalled" the week two people joined does
// not file it as a wording slip; they file it as the tool being wrong, which is
// the trust failure the whole grounding rule exists to prevent.
//
// So the rule moves from something the model is asked to follow to something it
// is held to, exactly like `network-register.ts`: a violation fails the parse
// and the generation is retried, and a response that slides under the floor
// never reaches a database.
//
// WHY A WORD LIST AND NOT A CLASSIFIER: the failure is a small set of specific
// words with a numeric threshold behind each. That is checkable, testable, and
// arguable in review. "Be careful about the word stalled" is none of those, and
// it is what we already had.
//
// PURE AND IO-FREE, so the floor has exactly one spelling and can be unit-tested
// without a model call.
// ============================================================================

import type { Insight } from "./schema";

/**
 * The two levels, and the fact each one rests on.
 *
 * `minDays` is read from the SNAPSHOT (`coreGroup.slowedThresholdDays` /
 * `stalledThresholdDays`) rather than redeclared here — the same numbers the
 * judge is handed in its fact ledger, so the rule it is told and the rule it is
 * held to cannot drift apart.
 */
export interface GrowthVocabularyLevel {
  /** Which snapshot threshold gates this vocabulary. */
  level: "slowed" | "stalled";
  /** Case-insensitive phrases that claim this level. */
  phrases: readonly string[];
}

export const GROWTH_VOCABULARY: readonly GrowthVocabularyLevel[] = [
  {
    level: "stalled",
    // "Stalled" is the strong claim and the one Bryan named. The variants are
    // the ways a model reaches for it without typing the adjective.
    phrases: ["stalled", "stalling", "has stagnated", "stagnant", "flatlined"],
  },
  {
    level: "slowed",
    // Deliberately narrow. "Slower than last month" is a comparison and stays
    // allowed; these are the phrasings that assert the LEVEL.
    phrases: [
      "momentum has slowed",
      "growth has slowed",
      "momentum is slowing",
      "growth is slowing",
    ],
  },
] as const;

/** One floor breach, in one insight. */
export interface GrowthVocabularyViolation {
  /** The insight's title, so a retry log names which one. */
  title: string;
  /** The phrase that matched. */
  phrase: string;
  /** The level it claimed. */
  level: "slowed" | "stalled";
  /** Days the plant actually had, or null when nobody has ever committed. */
  actualDays: number | null;
  /** Days the level required. */
  requiredDays: number;
}

function matches(text: string, phrase: string): boolean {
  return new RegExp(`\\b${phrase.replace(/\s+/g, "\\s+")}\\b`, "i").test(text);
}

/**
 * Every place an insight claims a growth level the clock has not reached.
 *
 * `daysSinceLastNewCommitment` is the fact the words rest on: days since the
 * most recent person's FIRST core-group commitment. `null` means nobody has
 * ever committed, and neither word is available then either — a plant with no
 * core group has not stalled, it has not started.
 *
 * Only CRITICAL-MASS insights are checked. "Vision-meeting cadence has stalled"
 * is a claim about meetings, gated by its own facts, and this rule has nothing
 * to say about it.
 */
export function findGrowthVocabularyViolations(
  insights: Insight[],
  daysSinceLastNewCommitment: number | null,
  thresholds: { slowedThresholdDays: number; stalledThresholdDays: number }
): GrowthVocabularyViolation[] {
  const required = {
    slowed: thresholds.slowedThresholdDays,
    stalled: thresholds.stalledThresholdDays,
  };
  const violations: GrowthVocabularyViolation[] = [];

  for (const insight of insights) {
    if (insight.category !== "critical_mass") continue;
    const text = `${insight.title} ${insight.body}`;

    for (const { level, phrases } of GROWTH_VOCABULARY) {
      for (const phrase of phrases) {
        if (!matches(text, phrase)) continue;
        const floor = required[level];
        if (
          daysSinceLastNewCommitment !== null &&
          daysSinceLastNewCommitment >= floor
        ) {
          continue;
        }
        violations.push({
          title: insight.title,
          phrase,
          level,
          actualDays: daysSinceLastNewCommitment,
          requiredDays: floor,
        });
      }
    }
  }

  return violations;
}
