import { createHash, randomUUID } from "node:crypto";

import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { isUniqueViolation } from "@/db/errors";
import {
  evryConversationArtifacts,
  evryConversationMessages,
  evryConversations,
  evryConversationStates,
  type EvryConversationArtifactKind,
  type EvryConversationAuthor,
  type EvryConversationDeliveryStatus,
} from "@/db/schema";
import {
  evryPageContextSchema,
  type EvryPageContext,
} from "@/lib/evry/resolvers/contract";

import {
  hydrateStoredEvryConversationArtifact,
  parseEvryConversationArtifactDocument,
  parseStoredEvryConversationArtifact,
  type EvryHydratedConversationArtifact,
  type StoredEvryConversationArtifactDocument,
} from "./artifacts";
import {
  EVRY_CONVERSATION_MAX_MESSAGE_CHARACTERS,
  EvryConversationStorageError,
  evryConversationIdSchema,
  evryConversationMessageIdempotencyContextSchema,
  evryConversationMessageIdSchema,
  evryConversationPlanIdentitySchema,
  evryConversationRelevanceKeysSchema,
  evryConversationRequestKeySchema,
  initialEvryConversationState,
  parseStoredEvryConversationState,
  type EvryConversationId,
  type EvryConversationMessageId,
  type EvryConversationMessageIdempotencyContext,
  type EvryConversationPlanIdentity,
  type EvryConversationRelevanceKey,
  type EvryConversationRequestKey,
  type EvryConversationStateDocument,
} from "./contract";

const bodySchema = z.string().max(EVRY_CONVERSATION_MAX_MESSAGE_CHARACTERS);
const authorSchema = z.enum(["user", "assistant"]);
const deliverySchema = z.enum(["complete", "interrupted"]);
const expectedStateVersionSchema = z.number().int().nonnegative();
const MAX_ARTIFACTS_PER_MESSAGE = 16;
const MESSAGE_REQUEST_UNIQUE = "evry_conversation_messages_request_unique_idx";

type ActivePlanMutation =
  | Readonly<{ mode: "preserve" }>
  | Readonly<{ mode: "clear" }>
  | Readonly<{ mode: "set"; plan: EvryConversationPlanIdentity }>;

export type EvryStoredConversationArtifact = Readonly<{
  id: string;
  ordinal: number;
  kind: EvryConversationArtifactKind;
  document: StoredEvryConversationArtifactDocument;
  artifact: EvryHydratedConversationArtifact;
}>;

export type EvryStoredConversationMessage = Readonly<{
  id: EvryConversationMessageId;
  requestKey: EvryConversationRequestKey;
  sequence: number;
  author: EvryConversationAuthor;
  body: string;
  pageContext: EvryPageContext | null;
  relevanceKeys: readonly EvryConversationRelevanceKey[];
  deliveryStatus: EvryConversationDeliveryStatus;
  createdAt: Date;
  artifacts: readonly EvryStoredConversationArtifact[];
}>;

export type EvryStoredConversation = Readonly<{
  id: EvryConversationId;
  actorUserId: string;
  plantId: string;
  title: string;
  createdAt: Date;
  lastActivityAt: Date;
  activePlan: EvryConversationPlanIdentity | null;
  stateVersion: number;
  state: EvryConversationStateDocument;
  messages: readonly EvryStoredConversationMessage[];
}>;

export class EvryConversationStateConflictError extends Error {
  constructor() {
    super("Evry conversation state changed before this message was stored");
    this.name = "EvryConversationStateConflictError";
  }
}

export class EvryConversationIdempotencyError extends Error {
  constructor() {
    super("Evry conversation request key was already used for other text");
    this.name = "EvryConversationIdempotencyError";
  }
}

