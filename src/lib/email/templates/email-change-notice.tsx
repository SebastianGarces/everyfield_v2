import { Heading, Hr, Text, render } from "@react-email/components";

import { BaseLayout } from "../components/base-layout";

// ============================================================================
// "YOUR SIGN-IN ADDRESS CHANGED" — the notice to the address that LOST the
// account (CS-002, #616).
//
// IT CARRIES NO LINK AND NO TOKEN, and that is the design. The change has
// already happened; this message exists so the person who did NOT authorise one
// finds out, and a control in it would be a control offered to whoever now
// holds the account. What it gives them instead is the fact they need to act on
// elsewhere — the address the account moved to, in full.
//
// NOT MASKED. A masked address ("j•••@example.com") tells a reader something
// happened and leaves them nothing to check it against, which turns a security
// notice into an alarm with no next step. The reader of this message held the
// account until a moment ago; the destination is not a stranger's secret being
// disclosed to them, it is the one fact that makes the notice actionable.
//
// Layout rules are `.agents/skills/react-email/SKILL.md`: no flexbox/grid, no
// media queries, no `rem`, no images, one 600px column, inline pixel styles.
// ============================================================================

export interface EmailChangeNoticeProps {
  /** The address this message went to — the one that no longer signs in. */
  previousEmail: string;
  /** Where the account moved. Named in full; see the header. */
  newEmail: string;
  /** Who held the account, when we know. */
  recipientName: string | null;
  /** Already formatted against `APP_TIME_ZONE`. */
  changedAtLabel: string;
}

export function emailChangeNoticeSubject(): string {
  return "Your EveryField sign-in address was changed";
}

/** The preheader. Under 90 characters, which is all any client shows. */
export function emailChangeNoticePreview(newEmail: string): string {
  return `This account now signs in as ${newEmail}. If that was not you, reply to this message.`;
}

function EmailChangeNoticeEmail({
  previousEmail,
  newEmail,
  recipientName,
  changedAtLabel,
}: EmailChangeNoticeProps) {
  return (
    <BaseLayout preview={emailChangeNoticePreview(newEmail)}>
      <Heading style={heading}>Your sign-in address changed</Heading>

      <Text style={text}>
        {recipientName ? `${recipientName}, the` : "The"} EveryField account
        that signed in as <strong>{previousEmail}</strong> now signs in as{" "}
        <strong>{newEmail}</strong>, confirmed on {changedAtLabel}.
      </Text>

      <Text style={text}>
        <strong>{previousEmail}</strong> can no longer be used to sign in to
        that account. Your password did not change.
      </Text>

      <Hr style={hr} />

      <Text style={muted}>
        <strong>Did not do this?</strong> Reply to this message. We can tell
        whether the change came from your account and put it back.
      </Text>
    </BaseLayout>
  );
}

/** Render to the `{ subject, html, text }` a send needs. */
export async function emailChangeNoticeEmail(
  props: EmailChangeNoticeProps
): Promise<{ subject: string; html: string; text: string }> {
  const element = <EmailChangeNoticeEmail {...props} />;

  return {
    subject: emailChangeNoticeSubject(),
    html: await render(element),
    text: await render(element, { plainText: true }),
  };
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const heading: React.CSSProperties = {
  fontSize: "22px",
  fontWeight: 700,
  lineHeight: "28px",
  margin: "0 0 16px",
  color: "#111827",
};

const text: React.CSSProperties = {
  fontSize: "16px",
  lineHeight: "24px",
  margin: "0 0 16px",
  color: "#374151",
};

const muted: React.CSSProperties = {
  fontSize: "14px",
  lineHeight: "20px",
  margin: "0 0 12px",
  color: "#6b7280",
};

const hr: React.CSSProperties = {
  borderColor: "#e5e7eb",
  margin: "24px 0",
};
