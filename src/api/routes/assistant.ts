import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import type { AppBindings } from "@/api/types";
import { getSessionContext } from "@/api/middleware/session";
import {
  clearAssistantHistory,
  createAssistantThread,
  getAssistantThread,
  listAssistantHistory,
  listAssistantThreads,
} from "@/lib/assistant/service";
import {
  createMeetingFromAssistantThread,
  handleAssistantConversationTurn,
} from "@/lib/assistant/meeting-orchestrator";

const assistantThreadSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastMessageAt: z.string(),
});

const assistantMessageSchema = z.object({
  id: z.string().uuid(),
  role: z.string(),
  content: z.string(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
});

const assistantArtifactSchema = z.object({
  id: z.string().uuid(),
  kind: z.string(),
  status: z.string(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const assistantThreadDetailSchema = z.object({
  thread: assistantThreadSchema,
  messages: z.array(assistantMessageSchema),
  artifacts: z.array(assistantArtifactSchema),
});

const assistantHistorySchema = z.object({
  threads: z.array(assistantThreadSchema),
});

const createThreadRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(255).optional(),
  })
  .optional();

const createMessageRequestSchema = z.object({
  content: z.string().trim().min(1).max(4000),
});

const errorSchema = z.object({ error: z.string() });

export const assistantRoute = new OpenAPIHono<AppBindings>();

assistantRoute.openapi(
  createRoute({
    method: "get",
    path: "/history",
    responses: {
      200: {
        description: "Archived assistant thread list",
        content: {
          "application/json": {
            schema: assistantHistorySchema,
          },
        },
      },
      401: {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: errorSchema,
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

    const threads = await listAssistantHistory(
      sessionContext.churchId,
      sessionContext.user.id
    );

    return c.json({ threads }, 200);
  }
);

assistantRoute.openapi(
  createRoute({
    method: "get",
    path: "/threads",
    responses: {
      200: {
        description: "Assistant thread list",
        content: {
          "application/json": {
            schema: z.object({
              threads: z.array(assistantThreadSchema),
            }),
          },
        },
      },
      401: {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: errorSchema,
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

    const threads = await listAssistantThreads(
      sessionContext.churchId,
      sessionContext.user.id
    );

    return c.json({ threads }, 200);
  }
);

assistantRoute.openapi(
  createRoute({
    method: "post",
    path: "/threads",
    request: {
      body: {
        content: {
          "application/json": {
            schema: createThreadRequestSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: "Created assistant thread",
        content: {
          "application/json": {
            schema: z.object({
              thread: assistantThreadSchema,
            }),
          },
        },
      },
      400: {
        description: "Invalid request",
        content: {
          "application/json": {
            schema: errorSchema,
          },
        },
      },
      401: {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: errorSchema,
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

    let requestBody: unknown = {};

    try {
      const contentType = c.req.header("content-type");

      if (contentType?.includes("application/json")) {
        requestBody = await c.req.json();
      }
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    const parsedBody = createThreadRequestSchema.safeParse(requestBody);

    if (!parsedBody.success) {
      return c.json({ error: "Invalid assistant thread request" }, 400);
    }

    const thread = await createAssistantThread(
      sessionContext.churchId,
      sessionContext.user.id,
      parsedBody.data
    );

    return c.json({ thread }, 201);
  }
);

assistantRoute.openapi(
  createRoute({
    method: "get",
    path: "/threads/{threadId}",
    request: {
      params: z.object({
        threadId: z.string().uuid(),
      }),
    },
    responses: {
      200: {
        description: "Assistant thread detail",
        content: {
          "application/json": {
            schema: assistantThreadDetailSchema,
          },
        },
      },
      401: {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: errorSchema,
          },
        },
      },
      404: {
        description: "Thread not found",
        content: {
          "application/json": {
            schema: errorSchema,
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

    const { threadId } = c.req.valid("param");
    const thread = await getAssistantThread(
      sessionContext.churchId,
      sessionContext.user.id,
      threadId
    );

    if (!thread) {
      return c.json({ error: "Assistant thread not found" }, 404);
    }

    return c.json(thread, 200);
  }
);

assistantRoute.openapi(
  createRoute({
    method: "post",
    path: "/history/clear",
    responses: {
      200: {
        description: "Archived threads cleared",
        content: {
          "application/json": {
            schema: z.object({
              deletedCount: z.number().int().min(0),
            }),
          },
        },
      },
      401: {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: errorSchema,
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

    const deletedCount = await clearAssistantHistory(
      sessionContext.churchId,
      sessionContext.user.id
    );

    return c.json({ deletedCount }, 200);
  }
);

assistantRoute.openapi(
  createRoute({
    method: "post",
    path: "/threads/{threadId}/messages",
    request: {
      params: z.object({
        threadId: z.string().uuid(),
      }),
      body: {
        content: {
          "application/json": {
            schema: createMessageRequestSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: "Updated assistant thread detail",
        content: {
          "application/json": {
            schema: assistantThreadDetailSchema,
          },
        },
      },
      400: {
        description: "Invalid request",
        content: {
          "application/json": {
            schema: errorSchema,
          },
        },
      },
      401: {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: errorSchema,
          },
        },
      },
      404: {
        description: "Thread not found",
        content: {
          "application/json": {
            schema: errorSchema,
          },
        },
      },
      409: {
        description: "Thread state conflict",
        content: {
          "application/json": {
            schema: errorSchema,
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

    const parsedBody = createMessageRequestSchema.safeParse(requestBody);

    if (!parsedBody.success) {
      return c.json({ error: "Invalid assistant message request" }, 400);
    }

    const { threadId } = c.req.valid("param");

    try {
      const thread = await handleAssistantConversationTurn({
        churchId: sessionContext.churchId,
        userId: sessionContext.user.id,
        threadId,
        content: parsedBody.data.content,
      });

      return c.json(thread, 200);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === "Assistant thread not found" ||
          error.message === "Assistant thread is archived")
      ) {
        return c.json({ error: error.message }, 404);
      }

      throw error;
    }
  }
);

assistantRoute.openapi(
  createRoute({
    method: "post",
    path: "/threads/{threadId}/actions/create-meeting",
    request: {
      params: z.object({
        threadId: z.string().uuid(),
      }),
    },
    responses: {
      200: {
        description: "Meeting created and assistant thread updated",
        content: {
          "application/json": {
            schema: assistantThreadDetailSchema,
          },
        },
      },
      401: {
        description: "Unauthorized",
        content: {
          "application/json": {
            schema: errorSchema,
          },
        },
      },
      404: {
        description: "Thread not found",
        content: {
          "application/json": {
            schema: errorSchema,
          },
        },
      },
      409: {
        description: "Meeting draft conflict",
        content: {
          "application/json": {
            schema: errorSchema,
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

    const { threadId } = c.req.valid("param");

    try {
      const thread = await createMeetingFromAssistantThread({
        churchId: sessionContext.churchId,
        userId: sessionContext.user.id,
        threadId,
      });

      return c.json(thread, 200);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === "Assistant thread not found" ||
          error.message === "Assistant thread is archived")
      ) {
        return c.json({ error: error.message }, 404);
      }

      if (
        error instanceof Error &&
        (error.message === "No meeting draft found" ||
          error.message === "Meeting has already been created" ||
          error.message === "Meeting draft is not ready to create")
      ) {
        return c.json({ error: error.message }, 409);
      }

      if (
        error instanceof Error &&
        (error.message === "Location not found" ||
          error.message === "Team not found")
      ) {
        return c.json({ error: error.message }, 409);
      }

      throw error;
    }
  }
);
