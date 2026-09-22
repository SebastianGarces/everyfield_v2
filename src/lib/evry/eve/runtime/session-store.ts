import { and, desc, eq, ilike, isNull } from "drizzle-orm";
import { db } from "@/db";
import { evryEveSessions } from "@/db/schema/evry-eve";

export type EveSessionOwner = Readonly<{ userId: string; plantId: string }>;

export interface EveSessionStore {
  owns(sessionId: string, owner: EveSessionOwner): Promise<boolean>;
  register(
    sessionId: string,
    owner: EveSessionOwner,
    title?: string
  ): Promise<void>;
}

export const eveSessionStore: EveSessionStore = {
  async owns(sessionId, owner) {
    const [row] = await db
      .select({ id: evryEveSessions.id })
      .from(evryEveSessions)
      .where(
        and(
          eq(evryEveSessions.id, sessionId),
          eq(evryEveSessions.churchId, owner.plantId),
          eq(evryEveSessions.userId, owner.userId),
          isNull(evryEveSessions.archivedAt)
        )
      )
      .limit(1);
    return row !== undefined;
  },
  async register(sessionId, owner, title = "New conversation") {
    await db
      .insert(evryEveSessions)
      .values({
        id: sessionId,
        churchId: owner.plantId,
        userId: owner.userId,
        title: title.slice(0, 120),
      })
      .onConflictDoNothing();
    if (!(await this.owns(sessionId, owner)))
      throw new Error("Conversation unavailable");
  },
};

export async function listEveSessions(
  owner: EveSessionOwner,
  search: string | null = null
) {
  return db
    .select({
      id: evryEveSessions.id,
      conversationId: evryEveSessions.conversationId,
      title: evryEveSessions.title,
      createdAt: evryEveSessions.createdAt,
      updatedAt: evryEveSessions.updatedAt,
    })
    .from(evryEveSessions)
    .where(
      and(
        eq(evryEveSessions.churchId, owner.plantId),
        eq(evryEveSessions.userId, owner.userId),
        isNull(evryEveSessions.archivedAt),
        search
          ? ilike(
              evryEveSessions.title,
              `%${search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`
            )
          : undefined
      )
    )
    .orderBy(desc(evryEveSessions.updatedAt))
    .limit(100);
}

export async function getEveSession(
  sessionId: string,
  owner: EveSessionOwner
): Promise<typeof evryEveSessions.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(evryEveSessions)
    .where(
      and(
        eq(evryEveSessions.id, sessionId),
        eq(evryEveSessions.churchId, owner.plantId),
        eq(evryEveSessions.userId, owner.userId),
        isNull(evryEveSessions.archivedAt)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function getEveSessionForConversation(
  conversationId: string,
  owner: EveSessionOwner
) {
  const [row] = await db
    .select()
    .from(evryEveSessions)
    .where(
      and(
        eq(evryEveSessions.conversationId, conversationId),
        eq(evryEveSessions.churchId, owner.plantId),
        eq(evryEveSessions.userId, owner.userId),
        isNull(evryEveSessions.archivedAt)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function touchEveSession(
  sessionId: string,
  owner: EveSessionOwner
) {
  await db
    .update(evryEveSessions)
    .set({ updatedAt: new Date() })
    .where(
      and(
        eq(evryEveSessions.id, sessionId),
        eq(evryEveSessions.churchId, owner.plantId),
        eq(evryEveSessions.userId, owner.userId)
      )
    );
}

export async function titleEveSessionIfNew(
  sessionId: string,
  owner: EveSessionOwner,
  text: string
) {
  const title = text
    .replace(/[\p{Cc}\p{Cf}]+/gu, " ")
    .trim()
    .slice(0, 120);
  if (!title) return;
  await db
    .update(evryEveSessions)
    .set({ title })
    .where(
      and(
        eq(evryEveSessions.id, sessionId),
        eq(evryEveSessions.churchId, owner.plantId),
        eq(evryEveSessions.userId, owner.userId),
        eq(evryEveSessions.title, "New conversation")
      )
    );
}
