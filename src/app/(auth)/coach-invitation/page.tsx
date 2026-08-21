import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentSession } from "@/lib/auth";
import { describeCoachInvitationForViewer } from "@/lib/invitations/coach";
import {
  coachInvitationPath,
  invitationRegisterPath,
} from "@/lib/invitations/register-path";
import type { Metadata } from "next";
import Link from "next/link";
import { AcceptCoachInvitation } from "./accept-coach-invitation";

export const metadata: Metadata = { title: "Coaching invitation" };

// A token lookup is a database read, so nothing here may be cached across
// requests — the same rule `/settings/team` follows.
export const dynamic = "force-dynamic";

/**
 * WHERE A COACH INVITATION IS ANSWERED — the surface AS-009 requires and the
 * seat path has no equivalent of (#496).
 *
 * ONE LINK, TWO READERS. The emailed link cannot fork on whether the invitee
 * already holds an account, because the sender is not allowed to learn that and
 * a link that behaved differently would tell anyone who tried it. So it always
 * lands here, and the fork is on the VIEWER'S OWN SESSION:
 *
 *   * signed in  → Accept, which writes the assignment against THIS account;
 *   * signed out → on to `/register` with the same token, where answering and
 *     creating the account are the same submit.
 *
 * Somebody who has an account but is not signed in sees the sign-up route, signs
 * in instead, and comes back to the same URL. That is one extra step for a case
 * the page cannot detect without becoming the oracle it exists to avoid.
 *
 * A TOKEN THAT DOES NOT RESOLVE IS NOT DESCRIBED. Unknown, expired, revoked,
 * answered, or a SEAT token that this page cannot answer — all render the same
 * panel, so a guessed token learns exactly what a wrong one does.
 */
export default async function CoachInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ invitation?: string | string[] }>;
}) {
  const { invitation } = await searchParams;

  // A repeated query parameter arrives as an array; take the first and let the
  // lookup reject anything malformed.
  const token = Array.isArray(invitation) ? invitation[0] : invitation;

  const [described, { user }] = await Promise.all([
    describeCoachInvitationForViewer(token ?? null),
    getCurrentSession(),
  ]);

  if (!described) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>This invitation cannot be opened</CardTitle>
          <CardDescription>
            It may have expired, been withdrawn, or already been answered. Ask
            the church plant that invited you to send a new one.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{described.churchName} invited you to coach them</CardTitle>
        <CardDescription>
          Accepting lets you read this plant&apos;s people, meetings, teams and
          tasks. Coaching is read-only, so nothing you do changes their work,
          and nothing about your own account changes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-muted-foreground text-sm">
          This invitation was sent to{" "}
          <strong className="text-foreground">{described.inviteeEmail}</strong>,
          and it only works for that address.
        </p>

        {user ? (
          <AcceptCoachInvitation
            token={token ?? ""}
            churchName={described.churchName}
          />
        ) : (
          <div className="space-y-3">
            <p className="text-sm">
              Sign in to accept, or create your EveryField account and accept in
              the same step.
            </p>
            <Button asChild className="w-full cursor-pointer">
              <Link href={invitationRegisterPath(token ?? "")}>
                Create your account and accept
              </Link>
            </Button>
            <p className="text-muted-foreground text-sm">
              Already have an account?{" "}
              <Link
                href={`/login?redirect=${encodeURIComponent(coachInvitationPath(token ?? ""))}`}
                className="cursor-pointer underline underline-offset-4"
              >
                Sign in
              </Link>{" "}
              and come back to this page.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
