import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { z } from "zod";
import { PEOPLE_MODEL_PREPARATIONS } from "./people";
import {
  applyPeopleCoreFields,
  PEOPLE_CORE_IDENTITIES,
  PEOPLE_CORE_PLAN_REGISTRY,
  PEOPLE_CORE_REVIEW_REGISTRY,
  selectPeopleCoreRequest,
} from "../people/core";
import {
  applyHouseholdValues,
  HOUSEHOLD_IDENTITIES,
  HOUSEHOLD_PLAN_REGISTRY,
  HOUSEHOLD_REVIEW_REGISTRY,
  selectHouseholdRequest,
} from "../people/households";
import {
  parseEvryActionPlanCandidate,
  type EvryPlanCapabilityRegistry,
} from "@/lib/evry/plans";
import {
  trustedReviewForEvryPlanDocument,
  type EvryArtifactReviewRegistry,
} from "@/lib/evry/artifacts/trusted-plan-review";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import type { EvryPersonPayload } from "@/lib/people/evry-core";

const personId = "20000000-0000-4000-8000-000000000001";
const basePerson: EvryPersonPayload = {
  firstName: "Ada",
  lastName: "Lovelace",
  email: null,
  phone: null,
  addressLine1: "Old address",
  addressLine2: null,
  city: null,
  state: null,
  postalCode: null,
  country: "US",
  status: "prospect",
  backgroundCheckStatus: "not_started",
  source: null,
  sourceDetails: "Old source detail",
  notes: "Old note",
  householdId: null,
  householdRole: null,
};
function proposedReview(
  registry: EvryPlanCapabilityRegistry,
  reviewRegistry: EvryArtifactReviewRegistry,
  identity: string,
  argumentsValue: Record<string, unknown>
) {
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: "change",
          capabilityIdentity: identity,
          arguments: argumentsValue,
          dependsOn: [],
        },
      ],
    },
    registry,
    eligibleCapabilities: [{ identity }],
  });
  const review = trustedReviewForEvryPlanDocument({
    document,
    reviewRegistry,
    plan: evryConversationPlanIdentitySchema.parse({
      planId: personId,
      fingerprint: "a".repeat(64),
    }),
  });
  assert.ok(
    review,
    `Missing review for ${identity}: ${JSON.stringify(argumentsValue)}`
  );
  return review.confirmation.steps[0]!;
}
function operation(id: string) {
  const entry = PEOPLE_MODEL_PREPARATIONS.find((item) => item.id === id);
  assert.ok(entry, `${id} is registered`);
  return entry;
}
test("People operations expose serializable intent schemas, not frozen execution snapshots", () => {
  assert.equal(
    new Set(PEOPLE_MODEL_PREPARATIONS.map((entry) => entry.id)).size,
    PEOPLE_MODEL_PREPARATIONS.length
  );
  assert.equal(PEOPLE_MODEL_PREPARATIONS.length, 28);
  for (const entry of PEOPLE_MODEL_PREPARATIONS) {
    const schema = JSON.stringify(z.toJSONSchema(entry.inputSchema));
    assert.doesNotMatch(
      schema,
      /expectedFirstName|baselineJson|afterJson|fingerprint|notificationTargets|actorUserId|plantId|rowsJson|attachmentDigest/
    );
    assert.equal(entry.capabilityIdentities.length, 1);
    assert.throws(
      () =>
        Reflect.apply(entry.run, null, [
          null,
          { actorUserId: personId, planId: personId, fingerprint: "forged" },
        ]),
      z.ZodError
    );
  }
});
test("typed updates can clear a supplied field but cannot change unrelated status or snapshots", () => {
  const schema = operation("people.update").inputSchema;
  assert.equal(
    schema.safeParse({ personId, changes: { email: null, phone: "555-0100" } })
      .success,
    true
  );
  assert.equal(schema.safeParse({ personId, changes: {} }).success, false);
  assert.equal(
    schema.safeParse({ personId, changes: { status: "leader" } }).success,
    false
  );
  assert.equal(
    schema.safeParse({ personId, changes: { notes: "Note" }, before: {} })
      .success,
    false
  );
});

test("typed create and update retain literal text and null distinctly through trusted confirmation", () => {
  for (const kind of ["create", "update"] as const) {
    for (const value of [
      "-",
      null,
      "",
      "  -\n",
      "A; notes=not-a-command",
      "é😀",
    ]) {
      const changes = { notes: value, address1: value, sourceDetails: value };
      const parsed = operation(`people.${kind}`).inputSchema.parse(
        kind === "create"
          ? { first: "Ada", last: "Lovelace", ...changes }
          : { personId, changes }
      );
      const fields =
        kind === "create"
          ? z.record(z.string(), z.string().nullable()).parse(parsed)
          : z
              .object({ changes: z.record(z.string(), z.string().nullable()) })
              .parse(parsed).changes;
      const after = applyPeopleCoreFields(
        basePerson,
        fields,
        kind === "create"
      );
      assert.ok(after);
      assert.equal(after.notes, value);
      assert.equal(after.addressLine1, value);
      assert.equal(after.sourceDetails, value);
      const review = proposedReview(
        PEOPLE_CORE_PLAN_REGISTRY,
        PEOPLE_CORE_REVIEW_REGISTRY,
        PEOPLE_CORE_IDENTITIES[kind],
        kind === "create"
          ? {
              personId,
              personJson: JSON.stringify(after),
              activitySource: "form",
              expectedHouseholdName: null,
            }
          : {
              personId,
              personLabel: "Ada Lovelace",
              baselineJson: JSON.stringify(basePerson),
              afterJson: JSON.stringify(after),
            }
      );
      const displayed =
        value === null ? "Not set" : value === "" ? "Empty text" : value;
      assert.equal(
        review.beforeAfter.find((change) => change.label === "Address line 1")
          ?.after,
        displayed
      );
      assert.equal(
        review.beforeAfter.find((change) => change.label === "Source details")
          ?.after,
        displayed
      );
      const notePages = review.contentPreviews.filter((page) =>
        page.label.startsWith("Notes after · page ")
      );
      assert.equal(notePages.map((page) => page.content).join(""), value ?? "");
      if (value === null) assert.equal(notePages.length, 0);
    }
  }
});

