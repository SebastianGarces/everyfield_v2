"use server";

import { db } from "@/db";
import { verifySession } from "@/lib/auth";
import { discoveryPlantCreationStatements } from "@/lib/discovery/create-plant";
import { parseChurchBasics } from "@/lib/validations/onboarding";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function createDiscoveryPlant(
  _previous: { error?: string },
  formData: FormData
): Promise<{ error?: string }> {
  const { user } = await verifySession();
  const basics = parseChurchBasics(formData);
  if (!basics.ok)
    return { error: basics.fieldErrors.name ?? "Check your plant details." };
  const consent = z
    .object({
      sendingChurchId: z.uuid().nullable(),
      sendingNetworkId: z.uuid().nullable(),
      shareActivityWithOversight: z.boolean(),
    })
    .safeParse({
      sendingChurchId: formData.get("sendingChurchId") || null,
      sendingNetworkId: formData.get("sendingNetworkId") || null,
      shareActivityWithOversight: formData.get("sharingConsent") === "on",
    });
  if (!consent.success)
    return { error: "Reload this page to review your associations." };
  if (
    (consent.data.sendingChurchId || consent.data.sendingNetworkId) &&
    !consent.data.shareActivityWithOversight
  )
    return {
      error: "Confirm the sharing settings before creating your plant.",
    };
  let won: boolean;
  try {
    const result = await db.batch(
      discoveryPlantCreationStatements(
        {
          ...basics.values,
          churchId: crypto.randomUUID(),
          plantedBy: user.id,
          plantedByName: user.name,
          plantedByEmail: user.email,
        },
        consent.data
      )
    );
    won = result[5].rows.length === 1;
  } catch {
    return {
      error:
        "We could not confirm the result. Reload to check your account before trying again.",
    };
  }
  revalidatePath("/", "layout");
  if (!won)
    return {
      error:
        "Your account or associations changed. Reload to review them before continuing.",
    };
  redirect("/dashboard");
}
