// ============================================================================
// The AFTER half of the #496 browser pass, and the facts a screenshot cannot
// show: what the accepting account looks like once it has answered.
//
// AC 2 is "adds one assignment and changes NOTHING else", which is a claim about
// columns nobody renders — the account's tenancy FK and its seat. So the browser
// proves the flow and this proves the shape, on the same row, immediately after.
//
//   pnpm exec tsx --env-file-if-exists=.env.local \
//     scripts/g3-coach-invite-check.ts --coach <email> [--plant <churchId>]
// ============================================================================

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  churchPrivacySettings,
  coachAssignments,
  churches,
  userInvitations,
  users,
} from "@/db/schema";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const coachEmail = arg("coach");
  if (!coachEmail) {
    console.error("usage: --coach <email> [--plant <churchId>]");
    process.exit(1);
  }

  const [account] = await db
    .select({
      id: users.id,
      email: users.email,
      seat: users.seat,
      churchId: users.churchId,
      sendingChurchId: users.sendingChurchId,
      sendingNetworkId: users.sendingNetworkId,
    })
    .from(users)
    .where(eq(users.email, coachEmail.toLowerCase()))
    .limit(1);

  if (!account) throw new Error(`no account for ${coachEmail}`);

  console.log("ACCOUNT AFTER ACCEPTING");
  console.log(`  seat:            ${String(account.seat)}`);
  console.log(`  church_id:       ${String(account.churchId)}`);
  console.log(`  sending_church:  ${String(account.sendingChurchId)}`);
  console.log(`  sending_network: ${String(account.sendingNetworkId)}`);

  const assignments = await db
    .select({
      id: coachAssignments.id,
      churchId: coachAssignments.churchId,
      churchName: churches.name,
      status: coachAssignments.status,
    })
    .from(coachAssignments)
    .innerJoin(churches, eq(churches.id, coachAssignments.churchId))
    .where(eq(coachAssignments.coachUserId, account.id));

  console.log(`  assignments:     ${assignments.length}`);
  for (const row of assignments) {
    console.log(`    - ${row.churchName} (${row.status}) ${row.churchId}`);
  }

  const answered = await db
    .select({
      id: userInvitations.id,
      kind: userInvitations.kind,
      seat: userInvitations.seat,
      status: userInvitations.status,
      respondedBy: userInvitations.respondedBy,
    })
    .from(userInvitations)
    .where(
      and(
        eq(userInvitations.inviteeEmail, coachEmail.toLowerCase()),
        eq(userInvitations.kind, "coach")
      )
    );

  console.log("  invitations:");
  for (const row of answered) {
    console.log(
      `    - ${row.id} kind=${row.kind} seat=${String(row.seat)} status=${row.status} respondedBy=${String(row.respondedBy)}`
    );
  }

  // AC 5's precondition, stated rather than assumed: with every toggle false an
  // OVERSIGHT read is withheld, and the coach read that follows is not.
  const plant = arg("plant") ?? assignments[0]?.churchId;
  if (plant) {
    const [privacy] = await db
      .select()
      .from(churchPrivacySettings)
      .where(eq(churchPrivacySettings.churchId, plant))
      .limit(1);

    console.log(`  share_* on ${plant}:`);
    if (!privacy) {
      console.log("    (no row — every toggle reads as false)");
    } else {
      for (const [key, value] of Object.entries(privacy)) {
        if (key.startsWith("share")) console.log(`    ${key} = ${value}`);
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
