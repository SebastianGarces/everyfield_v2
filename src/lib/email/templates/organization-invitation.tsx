import {
  Button,
  Heading,
  Hr,
  Link,
  Section,
  Text,
  render,
} from "@react-email/components";

import { BaseLayout } from "../components/base-layout";

// ============================================================================
// The organization invitation email — OV-003b (#293).
//
// The one message an invited planter or sending-church admin ever receives
// before they have an account. Everything about it follows from that:
//
//   * IT IS THE CREDENTIAL CHANNEL, and it says so. The link carries an
//     invitation token that only works for the address in the `To:` line
//     (`registrationEmailMatchesInvitation`, ruled 2026-08-04), so forwarding
//     it hands somebody a link they cannot use — worth one plain sentence
//     rather than a support conversation a week later.
//   * IT IS TRANSACTIONAL, not a notification. There is no recipient account,
//     therefore no preference row, therefore no category to unsubscribe from
//     and no `List-Unsubscribe` header. `src/lib/notifications/**` is not on
//     this path; see `src/lib/invitations/email.ts`.
//   * IT NAMES WHAT ACCEPTING DOES. The invitee is consenting to an oversight
//     association, and what that association exposes is a fixed, ungated set —
//     name, stage, launch countdown, health (`getOversightPlantHealth`) — with
//     the six `share_*` toggles OFF until they turn one on
//     (memory/invariants.md → Hierarchical Access Control). The copy states
//     exactly that and claims nothing further.
//
// Layout rules are `.agents/skills/react-email/SKILL.md`: no flexbox/grid, no
// media queries, no `rem`, no images at all, everything in a single 600px
// column with inline pixel styles — the same shape as the sibling templates in
// this directory.
// ============================================================================

/** Which kind of organization issued the invitation. */
export type InvitingOrgKind = "sending church" | "network";

/** What the invitee sets up by accepting. */
export type InviteeOrgKind = "church plant" | "sending church";

export interface OrganizationInvitationEmailProps {
  /** The inviting organization's own name — never an id. */
  invitingOrgName: string;
  invitingOrgKind: InvitingOrgKind;
  inviteeOrgKind: InviteeOrgKind;
  /**
   * The address the invitation was issued to. Rendered in the body on purpose:
   * it is the half of the credential the reader has to match, and a reader who
   * cannot see which address is meant registers with the wrong one.
   */
  inviteeEmail: string;
  /** Absolute, token-bound register URL. Relative hrefs mean nothing in a mail client. */
  inviteUrl: string;
  /** Already formatted against `APP_TIME_ZONE`; null when the row has no expiry. */
  expiresLabel: string | null;
}

/** The subject. Names the org first — in a crowded inbox that is the only word guaranteed to be read. */
export function organizationInvitationSubject(invitingOrgName: string): string {
  return `${invitingOrgName} invited you to EveryField`;
}

/** The preheader. Kept under 90 characters, which is all any client shows. */
export function organizationInvitationPreview(
  inviteeOrgKind: InviteeOrgKind
): string {
  return `Set up your ${inviteeOrgKind} — this invite link only works for this address.`;
}

