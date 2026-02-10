import type { TeamHealthMetrics } from "@/lib/ministry-teams/service";

/** Escape HTML special characters to prevent injection in emails */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Email template: Team Health Alert
 * Sent to Senior Pastor or team leaders when teams need attention
 */
export function teamAlertEmail({
  recipientName,
  churchName,
  alerts,
}: {
  recipientName: string;
  churchName: string;
  alerts: TeamHealthMetrics[];
}): { subject: string; html: string; text: string } {
  const redAlerts = alerts.filter((a) => a.alertLevel === "red");
  const yellowAlerts = alerts.filter((a) => a.alertLevel === "yellow");

  const subject = `Team Health Alert: ${redAlerts.length > 0 ? `${redAlerts.length} critical` : `${yellowAlerts.length} warning${yellowAlerts.length !== 1 ? "s" : ""}`} - ${churchName}`;

  const alertRows = alerts
    .map((a) => {
      const color =
        a.alertLevel === "red"
          ? "#ef4444"
          : a.alertLevel === "yellow"
            ? "#f59e0b"
            : "#22c55e";
      const label =
        a.alertLevel === "red"
          ? "Critical"
          : a.alertLevel === "yellow"
            ? "Warning"
            : "Healthy";

      return `
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">
          <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${color}; margin-right: 8px;"></span>
          <strong>${escapeHtml(a.teamName)}</strong>
          <span style="color: ${color}; font-size: 12px; margin-left: 8px;">${label}</span>
        </td>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${a.staffingPercent}%</td>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${a.trainingPercent}%</td>
        <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: center;">${a.meetingAttendancePercent}%</td>
      </tr>`;
    })
    .join("");

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f9fafb;">
  <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
    <div style="background: white; border-radius: 8px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
      <h1 style="font-size: 24px; font-weight: 600; color: #111827; margin: 0 0 16px;">
        Team Health Alert
      </h1>
      <p style="font-size: 16px; color: #4b5563; line-height: 1.6; margin: 0 0 24px;">
        Hi ${escapeHtml(recipientName)}, the following teams at ${escapeHtml(churchName)} need attention:
      </p>
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <thead>
          <tr style="background: #f9fafb;">
            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #e5e7eb;">Team</th>
            <th style="padding: 12px; text-align: center; border-bottom: 2px solid #e5e7eb;">Staffing</th>
            <th style="padding: 12px; text-align: center; border-bottom: 2px solid #e5e7eb;">Training</th>
            <th style="padding: 12px; text-align: center; border-bottom: 2px solid #e5e7eb;">Attendance</th>
          </tr>
        </thead>
        <tbody>
          ${alertRows}
        </tbody>
      </table>
      <p style="font-size: 14px; color: #9ca3af; margin: 24px 0 0;">
        — ${escapeHtml(churchName)} via EveryField
      </p>
    </div>
  </div>
</body>
</html>`.trim();

  const alertText = alerts
    .map(
      (a) =>
        `- ${a.teamName}: Staffing ${a.staffingPercent}%, Training ${a.trainingPercent}%, Attendance ${a.meetingAttendancePercent}% [${a.alertLevel.toUpperCase()}]`
    )
    .join("\n");

  const text = `Team Health Alert

Hi ${recipientName}, the following teams at ${churchName} need attention:

${alertText}

— ${churchName} via EveryField`;

  return { subject, html, text };
}
