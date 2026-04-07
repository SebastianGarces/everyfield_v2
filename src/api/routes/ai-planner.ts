import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { AppBindings } from "@/api/types";
import { getSessionContext } from "@/api/middleware/session";
import {
  PlannerRequestSchema,
  PlannerResponseSchema,
} from "@/lib/ai/vision-meeting-planner-schema";
import { runVisionMeetingPlanner } from "@/lib/ai/vision-meeting-planner";
import { listLocations } from "@/lib/meetings/locations";

export const aiPlannerRoute = new OpenAPIHono<AppBindings>();

aiPlannerRoute.openapi(
  createRoute({
    method: "post",
    path: "/planner",
    request: {
      body: {
        content: {
          "application/json": {
            schema: PlannerRequestSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: "Planner response",
        content: {
          "application/json": {
            schema: PlannerResponseSchema,
          },
        },
      },
      401: {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: z.object({ error: z.string() }),
          },
        },
      },
      400: {
        description: "Invalid request",
        content: {
          "application/json": {
            schema: z.object({ error: z.string() }),
          },
        },
      },
      500: {
        description: "Planner error",
        content: {
          "application/json": {
            schema: z.object({ error: z.string() }),
          },
        },
      },
      503: {
        description: "Planner not configured",
        content: {
          "application/json": {
            schema: z.object({ error: z.string() }),
          },
        },
      },
    },
  }),
  async (c) => {
    const sessionContext = getSessionContext(c);

    if (!sessionContext) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    let requestBody: unknown;

    try {
      requestBody = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const parsedBody = PlannerRequestSchema.safeParse(requestBody);

    if (!parsedBody.success) {
      return c.json({ error: "Invalid planner request" }, 400);
    }

    try {
      const savedLocations = await listLocations(sessionContext.churchId);
      const result = await runVisionMeetingPlanner({
        user: sessionContext.user,
        churchId: sessionContext.churchId,
        messages: parsedBody.data.messages,
        draft: parsedBody.data.draft,
        savedLocations: savedLocations.map((location) => ({
          id: location.id,
          name: location.name,
          address: location.address,
        })),
      });

      return c.json(result, 200);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Missing OPENAI_")
      ) {
        return c.json({ error: "AI planner is not configured" }, 503);
      }

      console.error("[AI_PLANNER] Failed:", error);
      return c.json(
        {
          error:
            process.env.NODE_ENV === "production"
              ? "Failed to plan meeting"
              : error instanceof Error
                ? error.message
                : "Failed to plan meeting",
        },
        500
      );
    }
  }
);