function OrganizationInvitationEmail({
  invitingOrgName,
  invitingOrgKind,
  inviteeOrgKind,
  inviteeEmail,
  inviteUrl,
  expiresLabel,
}: OrganizationInvitationEmailProps) {
  return (
    <BaseLayout
      preview={organizationInvitationPreview(inviteeOrgKind)}
      footerText={invitingOrgName}
    >
      <Heading style={heading}>
        {invitingOrgName} invited you to EveryField
      </Heading>

      <Text style={text}>
        <strong>{invitingOrgName}</strong>, a {invitingOrgKind} on EveryField,
        invited you to set up your {inviteeOrgKind}.
      </Text>

      {/*
        Two audiences, two true sentences. A church plant is heading for a
        launch date; a sending church is looking after plants that have one.
        One sentence for both told half the readers about a launch they are not
        planning, which is exactly the kind of near-miss that makes a reader
        wonder whether the message was meant for them.
      */}
      <Text style={text}>
        {inviteeOrgKind === "church plant"
          ? "EveryField is where a church plant plans its launch, tracks the people it is reaching, and keeps its team on the same page."
          : "EveryField is where a sending church keeps track of the plants it supports — where each one is, what it needs next, and how it is doing."}
      </Text>

      <Section style={buttonRow}>
        <Button href={inviteUrl} style={button}>
          Accept and create your account
        </Button>
      </Section>

      <Text style={fallback}>
        If the button does not work, paste this address into your browser:
        <br />
        <Link href={inviteUrl} style={fallbackLink}>
          {inviteUrl}
        </Link>
      </Text>

      <Hr style={rule} />

      <Text style={sectionHeading}>What accepting means</Text>
      {/*
        The consent sentence, and it may not overstate OR understate what the
        association exposes (memory/invariants.md → Hierarchical Access
        Control). A plant's portfolio row — name, stage, launch countdown,
        health — is UNGATED, so "they see nothing until you share" would be
        false; the six `share_*` toggles default off, so implying full
        visibility would be false the other way. A sending church joining a
        network is a different exposure again: the network sees the sending
        church and the plants under it, and each of those plants still decides
        its own sharing.
      */}
      {inviteeOrgKind === "church plant" ? (
        <Text style={text}>
          You create your EveryField account and your church plant, and it
          arrives already connected to {invitingOrgName}. They will see it
          listed with its name, its stage, its launch countdown and how it is
          doing. Everything beyond that — your people, meetings, teams and tasks
          — stays off until you choose to share it in your settings.
        </Text>
      ) : (
        <Text style={text}>
          You create your EveryField account and your sending church, and it
          joins {invitingOrgName}. They will see your sending church and the
          church plants under it. Each of those plants still decides for itself
          what it shares beyond its name, its stage and its launch countdown.
        </Text>
      )}

      <Text style={sectionHeading}>This link belongs to this address</Text>
      <Text style={text}>
        The invitation is issued to <strong>{inviteeEmail}</strong>, and it only
        works for that address. Please do not forward this email — a link that
        reaches anybody else cannot be used to sign up. If the address is wrong,
        ask {invitingOrgName} to revoke this invitation and send a new one.
      </Text>

      {expiresLabel && (
        <Text style={text}>This invitation expires on {expiresLabel}.</Text>
      )}

      <Text style={quiet}>
        Were you not expecting this? You can ignore this email — nothing is
        created and nothing is shared until you accept.
      </Text>
    </BaseLayout>
  );
}

/**
 * Render the invitation email. Returns the plain-text part alongside the HTML:
 * a text/plain alternative is what a text-only client, an accessibility reader
 * and a spam filter each read, and an HTML-only transactional message scores
 * worse on all three.
 */
export async function organizationInvitationEmail(
  props: OrganizationInvitationEmailProps
): Promise<{ subject: string; html: string; text: string }> {
  const subject = organizationInvitationSubject(props.invitingOrgName);
  const html = await render(OrganizationInvitationEmail(props));
  const text = await render(OrganizationInvitationEmail(props), {
    plainText: true,
  });
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Styles. Inline pixel values, matching the sibling templates: email clients
// support neither `rem` nor a stylesheet, and half of them strip `<style>`.
// ---------------------------------------------------------------------------

const heading: React.CSSProperties = {
  fontSize: "24px",
  fontWeight: 600,
  color: "#111827",
  lineHeight: "1.3",
  margin: "0 0 16px",
};

const sectionHeading: React.CSSProperties = {
  fontSize: "16px",
  fontWeight: 600,
  color: "#111827",
  margin: "0 0 8px",
};

const text: React.CSSProperties = {
  fontSize: "16px",
  color: "#4b5563",
  lineHeight: "1.6",
  margin: "0 0 16px",
};

const buttonRow: React.CSSProperties = {
  margin: "24px 0",
  textAlign: "center",
};

const button: React.CSSProperties = {
  backgroundColor: "#111827",
  border: "1px solid #111827",
  borderRadius: "6px",
  boxSizing: "border-box",
  color: "#ffffff",
  display: "inline-block",
  fontSize: "16px",
  fontWeight: 600,
  lineHeight: "1.2",
  // 14px of vertical padding on a 16px/1.2 label clears the 44px tap target
  // every mobile guideline asks for, without a fixed height that would clip a
  // client that bumps the font size.
  padding: "14px 28px",
  textAlign: "center",
  textDecoration: "none",
};

const fallback: React.CSSProperties = {
  fontSize: "13px",
  color: "#6b7280",
  lineHeight: "1.6",
  margin: "0 0 16px",
  // A URL has no spaces to break at, so a narrow client would otherwise widen
  // the whole message to fit it.
  wordBreak: "break-all",
};

const fallbackLink: React.CSSProperties = {
  color: "#4b5563",
  textDecoration: "underline",
};

const rule: React.CSSProperties = {
  borderColor: "#e5e7eb",
  margin: "24px 0",
};

const quiet: React.CSSProperties = {
  fontSize: "13px",
  color: "#6b7280",
  lineHeight: "1.6",
  margin: "16px 0 0",
};
