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
// the UPDATE (`revokeInvitationQuery`) rather than in a prop. Dates are
// formatted here too, against `APP_TIME_ZONE` — a `Date` formatted in the
// visitor's zone and again on the server is a hydration mismatch
// (memory/invariants.md → Date & Time Rendering).
// ============================================================================

import { redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { InvitationCreateForm } from "@/components/oversight/invitation-create-form";
// PROTOTYPE ONLY — the #392 resend-window ruling. Both imports and their two
// mounts below come out with the losing variants once Sebastian rules
// (.claude/skills/prototype/SKILL.md → "Applying the ruling").
import { ResendPrototypeBench } from "@/components/oversight/resend-prototypes";
import {
  PrototypeSwitcher,
  prototypeInitScript,
} from "@/components/prototype-switcher";
import {
  InvitationsList,
  type InvitationListRow,
} from "@/components/oversight/invitations-list";
import { getCurrentSession } from "@/lib/auth";
import { formatDate } from "@/lib/datetime";
import {
  INVITATION_EXPIRY_DAYS,
  getInvitationsForOrg,
  invitationActorFromSession,
} from "@/lib/invitations/core";

export const metadata = {
  title: "Invitations",
};

export default async function OversightInvitationsPage() {
  const { user } = await getCurrentSession();

  if (!user) {
    redirect("/login");
  }

  // Oversight-only. The action layer enforces the same rule server-side — a
  // planter or team member who POSTs to `createInvitation` directly is refused
  // by `resolveInvitationRequest`, not merely kept off this page.
  if (user.role !== "sending_church_admin" && user.role !== "network_admin") {
    redirect("/dashboard");
  }

  const actor = invitationActorFromSession({ user });
  const invitations = await getInvitationsForOrg(actor);

  const rows: InvitationListRow[] = invitations.map((invitation) => ({
    id: invitation.id,
    // Rows predating #23 have no address recorded; say so rather than render a
    // blank identity.
    inviteeEmail: invitation.inviteeEmail ?? "(no address recorded)",
    kindLabel:
      invitation.type === "sending_church_to_network"
        ? "Sending church"
        : "Church plant",
    status: invitation.status,
    isOpen:
      invitation.targetChurchId === null &&
      invitation.targetSendingChurchId === null,
    sentLabel: formatDate(invitation.createdAt, "short"),
    expiresLabel: invitation.expiresAt
      ? formatDate(invitation.expiresAt, "short")
      : null,
  }));

  return (
    <div className="space-y-6 p-6">
      <HeaderBreadcrumbs items={[{ label: "Invitations" }]} />
      <div>
        <h1 className="text-3xl font-bold">Invitations</h1>
        <p className="text-muted-foreground mt-1">
          Invite church plants to associate with your{" "}
          {user.role === "network_admin" ? "network" : "sending church"}, and
          track what you have sent.
        </p>
      </div>

      <InvitationCreateForm
        canInviteSendingChurches={user.role === "network_admin"}
        expiryDays={INVITATION_EXPIRY_DAYS}
      />

      <ResendPrototypeBench />

      <InvitationsList rows={rows} />

      <script
        dangerouslySetInnerHTML={{
          __html: prototypeInitScript("data-resend-proto", "resend-proto", [
            "a",
            "b",
            "c",
            "d",
          ]),
        }}
      />
      <PrototypeSwitcher
        attribute="data-resend-proto"
        storageKey="resend-proto"
        label="Resend"
        options={[
          {
            id: "a",
            label: "A · As built",
            hint: "Always says “Email sent”, including for the dropped duplicate",
          },
          {
            id: "b",
            label: "B · Name the minute",
            hint: "Copy only: a repeat inside the window says it repeated",
          },
          {
            id: "c",
            label: "C · No window",
            hint: "Every press is a new key, so every press really delivers",
          },
          {
            id: "d",
            label: "D · Countdown",
            hint: "Button holds until a new send would actually be delivered",
          },
        ]}
      />
    </div>
  );
}
