import { Heading, Section, Text, render } from "@react-email/components";
import { BaseLayout } from "../components/base-layout";

interface MeetingReminderEmailProps {
  personName: string;
  teamName: string;
  meetingTitle: string;
  datetime: Date;
  location: string | null;
  agenda: string | null;
  churchName: string;
}

function MeetingReminderEmail({
  personName,
  teamName,
  meetingTitle,
  datetime,
  location,
  agenda,
  churchName,
}: MeetingReminderEmailProps) {
  const formattedDate = datetime.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const formattedTime = datetime.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <BaseLayout
      preview={`Reminder: ${meetingTitle} - ${teamName}`}
      footerText={churchName}
    >
      <Heading style={heading}>Meeting Reminder</Heading>
      <Text style={text}>Hi {personName},</Text>
      <Text style={text}>
        This is a reminder about an upcoming {teamName} meeting.
      </Text>
      <Section style={detailsBox}>
        <Text style={meetingTitleStyle}>{meetingTitle}</Text>
        <Text style={detail}>
          <strong>Date:</strong> {formattedDate}
        </Text>
        <Text style={detail}>
          <strong>Time:</strong> {formattedTime}
        </Text>
        {location && (
          <Text style={detail}>
            <strong>Location:</strong> {location}
          </Text>
        )}
      </Section>
      {agenda && (
        <Section>
          <Text style={agendaLabel}>Agenda:</Text>
          <Text style={agendaText}>{agenda}</Text>
        </Section>
      )}
    </BaseLayout>
  );
}

/**
 * Email template: Meeting Reminder
 * Sent to team members before a scheduled meeting.
 */
export async function meetingReminderEmail(
  props: MeetingReminderEmailProps
): Promise<{ subject: string; html: string; text: string }> {
  const subject = `Reminder: ${props.meetingTitle} - ${props.teamName}`;
  const html = await render(MeetingReminderEmail(props));
  const text = await render(MeetingReminderEmail(props), { plainText: true });
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

const detailsBox: React.CSSProperties = {
  backgroundColor: "#f3f4f6",
  borderRadius: "6px",
  padding: "20px",
  margin: "0 0 24px",
};

const meetingTitleStyle: React.CSSProperties = {
  fontSize: "18px",
  fontWeight: 600,
  color: "#111827",
  margin: "0 0 12px",
};

const detail: React.CSSProperties = {
  fontSize: "14px",
  color: "#4b5563",
  margin: "0 0 4px",
};

const agendaLabel: React.CSSProperties = {
  fontSize: "14px",
  fontWeight: 600,
  color: "#111827",
  margin: "0 0 8px",
};

const agendaText: React.CSSProperties = {
  fontSize: "14px",
  color: "#4b5563",
  lineHeight: "1.6",
  margin: 0,
  whiteSpace: "pre-wrap",
};
