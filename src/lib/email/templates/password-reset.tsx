import { Button, Heading, Link, Text, render } from "@react-email/components";
import { BaseLayout } from "../components/base-layout";

export interface PasswordResetEmailProps {
  recipientName: string | null;
  resetUrl: string;
  expiresLabel: string;
}
const text = { fontSize: "16px", lineHeight: "24px", color: "#374151" };
const button = {
  backgroundColor: "#111827",
  borderRadius: "6px",
  color: "#ffffff",
  display: "inline-block",
  fontSize: "16px",
  padding: "12px 20px",
  textDecoration: "none",
};
function PasswordResetEmail({
  recipientName,
  resetUrl,
  expiresLabel,
}: PasswordResetEmailProps) {
  return (
    <BaseLayout preview="Reset your EveryField password. This link works for one hour.">
      <Heading style={{ fontSize: "22px", color: "#111827" }}>
        Reset your password
      </Heading>
      <Text style={text}>
        {recipientName ? `${recipientName}, use` : "Use"} this link to choose a
        new EveryField password. It works once and expires on {expiresLabel}.
      </Text>
      <Button href={resetUrl} style={button}>
        Reset password
      </Button>
      <Text style={text}>
        If you did not ask for this, ignore this message. Your password stays
        the same.
      </Text>
      <Text style={text}>
        After resetting, sign in again. Every existing session will be signed
        out.
      </Text>
      <Text style={text}>
        If the button does not work, copy this link into your browser:{" "}
        <Link href={resetUrl} style={{ wordBreak: "break-all" }}>
          {resetUrl}
        </Link>
      </Text>
    </BaseLayout>
  );
}
export async function passwordResetEmail(props: PasswordResetEmailProps) {
  const email = <PasswordResetEmail {...props} />;
  return {
    subject: "Reset your EveryField password",
    html: await render(email),
    text: await render(email, { plainText: true }),
  };
}
export async function passwordResetNoticeEmail({
  recipientName,
  changedAtLabel,
}: {
  recipientName: string | null;
  changedAtLabel: string;
}) {
  const email = (
    <BaseLayout preview="Your EveryField password was reset. All existing sessions were signed out.">
      <Heading style={{ fontSize: "22px", color: "#111827" }}>
        Your password was reset
      </Heading>
      <Text style={text}>
        {recipientName ? `${recipientName}, your` : "Your"} EveryField password
        was reset on {changedAtLabel}. All existing sessions were signed out.
      </Text>
      <Text style={text}>
        If you did not do this, use Forgot password on the EveryField sign-in
        page to secure your account, and reply to this message for help.
      </Text>
    </BaseLayout>
  );
  return {
    subject: "Your EveryField password was reset",
    html: await render(email),
    text: await render(email, { plainText: true }),
  };
}
