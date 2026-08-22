import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { profilePhotoRefusal } from "@/lib/profile-photo";
import {
  deleteFile,
  getExtensionFromMimeType,
  getFileBytes,
  uploadFile,
  userAvatarStorageKey,
} from "@/lib/storage";

// ============================================================================
// THE ACCOUNT'S PROFILE PICTURE — upload, replace, remove (CS-004, #617).
//
// ----------------------------------------------------------------------------
// P-024, ONE FLOOR DOWN
// ----------------------------------------------------------------------------
//
// The person photo (`memory/invariants.md` → Person Photos) settled how a
// picture behaves in this product, and none of it is person-specific:
//
//   * `users.avatar_key` holds a PRIVATE-BUCKET KEY, and the only address a
//     browser gets is a session-checked route.
//   * `setUserAvatar` is the ONE writer of that column. A REMOVAL IS THAT SAME
//     WRITER WITH A NULL KEY, never a writer of its own.
//   * The object goes UP before the row points at it, and the old object comes
//     DOWN after the row stops. The two failures are not symmetrical: an object
//     no row names is garbage a sweep collects, while a row naming an object
//     that is gone is a picture the route answers 404 for and nothing inside the
//     app can repair.
//   * So the delete lives INSIDE the writer rather than in its callers — no
//     caller can forget the tail, and none can hoist a `deleteFile` above the
//     row write instead.
//
// ----------------------------------------------------------------------------
// WHY THE LOGIC IS HERE AND NOT IN THE ACTION
// ----------------------------------------------------------------------------
//
// The same reason `email-change.ts` and `password-change.ts` sit beside this
// file: an ordering rule that is only ever asserted by READING the source is not
// asserted. Reversing two lines still compiles, still typechecks, and still
// looks right in review. `avatar.test.ts` RUNS these functions against forced
// failures instead, which needs them importable without `"use server"` dragging
// `next/cache` into a bare node:test process.
//
// The action above is then what it should be: the guard, this call, and a
// `refresh()`.
//
// ----------------------------------------------------------------------------
// WHOSE PICTURE IS NOT AN ARGUMENT
// ----------------------------------------------------------------------------
//
// Every entry point takes an `actor` — the row `requireSeat` minted from the
// session cookie — and never a user id a caller chose (`memory/invariants.md` →
// Authentication). There is no church scope to check here and no `personId` to
// forge: the account being written IS the account signed in, as a property of
// the signature rather than as a check somebody could delete.
// ============================================================================

/** The account a picture belongs to, narrowed to what these functions read. */
export type AvatarActor = { id: string };

export type AvatarOutcome =
  | { ok: true; avatarKey: string | null }
  | { ok: false; message: string };

/**
 * The three effects `setUserAvatar` sequences, injectable so the ordering
 * contract can be asserted by RUNNING the function against a forced failure
 * instead of by reading its source — the same seam `setPersonPhoto` and
 * `recordGeneratedDocument` carry, for the same invariant. Production never
 * passes this; the defaults below are the real point read, the real update and
 * the real bucket.
 */
export type UserAvatarEffects = {
  /** The key the row holds RIGHT NOW, or `null`. `undefined` means no such account. */
  load: (userId: string) => Promise<string | null | undefined>;
  write: (userId: string, key: string | null) => Promise<boolean>;
  upload: (key: string, body: Buffer, contentType: string) => Promise<unknown>;
  remove: (key: string) => Promise<unknown>;
};

