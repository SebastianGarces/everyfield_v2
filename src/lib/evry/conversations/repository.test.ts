import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPOSITORY = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "repository.ts"
);
const SCHEMA = path.join(process.cwd(), "src/db/schema/evry.ts");

function source(pathname: string): string {
  return readFileSync(pathname, "utf8");
}

test("conversation reads scope every row to the exact actor and plant", () => {
  const repository = source(REPOSITORY);
  const read = repository.slice(
    repository.indexOf("async function findEvryConversationRecordAttempt"),
    repository.indexOf("export async function createEvryConversationRecord")
  );

  for (const table of [
    "evryConversations",
    "evryConversationMessages",
    "evryConversationArtifacts",
  ]) {
    assert.match(read, new RegExp(`eq\\(${table}\\.actorUserId`), table);
    assert.match(read, new RegExp(`eq\\(${table}\\.churchId`), table);
  }
  assert.match(read, /parseStoredEvryConversationState/);
  assert.match(read, /parseStoredEvryConversationArtifact/);
  assert.match(read, /hydrateStoredEvryConversationArtifact/);
  assert.match(
    read,
    /findEvryConversationRecordAttempt\(input, attempt \+ 1\)/
  );
  assert.match(read, /row\.state\.version !== messages\.length - 1/);
  assert.match(read, /sourceMessageIds\.some/);
  assert.equal(
    read.indexOf("const artifactRows") > read.indexOf("const messageRows"),
    true
  );
  assert.match(
    repository,
    /bodyFingerprint\(input\.body\) !== input\.bodyFingerprint/
  );
});

test("append atomically orders state CAS, activity, message, and artifacts", () => {
  const repository = source(REPOSITORY);
  const append = repository.slice(
    repository.indexOf("export async function appendEvryConversationRecord")
  );
  const state = append.indexOf("with state_updated as");
  const activity = append.indexOf("conversation_updated as");
  const message = append.indexOf("message_inserted as");
  const artifacts = append.indexOf("artifacts_inserted as");

  assert.equal(state >= 0, true);
  assert.equal(activity > state, true);
  assert.equal(message > activity, true);
  assert.equal(artifacts > message, true);
  assert.match(append, /and version = \$\{expectedStateVersion\}/);
  assert.match(
    append,
    /set next_message_sequence = c\.next_message_sequence \+ 1/
  );
  assert.match(append, /last_activity_at = greatest/);
  assert.doesNotMatch(append, /on conflict[\s\S]*do nothing/);
  assert.match(append, /isUniqueViolation\(error, MESSAGE_REQUEST_UNIQUE\)/);
  assert.match(append, /jsonb_to_recordset/);
  assert.match(append, /parseEvryConversationArtifactDocument/);
  assert.match(
    append,
    /evryConversationMessageIdSchema\.parse\(input\.messageId\)/
  );
  assert.doesNotMatch(append, /db\.transaction/);
});

test("message idempotency binds exact body bytes to an actor-scoped request key", () => {
  const repository = source(REPOSITORY);
  assert.match(
    repository,
    /createHash\("sha256"\)\.update\(body, "utf8"\)\.digest\("hex"\)/
  );
  const idempotencyRead = repository.slice(
    repository.indexOf("async function findMessageByRequestKey"),
    repository.indexOf("export async function appendEvryConversationRecord")
  );
  for (const field of ["actorUserId", "plantId", "requestKey"]) {
    assert.match(idempotencyRead, new RegExp(`input\\.${field}`), field);
  }
  assert.match(
    repository,
    /existing\.conversationId !== input\.conversationId/
  );
  assert.match(repository, /existing\.bodyFingerprint !== fingerprint/);
  assert.match(repository, /EvryConversationIdempotencyError/);
});

test("database constraints carry exact tenant identity through the aggregate", () => {
  const schema = source(SCHEMA);
  const conversations = schema.slice(
    schema.indexOf("export const evryConversations"),
    schema.indexOf("export type EvryActionPlan")
  );

  assert.match(
    conversations,
    /name: "evry_conversations_active_plan_fk"[\s\S]*table\.activePlanId[\s\S]*table\.churchId[\s\S]*table\.actorUserId[\s\S]*table\.activePlanFingerprint[\s\S]*evryActionPlans\.id[\s\S]*evryActionPlans\.churchId[\s\S]*evryActionPlans\.actorUserId[\s\S]*evryActionPlans\.fingerprint/
  );
  assert.match(
    conversations,
    /name: "evry_conversation_messages_conversation_fk"[\s\S]*table\.conversationId[\s\S]*table\.churchId[\s\S]*table\.actorUserId/
  );
  assert.match(
    conversations,
    /name: "evry_conversation_artifacts_message_fk"[\s\S]*table\.messageId[\s\S]*table\.conversationId[\s\S]*table\.churchId[\s\S]*table\.actorUserId/
  );
  assert.match(
    conversations,
    /uniqueIndex\("evry_conversation_messages_request_unique_idx"\)/
  );
});
