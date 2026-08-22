import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { persons, type Person } from "@/db/schema";
import { deleteFile } from "@/lib/storage";

import { toPersonForClient, type PersonForClient } from "./types";

// ============================================================================
// `persons.photo_url` — THE WHOLE BUSINESS OF THE COLUMN (P-024a, P-024b, #654).
//
// ITS OWN MODULE, mirroring `src/lib/auth/avatar.ts` next door, and the reason
// is a fence rather than tidiness. `picture-key-boundary.test.ts` asks where a
// storage key may be NAMED at all, and its answer has to be narrow enough to
// mean something. While these three lived in `service.ts` the answer was "any
// of that module's 700 lines, including its ten client-facing reads" — so a
// `return { ...person, photoUrl }` added to any of them passed the fence in
// silence, while the identical mistake in `auth/avatar.ts` failed. The person
// half was fenced strictly weaker than the account half, which is the opposite
// of what P-024 says about its two subjects.
//
// So the column's read, its writer and its effects seam sit here, `service.ts`
// names the key nowhere at all, and both halves of P-024 are fenced the same
// way: one small module each, and nothing else in the tree may say the word.
// ============================================================================

/**
 * The stored photo KEY for a person in this church, or `null` when there is no
 * such person. A person who simply has no photo answers `{ photoKey: null }`.
 *
 * THE ONE READ OF `photo_url`, and the reason `getPerson` no longer offers it
 * (#654). That read hands its row straight to `"use client"`
 * components, so `toPersonForClient` trades the key for the route it resolves
 * to — and the two callers that genuinely need the KEY ask for it by name here
 * instead. Both are server-only and both are the key's whole business: the
 * photo route, which turns one into pixels, and `setPersonPhoto`, which needs
 * the OLD key to know which object to drop.
 *
 * TWO NULLS, NOT ONE, and `setPersonPhoto` is the caller that needs them apart.
 * It must NOT write for a person the church does not own, and it MUST write for
 * a person of ours who has no photo yet — a bare `string | null` cannot tell
 * those two apart, so the first upload of every photo would look like a
 * cross-tenant write and be refused.
 *
 * The ROUTE collapses them again on purpose, and that is not the same thing:
 * `storedImageResponse` answers one 404 for a null key and for an object the
 * bucket no longer has, so "not your person" and "no photo" are deliberately
 * indistinguishable to a browser. Keeping them apart HERE is what lets the
 * route choose to.
 *
 * CHURCH-SCOPED like every other read here, so a foreign `personId` reads as
 * MISSING rather than forbidden — the same answer a person with no photo gets,
 * and the same shape the generated-documents read uses.
 */
export async function getPersonPhotoKey(
  churchId: string,
  personId: string
): Promise<{ photoKey: string | null } | null> {
  const [row] = await db
    .select({ photoKey: persons.photoUrl })
    .from(persons)
    .where(
      and(
        eq(persons.churchId, churchId),
        eq(persons.id, personId),
        isNull(persons.deletedAt)
      )
    )
    .limit(1);

  return row ?? null;
}

/**
 * The three effects `setPersonPhoto` sequences, injectable so the ordering
 * contract can be asserted by RUNNING the function against a forced failure
 * instead of by reading its source — the same seam `recordGeneratedDocument`
 * carries, for the same invariant. Production never passes this; the defaults
 * below are the church-scoped read, the church-scoped update and the real
 * bucket.
 */
export type PersonPhotoEffects = {
  /**
   * The OLD key, so the tail of the sequence knows what to drop — `null` when
   * there is no such person. Deliberately not `getPerson`: that read strips the
   * key on its way out (#654), and this is the one moment the writer needs it.
   */
  load: (
    churchId: string,
    personId: string
  ) => Promise<{ photoKey: string | null } | null>;
  write: (
    churchId: string,
    personId: string,
    key: string | null
  ) => Promise<Person | undefined>;
  remove: (key: string) => Promise<unknown>;
};

const LIVE_PHOTO_EFFECTS: PersonPhotoEffects = {
  load: getPersonPhotoKey,
  write: async (churchId, personId, key) => {
    const [updated] = await db
      .update(persons)
      .set({ photoUrl: key, updatedAt: new Date() })
      .where(
        and(
          eq(persons.churchId, churchId),
          eq(persons.id, personId),
          isNull(persons.deletedAt)
        )
      )
      .returning();

    return updated;
  },
  remove: deleteFile,
};

/**
 * Point a person at a stored photo object, or at none (P-024a, P-024b).
 *
 * THE ONE WRITER OF `photo_url`, and separate from `updatePerson` on purpose.
 * That function takes a `PersonUpdateInput` parsed out of the profile form's
 * `FormData` — a bag whose keys a POST chooses — so a photo field there would
 * be a client-supplied storage key, and the photo route trusts the stored key
 * precisely because nothing client-supplied can reach it. `key` here is always
 * one `personPhotoStorageKey` just built on this server, or `null`.
 *
 * A REMOVAL IS THIS WRITE WITH A NULL KEY, not a second writer, and the object
 * the row stops naming is dropped HERE rather than by the caller. Upload,
 * replace and remove therefore share ONE spelling of the ordering the invariant
 * demands — a caller cannot forget the tail, and cannot invent a `deleteFile`
 * above the row write instead.
 *
 * The ordering is the whole rule: an object no row names is garbage a sweep
 * collects, while a row naming an object that is gone is an avatar the photo
 * route answers 404 for and nothing inside the app can repair. So the removal
 * comes last and its failure is logged, never propagated — it must not fail a
 * write that has already landed.
 */
export async function setPersonPhoto(
  churchId: string,
  personId: string,
  key: string | null,
  effects: PersonPhotoEffects = LIVE_PHOTO_EFFECTS
): Promise<PersonForClient | null> {
  const existing = await effects.load(churchId, personId);
  if (!existing) return null;

  const updated = await effects.write(churchId, personId, key);
  if (!updated) return null;

  // The row has stopped naming it, so it is now garbage rather than an avatar.
  if (existing.photoKey && existing.photoKey !== key) {
    try {
      await effects.remove(existing.photoKey);
    } catch (error) {
      console.error("[people] failed to delete replaced photo object:", error);
    }
  }

  return toPersonForClient(updated);
}
