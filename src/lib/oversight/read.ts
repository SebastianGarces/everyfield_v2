// ============================================================================
// Oversight plants directory + detail — the read layer (OV-001 / OV-002).
//
// THREE RULES THIS MODULE EXISTS TO ENFORCE, all of them at the query and never
// in a component:
//
//  1. SCOPE. Every read starts from `getAccessibleChurchIds(user)` — a sending
//     church admin gets churches whose `sending_church_id` matches theirs, a
//     network admin gets `sending_network_id`. There is no parameter anywhere
//     on these surfaces that names an ORGANIZATION, so one org cannot ask for
//     another's portfolio: the only id a request carries is a plant id, and it
//     is checked against that list before it reaches a WHERE clause. That also
//     makes a malformed id a 404 rather than a Postgres uuid cast error.
//
//  2. THE GATE. Each detail section is resolved through `canAccessFeatureData`
//     against the `share_*` toggle its definition names (`./sections.ts`), and
//     a withheld section is NOT QUERIED AT ALL — the aggregate is never
//     computed, so there is nothing to leak through a log, a timing difference
//     or a future serialization mistake. The directory listing is deliberately
//     ungated: the roster is visible to the associated org regardless of the
//     six toggles, which gate feature data INSIDE a plant and not the plant's
//     existence (memory/invariants.md → Hierarchical Access Control, the same
//     rule `getOversightPlantHealth` follows).
//
//  3. AGGREGATES ONLY. Every SELECT below either counts rows or reads a
//     church/organization-level column. No query in this file selects a name,
//     an email, an address or a person id from `persons`, and the section
//     result type has no field one could travel in. The one identity on the
//     surface is the PLANTER (OV-001) — the org's counterparty, read from
//     `users`, name only — which is not a person record from the plant's own
//     pipeline.
// ============================================================================

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  ne,
} from "drizzle-orm";

import {
  churchMeetings,
  churches,
  ministryTeams,
  organizationInvitations,
  personStatuses,
  persons,
  sendingChurches,
  sendingNetworks,
  tasks,
  teamMemberships,
  users,
  type PersonStatus,
  type User,
} from "@/db/schema";
import {
  OVERSIGHT_SECTIONS,
  type OversightSectionDefinition,
} from "@/lib/oversight/sections";
import {
  daysUntilLaunch,
  formatPlantLocation,
  isMeetingsEmpty,
  isMinistryTeamsEmpty,
  isPeopleEmpty,
  isTasksEmpty,
  meetingsStats,
  ministryTeamsStats,
  peopleStats,
  tasksStats,
} from "@/lib/oversight/presentation";
import type {
  MeetingsAggregate,
  MinistryTeamsAggregate,
  OversightAssociationProvenance,
  OversightOrgType,
  OversightPlantDetail,
  OversightPlantSummary,
  OversightSectionResult,
  PeopleAggregate,
  TasksAggregate,
} from "@/lib/oversight/types";

// The value imports below transitively load the DB client (`@/db`). They are
// deferred to the call sites inside the async reads so this module can be
// imported — and its contract asserted — without a DATABASE_URL, the same seam
// `phase-engine/oversight/read.ts` uses.

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * How many recent completed meetings the cadence and attendance averages are
 * taken over. Bounded on purpose: an average over a plant's entire history
 * answers a question nobody asked ("how did they meet two years ago"), and an
 * unbounded SELECT on a per-plant page is a load-bearing decision, not a
 * detail.
 */
export const RECENT_MEETING_WINDOW = 12;

/** Meeting statuses that count as still ahead of the plant. */
const UPCOMING_MEETING_STATUSES = ["planning", "ready", "in_progress"] as const;

// ----------------------------------------------------------------------------
// Directory (OV-001).
// ----------------------------------------------------------------------------

/**
 * Every plant the caller's org is associated with, ordered by name.
 *
 * Returns `[]` for anyone who is not an oversight admin, or whose org has no
 * plants — `getAccessibleChurchIds` already answers "which churches" for every
 * role, so this never has to branch on role for access, only for which org
 * name provenance should be attributed to.
 */
