import assert from "node:assert/strict";
import { test } from "node:test";

import { generateAssessment } from "@/lib/phase-engine/assessment";
import { runAssessment, TokenPacer } from "@/lib/phase-engine/judge";
import { isDeadlineTruncatedFailure } from "@/lib/phase-engine/judge/paced-call";
import { virtualClock } from "@/lib/phase-engine/judge/testing";
import { makeSnapshot } from "@/lib/phase-engine/signals/testing";
import { captureConsole } from "@/lib/testing/console-capture";
import { sourceReader, stripComments } from "@/lib/testing/source-span";

import {
  MAX_ATTEMPTS_PER_PLANT,
  runAssessmentBatch,
  type RunAssessmentBatchDeps,
} from "./route";

// ============================================================================
// THE DEADLINE-TRUNCATION MARKER SURVIVES THE WHOLE CALL CHAIN, NOT JUST ITS
// ENDS.
//
// `isDeadlineTruncatedFailure` recognises a failure by OBJECT IDENTITY: the
// 5xx is rethrown AS ITSELF and a module-level `WeakSet` in `paced-call.ts`
// remembers it. That only reaches the runner's catch because every link
// between them rethrows the IDENTICAL object — `runAssessment`'s trace-and-
// rethrow, and `generateAssessment`'s mark-the-row-and-rethrow. Nothing
// downstream re-derives the fact, so a `new Error(msg, { cause: error })` at
// either link is invisible to types, invisible to `instanceof`, and silently
// turns every clock-truncated run back into a `console.error` page-out at
// 07:00.
//
// Every other suite stubs one of those links: the route-level throttle tests
// replace `generateAssessment` wholesale (five stub definitions), and
// `paced-call.test.ts` calls `runPacedCall` directly. So the contract those
// two ends rest on had no test at all. §1 is that test.
//
// Only the JUDGE CALL is stubbed, and it is stubbed where the process meets
// the network: `globalThis.fetch`. Everything between the provider's 502 and
// the runner's `catch` is production code — the real `runPacedCall`, the real
// `runAssessment`, the real `generateAssessment` (including its pending-row
// insert and its unjudged-row compare-and-set), and the real `runAssessmentBatch`.
// The two DB READS the orchestrator takes a seam for (the prior snapshot, the
// fresh fact snapshot) are supplied as fixtures: they are INPUTS to the chain,
// never links in it.
// ============================================================================

// The clock is the shared `virtualClock` from the judge's own test support, so
// a run whose ladder would sleep for a minute is asserted in milliseconds. The
// stubbed fetch resolves immediately and advances nothing, which is what makes
// the run deadline the only thing that can stop the ladder. This suite reads
// neither `sleeps` nor `advance` — it asserts the OUTCOME of the ladder, not
// its shape.

// ----------------------------------------------------------------------------
// The one stub: the process's own `fetch`.
//
// The judge's provider call answers 502 (retryable, so `runPacedCall` opens a
// retry ladder the run deadline then cuts short). Every other OpenAI call —
// the RAG query embedding — answers 400, which is NOT retryable, so retrieval
// degrades immediately through `safeRetrieve` instead of spending real backoff.
// Neon's HTTP endpoint answers a well-formed empty row so the orchestrator's
// two writes really run: `rows` of nulls decode with no type parser, which is
// all `.returning()` needs to hand back a row object.
// ----------------------------------------------------------------------------

const NEON_NULL_ROW = Array.from({ length: 64 }, () => null);

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface ProviderStub {
  /** Every SQL statement the neon-http driver actually sent. */
  readonly statements: string[];
  /** How many times the judge model was called. */
  readonly judgeCalls: { count: number };
  restore(): void;
}

