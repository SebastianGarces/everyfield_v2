// ============================================================================
// THE WHOLE PICTURE PATH, END TO END, AGAINST THE REAL BUCKET (#617, CS-004).
//
// The unit tests run the ordering against forced failures and the route tests
// run the response shape against a fake reader. Neither one proves the chain:
// that bytes chosen on one side come back out of the route on the other, that
// the row and the object agree about which key that is, and that a removal
// actually empties the bucket rather than only the column.
//
// So this does the real thing. A real S3 PUT to the configured bucket, a real
// row in a real Postgres, the real `readAvatar` reading the real object back,
// and a real DELETE — then it checks the bucket directly to prove the object is
// gone. The only thing it cannot do is click, which is what the browser gate is
// for.
//
// WHAT IT TOUCHES, AND WHY THAT IS SAFE:
//   · A SCRATCH DATABASE it creates from `live_template` and drops at the end.
//     Never the dev database, and never a suite's.
//   · Objects under `avatars/{a fresh uuid}/` in the real bucket. It deletes
//     them itself — that deletion IS one of the assertions — and the `finally`
//     sweeps anything a mid-run failure left behind.
//
//   ./scripts/live-db-stack.sh up          # once, if the stack is not running
//   pnpm tsx --env-file-if-exists=.env.local scripts/prove-avatar-roundtrip.ts
// ============================================================================

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import { neonConfig } from "@neondatabase/serverless";

const PG_CONTAINER = process.env.LIVE_DB_PG_CONTAINER ?? "everyfield-live-pg";
const TEMPLATE = process.env.LIVE_DB_TEMPLATE ?? "live_template";
const SCRATCH = "avatar_roundtrip_proof";
const PROXY = process.env.NEON_HTTP_PROXY_URL ?? "http://localhost:4444/sql";

function psql(database: string, sql: string): string {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      PG_CONTAINER,
      "psql",
      "-U",
      "postgres",
      "-d",
      database,
      "-v",
      "ON_ERROR_STOP=1",
      "-t",
      "-A",
      "-c",
      sql,
    ],
    { encoding: "utf8" }
  ).trim();
}

// A 1x1 PNG — the smallest thing that is honestly an image.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/**
 * The PNG as a standalone `ArrayBuffer`, the way a `File` would hand one over.
 *
 * NOT `PNG.buffer`. Node allocates small Buffers out of a SHARED POOL, so that
 * property is an 8KB arena with this image somewhere inside it — passing it
 * uploads the pool and the round trip comes back byte-for-byte different. This
 * script found that the honest way, by comparing what came out against what
 * went in, which is the entire reason it compares them.
 */
function pngArrayBuffer(): ArrayBuffer {
  return PNG.buffer.slice(
    PNG.byteOffset,
    PNG.byteOffset + PNG.byteLength
  ) as ArrayBuffer;
}

function pngFile() {
  return {
    type: "image/png",
    size: PNG.byteLength,
    arrayBuffer: async () => pngArrayBuffer(),
  };
}

