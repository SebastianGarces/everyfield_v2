import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

import { users, type UserRole } from "@/db/schema";

// ============================================================================
// THE OVERSIGHT ADMIN CREDENTIAL WRITE (#304 round 9/10).
//
// This is the one statement `--oversight-orgs-only` exists to run, lifted out
// of `scripts/seed-dev-db.ts` so a test can render it with `.toSQL()` instead
// of reading the script's source text. The round-9 tests grepped the file, and
// this repo already rules against that where the SQL *is* the invariant
// (`memory/invariants/wiki-articles.md` — `tenancy.test.ts` renders builders
// rather than trusting the call site). The defect those tests were written to
// catch is a CONFLICT CLAUSE, which is a property of the emitted statement, so
// the emitted statement is what has to be asserted.
//
// KEYED BY ADDRESS, NOT BY ROLE. `.claude/skills/browser-validation/SKILL.md`
// promises a verifier two addresses; the seed used to look its rows up by role
// and write whichever address happened to carry that role. Those are the same
// thing only for as long as nobody adds a second `network_admin` to the
// fixture. The addresses below are the key — the contract the docs state — and
// the role is a value that gets written, not a selector.
// ============================================================================

/**
 * The two addresses `--oversight-orgs-only` re-keys, in the order it writes
 * them, and the same two the browser-validation credentials table names.
 *
 * They are `everyfield.app` — the product domain, ruled 2026-07-31.
 */
export const OVERSIGHT_ADMIN_EMAILS = [
  "sending-church-admin@everyfield.app",
  "admin@everyfield.app",
] as const;

export type OversightAdminSeed = {
  email: string;
  name: string;
  role: UserRole;
  sendingChurchId: string | null;
  sendingNetworkId: string | null;
};

/**
 * The upsert that makes an oversight login usable.
 *
 * AN UPSERT, NOT `onConflictDoNothing`. The point of the mode is that an
 * operator names a password and then signs in with it. A write that skips on
 * conflict can only ever create the account, never re-key one that already
 * exists — so a second run exited 0, announced "the SEED_ADMIN_PASSWORD you
 * passed", and left the OLD password working. A false success on a credential
 * path, and the reason the fixture stayed unreachable after the shared-database
 * account was neutralised by hand on 2026-08-10.
 *
 * Re-keying an existing address is safe here ONLY because `decideSeedAccounts`
 * has already refused, with no override, on any database holding a sentinel.
 * On a scratch or preview database the address is this fixture's own, and
 * taking it over is exactly what was asked for.
 *
 * `churchId` and both org FKs are in the SET, so a run also repairs an account
 * whose `sending_network_id` drifted to NULL — which is what made
 * `/oversight/invitations` render "Set up your network first" on the preview.
 * `name` is NOT: it identifies a person on screen, and a re-key is not a
 * rename.
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

// ============================================================================
// WHERE THE CHOSEN PASSWORD IS WRITTEN DOWN (#304 round 10).
//
// Round 8 stopped shipping an in-repo password for these accounts, which was
// right: no constant in this repository may open an account on a database
// anyone else uses. But nothing replaced it as a ROUTE. The password became
// whatever the last operator typed, recorded nowhere, so the next agent to
// verify #304 could not sign in as either oversight admin, could not create an
// invitation, and could not exercise one interactive acceptance criterion. The
// gate was un-runnable by anyone except the person who happened to type it.
//
// The route is `.env.local`: gitignored, machine-local, already where
// `VERCEL_AUTOMATION_BYPASS_SECRET` lives — the same file a verifier must
// already open to reach a preview at all, and invisible to anyone who can only
// read the repository. `scripts/seed-dev-db.ts` loads it with dotenv before it
// reads `SEED_ADMIN_PASSWORD`, so recording it there is not an extra step
// beside running the seed; it IS how the seed is run.
//
// A password passed inline on the command line still works, and still writes a
// real credential. What it does not do is leave a route behind — so the mode
// says so, loudly, rather than exiting 0 as though the fixture were now
// reachable.
// ============================================================================

/** Where `SEED_ADMIN_PASSWORD` is recorded so a later verifier can re-derive it. */
export const SEED_ENV_FILE = ".env.local";

/**
 * Whether `.env.local` records the password this run actually used.
 *
 * Parses `KEY=value` the way dotenv does for the one key that matters: last
 * assignment wins, optional `export`, optional matching quotes. `undefined`
 * text means the file does not exist, which is not the same as the key being
 * absent from a file that does — both are "not recorded", and both get the
 * notice.
 */
export function recordedSeedPassword(
  envFileText: string | undefined
): string | undefined {
  if (envFileText === undefined) return undefined;

  let value: string | undefined;
  for (const line of envFileText.split("\n")) {
    const match = /^\s*(?:export\s+)?SEED_ADMIN_PASSWORD\s*=\s*(.*?)\s*$/.exec(
      line
    );
    if (!match) continue;

    const raw = match[1] ?? "";
    const quoted = /^(["'])([\s\S]*)\1$/.exec(raw);
    value = quoted ? (quoted[2] ?? "") : raw;
  }

  return value;
}

/**
 * The warning to print when the password used is not the one `.env.local`
 * records — `null` when it is, and there is nothing to say.
 *
 * Never prints the password. It names the file and the key; the operator holds
 * the value and puts it there.
 */
export function unrecordedPasswordNotice(
  envFileText: string | undefined,
  passwordUsed: string
): string | null {
  if (recordedSeedPassword(envFileText) === passwordUsed) return null;

  return [
    `⚠️  This password is not recorded in ${SEED_ENV_FILE}.`,
    "",
    `   The accounts are now keyed to a password only this shell knows, so the`,
    `   next person to validate #304 in a browser cannot sign in as either`,
    `   oversight admin — which is exactly how the fixture was stranded before.`,
    "",
    `   Record it (${SEED_ENV_FILE} is gitignored and machine-local):`,
    "",
    `     SEED_ADMIN_PASSWORD="<the password you just used>"`,
    "",
    `   Then re-run this mode with no inline prefix — it reads ${SEED_ENV_FILE}.`,
  ].join("\n");
}
