// ============================================================================
// Communication Query Predicates
// ============================================================================
//
// Pure `where`-clause construction for the aggregation reads added by COM-018
// (resend to non-openers) and COM-019 (delivery stats overview), plus the
// ministry-team recipient group of MT-015.
//
// These live apart from `service.ts` for the same reason `filters.ts` does:
// `service.ts` pulls in the db client, Resend and the email renderer, so the
// predicates it runs could not otherwise be unit-tested. Tenant isolation here
// is application-layer (`memory/invariants.md` -> Multi-Tenancy), which makes
// the shape of these clauses the boundary itself — `queries.test.ts` compiles
// each one with the real Postgres dialect and pins the church scope.
// ============================================================================

import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
  sql,
  type SQL,
} from "drizzle-orm";

import {
  communicationRecipients,
  communications,
  type RecipientStatus,
} from "@/db/schema/communication";
import { ministryTeams, teamMemberships } from "@/db/schema/ministry-teams";
import { persons } from "@/db/schema/people";

// ---------------------------------------------------------------------------
// Recipient status vocabulary
// ---------------------------------------------------------------------------

/**
 * Statuses that record an open. A click cannot happen without an open, so
 * `clicked` counts as opened even when the open pixel never fired.
 */
export const OPENED_STATUSES = ["opened", "clicked"] as const;

/**
 * Statuses that record a delivery. Both later states imply it — a recipient
 * row only advances past `delivered`.
 */
export const DELIVERED_STATUSES = ["delivered", "opened", "clicked"] as const;

// ---------------------------------------------------------------------------
// Delivery statistics (COM-019)
// ---------------------------------------------------------------------------

/**
 * Church-wide recipient telemetry, straight from the aggregate query. Declared
 * here rather than beside the presentation helpers so the dependency runs one
 * way: the renderer reads the shape the query produces, never the reverse.
 */
export interface DeliveryTotals {
  /** Messages recorded as sent — context, never a rate denominator. */
  messagesSent: number;
  /** Recipient rows across those messages. */
  recipients: number;
  /** Recipient rows past `pending` — what was actually attempted. */
  attempted: number;
  delivered: number;
  opened: number;
  clicked: number;
  bounced: number;
  failed: number;
}

/**
 * Scope for the church-wide delivery aggregate. Written for a query that joins
 * `communication_recipients` to its `communications` row, and asserts the
 * church on BOTH sides: the recipient row carries its own `church_id`, and a
 * join that only constrained one of them would still read another tenant's
 * rows if either column were ever written wrong.
 *
 * Deliberately says nothing about `communications.status`. Every figure the
 * overview reports is derived from recipient telemetry, so a message that
 * carries no recipient rows — a draft, or the `[Log Only]` entries COM-020
 * (PR #366) records with status `logged` — contributes nothing either way.
 * The logged-vs-sent question is under a pending ruling; this aggregation does
 * not answer it, it just reports what the recipient rows record.
 */
export function churchDeliveryScope(churchId: string): SQL {
  return and(
    eq(communications.churchId, churchId),
    eq(communicationRecipients.churchId, churchId)
  ) as SQL;
}

/** Messages the church actually sent — the context line above the rates. */
export function sentMessagesScope(churchId: string): SQL {
  return and(
    eq(communications.churchId, churchId),
    eq(communications.status, "sent")
  ) as SQL;
}

/** `count(*) filter (where status = ...)` as an int, for one status. */
export function countOfStatus(status: RecipientStatus): SQL<number> {
  return sql<number>`count(*) filter (where ${eq(communicationRecipients.status, status)})::int`;
}

/**
 * `count(*) filter (where status in (...))` as an int. The list is composed
 * through `inArray` rather than interpolated, so each status is a bound
 * parameter instead of literal text.
 */
export function countOfStatuses(
  statuses: readonly RecipientStatus[]
): SQL<number> {
  return sql<number>`count(*) filter (where ${inArray(communicationRecipients.status, [...statuses])})::int`;
}

