import {
  Body,
  Button,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

// RSVP placeholder tokens used to identify where buttons should be rendered.
// These tokens are inserted by the merge engine in place of raw URLs,
// then detected here and replaced with styled Button components.
export const CONFIRM_PLACEHOLDER = "__EF_CONFIRM__";
export const DECLINE_PLACEHOLDER = "__EF_DECLINE__";

interface CommunicationEmailProps {
  /** Rendered plain text body (after merge field replacement) */
  body: string;
  /** RSVP confirm URL — if provided, CONFIRM_PLACEHOLDER is rendered as a button */
  confirmUrl?: string;
  /** RSVP decline URL — if provided, DECLINE_PLACEHOLDER is rendered as a button */
  declineUrl?: string;
  /** Church name for the footer */
  churchName: string;
  /** Optional preview text (shown in inbox before opening) */
  previewText?: string;
}

/**
 * Segment types produced by parsing the body text.
 * "text" segments render as Text components; "buttons" renders the RSVP CTA row.
 */
type Segment =
  | { type: "text"; lines: string[] }
  | { type: "buttons" };

/**
 * Parse the email body into segments: consecutive text lines are grouped
 * together, and RSVP placeholder lines become button segments.
 * Normalizes line endings (\r\n → \n) and collapses blank lines into
 * paragraph breaks within text segments.
 */
function parseBody(body: string): Segment[] {
  const normalized = body.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const segments: Segment[] = [];
  let currentTextLines: string[] = [];

  const flushText = () => {
    if (currentTextLines.length > 0) {
      segments.push({ type: "text", lines: [...currentTextLines] });
      currentTextLines = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // Line is a confirm or decline placeholder → flush text, emit buttons
    if (trimmed === CONFIRM_PLACEHOLDER || trimmed === DECLINE_PLACEHOLDER) {
      // Only emit buttons once (when we see the first placeholder)
      if (
        segments.length === 0 ||
        segments[segments.length - 1].type !== "buttons"
      ) {
        // If previous text lines ended with blank lines, keep them as spacing
        // but flush before the button row
        flushText();
        segments.push({ type: "buttons" });
      }
      continue;
    }

    // Regular text line (including blank lines for paragraph spacing)
    currentTextLines.push(line);
  }

  flushText();
  return segments;
}

/**
 * React Email component for user-composed Communication Hub emails.
 *
 * Takes pre-rendered plain text (after merge field replacement) and wraps it
 * in the shared EveryField email layout. Detects RSVP placeholder tokens
 * and renders them as styled CTA buttons.
 */
export function CommunicationEmail({
  body,
  confirmUrl,
  declineUrl,
  churchName,
  previewText,
}: CommunicationEmailProps) {
  const segments = parseBody(body);

  return (
    <Html>
      <Head />
      {previewText && <Preview>{previewText}</Preview>}
      <Body style={bodyStyle}>
        <Container style={container}>
          <Section style={content}>
            {segments.map((segment, i) => {
              if (segment.type === "buttons" && confirmUrl && declineUrl) {
                return (
                  <Section key={i} style={buttonSection}>
                    <Button href={confirmUrl} style={confirmButton}>
                      I&apos;ll be there
                    </Button>
                    <Button href={declineUrl} style={declineButton}>
                      Can&apos;t make it
                    </Button>
                  </Section>
                );
              }

              if (segment.type === "buttons") {
                // Placeholders present but no URLs — skip
                return null;
              }

              // Text segment: split into paragraphs by blank lines,
              // render each paragraph as a Text component
              const paragraphs: string[][] = [];
              let currentParagraph: string[] = [];

              for (const line of segment.lines) {
                if (line.trim() === "") {
                  if (currentParagraph.length > 0) {
                    paragraphs.push(currentParagraph);
                    currentParagraph = [];
                  }
                } else {
                  currentParagraph.push(line);
                }
              }
              if (currentParagraph.length > 0) {
                paragraphs.push(currentParagraph);
              }

              return paragraphs.map((paraLines, j) => (
                <Text key={`${i}-${j}`} style={text}>
                  {paraLines.map((line, k) => (
                    <span key={k}>
                      {line}
                      {k < paraLines.length - 1 && <br />}
                    </span>
                  ))}
                </Text>
              ));
            })}
          </Section>
          <Hr style={hr} />
          <Text style={footer}>— {churchName} via EveryField</Text>
        </Container>
      </Body>
    </Html>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const bodyStyle: React.CSSProperties = {
  backgroundColor: "#f9fafb",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
  margin: 0,
  padding: 0,
};

const container: React.CSSProperties = {
  maxWidth: "600px",
  margin: "0 auto",
  padding: "40px 20px",
};

const content: React.CSSProperties = {
  backgroundColor: "#ffffff",
  borderRadius: "8px",
  padding: "32px",
  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.1)",
};

const text: React.CSSProperties = {
  fontSize: "16px",
  color: "#4b5563",
  lineHeight: "1.6",
  margin: "0 0 16px",
};

const buttonSection: React.CSSProperties = {
  textAlign: "center" as const,
  margin: "24px 0",
};

const confirmButton: React.CSSProperties = {
  backgroundColor: "#96e31c",
  color: "#181d19",
  fontWeight: 600,
  fontSize: "16px",
  padding: "12px 32px",
  borderRadius: "6px",
  textDecoration: "none",
  display: "inline-block",
  marginRight: "12px",
};

const declineButton: React.CSSProperties = {
  backgroundColor: "#f3f4f6",
  color: "#4b5563",
  fontWeight: 500,
  fontSize: "16px",
  padding: "12px 32px",
  borderRadius: "6px",
  textDecoration: "none",
  display: "inline-block",
  border: "1px solid #d1d5db",
};

const hr: React.CSSProperties = {
  borderColor: "#e5e7eb",
  margin: "24px 0",
};

const footer: React.CSSProperties = {
  fontSize: "14px",
  color: "#9ca3af",
  margin: 0,
};
