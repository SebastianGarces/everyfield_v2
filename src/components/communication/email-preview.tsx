"use client";

import { renderTemplate, getSampleData } from "@/lib/communication/merge";
import {
  escapeMergeValues,
  highlightUnresolvedMergeTokens,
  isRichTextEmpty,
  toRichTextHtml,
} from "@/lib/rich-text/format";
import { parseRichEmailBody } from "@/lib/rich-text/email-segments";
import { escapeHtml } from "@/lib/rich-text/sanitize";
import { EMAIL_RICH_TEXT_PROSE_CLASS } from "@/components/shared/rich-text-editor-controls";

interface EmailPreviewProps {
  subject: string;
  body: string;
  mergeData?: Record<string, string>;
}

/**
 * The RSVP call to action, styled like the buttons `CommunicationEmail` sends.
 * Spans, not links: there is no token to point them at until the message is
 * addressed to a person.
 */
function RsvpButtons() {
  return (
    <div style={{ textAlign: "center", margin: "24px 0" }}>
      <span
        style={{
          display: "inline-block",
          backgroundColor: "#96e31c",
          color: "#181d19",
          fontWeight: 600,
          fontSize: "16px",
          padding: "12px 32px",
          borderRadius: "6px",
          marginRight: "12px",
        }}
      >
        I&apos;ll be there
      </span>
      <span
        style={{
          display: "inline-block",
          backgroundColor: "#f3f4f6",
          color: "#4b5563",
          fontWeight: 500,
          fontSize: "16px",
          padding: "12px 32px",
          borderRadius: "6px",
          border: "1px solid #d1d5db",
        }}
      >
        Can&apos;t make it
      </span>
    </div>
  );
}

/**
 * Live email preview component (COM-015).
 * Renders subject + body with merge fields replaced by sample data.
 * Highlights unresolved {{...}} tokens in red.
 * Renders {{confirm_link}} / {{decline_link}} as styled RSVP buttons.
 *
 * COM-017: the body is rich text, and this preview shows the FORMATTING, not
 * the markup — it is the only place a planter sees what the recipient will get
 * before they send it. It runs the same two steps the send path runs, in the
 * same order: sanitise the body, then substitute merge values with those values
 * escaped. Anything else here would preview a different email from the one that
 * goes out — including WHERE the RSVP buttons land, which is why the body is
 * cut by `parseRichEmailBody`, the same splitter the email template uses, and
 * not by a second rule of this component's own.
 */
export function EmailPreview({ subject, body, mergeData }: EmailPreviewProps) {
  const data = mergeData ?? getSampleData();
  const renderedSubject = subject ? renderTemplate(subject, data) : "";
  const renderedBody = renderTemplate(
    toRichTextHtml(body),
    escapeMergeValues(data)
  );

  // The subject is plain text going into innerHTML, so it is escaped first —
  // the body arrives already sanitised, the subject never was.
  const displaySubject = highlightUnresolvedMergeTokens(
    escapeHtml(renderedSubject)
  );

  // Highlight unresolved fields, then cut the body where the RSVP buttons go —
  // the same cut the delivered email makes, so the preview cannot lay the call
  // to action out differently from the message that is sent. The highlight is
  // text-node-aware (`format.ts`): a token an author put inside an `href` is
  // left where it is, because a span inside an attribute value both breaks the
  // link and hides the warning.
  const bodySegments = parseRichEmailBody(
    highlightUnresolvedMergeTokens(renderedBody)
  );

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border">
      {/* Header */}
      <div className="border-b bg-gray-50 px-4 py-3">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
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
            {!isRichTextEmpty(body) ? (
              <div
                className={EMAIL_RICH_TEXT_PROSE_CLASS}
                style={{ fontSize: "16px" }}
              >
                {bodySegments.map((segment, index) =>
                  segment.type === "buttons" ? (
                    <RsvpButtons key={`segment-${index}`} />
                  ) : (
                    <div
                      key={`segment-${index}`}
                      dangerouslySetInnerHTML={{ __html: segment.html }}
                    />
                  )
                )}
              </div>
            ) : (
              <p className="text-muted-foreground italic">
                Start typing to see a preview...
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="mt-4 text-center">
            <p className="text-muted-foreground text-xs">— via EveryField</p>
          </div>
        </div>
      </div>
    </div>
  );
}
