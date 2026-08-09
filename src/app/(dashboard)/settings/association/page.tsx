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
  getCurrentNetworkAssociation,
  getPendingInvitationsForPlant,
  getPendingInvitationsForSendingChurch,
  type CurrentAssociationView,
  type PendingInvitationView,
} from "./queries";

// ============================================================================
// The association area (#304 — OV-004, OV-006, OV-007a; WS3 2026-08-09).
//
// Its own screen rather than a section of `/settings`, on the same reasoning as
// `/settings/sharing`: `/settings` is about how EveryField reaches YOU and is
// per user; this is about who your organization belongs to, and it is the one
// person's who may answer for it. Folding a decision that changes who can see
// your plant into a list of personal notification preferences would make it
// read as one more switch about email volume.
//
// ----------------------------------------------------------------------------
// TWO ROLES, ONE SCREEN (#304 WS3, ruled 2026-08-09)
// ----------------------------------------------------------------------------
//
// `memory/invariants.md` → Multi-Tenancy: no invitation that cannot be
// answered, and the rule is per invitation TYPE. Two of the three types can name
// an existing account, and they are answered by different people:
//
//   * a PLANTER answers `church_to_sending_church` / `church_to_network` for
//     their plant, and may also leave an org they are in;
//   * a SENDING CHURCH ADMIN answers `sending_church_to_network` for their
//     sending church.
//
// #304's first build served only the planter, which left a
// `sending_church_admin` targetable with nowhere in the product to answer — the
// dead end HR4 found on 2026-08-09. Sebastian ruled it closed by BUILDING this
// second view rather than by re-gating the invitation path, so the two live on
// one route: the question ("who does my organization belong to, and who is
// asking?") is the same question, and a second URL would be a second place to
// forget.
//
// NEITHER VIEW IS THE CONTROL. Whoever cannot act on either is redirected,
// because there would be nothing on the screen for them — but every write
// behind it refuses them again, server-side (`./actions.ts`,
// `verifyInvitationAuthority`, OV-010 / ruled #274), so a forged POST that never
// loaded this page meets the same statement the buttons do. In particular a
// non-admin member of a sending church is refused by the invitation's own
// authority rule, not by this redirect.
//
// EVERY SECTION IS ANSWERED FROM THE SERVER. The reads run per request
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

  if (user.role === "planter" && user.churchId) {
    return <PlantAssociation churchId={user.churchId} />;
  }

  if (user.role === "sending_church_admin" && user.sendingChurchId) {
    return <SendingChurchAssociation sendingChurchId={user.sendingChurchId} />;
  }

  redirect("/settings");
}

// ----------------------------------------------------------------------------
// Shared shell + sections
// ----------------------------------------------------------------------------

function AssociationShell({
  intro,
  children,
}: {
  intro: string;
  children: React.ReactNode;
}) {
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
          <p className="text-muted-foreground text-sm text-pretty">{intro}</p>
        </div>

        {children}
      </div>
    </>
  );
}

/**
 * The pending-invitations section, shared by both views.
 *
 * Both roles are answering the same question — "shall we join them?" — with the
 * same two buttons and the same "nothing happens until you accept" promise, so
 * they get one component. What differs is the sentence explaining what
 * accepting exposes, which is a prop.
 */
function PendingInvitations({
  invitations,
  subjectNoun,
  emptyCopy,
  consequence,
}: {
  invitations: PendingInvitationView[];
  /** What is being invited, so the title names it: "your plant", "your sending church". */
  subjectNoun: string;
  emptyCopy: string;
  consequence: string;
}) {
  return (
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

      {invitations.length === 0 ? (
        <p className="text-muted-foreground rounded-md border border-dashed p-4 text-sm">
          {emptyCopy}
        </p>
      ) : (
        <ul className="space-y-3">
          {invitations.map((invitation) => (
            <li key={invitation.id}>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    {invitation.orgName} invited {subjectNoun}
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
                    {consequence}
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
  );
}

// ----------------------------------------------------------------------------
// The PLANTER's view (OV-004, OV-006, OV-007a)
// ----------------------------------------------------------------------------

async function PlantAssociation({ churchId }: { churchId: string }) {
  const [pending, associations] = await Promise.all([
    getPendingInvitationsForPlant(churchId),
    getCurrentAssociations(churchId),
  ]);

  return (
    <AssociationShell intro="The sending church or network your plant belongs to, and any invitation waiting on your answer.">
      <PendingInvitations
        invitations={pending}
        subjectNoun="your plant"
        emptyCopy="No invitations are waiting. A sending church or network invites you by email, and it appears here."
        consequence="Accepting lists your plant in their directory with its name, stage and launch date. What else they hear about stays yours to decide, on the sharing screen."
      />

      <section aria-labelledby="current-associations" className="space-y-4">
        <div className="space-y-1">
          <h2
            id="current-associations"
            className="text-lg font-semibold tracking-tight"
          >
            Who you belong to
          </h2>
          <p className="text-muted-foreground text-sm">
            A plant can belong to a sending church and to a network. Leaving one
            leaves the other standing.
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
    </AssociationShell>
  );
}

// ----------------------------------------------------------------------------
// The SENDING CHURCH ADMIN's view (#304 WS3)
// ----------------------------------------------------------------------------

async function SendingChurchAssociation({
  sendingChurchId,
}: {
  sendingChurchId: string;
}) {
  const [pending, network] = await Promise.all([
    getPendingInvitationsForSendingChurch(sendingChurchId),
    getCurrentNetworkAssociation(sendingChurchId),
  ]);

  return (
    <AssociationShell intro="The network your sending church belongs to, and any invitation waiting on your answer.">
      <PendingInvitations
        invitations={pending}
        subjectNoun="your sending church"
        emptyCopy="No invitations are waiting. A church planting network invites you by email, and it appears here."
        consequence="Accepting lists your sending church in that network's directory. It does not change what your own church plants share with you, or with anyone else."
      />

      <NetworkAssociation network={network} />
    </AssociationShell>
  );
}

/**
 * The sending church's own network, READ-ONLY.
 *
 * No Leave control, and the absence is deliberate rather than unfinished: the
 * audited sever (`severAssociationWithAuditStatement`) writes an
 * `association_events` row whose subject column is a CHURCH and is NOT NULL, so
 * a sending church leaving a network has nowhere to be recorded. Shipping the
 * button without the audit would be the one thing #274's ruling forbids — a
 * sever with no record of who ended it — so the button waits on the schema
 * ruling the audit table's own header asks for. Accepting is unaffected: it
 * writes `sending_churches.sending_network_id` and the invitation row carries
 * who answered and when.
 */
function NetworkAssociation({
  network,
}: {
  network: CurrentAssociationView | null;
}) {
  return (
    <section aria-labelledby="current-associations" className="space-y-4">
      <div className="space-y-1">
        <h2
          id="current-associations"
          className="text-lg font-semibold tracking-tight"
        >
          Who you belong to
        </h2>
        <p className="text-muted-foreground text-sm">
          A sending church belongs to at most one church planting network.
        </p>
      </div>

      {network === null ? (
        <p className="text-muted-foreground rounded-md border border-dashed p-4 text-sm">
          Your sending church is independent — it belongs to no network.
        </p>
      ) : (
        <div className="space-y-0.5 rounded-lg border p-4">
          <p className="font-medium">{network.orgName}</p>
          <p className="text-muted-foreground text-sm">Your network</p>
        </div>
      )}
    </section>
  );
}
