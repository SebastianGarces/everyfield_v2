// ============================================================================
// Recipient Group Resolution
// ============================================================================
//
// Resolving the compose form's quick-select groups — status groups and the
// `team:<id>` selectors of MT-015 — into the people they name. The client
// components (`compose-form.tsx`, `recipient-picker.tsx`) import ONLY the
// types from this module (`import type`, erased at compile time), so the db
// client below never reaches a client bundle.
// ============================================================================

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { persons, type PersonStatus } from "@/db/schema/people";
import { ministryTeams, teamMemberships } from "@/db/schema/ministry-teams";
import {
  isTeamGroup,
  parseTeamGroup,
  selectableTeamsOrder,
  selectableTeamsScope,
  teamGroup,
  teamMemberScope,
} from "./queries";

/** A person as the recipient picker needs them. */
export interface GroupRecipient {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
}

/** The ministry teams offered as recipient quick-selects (MT-015). */
export interface RecipientTeamOption {
  id: string;
  name: string;
  /**
   * The group selector to hand back to `getGroupRecipients` — built here so
   * the client component never has to import the query module (and drizzle
   * with it) just to spell `team:<id>`.
   */
  selector: string;
  /** Active members — a team with none is offered, and resolves to zero. */
  memberCount: number;
}

const personColumns = {
  id: persons.id,
  firstName: persons.firstName,
  lastName: persons.lastName,
  email: persons.email,
};

/** Status groups, by their quick-select id. */
const STATUS_GROUPS: Record<string, PersonStatus[]> = {
  core_group: ["core_group"],
  launch_team: ["launch_team"],
  leaders: ["leader"],
  prospects: ["prospect"],
  all: [],
};

/**
 * Resolve a quick-select group into the people it names.
 *
 * Two kinds of selector:
 *  - a status group (`core_group`, `leaders`, `all`, …);
 *  - `team:<teamId>`, the active members of one ministry team (MT-015).
 *
 * An unknown selector resolves to every active person, matching the previous
 * behaviour of the status switch. A team with no active members resolves to
 * an empty list — the caller shows that as "0 recipients", not as an error.
 */
export async function getGroupRecipients(
  churchId: string,
  group: string
): Promise<GroupRecipient[]> {
  if (isTeamGroup(group)) {
    const teamId = parseTeamGroup(group);
    // A malformed team selector names nobody. It must NOT fall through to the
    // status branch, where an unrecognised group means every active person.
    if (!teamId) return [];

    // A person holding two roles on one team has two membership rows, so the
    // select must be distinct or they would be added to the picker twice.
    return db
      .selectDistinct(personColumns)
      .from(teamMemberships)
      .innerJoin(persons, eq(teamMemberships.personId, persons.id))
      .where(teamMemberScope(churchId, teamId));
  }

  const statusFilter = STATUS_GROUPS[group] ?? [];
  const conditions = [
    eq(persons.churchId, churchId),
    isNull(persons.deletedAt),
  ];
  if (statusFilter.length > 0) {
    conditions.push(inArray(persons.status, statusFilter));
  }

  return db
    .select(personColumns)
    .from(persons)
    .where(and(...conditions));
}

/**
 * Resolve a quick-select group into person IDs. Same resolution as
 * `getGroupRecipients` — including `team:<teamId>` — narrowed to ids.
 */
export async function getRecipientsByGroup(
  churchId: string,
  group: string
): Promise<string[]> {
  const people = await getGroupRecipients(churchId, group);
  return people.map((p) => p.id);
}

/**
 * The church's ministry teams, as recipient quick-selects with their active
 * member counts. Paused teams are left out; a `forming` team is one a planter
 * is actively staffing and very much wants to email.
 */
export async function listRecipientTeams(
  churchId: string
): Promise<RecipientTeamOption[]> {
  const rows = await db
    .select({
      id: ministryTeams.id,
      name: ministryTeams.name,
      sortOrder: ministryTeams.sortOrder,
      memberCount: sql<number>`count(distinct ${persons.id})::int`,
    })
    .from(ministryTeams)
    .leftJoin(
      teamMemberships,
      and(
        eq(teamMemberships.teamId, ministryTeams.id),
        eq(teamMemberships.churchId, churchId),
        eq(teamMemberships.status, "active")
      )
    )
    .leftJoin(
      persons,
      and(
        eq(persons.id, teamMemberships.personId),
        isNull(persons.deletedAt),
        eq(persons.churchId, churchId)
      )
    )
    .where(selectableTeamsScope(churchId))
    .groupBy(ministryTeams.id, ministryTeams.name, ministryTeams.sortOrder)
    .orderBy(...selectableTeamsOrder);

  return rows.map(({ id, name, memberCount }) => ({
    id,
    name,
    selector: teamGroup(id),
    memberCount,
  }));
}