function stubTheProvider(): ProviderStub {
  const statements: string[] = [];
  const judgeCalls = { count: 0 };

  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  const originalLangfusePublic = process.env.LANGFUSE_PUBLIC_KEY;
  const originalLangfuseSecret = process.env.LANGFUSE_SECRET_KEY;

  // A key the stub never uses but `getJudgeModel()` insists on, and no tracing
  // client: both keep this suite off the network wherever it runs.
  process.env.OPENAI_API_KEY = "sk-test-not-a-real-key";
  delete process.env.LANGFUSE_PUBLIC_KEY;
  delete process.env.LANGFUSE_SECRET_KEY;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;

    if (url.includes("openai.com")) {
      if (url.includes("/responses") || url.includes("/chat/completions")) {
        judgeCalls.count++;
        return json(
          { error: { message: "bad gateway", type: "server_error" } },
          502
        );
      }
      return json({ error: { message: "no embeddings here" } }, 400);
    }

    const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string };
    statements.push(body.query ?? "");
    return json(
      { command: "SELECT", rowCount: 1, fields: [], rows: [NEON_NULL_ROW] },
      200
    );
  }) as typeof fetch;

  return {
    statements,
    judgeCalls,
    restore() {
      globalThis.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalKey;
      if (originalLangfusePublic !== undefined)
        process.env.LANGFUSE_PUBLIC_KEY = originalLangfusePublic;
      if (originalLangfuseSecret !== undefined)
        process.env.LANGFUSE_SECRET_KEY = originalLangfuseSecret;
    },
  };
}

/**
 * Batch deps whose `generateAssessment` is the REAL orchestrator, handed the
 * REAL judge pipeline. Only its two DB reads are fixtures.
 *
 * `thrown` collects what actually crosses the boundary the runner catches at,
 * so the predicate can be asked directly and not only through the outcome the
 * runner derives from it.
 */
function realChainDeps(
  pacer: TokenPacer,
  thrown: unknown[]
): RunAssessmentBatchDeps {
  return {
    maxBatch: 1,
    pacer,
    now: () => pacer.clock.now(),
    // Spent before the first plant starts. The loop runs it anyway (a run that
    // assesses nothing is worse than one that overshoots by a call), so the
    // first 1s backoff already lands past the deadline with attempts to spare —
    // which is exactly the state the marker exists to describe.
    runBudgetMs: 500,
    maxAttempts: MAX_ATTEMPTS_PER_PLANT,
    async selectPlantsForAssessment() {
      return [{ churchId: "church-0", reason: "never-assessed" as const }];
    },
    async generateAssessment(churchId, _deps, run) {
      try {
        return await generateAssessment(
          churchId,
          {
            buildFactSnapshot: async () => makeSnapshot({ churchId }),
            // THE LINK UNDER TEST. Replacing this with a stub is what every
            // other suite does, and it is why the rethrow contract was untested.
            runAssessment,
            getLatestCompleteSnapshot: async () => null,
          },
          run
        );
      } catch (error) {
        thrown.push(error);
        throw error;
      }
    },
  };
}

// ----------------------------------------------------------------------------
// §1 — the marker survives the real chain
// ----------------------------------------------------------------------------

test("§1 a deadline-truncated 5xx is still recognised after the real judge → orchestrator → runner chain", async () => {
  const pacer = new TokenPacer({
    clock: virtualClock(),
    // Far above what this run could spend: the only thing that can stop this
    // ladder is the run's own clock.
    limitTokens: 1_000_000,
  });

  const thrown: unknown[] = [];
  const provider = stubTheProvider();
  const capture = captureConsole();
  let summary;
  try {
    summary = await runAssessmentBatch(realChainDeps(pacer, thrown));
  } finally {
    capture.restore();
    provider.restore();
  }

  // The provider really was called, and really was cut short: one attempt out
  // of four, so the ladder stopped on the clock and not on the attempt count.
  assert.equal(provider.judgeCalls.count, 1);

  // The orchestrator really ran, rather than a stub standing in for it: the
  // pending row went in and the unjudged-run compare-and-set came back out.
  assert.ok(
    provider.statements.some((sql) =>
      /^insert into "plant_assessments"/.test(sql)
    ),
    `no pending row was inserted; statements were: ${JSON.stringify(provider.statements)}`
  );
  assert.ok(
    provider.statements.some((sql) =>
      /^update "plant_assessments" set "status" = \$1 where/.test(sql)
    ),
    `the unjudged-run write never ran; statements were: ${JSON.stringify(provider.statements)}`
  );

  // THE HEADLINE. The object the runner caught is the object `runPacedCall`
  // marked — three frames and two rethrows earlier. Wrap the error at either
  // rethrow site and this predicate is false, the flag below is `undefined`,
  // the warn line below is missing, and the error channel below is not empty.
  assert.equal(
    isDeadlineTruncatedFailure(thrown[0]),
    true,
    "the deadline mark is a WeakSet keyed on the error OBJECT: it only reaches the runner because every link rethrows the identical one"
  );

  const truncated = summary.outcomes[0];
  assert.equal(truncated?.status, "failed");
  assert.equal(truncated?.attempted, true);
  assert.equal(
    truncated?.truncatedByDeadline,
    true,
    "the deadline mark is carried by OBJECT IDENTITY: a rethrow that wraps the 5xx drops it, and a clock problem starts paging someone as a broken judge"
  );
  assert.equal(truncated?.deferralReason, undefined);
  assert.equal(summary.failed, 1);
  assert.equal(summary.deferred, 0);

  assert.deepEqual(capture.errors, []);
  assert.ok(
    capture.warns.some((line) =>
      /assessment truncated by the run budget for church church-0/.test(line)
    ),
    `warns were: ${JSON.stringify(capture.warns)}`
  );
});

