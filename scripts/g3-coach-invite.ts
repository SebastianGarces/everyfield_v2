// ============================================================================
// The coach invite flow, driven against a REAL database (#496).
//
// WHY THIS EXISTS: the invitation link is a 256-bit token that is stored HASHED,
// so it exists in plaintext only in transit to the invitee's inbox. A browser
// pass cannot read that inbox, and the database cannot reproduce the link — so
// without a way to capture the URL at the moment it is composed, the accept half
// of this flow is unreachable to validation and only the create half could ever
// be proven.
//
// This is that capture, and nothing more: it calls the SAME
// `createUserInvitationAs` the action calls, with a `send` stub in place of the
// provider, and prints the URL the email would have carried. Everything else —
// the authority check, the cap, the refusal predicate, the insert — runs
// untouched.
//
// Run it, take the printed URL into the browser, and the accept, the assignment,
// the nav section and the read are all exercised through the product's own UI.
//
//   pnpm exec tsx --env-file-if-exists=.env.local scripts/g3-coach-invite.ts \
//     --inviter <email> --coach <email> [--base https://<preview>]
//
// It writes to whatever `DATABASE_URL` names. Point it at development.
// ============================================================================

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { coachAssignments, userInvitations, users } from "@/db/schema";
import { invitationActorFromSession } from "@/lib/invitations/core";
import { createUserInvitationAs } from "@/lib/invitations/seat";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const inviterEmail = arg("inviter");
  const coachEmail = arg("coach");
  const baseUrl = arg("base");

  if (!inviterEmail || !coachEmail) {
    console.error(
      "usage: --inviter <email> --coach <email> [--base https://<preview>]"
    );
    process.exit(1);
  }

  const [inviter] = await db
    .select()
    .from(users)
    .where(eq(users.email, inviterEmail.toLowerCase()))
    .limit(1);

  if (!inviter) throw new Error(`no account for ${inviterEmail}`);

  console.log(
    `inviter: ${inviter.email} — seat=${inviter.seat} church=${inviter.churchId}`
  );

  // THE STUB IS THE ONLY SUBSTITUTION. It captures the message the provider
  // would have been handed; the row, its token hash and every guard above it are
  // the product's own.
  let inviteUrl: string | null = null;

  const created = await createUserInvitationAs(
    invitationActorFromSession({ user: inviter }),
    { kind: "coach", inviteeEmail: coachEmail },
    {
      baseUrl,
      send: async (message) => {
        inviteUrl =
          message.text.match(/https?:\/\/\S+coach-invitation\S*/)?.[0] ?? null;
        return { success: true };
      },
    }
  );

  console.log(`invitation: ${created.invitation.id}`);
  console.log(`kind:       ${created.invitation.kind}`);
  console.log(`seat:       ${String(created.invitation.seat)} (must be null)`);
  console.log(`church:     ${created.invitation.churchId}`);
  console.log("");
  console.log("OPEN THIS IN THE BROWSER:");
  console.log(inviteUrl ?? "(no URL captured — the email refused to build)");

  // What the invitee's account looks like BEFORE they answer, so the browser
  // pass has a before to compare its after against.
  const [invitee] = await db
    .select({
      id: users.id,
      seat: users.seat,
      churchId: users.churchId,
      sendingChurchId: users.sendingChurchId,
      sendingNetworkId: users.sendingNetworkId,
    })
    .from(users)
    .where(eq(users.email, coachEmail.toLowerCase()))
    .limit(1);

  console.log("");
  console.log(
    invitee
      ? `invitee BEFORE: seat=${String(invitee.seat)} church=${String(invitee.churchId)} sendingChurch=${String(invitee.sendingChurchId)} network=${String(invitee.sendingNetworkId)}`
      : "invitee BEFORE: no account (the stranger path — answer at /register)"
  );

  if (invitee) {
    const assignments = await db
      .select()
      .from(coachAssignments)
      .where(eq(coachAssignments.coachUserId, invitee.id));
    console.log(`invitee assignments BEFORE: ${assignments.length}`);
  }

  const pending = await db
    .select({ id: userInvitations.id, status: userInvitations.status })
    .from(userInvitations)
    .where(eq(userInvitations.id, created.invitation.id));
  console.log(`row status: ${pending[0]?.status}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
