/**
 * CS-013 (#620) — does the suite actually catch a broken sharing default?
 *
 * A green suite proves the code passes the tests, not that the tests would
 * notice if it stopped being right. This breaks each load-bearing claim one at
 * a time and asserts the named suite goes RED, then restores the file byte for
 * byte. Safe to rerun; a reviewer should.
 *
 *   pnpm exec tsx scripts/cs013-mutation-check.ts
 *
 * Every mutation is a string replacement that must match exactly once — a
 * mutation whose needle has drifted FAILS the run rather than quietly testing
 * nothing, which is the failure mode a mutation harness is most prone to.
 *
 * IT REFUSES TO RUN AGAINST A DIRTY TREE, and that is not tidiness. The restore
 * reads the file's own contents as the thing to put back, so a run that starts
 * on an already-mutated file would restore the MUTATION permanently — while the
 * needle check might still find its one match and report "caught". Combined with
 * the signal handlers below (a `finally` does not run on SIGINT), that is what
 * makes "safe to rerun" true rather than merely claimed.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type Mutation = {
  /** What claim this breaks, in the words the test is about. */
  claim: string;
  file: string;
  from: string;
  to: string;
  /** The suite that must go red. */
  suite: string;
};

const DEFAULTS = "src/lib/privacy/sharing-defaults.ts";
const CORE = "src/lib/invitations/core.ts";
const COPY = "src/lib/notifications/categories.ts";

const DEFAULTS_SUITE = "src/lib/privacy/sharing-defaults.test.ts";
const ACCEPT_SUITE = "src/lib/invitations/association.test.ts";
const COPY_SUITE = "src/lib/notifications/oversight.test.ts";

const MUTATIONS: Mutation[] = [
  {
    claim: "the ON write covers every toggle the schema has",
    file: DEFAULTS,
    from: '.filter(([, column]) => column.dataType === "boolean")\n  .map(([name]) => name as PrivacyColumn);',
    to: '.filter(([, column]) => column.dataType === "boolean")\n  .filter(([name]) => name !== "shareFinancials")\n  .map(([name]) => name as PrivacyColumn);',
    suite: DEFAULTS_SUITE,
  },
  {
    claim: "the ON write is gated on the claim the accept won",
    file: DEFAULTS,
    from: '            eq(organizationInvitations.status, "accepted"),\n',
    to: "",
    suite: DEFAULTS_SUITE,
  },
  {
    claim: "an already-associated plant keeps the toggles it turned off",
    file: DEFAULTS,
    from: "            isNull(churches.sendingChurchId),\n            isNull(churches.sendingNetworkId)\n",
    to: "",
    suite: DEFAULTS_SUITE,
  },
  {
    claim: "a plant with no privacy row still gets one",
    file: DEFAULTS,
    from: "    .onConflictDoUpdate({\n      target: churchPrivacySettings.churchId,",
    to: "    .onConflictDoNothing({\n      target: churchPrivacySettings.churchId,",
    suite: DEFAULTS_SUITE,
  },
  {
    claim: "the DB column defaults stay FALSE",
    file: "src/db/schema/church-privacy-settings.ts",
    from: 'sharePeople: boolean("share_people").default(false).notNull()',
    to: 'sharePeople: boolean("share_people").default(true).notNull()',
    suite: DEFAULTS_SUITE,
  },
  {
    claim: "the sharing write is IN the acceptance batch",
    file: CORE,
    from: "    claim,\n    sharing,\n    association,",
    to: "    claim,\n    association,",
    suite: ACCEPT_SUITE,
  },
  {
    claim:
      "the sharing write reads the plant BEFORE the association sets its FK",
    file: CORE,
    from: "    claim,\n    sharing,\n    association,\n    audit,",
    to: "    claim,\n    association,\n    audit,\n    sharing,",
    suite: DEFAULTS_SUITE,
  },
  {
    claim: "the registration screen states the consent before accepting",
    file: "src/app/(auth)/register/register-form.tsx",
    from: "{INVITE_ORIGIN_SHARING_CONSENT.map((line) => (",
    to: "{[].map((line: string) => (",
    suite: DEFAULTS_SUITE,
  },
  {
    claim: "the association read states the consent before accepting",
    file: "src/lib/settings/section-data.ts",
    from: "      consent: associations.length === 0 ? INVITE_ORIGIN_SHARING_CONSENT : null,\n",
    to: "      consent: null,\n",
    suite: DEFAULTS_SUITE,
  },
  {
    // #657 SPLIT THE SCREEN IN TWO, so gutting it takes two mutations. The one
    // above stops the copy being CHOSEN; this one lets it be chosen and then
    // drops it on the floor, which is the failure a source guard reading only
    // the loader would report as a pass.
    claim: "the association section renders the consent it is handed",
    file: "src/components/settings/sections/association-section.tsx",
    from: "                    {consent.map((line) => (",
    to: "                    {[].map((line: string) => (",
    suite: DEFAULTS_SUITE,
  },
  {
    claim: "no screen invents a reversibility promise of its own",
    file: "src/components/settings/sections/association-section.tsx",
    from: 'consequence="Accepting lists your plant in their directory with its name, phase and launch date."',
    to: 'consequence="Accepting lists your plant in their directory — all of which you can change afterwards."',
    suite: COPY_SUITE,
  },
  {
    claim: "the consent copy names every consent-exempt event",
    file: COPY,
    // THE NEEDLE HAD DRIFTED, and the harness said so rather than reporting a
    // pass: the copy grew a fourth exempt event ("when you close something you
    // were sharing") while this string still said "Three things", so from that
    // day until #657 this mutation could not be applied and the claim it proves
    // was unproven. The lesson is the harness's own — a needle is a quotation,
    // and a quotation rots.
    from:
      '  "Four things reach them either way, because the relationship itself is theirs too:' +
      " when you accept their invitation, when you decline one, when your association with them ends," +
      ' and when you close something you were sharing.",\n] as const;',
    to: "] as const;",
    suite: COPY_SUITE,
  },
];

