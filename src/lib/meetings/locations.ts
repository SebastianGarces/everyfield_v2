import { db } from "@/db";
import { locations, type Location, type NewLocation } from "@/db/schema";
import type {
  LocationCreateInput,
  LocationUpdateInput,
} from "@/lib/validations/meetings";
import { and, asc, eq } from "drizzle-orm";

// ============================================================================
// Queries
// ============================================================================

/**
 * List all active locations for a church, ordered by name.
 */
export async function listLocations(churchId: string): Promise<Location[]> {
  return db
    .select()
    .from(locations)
    .where(
      and(eq(locations.churchId, churchId), eq(locations.isActive, true))
    )
    .orderBy(asc(locations.name));
}

/**
 * Get a single location by ID.
 * Returns null if not found or if it belongs to a different church.
 */
export async function getLocation(
  churchId: string,
  locationId: string
): Promise<Location | null> {
  const result = await db
    .select()
    .from(locations)
    .where(
      and(eq(locations.churchId, churchId), eq(locations.id, locationId))
    )
    .limit(1);

  return result[0] ?? null;
}

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a new location for a church.
 */
export async function createLocation(
  churchId: string,
  data: LocationCreateInput
): Promise<Location> {
  const values: NewLocation = {
    churchId,
    name: data.name,
    address: data.address,
    contactName: data.contactName ?? null,
    contactPhone: data.contactPhone ?? null,
    contactEmail: data.contactEmail || null,
    cost: data.cost ?? null,
    capacity: data.capacity ?? null,
    notes: data.notes ?? null,
  };

  const [location] = await db.insert(locations).values(values).returning();

  return location;
}

/**
 * Update an existing location.
 * Only provided fields are updated.
 */
export async function updateLocation(
  churchId: string,
  locationId: string,
  data: LocationUpdateInput
): Promise<Location> {
  const existing = await getLocation(churchId, locationId);
  if (!existing) {
    throw new Error("Location not found");
  }

  const updateData: Partial<NewLocation> & { updatedAt: Date } = {
    updatedAt: new Date(),
  };

  if (data.name !== undefined) updateData.name = data.name;
  if (data.address !== undefined) updateData.address = data.address;
  if (data.contactName !== undefined) updateData.contactName = data.contactName;
  if (data.contactPhone !== undefined)
    updateData.contactPhone = data.contactPhone;
  if (data.contactEmail !== undefined)
    updateData.contactEmail = data.contactEmail || null;
  if (data.cost !== undefined) updateData.cost = data.cost;
  if (data.capacity !== undefined) updateData.capacity = data.capacity;
  if (data.notes !== undefined) updateData.notes = data.notes;

  const [updated] = await db
    .update(locations)
    .set(updateData)
    .where(
      and(eq(locations.churchId, churchId), eq(locations.id, locationId))
    )
    .returning();

  if (!updated) {
    throw new Error("Failed to update location");
  }

  return updated;
}

/**
 * Soft-deactivate a location by setting `isActive` to false.
 * The location remains in the database for historical reference.
 */
export async function deactivateLocation(
  churchId: string,
  locationId: string
): Promise<void> {
  const existing = await getLocation(churchId, locationId);
  if (!existing) {
    throw new Error("Location not found");
  }

  await db
    .update(locations)
    .set({ isActive: false, updatedAt: new Date() })
    .where(
      and(eq(locations.churchId, churchId), eq(locations.id, locationId))
    );
}
