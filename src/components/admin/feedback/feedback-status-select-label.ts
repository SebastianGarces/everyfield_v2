/**
 * The row description may hold the feedback author's full message. It is
 * intentionally not part of this name: an admin already has the message in
 * its own table cell, while a control name only needs enough bounded context
 * to distinguish the row it changes.
 */
export const FEEDBACK_STATUS_SUBMITTER_MAX_LENGTH = 80;
export const FEEDBACK_STATUS_ACCESSIBLE_NAME_MAX_LENGTH = 180;

function boundedSubmitter(value: string) {
  return value.length > FEEDBACK_STATUS_SUBMITTER_MAX_LENGTH
    ? `${value.slice(0, FEEDBACK_STATUS_SUBMITTER_MAX_LENGTH - 1)}…`
    : value;
}

export function feedbackStatusSubmitter(
  userName: string | null,
  userEmail: string
) {
  return userName || userEmail;
}

export function feedbackStatusSelectAccessibleName({
  id,
  category,
  submitter,
  submittedAt,
}: {
  id: string;
  category: string;
  submitter: string;
  submittedAt: string;
}) {
  // The full UUID is the row's privacy-safe discriminator. Keep it ahead of
  // the bounded human summary so two otherwise identical rows never receive
  // the same name, even when the summary must be shortened.
  const name = `Status for ${category} feedback ${id}, from ${boundedSubmitter(submitter)}, submitted ${submittedAt}`;
  return name.length > FEEDBACK_STATUS_ACCESSIBLE_NAME_MAX_LENGTH
    ? `${name.slice(0, FEEDBACK_STATUS_ACCESSIBLE_NAME_MAX_LENGTH - 1)}…`
    : name;
}