export async function listOversightPlants(
  user: User,
  asOf: Date = new Date()
): Promise<OversightPlantSummary[]> {
  const { db } = await import("@/db");
  const { getAccessibleChurchIds } = await import("@/lib/auth/access");

  const org = await resolveCallerOrg(user);
  if (!org) return [];

  const churchIds = await getAccessibleChurchIds(user);
  if (churchIds.length === 0) return [];

  const plants = await db
    .select({
      id: churches.id,
      name: churches.name,
      city: churches.city,
      stateRegion: churches.stateRegion,
      country: churches.country,
      currentPhase: churches.currentPhase,
      launchDate: churches.launchDate,
      sendingChurchId: churches.sendingChurchId,
    })
    .from(churches)
    .where(inArray(churches.id, churchIds));

  const [planterNames, associatedAt, sendingChurchNames] = await Promise.all([
    readPlanterNames(churchIds),
    readAssociatedAt(org, churchIds),
    // Only a network admin can be reading a plant "through" a sending church;
    // a sending-church admin IS the sending church, so the qualifier would be
    // their own name repeated back at them. The lookup is scoped to the
    // caller's own network — see `sendingChurchesInNetwork`.
    org.orgType === "network"
      ? readSendingChurchNames(
          org,
          plants
            .map((plant) => plant.sendingChurchId)
            .filter((id): id is string => id !== null)
        )
      : Promise.resolve(new Map<string, string>()),
  ]);

  return plants
    .map((plant) => {
      const provenance: OversightAssociationProvenance = {
        orgType: org.orgType,
        orgName: org.orgName,
        viaSendingChurchName: plant.sendingChurchId
          ? (sendingChurchNames.get(plant.sendingChurchId) ?? null)
          : null,
        associatedAt: associatedAt.get(plant.id) ?? null,
      };

      return {
        churchId: plant.id,
        name: plant.name,
        location: formatPlantLocation(
          plant.city,
          plant.stateRegion,
          plant.country
        ),
        planterName: planterNames.get(plant.id) ?? null,
        currentPhase: plant.currentPhase,
        launchDate: plant.launchDate,
        daysUntilLaunch: daysUntilLaunch(plant.launchDate, asOf),
        provenance,
      } satisfies OversightPlantSummary;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ----------------------------------------------------------------------------
// Detail (OV-002).
// ----------------------------------------------------------------------------

/**
 * One plant's directory row plus its privacy-gated aggregate sections, or
 * `null` when the plant is not the caller's.
 *
 * Null is the ONLY answer for a plant outside the caller's org — there is no
 * variant that returns a name with empty sections, because "this plant exists
 * but is not yours" is itself information about another org's portfolio. The
 * page turns null into `notFound()`, so a probed id is indistinguishable from
 * one that does not exist.
 */
export async function getOversightPlantDetail(
  user: User,
  churchId: string,
  asOf: Date = new Date()
): Promise<OversightPlantDetail | null> {
  const { getAccessibleChurchIds } = await import("@/lib/auth/access");

  // Membership is checked BEFORE `churchId` reaches any query, so an id from
  // another org and an id that is not a uuid take the same path out.
  const accessibleIds = await getAccessibleChurchIds(user);
  if (!accessibleIds.includes(churchId)) return null;

  // The header is built by the SAME code path as the directory row the admin
  // clicked, rather than by a second query shaped slightly differently — so the
  // countdown, the provenance and the planter cannot say one thing in the list
  // and another on the page. The cost is one org-scoped roster read; the thing
  // it buys is that there is only one definition of a plant's summary.
  const plants = await listOversightPlants(user, asOf);
  const plant = plants.find((candidate) => candidate.churchId === churchId);
  if (!plant) return null;

  const sections = await Promise.all(
    OVERSIGHT_SECTIONS.map((section) =>
      readSection(user, plant.churchId, section, asOf)
    )
  );

  return { plant, sections };
}

/**
 * Resolve one section: ask the gate first, and only compute the aggregate when
 * the answer is yes. A withheld section costs zero queries by construction.
 */
async function readSection(
  user: User,
  churchId: string,
  section: OversightSectionDefinition,
  asOf: Date
): Promise<OversightSectionResult> {
  const { canAccessFeatureData } = await import("@/lib/auth/access");

  const allowed = await canAccessFeatureData(
    user,
    churchId,
    section.privacyFeature
  );
  if (!allowed) return { key: section.key, state: "withheld" };

  switch (section.key) {
    case "people": {
      const aggregate = await readPeopleAggregate(churchId);
      return {
        key: section.key,
        state: "shared",
        stats: peopleStats(aggregate),
        isEmpty: isPeopleEmpty(aggregate),
      };
    }
    case "meetings": {
      const aggregate = await readMeetingsAggregate(churchId, asOf);
      return {
        key: section.key,
        state: "shared",
        stats: meetingsStats(aggregate),
        isEmpty: isMeetingsEmpty(aggregate),
      };
    }
    case "tasks": {
      const aggregate = await readTasksAggregate(churchId, asOf);
      return {
        key: section.key,
        state: "shared",
        stats: tasksStats(aggregate),
        isEmpty: isTasksEmpty(aggregate),
      };
    }
    case "ministry_teams": {
      const aggregate = await readMinistryTeamsAggregate(churchId);
      return {
        key: section.key,
        state: "shared",
        stats: ministryTeamsStats(aggregate),
        isEmpty: isMinistryTeamsEmpty(aggregate),
      };
    }
  }
}

// ----------------------------------------------------------------------------
// Aggregates. Each one COUNTS; none selects an identifying column.
// ----------------------------------------------------------------------------

async function readPeopleAggregate(churchId: string): Promise<PeopleAggregate> {
  const { db } = await import("@/db");

  const rows = await db
    .select({ status: persons.status, total: count() })
    .from(persons)
    .where(and(eq(persons.churchId, churchId), isNull(persons.deletedAt)))
    .groupBy(persons.status);

  const counts = new Map<PersonStatus, number>(
    rows.map((row) => [row.status, row.total])
  );

  return {
    total: rows.reduce((sum, row) => sum + row.total, 0),
    // Canonical pipeline order, every stage present — a stage missing from the
    // list would read as "unknown" when the honest answer is zero.
    byStatus: personStatuses.map((status) => ({
      status,
      count: counts.get(status) ?? 0,
    })),
  };
}

async function readMeetingsAggregate(
  churchId: string,
  asOf: Date
): Promise<MeetingsAggregate> {
  const { db } = await import("@/db");

  const [completedRow, upcomingRow, recent] = await Promise.all([
    db
      .select({ total: count() })
      .from(churchMeetings)
      .where(
        and(
          eq(churchMeetings.churchId, churchId),
          eq(churchMeetings.status, "completed")
        )
      ),
    db
      .select({ total: count() })
      .from(churchMeetings)
      .where(
        and(
          eq(churchMeetings.churchId, churchId),
          gt(churchMeetings.datetime, asOf),
          inArray(churchMeetings.status, [...UPCOMING_MEETING_STATUSES])
        )
      ),
    db
      .select({
        datetime: churchMeetings.datetime,
        actualAttendance: churchMeetings.actualAttendance,
      })
      .from(churchMeetings)
      .where(
        and(
          eq(churchMeetings.churchId, churchId),
          eq(churchMeetings.status, "completed")
        )
      )
      .orderBy(desc(churchMeetings.datetime))
      .limit(RECENT_MEETING_WINDOW),
  ]);

  const lastCompletedAt = recent[0]?.datetime ?? null;

  const gaps: number[] = [];
  for (let i = 0; i < recent.length - 1; i += 1) {
    const gap =
      (recent[i].datetime.getTime() - recent[i + 1].datetime.getTime()) /
      MS_PER_DAY;
    gaps.push(gap);
  }

  const attendances = recent
    .map((meeting) => meeting.actualAttendance)
    .filter((value): value is number => value !== null);

  return {
    completedCount: completedRow[0]?.total ?? 0,
    upcomingCount: upcomingRow[0]?.total ?? 0,
    lastCompletedAt,
    daysSinceLastCompleted: lastCompletedAt
      ? Math.floor((asOf.getTime() - lastCompletedAt.getTime()) / MS_PER_DAY)
      : null,
    averageCadenceDays: gaps.length > 0 ? Math.round(mean(gaps)) : null,
    averageAttendance:
      attendances.length > 0 ? Math.round(mean(attendances)) : null,
  };
}

async function readTasksAggregate(
  churchId: string,
  asOf: Date
): Promise<TasksAggregate> {
  const { db } = await import("@/db");

  // "Today" in `APP_TIME_ZONE` (UTC), matching how every other date on these
  // surfaces is rendered — an overdue count computed against the server's local
  // day would disagree with the dates the planter sees.
  const today = asOf.toISOString().slice(0, 10);

  const [statusRows, overdueRow] = await Promise.all([
    db
      .select({ status: tasks.status, total: count() })
      .from(tasks)
      .where(and(eq(tasks.churchId, churchId), isNull(tasks.deletedAt)))
      .groupBy(tasks.status),
    db
      .select({ total: count() })
      .from(tasks)
      .where(
        and(
          eq(tasks.churchId, churchId),
          isNull(tasks.deletedAt),
          ne(tasks.status, "complete"),
          lt(tasks.dueDate, today)
        )
      ),
  ]);

  const total = statusRows.reduce((sum, row) => sum + row.total, 0);
  const completed =
    statusRows.find((row) => row.status === "complete")?.total ?? 0;

  return {
    total,
    open: total - completed,
    completed,
    overdue: overdueRow[0]?.total ?? 0,
  };
}

async function readMinistryTeamsAggregate(
  churchId: string
): Promise<MinistryTeamsAggregate> {
  const { db } = await import("@/db");

  const [teamRows, membershipRow] = await Promise.all([
    // `leaderId` is read to be COUNTED, never rendered: the stat is "how many
    // teams have a leader", and the leader's identity never leaves this scope.
    db
      .select({ leaderId: ministryTeams.leaderId })
      .from(ministryTeams)
      .where(eq(ministryTeams.churchId, churchId)),
    db
      .select({ total: count() })
      .from(teamMemberships)
      .where(
        and(
          eq(teamMemberships.churchId, churchId),
          eq(teamMemberships.status, "active")
        )
      ),
  ]);

  return {
    teamCount: teamRows.length,
    teamsWithLeader: teamRows.filter((team) => team.leaderId !== null).length,
    activeMemberships: membershipRow[0]?.total ?? 0,
  };
}

// ----------------------------------------------------------------------------
// Org + provenance helpers.
// ----------------------------------------------------------------------------

interface CallerOrg {
  orgType: OversightOrgType;
  orgId: string;
  orgName: string;
}

/**
 * The caller's OWN organization, read from the session user's org FK.
 *
 * Null for any role that is not an oversight admin, and for an oversight admin
 * with no organization — both of which already resolve to zero accessible
 * churches, so this is the same refusal stated once more where the name is
 * needed.
 */
async function resolveCallerOrg(user: User): Promise<CallerOrg | null> {
  const { db } = await import("@/db");

  if (user.role === "network_admin" && user.sendingNetworkId) {
    const [network] = await db
      .select({ id: sendingNetworks.id, name: sendingNetworks.name })
      .from(sendingNetworks)
      .where(eq(sendingNetworks.id, user.sendingNetworkId))
      .limit(1);
    return network
      ? { orgType: "network", orgId: network.id, orgName: network.name }
      : null;
  }

  if (user.role === "sending_church_admin" && user.sendingChurchId) {
    const [sendingChurch] = await db
      .select({ id: sendingChurches.id, name: sendingChurches.name })
      .from(sendingChurches)
      .where(eq(sendingChurches.id, user.sendingChurchId))
      .limit(1);
    return sendingChurch
      ? {
          orgType: "sending_church",
          orgId: sendingChurch.id,
          orgName: sendingChurch.name,
        }
      : null;
  }

  return null;
}

/**
 * The plant's lead planter's NAME, per church.
 *
 * Not a person record: this is the account the org invited by email and whose
 * acceptance created the association (OV-001 lists it as a directory column).
 * The name is all that is selected — no email, no phone, no id.
 *
 * Ordered, because nothing stops a church having two planter accounts and the
 * first row wins below: without an ORDER BY the directory would name one of
 * them on one render and the other on the next, for no reason a reader could
 * see. Oldest account first — the one whose acceptance made the association —
 * with the id breaking a same-timestamp tie so the answer is total.
 */
async function readPlanterNames(
  churchIds: string[]
): Promise<Map<string, string>> {
  const { db } = await import("@/db");

  const rows = await db
    .select({ churchId: users.churchId, name: users.name })
    .from(users)
    .where(and(inArray(users.churchId, churchIds), eq(users.role, "planter")))
    .orderBy(asc(users.createdAt), asc(users.id));

  const names = new Map<string, string>();
  for (const row of rows) {
    if (!row.churchId || !row.name) continue;
    if (!names.has(row.churchId)) names.set(row.churchId, row.name);
  }
  return names;
}

/**
 * When each plant's association with THIS org was accepted, from the invitation
 * that created it. Plants with no accepted invitation on record are simply
 * absent from the map — see `OversightAssociationProvenance.associatedAt`.
 */
async function readAssociatedAt(
  org: CallerOrg,
  churchIds: string[]
): Promise<Map<string, Date>> {
  const { db } = await import("@/db");

  const rows = await db
    .select({
      targetChurchId: organizationInvitations.targetChurchId,
      respondedAt: organizationInvitations.respondedAt,
    })
    .from(organizationInvitations)
    .where(
      and(
        inArray(organizationInvitations.targetChurchId, churchIds),
        eq(organizationInvitations.status, "accepted"),
        org.orgType === "network"
          ? eq(organizationInvitations.sendingNetworkId, org.orgId)
          : eq(organizationInvitations.sendingChurchId, org.orgId)
      )
    );

  const accepted = new Map<string, Date>();
  for (const row of rows) {
    if (!row.targetChurchId || !row.respondedAt) continue;
    const existing = accepted.get(row.targetChurchId);
    // Newest wins: a plant can have been invited more than once, and the
    // association that stands is the most recent accepted one.
    if (!existing || row.respondedAt > existing) {
      accepted.set(row.targetChurchId, row.respondedAt);
    }
  }
  return accepted;
}

/**
 * The tenancy predicate behind the "· through <sending church>" qualifier.
 *
 * A plant's `sending_church_id` may name ANY sending church in the system,
 * including one in a different network entirely — the two association FKs are
 * independent and an accept never replaces the other (memory/invariants.md →
 * Multi-Tenancy). So resolving that id to a NAME without asking whose network
 * the sending church is in discloses a third organization's name to a caller
 * who is not party to that relationship. Requiring `sending_network_id =` the
 * caller's own is what keeps the qualifier inside the caller's tenancy: it can
 * only ever name a member of their own network, which is a position in the
 * hierarchy they already administer.
 *
 * Exported so the predicate itself is asserted rather than described — building
 * it needs the schema but not the DB client, so the test runs with no
 * `DATABASE_URL`.
 */
export function sendingChurchesInNetwork(
  networkId: string,
  sendingChurchIds: string[]
) {
  return and(
    inArray(sendingChurches.id, sendingChurchIds),
    eq(sendingChurches.sendingNetworkId, networkId)
  );
}

/**
 * Names of the sending churches some of these plants also belong to, restricted
 * to the ones inside the caller's own network.
 *
 * A plant whose sending church sits outside the network is simply absent from
 * the map, so `viaSendingChurchName` resolves to null and no qualifier renders.
 * Network callers only — a sending-church admin IS the sending church.
 */
async function readSendingChurchNames(
  org: CallerOrg,
  sendingChurchIds: string[]
): Promise<Map<string, string>> {
  if (sendingChurchIds.length === 0) return new Map();
  const { db } = await import("@/db");

  const rows = await db
    .select({ id: sendingChurches.id, name: sendingChurches.name })
    .from(sendingChurches)
    .where(sendingChurchesInNetwork(org.orgId, sendingChurchIds));

  return new Map(rows.map((row) => [row.id, row.name]));
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
