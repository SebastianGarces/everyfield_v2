import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { asc, eq, inArray } from "drizzle-orm";
import {
  authMiddleware,
  getAuthContext,
  requireChurchWriteAccess,
} from "@/api/middleware/auth";
import {
  ChurchCreateRequestSchema,
  ChurchSelectSchema,
  ChurchUpdateRequestSchema,
  ErrorSchema,
  IdParamSchema,
  createListResponseSchema,
} from "@/api/schemas";
import type { ApiEnv } from "@/api/types";
import { db } from "@/db";
import { churches } from "@/db/schema";
import {
  apiSecurity,
  getErrorMessage,
  getErrorStatus,
  jsonContent,
} from "./shared";

const app = new OpenAPIHono<ApiEnv>();
const ChurchListResponseSchema = createListResponseSchema(ChurchSelectSchema);

const listChurchesRoute = createRoute({
  method: "get",
  path: "/",
  security: apiSecurity,
  middleware: [authMiddleware],
  responses: {
    200: jsonContent(ChurchListResponseSchema, "List of accessible churches"),
    401: jsonContent(ErrorSchema, "Unauthorized"),
  },
});

app.openapi(listChurchesRoute, async (c) => {
  const auth = getAuthContext(c);
  if (auth.accessibleChurchIds.length === 0) {
    return c.json({ data: [], total: 0 }, 200);
  }

  const rows = await db
    .select()
    .from(churches)
    .where(inArray(churches.id, auth.accessibleChurchIds))
    .orderBy(asc(churches.name));

  return c.json({ data: rows, total: rows.length }, 200);
});

const getChurchRoute = createRoute({
  method: "get",
  path: "/{id}",
  security: apiSecurity,
  middleware: [authMiddleware],
  request: {
    params: IdParamSchema,
  },
  responses: {
    200: jsonContent(ChurchSelectSchema, "Church record"),
    401: jsonContent(ErrorSchema, "Unauthorized"),
    403: jsonContent(ErrorSchema, "Forbidden"),
    404: jsonContent(ErrorSchema, "Not found"),
  },
});

app.openapi(getChurchRoute, async (c) => {
  const auth = getAuthContext(c);
  const { id } = IdParamSchema.parse(c.req.param());

  if (!auth.accessibleChurchIds.includes(id)) {
    return c.json({ error: "Forbidden: no access to this church" }, 403);
  }

  const [church] = await db
    .select()
    .from(churches)
    .where(eq(churches.id, id))
    .limit(1);

  if (!church) {
    return c.json({ error: "Church not found" }, 404);
  }

  return c.json(church, 200);
});

const createChurchRoute = createRoute({
  method: "post",
  path: "/",
  security: apiSecurity,
  middleware: [authMiddleware, requireChurchWriteAccess],
  request: {
    body: {
      content: {
        "application/json": {
          schema: ChurchCreateRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    201: jsonContent(ChurchSelectSchema, "Created church"),
    400: jsonContent(ErrorSchema, "Bad request"),
    401: jsonContent(ErrorSchema, "Unauthorized"),
    403: jsonContent(ErrorSchema, "Forbidden"),
    404: jsonContent(ErrorSchema, "Not found"),
  },
});

app.openapi(createChurchRoute, async (c) => {
  try {
    const body = ChurchCreateRequestSchema.parse(await c.req.json());
    const [church] = await db.insert(churches).values(body).returning();
    return c.json(church, 201);
  } catch (error) {
    const message = getErrorMessage(error, "Failed to create church");
    return c.json({ error: message }, getErrorStatus(message));
  }
});

const updateChurchRoute = createRoute({
  method: "put",
  path: "/{id}",
  security: apiSecurity,
  middleware: [authMiddleware, requireChurchWriteAccess],
  request: {
    params: IdParamSchema,
    body: {
      content: {
        "application/json": {
          schema: ChurchUpdateRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: jsonContent(ChurchSelectSchema, "Updated church"),
    400: jsonContent(ErrorSchema, "Bad request"),
    401: jsonContent(ErrorSchema, "Unauthorized"),
    403: jsonContent(ErrorSchema, "Forbidden"),
    404: jsonContent(ErrorSchema, "Not found"),
  },
});

app.openapi(updateChurchRoute, async (c) => {
  const auth = getAuthContext(c);
  const { id } = IdParamSchema.parse(c.req.param());

  if (!auth.accessibleChurchIds.includes(id)) {
    return c.json({ error: "Forbidden: no access to this church" }, 403);
  }

  const body = ChurchUpdateRequestSchema.parse(await c.req.json());
  const [church] = await db
    .update(churches)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(churches.id, id))
    .returning();

  if (!church) {
    return c.json({ error: "Church not found" }, 404);
  }

  return c.json(church, 200);
});

export { app as churchesRoutes };
