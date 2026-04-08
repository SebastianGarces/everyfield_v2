import { and, asc, desc, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  assistantArtifacts,
  assistantMessages,
  assistantThreads,
  type AssistantArtifactKind,
  type AssistantArtifactStatus,
  type AssistantMessageRole,
} from "@/db/schema/assistant";
import type {
  AssistantArtifactRecord,
  AssistantMessageRecord,
  AssistantThreadDetail,
  AssistantThreadSummary,
} from "./types";

const DEFAULT_THREAD_TITLE = "New chat";

function toIsoString(value: Date) {
  return value.toISOString();
}

function serializeThread(
  thread: typeof assistantThreads.$inferSelect
): AssistantThreadSummary {
  return {
    id: thread.id,
    title: thread.title,
    status: thread.status,
    createdAt: toIsoString(thread.createdAt),
    updatedAt: toIsoString(thread.updatedAt),
    lastMessageAt: toIsoString(thread.lastMessageAt),
  };
}

function serializeMessage(
  message: typeof assistantMessages.$inferSelect
): AssistantMessageRecord {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    metadata: message.metadata,
    createdAt: toIsoString(message.createdAt),
  };
}

function serializeArtifact(
  artifact: typeof assistantArtifacts.$inferSelect
): AssistantArtifactRecord {
  return {
    id: artifact.id,
    kind: artifact.kind,
    status: artifact.status,
    payload: artifact.payload,
    createdAt: toIsoString(artifact.createdAt),
    updatedAt: toIsoString(artifact.updatedAt),
  };
}

async function getOwnedThreadRow(
  churchId: string,
  userId: string,
  threadId: string
) {
  const [thread] = await db
    .select()
    .from(assistantThreads)
    .where(
      and(
        eq(assistantThreads.id, threadId),
        eq(assistantThreads.churchId, churchId),
        eq(assistantThreads.userId, userId)
      )
    )
    .limit(1);

  return thread ?? null;
}

async function archiveActiveThreads(
  churchId: string,
  userId: string,
  options?: { excludeThreadId?: string }
) {
  const filters = [
    eq(assistantThreads.churchId, churchId),
    eq(assistantThreads.userId, userId),
    eq(assistantThreads.status, "active" as const),
  ];

  if (options?.excludeThreadId) {
    filters.push(ne(assistantThreads.id, options.excludeThreadId));
  }

  await db
    .update(assistantThreads)
    .set({
      status: "archived",
      updatedAt: new Date(),
    })
    .where(and(...filters));
}

export function deriveAssistantThreadTitle(content: string) {
  const normalized = content.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return DEFAULT_THREAD_TITLE;
  }

  return normalized.length <= 60
    ? normalized
    : `${normalized.slice(0, 57).trimEnd()}...`;
}

export function getPlaceholderAssistantReply() {
  return "I’m ready to help. Soon you’ll be able to schedule meetings, send invites, and manage follow-up from here.";
}

export async function listAssistantThreads(
  churchId: string,
  userId: string
): Promise<AssistantThreadSummary[]> {
  const threads = await db
    .select()
    .from(assistantThreads)
    .where(
      and(
        eq(assistantThreads.churchId, churchId),
        eq(assistantThreads.userId, userId),
        eq(assistantThreads.status, "active")
      )
    )
    .orderBy(
      desc(assistantThreads.lastMessageAt),
      desc(assistantThreads.createdAt)
    )
    .limit(30);

  return threads.map(serializeThread);
}

export async function createAssistantThread(
  churchId: string,
  userId: string,
  input?: { title?: string }
): Promise<AssistantThreadSummary> {
  const now = new Date();

  await archiveActiveThreads(churchId, userId);

  const [thread] = await db
    .insert(assistantThreads)
    .values({
      churchId,
      userId,
      title: input?.title?.trim() || DEFAULT_THREAD_TITLE,
      status: "active",
      createdAt: now,
      updatedAt: now,
      lastMessageAt: now,
    })
    .returning();

  return serializeThread(thread);
}

