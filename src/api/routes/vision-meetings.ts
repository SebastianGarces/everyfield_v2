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
  PaginationQuerySchema,
  VisionMeetingCreateRequestSchema,
  VisionMeetingSelectSchema,
  VisionMeetingUpdateRequestSchema,
  VisionMeetingWithCountsSchema,
  createListResponseSchema,
} from "@/api/schemas";
import type { ApiEnv } from "@/api/types";
import { meetingStatuses } from "@/db/schema/vision-meetings";
import {
  createMeeting,
  deleteMeeting,
  getMeeting,
  listMeetings,
  updateMeeting,
} from "@/lib/vision-meetings/service";
import {
  apiSecurity,
  getErrorMessage,
  getErrorStatus,
  jsonContent,
} from "./shared";

const app = new OpenAPIHono<ApiEnv>();
const VisionMeetingsListResponseSchema = createListResponseSchema(
  VisionMeetingWithCountsSchema
);

const VisionMeetingsListQuerySchema = PaginationQuerySchema.extend({
  meetingStatus: z.enum(meetingStatuses).optional(),
  temporalStatus: z.enum(["all", "upcoming", "past"]).default("all"),
});

const listVisionMeetingsRoute = createRoute({
  method: "get",
  path: "/",
  security: apiSecurity,
  middleware: [authMiddleware, requireChurchReadAccess],
  request: {
    query: VisionMeetingsListQuerySchema,
  },
  responses: {
    200: jsonContent(
      VisionMeetingsListResponseSchema,
      "List of vision meetings"
    ),
    400: jsonContent(ErrorSchema, "Bad request"),
    401: jsonContent(ErrorSchema, "Unauthorized"),
    403: jsonContent(ErrorSchema, "Forbidden"),
  },
});

app.openapi(listVisionMeetingsRoute, async (c) => {
  const auth = getAuthContext(c);
  const query = VisionMeetingsListQuerySchema.parse(c.req.query());
  const result = await listMeetings(auth.churchId!, {
    limit: query.limit,
    meetingStatus: query.meetingStatus,
    offset: query.offset,
    status: query.temporalStatus,
  });

  return c.json({ data: result.meetings, total: result.total }, 200);
});

const getVisionMeetingRoute = createRoute({
  method: "get",
  path: "/{id}",
  security: apiSecurity,
  middleware: [authMiddleware, requireChurchReadAccess],
  request: {
    params: IdParamSchema,
  },
  responses: {
    200: jsonContent(VisionMeetingWithCountsSchema, "Vision meeting record"),
    401: jsonContent(ErrorSchema, "Unauthorized"),
    403: jsonContent(ErrorSchema, "Forbidden"),
    404: jsonContent(ErrorSchema, "Not found"),
  },
});

app.openapi(getVisionMeetingRoute, async (c) => {
  const auth = getAuthContext(c);
  const { id } = IdParamSchema.parse(c.req.param());
  const meeting = await getMeeting(auth.churchId!, id);

  if (!meeting) {
    return c.json({ error: "Meeting not found" }, 404);
  }

  return c.json(meeting, 200);
});

const createVisionMeetingRoute = createRoute({
  method: "post",
  path: "/",
  security: apiSecurity,
  middleware: [authMiddleware, requireChurchWriteAccess],
  request: {
    body: {
      content: {
        "application/json": {
          schema: VisionMeetingCreateRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    201: jsonContent(VisionMeetingSelectSchema, "Created vision meeting"),
    400: jsonContent(ErrorSchema, "Bad request"),
    401: jsonContent(ErrorSchema, "Unauthorized"),
    403: jsonContent(ErrorSchema, "Forbidden"),
    404: jsonContent(ErrorSchema, "Not found"),
  },
});

app.openapi(createVisionMeetingRoute, async (c) => {
  try {
    const auth = getAuthContext(c);
    const body = VisionMeetingCreateRequestSchema.parse(await c.req.json());
    const meeting = await createMeeting(auth.churchId!, auth.user.id, body);
    return c.json(meeting, 201);
  } catch (error) {
    const message = getErrorMessage(error, "Failed to create vision meeting");
    return c.json({ error: message }, getErrorStatus(message));
  }
});

const updateVisionMeetingRoute = createRoute({
  method: "put",
  path: "/{id}",
  security: apiSecurity,
  middleware: [authMiddleware, requireChurchWriteAccess],
  request: {
    params: IdParamSchema,
    body: {
      content: {
        "application/json": {
          schema: VisionMeetingUpdateRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: jsonContent(VisionMeetingSelectSchema, "Updated vision meeting"),
    400: jsonContent(ErrorSchema, "Bad request"),
    401: jsonContent(ErrorSchema, "Unauthorized"),
    403: jsonContent(ErrorSchema, "Forbidden"),
    404: jsonContent(ErrorSchema, "Not found"),
  },
});

app.openapi(updateVisionMeetingRoute, async (c) => {
  try {
    const auth = getAuthContext(c);
    const { id } = IdParamSchema.parse(c.req.param());
    const body = VisionMeetingUpdateRequestSchema.parse(await c.req.json());
    const meeting = await updateMeeting(auth.churchId!, id, body);
    return c.json(meeting, 200);
  } catch (error) {
    const message = getErrorMessage(error, "Failed to update vision meeting");
    return c.json({ error: message }, getErrorStatus(message));
  }
});

const deleteVisionMeetingRoute = createRoute({
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

app.openapi(deleteVisionMeetingRoute, async (c) => {
  try {
    const auth = getAuthContext(c);
    const { id } = IdParamSchema.parse(c.req.param());
    await deleteMeeting(auth.churchId!, id);
    return c.body(null, 204);
  } catch (error) {
    const message = getErrorMessage(error, "Failed to delete vision meeting");
    return c.json({ error: message }, getErrorStatus(message));
  }
});

export { app as visionMeetingsRoutes };
