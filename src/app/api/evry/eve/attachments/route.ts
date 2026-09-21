import { z } from "zod";
import { requireFreshEvryPlantViewer } from "@/lib/evry/eligibility/viewer";
import { EVRY_PEOPLE_ATTACHMENT_TRANSPORT_REFERENCE_MAX_LENGTH } from "@/lib/evry/capabilities/people/attachment-contract";
import { eveAttachments } from "@/lib/evry/eve/runtime/attachments";
import { eveAttachmentKindSchema } from "@/lib/evry/eve/runtime/attachment-contract";
import { eveHttpRefusal, privateEveJson } from "@/lib/evry/eve/runtime/http";
import { requireSameOrigin } from "@/lib/evry/eve/runtime/auth-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const inputSchema = z.strictObject({
  sessionId: z.string().min(1).max(200),
  reference: z
    .string()
    .min(1)
    .max(EVRY_PEOPLE_ATTACHMENT_TRANSPORT_REFERENCE_MAX_LENGTH),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  kind: eveAttachmentKindSchema,
});

export async function POST(request: Request) {
  try {
    const actor = await requireFreshEvryPlantViewer();
    requireSameOrigin(request);
    const text = await request.text();
    if (
      text.length >
      EVRY_PEOPLE_ATTACHMENT_TRANSPORT_REFERENCE_MAX_LENGTH + 1000
    )
      return privateEveJson({ status: "invalid" }, 413);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return privateEveJson({ status: "invalid" }, 400);
    }
    const parsed = inputSchema.safeParse(raw);
    if (!parsed.success) return privateEveJson({ status: "invalid" }, 400);
    const attachment = await eveAttachments.bind(
      { ...actor, sessionId: parsed.data.sessionId },
      parsed.data
    );
    return attachment
      ? privateEveJson({ attachment })
      : privateEveJson({ status: "unavailable" }, 404);
  } catch (error) {
    const refusal = eveHttpRefusal(error);
    if (refusal) return refusal;
    throw error;
  }
}
