"use client";

import { Building2, Inbox } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import type {
  AssociationSectionView,
  CurrentAssociationRow,
  PendingInvitationRow,
} from "@/lib/settings/section-view";

import { InvitationAnswer } from "@/app/(dashboard)/settings/association/invitation-answer";
import { LeaveNetworkDialog } from "@/app/(dashboard)/settings/association/leave-network-dialog";
import { LeaveOrgDialog } from "@/app/(dashboard)/settings/association/leave-org-dialog";

// ============================================================================
// The association area (#304 — OV-004, OV-006, OV-007a; WS3 2026-08-09).
//
// A SECTION OF THE SETTINGS MODAL SINCE #615. The breadcrumbs, the `<h1>` and
// the two role-specific intro sentences became the modal's own title and
// description then, and the cards below carry the role-specific facts they
// always did ("A plant can belong to a sending church and to a network", "A
// sending church belongs to at most one church planting network").
//
// ----------------------------------------------------------------------------
// TWO ROLES, ONE SURFACE (#304 WS3, ruled 2026-08-09)
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
// one surface: the question ("who does my organization belong to, and who is
// asking?") is the same question, and a second address would be a second place
// to forget.
//
// WHICH ROLE IS READING IS A TAG ON THE VIEW, not a pair of nullable halves
// (#657). A planter has associations and no network field; a sending church
// Owner has one network and no list. Whoever can act on neither never reaches
// this component — `readAssociation` answers `{ ok: false }` and the modal
// falls back to the default section, which is what the old `redirect("/settings")`
// did. Every write behind it refuses them again, server-side
// (`association/actions.ts`, `verifyInvitationAuthority`, OV-010 / ruled #274),
// so a forged POST that never opened this section meets the same statement the
// buttons do.
//
// NOTHING HERE IS COPIED INTO CLIENT STATE. The reads run per call, and the
// moment an invitation is answered `refresh()` re-renders the layout, the modal
// re-reads this view, and the row is simply gone
// (`memory/contracts/data-patterns.md`).
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
// aria-labelledby=…>`, so the section keeps a navigable outline under the
// modal's own title that the reference surface does not have.
// ============================================================================

export function AssociationSection({ view }: { view: AssociationSectionView }) {
  if (view.answerer === "plant") {
    return (
      <div className="space-y-6">
        <PendingInvitations
          invitations={view.pending}
          subjectNoun="your plant"
          emptyDetail="A sending church or network invites you by email. Their invitation appears here for you to accept or decline."
          // REWRITTEN BY CS-013, because the old sentence became false. It read
          // "What else they hear about stays yours to decide, on the sharing
          // screen" — true while an accepted plant started out sharing nothing,
          // and a misdescription of an accept that now turns every toggle on.
          //
          // The replacement states the listing and nothing else. It carries NO
          // reversibility clause, deliberately: the first draft said "all of
          // which you can change afterwards", which is false of the listing (it
          // is ungated and lasts as long as the association) and false of six of
          // the seven toggles (no switch exists for them yet). Reversibility is
          // the consent copy's to state, where it is stated precisely.
          consequence="Accepting lists your plant in their directory with its name, stage and launch date."
          consent={view.consent}
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
              {view.associations.length === 0 ? (
                <EmptySection
                  icon={Building2}
                  title="Your plant is independent"
                  detail="It belongs to no sending church or network."
                />
              ) : (
                <ul className="divide-border divide-y">
                  {view.associations.map((association) => (
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
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PendingInvitations
        invitations={view.pending}
        subjectNoun="your sending church"
        emptyDetail="A church planting network invites you by email. Their invitation appears here for you to accept or decline."
        consequence="Accepting lists your sending church in that network's directory. It does not change what your own church plants share with you, or with anyone else."
      />

      <NetworkAssociation network={view.network} />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Shared pieces
// ----------------------------------------------------------------------------

/**
 * The section title, styled like `CardTitle` but kept a real heading.
 *
 * `CardTitle` renders a `div`, which would leave this pane with the modal's
 * title and no sections under it. The id is what its `<section aria-labelledby>`
 * points at.
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
  consent = null,
}: {
  invitations: readonly PendingInvitationRow[];
  /** What is being invited, so the row names it: "your plant", "your sending church". */
  subjectNoun: string;
  emptyDetail: string;
  consequence: string;
  /**
   * CS-013's consent copy, or `null` for an answerer with no sharing to consent
   * to.
   *
   * A PLANT accepting turns every sharing toggle on, so its planter reads what
   * that means before the buttons. A SENDING CHURCH joining a network has no
   * `church_privacy_settings` row in the question at all — the accept writes no
   * toggles for it (`sharingDefaultsStatement` matches no row) — so showing
   * this copy there would describe a consequence that does not happen. The
   * prop is the same decision the statement's WHERE makes, made once more where
   * the reader is.
   */
  consent?: readonly string[] | null;
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
                      {invitation.sentLabel}
                      {invitation.expiresLabel
                        ? ` · expires ${invitation.expiresLabel}`
                        : ""}
                    </p>
                  </div>
                  {/*
                    BEFORE THE BUTTONS, not beside them (CS-013). The planter
                    has to be able to read what accepting shares while the
                    control that does it is still below the copy — a consent
                    notice under the button it qualifies is a notice read after
                    the decision.
                  */}
                  {consent && (
                    <div className="bg-muted/40 space-y-2 rounded-md p-3">
                      <p className="text-sm font-medium">
                        What {invitation.orgName} will see
                      </p>
                      {consent.map((line) => (
                        <p
                          key={line}
                          className="text-muted-foreground max-w-prose text-sm text-pretty"
                        >
                          {line}
                        </p>
                      ))}
                    </div>
                  )}
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
  network: CurrentAssociationRow | null;
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
