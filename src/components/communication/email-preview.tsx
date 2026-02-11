"use client";

import { renderTemplate, getSampleData } from "@/lib/communication/merge";
import {
  CONFIRM_PLACEHOLDER,
  DECLINE_PLACEHOLDER,
} from "@/lib/email/components/communication-email";

interface EmailPreviewProps {
  subject: string;
  body: string;
  mergeData?: Record<string, string>;
}

// HTML for the styled RSVP buttons shown in the preview
const CONFIRM_BUTTON_HTML = `<div style="text-align: center; margin: 24px 0;">
  <span style="display: inline-block; background-color: #96e31c; color: #181d19; font-weight: 600; font-size: 16px; padding: 12px 32px; border-radius: 6px; margin-right: 12px;">I'll be there</span>
  <span style="display: inline-block; background-color: #f3f4f6; color: #4b5563; font-weight: 500; font-size: 16px; padding: 12px 32px; border-radius: 6px; border: 1px solid #d1d5db;">Can't make it</span>
</div>`;

const CONFIRM_ONLY_BUTTON_HTML = `<div style="text-align: center; margin: 24px 0;">
  <span style="display: inline-block; background-color: #96e31c; color: #181d19; font-weight: 600; font-size: 16px; padding: 12px 32px; border-radius: 6px;">I'll be there</span>
</div>`;

const DECLINE_ONLY_BUTTON_HTML = `<div style="text-align: center; margin: 24px 0;">
  <span style="display: inline-block; background-color: #f3f4f6; color: #4b5563; font-weight: 500; font-size: 16px; padding: 12px 32px; border-radius: 6px; border: 1px solid #d1d5db;">Can't make it</span>
</div>`;

/**
 * Replace RSVP placeholder tokens with styled button HTML for the preview.
 * Handles the case where both placeholders appear on adjacent lines.
 */
function renderRsvpButtons(html: string): string {
  const hasConfirm = html.includes(CONFIRM_PLACEHOLDER);
  const hasDecline = html.includes(DECLINE_PLACEHOLDER);

  if (hasConfirm && hasDecline) {
    // Both present — check if they're on adjacent lines (separated by <br>)
    // Replace the confirm placeholder line + decline placeholder line with a single button row
    // Use [^<>]* to avoid consuming < or > from surrounding <br> tags
    const combinedPattern = new RegExp(
      `[^<>]*${escapeRegex(CONFIRM_PLACEHOLDER)}[^<>]*(?:<br>)+[^<>]*${escapeRegex(DECLINE_PLACEHOLDER)}[^<>]*`,
    );

    if (combinedPattern.test(html)) {
      return html.replace(combinedPattern, CONFIRM_BUTTON_HTML);
    }

    // If they're in separate paragraphs, replace individually
    let result = html;
    result = result.replace(
      new RegExp(`[^<>]*${escapeRegex(CONFIRM_PLACEHOLDER)}[^<>]*`),
      CONFIRM_ONLY_BUTTON_HTML
    );
    result = result.replace(
      new RegExp(`[^<>]*${escapeRegex(DECLINE_PLACEHOLDER)}[^<>]*`),
      DECLINE_ONLY_BUTTON_HTML
    );
    return result;
  }

  if (hasConfirm) {
    return html.replace(
      new RegExp(`[^<>]*${escapeRegex(CONFIRM_PLACEHOLDER)}[^<>]*`),
      CONFIRM_ONLY_BUTTON_HTML
    );
  }

  if (hasDecline) {
    return html.replace(
      new RegExp(`[^<>]*${escapeRegex(DECLINE_PLACEHOLDER)}[^<>]*`),
      DECLINE_ONLY_BUTTON_HTML
    );
  }

  return html;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Live email preview component.
 * Renders subject + body with merge fields replaced by sample data.
 * Highlights unresolved {{...}} tokens in red.
 * Renders {{confirm_link}} / {{decline_link}} as styled RSVP buttons.
 */
export function EmailPreview({
  subject,
  body,
  mergeData,
}: EmailPreviewProps) {
  const data = mergeData ?? getSampleData();
  const renderedSubject = subject ? renderTemplate(subject, data) : "";
  const renderedBody = renderTemplate(body || "", data);

  // Highlight unresolved merge fields
  const highlightUnresolved = (text: string) => {
    return text.replace(
      /\{\{(\w+)\}\}/g,
      '<span style="background-color: #fee2e2; color: #dc2626; padding: 1px 4px; border-radius: 3px; font-family: monospace; font-size: 0.85em;">{{$1}}</span>'
    );
  };

  const displaySubject = highlightUnresolved(renderedSubject);

  // Convert newlines to <br>, highlight unresolved fields, then render RSVP buttons
  let displayBody = highlightUnresolved(renderedBody.replace(/\n/g, "<br>"));
  displayBody = renderRsvpButtons(displayBody);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border">
      {/* Header */}
      <div className="border-b bg-gray-50 px-4 py-3">
        <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          Email Preview
        </p>
      </div>

      {/* Email frame */}
      <div className="flex-1 overflow-auto bg-[#f9fafb] p-6">
        <div className="mx-auto max-w-[600px]">
          {/* Subject line */}
          {renderedSubject && (
            <div className="mb-4 rounded-lg border bg-white px-4 py-3">
              <p className="text-muted-foreground mb-1 text-xs font-medium">
                Subject
              </p>
              <p
                className="font-medium"
                dangerouslySetInnerHTML={{ __html: displaySubject }}
              />
            </div>
          )}

          {/* Email body */}
          <div
            className="rounded-lg bg-white p-8 shadow-sm"
            style={{
              fontFamily:
                "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            }}
          >
            {body ? (
              <div
                className="text-[#4b5563] leading-relaxed"
                style={{ fontSize: "16px" }}
                dangerouslySetInnerHTML={{ __html: displayBody }}
              />
            ) : (
              <p className="text-muted-foreground italic">
                Start typing to see a preview...
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="mt-4 text-center">
            <p className="text-muted-foreground text-xs">
              — via EveryField
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
