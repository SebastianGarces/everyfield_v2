import assert from "node:assert/strict";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { z } from "zod";
import { addCalendarDays } from "@/lib/datetime";
import { questions } from "@/lib/evry/eve/evals/catalog";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import {
  createFixtureManifest,
  FIXTURE_NOW,
} from "@/lib/evry/eve/evals/fixtures/manifest";
import {
  capturedReadArtifactSchema,
  type CapturedCall,
} from "@/lib/evry/eve/evals/fixtures/host-capture";
import {
  staffingOverviewFixtureIds,
  seedStaffingOverviewFixture,
  staffingOverviewExpectations,
  observedStaffingOverviewFacts,
} from "@/lib/evry/eve/evals/fixtures/staffing-overview";

type InvokeRead = (
  name: string,
  input: unknown
) => Promise<z.infer<typeof capturedReadArtifactSchema>>;

async function runStaffingReads(
  caseId: (typeof staffingOverviewFixtureIds)[number],
  invoke: InvokeRead
) {
  const teamRead = (
    resource: string,
    filters: Record<string, unknown> = {},
    limit = 50
  ) =>
    invoke("teams.query", {
      request: {
        resource,
        where: { all: [filters] },
        query: { mode: "list", limit },
      },
    });
  const trainingRead = (
    resource: string,
    filters: Record<string, unknown> = {}
  ) =>
    invoke("training.query", {
      request: {
        resource,
        where: { all: [filters] },
        query: { mode: "list", limit: 50 },
      },
    });
  const fact = (
    item: z.infer<typeof capturedReadArtifactSchema>["items"][number],
    label: string
  ) => item.facts?.find((f) => f.label === label)?.value;
  const teams = await teamRead("teams");
  const children = teams.items.find((i) => i.label === "Children's Ministry"),
    hospitality = teams.items.find((i) => i.label === "Hospitality"),
    worship = teams.items.find((i) => i.label === "Worship");
  assert.ok(children && hospitality && worship);
  if (caseId === "teams-02")
    await teamRead("assignments", { statuses: ["active"] });
  if (caseId === "teams-03")
    await teamRead("teams", {
      statuses: ["active"],
      hasLeader: false,
    });
  if (caseId === "teams-04") {
    const teamIds = [children.id, hospitality.id];
    await teamRead("assignments", { teamIds, statuses: ["active"] });
    await trainingRead("programs", { teamIds, required: true });
    await trainingRead("requirements", { teamIds, completed: false });
    const details = await invoke("teams.get_many", {
      resource: "teams",
      ids: teamIds,
      sections: ["roles", "roster", "requirements"],
      relatedLimit: 20,
    });
    const child = details.items.find((i) => i.id === children.id)!;
    assert.equal(fact(child, "Active assignments total"), "3");
    assert.equal(fact(child, "Distinct active people total"), "2");
    assert.equal(fact(child, "Open role slots"), "2");
  }
  if (caseId === "teams-05") {
    await teamRead("responsibilities", { complete: false });
  }
  if (caseId === "roles-02")
    await invoke("people.query", {
      cohort: {
        all: {
          skill: { search: "audio" },
          membership: {
            existence: "not_recorded",
            teamIds: [worship.id],
          },
        },
      },
      result: { mode: "list", limit: 50 },
    });
  if (caseId === "training-04") {
    const people = await invoke("people.query", {
      cohort: {},
      result: { mode: "list", limit: 50 },
    });
    const details = await invoke("people.get_many", {
      resource: "person",
      ids: people.items.map((i) => i.id),
      fields: ["background_check"],
    });
    assert.ok(
      details.items.every((i) =>
        i.facts?.some((f) => f.label === "Background check")
      )
    );
    assert.ok(
      details.items.every((i) => !i.facts?.some((f) => /expir/i.test(f.label)))
    );
  }
  if (caseId === "cross-03") {
    const meetings = await invoke("meetings.query", {
      where: {
        all: [{ timing: "upcoming", statuses: ["planning", "ready"] }],
      },
      query: {
        mode: "list",
        limit: 50,
        sort: "date",
        direction: "asc",
      },
    });
    const next = meetings.items[0];
    assert.ok(next);
    const local = fact(next, "Local start");
    assert.ok(local && /^\d{4}-\d{2}-\d{2}/.test(local));
    const beforeDay = addCalendarDays(
      new Date(`${local.slice(0, 10)}T00:00:00Z`),
      -1
    );
    const gaps = await trainingRead("requirements", {
      completed: false,
    });
    const personIds = [
      ...new Set(gaps.items.map((i) => z.uuid().parse(fact(i, "Person ID")))),
    ];
    await invoke("tasks.assignees.search", { limit: 50 });
    await invoke("tasks.query", {
      where: {
        all: [
          {
            assignment: { kind: "people", ids: personIds },
            status: ["not_started", "in_progress", "blocked"],
            due: { kind: "range", from: null, through: beforeDay },
          },
        ],
      },
      query: { mode: "list", limit: 50 },
    });
  }

  return { teamRead, trainingRead, fact, worship };
}