async function main() {
  // The scratch database, copied from the template the migrations were applied
  // to — so `users` here is the schema this branch ships, 0064 included.
  psql("postgres", `DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
  psql("postgres", `CREATE DATABASE ${SCRATCH} TEMPLATE ${TEMPLATE}`);

  // Deliberately, and only here: send neon-http at the local proxy and name the
  // scratch database. `src/db/index.ts` reads DATABASE_URL on first import, so
  // both must land BEFORE the dynamic imports below.
  neonConfig.fetchEndpoint = PROXY;
  process.env.DATABASE_URL = `postgresql://postgres:postgres@localhost:55432/${SCRATCH}`;

  const { db } = await import("../src/db");
  const { users } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const { readAvatar, removeUserAvatar, uploadUserAvatar } =
    await import("../src/lib/auth/avatar");
  const { getFileBytes } = await import("../src/lib/storage");
  const { userAvatarSrc } = await import("../src/lib/profile-photo");

  const [actor] = await db
    .insert(users)
    .values({
      email: `avatar-proof-${randomUUID()}@example.test`,
      passwordHash: "not-a-real-hash",
      name: "Avatar Proof",
    })
    .returning();

  const keys: string[] = [];

  try {
    // ---- 1. An account starts with no picture -----------------------------
    assert.equal(actor.avatarKey, null, "a new account holds no key");
    assert.equal(
      (await readAvatar(actor.avatarKey)).status,
      404,
      "no picture answers 404, which is what renders the initials"
    );

    // ---- 2. Upload puts real bytes in the real bucket ----------------------
    const first = await uploadUserAvatar({
      actor,
      file: pngFile(),
    });
    assert.equal(first.ok, true, "the upload was refused");
    assert.ok(first.ok && first.avatarKey);
    keys.push(first.avatarKey);
    console.log(`==> uploaded ${first.avatarKey}`);

    const storedKey = async () =>
      (
        await db
          .select({ key: users.avatarKey })
          .from(users)
          .where(eq(users.id, actor.id))
      )[0].key;

    assert.equal(
      await storedKey(),
      first.avatarKey,
      "the row must name the object the upload just stored"
    );

    // ---- 3. The route hands those exact bytes back ------------------------
    const served = await readAvatar(await storedKey());
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("Content-Type"), "image/png");
    assert.match(served.headers.get("Cache-Control") ?? "", /private/);
    assert.deepEqual(
      Buffer.from(await served.arrayBuffer()),
      PNG,
      "the bytes that came back are not the bytes that went in"
    );
    console.log(`==> served ${PNG.byteLength} bytes back through the route`);

    // The address the browser is given carries no key and no bucket path.
    const src = userAvatarSrc(await storedKey());
    assert.ok(src, "a stored key must resolve to a route");
    assert.ok(src.startsWith("/api/account/avatar?v="));
    assert.ok(!src.includes("avatars/"), "the key rode to the browser");

    // ---- 4. Replace: new object, old one collected ------------------------
    const replaced = await uploadUserAvatar({
      actor,
      file: pngFile(),
    });
    assert.ok(replaced.ok && replaced.avatarKey);
    keys.push(replaced.avatarKey);
    assert.notEqual(
      replaced.avatarKey,
      first.avatarKey,
      "a replacement must be a NEW object, or the browser keeps the old face"
    );
    assert.equal(await storedKey(), replaced.avatarKey);
    assert.equal(
      await getFileBytes(first.avatarKey),
      null,
      "the object the row stopped naming is still in the bucket — P-024's delete tail did not run"
    );
    console.log(`==> replaced; the old object is gone from the bucket`);

    // ---- 5. Remove: the column empties AND the object goes -----------------
    const removed = await removeUserAvatar({ actor });
    assert.equal(removed.ok, true);
    assert.equal(await storedKey(), null, "the column still names an object");
    assert.equal(
      await getFileBytes(replaced.avatarKey),
      null,
      "the removal emptied the column but left the bytes in the bucket"
    );
    assert.equal(
      (await readAvatar(await storedKey())).status,
      404,
      "after a removal the route must 404 so the initials render"
    );
    console.log(`==> removed; column NULL and the object is gone`);

    // ---- 6. The gate refuses a non-image before the bucket sees it ---------
    const refused = await uploadUserAvatar({
      actor,
      file: { ...pngFile(), type: "application/pdf", size: 1024 },
    });
    assert.equal(refused.ok, false);
    assert.equal(await storedKey(), null, "a refused upload changed the row");
    console.log(`==> a PDF was refused: ${!refused.ok && refused.message}`);

    console.log("\nPASS — upload, serve, replace, remove, refuse.");
  } finally {
    // Anything a mid-run failure stranded. Deleting an object that is already
    // gone is not an error, so this is safe to run on the happy path too.
    const { deleteFile } = await import("../src/lib/storage");
    for (const key of keys) {
      await deleteFile(key).catch(() => {});
    }
    await db.delete(users).where(eq(users.id, actor.id));
    psql("postgres", `DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
