import type { MeetingInvitationReferenceRequest } from "./meeting-invitation";

const DEFAULT_SUBJECT = "You're invited to Vision Meeting";
const DEFAULT_BODY =
  "Join us for Vision Meeting at our church location. We look forward to seeing you.";

/** Closed selection for the canonical FRD 3.5 reference request. */
export function selectMeetingInvitationReferenceRequest(
  literalUserText: string
): MeetingInvitationReferenceRequest | null {
  const normalized = literalUserText.normalize("NFKC").trim();
  if (
    !/\bcreate\s+(?:a\s+)?meeting\s+for\b/i.test(normalized) ||
    !/\bat\s+the\s+church\s+location\b/i.test(normalized) ||
    !/\binvite\s+the\s+core\s+team\b/i.test(normalized) ||
    !/\bprospects?\s+who\s+(?:have\s+)?not\s+(?:visited|attended)\s+(?:a\s+)?vision\s+meeting\b/i.test(
      normalized
    ) ||
    !/\bdraft\s+(?:an?\s+)?email\s+invitation\b/i.test(normalized) ||
    !/\bsend\s+it\s+to\s+them\b/i.test(normalized)
  ) {
    return null;
  }
  const date =
    /\bcreate\s+(?:a\s+)?meeting\s+for\s+(.+?)\s+at\s+the\s+church\s+location\b/i.exec(
      normalized
    );
  if (!date?.[1]?.trim()) return null;
  const duration = /\b(?:lasting|for)\s+(\d{1,4})\s+minutes?\b/i.exec(
    normalized
  );
  return Object.freeze({
    sourceText: date[1].trim(),
    durationMinutes: duration ? Number(duration[1]) : undefined,
    subject: DEFAULT_SUBJECT,
    body: DEFAULT_BODY,
  });
}
