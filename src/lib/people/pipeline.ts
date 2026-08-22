import { db } from "@/db";
import {
  personActivities,
  persons,
  personTags,
  tags,
  type PersonStatus,
  type Tag,
} from "@/db/schema";
import {
  and,
  asc,
  eq,
  getTableColumns,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import {
  toPersonForClient,
  type PersonWithTags,
  type PipelineColumn,
  type PipelineData,
} from "./types";

// ============================================================================
// Pipeline Column Definitions
// ============================================================================

/**
 * Pipeline column configuration
 * Each column aggregates one or more person statuses
 */
type PipelineColumnDef = {
  id: string;
  title: string;
  statuses: PersonStatus[];
};

const PIPELINE_COLUMNS: PipelineColumnDef[] = [
  {
    id: "prospect",
    title: "Prospect",
    statuses: ["prospect"],
  },
  {
    id: "attendee",
    title: "Attendee",
    statuses: ["attendee"],
  },
  {
    id: "following_up",
    title: "Following Up",
    statuses: ["following_up"],
  },
  {
    id: "interviewed",
    title: "Interviewed",
    statuses: ["interviewed"],
  },
  {
    id: "core_group",
    title: "Core Group",
    statuses: ["core_group", "launch_team", "leader"],
  },
];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the column ID for a given person status
 */
function getColumnIdForStatus(status: PersonStatus): string {
  const column = PIPELINE_COLUMNS.find((col) => col.statuses.includes(status));
  return column?.id ?? "prospect";
}

// ============================================================================
// Pipeline Queries
// ============================================================================

/**
 * Get pipeline data grouped by status columns
 * Returns all non-deleted people for the church, grouped into pipeline columns
 * Includes tags for each person
 */
export async function getPipelineData(churchId: string): Promise<PipelineData> {
  // Query all non-deleted people for the church, with last activity timestamp
  const lastActivitySubquery = sql<Date | null>`(
    SELECT MAX(${personActivities.createdAt})
    FROM ${personActivities}
    WHERE ${personActivities.personId} = ${persons.id}
  )`;

  const peopleRows = await db
    .select({
      // EVERY COLUMN, and the strip below is what makes that safe (#654).
      //
      // This used to be a hand-typed list of 25 columns whose whole job was to
      // leave `user_id` out — a second spelling of a decision `toPersonForClient`
      // already owns, and one that had to be re-read every time `persons` grew a
      // column. A projection that omits a column silently and a strip that
      // removes one deliberately look identical in a diff; only one of them says
      // why. So the query asks for the row and the boundary narrows it, which is
      // what every other read in this domain does.
      ...getTableColumns(persons),
      lastActivityAt: lastActivitySubquery,
    })
    .from(persons)
    .where(and(eq(persons.churchId, churchId), isNull(persons.deletedAt)))
    .orderBy(asc(persons.pipelineSortOrder), asc(persons.createdAt));

  // Get all person IDs
  const personIds = peopleRows.map((p) => p.id);

  // Query tags for all people in a single query (avoiding N+1)
  const personTagsMap: Map<string, Tag[]> = new Map();

  if (personIds.length > 0) {
    const tagRows = await db
      .select({
        personId: personTags.personId,
        tag: {
          id: tags.id,
          churchId: tags.churchId,
          name: tags.name,
          color: tags.color,
          createdAt: tags.createdAt,
        },
      })
      .from(personTags)
      .innerJoin(tags, eq(personTags.tagId, tags.id))
      .where(
        and(
          inArray(personTags.personId, personIds),
          eq(tags.churchId, churchId) // Enforce tenant isolation on tags
        )
      );

    // Group tags by person ID
    for (const row of tagRows) {
      const existing = personTagsMap.get(row.personId) ?? [];
      existing.push(row.tag);
      personTagsMap.set(row.personId, existing);
    }
  }

  // Build PersonWithTags array. `PipelineView` is a client component, so this
  // map IS the boundary: the strip drops the account link (#378) and trades the
  // photo key for its route (#654) in one pass, decorations and all.
  const peopleWithTags: PersonWithTags[] = peopleRows.map((person) =>
    toPersonForClient({
      ...person,
      tags: personTagsMap.get(person.id) ?? [],
    })
  );

  // Group people by column
  const peopleByColumn: Record<string, PersonWithTags[]> = {};

  // Initialize empty arrays for each column
  for (const column of PIPELINE_COLUMNS) {
    peopleByColumn[column.id] = [];
  }

  // Group people into columns based on their status
  for (const person of peopleWithTags) {
    const columnId = getColumnIdForStatus(person.status);
    peopleByColumn[columnId].push(person);
  }

  // Build columns with counts
  const columns: PipelineColumn[] = PIPELINE_COLUMNS.map((colDef) => ({
    id: colDef.id,
    title: colDef.title,
    statuses: colDef.statuses,
    count: peopleByColumn[colDef.id].length,
  }));

  return {
    columns,
    people: peopleByColumn,
  };
}

/**
 * Export pipeline column definitions for use in components
 */
export { PIPELINE_COLUMNS };
