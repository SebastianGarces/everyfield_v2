/** Escape HTML special characters to prevent injection in emails */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Email template: Welcome to a Ministry Team
 * Sent when a person is assigned to a team role
 */
export function teamWelcomeEmail({
  personName,
  teamName,
  roleName,
  leaderName,
  churchName,
}: {
  personName: string;
  teamName: string;
  roleName: string;
  leaderName: string | null;
  churchName: string;
}): { subject: string; html: string; text: string } {
  const subject = `Welcome to the ${teamName} - ${churchName}`;

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
        Welcome to the ${escapeHtml(teamName)}!
      </h1>
      <p style="font-size: 16px; color: #4b5563; line-height: 1.6; margin: 0 0 16px;">
        Hi ${escapeHtml(personName)},
      </p>
      <p style="font-size: 16px; color: #4b5563; line-height: 1.6; margin: 0 0 16px;">
        You've been assigned to the <strong>${escapeHtml(roleName)}</strong> role on the ${escapeHtml(teamName)} at ${escapeHtml(churchName)}. We're excited to have you on the team!
      </p>
      ${
        leaderName
          ? `<p style="font-size: 16px; color: #4b5563; line-height: 1.6; margin: 0 0 16px;">
        Your team leader is <strong>${escapeHtml(leaderName)}</strong>. They'll be in touch with next steps.
      </p>`
          : ""
      }
      <p style="font-size: 14px; color: #9ca3af; margin: 24px 0 0;">
        — ${escapeHtml(churchName)} via EveryField
      </p>
    </div>
  </div>
</body>
</html>`.trim();

  const text = `Welcome to the ${teamName}!

Hi ${personName},

You've been assigned to the ${roleName} role on the ${teamName} at ${churchName}.${
    leaderName
      ? ` Your team leader is ${leaderName}. They'll be in touch with next steps.`
      : ""
  }

— ${churchName} via EveryField`;

  return { subject, html, text };
}
