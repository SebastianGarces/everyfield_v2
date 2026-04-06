import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { authMiddleware, getAuthContext } from "@/api/middleware/auth";
import {
  ErrorSchema,
  SlugParamSchema,
  WikiArticleSelectSchema,
  createListResponseSchema,
} from "@/api/schemas";
import type { ApiEnv } from "@/api/types";
import { db } from "@/db";
import { wikiArticles } from "@/db/schema";
import { getArticleBySlug } from "@/lib/wiki/service";
import { apiSecurity, jsonContent } from "./shared";

const app = new OpenAPIHono<ApiEnv>();
const WikiArticlesListResponseSchema = createListResponseSchema(
  WikiArticleSelectSchema
);

const listWikiRoute = createRoute({
  method: "get",
  path: "/",
  security: apiSecurity,
  middleware: [authMiddleware],
  responses: {
    200: jsonContent(WikiArticlesListResponseSchema, "List of wiki articles"),
    401: jsonContent(ErrorSchema, "Unauthorized"),
  },
});

app.openapi(listWikiRoute, async (c) => {
  const auth = getAuthContext(c);
  const conditions = [
    eq(wikiArticles.status, "published"),
    auth.churchId
      ? or(
          isNull(wikiArticles.churchId),
          eq(wikiArticles.churchId, auth.churchId)
        )
      : isNull(wikiArticles.churchId),
  ];

  const rows = await db
    .select()
    .from(wikiArticles)
    .where(and(...conditions))
    .orderBy(asc(wikiArticles.sortOrder), asc(wikiArticles.title));

  return c.json({ data: rows, total: rows.length }, 200);
});

const getWikiRoute = createRoute({
  method: "get",
  path: "/{slug}",
  security: apiSecurity,
  middleware: [authMiddleware],
  request: {
    params: SlugParamSchema,
  },
  responses: {
    200: jsonContent(WikiArticleSelectSchema, "Wiki article"),
    401: jsonContent(ErrorSchema, "Unauthorized"),
    404: jsonContent(ErrorSchema, "Not found"),
  },
});

app.openapi(getWikiRoute, async (c) => {
  const auth = getAuthContext(c);
  const { slug } = SlugParamSchema.parse(c.req.param());

  const article =
    (auth.churchId ? await getArticleBySlug(slug, auth.churchId) : null) ??
    (await getArticleBySlug(slug, null));

  if (!article) {
    return c.json({ error: "Article not found" }, 404);
  }

  return c.json(article, 200);
});

export { app as wikiRoutes };