const TOUCHED = [...new Set(MUTATIONS.map((m) => m.file))];

function runSuite(suite: string): boolean {
  try {
    execFileSync("pnpm", ["exec", "tsx", "--test", suite], {
      cwd: process.cwd(),
      stdio: "pipe",
      env: {
        ...process.env,
        DATABASE_URL:
          process.env.DATABASE_URL ?? "postgresql://ci:ci@localhost:5432/ci",
        RESEND_API_KEY: process.env.RESEND_API_KEY ?? "re_ci_placeholder",
      },
    });
    return true;
  } catch {
    return false;
  }
}

// A DIRTY TREE IS REFUSED, not warned about — see the header. Uncommitted work
// in one of these files is indistinguishable from a mutation a killed run left
// behind, and restoring over it would destroy real edits.
try {
  execFileSync("git", ["diff", "--quiet", "--", ...TOUCHED], {
    cwd: process.cwd(),
    stdio: "pipe",
  });
} catch {
  console.error(
    "REFUSING: uncommitted changes in a file this harness rewrites.\n" +
      "Commit or stash them first — the restore would overwrite them.\n" +
      TOUCHED.map((file) => `  ${file}`).join("\n")
  );
  process.exit(1);
}

/** Files currently holding a mutation, so a signal can put them back. */
const inFlight = new Map<string, string>();

function restoreAll(): void {
  for (const [file, original] of inFlight) writeFileSync(file, original);
  inFlight.clear();
}

// `finally` does not run on a signal, and an interrupted run that left a
// deliberate bug in a checked-in file is the worst thing this script could do.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    restoreAll();
    console.error(`\n${signal} — restored ${TOUCHED.length} file(s), exiting`);
    process.exit(130);
  });
}

let failures = 0;

// The baseline first: a harness reporting "caught" against an already red suite
// proves nothing at all.
for (const suite of new Set(MUTATIONS.map((m) => m.suite))) {
  if (!runSuite(suite)) {
    console.error(`BASELINE RED — ${suite} fails before any mutation`);
    process.exit(1);
  }
  console.log(`baseline green  ${suite}`);
}
console.log("");

for (const mutation of MUTATIONS) {
  const file = path.join(process.cwd(), mutation.file);
  const original = readFileSync(file, "utf8");

  const occurrences = original.split(mutation.from).length - 1;
  if (occurrences !== 1) {
    console.error(
      `NEEDLE DRIFT — "${mutation.claim}": found ${occurrences} matches in ${mutation.file}, expected 1`
    );
    failures += 1;
    continue;
  }

  inFlight.set(file, original);
  writeFileSync(file, original.replace(mutation.from, mutation.to));

  let caught: boolean;
  try {
    caught = !runSuite(mutation.suite);
  } finally {
    writeFileSync(file, original);
    inFlight.delete(file);
  }

  console.log(
    `${caught ? "caught " : "MISSED "} ${mutation.claim}  →  ${mutation.suite}`
  );
  if (!caught) failures += 1;
}

console.log("");
if (failures > 0) {
  console.error(`${failures} mutation(s) went undetected`);
  process.exit(1);
}
console.log(`all ${MUTATIONS.length} mutations caught`);
