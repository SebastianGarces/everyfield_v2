import { createHash } from "node:crypto";

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { persons, type Person } from "@/db/schema";
import type { EvryAuditKey } from "@/lib/evry/audit/identity";
import type { EvryEffectInput, EvryEffectResult } from "@/lib/evry/executor";
import {
  deleteFile,
  getExtensionFromMimeType,
  listFileObjects,
  personPhotoStorageKey,
  type StoredFileObject,
  uploadFile,
} from "@/lib/storage";

import {
  claimEvryPeopleEffect,
  recoverCompletedEvryPeopleEffect,
} from "./evry-effect";
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

function digestForPersonPhoto(photoKey: string | null): string | null {
  return photoKey ? createHash("sha256").update(photoKey).digest("hex") : null;
}

/**
 * The closed Evry-facing view of a private person-photo key. Capability code
 * may bind a plan to the digest and whether an image exists, but the storage
 * locator never leaves this module.
 */
export async function getEvryPersonPhotoSnapshot(
  churchId: string,
  personId: string
): Promise<Readonly<{ digest: string | null; present: boolean }> | null> {
  const current = await getPersonPhotoKey(churchId, personId);
  return current
    ? {
        digest: digestForPersonPhoto(current.photoKey),
        present: current.photoKey !== null,
      }
    : null;
}

function uuidFromPhotoIdentity(value: string): string {
  const hex = createHash("sha256")
    .update(value)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "4";
  hex[16] = ["8", "9", "a", "b"][Number.parseInt(hex[16]!, 16) % 4]!;
  const joined = hex.join("");
  return `${joined.slice(0, 8)}-${joined.slice(8, 12)}-${joined.slice(12, 16)}-${joined.slice(16, 20)}-${joined.slice(20)}`;
}

type EvryPhotoEffectIdentity = Pick<EvryEffectInput, "execution"> & {
  effectKey: EvryAuditKey;
};

export type EvryPersonPhotoMutation =
  | Readonly<{ kind: "remove" }>
  | Readonly<{
      kind: "upload";
      attachmentDigest: string;
      bytes: Buffer;
      contentType: "image/jpeg" | "image/jpg" | "image/png" | "image/webp";
    }>;

export type EvryPersonPhotoStorageEffects = Readonly<{
  store(key: string, bytes: Buffer, contentType: string): Promise<unknown>;
  remove(key: string): Promise<unknown>;
  list(prefix: string): Promise<readonly StoredFileObject[]>;
}>;

export const EVRY_FINAL_OBJECT_GRACE_MS = 60 * 60_000;

const LIVE_EVRY_PHOTO_STORAGE: EvryPersonPhotoStorageEffects = {
  store: uploadFile,
  remove: deleteFile,
  list: listFileObjects,
};

/**
 * Remove every no-longer-referenced object below one exact tenant/person
 * prefix. The database pointer is loaded first and is never deleted. Failed
 * deletes remain discoverable by the next terminal cleanup or operator sweep.
 */
export async function sweepEvryPersonPhotoObjects(input: {
  plantId: string;
  personId: string;
  storage?: EvryPersonPhotoStorageEffects;
  load?: typeof getPersonPhotoKey;
  now?: Date;
}): Promise<Readonly<{ removed: number; failed: number }>> {
  const storage = input.storage ?? LIVE_EVRY_PHOTO_STORAGE;
  const load = input.load ?? getPersonPhotoKey;
  const prefix = `people/${input.plantId}/${input.personId}/`;
  const objects = await storage.list(prefix);
  const cutoff =
    (input.now ?? new Date()).getTime() - EVRY_FINAL_OBJECT_GRACE_MS;
  let removed = 0;
  let failed = 0;
  for (const object of objects) {
    if (
      !object.key.startsWith(prefix) ||
      !object.lastModified ||
      object.lastModified.getTime() > cutoff
    )
      continue;
    try {
      // Every legitimate writer stores/refreshes the object before naming it.
      // The grace fence plus this last-moment reference read prevents a sweep
      // selected before that write from deleting its newly current object.
      const current = await load(input.plantId, input.personId);
      if (current?.photoKey === object.key) continue;
      await storage.remove(object.key);
      removed += 1;
    } catch {
      failed += 1;
    }
  }
  return { removed, failed };
}

