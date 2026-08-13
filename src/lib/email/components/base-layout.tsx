import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import type { ReactNode } from "react";

interface BaseLayoutProps {
  preview?: string;
  children: ReactNode;
  footerText?: string;
}

/**
 * Base email layout used by all EveryField emails.
 * Provides consistent branding, responsive container, and footer.
 *
 * Two details are load-bearing rather than cosmetic, both from
 * `.agents/skills/react-email/SKILL.md`:
 *
 *   * `<Html lang>` — screen readers in mail clients read the document
 *     language off the root element, and an unlabelled document is announced in
 *     whatever voice the reader's system defaults to.
 *   * `<Preview>` is the FIRST child of `<Body>`. It renders as a hidden block,
 *     and clients take the preheader from the first text they find inside the
 *     body — placed outside it, some clients fall back to the first visible
 *     sentence instead and the preheader is wasted.
 */
export function BaseLayout({
  preview,
  children,
  footerText = "EveryField",
}: BaseLayoutProps) {
  return (
    <Html lang="en">
      <Head />
      <Body style={body}>
        {preview && <Preview>{preview}</Preview>}
        <Container style={container}>
          <Section style={content}>{children}</Section>
          <Hr style={hr} />
          <Text style={footer}>— {footerText} via EveryField</Text>
        </Container>
      </Body>
    </Html>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const body: React.CSSProperties = {
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

const hr: React.CSSProperties = {
  borderColor: "#e5e7eb",
  margin: "24px 0",
};

const footer: React.CSSProperties = {
  fontSize: "14px",
  color: "#9ca3af",
  margin: 0,
};
