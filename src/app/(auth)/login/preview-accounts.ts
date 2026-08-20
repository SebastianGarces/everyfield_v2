// ============================================================================
// PREVIEW-ONLY — the seeded QA accounts, offered as FORM AUTOFILL.
//
// ⚠️  THIS IS NOT A SESSION GRANT, AND MUST NEVER BECOME ONE. Picking an
// account types an email and a password into the two fields on the login form.
// That is the entire feature. The reader still presses "Sign in", the normal
// login POST still runs, and it runs the same password check, the same rate
// limiting and the same session issuance as a hand-typed login. There is no
// route here, no `"use server"` export, no handler and no cookie — a reviewer
// should reject any change to this file that adds one (#146).
//
// Why this is allowed on a preview where the dev account switcher is not:
// `dev-accounts.ts` issues a session with NO password, so it is gated on
// `NODE_ENV === "development" && !process.env.VERCEL` and that gate stays
// exactly as it is. This module ships nothing that is not already public to
// anyone who can read the repo — `scripts/seed-dev-db.ts` and
// `scripts/seed-phase-engine-eval.ts` hold these credentials as constants and
// `.claude/skills/browser-validation/SKILL.md` prints them in a table. Leaked
// whole, it grants what a `grep` already grants.
//
// TWO PASSWORDS, BECAUSE TWO SEEDS. `seed-dev-db.ts` keys its accounts with
// `password123`; `seed-phase-engine-eval.ts` keys the eval corpus with
// `eval-password-123`. Filling the right one per account is half the point of
// the picker, and `preview-accounts.test.ts` pins both against the scripts so
// the copy here cannot drift away from the seed that made the rows.
//
// THE TWO OVERSIGHT ADMINS CARRY NO PASSWORD, and that is an invariant rather
// than an oversight: no in-repo constant may open an account on a database
// anyone else uses, so `SEED_ADMIN_PASSWORD` is recorded in `.env.local` and
// nowhere else (`memory/invariants.md`). Those two rows fill the email and
// leave the password field empty and focused.
//
// KEEP THIS MODULE OFF THE CLIENT. The roster reaches a browser as a PROP of a
// preview render and by no other path, which is what keeps it out of a
// production bundle: `next build` emits no client chunk that names it, so a
// grep of `.next/static` for a seeded address finds nothing.
// `preview-accounts.test.ts` asserts the rule that keeps it that way — every
// `"use client"` module imports from here with `import type`, which TypeScript
// erases, or not at all.
// ============================================================================

/** Section headings in the picker, in the order they are shown. */
export type PreviewAccountGroup =
  | "Plants & teams"
  | "Phase Engine eval"
  | "Oversight";

export interface PreviewAccount {
  email: string;
  /**
   * What gets typed into the password field. `null` where the password is
   * deliberately absent from the repo — see the header. The picker fills the
   * email and leaves the password to the reader.
   */
  password: string | null;
  name: string;
  /** One phrase: what this account is, and what it is good for. */
  note: string;
  group: PreviewAccountGroup;
}

/** `DEV_PASSWORD` in `scripts/seed-dev-db.ts`. */
const SEED_PASSWORD = "password123";
/** `EVAL_PASSWORD` in `scripts/seed-phase-engine-eval.ts`. */
const EVAL_PASSWORD = "eval-password-123";

const SEED_DOMAIN = "everyfield.app";
const EVAL_DOMAIN = "eval.phase-engine.everyfield.app";

/**
 * The `key` of every profile in `PROFILES` (`seed-phase-engine-eval.ts`), in
 * seed order. Exported for the drift test, which asserts this list IS that one:
 * the eval planter addresses are built from the key the same way the seed
 * builds them, so a profile added there shows up here or the test goes red.
 */
export const EVAL_PLANTER_KEYS = [
  "genesis",
  "cornerstone",
  "wanderer",
  "beacon",
  "drift",
  "summit",
  "hollow",
  "lighthouse",
  "freefall",
  "dayspring",
  "evergreen",
  "ember",
] as const;

