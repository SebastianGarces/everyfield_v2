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
 * A mutation's TARGET is the exact source text the harness must find in the
 * file before it can break it — quoted verbatim from that file, and required to
 * match exactly once. A target that no longer matches FAILS the run rather than
 * quietly testing nothing, which is the failure mode a mutation harness is most
 * prone to. That half of the check is `staleTargets()` below, which is exported
 * so `pnpm test` runs it too — see its docblock for why that matters (#681).
 *
 * IT REFUSES TO RUN AGAINST A DIRTY TREE, and that is not tidiness. The restore
 * reads the file's own contents as the thing to put back, so a run that starts
 * on an already-mutated file would restore the MUTATION permanently — while the
 * target check might still find its one match and report "caught". Combined with
 * the signal handlers below (a `finally` does not run on SIGINT), that is what
 * makes "safe to rerun" true rather than merely claimed.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

type Mutation = {
  /** What claim this breaks, in the words the test is about. */
  claim: string;
  file: string;
  target: string;
  replacement: string;
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
    target:
      '.filter(([, column]) => column.dataType === "boolean")\n  .map(([name]) => name as PrivacyColumn);',
    replacement:
      '.filter(([, column]) => column.dataType === "boolean")\n  .filter(([name]) => name !== "shareFinancials")\n  .map(([name]) => name as PrivacyColumn);',
    suite: DEFAULTS_SUITE,
  },
  {
    claim: "the ON write is gated on the claim the accept won",
    file: DEFAULTS,
    target: '            eq(organizationInvitations.status, "accepted"),\n',
    replacement: "",
    suite: DEFAULTS_SUITE,
  },
  {
    claim: "an already-associated plant keeps the toggles it turned off",
    file: DEFAULTS,
    target:
      "            isNull(churches.sendingChurchId),\n            isNull(churches.sendingNetworkId)\n",
    replacement: "",
    suite: DEFAULTS_SUITE,
  },
  {
    claim: "a plant with no privacy row still gets one",
    file: DEFAULTS,
    target:
      "    .onConflictDoUpdate({\n      target: churchPrivacySettings.churchId,",
    replacement:
      "    .onConflictDoNothing({\n      target: churchPrivacySettings.churchId,",
    suite: DEFAULTS_SUITE,
  },
  {
    claim: "the DB column defaults stay FALSE",
    file: "src/db/schema/church-privacy-settings.ts",
    target: 'sharePeople: boolean("share_people").default(false).notNull()',
    replacement: 'sharePeople: boolean("share_people").default(true).notNull()',
    suite: DEFAULTS_SUITE,
  },
  {
    claim: "the sharing write is IN the acceptance batch",
    file: CORE,
    target: "    claim,\n    sharing,\n    association,",
    replacement: "    claim,\n    association,",
    suite: ACCEPT_SUITE,
  },
  {
    claim:
      "the sharing write reads the plant BEFORE the association sets its FK",
    file: CORE,
    target: "    claim,\n    sharing,\n    association,\n    audit,",
    replacement: "    claim,\n    association,\n    audit,\n    sharing,",
    suite: DEFAULTS_SUITE,
  },
  {
    claim: "the registration screen states the consent before accepting",
    file: "src/app/(auth)/register/register-form.tsx",
    target: "{INVITE_ORIGIN_SHARING_CONSENT.map((line) => (",
    replacement: "{[].map((line: string) => (",
    suite: DEFAULTS_SUITE,
  },
  {
    claim: "the association read states the consent before accepting",
    file: "src/lib/settings/section-data.ts",
    target:
      "      consent: associations.length === 0 ? INVITE_ORIGIN_SHARING_CONSENT : null,\n",
    replacement: "      consent: null,\n",
    suite: DEFAULTS_SUITE,
  },
  {
    // #657 SPLIT THE SCREEN IN TWO, so gutting it takes two mutations. The one
    // above stops the copy being CHOSEN; this one lets it be chosen and then
    // drops it on the floor, which is the failure a source guard reading only
    // the loader would report as a pass.
    claim: "the association section renders the consent it is handed",
    file: "src/components/settings/sections/association-section.tsx",
    // Unindented, like its sibling above: #677 re-indented this block and the
    // target's leading spaces stopped matching, which is rot with no copy
    // change behind it at all. #678 requoted it at the new column; dropping the
    // indentation instead is what stops the next reformat rotting it again.
    // The rule is the SHORTEST quotation that matches exactly once —
    // indentation earns its place in a target only where it is what makes the
    // match unique, as it is in the `claim,\n    sharing,` ones.
    target: "{consent.map((line) => (",
    replacement: "{[].map((line: string) => (",
    suite: DEFAULTS_SUITE,
  },
  {
    claim: "no screen invents a reversibility promise of its own",
    file: "src/components/settings/sections/association-section.tsx",
    target:
      'consequence="Accepting lists your plant in their directory with its name, phase and launch date."',
    replacement:
      'consequence="Accepting lists your plant in their directory — all of which you can change afterwards."',
    suite: COPY_SUITE,
  },
  {
    claim: "the consent copy names every consent-exempt event",
    file: COPY,
    // THIS TARGET HAD GONE STALE, and the harness said so rather than reporting a
    // pass: the copy grew a fourth exempt event ("when you close something you
    // were sharing") while this string still said "Three things", so from that
    // day until #657 this mutation could not be applied and the claim it proves
    // was unproven. The lesson is the harness's own — a target is a quotation,
    // and a quotation rots.
    target:
      '  "Four things reach them either way, because the relationship itself is theirs too:' +
      " when you accept their invitation, when you decline one, when your association with them ends," +
      ' and when you close something you were sharing.",\n] as const;',
    replacement: "] as const;",
    suite: COPY_SUITE,
  },
];