const LIVE_AVATAR_EFFECTS: UserAvatarEffects = {
  load: async (userId) => {
    const [row] = await db
      .select({ avatarKey: users.avatarKey })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return row?.avatarKey;
  },
  write: async (userId, key) => {
    const updated = await db
      .update(users)
      .set({ avatarKey: key, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning({ id: users.id });

    return updated.length > 0;
  },
  upload: uploadFile,
  remove: deleteFile,
};

/**
 * Point an account at a stored picture, or at none.
 *
 * THE ONE WRITER OF `users.avatar_key`, and the only place the P-024 ordering is
 * spelled. `key` is always one `userAvatarStorageKey` just built on this server,
 * or `null` — never a value that arrived from a client, because the route that
 * serves a picture trusts the stored key precisely because nothing
 * client-supplied can reach it.
 *
 * The previous key is read HERE rather than taken from the caller's session row,
 * so the value the row is about to lose and the object about to be deleted come
 * from one read. Accepted residual, and it is the same one the person path
 * carries: two replacements racing each other can leave ONE stranded object,
 * because the read and the write are not one statement. Stranded is the safe
 * side of this asymmetry — the row always names an object that exists.
 *
 * The removal is last and its failure is LOGGED, never propagated: the row has
 * already landed, so throwing here would report a change the reader can see
 * happened as a failure.
 */
export async function setUserAvatar(
  userId: string,
  key: string | null,
  effects: UserAvatarEffects = LIVE_AVATAR_EFFECTS
): Promise<boolean> {
  const previous = await effects.load(userId);
  if (previous === undefined) return false;

  const written = await effects.write(userId, key);
  if (!written) return false;

  // The row has stopped naming it, so it is now garbage rather than a picture.
  if (previous && previous !== key) {
    try {
      await effects.remove(previous);
    } catch (error) {
      console.error(
        "[account] failed to delete replaced avatar object:",
        error
      );
    }
  }

  return true;
}

/**
 * Take a chosen file and make it this account's picture (CS-004).
 *
 * THE GATE IS `profilePhotoRefusal`, called on what was actually received. The
 * picker calls the same function before it sends, but that call is a courtesy to
 * the reader, not a check: a POST that never saw a picker meets the rule for the
 * first time right here.
 *
 * THE UPLOAD COMES BEFORE `setUserAvatar`, which is the front half of the P-024
 * ordering — the object exists before any row names it. A failed upload
 * therefore changes nothing at all, and the account keeps the picture it had.
 */
export async function uploadUserAvatar(
  {
    actor,
    file,
  }: {
    actor: AvatarActor;
    file: {
      type: string;
      size: number;
      arrayBuffer: () => Promise<ArrayBuffer>;
    };
  },
  effects: UserAvatarEffects = LIVE_AVATAR_EFFECTS
): Promise<AvatarOutcome> {
  const refusal = profilePhotoRefusal(file);
  if (refusal) {
    return { ok: false, message: refusal };
  }

  const key = userAvatarStorageKey(
    actor.id,
    getExtensionFromMimeType(file.type)
  );

  await effects.upload(key, Buffer.from(await file.arrayBuffer()), file.type);

  if (!(await setUserAvatar(actor.id, key, effects))) {
    return { ok: false, message: "We could not save that picture" };
  }

  return { ok: true, avatarKey: key };
}

/**
 * Drop this account's picture, so the initials render in its place (CS-004).
 *
 * The same writer as the upload with a null key — NOT a second writer — which is
 * what makes the ordering impossible to get wrong from here. There is nothing
 * to guard against a caller who has no picture: the writer deletes nothing when
 * the row named nothing, so a removal repeated is a removal.
 */
export async function removeUserAvatar(
  actor: AvatarActor,
  effects: UserAvatarEffects = LIVE_AVATAR_EFFECTS
): Promise<AvatarOutcome> {
  if (!(await setUserAvatar(actor.id, null, effects))) {
    return { ok: false, message: "We could not remove that picture" };
  }

  return { ok: true, avatarKey: null };
}

// ============================================================================
// The read
// ============================================================================

/**
 * What a stored key answers with — the body of `GET /api/account/avatar`, minus
 * the session check that route does first.
 *
 * SPLIT FROM THE ROUTE SO IT CAN BE RUN. A route module may export nothing but
 * its HTTP verbs and Next's config keys, so a test that wanted the response
 * shape would have to import the handler whole and stand up a session and a
 * bucket to reach it. What is actually worth asserting — bytes come back with
 * the stored object's own content type, a missing object is a 404 rather than a
 * 500, and the cache header is PRIVATE — needs neither, so it lives here where a
 * test can hand in its own reader.
 *
 * A NULL KEY AND A MISSING OBJECT ANSWER THE SAME 404, deliberately. Both mean
 * "no picture to show" to the only caller there is, and the initials fallback is
 * what renders for either. The second case is the half-failed replacement P-024
 * tolerates: the row names an object the bucket no longer has, and a 404 makes
 * that a fallback rather than a broken image.
 */
export async function readAvatar(
  avatarKey: string | null | undefined,
  readBytes: (
    key: string
  ) => Promise<{ body: Uint8Array; contentType: string } | null> = getFileBytes
): Promise<Response> {
  const file = avatarKey ? await readBytes(avatarKey) : null;

  if (!file) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return new Response(Buffer.from(file.body), {
    headers: {
      "Content-Type": file.contentType,
      // PRIVATE, and revalidated every time. A profile picture is personal data
      // behind a session check: a shared cache holding it would serve one
      // account's face from another account's request.
      "Cache-Control": "private, no-cache, must-revalidate",
    },
  });
}
