import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Building2, Inbox } from "lucide-react";

import { HeaderBreadcrumbs } from "@/components/header";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { verifySession } from "@/lib/auth/session";
import { formatDate } from "@/lib/datetime";

import { InvitationAnswer } from "./invitation-answer";
import { LeaveNetworkDialog } from "./leave-network-dialog";
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
//     sending church, and may also leave the network it is in (OV-013).
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
//
// ----------------------------------------------------------------------------
// WHY EACH SECTION IS A CARD (design pass, #304 "UI ruling round 3")
// ----------------------------------------------------------------------------
//
// The first build put heading, helper sentence and content box on the shell's
// bare background at one shared left edge with near-uniform gaps, so nothing
// on the screen said which sentence belonged to which box — the reviewer read
// the empty state as unrelated to the heading above it. A card is the
// project's existing answer to that, and `/oversight/invitations` — the other
// half of this same feature — already uses it: one surface per question, the
// question's title and its explanation inside that surface, the answer
// underneath. Matching it means an admin and a planter looking at the two ends
// of one invitation see the same structure.
//
// The semantics do NOT come from the card. `CardTitle` is a `div`; the section
// headings here stay real `<h2>` elements owned by their `<section
// aria-labelledby=…>`, so the page keeps a navigable outline that the
// reference surface does not have.
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

      {/*
        Two spacing steps, not one. The page header sits 32px above the stack of
        cards and the cards sit 24px apart, while the gaps inside a card are
        8px and under — so every gap is at least double the gap one level down
        and the grouping reads without a single separator line.
      */}
      <div className="mx-auto w-full max-w-3xl space-y-8 p-4 md:p-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Association</h1>
          <p className="text-muted-foreground text-sm text-pretty">{intro}</p>
        </div>

        <div className="space-y-6">{children}</div>
      </div>
    </>
  );
}

/**
 * The section title, styled like `CardTitle` but kept a real heading.
 *
 * `CardTitle` renders a `div`, which would leave this page with an `h1` and no
 * sections under it. The id is what its `<section aria-labelledby>` points at.
 */
function SectionTitle({ id, children }: { id: string; children: string }) {
  return (
    <h2 id={id} className="leading-none font-semibold tracking-tight">
      {children}
    </h2>
  );
}

/**
 * A section with nothing in it yet — oriented, not a shrug.
 *
 * Centered inside its card rather than left-aligned in a dashed box: the dashed
 * rectangle the first build used reads as a drop target, and left-aligning it
 * on the same edge as the heading was half of why the two looked unrelated.
 */
function EmptySection({
  icon: Icon,
  title,
  detail,
}: {
  icon: typeof Inbox;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center">
      <Icon className="text-muted-foreground size-5" aria-hidden="true" />
      <p className="font-medium">{title}</p>
      <p className="text-muted-foreground max-w-prose text-sm text-pretty">
        {detail}
      </p>
    </div>
  );
}

/**
 * The pending-invitations section, shared by both views.
 *
 * Both roles are answering the same question — "shall we join them?" — with the
 * same two buttons and the same "nothing happens until you accept" promise, so
 * they get one component. What differs is the sentence explaining what
 * accepting exposes, which is a prop.
 *
 * THE PROMISE AND THE EMPTY STATE ARE NEVER BOTH ON SCREEN. "Nothing is
 * associated until you accept" is addressed to somebody who has an invitation
 * in front of them; when there is none it said nothing and sat one line above
 * an empty state that repeated it. It is now the card's description in the one
 * state where it has a referent, and the empty state speaks alone in the other.
 * The consequence sentence moved up here for the same reason — it is a property
 * of accepting, not of one invitation, and it was repeated per row.
 */
