/**
 * Phase Engine — the rubric v1 fleet pass (#538)
 *
 * Generates ONE real assessment for every eval church against whatever rubric
 * is active, then audits the output against the rules v1 states about itself.
 *
 * WHY THIS IS NOT A TEST: the judge is a language model, so nothing here is
 * deterministic and none of it belongs in CI. What it is instead is a
 * re-runnable reading of the whole fleet at once — the only way to answer "does
 * the assembled rubric behave like one document" with evidence rather than a
 * close read. #538 assembled v1 from 18 independently-written deltas; this is
 * how those deltas were checked against each other.
 *
 * THE AUDIT IS THE POINT. Several v1 rules are already structural — the judge
 * schema caps the planter's work items, and `network-register.ts` fails a
 * response carrying a verdict phrase, both retried before anything is stored.
 * Those cannot fail here by construction. The rules audited below are the ones
 * with NO enforcement behind them, which is exactly where an assembled document
 * drifts:
 *
 *   - PAIRING: every non-positive network insight needs a planter insight in
 *     the same category. Enforced on generation; re-checked on what landed.
 *   - EVIDENCE: a lens reading `unknown` must not produce a confident insight.
 *   - VOCABULARY FLOOR: "stalled" needs 28 days, "slowed" needs 21. Below that
 *     neither word is available, and no code stops the model using one.
 *   - COMPOSITION IS PLANTER-ONLY: growth source may never reach the network.
 *   - THE PLANTER IS NOT ASSESSED: no wellbeing claim, to either audience.
 *
 * Usage:
 *   pnpm exec tsx scripts/run-eval-v1-pass.ts           # generate + audit
 *   pnpm exec tsx scripts/run-eval-v1-pass.ts --audit   # audit what exists
 */

import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

import type { EvidenceLens } from "../src/lib/phase-engine/signals/evidence";
import type { PlantFactSnapshot } from "../src/lib/phase-engine/signals/types";

config({ path: ".env.local" });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("❌ DATABASE_URL is not set.");
  process.exit(1);
}
const sql = neon(connectionString);

const auditOnly = process.argv.includes("--audit");

/** The eval corpus is namespaced; nothing here touches anything else. */
const EVAL_PREFIX = "EVAL-";

interface InsightRow {
  church: string;
  audience: "planter" | "network";
  category: string;
  /** The PERSISTED vocabulary, not the judge's — see `judgeSeverity`. */
  severity: "info" | "low" | "medium" | "high" | "critical";
  title: string;
  body: string;
}

/**
 * Recover what the judge actually said from what the database stored.
 *
 * `persist.ts` maps the judge's `positive|info|watch|urgent` onto the column's
 * `info|low|medium|high`, and the mapping is lossy-looking but invertible:
 * `positive → info` and `info → low` land on different values. Reading the
 * stored column as if it were the judge's vocabulary is what made this audit
 * first report a budget breach on a plant that was inside its budget — the
 * "positive" the exemption exists for was sitting in the column as `info`.
 */
const JUDGE_SEVERITY: Record<string, string> = {
  info: "positive",
  low: "info",
  medium: "watch",
  high: "urgent",
  critical: "urgent",
};
function judgeSeverity(stored: string): string {
  return JUDGE_SEVERITY[stored] ?? stored;
}

interface Violation {
  church: string;
  rule: string;
  detail: string;
}

