import { z } from "zod";

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
    return messageBody.safeParse(text.trim() ? JSON.parse(text) : {}).success;
  } catch {
    return false;
  }
}
