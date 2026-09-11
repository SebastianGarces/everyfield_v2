import assert from "node:assert/strict";
import { test } from "node:test";
import { CONTENT_MODEL_PREPARATIONS } from "./content";
import { createDocumentsWikiEffectConversationContinuation } from "../documents-wiki/effect-conversation";
import {
  evryConversationIdSchema,
  initialEvryConversationState,
} from "@/lib/evry/conversations/contract";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import type { EvryCapabilityConversationSelectionInput } from "../conversation";

const now = new Date("2026-09-10T12:00:00Z");
const actor = {
  userId: "10000000-0000-4000-8000-000000000001",
  plantId: "20000000-0000-4000-8000-000000000001",
  seat: "owner",
} as unknown as EvryPlantActor;
function selection(): EvryCapabilityConversationSelectionInput {
  return {
    actor,
    literalUserText: "Save that reading for me, please.",
    userRequestKey: "40000000-0000-4000-8000-000000000001",
    pageContext: null,
    requestPageContext: null,
    now,
    conversation: {
      id: evryConversationIdSchema.parse(
        "30000000-0000-4000-8000-000000000001"
      ),
      actorUserId: actor.userId,
      plantId: actor.plantId,
      title: "Reading",
      createdAt: now,
      lastActivityAt: now,
      activePlan: null,
      stateVersion: 0,
      state: initialEvryConversationState(),
      messages: [],
    },
  };
}
test("18 typed preparation contracts reject model-authored snapshots and forged scope", () => {
  assert.equal(CONTENT_MODEL_PREPARATIONS.length, 18);
  assert.equal(new Set(CONTENT_MODEL_PREPARATIONS.map((p) => p.id)).size, 18);
  for (const p of CONTENT_MODEL_PREPARATIONS)
    assert.equal(
      p.inputSchema.safeParse({
        plantId: actor.plantId,
        before: {},
        after: {},
        frozenRecipients: [],
      }).success,
      false
    );
  const bookmark = CONTENT_MODEL_PREPARATIONS.find(
    (p) => p.id === "wiki.bookmark"
  )!;
  assert.equal(
    bookmark.inputSchema.safeParse({
      slug: "discovery/calling",
      bookmarked: true,
    }).success,
    true
  );
  assert.equal(
    bookmark.inputSchema.safeParse({
      slug: "discovery/calling",
      bookmarked: true,
      sourceArticleId: actor.userId,
    }).success,
    false
  );
});
test("typed intent reaches existing proposer without a command phrase and after request-key recovery", async () => {
  const order: string[] = [];
  const continuation = createDocumentsWikiEffectConversationContinuation(
    {
      async findPlanByRequestKey() {
        order.push("recover");
        return null;
      },
      async propose(input) {
        order.push("propose");
        assert.deepEqual(input.selection, {
          kind: "bookmark",
          slug: "discovery/calling",
          bookmarked: true,
        });
        throw new Error("Provider-free proposer boundary reached");
      },
    },
    { kind: "bookmark", slug: "discovery/calling", bookmarked: true }
  );
  await assert.rejects(
    continuation.continue(selection()),
    /Provider-free proposer boundary reached/
  );
  assert.deepEqual(order, ["recover", "propose"]);
});
