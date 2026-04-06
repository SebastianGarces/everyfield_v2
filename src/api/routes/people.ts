import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  authMiddleware,
  getAuthContext,
  requireChurchReadAccess,
  requireChurchWriteAccess,
} from "@/api/middleware/auth";
import {
  ErrorSchema,
  IdParamSchema,
  PaginationQuerySchema,
  PersonCreateRequestSchema,
  PersonSelectSchema,
  PersonUpdateRequestSchema,
  createListResponseSchema,
} from "@/api/schemas";
import type { ApiEnv } from "@/api/types";
import { db } from "@/db";
import { personStatuses, persons } from "@/db/schema";
import {
  createPerson,
  deletePerson,
  getPerson,
  updatePerson,
} from "@/lib/people/service";
import {
  apiSecurity,
  getErrorMessage,
  getErrorStatus,
  jsonContent,
} from "./shared";

const app = new OpenAPIHono<ApiEnv>();
const PeopleListResponseSchema = createListResponseSchema(PersonSelectSchema);

const PeopleListQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(personStatuses).optional(),
});

const listPeopleRoute = createRoute({
  method: "get",
  path: "/",
  security: apiSecurity,
  middleware: [authMiddleware, requireChurchReadAccess],
  request: {
    query: PeopleListQuerySchema,
  },
  responses: {
    200: jsonContent(PeopleListResponseSchema, "List of people"),
    400: jsonContent(ErrorSchema, "Bad request"),
    401: jsonContent(ErrorSchema, "Unauthorized"),
    403: jsonContent(ErrorSchema, "Forbidden"),
  },
});

app.openapi(listPeopleRoute, async (c) => {
  const auth = getAuthContext(c);
  const query = PeopleListQuerySchema.parse(c.req.query());
  const conditions = [
    eq(persons.churchId, auth.churchId!),
    isNull(persons.deletedAt),
  ];

  if (query.status) {
    conditions.push(eq(persons.status, query.status));
  }

  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(persons)
      .where(and(...conditions))
      .orderBy(desc(persons.createdAt), desc(persons.id))
      .limit(query.limit)
      .offset(query.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(persons)
      .where(and(...conditions)),
  ]);

  return c.json({ data: rows, total: countRows[0]?.count ?? 0 }, 200);
});

const getPersonRoute = createRoute({
  method: "get",
  path: "/{id}",
  security: apiSecurity,
  middleware: [authMiddleware, requireChurchReadAccess],
  request: {
    params: IdParamSchema,
  },
  responses: {
    200: jsonContent(PersonSelectSchema, "Person record"),
    401: jsonContent(ErrorSchema, "Unauthorized"),
    403: jsonContent(ErrorSchema, "Forbidden"),
    404: jsonContent(ErrorSchema, "Not found"),
  },
});

app.openapi(getPersonRoute, async (c) => {
  const auth = getAuthContext(c);
  const { id } = IdParamSchema.parse(c.req.param());
  const person = await getPerson(auth.churchId!, id);

  if (!person) {
    return c.json({ error: "Person not found" }, 404);
  }

  return c.json(person, 200);
});

const createPersonRoute = createRoute({
  method: "post",
  path: "/",
  security: apiSecurity,
  middleware: [authMiddleware, requireChurchWriteAccess],
  request: {
    body: {
      content: {
        "application/json": {
          schema: PersonCreateRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    201: jsonContent(PersonSelectSchema, "Created person"),
    400: jsonContent(ErrorSchema, "Bad request"),
    401: jsonContent(ErrorSchema, "Unauthorized"),
    403: jsonContent(ErrorSchema, "Forbidden"),
    404: jsonContent(ErrorSchema, "Not found"),
  },
});

app.openapi(createPersonRoute, async (c) => {
  try {
    const auth = getAuthContext(c);
    const body = PersonCreateRequestSchema.parse(await c.req.json());
    const person = await createPerson(auth.churchId!, auth.user.id, body);
    return c.json(person, 201);
  } catch (error) {
    const message = getErrorMessage(error, "Failed to create person");
    return c.json({ error: message }, getErrorStatus(message));
  }
});

const updatePersonRoute = createRoute({
  method: "put",
  path: "/{id}",
  security: apiSecurity,
  middleware: [authMiddleware, requireChurchWriteAccess],
  request: {
    params: IdParamSchema,
    body: {
      content: {
        "application/json": {
          schema: PersonUpdateRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: jsonContent(PersonSelectSchema, "Updated person"),
    400: jsonContent(ErrorSchema, "Bad request"),
    401: jsonContent(ErrorSchema, "Unauthorized"),
    403: jsonContent(ErrorSchema, "Forbidden"),
    404: jsonContent(ErrorSchema, "Not found"),
  },
});

app.openapi(updatePersonRoute, async (c) => {
  try {
    const auth = getAuthContext(c);
    const { id } = IdParamSchema.parse(c.req.param());
    const body = PersonUpdateRequestSchema.parse(await c.req.json());
    const person = await updatePerson(auth.churchId!, id, body);
    return c.json(person, 200);
  } catch (error) {
    const message = getErrorMessage(error, "Failed to update person");
    return c.json({ error: message }, getErrorStatus(message));
  }
});

const deletePersonRoute = createRoute({
  method: "delete",
  path: "/{id}",
  security: apiSecurity,
  middleware: [authMiddleware, requireChurchWriteAccess],
  request: {
    params: IdParamSchema,
  },
  responses: {
    204: {
      description: "Deleted",
    },
    401: jsonContent(ErrorSchema, "Unauthorized"),
    403: jsonContent(ErrorSchema, "Forbidden"),
    404: jsonContent(ErrorSchema, "Not found"),
  },
});

app.openapi(deletePersonRoute, async (c) => {
  try {
    const auth = getAuthContext(c);
    const { id } = IdParamSchema.parse(c.req.param());
    await deletePerson(auth.churchId!, id);
    return c.body(null, 204);
  } catch (error) {
    const message = getErrorMessage(error, "Failed to delete person");
    return c.json({ error: message }, getErrorStatus(message));
  }
});

export { app as peopleRoutes };
