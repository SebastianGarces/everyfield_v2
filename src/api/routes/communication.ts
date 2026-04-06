import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { desc, eq } from "drizzle-orm";
import {
  authMiddleware,
  getAuthContext,
  requireChurchReadAccess,
  requireChurchWriteAccess,
} from "@/api/middleware/auth";
import {
  CommunicationCreateRequestSchema,
  CommunicationDetailSchema,
  CommunicationSelectSchema,
  ErrorSchema,
  IdParamSchema,
  PaginationQuerySchema,
  createListResponseSchema,
} from "@/api/schemas";
import type { ApiEnv } from "@/api/types";
import { db } from "@/db";
import { communications } from "@/db/schema";
import {
  getCommunication,
  getCommunicationRecipients,
  sendCommunication,
} from "@/lib/communication/service";
import {
  apiSecurity,
  getErrorMessage,
  getErrorStatus,
  jsonContent,
} from "./shared";

const app = new OpenAPIHono<ApiEnv>();
const CommunicationsListResponseSchema = createListResponseSchema(
  CommunicationSelectSchema
);

const listCommunicationsRoute = createRoute({
  method: "get",
  path: "/",
  security: apiSecurity,
  middleware: [authMiddleware, requireChurchReadAccess],
  request: {
    query: PaginationQuerySchema,
  },
  responses: {
    200: jsonContent(
      CommunicationsListResponseSchema,
      "List of communications"
    ),
    401: jsonContent(ErrorSchema, "Unauthorized"),
    403: jsonContent(ErrorSchema, "Forbidden"),
  },
});

app.openapi(listCommunicationsRoute, async (c) => {
  const auth = getAuthContext(c);
  const query = PaginationQuerySchema.parse(c.req.query());
  const [rows, total] = await Promise.all([
    db
      .select()
      .from(communications)
      .where(eq(communications.churchId, auth.churchId!))
      .orderBy(desc(communications.createdAt))
      .limit(query.limit)
      .offset(query.offset),
    db.$count(communications, eq(communications.churchId, auth.churchId!)),
  ]);

  return c.json({ data: rows, total }, 200);
});

const getCommunicationRoute = createRoute({
  method: "get",
  path: "/{id}",
  security: apiSecurity,
  middleware: [authMiddleware, requireChurchReadAccess],
  request: {
    params: IdParamSchema,
  },
  responses: {
    200: jsonContent(CommunicationDetailSchema, "Communication detail"),
    401: jsonContent(ErrorSchema, "Unauthorized"),
    403: jsonContent(ErrorSchema, "Forbidden"),
    404: jsonContent(ErrorSchema, "Not found"),
  },
});

app.openapi(getCommunicationRoute, async (c) => {
  const auth = getAuthContext(c);
  const { id } = IdParamSchema.parse(c.req.param());
  const communication = await getCommunication(auth.churchId!, id);

  if (!communication) {
    return c.json({ error: "Communication not found" }, 404);
  }

  const recipients = await getCommunicationRecipients(id);
  return c.json({ ...communication, recipients }, 200);
});

const createCommunicationRoute = createRoute({
  method: "post",
  path: "/",
  security: apiSecurity,
  middleware: [authMiddleware, requireChurchWriteAccess],
  request: {
    body: {
      content: {
        "application/json": {
          schema: CommunicationCreateRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    201: jsonContent(CommunicationSelectSchema, "Created communication"),
    400: jsonContent(ErrorSchema, "Bad request"),
    401: jsonContent(ErrorSchema, "Unauthorized"),
    403: jsonContent(ErrorSchema, "Forbidden"),
    404: jsonContent(ErrorSchema, "Not found"),
  },
});

app.openapi(createCommunicationRoute, async (c) => {
  try {
    const auth = getAuthContext(c);
    const body = CommunicationCreateRequestSchema.parse(await c.req.json());
    const communication = await sendCommunication(
      auth.churchId!,
      auth.user.id,
      body
    );
    return c.json(communication, 201);
  } catch (error) {
    const message = getErrorMessage(error, "Failed to create communication");
    return c.json({ error: message }, getErrorStatus(message));
  }
});

export { app as communicationRoutes };