/** Hourly backstop for final photo objects whose terminal replay never ran. */
export async function sweepAllEvryPersonPhotoObjects(
  input: {
    now?: Date;
    list?: typeof listFileObjects;
    remove?: typeof deleteFile;
    load?: typeof getPersonPhotoKey;
  } = {}
): Promise<Readonly<{ removed: number; failed: number }>> {
  const objects = await (input.list ?? listFileObjects)("people/");
  const scopes = new Map<string, { plantId: string; personId: string }>();
  for (const { key } of objects) {
    const match =
      /^people\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/i.exec(
        key
      );
    if (!match) continue;
    const [, plantId, personId] = match;
    scopes.set(`${plantId}:${personId}`, {
      plantId: plantId!,
      personId: personId!,
    });
  }
  let removed = 0;
  let failed = 0;
  for (const scope of scopes.values()) {
    const result = await sweepEvryPersonPhotoObjects({
      ...scope,
      now: input.now,
      load: input.load,
      storage: {
        store: async () => undefined,
        list: async (prefix) =>
          objects.filter(({ key }) => key.startsWith(prefix)),
        remove: input.remove ?? deleteFile,
      },
    });
    removed += result.removed;
    failed += result.failed;
  }
  return { removed, failed };
}

/**
 * Claim one exact Evry photo change through the same single writer as the
 * owning interface. The object is stored first, the row changes only inside
 * the durable effect claim, and the old object is removed only after the row
 * no longer names it. Replays return the durable outcome before storage work.
 */
export async function claimEvryPersonPhotoMutation(
  input: EvryPhotoEffectIdentity & {
    personId: string;
    expectedDigest: string | null;
    mutation: EvryPersonPhotoMutation;
    storage?: EvryPersonPhotoStorageEffects;
    recover?: typeof recoverCompletedEvryPeopleEffect;
    load?: typeof getPersonPhotoKey;
    claim?: typeof claimEvryPeopleEffect;
  }
): Promise<EvryEffectResult> {
  const recover = input.recover ?? recoverCompletedEvryPeopleEffect;
  const load = input.load ?? getPersonPhotoKey;
  const replay = await recover(input);
  if (replay) return replay;

  const current = await load(input.execution.plantId, input.personId);
  if (
    !current ||
    digestForPersonPhoto(current.photoKey) !== input.expectedDigest
  )
    return { status: "refused", excludedCount: 1 };

  const nextPhotoKey =
    input.mutation.kind === "remove"
      ? null
      : personPhotoStorageKey(
          input.execution.plantId,
          input.personId,
          getExtensionFromMimeType(input.mutation.contentType),
          uuidFromPhotoIdentity(
            `${input.effectKey}:${input.mutation.attachmentDigest}`
          )
        );
  if (input.mutation.kind === "upload") {
    await (input.storage ?? LIVE_EVRY_PHOTO_STORAGE).store(
      nextPhotoKey!,
      input.mutation.bytes,
      input.mutation.contentType
    );
  }

  let result: EvryEffectResult;
  try {
    result = await (input.claim ?? claimEvryPeopleEffect)({
      ...input,
      mutation: sql`
        update persons p set photo_url = ${nextPhotoKey},
          updated_at = transaction_timestamp()
        from eligible e
        where p.id = ${input.personId}::uuid and p.church_id = e.church_id
          and p.deleted_at is null
          and p.photo_url is not distinct from ${current.photoKey}
        returning 1 as affected_count, 0 as excluded_count
      `,
      targetIsCurrent: async () => {
        const latest = await load(input.execution.plantId, input.personId);
        return (
          latest !== null &&
          digestForPersonPhoto(latest.photoKey) === input.expectedDigest
        );
      },
    });
  } catch (error) {
    if (input.mutation.kind === "upload") {
      try {
        const [durable, latest] = await Promise.all([
          recover(input),
          load(input.execution.plantId, input.personId),
        ]);
        if (durable) return durable;
        if (latest?.photoKey === nextPhotoKey) return { status: "retryable" };
        await (input.storage ?? LIVE_EVRY_PHOTO_STORAGE).remove(nextPhotoKey!);
      } catch {
        // Outcome reconciliation itself is uncertain. Preserve the object so
        // same-key replay can recover a committed pointer without data loss.
        return { status: "retryable" };
      }
    }
    throw error;
  }

  if (result.status !== "completed" && input.mutation.kind === "upload") {
    try {
      await (input.storage ?? LIVE_EVRY_PHOTO_STORAGE).remove(nextPhotoKey!);
    } catch (error) {
      console.error(
        "[evry:people] failed to clean up an unclaimed photo object:",
        error
      );
    }
  }

  if (
    result.status === "completed" &&
    current.photoKey &&
    current.photoKey !== nextPhotoKey
  ) {
    try {
      await (input.storage ?? LIVE_EVRY_PHOTO_STORAGE).remove(current.photoKey);
    } catch (error) {
      console.error(
        "[evry:people] failed to delete replaced photo object:",
        error
      );
    }
  }
  return result;
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