test(
  "staffing corpus uses production relationships, independent SQL and truthful data limits",
  {
    skip: process.env.EVRY_EVE_STAFFING_OVERVIEW_PROOF !== "1",
    timeout: 600_000,
  },
  async (t) => {
    const stack = await startFixtureStack(process.cwd()),
      fetch = globalThis.fetch;
    const previous = {
      database: process.env.DATABASE_URL,
      resend: process.env.RESEND_API_KEY,
      endpoint: neonConfig.fetchEndpoint,
    };
    let outbound = 0;
    try {
      process.env.DATABASE_URL = stack.databaseUrl;
      process.env.RESEND_API_KEY = "re_fixture_never_sent";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      globalThis.fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        if (url.origin !== new URL(stack.proxyUrl).origin) {
          outbound++;
          throw new Error("Only isolated DB requests allowed");
        }
        return fetch(input, init);
      };
      const [
        { createEveToolRegistry },
        { requireEvryPlantViewerForSession },
        { authorizeEvryReadCapabilityForSession },
        { withAuthenticatedSessionId },
      ] = await Promise.all([
        import("@/lib/evry/eve/capabilities/registry"),
        import("@/lib/evry/eligibility/viewer"),
        import("@/lib/evry/eligibility/capabilities"),
        import("@/lib/auth/session-scope"),
      ]);
      const store = createFixtureStore(stack.container);
      for (const caseId of staffingOverviewFixtureIds)
        await t.test(caseId, async () => {
          const m = createFixtureManifest(caseId, 100);
          store.seed(m);
          seedStaffingOverviewFixture(m, store);
          const expected = staffingOverviewExpectations(m, store)!;
          const audit = store.auditStart();
          const actor = await requireEvryPlantViewerForSession(m.sessionId);
          const registry = createEveToolRegistry({
            context: {
              actor,
              literalUserText: questions.find((q) => q.id === caseId)!
                .turns[0]!,
              pageContext: null,
              now: FIXTURE_NOW,
            },
            authorizeRead: (identity) =>
              authorizeEvryReadCapabilityForSession(identity, m.sessionId),
          });
          const calls: CapturedCall[] = [];
          const invoke = async (name: string, input: unknown) => {
            const id = `staffing-${calls.length}`;
            const output = await withAuthenticatedSessionId(m.sessionId, () =>
              registry.invoke(name, input, { callId: id })
            );
            calls.push({ id, name, input, output });
            return capturedReadArtifactSchema.parse(output);
          };
          try {
            if (caseId === "teams-05") {
              assert.match(
                registry.describe().find((tool) => tool.name === "teams.query")!
                  .description,
                /no individual assignee/
              );
            }
            const { teamRead, trainingRead, fact, worship } =
              await runStaffingReads(caseId, invoke);
            const observed = observedStaffingOverviewFacts(caseId, calls);
            for (const call of calls)
              for (const item of capturedReadArtifactSchema.parse(call.output)
                .items)
                assert.ok(
                  !expected.absentRecordIds.includes(item.id),
                  "The actual read must not return a foreign or deleted record"
                );
            assert.deepEqual(
              observed.facts,
              expected.facts,
              JSON.stringify({
                caseId,
                calls,
                expected: expected.facts,
                actual: observed.facts,
              })
            );
            assert.deepEqual(observed.evidence, expected.requiredEvidence);
            assert.deepEqual(
              observedStaffingOverviewFacts(
                caseId,
                calls,
                new Set(calls.map((c) => c.id))
              ),
              observed,
              "Choosing cards does not change source facts"
            );
            const correctCalls = structuredClone(calls);
            const relevant = correctCalls.findLast((c) =>
              caseId === "training-04"
                ? c.name === "people.get_many"
                : caseId === "roles-02"
                  ? c.name === "people.query"
                  : caseId === "cross-03"
                    ? c.name === "tasks.query"
                    : caseId === "teams-04"
                      ? c.name === "training.query"
                      : c.name === "teams.query"
            );
            assert.ok(relevant);
            const partial = z
              .object({ items: z.array(z.unknown()) })
              .passthrough()
              .parse(relevant.output);
            relevant.output = { ...partial, items: partial.items.slice(1) };
            assert.notDeepEqual(
              observedStaffingOverviewFacts(caseId, correctCalls).facts,
              expected.facts,
              "Dropped evidence must not pass"
            );
            if (caseId === "teams-01")
              await teamRead("teams", { hasVacancies: false });
            if (caseId === "teams-02")
              await teamRead("assignments", { statuses: ["inactive"] });
            if (caseId === "teams-03")
              await teamRead("teams", { hasVacancies: true });
            if (caseId === "teams-04")
              await trainingRead("requirements", { completed: true });
            if (caseId === "teams-05")
              await teamRead("responsibilities", { complete: true });
            if (caseId === "roles-02")
              await invoke("people.query", {
                cohort: { all: { skill: { search: "audio" } } },
                result: { mode: "list", limit: 50 },
              });
            if (caseId === "training-04")
              await invoke("people.get_many", {
                resource: "person",
                ids: [m.ids["core-alex"]],
                fields: ["background_check"],
              });
            if (caseId === "cross-03") {
              const training = calls.findLast(
                (c) => c.name === "training.query"
              )!;
              const personIds = [
                ...new Set(
                  capturedReadArtifactSchema
                    .parse(training.output)
                    .items.map((i) => z.uuid().parse(fact(i, "Person ID")))
                ),
              ];
              await invoke("tasks.query", {
                where: {
                  all: [{ assignment: { kind: "accounts", ids: personIds } }],
                },
                query: { mode: "list", limit: 50 },
              });
            }
            assert.notDeepEqual(
              observedStaffingOverviewFacts(caseId, calls).facts,
              expected.facts,
              "Wrong roster/filter/account-ID-space must fail independent SQL truth"
            );
            assert.deepEqual(store.writesSince(audit, m), []);
            assert.equal(outbound, 0);
          } finally {
            store.revoke(m);
          }
        });
      const { createProductionEveEvalAdapter } =
        await import("@/lib/evry/eve/evals/fixtures/adapter");
      for (const caseId of staffingOverviewFixtureIds)
        await t.test(`adapter ${caseId}`, async () => {
          const scenario = questions.find(
            (question) => question.id === caseId
          )!;
          const returned: CapturedCall[] = [];
          const sessions = new Set<string>();
          const adapter = createProductionEveEvalAdapter({
            store,
            buildSha: "0".repeat(40),
            async runProduction({ scenario: bound, registry, sessionId }) {
              sessions.add(sessionId);
              assert.deepEqual(
                bound.turns,
                scenario.turns,
                "Original question has no hidden reformulation"
              );
              await runStaffingReads(caseId, async (name, input) => {
                const id = `adapter-staffing-${returned.length}`;
                const output = await registry.invoke(name, input, {
                  callId: id,
                });
                returned.push({ id, name, input, output });
                return capturedReadArtifactSchema.parse(output);
              });
              return {
                answer:
                  "Scripted retrieval proof only; model quality not reviewed.",
                clarificationCount: 0,
                costUsd: 0,
                judge: null,
                latency: {
                  acknowledgementMs: 0,
                  firstTextMs: null,
                  totalMs: 0,
                },
              };
            },
          });
          const fixture = await adapter.prepare(scenario);
          assert.ok(fixture, `${caseId} must bind through the actual adapter`);
          try {
            const observation = observationSchema.parse(
              await fixture.run({
                scenario,
                signal: AbortSignal.timeout(60_000),
                maxCostUsd: 0.1,
              })
            );
            assert.deepEqual(
              gradeObservation(caseId, fixture.expectations, observation)
                .failures,
              ["quality_not_reviewed"],
              JSON.stringify(observation)
            );
            assert.deepEqual(observation.effects, {
              domainWrites: 0,
              outboundMessages: 0,
            });
            assert.equal(observation.costUsd, 0);
            assert.equal(observation.judge, null);
            assert.ok(returned.length > 0);
            // Adapter exposedRecordIds describes displayed cards, so separately inspect actual registry reads.
            for (const call of returned)
              for (const item of capturedReadArtifactSchema.parse(call.output)
                .items)
                assert.ok(
                  !fixture.expectations.absentRecordIds.includes(item.id),
                  "Actual registry output cannot contain forbidden records even without a card"
                );
            // A grading-contract negative, not a fabricated model judgment or substituted tool response.
            assert.ok(
              gradeObservation(caseId, fixture.expectations, {
                ...observation,
                facts: {},
                evidence: [],
              }).failures.some((failure) => failure.startsWith("fact:"))
            );
            assert.equal(outbound, 0);
          } finally {
            await fixture.cleanup();
          }
          for (const session of sessions)
            assert.equal(
              store.sql(`select count(*) from sessions where id='${session}'`),
              "0",
              "Adapter cleanup revokes its fixture session"
            );
        });
      t.diagnostic(
        "Source evidence only. No model answer, unsupported-field explanation, or browser quality has been judged."
      );
    } finally {
      globalThis.fetch = fetch;
      neonConfig.fetchEndpoint = previous.endpoint;
      if (previous.database === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous.database;
      if (previous.resend === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previous.resend;
      await stack.cleanup();
      t.diagnostic("Owned disposable fixture stack cleaned up.");
    }
  }
);