/**
 * Data-rich enough to exercise a list, a chart or a roster. Everything else in
 * the eval corpus is a thinner church; the note is what tells a reader which to
 * pick, and `browser-validation/SKILL.md` names these two for the same reason.
 */
const POPULATED_EVAL_KEYS = new Set(["dayspring", "evergreen"]);

const PREVIEW_ACCOUNTS: PreviewAccount[] = [
  {
    email: `planter1@${SEED_DOMAIN}`,
    password: SEED_PASSWORD,
    name: "John Planter",
    note: "Plant owner · church has 0 people",
    group: "Plants & teams",
  },
  {
    email: `planter2@${SEED_DOMAIN}`,
    password: SEED_PASSWORD,
    name: "Samuel Planter",
    note: "Plant owner · second church",
    group: "Plants & teams",
  },
  {
    email: `planter3@${SEED_DOMAIN}`,
    password: SEED_PASSWORD,
    name: "Mike Planter",
    note: "Plant owner · third church",
    group: "Plants & teams",
  },
  {
    email: `coach1@${SEED_DOMAIN}`,
    password: SEED_PASSWORD,
    name: "David Coach",
    note: "Coach · no seat, reaches a plant by assignment",
    group: "Plants & teams",
  },
  {
    email: `coach2@${SEED_DOMAIN}`,
    password: SEED_PASSWORD,
    name: "Emily Coach",
    note: "Coach · no seat, second plant",
    group: "Plants & teams",
  },
  {
    email: `team1@${SEED_DOMAIN}`,
    password: SEED_PASSWORD,
    name: "Alex Team",
    note: "Plant member · the narrowest seat",
    group: "Plants & teams",
  },
  {
    email: `team2@${SEED_DOMAIN}`,
    password: SEED_PASSWORD,
    name: "Jordan Team",
    note: "Plant member · same church as Alex",
    group: "Plants & teams",
  },
  {
    email: `team3@${SEED_DOMAIN}`,
    password: SEED_PASSWORD,
    name: "Casey Team",
    note: "Plant member · second church",
    group: "Plants & teams",
  },

  {
    email: `network-admin@${EVAL_DOMAIN}`,
    password: EVAL_PASSWORD,
    name: "EVAL Network Admin",
    note: "Oversight owner of the whole eval network",
    group: "Phase Engine eval",
  },
  ...EVAL_PLANTER_KEYS.map(
    (key): PreviewAccount => ({
      email: `planter-${key}@${EVAL_DOMAIN}`,
      password: EVAL_PASSWORD,
      name: `EVAL Planter (${key})`,
      note: POPULATED_EVAL_KEYS.has(key)
        ? "Plant owner · ~100 people, meetings, assessments"
        : "Plant owner · eval corpus church",
      group: "Phase Engine eval",
    })
  ),

  {
    email: `admin@${SEED_DOMAIN}`,
    password: null,
    name: "Network Admin",
    note: "Owns Dev Church Planting Network",
    group: "Oversight",
  },
  {
    email: `sending-church-admin@${SEED_DOMAIN}`,
    password: null,
    name: "Sarah Sending",
    note: "Dev Sending Church, in no network",
    group: "Oversight",
  },
];

/**
 * The ONE gate. `VERCEL_ENV` is a Vercel system variable: `"preview"` on a
 * branch deployment, `"production"` on the production one, and unset anywhere
 * else — so a local dev machine gets nothing here and keeps the dev account
 * switcher instead. Deliberately not configurable: an env var a human can set
 * is exactly what `browser-validation/SKILL.md` refuses for the switcher, and
 * the same reasoning applies to anything that puts credentials on a page.
 */
export function isPreviewAccountPickerEnabled(): boolean {
  return process.env.VERCEL_ENV === "preview";
}

/**
 * The roster, or an empty list everywhere but a preview. The only export that
 * yields an address, so a caller that forgets the gate still gets nothing.
 */
export function listPreviewAccounts(): PreviewAccount[] {
  if (!isPreviewAccountPickerEnabled()) return [];
  return PREVIEW_ACCOUNTS;
}
