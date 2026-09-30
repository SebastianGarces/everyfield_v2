"use server";

import {
  correctPersonRecord,
  personRecordKinds,
  type PersonRecordKind,
} from "@/lib/people/corrections";
import { assertPersonInChurch } from "@/lib/people/service";
import { withChurchSession } from "./action-context";
import { revalidatePath } from "next/cache";
import { z } from "zod";

export async function correctPersonRecordAction(
  personId: string,
  kind: PersonRecordKind,
  recordId: string,
  version: string,
  input: Record<string, unknown>
) {
  return withChurchSession(
    "people.write",
    "correctPersonRecordAction",
    { fallback: "Unable to save correction" },
    async ({ user, churchId }) => {
      z.string().uuid().parse(personId);
      z.string().uuid().parse(recordId);
      z.enum(personRecordKinds).parse(kind);
      z.string()
        .regex(/^[a-f0-9]{32}$/)
        .parse(version);
      await assertPersonInChurch(churchId, personId);
      const updated = await correctPersonRecord(
        churchId,
        user.id,
        personId,
        kind,
        recordId,
        version,
        input
      );
      if (!updated)
        return {
          success: false,
          error:
            "This record changed or is unavailable. Reload before correcting it.",
        };
      revalidatePath(`/people/${personId}`);
      revalidatePath(`/people/${personId}/assessments`);
      return { success: true, data: { recordId } };
    }
  );
}