test("§1b the same chain, with the clock out of the way, is an unmarked failure that stays loud", async () => {
  // The property no direction was allowed to lose, proven over the SAME real
  // chain: a judge that is genuinely down spends every attempt, so nothing
  // marks it and `console.error` still means what it always meant.
  const pacer = new TokenPacer({
    clock: virtualClock(),
    limitTokens: 1_000_000,
  });

  const thrown: unknown[] = [];
  const provider = stubTheProvider();
  const capture = captureConsole();
  let summary;
  try {
    summary = await runAssessmentBatch({
      ...realChainDeps(pacer, thrown),
      runBudgetMs: Number.MAX_SAFE_INTEGER,
      maxAttempts: 2,
    });
  } finally {
    capture.restore();
    provider.restore();
  }

  assert.equal(provider.judgeCalls.count, 2, "the ladder spent every attempt");

  assert.equal(
    isDeadlineTruncatedFailure(thrown[0]),
    false,
    "a ladder that spent its LAST attempt is deliberately NOT marked: it would have stopped whatever the clock said, and softening it would soften a genuinely broken judge"
  );

  const broken = summary.outcomes[0];
  assert.equal(broken?.status, "failed");
  assert.equal(broken?.attempted, true);
  assert.equal(broken?.truncatedByDeadline, undefined);

  assert.ok(
    capture.errors.some((line) =>
      /assessment failed for church church-0/.test(line)
    ),
    `errors were: ${JSON.stringify(capture.errors)}`
  );
  assert.ok(
    !capture.warns.some((line) => /truncated by the run budget/.test(line)),
    "a broken judge must never read as a clock problem"
  );
});

// ----------------------------------------------------------------------------
// §2 — the two rethrows the WeakSet rests on
//
// §1 fails if either link wraps, which is the guard that matters. This says
// what §1 would be failing ABOUT, at the two lines a reader would otherwise
// have to reverse-engineer the requirement from.
// ----------------------------------------------------------------------------

// Both anchors are the same at both sites, so a site is just its path: the
// span runs from the catch that receives the judge's throw to the rethrow that
// hands it on. `span` resolves BOTH ends through the reader, so the mutation
// this test exists to catch — a `throw new Error(msg, { cause: error })` in
// place of the bare rethrow — deletes the end anchor and the reader THROWS
// "<file> (comments stripped) no longer contains: throw error;". A hand-cut
// tail plus a bare `indexOf` would instead have degraded into a claim about
// the whole file, which is the rot `source-span.ts` exists to stop.
const RETHROW_SITES: readonly string[] = [
  "src/lib/phase-engine/judge/run-assessment.ts",
  "src/lib/phase-engine/assessment/generate-assessment.ts",
];

test("§2 every link between the judge and the runner rethrows the IDENTICAL object", async () => {
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");

  for (const file of RETHROW_SITES) {
    const code = stripComments(
      readFileSync(path.join(process.cwd(), file), "utf8")
    );
    const block = sourceReader(code, `${file} (comments stripped)`).span(
      "} catch (error) {",
      "throw error;"
    );

    assert.doesNotMatch(
      block,
      /new Error\(|cause:/,
      `${file}: wrapping the error (even with \`{ cause }\`) loses the deadline mark, and the loss is silent — no type, no \`instanceof\`, just a clock problem paging someone at 07:00 (#389)`
    );
  }
});
