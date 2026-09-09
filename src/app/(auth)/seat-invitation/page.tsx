import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentSession } from "@/lib/auth";
import { describeUserInvitationForRegistration } from "@/lib/invitations/seat";
import { invitationRegisterPath, seatInvitationPath } from "@/lib/invitations/register-path";
import { loginPathFor } from "@/lib/auth/safe-redirect";
import { AcceptSeatInvitation } from "./accept-seat-invitation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Seat invitation" };

export default async function SeatInvitationPage({ searchParams }: {
  searchParams: Promise<{ invitation?: string | string[] }>;
}) {
  const { invitation } = await searchParams;
  const token = (Array.isArray(invitation) ? invitation[0] : invitation) ?? "";
  const [described, { user }] = await Promise.all([
    describeUserInvitationForRegistration(token), getCurrentSession(),
  ]);
  if (!described || described.invitedAs.kind !== "seat") return <Card className="w-full max-w-md">
    <CardHeader><CardTitle>This invitation cannot be opened</CardTitle>
      <CardDescription>It may have expired, been withdrawn, or already been answered. Ask the team that invited you to send a new one.</CardDescription>
    </CardHeader>
  </Card>;
  return <Card className="w-full max-w-md">
    <CardHeader>
      <CardTitle>{described.tenancyName} invited you to join</CardTitle>
      <CardDescription>Accept to join as a {described.invitedAs.seat}. Your coaching assignments stay with your account. An account that holds a seat or belongs to a plant or organization cannot accept another seat invitation.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <p className="text-muted-foreground text-sm">This invitation only works for <strong className="text-foreground">{described.inviteeEmail}</strong>.</p>
      {user ? <AcceptSeatInvitation token={token} /> : <div className="space-y-3">
        <Button asChild className="w-full cursor-pointer"><Link href={invitationRegisterPath(token)}>Create your account and accept</Link></Button>
        <p className="text-muted-foreground text-sm">Have an account? <Link className="cursor-pointer underline underline-offset-4" href={loginPathFor(seatInvitationPath(token))}>Sign in to accept</Link>.</p>
      </div>}
    </CardContent>
  </Card>;
}
