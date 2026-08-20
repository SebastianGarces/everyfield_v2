import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

import { users, type UserRole } from "@/db/schema";

// ============================================================================
// THE OVERSIGHT ADMIN CREDENTIAL WRITE (#304).
//
// The statement `--oversight-orgs-only` exists to run, and the two addresses it
// runs against — lifted out of `scripts/seed-dev-db.ts` so tests can assert
// them. The conflict clause is the invariant, and a conflict clause is a
// property of the emitted SQL, so `seed-account-writes.test.ts` renders this
// builder with `.toSQL()` rather than grepping the script's source. Same rule
// as `src/lib/wiki/tenancy.test.ts`.
//
// Where the password comes from, and whether it is recoverable, is a different
// question with a single home: `protected-database.ts`.
// ============================================================================

/**
 * The two addresses `--oversight-orgs-only` re-keys, in the order it writes
 * them, and the same two the browser-validation credentials table names.
 *
 * KEYED BY ADDRESS, NOT BY ROLE. The docs promise a verifier two addresses; a
 * role is not unique by construction, so a lookup by role moves the credential
 * write to a different account the day a second `network_admin` joins the
 * fixture. The address is the key; the role is a value that gets written.
 *
 * SPELLED OUT rather than built from `DEV_EMAIL_DOMAIN`, which is the one place
 * the seed domain is declared (ruled 2026-07-31). That constant lives in
 * `scripts/seed-dev-db.ts`, which cannot be imported — it constructs a database
 * client and `process.exit`s at load — and `dev-accounts.test.ts` pins it there
 * as the repo-wide retirement guard. The drift that would otherwise cost is
 * closed BEHAVIOURALLY instead: `oversightAdminSeeds()` below throws when an
 * address here is not in the fixture, so a domain change that missed this list
 * fails the mode loudly on its next run rather than silently seeding nobody.
 */
export const OVERSIGHT_ADMIN_EMAILS = [
  "sending-church-admin@everyfield.app",
  "admin@everyfield.app",
] as const;

/** One resolved admin, ready to write. */
export type OversightAdminSeed = {
  email: string;
  name: string;
  role: UserRole;
  sendingChurchId: string | null;
  sendingNetworkId: string | null;
};

/** A candidate row from the seed script's `SEED_USERS` list. */
export type SeedAccountRow = {
  email: string;
  name?: string | null;
  role: UserRole;
  sendingChurchId?: string | null;
  sendingNetworkId?: string | null;
};

/**
 * The two admins to write, resolved from the seed fixture BY ADDRESS.
 *
 * TOTAL, NOT BEST-EFFORT. An address in `OVERSIGHT_ADMIN_EMAILS` that the
 * fixture no longer carries throws; so does one carrying no name. Both are
 * `--oversight-orgs-only` silently restoring one half of a two-halved fixture,
 * which is how the network admin kept a NULL `sending_network_id` and
 * `/oversight/invitations` rendered "Set up your network first" with no way to
 * send anything. A missing half must stop the run, not shorten the loop.
 *
 * Returns them in `OVERSIGHT_ADMIN_EMAILS` order so the mode's output is
 * deterministic.
 */
export function oversightAdminSeeds(
  candidates: readonly SeedAccountRow[]
): OversightAdminSeed[] {
  return OVERSIGHT_ADMIN_EMAILS.map((email) => {
    const row = candidates.find((candidate) => candidate.email === email);
    if (!row) {
      throw new Error(
        `no ${email} in the seed fixture — --oversight-orgs-only must restore both halves of the oversight fixture, and this one has no row to write`
      );
    }
    if (!row.name) {
      throw new Error(
        `${email} has no name in the seed fixture — the upsert deliberately never sets \`name\`, so an unnamed row would be inserted nameless and never repaired`
      );
    }

    return {
      email: row.email,
      name: row.name,
      role: row.role,
      sendingChurchId: row.sendingChurchId ?? null,
      sendingNetworkId: row.sendingNetworkId ?? null,
    };
  });
}

/**
 * The upsert that makes an oversight login usable.
 *
 * AN UPSERT, NOT `onConflictDoNothing`. The mode exists so an operator names a
 * password and then signs in with it. A write that skips on conflict can only
 * create the account, never re-key one that already exists — so a second run
 * exited 0, announced "the SEED_ADMIN_PASSWORD you passed", and left the OLD
 * password working. A false success on a credential path.
 *
 * Re-keying an existing address is safe ONLY because `decideSeedAccounts` has
 * already refused, with no override, on any database holding a sentinel. On a
 * scratch or preview database the address is this fixture's own.
 *
 * `churchId` and both org FKs are in the SET, so a run also repairs an account
 * whose `sending_network_id` drifted to NULL. `name` is NOT: it identifies a
 * person on screen, and a re-key is not a rename.
 */
export function oversightAdminUpsert<TSchema extends Record<string, unknown>>(
  db: NeonHttpDatabase<TSchema>,
  admin: OversightAdminSeed,
  passwordHash: string,
  now: Date
) {
  return db
    .insert(users)
    .values({
      email: admin.email,
      name: admin.name,
      role: admin.role,
      passwordHash,
      churchId: null,
      sendingChurchId: admin.sendingChurchId,
      sendingNetworkId: admin.sendingNetworkId,
    })
    .onConflictDoUpdate({
      target: users.email,
      set: {
        passwordHash,
        role: admin.role,
        churchId: null,
        sendingChurchId: admin.sendingChurchId,
        sendingNetworkId: admin.sendingNetworkId,
        updatedAt: now,
      },
    });
}