const TOUCHED = [...new Set(MUTATIONS.map((m) => m.file))];

/**
 * The targets that no longer quote their file, one line each — empty is green.
 *
 * A TARGET IS A QUOTATION, AND A QUOTATION ROTS: a copy wave renames a word
 * (#676 turned "stage" into "phase"), a review re-indents a block (#677), and
 * the mutation that quoted it can no longer be applied. The claim it proves
 * then goes unproven, silently, because a harness has no way to tell "this bug
 * was caught" from "this bug was never introduced".
 *
 * So this runs BEFORE any suite, and `cs013-mutation-check.test.ts` runs it
 * again in `pnpm test` — which is where it matters. The harness below is a
 * manual reviewer tool that no workflow invokes, so its exit code has never
 * reached CI; by the time #681 was filed, two targets had gone stale and
 * nothing anywhere had gone red. The test is the half that fails on the day of
 * the rename, in the PR that causes it.
 *
 * THE REMEDY TRAVELS IN THE MESSAGE, not in a console.error next to the caller.
 * The reader who needs it most meets this through a failed assertion in CI, and
 * would never see anything the CLI printed alongside.
 */
export function staleTargets(): string[] {
  return MUTATIONS.flatMap((mutation) => {
    const source = readFileSync(path.join(REPO, mutation.file), "utf8");
    const matches = source.split(mutation.target).length - 1;
    if (matches === 1) return [];
    return [
      `STALE TARGET — "${mutation.claim}": ${matches} matches in ` +
        `${mutation.file}, expected 1. That claim is unproven, not unbroken.\n` +
        `  target: ${JSON.stringify(mutation.target)}\n` +
        "  Requote the target from the file, or delete the mutation if the " +
        "claim is gone.\n" +
        "  But check `git status` first: a harness run killed outside its " +
        "signal handlers leaves\n  its deliberate bug in the file, and " +
        "requoting THAT would make the bug permanent.",
    ];
  });
}

function runSuite(suite: string): boolean {
  try {
    execFileSync("pnpm", ["exec", "tsx", "--test", suite], {
      cwd: REPO,
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

/** Files currently holding a mutation, so a signal can put them back. */
const inFlight = new Map<string, string>();

function restoreAll(): void {
  for (const [file, original] of inFlight) writeFileSync(file, original);
  inFlight.clear();
}

function main(): void {
  // A DIRTY TREE IS REFUSED, not warned about — see the header. Uncommitted work
  // in one of these files is indistinguishable from a mutation a killed run left
  // behind, and restoring over it would destroy real edits.
  try {
    execFileSync("git", ["diff", "--quiet", "--", ...TOUCHED], {
      cwd: REPO,
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

  // THE TARGETS BEFORE THE SUITES. A stale target used to be counted with the
  // misses and reported as "went undetected" — the same words as a real hole in
  // the tests, for the opposite situation: nothing was ever mutated. It stops
  // the run here instead, so `failures` below means one thing only.
  const stale = staleTargets();
  if (stale.length > 0) {
    console.error(stale.join("\n\n"));
    process.exit(1);
  }

  // `finally` does not run on a signal, and an interrupted run that left a
  // deliberate bug in a checked-in file is the worst thing this script could do.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      restoreAll();
      console.error(
        `\n${signal} — restored ${TOUCHED.length} file(s), exiting`
      );
      process.exit(130);
    });
  }

  // The baseline first: a harness reporting "caught" against an already red
  // suite proves nothing at all.
  for (const suite of new Set(MUTATIONS.map((m) => m.suite))) {
    if (!runSuite(suite)) {
      console.error(`BASELINE RED — ${suite} fails before any mutation`);
      process.exit(1);
    }
    console.log(`baseline green  ${suite}`);
  }
  console.log("");

  let failures = 0;

  for (const mutation of MUTATIONS) {
    const file = path.join(REPO, mutation.file);
    const original = readFileSync(file, "utf8");

    // THE GATE ABOVE RAN MINUTES AGO, three baseline suites back, and this is a
    // second read. A file that changed in between (a formatter hook, an editor
    // save, another agent in the same worktree) makes `replace` a no-op, the
    // suite stay green, and the report say MISSED — the words for a hole in the
    // tests, for a mutation that was never applied. So assert the WRITE, which
    // is the real invariant and not merely "the target appeared once".
    //
    // `() => mutation.replacement` and not the bare string: as a string, `$&`,
    // `$1` and friends are substitution syntax, and one replacement quoting a
    // `$` would corrupt the file this harness restores byte for byte.
    const mutated = original.replace(
      mutation.target,
      () => mutation.replacement
    );
    if (mutated === original) {
      throw new Error(
        `TARGET VANISHED MID-RUN — "${mutation.claim}" no longer quotes ` +
          `${mutation.file}. The tree changed under this run; nothing was ` +
          "mutated and nothing is proven. Rerun on a settled tree."
      );
    }

    inFlight.set(file, original);
    writeFileSync(file, mutated);

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
}

// Importing this module must run nothing: `cs013-mutation-check.test.ts` pulls
// `staleTargets` out of it, and everything in `main()` rewrites checked-in files.
// Same guard as `scripts/db-migrate.ts` and `scripts/restamp-migration.ts`.
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  main();
}
