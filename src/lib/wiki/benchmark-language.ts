// ============================================================================
// "50 IS A BENCHMARK, NOT A GATE" — as a detector (#472, C03).
//
// Bryan on the v0 rubric: "I'm okay with these numbers if we are explicitly
// saying, 'These are the benchmarks of this planting methodology.' I would be
// cautious about letting them become universal definitions of a healthy plant.
// Different contexts and models could reasonably launch at very different
// sizes." He launched at 25.
//
// The numbers stay. What changes is the grammar around them: a sentence that
// says a plant MUST reach 50, or CANNOT launch below it, has turned one
// methodology's benchmark into a universal verdict. This module decides which
// sentences do that.
//
// PURE AND DB-FREE, and that is the point: the corpus lives in
// `wiki_articles`, a protected table with no repo seed, so the sweep cannot be
// a reviewable diff. The reviewable artifact is this detector plus
// `scripts/audit-benchmark-language.ts`, which anyone can re-run against the
// live corpus to check the claim that no gate phrasing survives.
// ============================================================================

/** One sentence that frames a benchmark as a gate. */
export interface BenchmarkFinding {
  /** The offending sentence, whitespace collapsed. */
  sentence: string;
  /** The gate word or phrase that flagged it. */
  trigger: string;
}

/**
 * The numbers the methodology treats as benchmarks. Matched with a word
 * boundary and a size word nearby, so "100%" and "50 minutes" do not flag.
 */
const BENCHMARK_NUMBERS = /\b(50|100)\b/;

/**
 * A size claim rather than an incidental number: the sentence has to be about
 * PEOPLE. Without this, "50 chairs" and "100 flyers" are findings.
 */
const SIZE_CONTEXT =
  /\b(adults?|people|members?|attendees?|committed|core group|coregroup|launch team|congregation|families)\b/i;

/**
 * Gate phrasing — the grammar that turns a benchmark into a requirement.
 *
 * Ordered longest-first so a match reports the most specific trigger it can:
 * "minimum needed" is a better explanation of a finding than "need".
 */
const GATE_PHRASES: RegExp[] = [
  /\bminimum needed\b/i,
  /\bcannot launch\b/i,
  /\bcan'?t launch\b/i,
  /\bnot ready to launch\b/i,
  /\bbefore you (?:can|may) launch\b/i,
  /\brequirements?\b/i,
  /\brequired\b/i,
  /\bmust (?:have|reach|hit|be|get|grow)\b/i,
  /\bhas to (?:have|reach|hit|be)\b/i,
  /\bneed(?:s|ed)? to (?:have|reach|hit|be)\b/i,
  /\b(?:a|the) minimum(?: of)?\b/i,
  /\bmandatory\b/i,
  /\bnon-negotiable\b/i,
];

/**
 * Split into sentences well enough to quote one back.
 *
 * Deliberately crude — this is a reviewer's reading aid, not a parser. It
 * splits on sentence punctuation and on markdown line structure, because a
 * bullet, a heading or a table row is a sentence for our purposes and often the
 * exact place a gate claim hides ("### Minimum requirements").
 */
export function splitSentences(content: string): string[] {
  return content
    .split(/\n{2,}|\n(?=[-*#>|])|(?<=[.!?])\s+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length > 0);
}

/**
 * A sentence, paired with the paragraph it came out of.
 *
 * THE PAIRING IS WHAT MAKES THE DETECTOR WORK. "50 is the minimum." is four
 * words long and mentions no people, so a sentence-only test reads it as a
 * number about nothing and lets it through — and that sentence is exactly the
 * claim #472 exists to remove. The paragraph around it says "adults", so the
 * number lives in the sentence and the subject lives in the block.
 */
interface Unit {
  sentence: string;
  block: string;
}

function units(content: string): Unit[] {
  return content.split(/\n{2,}/).flatMap((rawBlock) => {
    const block = rawBlock.replace(/\s+/g, " ").trim();
    return splitSentences(rawBlock).map((sentence) => ({ sentence, block }));
  });
}

/**
 * Every sentence naming a benchmark number about PEOPLE, flagged or not.
 *
 * The worklist a content pass reads. Gate grammar is the failure this module
 * exists to find, but an unframed mention — "the target is 100 adults", with
 * nothing saying whose target — is what a content author has to decide about,
 * and no regex can tell a well-framed mention from a bare one.
 */
export function findBenchmarkMentions(content: string): string[] {
  return units(content)
    .filter(
      (unit) =>
        BENCHMARK_NUMBERS.test(unit.sentence) && SIZE_CONTEXT.test(unit.block)
    )
    .map((unit) => unit.sentence);
}

/**
 * Every sentence in this content that states a benchmark as a gate.
 *
 * A finding needs all three: one of the numbers, gate grammar in the same
 * sentence, and a word putting the paragraph in the context of PEOPLE. Two of
 * the three is not a finding — the corpus is allowed to say "50 committed
 * adults" all day, and it is allowed to say "required" about something else.
 */
export function findGatePhrasing(content: string): BenchmarkFinding[] {
  const findings: BenchmarkFinding[] = [];

  for (const { sentence, block } of units(content)) {
    if (!BENCHMARK_NUMBERS.test(sentence)) continue;
    if (!SIZE_CONTEXT.test(block)) continue;

    const gate = GATE_PHRASES.find((phrase) => phrase.test(sentence));
    if (!gate) continue;

    findings.push({
      sentence,
      trigger: sentence.match(gate)![0],
    });
  }

  return findings;
}