export async function getOrCreateLatestAssistantThread(
  churchId: string,
  userId: string
): Promise<AssistantThreadSummary> {
  const activeThreads = await db
    .select()
    .from(assistantThreads)
    .where(
      and(
        eq(assistantThreads.churchId, churchId),
        eq(assistantThreads.userId, userId),
        eq(assistantThreads.status, "active")
      )
    )
    .orderBy(
      desc(assistantThreads.lastMessageAt),
      desc(assistantThreads.createdAt)
    );

  const [latestThread] = activeThreads;

  if (latestThread) {
    if (activeThreads.length > 1) {
      await archiveActiveThreads(churchId, userId, {
        excludeThreadId: latestThread.id,
      });
    }

    return serializeThread(latestThread);
  }

  return createAssistantThread(churchId, userId);
}

export async function listAssistantHistory(
  churchId: string,
  userId: string
): Promise<AssistantThreadSummary[]> {
  const threads = await db
    .select()
    .from(assistantThreads)
    .where(
      and(
        eq(assistantThreads.churchId, churchId),
        eq(assistantThreads.userId, userId),
        eq(assistantThreads.status, "archived")
      )
    )
    .orderBy(
      desc(assistantThreads.updatedAt),
      desc(assistantThreads.lastMessageAt),
      desc(assistantThreads.createdAt)
    )
    .limit(30);

  return threads.map(serializeThread);
}

export async function listAssistantArtifacts(
  churchId: string,
  userId: string,
  threadId: string
): Promise<AssistantArtifactRecord[]> {
  const thread = await getOwnedThreadRow(churchId, userId, threadId);

  if (!thread) {
    throw new Error("Assistant thread not found");
  }

  const artifacts = await db
    .select()
    .from(assistantArtifacts)
    .where(
      and(
        eq(assistantArtifacts.threadId, threadId),
        eq(assistantArtifacts.churchId, churchId),
        ne(assistantArtifacts.status, "dismissed")
      )
    )
    .orderBy(
      desc(assistantArtifacts.status),
      desc(assistantArtifacts.updatedAt),
      asc(assistantArtifacts.createdAt)
    );

  return artifacts.map(serializeArtifact);
}

export async function getAssistantThread(
  churchId: string,
  userId: string,
  threadId: string
): Promise<AssistantThreadDetail | null> {
  const thread = await getOwnedThreadRow(churchId, userId, threadId);

  if (!thread) {
    return null;
  }

  const [messages, artifacts] = await Promise.all([
    db
      .select()
      .from(assistantMessages)
      .where(
        and(
          eq(assistantMessages.threadId, threadId),
          eq(assistantMessages.churchId, churchId)
        )
      )
      .orderBy(asc(assistantMessages.createdAt)),
    db
      .select()
      .from(assistantArtifacts)
      .where(
        and(
          eq(assistantArtifacts.threadId, threadId),
          eq(assistantArtifacts.churchId, churchId),
          ne(assistantArtifacts.status, "dismissed")
        )
      )
      .orderBy(
        desc(assistantArtifacts.updatedAt),
        asc(assistantArtifacts.createdAt)
      ),
  ]);

  return {
    thread: serializeThread(thread),
    messages: messages.map(serializeMessage),
    artifacts: artifacts.map(serializeArtifact),
  };
}

export async function appendAssistantMessage(params: {
  churchId: string;
  userId: string;
  threadId: string;
  role: AssistantMessageRole;
  content: string;
  metadata?: Record<string, unknown> | null;
}): Promise<AssistantMessageRecord> {
  const thread = await getOwnedThreadRow(
    params.churchId,
    params.userId,
    params.threadId
  );

  if (!thread) {
    throw new Error("Assistant thread not found");
  }

  if (thread.status !== "active") {
    throw new Error("Assistant thread is archived");
  }

  const now = new Date();
  const messageContent = params.content.trim();
  const nextTitle =
    params.role === "user" && thread.title === DEFAULT_THREAD_TITLE
      ? deriveAssistantThreadTitle(messageContent)
      : thread.title;

  const [message] = await db
    .insert(assistantMessages)
    .values({
      threadId: thread.id,
      churchId: params.churchId,
      userId: params.userId,
      role: params.role,
      content: messageContent,
      metadata: params.metadata ?? null,
      createdAt: now,
    })
    .returning();

  await db
    .update(assistantThreads)
    .set({
      title: nextTitle,
      updatedAt: now,
      lastMessageAt: now,
    })
    .where(eq(assistantThreads.id, thread.id));

  return serializeMessage(message);
}

