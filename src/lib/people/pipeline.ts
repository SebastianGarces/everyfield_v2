import { db } from "@/db";
import {
  persons,
  personTags,
  tags,
  type PersonStatus,
  type Tag,
} from "@/db/schema";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { PersonWithTags, PipelineColumn, PipelineData } from "./types";

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
    id: "committed",
    title: "Committed",
    statuses: ["committed"],
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
  // Query all non-deleted people for the church
  const peopleRows = await db
    .select({
      id: persons.id,
      churchId: persons.churchId,
      firstName: persons.firstName,
      lastName: persons.lastName,
      email: persons.email,
      phone: persons.phone,
      addressLine1: persons.addressLine1,
      addressLine2: persons.addressLine2,
      city: persons.city,
      state: persons.state,
      postalCode: persons.postalCode,
      country: persons.country,
      status: persons.status,
      source: persons.source,
      sourceDetails: persons.sourceDetails,
      notes: persons.notes,
      photoUrl: persons.photoUrl,
      householdId: persons.householdId,
      householdRole: persons.householdRole,
      createdBy: persons.createdBy,
      createdAt: persons.createdAt,
      updatedAt: persons.updatedAt,
      pipelineSortOrder: persons.pipelineSortOrder,
      deletedAt: persons.deletedAt,
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

  // Build PersonWithTags array
  const peopleWithTags: PersonWithTags[] = peopleRows.map((person) => ({
    ...person,
    tags: personTagsMap.get(person.id) ?? [],
  }));

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
