import { z } from "zod";

import {
  evryConversationFailure,
  evryConversationJson,
} from "@/app/api/evry/conversations/shared";
import { requireEvryPlantViewer } from "@/lib/evry/eligibility/viewer";
import {
  completeEvryRunRecoveryPreviewFixture,
  readEvryRunRecoveryPreviewFixture,
  startEvryRunRecoveryPreviewFixture,
} from "@/lib/evry/runs/preview-fixture";

export const dynamic = "force-dynamic";

const startSchema = z
  .object({ action: z.literal("start"), kind: z.enum(["read", "execution"]) })
  .strict();
const completeSchema = z
  .object({ action: z.literal("complete"), requestId: z.string().uuid() })
  .strict();
const requestSchema = z.discriminatedUnion("action", [
  startSchema,
  completeSchema,
]);

function previewUnavailable(): Response {
  return new Response(null, { status: 404 });
}

/** Preview-only deterministic adapter; production and local return no surface. */
export async function GET(request: Request): Promise<Response> {
  if (process.env.VERCEL_ENV !== "preview") return previewUnavailable();
  try {
    const actor = await requireEvryPlantViewer();
    const requestId = z
      .string()
      .uuid()
      .safeParse(new URL(request.url).searchParams.get("requestId"));
    if (!requestId.success) {
      return evryConversationJson({ status: "invalid" }, 400);
    }
    const proof = await readEvryRunRecoveryPreviewFixture({
      actor,
      requestId: requestId.data,
    });
    return proof
      ? evryConversationJson({ status: "available", proof })
      : evryConversationJson({ status: "unavailable" }, 404);
  } catch (error) {
    return evryConversationFailure(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  if (process.env.VERCEL_ENV !== "preview") return previewUnavailable();
  try {
    const actor = await requireEvryPlantViewer();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return evryConversationJson({ status: "invalid" }, 400);
    }
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return evryConversationJson({ status: "invalid" }, 400);
    }
    const proof =
      parsed.data.action === "start"
        ? await startEvryRunRecoveryPreviewFixture({
            actor,
            kind: parsed.data.kind,
          })
        : await completeEvryRunRecoveryPreviewFixture({
            actor,
            requestId: parsed.data.requestId,
          });
    return proof
      ? evryConversationJson({ status: "available", proof })
      : evryConversationJson({ status: "unavailable" }, 404);
  } catch (error) {
    return evryConversationFailure(error);
  }
}
