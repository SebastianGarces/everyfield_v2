import { db } from "@/db";
import {
  invitations,
  persons,
  type Invitation,
  type InvitationStatus,
} from "@/db/schema";
import type { InvitationCreateInput } from "@/lib/validations/vision-meetings";
import { and, desc, eq, sql } from "drizzle-orm";
import type { InvitationLeaderboardEntry, InvitationSummary } from "./types";

/**
 * Create an invitation record
 */
export async function createInvitation(
  churchId: string,
  meetingId: string,
  data: InvitationCreateInput
): Promise<Invitation> {
  const [invitation] = await db
    .insert(invitations)
    .values({
      churchId,
      meetingId,
      inviterId: data.inviterId,
      inviteeName: data.inviteeName,
      inviteeId: data.inviteeId,
      status: data.status ?? "invited",
    })
    .returning();

  return invitation;
}

/**
 * List all invitations for a meeting
 */
export async function listInvitations(
  churchId: string,
  meetingId: string
): Promise<(Invitation & { inviterName: string })[]> {
  const records = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.churchId, churchId),
        eq(invitations.meetingId, meetingId)
      )
    )
    .orderBy(desc(invitations.createdAt));

  if (records.length === 0) return [];

  // Fetch inviter names
  const inviterIds = [...new Set(records.map((r) => r.inviterId))];
  const inviterRecords = await db
    .select({
      id: persons.id,
      firstName: persons.firstName,
      lastName: persons.lastName,
    })
    .from(persons)
    .where(
      sql`${persons.id} IN (${sql.join(
        inviterIds.map((id) => sql`${id}::uuid`),
        sql`, `
      )})`
    );

  const inviterMap = new Map(
    inviterRecords.map((p) => [p.id, `${p.firstName} ${p.lastName}`])
  );

  return records.map((r) => ({
    ...r,
    inviterName: inviterMap.get(r.inviterId) ?? "Unknown",
  }));
}

/**
 * Update an invitation's status
 */
export async function updateInvitationStatus(
  churchId: string,
  invitationId: string,
  status: InvitationStatus
): Promise<Invitation> {
  const [updated] = await db
    .update(invitations)
    .set({ status, updatedAt: new Date() })
    .where(
      and(eq(invitations.churchId, churchId), eq(invitations.id, invitationId))
    )
    .returning();

  if (!updated) {
    throw new Error("Invitation not found");
  }

  return updated;
}

/**
 * Get invitation leaderboard per meeting
 */
export async function getInvitationLeaderboard(
  churchId: string,
  meetingId: string
): Promise<InvitationLeaderboardEntry[]> {
  const result = await db
    .select({
      inviterId: invitations.inviterId,
      total: sql<number>`count(*)::int`,
      confirmed: sql<number>`count(*) FILTER (WHERE ${invitations.status} = 'confirmed')::int`,
      attended: sql<number>`count(*) FILTER (WHERE ${invitations.status} = 'attended')::int`,
    })
    .from(invitations)
    .where(
      and(
        eq(invitations.churchId, churchId),
        eq(invitations.meetingId, meetingId)
      )
    )
    .groupBy(invitations.inviterId)
    .orderBy(desc(sql`count(*)`));

  if (result.length === 0) return [];

  // Fetch person details for inviters
  const inviterIds = result.map((r) => r.inviterId);
  const inviterRecords = await db
    .select({
      id: persons.id,
      firstName: persons.firstName,
      lastName: persons.lastName,
    })
    .from(persons)
    .where(
      sql`${persons.id} IN (${sql.join(
        inviterIds.map((id) => sql`${id}::uuid`),
        sql`, `
      )})`
    );

  const inviterMap = new Map(inviterRecords.map((p) => [p.id, p]));

  return result.map((r) => ({
    person: inviterMap.get(r.inviterId) ?? {
      id: r.inviterId,
      firstName: "Unknown",
      lastName: "",
    },
    invitedCount: r.total,
    confirmedCount: r.confirmed,
    attendedCount: r.attended,
  }));
}

/**
 * Get invitation summary for a meeting
 */
export async function getInvitationSummary(
  churchId: string,
  meetingId: string
): Promise<InvitationSummary> {
  const result = await db
    .select({
      total: sql<number>`count(*)::int`,
      confirmed: sql<number>`count(*) FILTER (WHERE ${invitations.status} = 'confirmed')::int`,
      maybe: sql<number>`count(*) FILTER (WHERE ${invitations.status} = 'maybe')::int`,
      declined: sql<number>`count(*) FILTER (WHERE ${invitations.status} = 'declined')::int`,
      attended: sql<number>`count(*) FILTER (WHERE ${invitations.status} = 'attended')::int`,
      noShow: sql<number>`count(*) FILTER (WHERE ${invitations.status} = 'no_show')::int`,
    })
    .from(invitations)
    .where(
      and(
        eq(invitations.churchId, churchId),
        eq(invitations.meetingId, meetingId)
      )
    );

  return (
    result[0] ?? {
      total: 0,
      confirmed: 0,
      maybe: 0,
      declined: 0,
      attended: 0,
      noShow: 0,
    }
  );
}