/**
 * Recipient rows that left the building: anything past `pending`. A `failed`
 * row was attempted and refused, a `bounced` row was accepted then returned —
 * both are sends, and hiding them would flatter the delivery rate.
 */
export function countAttempted(): SQL<number> {
  return sql<number>`count(*) filter (where ${communicationRecipients.status} <> 'pending')::int`;
}

// ---------------------------------------------------------------------------
// Non-openers (COM-018)
// ---------------------------------------------------------------------------

/**
 * The recipients of one message that recorded no open, resolved for a resend.
 *
 * Two guards beyond "did not open":
 *  - `bounced` is excluded. The address rejected the first attempt; sending to
 *    it again buys nothing and costs sender reputation.
 *  - the person must still exist, still belong to this church and still have
 *    an address, so the count shown before confirming is the count that will
 *    actually be sent to.
 *
 * Written for a query joining `communication_recipients` -> `communications`
 * -> `persons`.
 */
export function nonOpenerScope(churchId: string, communicationId: string): SQL {
  return and(
    eq(communicationRecipients.churchId, churchId),
    eq(communications.churchId, churchId),
    eq(communicationRecipients.communicationId, communicationId),
    notInArray(communicationRecipients.status, [...OPENED_STATUSES]),
    isNull(communicationRecipients.openedAt),
    ne(communicationRecipients.status, "bounced"),
    eq(persons.churchId, churchId),
    isNull(persons.deletedAt),
    isNotNull(persons.email)
  ) as SQL;
}

/** Every recipient row of one message, church-scoped — the resend denominator. */
export function messageRecipientScope(
  churchId: string,
  communicationId: string
): SQL {
  return and(
    eq(communicationRecipients.churchId, churchId),
    eq(communicationRecipients.communicationId, communicationId)
  ) as SQL;
}

// ---------------------------------------------------------------------------
// Ministry-team recipient groups (MT-015)
// ---------------------------------------------------------------------------

/** The quick-select prefix that names a ministry team: `team:<uuid>`. */
export const TEAM_GROUP_PREFIX = "team:";

/** Build the group selector for a team id. */
export function teamGroup(teamId: string): string {
  return `${TEAM_GROUP_PREFIX}${teamId}`;
}

/** Whether a selector claims to name a team, well-formed or not. */
export function isTeamGroup(group: string): boolean {
  return group.startsWith(TEAM_GROUP_PREFIX);
}

/**
 * Read a team id back out of a group selector, or `null` when the selector
 * names one of the status groups instead. An empty id is not a team — pair
 * this with `isTeamGroup` so `"team:"` resolves to nobody rather than falling
 * through to the status branch, where an unrecognised group means EVERYONE.
 */
export function parseTeamGroup(group: string): string | null {
  if (!isTeamGroup(group)) return null;
  const teamId = group.slice(TEAM_GROUP_PREFIX.length).trim();
  return teamId.length > 0 ? teamId : null;
}

/**
 * The teams offered as quick-select options.
 *
 * "Active" here means "not paused". A team that is still `forming` is one a
 * planter is actively staffing and very much wants to email; `paused` is the
 * only status that says otherwise.
 */
export function selectableTeamsScope(churchId: string): SQL {
  return and(
    eq(ministryTeams.churchId, churchId),
    ne(ministryTeams.status, "paused")
  ) as SQL;
}

/** Stable ordering for the team quick-selects — the teams page order. */
export const selectableTeamsOrder = [
  asc(ministryTeams.sortOrder),
  asc(ministryTeams.name),
];

/**
 * The active members of one team. Written for a query joining
 * `team_memberships` -> `persons`; a person holding two roles on the same team
 * has two membership rows, so the caller must select distinct people.
 */
export function teamMemberScope(churchId: string, teamId: string): SQL {
  return and(
    eq(teamMemberships.churchId, churchId),
    eq(teamMemberships.teamId, teamId),
    eq(teamMemberships.status, "active"),
    eq(persons.churchId, churchId),
    isNull(persons.deletedAt)
  ) as SQL;
}
