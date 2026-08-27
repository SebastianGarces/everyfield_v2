export type FeedbackStatusUpdateResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Build the existing status-update request independently of its React
 * transition so the no-op, request, and result behavior stay executable.
 */
export async function submitFeedbackStatusChange({
  id,
  status,
  next,
  updateStatus,
  onSuccess,
  onError,
}: {
  id: string;
  status: string;
  next: string;
  updateStatus: (formData: FormData) => Promise<FeedbackStatusUpdateResult>;
  onSuccess: () => void;
  onError: (message: string) => void;
}) {
  if (next === status) return;

  const formData = new FormData();
  formData.set("id", id);
  formData.set("status", next);

  const result = await updateStatus(formData);
  if (result.success) {
    onSuccess();
  } else {
    onError(result.error);
  }
}