function bodyFingerprint(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

function requestFingerprint(input: {
  author: EvryConversationAuthor;
  body: string;
  pageContext: EvryPageContext | null;
  relevanceKeys: readonly EvryConversationRelevanceKey[];
  deliveryStatus: EvryConversationDeliveryStatus;
  artifacts: readonly StoredEvryConversationArtifactDocument[];
  idempotencyContext: EvryConversationMessageIdempotencyContext;
  state: EvryConversationStateDocument;
  activePlan: ActivePlanMutation;
}): string {
  return createHash("sha256")
    .update(JSON.stringify(input), "utf8")
    .digest("hex");
}

function automaticTitle(body: string): string {
  const collapsed = body.trim().replace(/\s+/g, " ");
  const title = [...collapsed].slice(0, 80).join("");
  if (title.length === 0) throw new Error("An Evry conversation needs text");
  return title;
}

function parsePageContext(input: unknown): EvryPageContext | null {
  if (input === null) return null;
  const parsed = evryPageContextSchema.safeParse(input);
  if (!parsed.success) throw new EvryConversationStorageError();
  return parsed.data;
}

function parseActivePlan(input: {
  planId: string | null;
  fingerprint: string | null;
}): EvryConversationPlanIdentity | null {
  if (input.planId === null && input.fingerprint === null) return null;
  const parsed = evryConversationPlanIdentitySchema.safeParse(input);
  if (!parsed.success) throw new EvryConversationStorageError();
  return parsed.data;
}

function parseMessageRow(input: {
  id: string;
  requestKey: string;
  sequence: number;
  author: string;
  body: string;
  bodyFingerprint: string;
  pageContext: unknown;
  relevanceKeys: unknown;
  deliveryStatus: string;
  createdAt: Date;
  artifacts: readonly EvryStoredConversationArtifact[];
}): EvryStoredConversationMessage {
  const id = evryConversationMessageIdSchema.safeParse(input.id);
  const requestKey = evryConversationRequestKeySchema.safeParse(
    input.requestKey
  );
  const author = authorSchema.safeParse(input.author);
  const body = bodySchema.safeParse(input.body);
  const delivery = deliverySchema.safeParse(input.deliveryStatus);
  const relevanceKeys = evryConversationRelevanceKeysSchema.safeParse(
    input.relevanceKeys
  );
  if (
    !id.success ||
    !requestKey.success ||
    !author.success ||
    !body.success ||
    !delivery.success ||
    !relevanceKeys.success ||
    !Number.isSafeInteger(input.sequence) ||
    input.sequence < 0 ||
    !(input.createdAt instanceof Date) ||
    Number.isNaN(input.createdAt.valueOf()) ||
    bodyFingerprint(input.body) !== input.bodyFingerprint
  ) {
    throw new EvryConversationStorageError();
  }

  return Object.freeze({
    id: id.data,
    requestKey: requestKey.data,
    sequence: input.sequence,
    author: author.data,
    body: body.data,
    pageContext: parsePageContext(input.pageContext),
    relevanceKeys: relevanceKeys.data,
    deliveryStatus: delivery.data,
    createdAt: input.createdAt,
    artifacts: Object.freeze([...input.artifacts]),
  });
}

async function findEvryConversationRecordAttempt(
  input: {
    conversationId: string;
    actorUserId: string;
    plantId: string;
  },
  attempt: number
): Promise<EvryStoredConversation | null> {
  const conversationId = evryConversationIdSchema.safeParse(
    input.conversationId
  );
  if (!conversationId.success) return null;

  const [row] = await db
    .select({ conversation: evryConversations, state: evryConversationStates })
    .from(evryConversations)
    .innerJoin(
      evryConversationStates,
      and(
        eq(evryConversationStates.conversationId, evryConversations.id),
        eq(evryConversationStates.churchId, evryConversations.churchId),
        eq(evryConversationStates.actorUserId, evryConversations.actorUserId)
      )
    )
    .where(
      and(
        eq(evryConversations.id, conversationId.data),
        eq(evryConversations.actorUserId, input.actorUserId),
        eq(evryConversations.churchId, input.plantId)
      )
    )
    .limit(1);
  if (!row) return null;

  const messageRows = await db
    .select()
    .from(evryConversationMessages)
    .where(
      and(
        eq(evryConversationMessages.conversationId, conversationId.data),
        eq(evryConversationMessages.actorUserId, input.actorUserId),
        eq(evryConversationMessages.churchId, input.plantId)
      )
    )
    .orderBy(asc(evryConversationMessages.sequence));
  // Keep this after the message read: under READ COMMITTED, an artifact read
  // that starts first can otherwise miss artifacts for a just-committed message.
  const artifactRows = await db
    .select()
    .from(evryConversationArtifacts)
    .where(
      and(
        eq(evryConversationArtifacts.conversationId, conversationId.data),
        eq(evryConversationArtifacts.actorUserId, input.actorUserId),
        eq(evryConversationArtifacts.churchId, input.plantId)
      )
    )
    .orderBy(
      asc(evryConversationArtifacts.messageId),
      asc(evryConversationArtifacts.ordinal)
    );

  const artifactsByMessage = new Map<
    string,
    EvryStoredConversationArtifact[]
  >();
  for (const artifactRow of artifactRows) {
    const document = parseStoredEvryConversationArtifact({
      kind: artifactRow.kind,
      document: artifactRow.document,
    });
    const artifact: EvryStoredConversationArtifact = Object.freeze({
      id: artifactRow.id,
      ordinal: artifactRow.ordinal,
      kind: document.kind,
      document,
      artifact: hydrateStoredEvryConversationArtifact(document),
    });
    const messageArtifacts = artifactsByMessage.get(artifactRow.messageId);
    if (messageArtifacts) messageArtifacts.push(artifact);
    else artifactsByMessage.set(artifactRow.messageId, [artifact]);
  }

  const messages = messageRows.map((message, index) => {
    if (message.sequence !== index) throw new EvryConversationStorageError();
    return parseMessageRow({
      ...message,
      artifacts: artifactsByMessage.get(message.id) ?? [],
    });
  });
  if (row.conversation.nextMessageSequence !== messages.length) {
    if (attempt < 2) {
      return findEvryConversationRecordAttempt(input, attempt + 1);
    }
    throw new EvryConversationStorageError();
  }
  if (
    !Number.isSafeInteger(row.state.version) ||
    row.state.version < 0 ||
    !(row.conversation.createdAt instanceof Date) ||
    !(row.conversation.lastActivityAt instanceof Date)
  ) {
    throw new EvryConversationStorageError();
  }
  const state = parseStoredEvryConversationState(row.state.document);
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const artifactById = new Map(
    messages.flatMap((message) =>
      message.artifacts.map((artifact) => [
        artifact.id,
        Object.freeze({ artifact, message }),
      ])
    )
  );
  const choicesAreBound = state.explicitChoices.every((choice) => {
    const choiceMessage = messageById.get(choice.sourceMessageId);
    const clarification = artifactById.get(choice.clarificationArtifactId);
    if (
      !choiceMessage ||
      choiceMessage.author !== "user" ||
      !clarification ||
      clarification.message.sequence >= choiceMessage.sequence ||
      clarification.artifact.document.kind !== "clarification" ||
      clarification.artifact.document.mode !== "choice" ||
      choice.selectedAt < choiceMessage.createdAt.toISOString() ||
      clarification.artifact.document.choices.length !==
        choice.offeredReferences.length
    ) {
      return false;
    }

    return clarification.artifact.document.choices.every((offered, index) => {
      const reference = choice.offeredReferences[index];
      return (
        reference !== undefined &&
        offered.entityType === reference.entityType &&
        offered.id === reference.entityId
      );
    });
  });
  const messageIds = new Set(messageById.keys());
  const sourceMessageIds = [
    ...state.resolvedReferences.map(({ sourceMessageId }) => sourceMessageId),
    ...state.explicitChoices.map(({ sourceMessageId }) => sourceMessageId),
    ...(state.pendingClarification
      ? [state.pendingClarification.sourceMessageId]
      : []),
  ];
  if (
    row.state.version !== messages.length - 1 ||
    !choicesAreBound ||
    sourceMessageIds.some((messageId) => !messageIds.has(messageId)) ||
    (state.summary !== null && state.summary.throughSequence >= messages.length)
  ) {
    throw new EvryConversationStorageError();
  }

  return Object.freeze({
    id: conversationId.data,
    actorUserId: row.conversation.actorUserId,
    plantId: row.conversation.churchId,
    title: row.conversation.title,
    createdAt: row.conversation.createdAt,
    lastActivityAt: row.conversation.lastActivityAt,
    activePlan: parseActivePlan({
      planId: row.conversation.activePlanId,
      fingerprint: row.conversation.activePlanFingerprint,
    }),
    stateVersion: row.state.version,
    state,
    messages: Object.freeze(messages),
  });
}

/** Reload a stable aggregate snapshot, retrying across a concurrent append. */
export async function findEvryConversationRecord(input: {
  conversationId: string;
  actorUserId: string;
  plantId: string;
}): Promise<EvryStoredConversation | null> {
  return findEvryConversationRecordAttempt(input, 0);
}

export async function createEvryConversationRecord(input: {
  actorUserId: string;
  plantId: string;
  requestKey: EvryConversationRequestKey;
  body: string;
  pageContext: EvryPageContext | null;
  createdAt: Date;
}): Promise<EvryStoredConversation> {
  const body = bodySchema.parse(input.body);
  const pageContext = evryPageContextSchema.nullable().parse(input.pageContext);
  const state = initialEvryConversationState();
  const semanticFingerprint = requestFingerprint({
    author: "user",
    body,
    pageContext,
    relevanceKeys: [],
    deliveryStatus: "complete",
    artifacts: [],
    idempotencyContext: { status: "none" },
    state,
    activePlan: { mode: "preserve" },
  });
  const conversationId = evryConversationIdSchema.parse(randomUUID());
  const messageId = evryConversationMessageIdSchema.parse(randomUUID());

  try {
    await db.batch([
      db.insert(evryConversations).values({
        id: conversationId,
        churchId: input.plantId,
        actorUserId: input.actorUserId,
        title: automaticTitle(body),
        nextMessageSequence: 1,
        createdAt: input.createdAt,
        lastActivityAt: input.createdAt,
      }),
      db.insert(evryConversationStates).values({
        conversationId,
        churchId: input.plantId,
        actorUserId: input.actorUserId,
        version: 0,
        document: state,
        changedAt: input.createdAt,
      }),
      db.insert(evryConversationMessages).values({
        id: messageId,
        conversationId,
        churchId: input.plantId,
        actorUserId: input.actorUserId,
        requestKey: input.requestKey,
        bodyFingerprint: bodyFingerprint(body),
        requestFingerprint: semanticFingerprint,
        sequence: 0,
        author: "user",
        body,
        pageContext,
        relevanceKeys: [],
        deliveryStatus: "complete",
        createdAt: input.createdAt,
      }),
    ]);
  } catch (error) {
    if (!isUniqueViolation(error, MESSAGE_REQUEST_UNIQUE)) throw error;
    const existing = await findMessageByRequestKey({
      actorUserId: input.actorUserId,
      plantId: input.plantId,
      requestKey: input.requestKey,
    });
    if (
      !existing ||
      existing.bodyFingerprint !== bodyFingerprint(body) ||
      existing.requestFingerprint !== semanticFingerprint
    ) {
      throw new EvryConversationIdempotencyError();
    }
    const replay = await findEvryConversationRecord({
      conversationId: existing.conversationId,
      actorUserId: input.actorUserId,
      plantId: input.plantId,
    });
    if (!replay) throw new EvryConversationStorageError();
    return replay;
  }

  const created = await findEvryConversationRecord({
    conversationId,
    actorUserId: input.actorUserId,
    plantId: input.plantId,
  });
  if (!created) throw new EvryConversationStorageError();
  return created;
}

interface AppendedMessageRow extends Record<string, unknown> {
  id: string;
}

async function findMessageByRequestKey(input: {
  actorUserId: string;
  plantId: string;
  requestKey: EvryConversationRequestKey;
}): Promise<Readonly<{
  id: string;
  conversationId: string;
  bodyFingerprint: string;
  requestFingerprint: string;
}> | null> {
  const [message] = await db
    .select({
      id: evryConversationMessages.id,
      conversationId: evryConversationMessages.conversationId,
      bodyFingerprint: evryConversationMessages.bodyFingerprint,
      requestFingerprint: evryConversationMessages.requestFingerprint,
    })
    .from(evryConversationMessages)
    .where(
      and(
        eq(evryConversationMessages.actorUserId, input.actorUserId),
        eq(evryConversationMessages.churchId, input.plantId),
        eq(evryConversationMessages.requestKey, input.requestKey)
      )
    )
    .limit(1);
  return message ?? null;
}

export async function appendEvryConversationRecord(input: {
  messageId: EvryConversationMessageId;
  conversationId: EvryConversationId;
  actorUserId: string;
  plantId: string;
  requestKey: EvryConversationRequestKey;
  expectedStateVersion: number;
  state: EvryConversationStateDocument;
  author: EvryConversationAuthor;
  body: string;
  pageContext: EvryPageContext | null;
  relevanceKeys: readonly EvryConversationRelevanceKey[];
  deliveryStatus: EvryConversationDeliveryStatus;
  artifacts: readonly StoredEvryConversationArtifactDocument[];
  idempotencyContext: EvryConversationMessageIdempotencyContext;
  activePlan?: ActivePlanMutation;
  createdAt: Date;
}): Promise<EvryStoredConversation> {
  const body = bodySchema.parse(input.body);
  const fingerprint = bodyFingerprint(body);
  const activePlan = input.activePlan ?? { mode: "preserve" };
  const normalizedActivePlan: ActivePlanMutation =
    activePlan.mode === "set"
      ? {
          mode: "set",
          plan: evryConversationPlanIdentitySchema.parse(activePlan.plan),
        }
      : activePlan;
  const parsedActivePlan =
    normalizedActivePlan.mode === "set" ? normalizedActivePlan.plan : null;
  const expectedStateVersion = expectedStateVersionSchema.parse(
    input.expectedStateVersion
  );
  const parsedState = parseStoredEvryConversationState(input.state);
  const author = authorSchema.parse(input.author);
  const pageContext = evryPageContextSchema.nullable().parse(input.pageContext);
  const relevanceKeys = evryConversationRelevanceKeysSchema.parse(
    input.relevanceKeys
  );
  const deliveryStatus = deliverySchema.parse(input.deliveryStatus);
  const idempotencyContext =
    evryConversationMessageIdempotencyContextSchema.parse(
      input.idempotencyContext
    );
  const messageId = evryConversationMessageIdSchema.parse(input.messageId);
  const requestKey = evryConversationRequestKeySchema.parse(input.requestKey);
  if (input.artifacts.length > MAX_ARTIFACTS_PER_MESSAGE) {
    throw new EvryConversationStorageError();
  }
  const artifacts = input.artifacts.map((artifact, ordinal) => {
    const document = parseEvryConversationArtifactDocument(artifact);
    return {
      id: randomUUID(),
      ordinal,
      kind: document.kind,
      document,
    };
  });
  const semanticFingerprint = requestFingerprint({
    author,
    body,
    pageContext,
    relevanceKeys,
    deliveryStatus,
    artifacts: artifacts.map(({ document }) => document),
    idempotencyContext,
    state: parsedState,
    activePlan: normalizedActivePlan,
  });
  async function exactReplay(): Promise<EvryStoredConversation | null> {
    const existing = await findMessageByRequestKey({
      actorUserId: input.actorUserId,
      plantId: input.plantId,
      requestKey,
    });
    if (!existing) return null;
    if (
      existing.conversationId !== input.conversationId ||
      existing.bodyFingerprint !== fingerprint ||
      existing.requestFingerprint !== semanticFingerprint
    ) {
      throw new EvryConversationIdempotencyError();
    }
    const replay = await findEvryConversationRecord(input);
    if (!replay) throw new EvryConversationStorageError();
    return replay;
  }

  const existingReplay = await exactReplay();
  if (existingReplay) return existingReplay;

  const setPlan = activePlan.mode === "set" ? parsedActivePlan : null;
  let result: Awaited<ReturnType<typeof db.execute<AppendedMessageRow>>>;
  try {
    result = await db.execute<AppendedMessageRow>(sql`
      with state_updated as (
      update evry_conversation_states
      set document = ${JSON.stringify(parsedState)}::jsonb,
          version = version + 1,
          changed_at = ${input.createdAt}
      where conversation_id = ${input.conversationId}
        and church_id = ${input.plantId}
        and actor_user_id = ${input.actorUserId}
        and version = ${expectedStateVersion}
      returning conversation_id, church_id, actor_user_id
    ), conversation_updated as (
      update evry_conversations c
      set next_message_sequence = c.next_message_sequence + 1,
          last_activity_at = greatest(c.last_activity_at, ${input.createdAt}),
          active_plan_id = case
            when ${activePlan.mode} = 'preserve' then c.active_plan_id
            when ${activePlan.mode} = 'clear' then null
            else ${setPlan?.planId ?? null}::uuid
          end,
          active_plan_fingerprint = case
            when ${activePlan.mode} = 'preserve' then c.active_plan_fingerprint
            when ${activePlan.mode} = 'clear' then null
            else ${setPlan?.fingerprint ?? null}
          end
      from state_updated s
      where c.id = s.conversation_id
        and c.church_id = s.church_id
        and c.actor_user_id = s.actor_user_id
      returning c.next_message_sequence - 1 as sequence
    ), message_inserted as (
      insert into evry_conversation_messages (
        id, conversation_id, church_id, actor_user_id, request_key,
        body_fingerprint, request_fingerprint, sequence, author, body, page_context,
        relevance_keys, delivery_status, created_at
      )
      select
        ${messageId}::uuid, ${input.conversationId}::uuid, ${input.plantId}::uuid,
        ${input.actorUserId}::uuid, ${requestKey}::uuid, ${fingerprint},
        ${semanticFingerprint}, sequence,
        ${author}, ${body}, ${pageContext === null ? null : JSON.stringify(pageContext)}::jsonb,
        ${JSON.stringify(relevanceKeys)}::jsonb, ${deliveryStatus},
        ${input.createdAt}
      from conversation_updated
      returning id
    ), artifact_input as (
      select *
      from jsonb_to_recordset(${JSON.stringify(artifacts)}::jsonb)
        as artifact(id uuid, ordinal integer, kind varchar(32), document jsonb)
    ), artifacts_inserted as (
      insert into evry_conversation_artifacts (
        id, message_id, conversation_id, church_id, actor_user_id,
        ordinal, kind, document, created_at
      )
      select
        artifact.id, message_inserted.id, ${input.conversationId}::uuid,
        ${input.plantId}::uuid, ${input.actorUserId}::uuid,
        artifact.ordinal, artifact.kind, artifact.document, ${input.createdAt}
      from message_inserted
      cross join artifact_input artifact
      returning id
    )
    select id from message_inserted
    `);
  } catch (error) {
    if (!isUniqueViolation(error, MESSAGE_REQUEST_UNIQUE)) throw error;
    const replay = await exactReplay();
    if (!replay) throw new EvryConversationStorageError();
    return replay;
  }

  if (!result.rows[0]) {
    // A same-key contender can win the state CAS while this statement waits
    // on the row lock. Its request key becomes visible only to this fresh
    // statement, so recognize the exact replay before reporting stale state.
    const replay = await exactReplay();
    if (replay) return replay;
    throw new EvryConversationStateConflictError();
  }

  const appended = await findEvryConversationRecord(input);
  if (!appended) throw new EvryConversationStorageError();
  return appended;
}
