import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { authMiddleware, getAuthContext } from "@/api/middleware/auth";
import {
  ChurchContextQuerySchema,
  DashboardMetricsSchema,
  ErrorSchema,
} from "@/api/schemas";
import type { ApiEnv } from "@/api/types";
import { canAccessFeatureData, isOversightUser } from "@/lib/auth/access";
import { getDashboardMetrics } from "@/lib/dashboard/service";
import { apiSecurity, jsonContent } from "./shared";

const app = new OpenAPIHono<ApiEnv>();

const dashboardStatsRoute = createRoute({
  method: "get",
  path: "/stats",
  security: apiSecurity,
  middleware: [authMiddleware],
  request: {
    query: ChurchContextQuerySchema,
  },
  responses: {
    200: jsonContent(DashboardMetricsSchema, "Dashboard metrics"),
    400: jsonContent(ErrorSchema, "Bad request"),
    401: jsonContent(ErrorSchema, "Unauthorized"),
    403: jsonContent(ErrorSchema, "Forbidden"),
  },
});

app.openapi(dashboardStatsRoute, async (c) => {
  const auth = getAuthContext(c);
  const query = ChurchContextQuerySchema.parse(c.req.query());
  const churchId = query.churchId ?? auth.churchId;

  if (!churchId) {
    return c.json(
      { error: "churchId is required for users without a default church." },
      400
    );
  }

  if (!auth.accessibleChurchIds.includes(churchId)) {
    return c.json({ error: "Forbidden: no access to this church" }, 403);
  }

  if (auth.authMethod === "session" && isOversightUser(auth.user)) {
    const [canSeePeople, canSeeTasks, canSeeMeetings] = await Promise.all([
      canAccessFeatureData(auth.user, churchId, "people"),
      canAccessFeatureData(auth.user, churchId, "tasks"),
      canAccessFeatureData(auth.user, churchId, "meetings"),
    ]);

    if (!canSeePeople || !canSeeTasks || !canSeeMeetings) {
      return c.json(
        {
          error:
            "Forbidden: privacy settings block dashboard metrics for this church",
        },
        403
      );
    }
  }

  const metrics = await getDashboardMetrics(churchId, auth.user.id);
  return c.json(metrics, 200);
});

export { app as dashboardRoutes };
