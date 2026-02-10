/** Escape HTML special characters to prevent injection in emails */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Email template: Meeting Reminder
 * Sent to team members before a scheduled meeting
 */
export function meetingReminderEmail({
  personName,
  teamName,
  meetingTitle,
  datetime,
  location,
  agenda,
  churchName,
}: {
  personName: string;
  teamName: string;
  meetingTitle: string;
  datetime: Date;
  location: string | null;
  agenda: string | null;
  churchName: string;
}): { subject: string; html: string; text: string } {
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

  const subject = `Reminder: ${meetingTitle} - ${teamName}`;

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
        Meeting Reminder
      </h1>
      <p style="font-size: 16px; color: #4b5563; line-height: 1.6; margin: 0 0 16px;">
        Hi ${escapeHtml(personName)},
      </p>
      <p style="font-size: 16px; color: #4b5563; line-height: 1.6; margin: 0 0 24px;">
        This is a reminder about an upcoming ${escapeHtml(teamName)} meeting.
      </p>
      <div style="background: #f3f4f6; border-radius: 6px; padding: 20px; margin: 0 0 24px;">
        <p style="font-size: 18px; font-weight: 600; color: #111827; margin: 0 0 12px;">
          ${escapeHtml(meetingTitle)}
        </p>
        <p style="font-size: 14px; color: #4b5563; margin: 0 0 4px;">
          <strong>Date:</strong> ${formattedDate}
        </p>
        <p style="font-size: 14px; color: #4b5563; margin: 0 0 4px;">
          <strong>Time:</strong> ${formattedTime}
        </p>
        ${
          location
            ? `<p style="font-size: 14px; color: #4b5563; margin: 0 0 4px;">
          <strong>Location:</strong> ${escapeHtml(location)}
        </p>`
            : ""
        }
      </div>
      ${
        agenda
          ? `<div style="margin: 0 0 24px;">
        <p style="font-size: 14px; font-weight: 600; color: #111827; margin: 0 0 8px;">Agenda:</p>
        <p style="font-size: 14px; color: #4b5563; line-height: 1.6; margin: 0; white-space: pre-wrap;">${escapeHtml(agenda)}</p>
      </div>`
          : ""
      }
      <p style="font-size: 14px; color: #9ca3af; margin: 24px 0 0;">
        — ${escapeHtml(churchName)} via EveryField
      </p>
    </div>
  </div>
</body>
</html>`.trim();

  const text = `Meeting Reminder

Hi ${personName},

This is a reminder about an upcoming ${teamName} meeting.

${meetingTitle}
Date: ${formattedDate}
Time: ${formattedTime}${location ? `\nLocation: ${location}` : ""}${agenda ? `\n\nAgenda:\n${agenda}` : ""}

— ${churchName} via EveryField`;

  return { subject, html, text };
}
