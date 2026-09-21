import { z } from "zod";
import { createHash } from "node:crypto";
import { parseEveClientContext, rememberEvePageHint } from "./client-context";
import type { EveSessionOwner } from "./session-store";
import { eveAttachmentContextSchema } from "./attachment-contract";
import { eveAttachments } from "./attachments";
import { withAuthenticatedSessionId } from "@/lib/auth/session-scope";
import type { EveAuthenticatedSession } from "./auth-policy";
import { evryPageContextSchema } from "@/lib/evry/resolvers/contract";

const operationHeaderSchema = z
  .string()
  .min(16)
  .max(160)
  .regex(/^[a-zA-Z0-9_-]+$/);

export const EVE_APP_ROUTES = new Set([
  "POST /eve/v1/session",
  "GET /eve/v1/session/:sessionId",
  "POST /eve/v1/session/:sessionId",
  "GET /eve/v1/session/:sessionId/stream",
  "POST /eve/v1/session/:sessionId/cancel",
  "GET /eve/v1/health",
  "HEAD /eve/v1/health",
]);

/** The application has no remote callbacks, activity webhooks, file uploads or subagents. */
const messageBody = z
  .object({
    message: z.string().min(1).max(32_000).optional(),
    inputResponses: z.array(z.json()).min(1).max(20).optional(),
    operationId: z.string().min(1).max(200).optional(),
    clientContext: z
      .union([
        z.string().max(8_000),
        z.array(z.string().max(8_000)).max(5),
        z.record(z.string(), z.json()),
      ])
      .optional(),
    capabilities: z
      .object({ requestInput: z.boolean().optional() })
      .strict()
      .optional(),
    mode: z.literal("conversation").optional(),
    turnPolicy: z.enum(["queue", "steer"]).optional(),
  })
  .strict();

export async function validateEveMessageRequest(
  request: Request
): Promise<boolean> {
  const text = await request.clone().text();
  if (text.length > 64_000) return false;
  try {
    const parsed = messageBody.safeParse(text.trim() ? JSON.parse(text) : {});
    const header = request.headers.get("x-evry-operation-id");
    if (
      header &&
      (!operationHeaderSchema.safeParse(header).success ||
        (parsed.success &&
          parsed.data.operationId &&
          parsed.data.operationId !== header))
    )
      return false;
    if (parsed.success) rememberEvePageHint(request, parsed.data.clientContext);
    return parsed.success;
  } catch {
    return false;
  }
}

/** Replace client claims before Eve turns clientContext into model-visible messages. */
export async function bindEveAttachmentContext(
  request: Request,
  owner: EveAuthenticatedSession,
  resolveAttachment = eveAttachments.resolve
): Promise<Request | null> {
  const raw = await request.clone().text();
  const body = messageBody.parse(raw.trim() ? JSON.parse(raw) : {});
  const context = parseEveClientContext(body.clientContext);
  if (
    !context ||
    typeof context !== "object" ||
    Array.isArray(context) ||
    !("attachment" in context)
  ) {
    // Attachment metadata has one supported envelope, never an array of hidden JSON payloads.
    if (
      Array.isArray(context) &&
      context.some((item) => {
        const parsed = parseEveClientContext(item);
        return parsed && typeof parsed === "object" && "attachment" in parsed;
      })
    )
      return null;
    return request;
  }
  const attachment = eveAttachmentContextSchema.safeParse(context.attachment);
  const sessionMatch = /\/eve\/v1\/session\/([^/]+)$/.exec(
    new URL(request.url).pathname
  );
  if (!attachment.success || !sessionMatch) return null;
  const resolved = await withAuthenticatedSessionId(owner.appSessionId, () =>
    resolveAttachment(
      { ...owner, sessionId: decodeURIComponent(sessionMatch[1]!) },
      attachment.data.attachmentId
    )
  );
  if (!resolved) return null;
  const safeContext = {
    pageContext:
      evryPageContextSchema.safeParse(
        "pageContext" in context ? context.pageContext : null
      ).data ?? null,
    attachment: { ...attachment.data, ...resolved.descriptor },
  };
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  // Eve/Nitro may wrap Request; copying it invokes inaccessible native private slots.
  const bound = new Request(request.url, {
    method: request.method,
    signal: request.signal,
    headers,
    body: JSON.stringify({ ...body, clientContext: safeContext }),
  });
  rememberEvePageHint(bound, safeContext);
  return bound;
}

/** Client retries are stable only inside the authenticated account/church boundary. */
export async function scopeEveCreationRequest(
  request: Request,
  owner: EveSessionOwner
): Promise<Request> {
  const raw = await request.clone().text();
  const parsed = messageBody.parse(raw.trim() ? JSON.parse(raw) : {});
  const header = request.headers.get("x-evry-operation-id");
  if (header) operationHeaderSchema.parse(header);
  const incomingOperationId = header ?? parsed.operationId;
  if (!incomingOperationId) return request;
  const operationId = createHash("sha256")
    .update(JSON.stringify([owner.userId, owner.plantId, incomingOperationId]))
    .digest("hex");
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  const scoped = new Request(request.url, {
    method: request.method,
    signal: request.signal,
    headers,
    body: JSON.stringify({ ...parsed, operationId }),
  });
  rememberEvePageHint(scoped, parsed.clientContext);
  return scoped;
}
