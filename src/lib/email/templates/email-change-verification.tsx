import {
  Button,
  Heading,
  Hr,
  Link,
  Text,
  render,
} from "@react-email/components";

import { BaseLayout } from "../components/base-layout";

// ============================================================================
// CONFIRM A NEW SIGN-IN ADDRESS — CS-002 (#616).
//
// THIS IS THE CREDENTIAL CHANNEL. The link carries a random token, and opening
// it is what moves an account's login identifier onto this address — so the
// message has to answer, in the inbox, the one question a reader who did NOT
// ask for this will have: what happens if I ignore it. It says so plainly, and
// it names the address the request came FROM, which is the fact that tells an
// unexpecting reader whose account is involved.
//
// IT ALSO NEEDS THE SESSION. Confirming asks for the account to be signed in
// (see `@/lib/auth/email-change`), so a forwarded link is inert — worth one
// sentence, because a reader who tries it from the wrong browser otherwise
// reads the sign-in page as a failure.
//
// Layout rules are `.agents/skills/react-email/SKILL.md`: no flexbox/grid, no
// media queries, no `rem`, no images, one 600px column, inline pixel styles.
// ============================================================================

export interface EmailChangeVerificationProps {
  /** The address this message went to — the one being confirmed. */
  newEmail: string;
  /** The address the account signs in with today. Names whose account this is. */
  currentEmail: string;
  /** Who holds the account, when we know. */
  recipientName: string | null;
  /** Absolute, token-bound confirmation URL. A relative href means nothing in an inbox. */
  confirmUrl: string;
  /** Already formatted against `APP_TIME_ZONE`. */
  expiresLabel: string;
}

export function emailChangeVerificationSubject(): string {
  return "Confirm your new EveryField address";
}

/** The preheader. Under 90 characters, which is all any client shows. */
export function emailChangeVerificationPreview(currentEmail: string): string {
  return `Asked from ${currentEmail}. If that was not you, nothing changes — ignore this.`;
}

function EmailChangeVerificationEmail({
  newEmail,
  currentEmail,
  recipientName,
  confirmUrl,
  expiresLabel,
}: EmailChangeVerificationProps) {
  return (
    <BaseLayout preview={emailChangeVerificationPreview(currentEmail)}>
      <Heading style={heading}>Confirm your new address</Heading>

      <Text style={text}>
        {recipientName ? `${recipientName}, an` : "An"} EveryField account
        signed in as <strong>{currentEmail}</strong> asked to move to{" "}
        <strong>{newEmail}</strong>.
      </Text>

      <Text style={text}>
        Confirm below and <strong>{newEmail}</strong> becomes the address that
        account signs in with. Until then nothing changes, and{" "}
        <strong>{currentEmail}</strong> keeps working.
      </Text>

      <Button style={button} href={confirmUrl}>
        Confirm this address
      </Button>

      <Text style={muted}>
        You will be asked to sign in first — the link only works from the
        account that asked for the change, so forwarding it does nothing.
      </Text>

      <Text style={muted}>This link stops working on {expiresLabel}.</Text>

      <Hr style={hr} />

      <Text style={muted}>
        <strong>Did not ask for this?</strong> Ignore this message. Nothing
        changes without the confirmation above, and whoever asked cannot
        complete it without signing in to that account.
      </Text>

      <Text style={muted}>
        If the button does not work, copy this link into your browser:{" "}
        <Link href={confirmUrl} style={link}>
          {confirmUrl}
        </Link>
      </Text>
    </BaseLayout>
  );
}

/** Render to the `{ subject, html, text }` a send needs. */
export async function emailChangeVerificationEmail(
  props: EmailChangeVerificationProps
): Promise<{ subject: string; html: string; text: string }> {
  const element = <EmailChangeVerificationEmail {...props} />;

  return {
    subject: emailChangeVerificationSubject(),
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

const button: React.CSSProperties = {
  backgroundColor: "#111827",
  borderRadius: "6px",
  color: "#ffffff",
  display: "inline-block",
  fontSize: "16px",
  fontWeight: 600,
  margin: "8px 0 20px",
  padding: "12px 20px",
  textDecoration: "none",
};

const link: React.CSSProperties = {
  color: "#2563eb",
  wordBreak: "break-all",
};

const hr: React.CSSProperties = {
  borderColor: "#e5e7eb",
  margin: "24px 0",
};
