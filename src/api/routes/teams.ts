import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import {
  authMiddleware,
  getAuthContext,
  requireChurchReadAccess,
  requireChurchWriteAccess,
} from "@/api/middleware/auth";
import {
  ErrorSchema,
  IdParamSchema,
  TeamCreateRequestSchema,
  TeamDetailSchema,
  TeamSelectSchema,
  TeamUpdateRequestSchema,
  TeamWithStatsSchema,
  createListResponseSchema,
} from "@/api/schemas";
import type { ApiEnv } from "@/api/types";
import {
  createTeam,
  deleteTeam,
  getTeam,
  listTeams,
  updateTeam,
} from "@/lib/ministry-teams/service";
import {
  apiSecurity,
  getErrorMessage,
  getErrorStatus,
  jsonContent,
} from "./shared";

const app = new OpenAPIHono<ApiEnv>();
const TeamsListResponseSchema = createListResponseSchema(TeamWithStatsSchema);

const listTeamsRoute = createRoute({
  method: "get",
  path: "/",
  security: apiSecurity,
  middleware: [authMiddleware, requireChurchReadAccess],
  responses: {
    200: jsonContent(TeamsListResponseSchema, "List of teams"),
    401: jsonContent(ErrorSchema, "Unauthorized"),
    403: jsonContent(ErrorSchema, "Forbidden"),
  },
});

app.openapi(listTeamsRoute, async (c) => {
  const auth = getAuthContext(c);
  const teams = await listTeams(auth.churchId!);
  return c.json({ data: teams, total: teams.length }, 200);
});

const getTeamRoute = createRoute({
  method: "get",
  path: "/{id}",
  security: apiSecurity,
  middleware: [authMiddleware, requireChurchReadAccess],
  request: {
    params: IdParamSchema,
  },
  responses: {
    200: jsonContent(TeamDetailSchema, "Team detail"),
    401: jsonContent(ErrorSchema, "Unauthorized"),
    403: jsonContent(ErrorSchema, "Forbidden"),
    404: jsonContent(ErrorSchema, "Not found"),
  },
});

app.openapi(getTeamRoute, async (c) => {
  const auth = getAuthContext(c);
  const { id } = IdParamSchema.parse(c.req.param());
  const team = await getTeam(auth.churchId!, id);

  if (!team) {
    return c.json({ error: "Team not found" }, 404);
  }

  return c.json(team, 200);
});

const createTeamRoute = createRoute({
  method: "post",
  path: "/",
  security: apiSecurity,
  middleware: [authMiddleware, requireChurchWriteAccess],
  request: {
    body: {
      content: {
        "application/json": {
          schema: TeamCreateRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    201: jsonContent(TeamSelectSchema, "Created team"),
    400: jsonContent(ErrorSchema, "Bad request"),
    401: jsonContent(ErrorSchema, "Unauthorized"),
    403: jsonContent(ErrorSchema, "Forbidden"),
    404: jsonContent(ErrorSchema, "Not found"),
  },
});

app.openapi(createTeamRoute, async (c) => {
  try {
    const auth = getAuthContext(c);
    const body = TeamCreateRequestSchema.parse(await c.req.json());
    const team = await createTeam(auth.churchId!, auth.user.id, body);
    return c.json(team, 201);
  } catch (error) {
    const message = getErrorMessage(error, "Failed to create team");
    return c.json({ error: message }, getErrorStatus(message));
  }
});

const updateTeamRoute = createRoute({
  method: "put",
  path: "/{id}",
  security: apiSecurity,
  middleware: [authMiddleware, requireChurchWriteAccess],
  request: {
    params: IdParamSchema,
    body: {
      content: {
        "application/json": {
          schema: TeamUpdateRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: jsonContent(TeamSelectSchema, "Updated team"),
    400: jsonContent(ErrorSchema, "Bad request"),
    401: jsonContent(ErrorSchema, "Unauthorized"),
    403: jsonContent(ErrorSchema, "Forbidden"),
    404: jsonContent(ErrorSchema, "Not found"),
  },
});

app.openapi(updateTeamRoute, async (c) => {
  try {
    const auth = getAuthContext(c);
    const { id } = IdParamSchema.parse(c.req.param());
    const body = TeamUpdateRequestSchema.parse(await c.req.json());
    const team = await updateTeam(auth.churchId!, id, body);
    return c.json(team, 200);
  } catch (error) {
    const message = getErrorMessage(error, "Failed to update team");
    return c.json({ error: message }, getErrorStatus(message));
  }
});

const deleteTeamRoute = createRoute({
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

app.openapi(deleteTeamRoute, async (c) => {
  try {
    const auth = getAuthContext(c);
    const { id } = IdParamSchema.parse(c.req.param());
    await deleteTeam(auth.churchId!, id);
    return c.body(null, 204);
  } catch (error) {
    const message = getErrorMessage(error, "Failed to delete team");
    return c.json({ error: message }, getErrorStatus(message));
  }
});

export { app as teamsRoutes };
