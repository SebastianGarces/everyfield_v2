import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { createSelectSchema, createInsertSchema } from "drizzle-zod";
import { eq } from "drizzle-orm";
import type { PgTableWithColumns } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { churches } from "@/db/schema/church";
import { persons } from "@/db/schema/people";
import { churchMeetings } from "@/db/schema/meetings";
import { tasks } from "@/db/schema/tasks";
import { ministryTeams } from "@/db/schema/ministry-teams";
import { communications } from "@/db/schema/communication";

export const app = new OpenAPIHono().basePath("/api/v1");

// Generic CRUD factory — derives OpenAPI schemas from drizzle tables
function crud(path: string, table: PgTableWithColumns<any>) {
  const r = new OpenAPIHono();
  const select = createSelectSchema(table);
  const insert = createInsertSchema(table).omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  } as any);

  r.openapi(
    createRoute({
      method: "get",
      path: "/",
      responses: {
        200: {
          content: {
            "application/json": { schema: z.object({ data: z.array(select) }) },
          },
          description: `List ${path}`,
        },
      },
    }),
    async (c) => c.json({ data: await db.select().from(table) })
  );

  r.openapi(
    createRoute({
      method: "get",
      path: "/{id}",
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: {
        200: {
          content: { "application/json": { schema: select } },
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
      },
    }),
    async (c) => {
      const [row] = await db
        .select()
        .from(table)
        .where(eq(table.id, c.req.valid("param").id));
      if (!row) {
        return c.json({ error: "Not found" }, 404);
      }
      return c.json(row, 200);
    }
  );

  r.openapi(
    createRoute({
      method: "post",
      path: "/",
      request: {
        body: { content: { "application/json": { schema: insert } } },
      },
      responses: {
        201: {
          content: { "application/json": { schema: select } },
          description: `Create ${path}`,
        },
      },
    }),
    async (c) => {
      const [row] = await db
        .insert(table)
        .values(c.req.valid("json"))
        .returning();
      return c.json(row, 201);
    }
  );

  app.route(`/${path}`, r);
}

crud("churches", churches);
crud("people", persons);
crud("meetings", churchMeetings);
crud("tasks", tasks);
crud("teams", ministryTeams);
crud("communications", communications);

app.doc("/doc", {
  openapi: "3.1.0",
  info: { title: "EveryField API", version: "0.1.0" },
});
