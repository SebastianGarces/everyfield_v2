"use server";

import { revalidatePath } from "next/cache";
import { withChurchSession } from "../action-context";
import { mergeRequestSchema } from "@/lib/people/merge-model";
import { mergePeople } from "@/lib/people/merge";

export async function mergePeopleAction(input: unknown) {
  return withChurchSession(
    "people.write",
    "mergePeopleAction",
    {
      fallback: "The merge was not saved. Refresh the review and try again.",
    },
    async ({ user, churchId }) => {
      const parsed = mergeRequestSchema.safeParse(input);
      if (!parsed.success)
        return {
          success: false,
          error:
            "Choose two profiles and resolve every difference before merging.",
        };
      const result = await mergePeople(churchId, user.id, parsed.data);
      if (!result.success) return result;
      revalidatePath("/people", "layout");
      revalidatePath("/teams", "layout");
      revalidatePath("/meetings", "layout");
      revalidatePath("/tasks");
      return { success: true, data: { survivorId: result.survivorId } };
    }
  );
}
