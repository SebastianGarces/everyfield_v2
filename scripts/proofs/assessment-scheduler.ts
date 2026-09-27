/** Real production-route proof. Requires the owned preview runner, no OpenAI key,
 * a private CRON_SECRET matching preview.json, and ASSESS_URL for that preview.
 * Run once on freshly provisioned fixtures; the whole owned DB is disposable.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { churches, plantAssessments } from "@/db/schema";
import { buildFactSnapshot } from "@/lib/phase-engine/signals";
import {
  getLatestAssessment,
  selectPlantsForAssessment,
} from "@/lib/phase-engine/assessment";

async function main() {
  assert.equal(process.env.EVERYFIELD_OWNED_PREVIEW, "1");
  const database = new URL(process.env.DATABASE_URL!);
  assert.equal(database.hostname, "localhost");
  assert.match(database.pathname, /^\/ef_preview_[a-f0-9]{12}$/);
  const identity = await db.execute<{ name: string }>(
    sql`select current_database() as name`
  );
  assert.equal(identity.rows[0].name, database.pathname.slice(1));
  assert.ok(
    !process.env.OPENAI_API_KEY,
    "No external provider key is permitted in this proof"
  );
  const url = new URL(process.env.ASSESS_URL!);
  assert.match(
    url.hostname,
    /^everyfield-889-assessment-[a-f0-9]+\.localhost$/
  );
  assert.equal(url.pathname, "/api/phase-engine/assess");
  const secret = process.env.CRON_SECRET;
  assert.ok(secret);
  const output = process.argv[2];
  assert.ok(output?.startsWith("/private/tmp/"));

  const plants = await db.select().from(churches);
  assert.equal(plants.length, 2, "Use fresh owned preview fixtures");
  assert.equal((await db.select().from(plantAssessments)).length, 0);
  const primary = plants.find(
    (plant) => plant.name === "Preview primary plant"
  )!;
  assert.ok(primary);
  const snapshot = await buildFactSnapshot(primary.id);
  const [lastGood] = await db
    .insert(plantAssessments)
    .values({
      churchId: primary.id,
      phase: primary.currentPhase,
      rubricVersion: "owned-proof-last-good",
      status: "complete",
      factSnapshot: snapshot,
      generatedAt: new Date(Date.now() - 8 * 86400000),
    })
    .returning();
  const original = JSON.stringify(lastGood);

  const denied = await fetch(url, {
    headers: { Authorization: "Bearer wrong-owned-token" },
  });
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), { error: "Unauthorized" });
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${secret}` },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.selected, 2);
  assert.equal(body.attempted, 2);
  assert.equal(body.assessed, 0);
  assert.equal(body.failed, 2);
  assert.ok(
    body.outcomes.every((outcome: { error: string }) =>
      outcome.error.includes("OPENAI_API_KEY is not set")
    )
  );

  const child = spawn(
    process.execPath,
    [resolve("scripts/phase-engine-assess.mjs")],
    {
      env: {
        NODE_ENV: "production",
        ASSESS_URL: url.href,
        CRON_SECRET: secret,
      },
    }
  );
  let transcript = "";
  child.stdout.on("data", (data) => (transcript += data));
  child.stderr.on("data", (data) => (transcript += data));
  const [exitCode] = await once(child, "close");
  assert.equal(exitCode, 1);
  assert.match(transcript, /"assessed":0,"failed":2/);
  assert.ok(!transcript.includes(secret));
  assert.ok(
    !transcript.includes("OPENAI_API_KEY is not set"),
    "Raw provider errors must not be printed by the scheduler"
  );

  const [retained] = await db
    .select()
    .from(plantAssessments)
    .where(eq(plantAssessments.id, lastGood.id));
  assert.equal(
    JSON.stringify(retained),
    original,
    "Last good snapshot must remain byte-for-byte unchanged"
  );
  assert.equal(
    (await getLatestAssessment(primary.id))?.assessment.id,
    lastGood.id
  );
  const eligible = await selectPlantsForAssessment();
  assert.deepEqual(
    new Set(eligible.map((plant) => plant.churchId)),
    new Set(plants.map((plant) => plant.id))
  );
  const failed = await db
    .select()
    .from(plantAssessments)
    .where(
      and(
        eq(plantAssessments.status, "failed"),
        eq(plantAssessments.churchId, primary.id)
      )
    );
  assert.equal(
    failed.length,
    2,
    "Each real tick records its failed attempt without replacing the complete row"
  );
  const evidence = {
    database: identity.rows[0].name,
    url: url.href,
    unauthorized: { status: denied.status, body: { error: "Unauthorized" } },
    missingProvider: {
      status: response.status,
      selected: body.selected,
      attempted: body.attempted,
      assessed: body.assessed,
      failed: body.failed,
    },
    scheduler: { exitCode, transcript },
    lastGoodSnapshot: "unchanged and remains the application read result",
    laterRunEligibility: eligible.length,
    operationalDependency:
      "#191 remains operator-owned; no production credential restored",
  };
  writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n", {
    mode: 0o600,
  });
  console.log(
    "Owned assessment scheduler proof passed; last good snapshot retained and both plants remain eligible."
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
