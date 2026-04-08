import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  assistantMessages,
  assistantThreads,
  churches,
  users,
} from "@/db/schema";
import {
  appendAssistantMessage,
  clearAssistantHistory,
  createAssistantThread,
  createPlaceholderAssistantReply,
  deriveAssistantThreadTitle,
  getAssistantThread,
  getOrCreateLatestAssistantThread,
  getPlaceholderAssistantReply,
  listAssistantHistory,
  listAssistantThreads,
  restoreAssistantThread,
  upsertActiveAssistantArtifact,
} from "./service";

async function createTestChurchAndUser() {
  const churchId = randomUUID();
  const userId = randomUUID();
  const email = `assistant-test-${randomUUID()}@example.com`;

  await db.insert(churches).values({
    id: churchId,
    name: `Assistant Test Church ${churchId.slice(0, 8)}`,
  });

  await db.insert(users).values({
    id: userId,
    email,
    passwordHash: "test-password-hash",
    role: "planter",
    churchId,
    name: "Assistant Test User",
  });

  return { churchId, userId };
}

async function cleanupTestChurchAndUser(churchId: string, userId: string) {
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(churches).where(eq(churches.id, churchId));
}

test("deriveAssistantThreadTitle collapses whitespace and truncates long content", () => {
  assert.equal(
    deriveAssistantThreadTitle(
      "   Schedule   a   meeting    for next Tuesday at 7 PM with the worship team   "
    ),
    "Schedule a meeting for next Tuesday at 7 PM with the wors..."
  );
});

test("getPlaceholderAssistantReply returns the phase 1 placeholder copy", () => {
  assert.equal(
    getPlaceholderAssistantReply(),
    "I’m ready to help. Soon you’ll be able to schedule meetings, send invites, and manage follow-up from here."
  );
});

test(
  "assistant service keeps one active thread and preserves archived history",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const { churchId, userId } = await createTestChurchAndUser();

    try {
      const firstThread = await createAssistantThread(churchId, userId);
      assert.equal(firstThread.title, "New chat");

      const latestThread = await getOrCreateLatestAssistantThread(
        churchId,
        userId
      );
      assert.equal(latestThread.id, firstThread.id);

      await appendAssistantMessage({
        churchId,
        userId,
        threadId: firstThread.id,
        role: "user",
        content: "Schedule an orientation next Thursday at 6 PM",
      });
      await createPlaceholderAssistantReply(churchId, userId, firstThread.id);
      await upsertActiveAssistantArtifact({
        churchId,
        userId,
        threadId: firstThread.id,
        kind: "meeting_draft",
        payload: {
          type: "meeting_draft",
          status: "collecting",
        },
      });

      const detail = await getAssistantThread(churchId, userId, firstThread.id);
      assert.ok(detail);
      assert.equal(
        detail.thread.title,
        "Schedule an orientation next Thursday at 6 PM"
      );
      assert.equal(detail.messages.length, 2);
      assert.equal(detail.messages[0]?.role, "user");
      assert.equal(detail.messages[1]?.role, "assistant");
      assert.equal(detail.artifacts.length, 1);
      assert.equal(detail.artifacts[0]?.kind, "meeting_draft");

      const secondThread = await createAssistantThread(churchId, userId, {
        title: "Fresh start",
      });

      const activeThreads = await listAssistantThreads(churchId, userId);
      assert.equal(activeThreads.length, 1);
      assert.equal(activeThreads[0]?.id, secondThread.id);

      const history = await listAssistantHistory(churchId, userId);
      assert.equal(history.length, 1);
      assert.equal(history[0]?.id, firstThread.id);

      await assert.rejects(
        appendAssistantMessage({
          churchId,
          userId,
          threadId: firstThread.id,
          role: "user",
          content: "This should not land in an archived thread",
        }),
        /archived/
      );

      const restoredThread = await restoreAssistantThread(
        churchId,
        userId,
        firstThread.id
      );
      assert.equal(restoredThread.id, firstThread.id);

      const nextActiveThreads = await listAssistantThreads(churchId, userId);
      assert.equal(nextActiveThreads.length, 1);
      assert.equal(nextActiveThreads[0]?.id, firstThread.id);

      const nextHistory = await listAssistantHistory(churchId, userId);
      assert.equal(nextHistory.length, 1);
      assert.equal(nextHistory[0]?.id, secondThread.id);

      const deletedCount = await clearAssistantHistory(churchId, userId);
      assert.equal(deletedCount, 1);

      const emptyHistory = await listAssistantHistory(churchId, userId);
      assert.equal(emptyHistory.length, 0);
    } finally {
      await cleanupTestChurchAndUser(churchId, userId);
    }
  }
);

test(
  "assistant service scopes thread access to the owning user and church",
  { skip: !process.env.DATABASE_URL },
  async () => {
    const owner = await createTestChurchAndUser();
    const stranger = await createTestChurchAndUser();

    try {
      const thread = await createAssistantThread(owner.churchId, owner.userId);
      await appendAssistantMessage({
        churchId: owner.churchId,
        userId: owner.userId,
        threadId: thread.id,
        role: "user",
        content: "Help me plan next week",
      });

      const strangerView = await getAssistantThread(
        stranger.churchId,
        stranger.userId,
        thread.id
      );
      assert.equal(strangerView, null);

      const ownerRows = await db
        .select()
        .from(assistantThreads)
        .where(
          and(
            eq(assistantThreads.id, thread.id),
            eq(assistantThreads.churchId, owner.churchId),
            eq(assistantThreads.userId, owner.userId)
          )
        );

      assert.equal(ownerRows.length, 1);

      const strangerRows = await db
        .select()
        .from(assistantMessages)
        .where(eq(assistantMessages.threadId, thread.id));

      assert.equal(strangerRows.length, 1);
    } finally {
      await cleanupTestChurchAndUser(owner.churchId, owner.userId);
      await cleanupTestChurchAndUser(stranger.churchId, stranger.userId);
    }
  }
);
