import { OpenAPIHono } from "@hono/zod-openapi";
import { registerCrudResource } from "@/api/crud";
import { sessionMiddleware } from "@/api/middleware/session";
import { meetingsResource } from "@/api/resources/meetings";
import { aiPlannerRoute } from "@/api/routes/ai-planner";
import { assistantRoute } from "@/api/routes/assistant";
import type { AppBindings } from "@/api/types";
import { churches } from "@/db/schema/church";
import { persons } from "@/db/schema/people";
import { tasks } from "@/db/schema/tasks";
import { ministryTeams } from "@/db/schema/ministry-teams";
import { communications } from "@/db/schema/communication";

export const app = new OpenAPIHono<AppBindings>().basePath("/api/v1");

app.use("*", sessionMiddleware);
app.route("/ai", aiPlannerRoute);
app.route("/assistant", assistantRoute);

registerCrudResource(app, "churches", churches);
registerCrudResource(app, "people", persons);
registerCrudResource(
  app,
  meetingsResource.path,
  meetingsResource.table,
  meetingsResource.options
);
registerCrudResource(app, "tasks", tasks);
registerCrudResource(app, "teams", ministryTeams);
registerCrudResource(app, "communications", communications);

app.doc("/doc", {
  openapi: "3.1.0",
  info: { title: "EveryField API", version: "0.1.0" },
});
