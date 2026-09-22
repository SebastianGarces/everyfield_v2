import assert from "node:assert/strict";
import { test } from "node:test";
import type { TeamsEffectArguments } from "@/lib/evry/capabilities/teams/effect-contracts";
import { questions } from "../catalog";
import { createFixtureManifest } from "./manifest";
import type { CapturedCall } from "./host-capture";
import {
  staffingPreparationFixtureIds,
  staffingPreparationQuestions,
  staffingPreparationReference,
  staffingPreparationReviewMatches,
  staffingPreparationChangesStayScoped,
  readPreparedStaffingFacts,
} from "./staffing-preparations";

const id = "11111111-1111-4111-8111-111111111111";
const plan = { planId: id, fingerprint: "a".repeat(64) };
const call: CapturedCall = {
  id: "review",
  name: "actions.prepare",
  input: {},
  output: {
    artifacts: [{ kind: "confirmation" }],
    activePlan: { mode: "set", plan },
  },
};
const args: TeamsEffectArguments = {
  operation: "markTrainingCompleteAction",
  expected: [],
  sets: [],
  mutations: [
    {
      table: "training_completions",
      id,
      mode: "insert",
      before: null,
      after: { id },
    },
  ],
  notificationIntents: [],
  disclosure: {
    title: "Record completion",
    targets: [{ label: "Person", value: "Alex Morgan", href: `/people/${id}` }],
    counts: [],
    changes: [],
    consequences: ["Records this training completion."],
    reversibility: "reversible",
    dateTime: null,
  },
};
function review() {
  const text = JSON.stringify(args),
    middle = Math.floor(text.length / 2);
  return {
    artifacts: [
      {
        kind: "confirmation",
        steps: [
          {
            contentPreviews: [
              {
                label: "Complete immutable plan (page 1 of 2)",
                content: text.slice(0, middle),
              },
              {
                label: "Complete immutable plan (page 2 of 2)",
                content: text.slice(middle),
              },
            ],
            resolvedTargets: [
              {
                label: "Person",
                value: "Alex Morgan",
                sourceLink: { href: `/people/${id}` },
              },
            ],
          },
        ],
      },
    ],
  };
}

test("staffing preparation fixtures preserve all three original questions", () => {
  for (const caseId of staffingPreparationFixtureIds)
    assert.deepEqual(questions.find((q) => q.id === caseId)!.turns, [
      staffingPreparationQuestions[caseId],
    ]);
});
test("only the latest presented successful preparation identifies a review", () => {
  assert.deepEqual(
    staffingPreparationReference([call], new Set([call.id])),
    plan
  );
  assert.equal(staffingPreparationReference([call], new Set()), null);
  assert.equal(
    staffingPreparationReference(
      [call, { ...call, id: "later", output: {} }],
      new Set([call.id, "later"])
    ),
    null
  );
  assert.equal(
    staffingPreparationReference(
      [call, { ...call, id: "later" }],
      new Set([call.id])
    ),
    null
  );
  assert.equal(
    staffingPreparationReference(
      [{ ...call, output: { activePlan: { mode: "set", plan } } }],
      new Set([call.id])
    ),
    null
  );
});
test("complete immutable review pages and exact linked target are required", () => {
  assert.equal(staffingPreparationReviewMatches(review(), args), true);
  for (const alter of [
    (value: ReturnType<typeof review>) => {
      value.artifacts[0]!.steps[0]!.contentPreviews.pop();
    },
    (value: ReturnType<typeof review>) => {
      value.artifacts[0]!.steps[0]!.contentPreviews.reverse();
    },
    (value: ReturnType<typeof review>) => {
      value.artifacts[0]!.steps[0]!.resolvedTargets[0]!.value = "Casey Reed";
    },
    (value: ReturnType<typeof review>) => {
      value.artifacts[0]!.steps[0]!.resolvedTargets[0]!.sourceLink.href =
        "/people/other";
    },
    (value: ReturnType<typeof review>) => {
      value.artifacts[0]!.steps.push(value.artifacts[0]!.steps[0]!);
    },
  ]) {
    const value = review();
    alter(value);
    assert.equal(staffingPreparationReviewMatches(value, args), false);
  }
  assert.equal(
    staffingPreparationReviewMatches(review(), {
      ...args,
      notificationIntents: [],
      disclosure: { ...args.disclosure, title: "Different frozen change" },
    }),
    false
  );
});
test("unknown or unshown plans cannot receive facts from model-provided labels", async () => {
  for (const caseId of staffingPreparationFixtureIds) {
    let queries = 0;
    const observe = (presented: ReadonlySet<string>) =>
      readPreparedStaffingFacts({
        manifest: createFixtureManifest(caseId, 1),
        store: {
          query: () => {
            queries++;
            return [];
          },
        },
        calls: [call],
        presented,
      });
    assert.deepEqual(await observe(new Set()), { facts: {}, evidence: [] });
    assert.equal(queries, 0);
    assert.deepEqual(await observe(new Set([call.id])), {
      facts: {},
      evidence: [],
    });
    assert.equal(queries, 1);
  }
});

test("canonical plan evidence cannot hide unrelated mutations or notification work", () => {
  const target = { plantId: id, personId: id, targetId: id };
  const scoped: TeamsEffectArguments = {
    ...args,
    mutations: [
      {
        table: "training_completions",
        id,
        mode: "insert",
        before: null,
        after: { id, church_id: id, person_id: id, training_program_id: id },
      },
    ],
  };
  assert.equal(staffingPreparationChangesStayScoped(scoped, target), true);
  const different = "22222222-2222-4222-8222-222222222222";
  for (const field of ["church_id", "person_id", "training_program_id"])
    assert.equal(
      staffingPreparationChangesStayScoped(
        {
          ...scoped,
          mutations: scoped.mutations.map((row) => ({
            ...row,
            after: { ...row.after, [field]: different },
          })),
        },
        target
      ),
      false
    );
  assert.equal(
    staffingPreparationChangesStayScoped(
      {
        ...scoped,
        mutations: [
          ...scoped.mutations,
          {
            table: "persons",
            id: different,
            mode: "insert",
            before: null,
            after: { id: different, church_id: id },
          },
        ],
      },
      target
    ),
    false
  );
});
