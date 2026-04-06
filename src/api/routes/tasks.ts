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
  TaskCreateRequestSchema,
  TaskSelectSchema,
  TaskUpdateRequestSchema,
  TaskWithAssigneeSchema,
  createListResponseSchema,
} from "@/api/schemas";
import type { ApiEnv } from "@/api/types";
import { db } from "@/db";
import { taskStatuses, tasks, users } from "@/db/schema";
import {
  createTask,
  deleteTask,
  getTask,
  updateTask,
} from "@/lib/tasks/service";
import {
  apiSecurity,
  getErrorMessage,
  getErrorStatus,
  jsonContent,
} from "./shared";

const app = new OpenAPIHono<ApiEnv>();
const TasksListResponseSchema = createListResponseSchema(
  TaskWithAssigneeSchema
);

const TasksListQuerySchema = PaginationQuerySchema.extend({
  assignedToId: z.string().uuid().optional(),
  status: z.enum(taskStatuses).optional(),
});

const listTasksRoute = createRoute({
  method: "get",
  path: "/",
  security: apiSecurity,
  middleware: [authMiddleware, requireChurchReadAccess],
  request: {
    query: TasksListQuerySchema,
  },
  responses: {
    200: jsonContent(TasksListResponseSchema, "List of tasks"),
    400: jsonContent(ErrorSchema, "Bad request"),
    401: jsonContent(ErrorSchema, "Unauthorized"),
    403: jsonContent(ErrorSchema, "Forbidden"),
  },
});

app.openapi(listTasksRoute, async (c) => {
  const auth = getAuthContext(c);
  const query = TasksListQuerySchema.parse(c.req.query());
  const conditions = [
    eq(tasks.churchId, auth.churchId!),
    isNull(tasks.deletedAt),
  ];

  if (query.assignedToId) {
    conditions.push(eq(tasks.assignedToId, query.assignedToId));
  }

  if (query.status) {
    conditions.push(eq(tasks.status, query.status));
  }

  const [rows, countRows] = await Promise.all([
    db
      .select({
        id: tasks.id,
        churchId: tasks.churchId,
        title: tasks.title,
        description: tasks.description,
        status: tasks.status,
        priority: tasks.priority,
        dueDate: tasks.dueDate,
        dueTime: tasks.dueTime,
        assignedToId: tasks.assignedToId,
        category: tasks.category,
        relatedType: tasks.relatedType,
        relatedId: tasks.relatedId,
        parentTaskId: tasks.parentTaskId,
        isRecurring: tasks.isRecurring,
        recurrenceRule: tasks.recurrenceRule,
        completionEvent: tasks.completionEvent,
        completedAt: tasks.completedAt,
        completedById: tasks.completedById,
        createdById: tasks.createdById,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
        deletedAt: tasks.deletedAt,
        assigneeName: users.name,
        assigneeEmail: users.email,
      })
      .from(tasks)
      .leftJoin(users, eq(tasks.assignedToId, users.id))
      .where(and(...conditions))
      .orderBy(desc(tasks.createdAt), desc(tasks.id))
      .limit(query.limit)
      .offset(query.offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(...conditions)),
  ]);

  return c.json({ data: rows, total: countRows[0]?.count ?? 0 }, 200);
});

const getTaskRoute = createRoute({
  method: "get",
  path: "/{id}",
  security: apiSecurity,
  middleware: [authMiddleware, requireChurchReadAccess],
  request: {
    params: IdParamSchema,
  },
  responses: {
    200: jsonContent(TaskWithAssigneeSchema, "Task record"),
    401: jsonContent(ErrorSchema, "Unauthorized"),
    403: jsonContent(ErrorSchema, "Forbidden"),
    404: jsonContent(ErrorSchema, "Not found"),
  },
});

app.openapi(getTaskRoute, async (c) => {
  const auth = getAuthContext(c);
  const { id } = IdParamSchema.parse(c.req.param());
  const task = await getTask(auth.churchId!, id);

  if (!task) {
    return c.json({ error: "Task not found" }, 404);
  }

  return c.json(task, 200);
});

const createTaskRoute = createRoute({
  method: "post",
  path: "/",
  security: apiSecurity,
  middleware: [authMiddleware, requireChurchWriteAccess],
  request: {
    body: {
      content: {
        "application/json": {
          schema: TaskCreateRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    201: jsonContent(TaskSelectSchema, "Created task"),
    400: jsonContent(ErrorSchema, "Bad request"),
    401: jsonContent(ErrorSchema, "Unauthorized"),
    403: jsonContent(ErrorSchema, "Forbidden"),
    404: jsonContent(ErrorSchema, "Not found"),
  },
});

app.openapi(createTaskRoute, async (c) => {
  try {
    const auth = getAuthContext(c);
    const body = TaskCreateRequestSchema.parse(await c.req.json());
    const task = await createTask(auth.churchId!, auth.user.id, body);
    return c.json(task, 201);
  } catch (error) {
    const message = getErrorMessage(error, "Failed to create task");
    return c.json({ error: message }, getErrorStatus(message));
  }
});

const updateTaskRoute = createRoute({
  method: "put",
  path: "/{id}",
  security: apiSecurity,
  middleware: [authMiddleware, requireChurchWriteAccess],
  request: {
    params: IdParamSchema,
    body: {
      content: {
        "application/json": {
          schema: TaskUpdateRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: jsonContent(TaskSelectSchema, "Updated task"),
    400: jsonContent(ErrorSchema, "Bad request"),
    401: jsonContent(ErrorSchema, "Unauthorized"),
    403: jsonContent(ErrorSchema, "Forbidden"),
    404: jsonContent(ErrorSchema, "Not found"),
  },
});

app.openapi(updateTaskRoute, async (c) => {
  try {
    const auth = getAuthContext(c);
    const { id } = IdParamSchema.parse(c.req.param());
    const body = TaskUpdateRequestSchema.parse(await c.req.json());
    const task = await updateTask(auth.churchId!, id, body);
    return c.json(task, 200);
  } catch (error) {
    const message = getErrorMessage(error, "Failed to update task");
    return c.json({ error: message }, getErrorStatus(message));
  }
});

const deleteTaskRoute = createRoute({
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

app.openapi(deleteTaskRoute, async (c) => {
  try {
    const auth = getAuthContext(c);
    const { id } = IdParamSchema.parse(c.req.param());
    await deleteTask(auth.churchId!, id);
    return c.body(null, 204);
  } catch (error) {
    const message = getErrorMessage(error, "Failed to delete task");
    return c.json({ error: message }, getErrorStatus(message));
  }
});

export { app as tasksRoutes };
