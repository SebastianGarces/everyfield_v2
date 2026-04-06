import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  authMiddleware,
  getAuthContext,
  requireChurchReadAccess,
  requireChurchWriteAccess,
} from "@/api/middleware/auth";
import {
  ErrorSchema,
  IdParamSchema,
  MeetingCreateRequestSchema,
  MeetingSelectSchema,
  MeetingUpdateRequestSchema,
  MeetingWithCountsSchema,
  PaginationQuerySchema,
  createListResponseSchema,
} from "@/api/schemas";
import type { ApiEnv } from "@/api/types";
import { meetingStatuses, meetingTypes } from "@/db/schema";
import {
  createMeeting,
  deleteMeeting,
  getMeeting,
  listMeetings,
  updateMeeting,
} from "@/lib/meetings/service";
import {
  apiSecurity,
  getErrorMessage,
  getErrorStatus,
  jsonContent,
} from "./shared";

const app = new OpenAPIHono<ApiEnv>();
const MeetingsListResponseSchema = createListResponseSchema(
  MeetingWithCountsSchema
);

const MeetingsListQuerySchema = PaginationQuerySchema.extend({
  meetingStatus: z.enum(meetingStatuses).optional(),
  teamId: z.string().uuid().optional(),
  temporalStatus: z.enum(["all", "upcoming", "past"]).default("all"),
  type: z.enum(meetingTypes).optional(),
});

const listMeetingsRoute = createRoute({
  method: "get",
  path: "/",
  security: apiSecurity,
  middleware: [authMiddleware, requireChurchReadAccess],
  request: {
    query: MeetingsListQuerySchema,
  },
  responses: {
    200: jsonContent(MeetingsListResponseSchema, "List of meetings"),
    400: jsonContent(ErrorSchema, "Bad request"),
    401: jsonContent(ErrorSchema, "Unauthorized"),
    403: jsonContent(ErrorSchema, "Forbidden"),
  },
});

app.openapi(listMeetingsRoute, async (c) => {
  const auth = getAuthContext(c);
  const query = MeetingsListQuerySchema.parse(c.req.query());
  const result = await listMeetings(auth.churchId!, {
    limit: query.limit,
    meetingStatus: query.meetingStatus,
    offset: query.offset,
    status: query.temporalStatus,
    teamId: query.teamId,
    type: query.type,
  });

  return c.json({ data: result.meetings, total: result.total }, 200);
});

const getMeetingRoute = createRoute({
  method: "get",
  path: "/{id}",
  security: apiSecurity,
  middleware: [authMiddleware, requireChurchReadAccess],
  request: {
    params: IdParamSchema,
  },
  responses: {
    200: jsonContent(MeetingWithCountsSchema, "Meeting record"),
    401: jsonContent(ErrorSchema, "Unauthorized"),
    403: jsonContent(ErrorSchema, "Forbidden"),
    404: jsonContent(ErrorSchema, "Not found"),
  },
});

app.openapi(getMeetingRoute, async (c) => {
  const auth = getAuthContext(c);
  const { id } = IdParamSchema.parse(c.req.param());
  const meeting = await getMeeting(auth.churchId!, id);

  if (!meeting) {
    return c.json({ error: "Meeting not found" }, 404);
  }

  return c.json(meeting, 200);
});

const createMeetingRoute = createRoute({
  method: "post",
  path: "/",
  security: apiSecurity,
  middleware: [authMiddleware, requireChurchWriteAccess],
  request: {
    body: {
      content: {
        "application/json": {
          schema: MeetingCreateRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    201: jsonContent(MeetingSelectSchema, "Created meeting"),
    400: jsonContent(ErrorSchema, "Bad request"),
    401: jsonContent(ErrorSchema, "Unauthorized"),
    403: jsonContent(ErrorSchema, "Forbidden"),
    404: jsonContent(ErrorSchema, "Not found"),
  },
});

app.openapi(createMeetingRoute, async (c) => {
  try {
    const auth = getAuthContext(c);
    const body = MeetingCreateRequestSchema.parse(await c.req.json());
    const meeting = await createMeeting(auth.churchId!, auth.user.id, body);
    return c.json(meeting, 201);
  } catch (error) {
    const message = getErrorMessage(error, "Failed to create meeting");
    return c.json({ error: message }, getErrorStatus(message));
  }
});

const updateMeetingRoute = createRoute({
  method: "put",
  path: "/{id}",
  security: apiSecurity,
  middleware: [authMiddleware, requireChurchWriteAccess],
  request: {
    params: IdParamSchema,
    body: {
      content: {
        "application/json": {
          schema: MeetingUpdateRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: jsonContent(MeetingSelectSchema, "Updated meeting"),
    400: jsonContent(ErrorSchema, "Bad request"),
    401: jsonContent(ErrorSchema, "Unauthorized"),
    403: jsonContent(ErrorSchema, "Forbidden"),
    404: jsonContent(ErrorSchema, "Not found"),
  },
});

app.openapi(updateMeetingRoute, async (c) => {
  try {
    const auth = getAuthContext(c);
    const { id } = IdParamSchema.parse(c.req.param());
    const body = MeetingUpdateRequestSchema.parse(await c.req.json());
    const meeting = await updateMeeting(auth.churchId!, id, body);
    return c.json(meeting, 200);
  } catch (error) {
    const message = getErrorMessage(error, "Failed to update meeting");
    return c.json({ error: message }, getErrorStatus(message));
  }
});

const deleteMeetingRoute = createRoute({
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

app.openapi(deleteMeetingRoute, async (c) => {
  try {
    const auth = getAuthContext(c);
    const { id } = IdParamSchema.parse(c.req.param());
    await deleteMeeting(auth.churchId!, id);
    return c.body(null, 204);
  } catch (error) {
    const message = getErrorMessage(error, "Failed to delete meeting");
    return c.json({ error: message }, getErrorStatus(message));
  }
});

export { app as meetingsRoutes };
