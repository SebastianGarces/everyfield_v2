import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { verifySession } from "@/lib/auth/session";
import { formatDate } from "@/lib/datetime";

import { InvitationAnswer } from "./invitation-answer";
import { LeaveOrgDialog } from "./leave-org-dialog";
import {
  getCurrentAssociations,
  getPendingInvitationsForPlant,
} from "./queries";

// ============================================================================
// The planter's association area (#304 — OV-004, OV-006, OV-007a).
//
// Its own screen rather than a section of `/settings`, on the same reasoning as
// `/settings/sharing`: `/settings` is about how EveryField reaches YOU and is
// per user; this is about who your plant belongs to, is per church, and is the
// planter's alone. Folding a decision that changes who can see your plant into a
// list of personal notification preferences would make it read as one more
// switch about email volume.
//
// PLANTER-ONLY, and the redirect is not the control. A `team_member` or `coach`
// of the plant is bounced here because there is nothing on this screen they may
// do — but every write behind it refuses them again, server-side
// (`./actions.ts`, OV-010 / ruled #274), so a forged POST that never loaded this
// page is refused by the same statement the buttons are.
//
// EVERY SECTION IS ANSWERED FROM THE SERVER. The two reads run per request
// (`force-dynamic`); nothing is cached and nothing is copied into client state,
// so the moment an invitation is answered `refresh()` re-renders this tree and
// the row is simply gone (`memory/contracts/data-patterns.md`).
// ============================================================================

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Association",
};

export default async function AssociationSettingsPage() {
  const { user } = await verifySession();

  if (user.role !== "planter" || !user.churchId) {
    redirect("/settings");
  }

  const [pending, associations] = await Promise.all([
    getPendingInvitationsForPlant(user.churchId),
    getCurrentAssociations(user.churchId),
  ]);

  return (
    <>
      <HeaderBreadcrumbs
        items={[
          { label: "Settings", href: "/settings" },
          { label: "Association" },
        ]}
      />

      <div className="mx-auto w-full max-w-3xl space-y-8 p-4 md:p-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Association</h1>
          <p className="text-muted-foreground text-sm text-pretty">
            The sending church or network your plant belongs to, and any
            invitation waiting on your answer.
          </p>
        </div>

        <section aria-labelledby="pending-invitations" className="space-y-4">
          <div className="space-y-1">
            <h2
              id="pending-invitations"
              className="text-lg font-semibold tracking-tight"
            >
              Invitations
            </h2>
            <p className="text-muted-foreground text-sm">
              Nothing is associated until you accept.
            </p>
          </div>

          {pending.length === 0 ? (
            <p className="text-muted-foreground rounded-md border border-dashed p-4 text-sm">
              No invitations are waiting. A sending church or network invites
              you by email, and it appears here.
            </p>
          ) : (
            <ul className="space-y-3">
              {pending.map((invitation) => (
                <li key={invitation.id}>
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">
                        {invitation.orgName} invited your plant
                      </CardTitle>
                      <p className="text-muted-foreground text-sm">
                        {invitation.orgType === "sending_church"
                          ? "A sending church"
                          : "A church planting network"}
                        {" · sent "}
                        {formatDate(invitation.createdAt, "short")}
                        {invitation.expiresAt
                          ? ` · expires ${formatDate(invitation.expiresAt, "short")}`
                          : ""}
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <p className="text-muted-foreground text-sm text-pretty">
                        Accepting lists your plant in their directory with its
                        name, stage and launch date. What else they hear about
                        stays yours to decide, on the sharing screen.
                      </p>
                      <InvitationAnswer
                        invitationId={invitation.id}
                        orgName={invitation.orgName}
                      />
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="current-associations" className="space-y-4">
          <div className="space-y-1">
            <h2
              id="current-associations"
              className="text-lg font-semibold tracking-tight"
            >
              Who you belong to
            </h2>
            <p className="text-muted-foreground text-sm">
              A plant can belong to a sending church and to a network. Leaving
              one leaves the other standing.
            </p>
          </div>

          {associations.length === 0 ? (
            <p className="text-muted-foreground rounded-md border border-dashed p-4 text-sm">
              Your plant is independent — it belongs to no sending church or
              network.
            </p>
          ) : (
            <ul className="space-y-3">
              {associations.map((association) => (
                <li
                  key={`${association.orgType}:${association.orgId}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
                >
                  <div className="space-y-0.5">
                    <p className="font-medium">{association.orgName}</p>
                    <p className="text-muted-foreground text-sm">
                      {association.orgType === "sending_church"
                        ? "Your sending church"
                        : "Your network"}
                    </p>
                  </div>
                  <LeaveOrgDialog
                    orgType={association.orgType}
                    orgName={association.orgName}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
