interface RecipientIdInput {
  id: string;
}

/**
 * The compose action receives the selected ids in their existing order. This
 * deliberately does not resolve, deduplicate, or otherwise alter the picker
 * state before it crosses the form boundary.
 */
export function recipientIdsPayload(
  recipients: readonly RecipientIdInput[]
): string {
  return JSON.stringify(recipients.map((recipient) => recipient.id));
}
