// ============================================================================
// Oversight invitations — /oversight/invitations (#23 / OV-003).
//
// The surface that makes the invitation service real: create, list, revoke.
// Until this page existed, `createInvitation` had no caller and the oversight
// index pointed at an "Invitations page" that was not there.
//
// This route owns three things a component cannot: the role guard, the
// org-scoped read, and its header breadcrumb (#261 — without a declared trail
// the shell falls back to naming a different page).
//
// SCOPING IS THE LEAK GUARD. `getInvitationsForOrg` takes an actor minted from
// the session and puts the actor's OWN org id in the WHERE, so there is no
// route param, query string or form field anywhere on this screen that names an
// organization — one org cannot read another's invitations because there is
// nothing to ask with.
//
// Rows are narrowed HERE, not in the client component: the raw row carries
// `inviter_user_id`, which nothing on this screen needs and which is never
// handed to the browser. It used to decide a per-row `canRevoke` — RULED
// 2026-08-04 that revoke is ORG-scoped like the list, so every pending row this
// page can see is one this admin may close, and the authority check stays in
// the UPDATE (`revokeInvitationQuery`) rather than in a prop.
//
// THE NARROWING IS ALSO WHAT KEEPS THE ACCOUNT-EXISTENCE ORACLE CLOSED — #304
// ruling 4 item 5, extended to the LIST (2026-08-09) and then to the row's
// CAPTION (2026-08-10). `target_church_id` and `target_sending_church_id` are
// the server's answer to "does this address already have an EveryField
// account", so nothing derived from them — including `type`, which is derived
// from them — may enter an `InvitationListRow`.
//
// The narrowing is no longer written here. It is `toInvitationListRow` in
// `@/lib/invitations/list-row`, one exported pure function, because both times
// this rule was broken it was broken by a field added to an inline `.map()`
// that only regexes over this file were watching (`isOpen` plus a
// `/register?invitation=` Copy-link button, then `kindLabel` off `type`).
// A pure function is something `invitations-ui.test.ts` §9b can CALL for the
// two target shapes an admin can produce and compare, which is the only check
// that sees a transitive derivation. Read that file before adding a field here.
// ============================================================================

import { HeaderBreadcrumbs } from "@/components/header";
import { PageCanvas } from "@/components/layout/page-frame";
import { InvitationCreateForm } from "@/components/oversight/invitation-create-form";
import { InvitationsList } from "@/components/oversight/invitations-list";
import {
  INVITATION_EXPIRY_DAYS,
  getInvitationsForOrg,
  invitationActorFromSession,
} from "@/lib/invitations/core";
import { toInvitationListRow } from "@/lib/invitations/list-row";
import { scopeLabelForOrgType } from "@/lib/oversight/org-label";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import { requireOversightUser } from "@/lib/oversight/session";

export const metadata = {
  title: "Invitations",
};

export default async function OversightInvitationsPage() {
  // Oversight-only, through the guard every /oversight route shares. The action
  // layer enforces the same rule server-side — anyone whose tenancy is a plant
  // who POSTs to `createInvitation` directly is refused by
  // `resolveInvitationRequest`, not merely kept off this page.
  const { user, org } = await requireOversightUser();

  // WHO MAY CHANGE ANYTHING ON THIS SCREEN (#500). The guard above admits every
  // seat in the org, because an org MEMBER reads the same portfolio its Owner
  // does (AS-007, ruling 185 (3)) — and changes none of it. Asking the
  // capability table rather than comparing a seat is what keeps this page and
  // `./actions.ts` reading one rule: `org.invitation.manage` is the verb both
  // the create and the two row controls answer to, so a control can never
  // appear beside an action that would refuse it.
  const canManageInvitations = holdsSeatFor(user, "org.invitation.manage");

  const actor = invitationActorFromSession({ user });
  const invitations = await getInvitationsForOrg(actor);

  const rows = invitations.map(toInvitationListRow);

  return (
    <>
      <HeaderBreadcrumbs items={[{ label: "Invitations" }]} />
      <PageCanvas context="none" contentFocusTarget>
        <div
          data-slot="oversight-invitation-surfaces"
          className="mx-auto min-h-full max-w-6xl space-y-6"
        >
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Invitations
            </h1>
            {/*
          `scopeLabelForOrgType` is the ONE spelling of these two words across
          the oversight surface; this sentence used to re-derive them inline.
        */}
            <p className="text-foreground mt-1 text-sm">
              {canManageInvitations
                ? `Invite church plants to associate with your ${scopeLabelForOrgType(org.type)}, and track what you have sent.`
                : `Every invitation your ${scopeLabelForOrgType(org.type)} has sent, and where each one stands.`}
            </p>
          </div>

          {canManageInvitations && (
            <InvitationCreateForm
              canInviteSendingChurches={org.type === "network"}
              expiryDays={INVITATION_EXPIRY_DAYS}
            />
          )}

          <InvitationsList rows={rows} canAct={canManageInvitations} />
        </div>
      </PageCanvas>
    </>
  );
}
