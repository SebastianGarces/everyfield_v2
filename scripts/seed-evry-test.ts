/**
 * Dedicated, renewable Evry QA plant. No provider generation or outbound mail.
 * Default: print the plan. --reset: replace this plant's operational test data.
 * --check: read-only validation. --as-of=ISO: reproducible date boundary proof.
 * Never run the global db:seed as part of this command.
 */
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import assert from "node:assert/strict";
import { eq, sql } from "drizzle-orm";
import { hashPassword } from "../src/lib/auth/password";
import * as schema from "../src/db/schema";

async function main() {
  config({ path: ".env.local", quiet: true });
  const { values } = parseArgs({
    options: {
      reset: { type: "boolean" },
      check: { type: "boolean" },
      "rollback-test": { type: "boolean" },
      "guard-test": { type: "boolean" },
      "as-of": { type: "string" },
    },
    strict: true,
  });
  if (values.reset && values.check)
    throw new Error("Choose --reset or --check, not both");
  if (values["rollback-test"] && !values.reset)
    throw new Error("--rollback-test requires --reset");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const client = neon(connectionString);
  const db = drizzle(client);
  const {
    buildEvryTestFixtures,
    EVRY_TEST_ACCOUNTS,
    EVRY_TEST_CHURCH_ID: churchId,
    EVRY_TEST_CHURCH_NAME: churchName,
    EVRY_TEST_TIME_ZONE: timeZone,
    fixtureId,
  } = await import("./evry-test-fixtures");
  const asOf = values["as-of"] ? new Date(values["as-of"]) : new Date();
  const [section] = await db
    .select({ id: schema.wikiSections.id })
    .from(schema.wikiSections)
    .limit(1);
  const fixture = buildEvryTestFixtures(asOf, section?.id ?? null);
  const owner = EVRY_TEST_ACCOUNTS[0].id;
  const accountIds = EVRY_TEST_ACCOUNTS.map(
    (account) => `'${account.id}'`
  ).join(",");
  const PASSWORD = "password123";

  // All interpolated SQL identifiers and literals below are closed, code-owned
  // names/UUIDs. No CLI argument, URL, environment value, or database text is SQL.
  let guard = `DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM churches WHERE id = '${churchId}' AND
    (sending_network_id IS NOT NULL OR sending_church_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'Evry QA plant gained an external association; reset refused';
  END IF;
  IF EXISTS (SELECT 1 FROM churches c WHERE c.id = '${churchId}'
    AND c.name <> '${churchName}' AND NOT EXISTS
      (SELECT 1 FROM users u WHERE u.id = '${owner}' AND u.church_id = c.id AND u.email = '${EVRY_TEST_ACCOUNTS[0].email}')) THEN
    RAISE EXCEPTION 'Evry QA church identity collision; reset refused';
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE church_id = '${churchId}' AND id NOT IN (${accountIds})) THEN
    RAISE EXCEPTION 'Evry QA plant contains an account not owned by this seed; reset refused';
  END IF;
  ${EVRY_TEST_ACCOUNTS.map(
    (
      account
    ) => `IF EXISTS (SELECT 1 FROM users WHERE (id = '${account.id}' OR lower(email) = '${account.email}')
    AND NOT (id = '${account.id}' AND email = '${account.email}' AND church_id = '${churchId}' AND sending_church_id IS NULL AND sending_network_id IS NULL)) THEN
    RAISE EXCEPTION 'Evry QA account identity collision; reset refused'; END IF;`
  ).join("\n")}
  IF EXISTS (SELECT 1 FROM evry_active_runs WHERE church_id = '${churchId}' AND status = 'active' AND expires_at > now()) THEN
    RAISE EXCEPTION 'Evry request is running; wait for it to finish before resetting';
  END IF;
  IF EXISTS (SELECT 1 FROM evry_action_plans p JOIN evry_action_plan_states s ON s.plan_id = p.id
    WHERE p.church_id = '${churchId}' AND (s.status = 'executing' OR (p.expires_at > now() AND s.status IN ('awaiting_confirmation','approved')))) THEN
    RAISE EXCEPTION 'Evry plan is still actionable; finish or recover execution, or let an unconfirmed plan expire before resetting';
  END IF;
  IF EXISTS (SELECT 1 FROM evry_execution_effect_claims c WHERE c.church_id = '${churchId}' AND NOT EXISTS
    (SELECT 1 FROM evry_execution_outcomes o WHERE o.church_id = c.church_id AND o.effect_key = c.effect_key AND o.subject = 'step' AND o.status = 'completed')) THEN
    RAISE EXCEPTION 'Evry has an unreconciled execution effect; recover it before resetting';
  END IF;
  IF EXISTS (SELECT 1 FROM generated_documents WHERE id IN (${schema.generatedDocumentFormats.map((format) => `'${fixtureId(`document:${format}`)}'`).join(",")})
    AND (church_id IS DISTINCT FROM '${churchId}'::uuid OR user_id IS DISTINCT FROM '${owner}'::uuid)) THEN
    RAISE EXCEPTION 'Evry QA document identity collision; reset refused';
  END IF;
END $$`;

  const resetTables = fixture.batches.map((batch) => batch.table);
  const userScoped = new Set([
    "wiki_bookmarks",
    "wiki_progress",
    "notification_preferences",
  ]);
  function scope(table: string): string {
    if (userScoped.has(table)) return `user_id IN (${accountIds})`;
    if (table === "notification_deliveries")
      return `notification_id IN (SELECT id FROM notifications WHERE church_id = '${churchId}')`;
    return `church_id = '${churchId}'`;
  }

  // Catch cross-tenant child rows before an ON DELETE CASCADE can touch them.
  // Names come from PostgreSQL's catalog and are quoted, never executed as text.
  const quoteIdentifier = (name: string) => `"${name.replaceAll('"', '""')}"`;
  const foreignKeys = await client.query(
    `SELECT child.relname AS child_table, parent.relname AS parent_table,
  ca.attname AS child_column, pa.attname AS parent_column,
  EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = child.oid AND a.attname = 'church_id' AND NOT a.attisdropped) AS child_has_church
  FROM pg_constraint fk JOIN pg_class child ON child.oid = fk.conrelid JOIN pg_class parent ON parent.oid = fk.confrelid
  JOIN pg_namespace ns ON ns.oid = child.relnamespace
  JOIN pg_attribute ca ON ca.attrelid = child.oid AND ca.attnum = fk.conkey[1]
  JOIN pg_attribute pa ON pa.attrelid = parent.oid AND pa.attnum = fk.confkey[1]
  WHERE fk.contype = 'f' AND ns.nspname = 'public' AND array_length(fk.conkey,1) = 1 AND parent.relname = ANY($1::text[])`,
    [
      [
        ...resetTables,
        "plant_assessments",
        "plant_insights",
        "insight_feedback",
        "meeting_confirmation_tokens",
      ].filter(
        (table) => !userScoped.has(table) && table !== "notification_deliveries"
      ),
    ]
  );
  const cascadeGuards = foreignKeys.flatMap((fk) => {
    if (!fk.child_has_church && resetTables.includes(fk.child_table)) return [];
    return [
      `IF EXISTS (SELECT 1 FROM ${quoteIdentifier(fk.child_table)} child JOIN ${quoteIdentifier(fk.parent_table)} parent
    ON child.${quoteIdentifier(fk.child_column)} = parent.${quoteIdentifier(fk.parent_column)}
    WHERE parent.church_id = '${churchId}' ${fk.child_has_church ? `AND child.church_id IS DISTINCT FROM '${churchId}'::uuid` : ""}) THEN
    RAISE EXCEPTION 'An external dependent references Evry QA data; reset refused'; END IF;`,
    ];
  });
  guard = guard.replace("END $$", () => `${cascadeGuards.join("\n")}\nEND $$`);

  if (values["guard-test"]) {
    if (values.reset || values.check)
      throw new Error("Run --guard-test on its own after seeding");
    const foreignChurchId = fixtureId("guard-foreign-plant");
    const probes = [
      {
        name: "document ownership collision",
        queries: [
          client.query(
            "UPDATE generated_documents SET user_id = $1 WHERE id = $2 AND church_id = $3",
            [EVRY_TEST_ACCOUNTS[1].id, fixtureId("document:pdf"), churchId]
          ),
        ],
        message: "document identity collision",
      },
      {
        name: "expired but interrupted execution",
        queries: [
          client.query(
            "CREATE TEMP TABLE evry_action_plans (id uuid, church_id uuid, expires_at timestamptz) ON COMMIT DROP"
          ),
          client.query(
            "CREATE TEMP TABLE evry_action_plan_states (plan_id uuid, status text) ON COMMIT DROP"
          ),
          client.query(
            "INSERT INTO evry_action_plans VALUES ($1, $2, now() - interval '1 day')",
            [fixtureId("guard-plan"), churchId]
          ),
          client.query(
            "INSERT INTO evry_action_plan_states VALUES ($1, 'executing')",
            [fixtureId("guard-plan")]
          ),
        ],
        message: "plan is still actionable",
      },
      {
        name: "unreconciled execution effect",
        queries: [
          client.query(
            "CREATE TEMP TABLE evry_execution_effect_claims (church_id uuid, effect_key text) ON COMMIT DROP"
          ),
          client.query(
            "INSERT INTO evry_execution_effect_claims VALUES ($1, 'evry-test-unresolved-effect')",
            [churchId]
          ),
        ],
        message: "unreconciled execution effect",
      },
      {
        name: "cross-plant insight cascade",
        queries: [
          client.query(
            "INSERT INTO churches (id, name) VALUES ($1, 'Evry rollback-only guard probe')",
            [foreignChurchId]
          ),
          client.query(
            "UPDATE plant_insights SET church_id = $1 WHERE id = $2 AND church_id = $3",
            [foreignChurchId, fixtureId("plant-insight"), churchId]
          ),
        ],
        message: "external dependent references Evry QA data",
      },
    ];
    for (const probe of probes) {
      try {
        // The final forced failure protects the data even if a guard regresses.
        await client.transaction([
          ...probe.queries,
          client.query(guard),
          client.query("SELECT 1/0"),
        ]);
        throw new Error("Guard probe unexpectedly committed");
      } catch (error: unknown) {
        if (!(error instanceof Error) || !error.message.includes(probe.message))
          throw error;
      }
      console.log(`Guard verified: ${probe.name}. Probe rolled back.`);
    }
    return;
  }

  async function verify() {
    const counts: Record<string, number> = {};
    for (const batch of fixture.batches) {
      const [row] = await client.query(
        `SELECT count(*)::int AS count FROM "${batch.table}" WHERE ${scope(batch.table)}`
      );
      counts[batch.table] = row.count;
      if (row.count !== batch.count)
        throw new Error(
          `${batch.table}: expected ${batch.count}, found ${row.count}. Run --reset to restore fixtures.`
        );
    }
    const [tasks] = await client.query(
      `SELECT
    count(*) FILTER (WHERE assigned_to_id = $1 AND status <> 'complete' AND due_date = $2::date)::int AS due_today,
    count(*) FILTER (WHERE assigned_to_id = $1 AND status <> 'complete' AND due_date < $2::date)::int AS overdue,
    count(*) FILTER (WHERE assigned_to_id = $1 AND status = 'complete' AND due_date = $2::date)::int AS completed_today
    FROM tasks WHERE church_id = $3 AND deleted_at IS NULL`,
      [owner, fixture.today, churchId]
    );
    if (
      tasks.due_today !== fixture.expected.ownerPendingDueToday ||
      tasks.overdue !== fixture.expected.ownerPendingOverdue ||
      tasks.completed_today !== fixture.expected.ownerCompletedDueToday
    )
      throw new Error(
        `Task-date fixture is stale or edited: ${JSON.stringify(tasks)}. Run --reset.`
      );
    const [launch] = await client.query(
      "SELECT count(*)::int AS count FROM launch_milestones WHERE church_id = $1 AND completed_at IS NOT NULL",
      [churchId]
    );
    if (launch.count !== fixture.expected.completedLaunchMilestones)
      throw new Error("Launch completion fixture mismatch");
    const [assessment] = await db
      .select()
      .from(schema.plantAssessments)
      .where(eq(schema.plantAssessments.id, fixtureId("plant-assessment")));
    if (!assessment || assessment.churchId !== churchId)
      throw new Error("Missing QA Plant Intelligence assessment");
    const { buildFactSnapshot } =
      await import("../src/lib/phase-engine/signals");
    const liveSnapshot = await buildFactSnapshot(churchId, {
      asOf: assessment.generatedAt,
    });
    // SQL grouping has no array-order guarantee. Compare all actual values.
    function canonical(value: unknown): unknown {
      if (Array.isArray(value))
        return value
          .map(canonical)
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      if (value !== null && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, canonical(item)])
        );
      return value;
    }
    assert.deepEqual(
      canonical(liveSnapshot),
      canonical(assessment.factSnapshot),
      "Stored QA snapshot must match real production reads"
    );
    const documents = await db
      .select()
      .from(schema.generatedDocuments)
      .where(eq(schema.generatedDocuments.churchId, churchId));
    const { getFileBytes } = await import("../src/lib/storage");
    for (const format of schema.generatedDocumentFormats) {
      const document = documents.find(
        (row) => row.id === fixtureId(`document:${format}`)
      );
      if (!document) throw new Error(`Missing ${format} document fixture`);
      const file = await getFileBytes(document.storageKey);
      if (!file || file.body.length < 100)
        throw new Error(`Unreadable ${format} document fixture`);
    }
    console.log(
      JSON.stringify(
        {
          mode: "verified",
          asOf: asOf.toISOString(),
          today: fixture.today,
          timeZone,
          account: EVRY_TEST_ACCOUNTS[0].email,
          churchId,
          expected: fixture.expected,
          counts,
          documents: documents.length,
        },
        null,
        2
      )
    );
  }

  if (!values.reset && !values.check) {
    console.log(
      JSON.stringify(
        {
          mode: "plan-only",
          account: EVRY_TEST_ACCOUNTS[0].email,
          churchId,
          today: fixture.today,
          timeZone,
          replaceOperationalTables: resetTables,
          preserve: [
            "users and login identities",
            "Evry conversations, plans, confirmations and audit history",
            "global Wiki and templates",
            "other plants",
            "existing stored files",
          ],
          expected: fixture.expected,
          commands: ["pnpm evry:seed --reset", "pnpm evry:seed --check"],
        },
        null,
        2
      )
    );
  } else if (values.check) {
    await verify();
  } else {
    await client.query(guard);
    const { renderDocument, registeredTemplateIds } =
      await import("../src/lib/documents/render");
    const { createFileIfAbsent, getFileBytes } =
      await import("../src/lib/storage");
    const documents: schema.NewGeneratedDocument[] = [];
    // Upload first. Conditional creates never overwrite an older download.
    // A failed database transaction leaves at most three reusable private objects.
    for (const format of schema.generatedDocumentFormats) {
      const templateId = registeredTemplateIds(format)[0];
      if (!templateId) throw new Error(`No ${format} document renderer`);
      const storageKey = `documents/${churchId}/evry-test/${fixtureId(`document:${format}`)}.${format}`;
      const existing = await getFileBytes(storageKey);
      const bytes = existing
        ? Buffer.from(existing.body)
        : await renderDocument(format, templateId, {
            church_name: churchName,
            pastor_name: "Evry Test",
            meeting_date: "See the current meeting calendar",
            meeting_location: "Evry Community Center",
          });
      const digest = createHash("sha256").update(bytes).digest("hex");
      await createFileIfAbsent(
        storageKey,
        bytes,
        format === "pdf"
          ? "application/pdf"
          : format === "docx"
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      const stored = await getFileBytes(storageKey);
      if (
        !stored ||
        createHash("sha256").update(stored.body).digest("hex") !== digest
      )
        throw new Error("Uploaded fixture bytes failed verification");
      documents.push({
        id: fixtureId(`document:${format}`),
        churchId,
        userId: owner,
        templateId,
        format,
        storageKey,
        createdAt: asOf,
      });
    }
    const { buildEvryTestSnapshot } = await import("./evry-test-snapshot");
    const snapshot = buildEvryTestSnapshot(fixture, asOf);
    if (snapshot.isColdStart)
      throw new Error("QA snapshot unexpectedly cold-started");
    const assessmentId = fixtureId("plant-assessment");
    const intelligence = [
      db
        .insert(schema.plantAssessments)
        .values({
          id: assessmentId,
          churchId,
          generatedAt: asOf,
          phase: 4,
          rubricVersion: "v1",
          factSnapshot: snapshot,
          modelId: "evry-test-fixture-no-model",
          status: "complete",
          createdAt: asOf,
        })
        .toSQL(),
      db
        .insert(schema.plantInsights)
        .values({
          id: fixtureId("plant-insight"),
          churchId,
          assessmentId,
          audience: "planter",
          category: "follow_up",
          severity: "info",
          title: "QA fixture: review follow-up ownership",
          body: "This is a seeded QA insight, not an AI assessment. Review the follow-up queue and assign contacts who have no owner.",
          citedFacts: [],
          rank: 0,
          createdAt: asOf,
        })
        .toSQL(),
      db
        .insert(schema.insightFeedback)
        .values({
          id: fixtureId("insight-feedback"),
          churchId,
          assessmentId,
          insightId: fixtureId("plant-insight"),
          userId: owner,
          rubricVersion: "v1",
          rating: "useful",
          comment: "Fictional QA feedback.",
          createdAt: asOf,
          updatedAt: asOf,
        })
        .toSQL(),
    ];
    const passwordHash = await hashPassword(PASSWORD);
    const churchInsert = db
      .insert(schema.churches)
      .values({
        id: churchId,
        name: churchName,
        currentPhase: 4,
        city: "Albany",
        stateRegion: "NY",
        country: "US",
        timeZone,
        onboardingCompletedAt: sql`now()`,
        leadershipStatus: "planter_confirmed",
        lastMaterialEventAt: asOf,
        updatedAt: asOf,
      })
      .onConflictDoUpdate({
        target: schema.churches.id,
        set: {
          name: churchName,
          currentPhase: 4,
          timeZone,
          onboardingCompletedAt: sql`now()`,
          leadershipStatus: "planter_confirmed",
          lastMaterialEventAt: asOf,
          updatedAt: asOf,
        },
      })
      .toSQL();
    const writes = [
      client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('everyfield:evry-test:v1', 0))"
      ),
      client.query(guard),
      client.query(churchInsert.sql, churchInsert.params),
      ...EVRY_TEST_ACCOUNTS.map((account) => {
        const query = db
          .insert(schema.users)
          .values({ ...account, churchId, passwordHash })
          .onConflictDoUpdate({
            target: schema.users.id,
            set: {
              name: account.name,
              seat: account.seat,
              passwordHash,
              updatedAt: asOf,
            },
          })
          .toSQL();
        return client.query(query.sql, query.params);
      }),
      // Extra operational dependents that may have been created during QA.
      client.query(
        "DELETE FROM meeting_confirmation_tokens WHERE church_id = $1",
        [churchId]
      ),
      client.query("DELETE FROM insight_feedback WHERE church_id = $1", [
        churchId,
      ]),
      client.query("DELETE FROM plant_insights WHERE church_id = $1", [
        churchId,
      ]),
      client.query("DELETE FROM plant_assessments WHERE church_id = $1", [
        churchId,
      ]),
      ...[...resetTables]
        .reverse()
        .map((table) =>
          client.query(`DELETE FROM "${table}" WHERE ${scope(table)}`)
        ),
      ...fixture.batches.map((batch) => client.query(batch.sql, batch.params)),
      ...documents.map((document) => {
        const query = db
          .insert(schema.generatedDocuments)
          .values(document)
          .onConflictDoUpdate({
            target: schema.generatedDocuments.id,
            set: { storageKey: document.storageKey, createdAt: asOf },
          })
          .toSQL();
        return client.query(query.sql, query.params);
      }),
      ...intelligence.map((query) => client.query(query.sql, query.params)),
    ];
    // Neon batched transaction, not unsupported interactive db.transaction().
    if (values["rollback-test"]) {
      const censusTables = [
        ...resetTables,
        "churches",
        "users",
        "plant_assessments",
        "plant_insights",
        "insight_feedback",
        "generated_documents",
      ];
      const census = () =>
        client.query(
          censusTables
            .map(
              (table) =>
                `SELECT '${table}' AS name, md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text, 'null')) AS digest FROM "${table}" t WHERE ${table === "churches" ? `id = '${churchId}'` : scope(table)}`
            )
            .join(" UNION ALL ")
        );
      const before = await census();
      try {
        await client.transaction([
          ...writes,
          client.query("SELECT 1 / 0 AS intentional_rollback_probe"),
        ]);
        throw new Error("Rollback probe unexpectedly committed");
      } catch (error: unknown) {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          error.code !== "22012"
        )
          throw error;
      }
      const after = await census();
      if (JSON.stringify(before) !== JSON.stringify(after))
        throw new Error("Rollback changed QA records");
      console.log(
        "Rollback verified: every QA operational table and account is byte-identical after a forced failure. No seed transaction committed."
      );
      return;
    }
    await client.transaction(writes);
    await verify();
    console.log(
      "Reset complete. Only the dedicated QA plant's operational data was replaced. Evry audit history and other plants were preserved. No mail or model requests were made."
    );
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Evry seed failed");
  process.exitCode = 1;
});
