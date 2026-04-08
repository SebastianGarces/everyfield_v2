import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { churches } from "./church";
import { users } from "./user";

export const assistantThreadStatuses = ["active", "archived"] as const;
export type AssistantThreadStatus = (typeof assistantThreadStatuses)[number];

export const assistantMessageRoles = ["user", "assistant", "system"] as const;
export type AssistantMessageRole = (typeof assistantMessageRoles)[number];

export const assistantArtifactKinds = [
  "meeting_draft",
  "invite_compose",
  "follow_up_batch",
] as const;
export type AssistantArtifactKind = (typeof assistantArtifactKinds)[number];

export const assistantArtifactStatuses = [
  "active",
  "completed",
  "dismissed",
] as const;
export type AssistantArtifactStatus =
  (typeof assistantArtifactStatuses)[number];

export const assistantThreads = pgTable(
  "assistant_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    churchId: uuid("church_id")
      .references(() => churches.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    title: varchar("title", { length: 255 }).notNull().default("New chat"),
    status: varchar("status", { length: 20 })
      .$type<AssistantThreadStatus>()
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
    lastMessageAt: timestamp("last_message_at").defaultNow().notNull(),
  },
  (table) => [
    index("assistant_threads_church_user_last_message_idx").on(
      table.churchId,
      table.userId,
      table.lastMessageAt
    ),
  ]
);

export const assistantMessages = pgTable(
  "assistant_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .references(() => assistantThreads.id, { onDelete: "cascade" })
      .notNull(),
    churchId: uuid("church_id")
      .references(() => churches.id, { onDelete: "cascade" })
      .notNull(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    role: varchar("role", { length: 20 })
      .$type<AssistantMessageRole>()
      .notNull(),
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("assistant_messages_thread_created_at_idx").on(
      table.threadId,
      table.createdAt
    ),
  ]
);

export const assistantArtifacts = pgTable(
  "assistant_artifacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    threadId: uuid("thread_id")
      .references(() => assistantThreads.id, { onDelete: "cascade" })
      .notNull(),
    churchId: uuid("church_id")
      .references(() => churches.id, { onDelete: "cascade" })
      .notNull(),
    kind: varchar("kind", { length: 50 })
      .$type<AssistantArtifactKind>()
      .notNull(),
    status: varchar("status", { length: 20 })
      .$type<AssistantArtifactStatus>()
      .notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("assistant_artifacts_thread_status_updated_at_idx").on(
      table.threadId,
      table.status,
      table.updatedAt
    ),
  ]
);

export type AssistantThread = typeof assistantThreads.$inferSelect;
export type NewAssistantThread = typeof assistantThreads.$inferInsert;

export type AssistantMessage = typeof assistantMessages.$inferSelect;
export type NewAssistantMessage = typeof assistantMessages.$inferInsert;

export type AssistantArtifact = typeof assistantArtifacts.$inferSelect;
export type NewAssistantArtifact = typeof assistantArtifacts.$inferInsert;