test("household typed updates preserve null, empty text, and literal dash through confirmation", () => {
  const before = {
    name: "Lovelace",
    addressLine1: "Old address",
    addressLine2: null,
    city: null,
    state: null,
    postalCode: null,
    country: null,
  };
  for (const value of ["-", null, "", "  -\n"]) {
    const parsed = operation("people.update_household").inputSchema.parse({
      householdId: personId,
      changes: { address1: value },
    });
    const fields = z
      .object({ changes: z.record(z.string(), z.string().nullable()) })
      .parse(parsed).changes;
    const after = applyHouseholdValues(before, fields);
    assert.ok(after);
    assert.equal(after.addressLine1, value);
    const review = proposedReview(
      HOUSEHOLD_PLAN_REGISTRY,
      HOUSEHOLD_REVIEW_REGISTRY,
      HOUSEHOLD_IDENTITIES.update,
      {
        householdId: personId,
        beforeJson: JSON.stringify(before),
        afterJson: JSON.stringify(after),
      }
    );
    assert.equal(
      review.beforeAfter.find((change) => change.label === "Address")?.after,
      value || "No address"
    );
  }
});

test("legacy clearing syntax is decoded only by text parsers and omitted typed fields stay unchanged", () => {
  const legacy = selectPeopleCoreRequest(
    "Update person: notes=-; address1=-; sourceDetails=-"
  );
  assert.ok(legacy?.kind === "update");
  assert.deepEqual(legacy.values, {
    notes: null,
    address1: null,
    sourceDetails: null,
  });
  assert.equal(
    applyPeopleCoreFields(basePerson, legacy.values, false)?.notes,
    null
  );
  assert.deepEqual(
    applyPeopleCoreFields(basePerson, { notes: undefined }, false),
    basePerson
  );
  const household = selectHouseholdRequest(
    `Update household ${personId}: address1=; address2=-`
  );
  assert.ok(household?.kind === "update");
  assert.deepEqual(household.values, { address1: null, address2: "-" });
});
test("milestone preparations require recorded findings rather than model-invented defaults", () => {
  assert.equal(
    operation("people.record_interview").inputSchema.safeParse({
      personId,
      date: "2026-09-10",
    }).success,
    false
  );
  assert.equal(
    operation("people.record_assessment").inputSchema.safeParse({
      personId,
      date: "2026-09-10",
      committed: 5,
      compelled: 5,
      contagious: 6,
      courageous: 5,
    }).success,
    false
  );
  const commitment = operation(
    "people.record_commitment"
  ).inputSchema.safeParse({
    personId,
    date: "2026-09-10",
    type: "launch_team",
  });
  assert.equal(commitment.success, true);
  assert.equal(
    operation("people.record_commitment").inputSchema.safeParse({
      personId,
      date: "2026-02-30",
      type: "launch_team",
    }).success,
    false
  );
});
test("import preparation takes only an opaque upload reference and explicit bounded duplicate choices", () => {
  const schema = operation("people.import_file").inputSchema;
  assert.equal(
    schema.safeParse({
      reference: "server-reference",
      duplicateResolutions: [{ rowNumber: 2, resolution: "skip" }],
    }).success,
    true
  );
  assert.equal(
    schema.safeParse({ reference: "server-reference", rowsJson: "[]" }).success,
    false
  );
  assert.equal(
    schema.safeParse({
      reference: "server-reference",
      duplicateResolutions: [
        { rowNumber: 2, resolution: "merge" },
        { rowNumber: 2, resolution: "skip" },
      ],
    }).success,
    false
  );
  assert.equal(
    schema.safeParse({ reference: "x".repeat(4097) }).success,
    false
  );
});
test("pipeline order is bounded and cannot repeat one person", () => {
  const schema = operation("people.reorder_pipeline").inputSchema;
  assert.equal(schema.safeParse({ personIds: [personId] }).success, true);
  assert.equal(
    schema.safeParse({ personIds: [personId, personId] }).success,
    false
  );
  assert.equal(
    schema.safeParse({ personIds: Array(33).fill(personId) }).success,
    false
  );
});
test("recovery and integrity checks precede mutable context resolution and trusted proposal", () => {
  const source = readFileSync(new URL("./people.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("async run(input, args)"));
  assert.ok(
    body.indexOf("findEvryActionPlanByRequestKey") <
      body.indexOf("resolveAuthorizedEvryPageContext")
  );
  assert.ok(
    body.indexOf("validateStoredEvryActionPlan") <
      body.indexOf("resolveAuthorizedEvryPageContext")
  );
  assert.ok(
    body.indexOf("resolveAuthorizedEvryPageContext") <
      body.indexOf("config.propose")
  );
  assert.doesNotMatch(
    source,
    /selectPeople|selectMilestone|selectHousehold|selectTaxonomy|literalUserText\.match|literalUserText\.replace/
  );
  assert.doesNotMatch(source, /claimEvry|executeEvry|confirmEvryActionPlan/);
});
