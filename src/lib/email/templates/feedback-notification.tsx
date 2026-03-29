import { Heading, Hr, Section, Text, render } from "@react-email/components";
import { BaseLayout } from "../components/base-layout";

interface FeedbackNotificationEmailProps {
  category: string;
  description: string;
  pageUrl: string | null;
  userName: string;
  userEmail: string;
  churchName: string | null;
  submittedAt: string;
}

function FeedbackNotificationEmail({
  category,
  description,
  pageUrl,
  userName,
  userEmail,
  churchName,
  submittedAt,
}: FeedbackNotificationEmailProps) {
  const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1);

  return (
    <BaseLayout
      preview={`New ${categoryLabel} feedback from ${userName}`}
      footerText="EveryField Feedback System"
    >
      <Heading style={heading}>New Feedback Submitted</Heading>

      <Section style={metaSection}>
        <Text style={metaRow}>
          <strong>Category:</strong>{" "}
          <span style={categoryBadge(category)}>{categoryLabel}</span>
        </Text>
        <Text style={metaRow}>
          <strong>From:</strong> {userName} ({userEmail})
        </Text>
        {churchName && (
          <Text style={metaRow}>
            <strong>Church:</strong> {churchName}
          </Text>
        )}
        {pageUrl && (
          <Text style={metaRow}>
            <strong>Page:</strong> {pageUrl}
          </Text>
        )}
        <Text style={metaRow}>
          <strong>Time:</strong> {submittedAt}
        </Text>
      </Section>

      <Hr style={divider} />

      <Section>
        <Text style={descriptionLabel}>Description</Text>
        <Text style={descriptionText}>{description}</Text>
      </Section>
    </BaseLayout>
  );
}

/**
 * Email template: Feedback Notification
 * Sent to the FEEDBACK_EMAIL_TO address when a user submits feedback.
 */
export async function feedbackNotificationEmail(
  props: FeedbackNotificationEmailProps
): Promise<{ subject: string; html: string; text: string }> {
  const categoryLabel =
    props.category.charAt(0).toUpperCase() + props.category.slice(1);

  const truncatedDesc =
    props.description.length > 50
      ? props.description.slice(0, 50) + "..."
      : props.description;

  const subject = `[EveryField Feedback] ${categoryLabel}: ${truncatedDesc}`;

  const html = await render(FeedbackNotificationEmail(props));
  const text = await render(FeedbackNotificationEmail(props), {
    plainText: true,
  });

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

const metaSection: React.CSSProperties = {
  margin: "0 0 8px",
};

const metaRow: React.CSSProperties = {
  fontSize: "14px",
  color: "#4b5563",
  lineHeight: "1.6",
  margin: "0 0 4px",
};

function categoryBadge(category: string): React.CSSProperties {
  const colors: Record<string, { bg: string; text: string }> = {
    bug: { bg: "#fef2f2", text: "#dc2626" },
    suggestion: { bg: "#eff6ff", text: "#2563eb" },
    question: { bg: "#f0fdf4", text: "#16a34a" },
    other: { bg: "#f9fafb", text: "#6b7280" },
  };

  const c = colors[category] ?? colors.other;

  return {
    backgroundColor: c.bg,
    color: c.text,
    padding: "2px 8px",
    borderRadius: "4px",
    fontSize: "13px",
    fontWeight: 600,
  };
}

const divider: React.CSSProperties = {
  borderColor: "#e5e7eb",
  margin: "16px 0",
};

const descriptionLabel: React.CSSProperties = {
  fontSize: "12px",
  fontWeight: 600,
  color: "#9ca3af",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  margin: "0 0 8px",
};

const descriptionText: React.CSSProperties = {
  fontSize: "15px",
  color: "#1f2937",
  lineHeight: "1.7",
  margin: 0,
  whiteSpace: "pre-wrap",
};