function PendingInvitations({
  invitations,
  subjectNoun,
  emptyDetail,
  consequence,
}: {
  invitations: PendingInvitationView[];
  /** What is being invited, so the row names it: "your plant", "your sending church". */
  subjectNoun: string;
  emptyDetail: string;
  consequence: string;
}) {
  return (
    <section aria-labelledby="pending-invitations">
      <Card className="shadow-sm">
        <CardHeader>
          <SectionTitle id="pending-invitations">Invitations</SectionTitle>
          {invitations.length > 0 && (
            <CardDescription className="text-pretty">
              Nothing is associated until you accept. {consequence}
            </CardDescription>
          )}
        </CardHeader>

        <CardContent>
          {invitations.length === 0 ? (
            <EmptySection
              icon={Inbox}
              title="No invitations waiting"
              detail={emptyDetail}
            />
          ) : (
            <ul className="divide-border divide-y">
              {invitations.map((invitation) => (
                <li
                  key={invitation.id}
                  className="space-y-3 py-4 first:pt-0 last:pb-0"
                >
                  <div className="space-y-0.5">
                    <p className="font-medium">
                      {invitation.orgName} invited {subjectNoun}
                    </p>
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
                  </div>
                  <InvitationAnswer
                    invitationId={invitation.id}
                    orgName={invitation.orgName}
                  />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * One organization you belong to, with the control that ends it.
 *
 * The name and what it is to you lead; the sever sits on the trailing edge in
 * the same place on every row, which is what keeps it from reading as one more
 * piece of the record.
 */
function AssociationRow({
  orgName,
  roleLabel,
  action,
}: {
  orgName: string;
  roleLabel: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium">{orgName}</p>
        <p className="text-muted-foreground text-sm">{roleLabel}</p>
      </div>
      {action}
    </div>
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
        emptyDetail="A sending church or network invites you by email. Their invitation appears here for you to accept or decline."
        consequence="Accepting lists your plant in their directory with its name, stage and launch date. What else they hear about stays yours to decide, on the sharing screen."
      />

      <section aria-labelledby="current-associations">
        <Card className="shadow-sm">
          <CardHeader>
            <SectionTitle id="current-associations">
              Who you belong to
            </SectionTitle>
            <CardDescription className="text-pretty">
              A plant can belong to a sending church and to a network. Leaving
              one leaves the other standing.
            </CardDescription>
          </CardHeader>

          <CardContent>
            {associations.length === 0 ? (
              <EmptySection
                icon={Building2}
                title="Your plant is independent"
                detail="It belongs to no sending church or network."
              />
            ) : (
              <ul className="divide-border divide-y">
                {associations.map((association) => (
                  <li
                    key={`${association.orgType}:${association.orgId}`}
                    className="py-4 first:pt-0 last:pb-0"
                  >
                    <AssociationRow
                      orgName={association.orgName}
                      roleLabel={
                        association.orgType === "sending_church"
                          ? "Your sending church"
                          : "Your network"
                      }
                      action={
                        <LeaveOrgDialog
                          orgType={association.orgType}
                          orgName={association.orgName}
                        />
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
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
        emptyDetail="A church planting network invites you by email. Their invitation appears here for you to accept or decline."
        consequence="Accepting lists your sending church in that network's directory. It does not change what your own church plants share with you, or with anyone else."
      />

      <NetworkAssociation network={network} />
    </AssociationShell>
  );
}

/**
 * The sending church's own network, with the Leave control (OV-013).
 *
 * THE BUTTON WAITED ON THE SCHEMA, NOT ON A DESIGN QUESTION. #274 requires
 * three things of any sever — type-to-confirm, a notification, an
 * `association_events` row — and until migration 0036 the audit table made a
 * CHURCH its mandatory subject, so a sending church leaving a network had
 * nowhere to be recorded. Shipping the button then would have been a sever with
 * no record of who ended it, the one thing that ruling forbids. Ruling #351 gave
 * the table a subject discriminator, and all three obligations are met here:
 * the dialog types the network's name, `leaveNetworkAsSendingChurchAdmin` writes
 * the FK null and the audit row as ONE statement, and the network is told on the
 * milestone rail it now has an anchor for.
 */
function NetworkAssociation({
  network,
}: {
  network: CurrentAssociationView | null;
}) {
  return (
    <section aria-labelledby="current-associations">
      <Card className="shadow-sm">
        <CardHeader>
          <SectionTitle id="current-associations">
            Who you belong to
          </SectionTitle>
          <CardDescription className="text-pretty">
            A sending church belongs to at most one church planting network.
          </CardDescription>
        </CardHeader>

        <CardContent>
          {network === null ? (
            <EmptySection
              icon={Building2}
              title="Your sending church is independent"
              detail="It belongs to no network."
            />
          ) : (
            <AssociationRow
              orgName={network.orgName}
              roleLabel="Your network"
              action={<LeaveNetworkDialog networkName={network.orgName} />}
            />
          )}
        </CardContent>
      </Card>
    </section>
  );
}
