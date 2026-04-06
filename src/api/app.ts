import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import type { ApiEnv } from "@/api/types";
import { churchesRoutes } from "@/api/routes/churches";
import { communicationRoutes } from "@/api/routes/communication";
import { dashboardRoutes } from "@/api/routes/dashboard";
import { meetingsRoutes } from "@/api/routes/meetings";
import { peopleRoutes } from "@/api/routes/people";
import { teamsRoutes } from "@/api/routes/teams";
import { tasksRoutes } from "@/api/routes/tasks";
import { visionMeetingsRoutes } from "@/api/routes/vision-meetings";
import { wikiRoutes } from "@/api/routes/wiki";

const app = new OpenAPIHono<ApiEnv>().basePath("/api/v1");

const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "EveryField API",
    version: "1.0.0",
  },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
      },
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "session",
      },
    },
  },
} as unknown as Parameters<typeof app.doc31>[1];

app.doc31("/doc", openApiDocument);

app.route("/churches", churchesRoutes);
app.route("/people", peopleRoutes);
app.route("/meetings", meetingsRoutes);
app.route("/vision-meetings", visionMeetingsRoutes);
app.route("/tasks", tasksRoutes);
app.route("/teams", teamsRoutes);
app.route("/communication", communicationRoutes);
app.route("/wiki", wikiRoutes);
app.route("/dashboard", dashboardRoutes);

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ error: error.message }, error.status);
  }

  console.error("[API] Unhandled error", error);
  return c.json({ error: "Internal Server Error" }, 500);
});

export { app };
