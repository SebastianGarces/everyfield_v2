"use client";

import { renderTemplate, getSampleData } from "@/lib/communication/merge";

interface EmailPreviewProps {
  subject: string;
  body: string;
  mergeData?: Record<string, string>;
}

/**
 * Live email preview component.
 * Renders subject + body with merge fields replaced by sample data.
 * Highlights unresolved {{...}} tokens in red.
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
  const displayBody = highlightUnresolved(
    renderedBody.replace(/\n/g, "<br>")
  );

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
