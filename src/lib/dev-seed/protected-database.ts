/**
 * The guard that keeps `pnpm db:seed` off the shared development database
 * (#326, ruled 2026-08-09).
 *
 * `cleanDatabase()` in `scripts/seed-dev-db.ts` deletes ALL users and ALL
 * churches unscoped — the fixture is the whole database. Until #326 the only
 * thing standing between that and the shared `development` branch was a warning
 * comment, and a comment is not a guard: it used to CRASH partway through when
 * pointed at a database with launch history, and the same track that fixed the
 * crash removed the accident that was protecting everyone.
 *
 * Detection is POSITIVE — it looks for accounts that only exist on a database
 * worth protecting, rather than trying to recognise a database that is safe.
 * The negative version fails open: an unfamiliar connection string, a renamed
 * Neon branch or a pooled host would all read as "not development" and the wipe
 * would run. The sentinels below cannot appear on a scratch database unless
 * somebody put them there.
 *
 * The decision is a pure function over query results so it can be tested
 * without a database — which is the point, because the only way to test the
 * other version is to run the thing this guard exists to prevent.
 */

/**
 * Accounts that mark a database as protected: the alpha cohort (#192/#193),
 * who are real people with real logins.
 *
 * These are sentinels, not a complete inventory — the shared database also
 * holds ~67 hand-registered plants and the marketing-church fixture, none of
 * which survive a wipe either. Matching one is enough to stop.
 *
 * If the cohort grows, add to this list. An account leaving the cohort can stay
 * — a sentinel that no longer exists simply never matches, and the cost of a
 * stale entry is zero while the cost of a missing one is the wipe.
 */
export const PROTECTED_ACCOUNTS: readonly string[] = [
  "brett@firstfamily.church",
  "bryan@vertical.family",
  "cwarszawski@namb.net",
];

/**
 * The one way past the guard.
 *
 * Named for what it permits rather than how it feels (`--force`, `--yes`), so
 * that a command in a runbook or a shell history says out loud which database
 * it is about to be pointed at.
 */
export const ALLOW_PROTECTED_DB_FLAG = "--allow-protected-db";

/**
 * Which sentinels are present among `emails`.
 *
 * EQUALITY on the normalised address, never a substring test: `brett@
 * firstfamily.church.example.com` is a different account, and a guard that
 * refuses on a lookalike teaches people to pass the override reflexively.
 * Postgres stores these lower-cased, but the comparison normalises anyway
 * because a fixture written by hand may not have.
 *
 * The result follows `PROTECTED_ACCOUNTS` order and holds no duplicates, so the
 * refusal message is deterministic.
 */
export function matchProtectedAccounts(emails: readonly string[]): string[] {
  const present = new Set(emails.map((email) => email.trim().toLowerCase()));
  return PROTECTED_ACCOUNTS.filter((account) => present.has(account));
}

export type WipeDecision =
  | { verdict: "proceed" }
  | { verdict: "proceed-with-override"; accounts: string[]; warning: string }
  | { verdict: "refuse"; accounts: string[]; message: string };

/**
 * Whether the wipe may run, given what the sentinel query found and whether the
 * override flag was passed.
 *
 * Note what is NOT here: any notion of "probably fine". Either no protected
 * account is present, or a human typed the flag. A caller that cannot complete
 * the query must treat that as a refusal too — an unanswered question about a
 * destructive operation is a no.
 */
export function decideWipe(input: {
  accountsFound: readonly string[];
  overrideRequested: boolean;
}): WipeDecision {
  const accounts = [...input.accountsFound];

  if (accounts.length === 0) return { verdict: "proceed" };

  if (input.overrideRequested) {
    return {
      verdict: "proceed-with-override",
      accounts,
      warning:
        `${ALLOW_PROTECTED_DB_FLAG} was passed, so the wipe will run against a database holding ` +
        `${accounts.length} protected account(s): ${accounts.join(", ")}. ` +
        `They will be deleted, along with every other user and church here.`,
    };
  }

  return {
    verdict: "refuse",
    accounts,
    message:
      `Refusing to clean: this database holds ${accounts.length} protected account(s) — ` +
      `${accounts.join(", ")}. ` +
      `The dev seed deletes ALL users and ALL churches, not just the rows it created, so running it here ` +
      `would delete the alpha cohort's logins and every hand-registered plant alongside them. ` +
      `Point DATABASE_URL at your own or a throwaway database. ` +
      `If wiping THIS database is genuinely what you mean, re-run with ${ALLOW_PROTECTED_DB_FLAG}.`,
  };
}