export async function createPlaceholderAssistantReply(
  churchId: string,
  userId: string,
  threadId: string
) {
  return appendAssistantMessage({
    churchId,
    userId,
    threadId,
    role: "assistant",
    content: getPlaceholderAssistantReply(),
  });
}

export async function upsertActiveAssistantArtifact(params: {
  churchId: string;
  userId: string;
  threadId: string;
  kind: AssistantArtifactKind;
  payload: Record<string, unknown>;
  status?: AssistantArtifactStatus;
}): Promise<AssistantArtifactRecord> {
  const thread = await getOwnedThreadRow(
    params.churchId,
    params.userId,
    params.threadId
  );

  if (!thread) {
    throw new Error("Assistant thread not found");
  }

  if (thread.status !== "active") {
    throw new Error("Assistant thread is archived");
  }

  const now = new Date();
  const [existingArtifact] = await db
    .select()
    .from(assistantArtifacts)
    .where(
      and(
        eq(assistantArtifacts.threadId, params.threadId),
        eq(assistantArtifacts.churchId, params.churchId),
        eq(assistantArtifacts.kind, params.kind),
        eq(assistantArtifacts.status, "active")
      )
    )
    .limit(1);

  if (existingArtifact) {
    const [updatedArtifact] = await db
      .update(assistantArtifacts)
      .set({
        payload: params.payload,
        status: params.status ?? existingArtifact.status,
        updatedAt: now,
      })
      .where(eq(assistantArtifacts.id, existingArtifact.id))
      .returning();

    return serializeArtifact(updatedArtifact);
  }

  const [artifact] = await db
    .insert(assistantArtifacts)
    .values({
      threadId: params.threadId,
      churchId: params.churchId,
      kind: params.kind,
      status: params.status ?? "active",
      payload: params.payload,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  return serializeArtifact(artifact);
}

export async function archiveAssistantThread(
  churchId: string,
  userId: string,
  threadId: string
) {
  const thread = await getOwnedThreadRow(churchId, userId, threadId);

  if (!thread) {
    throw new Error("Assistant thread not found");
  }

  await db
    .update(assistantThreads)
    .set({
      status: "archived",
      updatedAt: new Date(),
    })
    .where(eq(assistantThreads.id, threadId));
}

export async function restoreAssistantThread(
  churchId: string,
  userId: string,
  threadId: string
): Promise<AssistantThreadSummary> {
  const thread = await getOwnedThreadRow(churchId, userId, threadId);

  if (!thread) {
    throw new Error("Assistant thread not found");
  }

  if (thread.status === "active") {
    await archiveActiveThreads(churchId, userId, {
      excludeThreadId: thread.id,
    });

    return serializeThread(thread);
  }

  await archiveActiveThreads(churchId, userId);

  const [restoredThread] = await db
    .update(assistantThreads)
    .set({
      status: "active",
      updatedAt: new Date(),
    })
    .where(eq(assistantThreads.id, threadId))
    .returning();

  return serializeThread(restoredThread);
}

export async function clearAssistantHistory(churchId: string, userId: string) {
  const archivedThreads = await listAssistantHistory(churchId, userId);

  if (archivedThreads.length === 0) {
    return 0;
  }

  await db
    .delete(assistantThreads)
    .where(
      and(
        eq(assistantThreads.churchId, churchId),
        eq(assistantThreads.userId, userId),
        eq(assistantThreads.status, "archived")
      )
    );

  return archivedThreads.length;
}
