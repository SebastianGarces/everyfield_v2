"use server";

import { redirect } from "next/navigation";

import { UNSUBSCRIBE_CONFIRMATION_PATH } from "@/lib/notifications/channels/email";
import { applyEmailUnsubscribe } from "@/lib/notifications/channels/unsubscribe";

// ============================================================================
// The confirmation page's one write (N-007).
//
// It is the SAME capability the email footer's link carries — one (user,
// category, email) cell, in either direction — reached through the same
// `applyEmailUnsubscribe`. There is no second code path a reviewer has to
// convince themselves about, and no parameter here that names a user, a
// channel or a category: `token` and a direction is the whole input.
//
// It is a Server Action rather than another route handler so the undo is a
// same-origin POST, which `src/proxy.ts`'s Origin/Host CSRF check accepts.
// ============================================================================

export async function setNotificationEmailStateAction(
  formData: FormData
): Promise<void> {
  const token = String(formData.get("token") ?? "");
  // The form submits the state it wants to REACH, so the button's label and
  // the effect cannot disagree.
  const enabled = formData.get("enabled") === "true";

  const result = await applyEmailUnsubscribe(token, enabled);

  const destination = new URL(
    UNSUBSCRIBE_CONFIRMATION_PATH,
    "http://localhost"
  );
  if (result.status === "ok") {
    destination.searchParams.set("token", token);
  } else {
    console.warn(
      `[notifications/unsubscribe] refused a token from the confirmation page: ${result.reason}`
    );
  }

  // Relative, so it works on every deployment host without knowing which one.
  redirect(`${destination.pathname}${destination.search}`);
}
