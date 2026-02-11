import { Heading, Text, render } from "@react-email/components";
import { BaseLayout } from "../components/base-layout";

interface TeamWelcomeEmailProps {
  personName: string;
  teamName: string;
  roleName: string;
  leaderName: string | null;
  churchName: string;
}

function TeamWelcomeEmail({
  personName,
  teamName,
  roleName,
  leaderName,
  churchName,
}: TeamWelcomeEmailProps) {
  return (
    <BaseLayout
      preview={`Welcome to the ${teamName}!`}
      footerText={churchName}
    >
      <Heading style={heading}>Welcome to the {teamName}!</Heading>
      <Text style={text}>Hi {personName},</Text>
      <Text style={text}>
        You&apos;ve been assigned to the <strong>{roleName}</strong> role on the{" "}
        {teamName} at {churchName}. We&apos;re excited to have you on the team!
      </Text>
      {leaderName && (
        <Text style={text}>
          Your team leader is <strong>{leaderName}</strong>. They&apos;ll be in
          touch with next steps.
        </Text>
      )}
    </BaseLayout>
  );
}

/**
 * Email template: Welcome to a Ministry Team
 * Sent when a person is assigned to a team role.
 */
export async function teamWelcomeEmail(
  props: TeamWelcomeEmailProps
): Promise<{ subject: string; html: string; text: string }> {
  const subject = `Welcome to the ${props.teamName} - ${props.churchName}`;
  const html = await render(TeamWelcomeEmail(props));
  const text = await render(TeamWelcomeEmail(props), { plainText: true });
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const heading: React.CSSProperties = {
  fontSize: "24px",
  fontWeight: 600,
  color: "#111827",
  margin: "0 0 16px",
};

const text: React.CSSProperties = {
  fontSize: "16px",
  color: "#4b5563",
  lineHeight: "1.6",
  margin: "0 0 16px",
};