function pad(value: string | number, width: number): string {
  const s = String(value);
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

async function generateAll(): Promise<void> {
  const { generateAssessment } =
    await import("../src/lib/phase-engine/assessment/generate-assessment");

  const churches = (await sql`
    SELECT id, name FROM churches
    WHERE name LIKE ${EVAL_PREFIX + "%"}
    ORDER BY name`) as { id: string; name: string }[];

  console.log(
    `\n🧪 Generating assessments for ${churches.length} eval plants…\n`
  );

  let retried = 0;

  for (const church of churches) {
    const started = Date.now();
    // A draft the judge's own rules rejected is re-prompted rather than fatal
    // (#605). Printing it is the point of running this: a plant that needed two
    // drafts is a plant that used to be a `failed` row, and the rule named here
    // is the rubric rule the model keeps breaking.
    const onSchemaRejection = (event: {
      attempt: number;
      maxAttempts: number;
      rules: string[];
      exhausted: boolean;
    }) => {
      retried++;
      console.log(
        `   ${pad(church.name.slice(0, 34), 34)} ${pad(`retry ${event.attempt}/${event.maxAttempts}`, 10)} ` +
          `rejected by ${event.rules.join(", ") || "the output schema"}` +
          (event.exhausted ? " — no drafts left" : "")
      );
    };

    try {
      const result = await generateAssessment(church.id, undefined, {
        onSchemaRejection,
      });
      const status =
        result && typeof result === "object" && "assessment" in result
          ? ((result as { assessment: { status: string } }).assessment.status ??
            "?")
          : "?";
      console.log(
        `   ${pad(church.name.slice(0, 34), 34)} ${pad(status, 10)} ${Math.round((Date.now() - started) / 1000)}s`
      );
    } catch (error) {
      // The message names the rejecting rule when the judge's rules are what
      // failed, so this line is wide enough to carry it (AC-3).
      console.log(
        `   ${pad(church.name.slice(0, 34), 34)} FAILED     ${(error as Error).message.slice(0, 200)}`
      );
    }
  }

  console.log(
    `\n   ${retried} draft(s) rejected and re-prompted across the fleet.\n`
  );
}

async function audit(): Promise<void> {
  const rows = (await sql`
    SELECT c.name AS church, a.rubric_version, i.audience, i.category,
           i.severity, i.title, i.body
    FROM plant_insights i
    JOIN plant_assessments a ON a.id = i.assessment_id
    JOIN churches c ON c.id = i.church_id
    WHERE c.name LIKE ${EVAL_PREFIX + "%"}
      AND a.status = 'complete'
      AND a.id IN (
        SELECT DISTINCT ON (church_id) id FROM plant_assessments
        WHERE status = 'complete' ORDER BY church_id, generated_at DESC
      )
    ORDER BY c.name, i.audience, i.category`) as {
    church: string;
    rubric_version: string;
    audience: string;
    category: string;
    severity: string;
    title: string;
    body: string;
  }[];

  if (rows.length === 0) {
    console.log("\n⚠️  No complete assessments found for the eval corpus.\n");
    process.exit(1);
  }

  const versions = [...new Set(rows.map((r) => r.rubric_version))];
  console.log(
    `\n📋 Fleet pass — rubric version(s) recorded: ${versions.join(", ")}\n`
  );

  const byChurch = new Map<string, InsightRow[]>();
  for (const r of rows) {
    const list = byChurch.get(r.church) ?? [];
    list.push(r as unknown as InsightRow);
    byChurch.set(r.church, list);
  }

  // ---- Per-lens matrix -------------------------------------------------
  // Typed as the evidence profile's own key, so the matrix and the evidence
  // audit below cannot drift apart from the eight lenses that profile covers.
  const LENSES: EvidenceLens[] = [
    "vision_casting",
    "shared_ownership",
    "critical_mass",
    "cohesion",
    "prayer",
    "generosity",
    "emerging_leadership",
    "comprehensive_training",
  ];
  const SEV: Record<string, string> = {
    positive: "+",
    info: "i",
    watch: "w",
    urgent: "!",
  };

  const header = [
    pad("Plant", 14),
    ...LENSES.map((l) => pad(l.slice(0, 7), 8)),
  ].join(" ");
  console.log(header);
  console.log("─".repeat(header.length));
  for (const [church, insights] of byChurch) {
    const cells = LENSES.map((lens) => {
      const hits = insights.filter((i) => i.category === lens);
      if (hits.length === 0) return pad("·", 8);
      const p = hits
        .filter((i) => i.audience === "planter")
        .map((i) => SEV[judgeSeverity(i.severity)] ?? "?");
      const n = hits
        .filter((i) => i.audience === "network")
        .map((i) => SEV[judgeSeverity(i.severity)] ?? "?");
      return pad(`${p.join("") || "-"}/${n.join("") || "-"}`, 8);
    });
    console.log(
      [pad(church.replace(EVAL_PREFIX, "").slice(0, 14), 14), ...cells].join(
        " "
      )
    );
  }
  console.log(
    "\n  cell = planter/network · + positive · i info · w watch · ! urgent · · = lens silent\n"
  );

  // ---- Rule audit ------------------------------------------------------
  const violations: Violation[] = [];
  // THE SNAPSHOT THE JUDGE ACTUALLY SAW, read back off the assessment rather
  // than recomputed. This audit first recomputed it at the seeder's clock and
  // reported eleven vocabulary violations that were not violations at all: the
  // assessments had been generated against the REAL clock, where every plant's
  // stall really had passed 28 days. Auditing a model's output against facts it
  // was never given produces confident nonsense, which is the same failure the
  // rubric spends its whole length forbidding.
  const snapshots = (await sql`
    SELECT c.name AS church, a.fact_snapshot
    FROM plant_assessments a
    JOIN churches c ON c.id = a.church_id
    WHERE c.name LIKE ${EVAL_PREFIX + "%"} AND a.status = 'complete'
      AND a.id IN (
        SELECT DISTINCT ON (church_id) id FROM plant_assessments
        WHERE status = 'complete' ORDER BY church_id, generated_at DESC
      )`) as { church: string; fact_snapshot: PlantFactSnapshot }[];
  const snapByChurch = new Map(
    snapshots.map((s) => [s.church, s.fact_snapshot])
  );

  for (const [church, insights] of byChurch) {
    const planter = insights.filter((i) => i.audience === "planter");
    const network = insights.filter((i) => i.audience === "network");
    const workItems = planter.filter(
      (i) => judgeSeverity(i.severity) !== "positive"
    );

    // The observation budget. Schema-enforced, so a breach here would mean the
    // constraint is not doing what #478 claims.
    if (workItems.length > 3) {
      violations.push({
        church,
        rule: "observation budget (1 primary + 2 supplements)",
        detail: `${workItems.length} non-positive planter insights`,
      });
    }

    // The pairing rule: no negative conclusion the planter was never shown.
    for (const n of network) {
      if (judgeSeverity(n.severity) === "positive") continue;
      if (!planter.some((p) => p.category === n.category)) {
        violations.push({
          church,
          rule: "planter sees it first (same-category pairing)",
          detail: `network "${n.title}" (${n.category}) has no planter insight in that category`,
        });
      }
    }

    // Growth composition is planter-audience only.
    for (const n of network) {
      if (
        /partner church|transfer|came through|where.*growth.*com/i.test(n.body)
      ) {
        violations.push({
          church,
          rule: "growth composition is planter-only",
          detail: `network insight discusses source composition: "${n.title}"`,
        });
      }
    }

    // The planter is never assessed, to either audience.
    for (const i of insights) {
      if (
        /burn(ing)? ?out|burnout|exhaust|overwhelmed|your (own )?(wellbeing|capacity|health)/i.test(
          i.body
        )
      ) {
        violations.push({
          church,
          rule: "no planter-wellbeing claim (§5c)",
          detail: `${i.audience} "${i.title}"`,
        });
      }
    }

    // The vocabulary floor, checked against the plant's real stall clock.
    const snap = snapByChurch.get(church);
    if (snap) {
      const days = snap.coreGroup?.daysSinceLastNewCommitment ?? null;
      for (const i of insights) {
        const text = `${i.title} ${i.body}`;
        if (/\bstalled\b/i.test(text) && (days === null || days < 28)) {
          violations.push({
            church,
            rule: '"stalled" requires 28 days',
            detail: `daysSinceLastNewCommitment=${days} · ${i.audience} "${i.title}"`,
          });
        }
        if (
          /momentum has slowed|growth has slowed/i.test(text) &&
          (days === null || days < 21)
        ) {
          violations.push({
            church,
            rule: '"slowed" requires 21 days',
            detail: `daysSinceLastNewCommitment=${days} · ${i.audience} "${i.title}"`,
          });
        }
      }

      // An unknown lens may not produce a confident read.
      //
      // ALL EIGHT LENSES, NOT THE TWO THE RULE WAS WRITTEN FOR (#635). This
      // loop used to name prayer and generosity — #483's worked examples, and
      // the only two lenses that are blind on a plant with activity. Every lens
      // is blind on the COLD-START plant, and the one this audit never asked
      // about is the one that broke the rule: EVAL-01's CSF-1 tile read "Vision
      // casting · GOING WELL · Based on no activity recorded yet" through a
      // fleet pass that reported no violations.
      for (const lens of LENSES) {
        const quality = snap.evidence?.[lens]?.quality;
        if (quality !== "unknown") continue;
        for (const i of insights.filter((x) => x.category === lens)) {
          // A POSITIVE VERDICT ON A BLIND LENS IS ITS OWN LINE, because it is
          // the one shape that reaches the planter as a health verdict rather
          // than as prose: the scorecard renders it as the words GOING WELL.
          // Since #635 the judge schema refuses it outright, so a hit here means
          // the refinement is not doing what the PR claims.
          if (judgeSeverity(i.severity) === "positive") {
            violations.push({
              church,
              rule: `unknown lens must never read as healthy (${lens})`,
              detail: `${i.audience} "${i.title}" — positive verdict on a lens with nothing measured and nothing attested`,
            });
            continue;
          }
          // THE NEUTRAL BAND IS NOT A CONFIDENT READ (#635). "info" on a blind
          // lens is either Bryan's sentence or a plain statement of the absence
          // with the first step beside it — "vision meetings have not yet
          // commenced; consider setting up a rhythm" — which claims nothing
          // about health and is what a cold-start planter is owed (PE-018).
          // #635 ruled that band defensible on an absence, so only a WATCH or
          // URGENT read is held to the insufficient-evidence phrasing here: a
          // confident negative on a lens with no evidence is the same overclaim
          // as a confident positive, pointed the other way.
          if (judgeSeverity(i.severity) === "info") continue;
          if (
            !/not (currently )?have enough information|do not have enough|insufficient|cannot assess|no information|don't have enough|not enough information/i.test(
              i.body
            )
          ) {
            violations.push({
              church,
              rule: `unknown lens must read as insufficient evidence (${lens})`,
              detail: `${i.audience} "${i.title}" — ${i.body.slice(0, 90)}`,
            });
          }
        }
      }
    }
  }

  console.log("🔍 Rule audit — the v1 rules with no structural enforcement:\n");
  if (violations.length === 0) {
    console.log("   ✅ No violations across the fleet.\n");
  } else {
    for (const v of violations) {
      console.log(`   ✗ ${v.church.replace(EVAL_PREFIX, "")} · ${v.rule}`);
      console.log(`       ${v.detail}`);
    }
    console.log(`\n   ${violations.length} violation(s).\n`);
  }

  // ---- Coverage summary ------------------------------------------------
  const lensHits = new Map<string, number>();
  for (const r of rows)
    lensHits.set(r.category, (lensHits.get(r.category) ?? 0) + 1);
  console.log("Lens coverage across the fleet:\n");
  for (const lens of [...lensHits.keys()].sort()) {
    console.log(`   ${pad(lens, 24)} ${lensHits.get(lens)} insight(s)`);
  }
  console.log("");
}

async function main(): Promise<void> {
  try {
    if (!auditOnly) await generateAll();
    await audit();
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

main();
