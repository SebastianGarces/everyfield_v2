"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { verifySession } from "@/lib/auth/session";
import {
  sendCommunication,
  getGroupRecipients,
  resendToNonOpeners,
} from "@/lib/communication/service";
import {
  getTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  forkTemplate,
} from "@/lib/communication/templates";
import { composeMessageSchema } from "@/lib/validations/communication";
import type {
  CreateTemplateInput,
  UpdateTemplateInput,
  TemplateFilters,
} from "@/lib/validations/communication";

// ---------------------------------------------------------------------------
// Send Message
// ---------------------------------------------------------------------------

export async function sendMessageAction(formData: FormData) {
  const { user } = await verifySession();
  if (!user.churchId) redirect("/dashboard");

  const recipientIdsRaw = formData.get("recipientIds") as string;
  const recipientIds = recipientIdsRaw ? JSON.parse(recipientIdsRaw) : [];

  const parsed = composeMessageSchema.safeParse({
    subject: formData.get("subject"),
    body: formData.get("body"),
    channel: formData.get("channel") ?? "email",
    templateId: formData.get("templateId") || undefined,
    meetingId: formData.get("meetingId") || undefined,
    recipientIds,
  });

  if (!parsed.success) {
    return {
      error: "Validation failed",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  try {
    const comm = await sendCommunication(user.churchId, user.id, parsed.data);
    revalidatePath("/communication");
    return { success: true, communicationId: comm.id };
  } catch (err) {
    console.error("[ACTION] sendMessage failed:", err);
    return {
      error: err instanceof Error ? err.message : "Failed to send message",
    };
  }
}

// ---------------------------------------------------------------------------
// Resend to non-openers (COM-018)
// ---------------------------------------------------------------------------

/**
 * Send the message again, to the people who recorded no open.
 *
 * The new message is its own row in history — the original is never mutated.
 * The action mints its actor from the session and never takes one as an
 * argument (`memory/invariants.md` -> Authentication).
 */
export async function resendToNonOpenersAction(communicationId: string) {
  const { user } = await verifySession();
  if (!user.churchId) redirect("/dashboard");

  try {
    const resent = await resendToNonOpeners(
      user.churchId,
      user.id,
      communicationId
    );
    // The original message is deliberately NOT revalidated: nothing about it
    // changed. What changed is the list it appears in and the church-wide
    // delivery figures on the hub.
    revalidatePath("/communication");
    revalidatePath("/communication/history");
    return { success: true as const, communicationId: resent.id };
  } catch (err) {
    console.error("[ACTION] resendToNonOpeners failed:", err);
    return {
      error: err instanceof Error ? err.message : "Failed to resend message",
    };
  }
}

// ---------------------------------------------------------------------------
// Recipient Groups
// ---------------------------------------------------------------------------

/**
 * Resolve a quick-select group into the people it names — status groups and
 * `team:<teamId>` alike. Returns whole people, not ids: the picker needs names
 * to render, and a second "look them up" round trip through the people search
 * silently truncated any group larger than its page size.
 */
export async function resolveGroupAction(group: string) {
  const { user } = await verifySession();
  if (!user.churchId) return { people: [] };

  const people = await getGroupRecipients(user.churchId, group);
  return { people };
}

// ---------------------------------------------------------------------------
// Search People (for recipient picker)
// ---------------------------------------------------------------------------

export async function searchPeopleAction(query: string) {
  const { user } = await verifySession();
  if (!user.churchId) return [];

  const { listPeople } = await import("@/lib/people/service");
  const result = await listPeople(user.churchId, {
    search: query,
    limit: 20,
  });

  return result.people.map((p) => ({
    id: p.id,
    firstName: p.firstName,
    lastName: p.lastName,
    email: p.email,
    status: p.status,
  }));
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export async function getTemplatesAction(filters?: TemplateFilters) {
  const { user } = await verifySession();
  if (!user.churchId) return [];

  return getTemplates(user.churchId, filters);
}

export async function getTemplateAction(id: string) {
  return getTemplate(id);
}

export async function createTemplateAction(input: CreateTemplateInput) {
  const { user } = await verifySession();
  if (!user.churchId) redirect("/dashboard");

  const template = await createTemplate(user.churchId, input);
  revalidatePath("/communication/templates");
  return template;
}

export async function updateTemplateAction(
  id: string,
  input: UpdateTemplateInput
) {
  const { user } = await verifySession();
  if (!user.churchId) redirect("/dashboard");

  const template = await updateTemplate(id, user.churchId, input);
  revalidatePath("/communication/templates");
  return template;
}

export async function deleteTemplateAction(id: string) {
  const { user } = await verifySession();
  if (!user.churchId) redirect("/dashboard");

  await deleteTemplate(id, user.churchId);
  revalidatePath("/communication/templates");
}

export async function forkTemplateAction(systemTemplateId: string) {
  const { user } = await verifySession();
  if (!user.churchId) redirect("/dashboard");

  const fork = await forkTemplate(systemTemplateId, user.churchId);
  revalidatePath("/communication/templates");
  return fork;
}
