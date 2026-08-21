// ============================================================================
// Undo what the #496 browser pass wrote to the shared development database.
//
// A preview reads the same database every other agent and every local dev
// session reads, so a validation that leaves rows behind changes what the next
// person sees. This removes exactly the two things this pass creates — the coach
// invitations it minted and the assignment one of them produced — and nothing
// else: it names the invitee addresses on the command line and touches no row
// that does not match one.
//
//   pnpm exec tsx --env-file-if-exists=.env.local \
//     scripts/g3-coach-invite-cleanup.ts --coach a@b.c --coach d@e.f
// ============================================================================

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { coachAssignments, userInvitations, users } from "@/db/schema";

function args(name: string): string[] {
  const values: string[] = [];
  process.argv.forEach((value, index) => {
    if (value === `--${name}` && process.argv[index + 1]) {
      values.push(process.argv[index + 1].toLowerCase());
    }
  });
  return values;
}

async function main() {
  const coaches = args("coach");
  if (coaches.length === 0) {
    console.error("usage: --coach <email> [--coach <email> …]");
    process.exit(1);
  }

  const accounts = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.email, coaches));

  for (const account of accounts) {
    const removed = await db
      .delete(coachAssignments)
      .where(eq(coachAssignments.coachUserId, account.id))
      .returning({ id: coachAssignments.id });
    console.log(`${account.email}: removed ${removed.length} assignment(s)`);
  }

  const closed = await db
    .delete(userInvitations)
    .where(
      and(
        eq(userInvitations.kind, "coach"),
        inArray(userInvitations.inviteeEmail, coaches)
      )
    )
    .returning({ id: userInvitations.id });

  console.log(`removed ${closed.length} coach invitation(s)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
