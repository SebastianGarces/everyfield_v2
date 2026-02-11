import { Heading, Text, Section, Row, Column, render } from "@react-email/components";
import { BaseLayout } from "../components/base-layout";
import type { TeamHealthMetrics } from "@/lib/ministry-teams/service";

interface TeamAlertEmailProps {
  recipientName: string;
  churchName: string;
  alerts: TeamHealthMetrics[];
}

function TeamAlertEmail({
  recipientName,
  churchName,
  alerts,
}: TeamAlertEmailProps) {
  const redAlerts = alerts.filter((a) => a.alertLevel === "red");
  const yellowAlerts = alerts.filter((a) => a.alertLevel === "yellow");

  const previewText =
    redAlerts.length > 0
      ? `${redAlerts.length} critical team alert${redAlerts.length !== 1 ? "s" : ""}`
      : `${yellowAlerts.length} team warning${yellowAlerts.length !== 1 ? "s" : ""}`;

  return (
    <BaseLayout preview={previewText} footerText={churchName}>
      <Heading style={heading}>Team Health Alert</Heading>
      <Text style={text}>
        Hi {recipientName}, the following teams at {churchName} need attention:
      </Text>
      <Section style={tableContainer}>
        {/* Table header */}
        <Row style={tableHeader}>
          <Column style={headerCellLeft}>Team</Column>
          <Column style={headerCellCenter}>Staffing</Column>
          <Column style={headerCellCenter}>Training</Column>
          <Column style={headerCellCenter}>Attendance</Column>
        </Row>
        {/* Table rows */}
        {alerts.map((alert, i) => {
          const color =
            alert.alertLevel === "red"
              ? "#ef4444"
              : alert.alertLevel === "yellow"
                ? "#f59e0b"
                : "#22c55e";
          const label =
            alert.alertLevel === "red"
              ? "Critical"
              : alert.alertLevel === "yellow"
                ? "Warning"
                : "Healthy";

          return (
            <Row key={i} style={tableRow}>
              <Column style={cellLeft}>
                <span style={{ ...dot, backgroundColor: color }} />
                <strong>{alert.teamName}</strong>
                <span style={{ ...alertLabel, color }}> {label}</span>
              </Column>
              <Column style={cellCenter}>{alert.staffingPercent}%</Column>
              <Column style={cellCenter}>{alert.trainingPercent}%</Column>
              <Column style={cellCenter}>
                {alert.meetingAttendancePercent}%
              </Column>
            </Row>
          );
        })}
      </Section>
    </BaseLayout>
  );
}

/**
 * Email template: Team Health Alert
 * Sent to Senior Pastor or team leaders when teams need attention.
 */
export async function teamAlertEmail(
  props: TeamAlertEmailProps
): Promise<{ subject: string; html: string; text: string }> {
  const redAlerts = props.alerts.filter((a) => a.alertLevel === "red");
  const yellowAlerts = props.alerts.filter((a) => a.alertLevel === "yellow");

  const subject = `Team Health Alert: ${
    redAlerts.length > 0
      ? `${redAlerts.length} critical`
      : `${yellowAlerts.length} warning${yellowAlerts.length !== 1 ? "s" : ""}`
  } - ${props.churchName}`;

  const html = await render(TeamAlertEmail(props));
  const text = await render(TeamAlertEmail(props), { plainText: true });

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
  margin: "0 0 24px",
};

const tableContainer: React.CSSProperties = {
  width: "100%",
  fontSize: "14px",
};

const tableHeader: React.CSSProperties = {
  backgroundColor: "#f9fafb",
  borderBottom: "2px solid #e5e7eb",
};

const headerCellLeft: React.CSSProperties = {
  padding: "12px",
  textAlign: "left" as const,
  fontWeight: 600,
};

const headerCellCenter: React.CSSProperties = {
  padding: "12px",
  textAlign: "center" as const,
  fontWeight: 600,
};

const tableRow: React.CSSProperties = {
  borderBottom: "1px solid #e5e7eb",
};

const cellLeft: React.CSSProperties = {
  padding: "12px",
};

const cellCenter: React.CSSProperties = {
  padding: "12px",
  textAlign: "center" as const,
};

const dot: React.CSSProperties = {
  display: "inline-block",
  width: "8px",
  height: "8px",
  borderRadius: "50%",
  marginRight: "8px",
};

const alertLabel: React.CSSProperties = {
  fontSize: "12px",
  marginLeft: "8px",
};
