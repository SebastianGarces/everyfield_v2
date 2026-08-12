/**
 * WHICH DATABASE MAY BE SEEDED, AND WHERE THE SEED'S PASSWORD COMES FROM.
 *
 * Both halves live here because they are one decision seen twice: a seed mode
 * may only write where it is safe to write, and the credential it writes must
 * be recoverable by the next operator rather than only by the one who typed it.
 * Splitting them put "where does the password come from" in two files.
 *
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

// ----------------------------------------------------------------------------
// The ADDITIVE mode's guard (#304 round 8, ruled 2026-08-10)
// ----------------------------------------------------------------------------

/**
 * The environment variable `--oversight-orgs-only` reads its admin password
 * from. There is NO default and there must never be one.
 *
 * An env var rather than a flag, unlike `ALLOW_PROTECTED_DB_FLAG`: a password
 * typed on a command line lands in shell history and in the process table,
 * where the override flag — which is a decision, not a secret — is exactly what
 * you want to find later.
 */
export const SEED_ADMIN_PASSWORD_ENV = "SEED_ADMIN_PASSWORD";

/**
 * Where `SEED_ADMIN_PASSWORD` is recorded so a LATER operator can re-derive it.
 *
 * A credential removed from the repository needs a route, or the fixture it
 * opens becomes unreachable. Dropping the in-repo constant was right — no
 * constant here may open an account on a database anyone else uses — but on its
 * own it made the password whatever the last operator typed, recorded nowhere,
 * so the next person to validate in a browser could not sign in at all.
 *
 * `.env.local` is the route: gitignored and machine-local (so it is not an
 * in-repo constant), symlinked into every worktree by `scripts/worktree-env.sh`,
 * already holding `VERCEL_AUTOMATION_BYPASS_SECRET` — which browser validation
 * needs anyway — and loaded by `scripts/seed-dev-db.ts` before it reads the
 * variable, so recording the value IS how the mode is run.
 *
 * Passing the password inline still writes a real credential. What it does not
 * do is leave a route behind, so the mode says so rather than exiting 0 as
 * though the fixture were reachable.
 */
export const SEED_ENV_FILE = ".env.local";

/**
 * The password `.env.local` records, or `undefined` when it records none.
 *
 * Parses `KEY=value` the way dotenv does for the one key that matters: last
 * assignment wins, optional `export`, optional matching quotes, and a trailing
 * `# comment` stripped from an UNQUOTED value only. The two parsers have to
 * agree — a difference here shows up as a spurious "not recorded" warning,
 * which teaches an operator to ignore the one warning that matters.
 *
 * `undefined` text means the file does not exist, which is not the same as the
 * key being absent from a file that does — but both are "not recorded", and
 * both get the notice.
 */
export function recordedSeedPassword(
  envFileText: string | undefined
): string | undefined {
  if (envFileText === undefined) return undefined;

  const assignment = new RegExp(
    `^\\s*(?:export\\s+)?${SEED_ADMIN_PASSWORD_ENV}\\s*=\\s*(.*?)\\s*$`
  );

  let value: string | undefined;
  for (const line of envFileText.split("\n")) {
    const match = assignment.exec(line);
    if (!match) continue;

    const raw = match[1] ?? "";
    const quoted = /^(["'])([\s\S]*)\1$/.exec(raw);
    value = quoted
      ? (quoted[2] ?? "")
      : raw.replace(/\s+#.*$/, "").replace(/^#.*$/, "");
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
    `     ${SEED_ADMIN_PASSWORD_ENV}="<the password you just used>"`,
    "",
    `   Then re-run this mode with no inline prefix — it reads ${SEED_ENV_FILE}.`,
  ].join("\n");
}

export type SeedAccountsDecision =
  | { verdict: "proceed"; password: string }
  | {
      verdict: "refuse";
      reason: "protected-database";
      accounts: string[];
      message: string;
    }
  | {
      verdict: "refuse";
      reason: "no-password";
      accounts: string[];
      message: string;
    };

/**
 * Whether the additive seed mode may WRITE AN ACCOUNT here.
 *
 * A sibling of `decideWipe` rather than a call into it, because the danger is a
 * different one and so is the sentence. `decideWipe` guards a DELETE and has an
 * override, because "wipe this database anyway" is a thing an operator can
 * legitimately mean. This guards the WRITING of a login — an insert, or since
 * #304 round 9 a re-key of an address that already exists — and it has none.
 *
 * ADDITIVE IS NOT SAFE. `--oversight-orgs-only` deletes nothing, and the seed
 * script called that "safe on the shared development database" in three places.
 * The mode mints real, enabled oversight logins and — since its writes became
 * upserts — RE-KEYS the two addresses if they already exist. On a database real
 * people use that is a live credential either way. (The account the mode once
 * created on the shared database was neutralised by hand on 2026-08-10; this
 * function is why it cannot be re-created.)
 *
 * BE PRECISE ABOUT WHAT THAT IS LICENSED BY. The probe below asks exactly one
 * question — are any of the three `PROTECTED_ACCOUNTS` addresses present — and a
 * "no" proves only that the alpha cohort is not here. It does NOT prove every
 * account on this database is fixture, and it cannot: a teammate's hand-
 * registered account, or a second agent's, answers "no" as loudly as an empty
 * database does. So the guarantee this guard actually gives the re-key is
 * narrow: it cannot seize a SENTINEL account. Seizing the two oversight
 * addresses on any other non-sentinel database is a deliberate consequence of
 * the mode, not something proven harmless here — which is why the two addresses
 * it re-keys are a fixed, fixture-only pair named in
 * `oversight-admin-upsert.ts` rather than anything an operator can point at a
 * real person's address. Widening that pair, or the mode's reach, needs a
 * ruling and not just this probe.
 *
 * TWO REFUSALS, and the sentinel one is asked FIRST — before the password
 * question, and before the mode writes anything at all. A missing password on a
 * throwaway database is a fixable mistake; a well-chosen password on the shared
 * database is still an account on the shared database, so the order of the
 * questions is the order of the stakes.
 *
 * There is deliberately no override. The one honest way to put a row on a
 * protected database is a reviewed statement written by hand for that database,
 * not a script mode that also runs unattended in a build loop.
 */
export function decideSeedAccounts(input: {
  accountsFound: readonly string[];
  password: string | undefined;
}): SeedAccountsDecision {
  const accounts = [...input.accountsFound];

  if (accounts.length > 0) {
    return {
      verdict: "refuse",
      reason: "protected-database",
      accounts,
      message:
        `Refusing to seed accounts: this database holds ${accounts.length} protected account(s) — ` +
        `${accounts.join(", ")}. ` +
        `This mode deletes nothing, and that is not the same as safe: it WRITES the two oversight admin ` +
        `logins and RE-KEYS them if the addresses already exist, and a login on a database real people ` +
        `use is a live credential. ` +
        `There is no override for this — point DATABASE_URL at your own or a throwaway database. ` +
        `If a protected database genuinely needs these rows, write the statement by hand, for that database, ` +
        `and choose the password there.`,
    };
  }

  const password = input.password?.trim();

  if (!password) {
    return {
      verdict: "refuse",
      reason: "no-password",
      accounts,
      message:
        `Refusing to seed accounts: ${SEED_ADMIN_PASSWORD_ENV} is not set. ` +
        `The accounts this mode writes are real logins, so their password is chosen by whoever runs it — ` +
        `there is no constant in this repository that opens it. ` +
        `Re-run with ${SEED_ADMIN_PASSWORD_ENV}=<a password you choose>.`,
    };
  }

  return { verdict: "proceed", password };
}
