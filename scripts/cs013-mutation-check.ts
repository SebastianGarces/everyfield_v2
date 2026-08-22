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

const MUTATIONS: Mutation[] = [
  {
    claim: "the ON write covers every toggle the schema has",
    file: "src/lib/auth/sharing-columns.ts",
    from: '.filter(([, column]) => column.dataType === "boolean")\n  .map(([name]) => name as PrivacyColumn);',
    to: '.filter(([, column]) => column.dataType === "boolean")\n  .filter(([name]) => name !== "shareFinancials")\n  .map(([name]) => name as PrivacyColumn);',
    suite: "src/lib/invitations/sharing-defaults.test.ts",
  },
  {
    claim: "the ON write is gated on the claim the accept won",
    file: "src/lib/invitations/core.ts",
    from: 'eq(organizationInvitations.status, "accepted"),\n              eq(\n                organizationInvitations.targetChurchId,',
    to: "eq(\n                organizationInvitations.targetChurchId,",
    suite: "src/lib/invitations/sharing-defaults.test.ts",
  },
  {
    claim: "the ON write reaches only the plant the invitation names",
    file: "src/lib/invitations/core.ts",
    from:
      "eq(\n                organizationInvitations.targetChurchId,\n" +
      "                churchPrivacySettings.churchId\n              )",
    to: "eq(organizationInvitations.id, invitationId)",
    suite: "src/lib/invitations/sharing-defaults.test.ts",
  },
  {
    claim: "the DB column defaults stay FALSE",
    file: "src/db/schema/church-privacy-settings.ts",
    from: 'sharePeople: boolean("share_people").default(false).notNull()',
    to: 'sharePeople: boolean("share_people").default(true).notNull()',
    suite: "src/lib/invitations/sharing-defaults.test.ts",
  },
  {
    claim: "the sharing write is IN the acceptance batch",
    file: "src/lib/invitations/core.ts",
    from: "    audit,\n    sharing,\n  ]);",
    to: "    audit,\n  ]);\n  await sharing;",
    suite: "src/lib/invitations/association.test.ts",
  },
  {
    claim: "the registration screen states the consent before accepting",
    file: "src/app/(auth)/register/register-form.tsx",
    from: "{INVITE_ORIGIN_SHARING_CONSENT.map((line) => (",
    to: "{[].map((line: string) => (",
    suite: "src/lib/invitations/sharing-defaults.test.ts",
  },
  {
    claim: "the association screen states the consent before accepting",
    file: "src/app/(dashboard)/settings/association/page.tsx",
    from: "consent={INVITE_ORIGIN_SHARING_CONSENT}",
    to: "",
    suite: "src/lib/invitations/sharing-defaults.test.ts",
  },
  {
    claim: "the consent copy names every consent-exempt event",
    file: "src/lib/notifications/categories.ts",
    from:
      '  "Three things reach them either way, because the relationship itself is theirs too:' +
      ' when you accept their invitation, when you decline one, and when your association with them ends.",\n] as const;',
    to: "] as const;",
    suite: "src/lib/notifications/oversight.test.ts",
  },
];

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

let failures = 0;

// The baseline first: a mutation harness reporting "caught" against an already
// red suite proves nothing at all.
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

  writeFileSync(file, original.replace(mutation.from, mutation.to));
  let caught: boolean;
  try {
    caught = !runSuite(mutation.suite);
  } finally {
    writeFileSync(file, original);
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
