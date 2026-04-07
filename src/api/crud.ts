import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { eq, type SQL } from "drizzle-orm";
import type { PgTableWithColumns } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { db } from "@/db";
import { getSessionContext } from "@/api/middleware/session";
import type { AppBindings, ApiSessionContext } from "@/api/types";

type CrudListWhereBuilder = (ctx: ApiSessionContext) => SQL | undefined;
type CrudGetWhereBuilder = (
  ctx: ApiSessionContext,
  id: string
) => SQL | undefined;

type CrudOptions = {
  requireSession?: boolean;
  createSchema?: z.ZodTypeAny;
  listWhere?: CrudListWhereBuilder;
  getWhere?: CrudGetWhereBuilder;
  createHandler?: (ctx: ApiSessionContext, input: unknown) => Promise<unknown>;
};

function unauthorizedSchema() {
  return z.object({ error: z.string() });
}

function badRequestSchema() {
  return z.object({ error: z.string() });
}

function mapCrudCreateError(error: unknown) {
  if (!(error instanceof Error)) {
    return null;
  }

  if (
    error.message === "Location not found" ||
    error.message === "Team not found"
  ) {
    return {
      status: 400 as const,
      error: error.message,
    };
  }

  return null;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- CRUD resource registration is intentionally generic across Drizzle tables. */
export function registerCrudResource(
  app: OpenAPIHono<AppBindings>,
  path: string,
  table: PgTableWithColumns<any>,
  options: CrudOptions = {}
) {
  const resource = new OpenAPIHono<AppBindings>();
  const selectSchema = createSelectSchema(table);
  const defaultCreateSchema = createInsertSchema(table).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  } as any);
  const createSchema = options.createSchema ?? defaultCreateSchema;

  resource.openapi(
    createRoute({
      method: "get",
      path: "/",
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z.object({ data: z.array(selectSchema) }),
            },
          },
          description: `List ${path}`,
        },
        ...(options.requireSession
          ? {
              401: {
                content: {
                  "application/json": {
                    schema: unauthorizedSchema(),
                  },
                },
                description: "Unauthorized",
              },
            }
          : {}),
      },
    }),
    async (c) => {
      const sessionContext = getSessionContext(c);

      if (options.requireSession && !sessionContext) {
        return c.json({ error: "Unauthorized" }, 401);
      }

      const whereClause =
        sessionContext && options.listWhere
          ? options.listWhere(sessionContext)
          : undefined;

      const rows = whereClause
        ? await db.select().from(table).where(whereClause)
        : await db.select().from(table);

      return c.json({ data: rows }, 200);
    }
  );

  resource.openapi(
    createRoute({
      method: "get",
      path: "/{id}",
      request: {
        params: z.object({ id: z.string().uuid() }),
      },
      responses: {
        200: {
          content: {
            "application/json": { schema: selectSchema },
          },
          description: `Get ${path}`,
        },
        404: {
          content: {
            "application/json": {
              schema: z.object({ error: z.string() }),
            },
          },
          description: "Not found",
        },
        400: {
          content: {
            "application/json": {
              schema: badRequestSchema(),
            },
          },
          description: "Bad request",
        },
        ...(options.requireSession
          ? {
              401: {
                content: {
                  "application/json": {
                    schema: unauthorizedSchema(),
                  },
                },
                description: "Unauthorized",
              },
            }
          : {}),
      },
    }),
    async (c) => {
      const sessionContext = getSessionContext(c);

      if (options.requireSession && !sessionContext) {
        return c.json({ error: "Unauthorized" }, 401);
      }

      const parsedParams = z
        .object({ id: z.string().uuid() })
        .safeParse(c.req.param());

      if (!parsedParams.success) {
        return c.json({ error: "Invalid resource id" }, 400);
      }

      const id = parsedParams.data.id;
      const whereClause =
        sessionContext && options.getWhere
          ? options.getWhere(sessionContext, id)
          : eq(table.id, id);

      const [row] = whereClause
        ? await db.select().from(table).where(whereClause)
        : [];

      if (!row) {
        return c.json({ error: "Not found" }, 404);
      }

      return c.json(row, 200);
    }
  );

  resource.openapi(
    createRoute({
      method: "post",
      path: "/",
      request: {
        body: {
          content: {
            "application/json": { schema: createSchema },
          },
        },
      },
      responses: {
        201: {
          content: {
            "application/json": { schema: selectSchema },
          },
          description: `Create ${path}`,
        },
        400: {
          content: {
            "application/json": {
              schema: badRequestSchema(),
            },
          },
          description: "Bad request",
        },
        ...(options.requireSession
          ? {
              401: {
                content: {
                  "application/json": {
                    schema: unauthorizedSchema(),
                  },
                },
                description: "Unauthorized",
              },
            }
          : {}),
      },
    }),
    async (c) => {
      const sessionContext = getSessionContext(c);

      if (options.requireSession && !sessionContext) {
        return c.json({ error: "Unauthorized" }, 401);
      }

      let requestBody: unknown;

      try {
        requestBody = await c.req.json();
      } catch {
        return c.json({ error: "Invalid JSON body" }, 400);
      }

      const parsedInput = createSchema.safeParse(requestBody);

      if (!parsedInput.success) {
        return c.json({ error: "Invalid request body" }, 400);
      }

      const input = parsedInput.data;
      try {
        const row =
          options.createHandler && sessionContext
            ? await options.createHandler(sessionContext, input)
            : (
                await db
                  .insert(table)
                  .values(input as Record<string, unknown>)
                  .returning()
              )[0];

        return c.json(row, 201);
      } catch (error) {
        const mappedError = mapCrudCreateError(error);

        if (mappedError) {
          return c.json({ error: mappedError.error }, mappedError.status);
        }

        throw error;
      }
    }
  );

  app.route(`/${path}`, resource);
}
/* eslint-enable @typescript-eslint/no-explicit-any */
