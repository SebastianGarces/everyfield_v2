import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  buildEvryReadArtifact,
  trustedEvryApplicationSourceLink,
} from "@/lib/evry/artifacts/core";
import type { EvryReadArtifact } from "@/lib/evry/artifacts/types";
import {
  formatDateTimeWithZone,
  formatDateWithoutWeekday,
} from "@/lib/datetime";

const technicalFactLabels = new Set([
  "Template ID",
  "Creator account ID",
  "Person ID",
  "Message ID",
  "Meeting ID",
  "Task ID",
  "Milestone ID",
  "Assignee account ID",
  "Assessment ID",
  "Source ID",
  "Group ID",
  "Revision",
  "Citation slug",
  "Next offset",
]);
const instantFactLabels = new Set([
  "Generated at",
  "Created at",
  "Sent at",
  "Latest sent at",
  "Delivered at",
  "Opened at",
  "Read at",
  "Completed at",
  "Recorded at",
  "Attested at",
  "Outcome recorded at",
  "Received",
]);
const calendarFactLabels = new Set([
  "Due date",
  "Launch date",
  "Previous date",
  "Date",
]);
const enumFactLabels = new Set([
  "Status",
  "Previous status",
  "Delivery status",
  "Category",
  "Area",
  "Kind",
  "Source type",
  "Your reading status",
  "Severity",
]);
const modelOnlyValueSchema = z.strictObject({
  value: z.unknown(),
  modelOnly: z.literal(true),
});
export function contentModelOnly(value: unknown) {
  return { value, modelOnly: true as const };
}
export function contentCodeLabel(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}
export function contentInstantLabel(value: string | Date, timeZone: string) {
  const normalized =
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value)
      ? `${value.replace(" ", "T")}Z`
      : value;
  const date = normalized instanceof Date ? normalized : new Date(normalized);
  return Number.isNaN(date.getTime())
    ? "Date unavailable"
    : formatDateTimeWithZone(date, timeZone);
}

export const contentIds = z.array(z.uuid()).min(1).max(50);
export const contentWindow = z
  .strictObject({
    from: z.iso.datetime({ offset: true }),
    until: z.iso.datetime({ offset: true }),
  })
  .refine(
    (v) => new Date(v.from) < new Date(v.until),
    "The start must precede the exclusive end"
  );
export const contentPage = {
  limit: z.number().int().min(1).max(50).default(20),
  offset: z.number().int().min(0).max(100000).default(0),
};
export const contentMode = z.enum(["list", "count", "group"]).default("list");
export const contentText = z.string().trim().min(1).max(200);

export function contentRange(
  column: SQL,
  range: z.infer<typeof contentWindow> | undefined
) {
  // These domain timestamps store UTC without a zone. Normalize the bound,
  // not the indexed column, so comparisons never inherit the DB session zone.
  return range
    ? sql`${column} >= (${range.from}::timestamptz at time zone 'UTC') and ${column} < (${range.until}::timestamptz at time zone 'UTC')`
    : sql`true`;
}
export function contentIn(column: SQL, ids: readonly string[] | undefined) {
  return ids
    ? sql`${column} in (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `
      )})`
    : sql`true`;
}
export function contentBound(value: string, size = 500) {
  let end = Math.min(value.length, size);
  if (end < value.length && end > 0 && /[\uD800-\uDBFF]/.test(value[end - 1]!))
    end--;
  return value.slice(0, end);
}
export function contentFacts(value: Record<string, unknown>, timeZone = "UTC") {
  const facts = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .flatMap(([label, v]) => {
      const tagged = modelOnlyValueSchema.safeParse(v);
      const modelOnly = tagged.success || technicalFactLabels.has(label);
      if (tagged.success) v = tagged.data.value;
      if (!modelOnly && typeof v === "string") {
        if (instantFactLabels.has(label)) v = contentInstantLabel(v, timeZone);
        else if (calendarFactLabels.has(label) && /^\d{4}-\d{2}-\d{2}$/.test(v))
          v = formatDateWithoutWeekday(
            new Date(`${v}T12:00:00Z`),
            "short",
            "UTC"
          );
        else if (enumFactLabels.has(label)) v = contentCodeLabel(v);
        else if (label === "Format") v = v.toUpperCase();
      }
      const text =
        v === null
          ? "Not recorded"
          : typeof v === "string"
            ? v
            : JSON.stringify(v);
      const chunks: { label: string; value: string; modelOnly?: true }[] = [];
      let offset = 0;
      do {
        const value = contentBound(text.slice(offset), 480);
        chunks.push({
          label: contentBound(
            chunks.length ? `${label} continued ${chunks.length + 1}` : label,
            100
          ),
          value: value || "None",
          ...(modelOnly ? { modelOnly: true as const } : {}),
        });
        offset += value.length;
      } while (offset < text.length && chunks.length < 12);
      if (offset < text.length)
        chunks.push({
          label: "Content limit",
          value: "This field continues in the source record.",
          ...(modelOnly ? { modelOnly: true as const } : {}),
        });
      return chunks;
    });
  return facts.length <= 32
    ? facts
    : [
        ...facts.slice(0, 31),
        {
          label: "Content limit",
          value: "Additional fields continue in the source record.",
        },
      ];
}

const rowSchema = z.object({
  id: z.string(),
  label: z.string(),
  facts: z.record(z.string(), z.unknown()),
  href: z.string(),
  group_key: z.string().nullable(),
  group_label: z.string().optional(),
});
export type ContentRow = z.infer<typeof rowSchema>;
export function contentItem(row: ContentRow, timeZone = "UTC") {
  return {
    id: row.id,
    label: contentBound(row.label, 160),
    facts: contentFacts(row.facts, timeZone),
    sourceLink: trustedEvryApplicationSourceLink({
      label: "Open source",
      href: row.href,
    }),
  };
}
const resultSchema = z.object({
  total: z.coerce.number().int().nonnegative(),
  rows: z.array(rowSchema),
});

/** One statement gives the page and full-population total the same snapshot. */
export function contentPageQuery(
  filtered: SQL,
  mode: "list" | "count" | "group",
  limit: number,
  offset: number
) {
  if (mode === "count")
    return sql`with filtered as (${filtered}) select count(*)::int as total, '[]'::jsonb as rows from filtered`;
  if (mode === "group")
    return sql`with filtered as (${filtered}), grouped as (select coalesce(group_key, 'Not recorded') as group_key, coalesce(min(to_jsonb(filtered)->>'group_label'), group_key, 'Not recorded') as group_label, count(*)::int as n from filtered group by group_key), page as (select group_key as id, group_label as label, jsonb_build_object('Count', n, 'Group ID', group_key) as facts, '/evry'::text as href, group_key from grouped order by group_key limit ${limit} offset ${offset}) select (select count(*)::int from filtered) as total, coalesce((select jsonb_agg(page) from page), '[]'::jsonb) as rows, (select count(*)::int from grouped) as groups`;
  return sql`with filtered as (${filtered}), page as (select id, label, facts, href, group_key from filtered order by sort_key desc, id asc limit ${limit} offset ${offset}) select (select count(*)::int from filtered) as total, coalesce((select jsonb_agg(page) from page), '[]'::jsonb) as rows`;
}

export async function runContentQuery(input: {
  title: string;
  href: string;
  filtered: SQL;
  mode: "list" | "count" | "group";
  limit: number;
  offset: number;
  now: Date;
  notes?: string[];
  timeZone?: string;
}) {
  const result = await db.execute(
    contentPageQuery(input.filtered, input.mode, input.limit, input.offset)
  );
  const raw = result.rows[0];
  const data = resultSchema.parse(raw);
  const groupCount =
    input.mode === "group"
      ? z.object({ groups: z.coerce.number() }).parse(raw).groups
      : data.total;
  const nextOffset =
    input.mode !== "count" && input.offset + data.rows.length < groupCount
      ? input.offset + input.limit
      : null;
  const items =
    input.mode === "count"
      ? [
          {
            id: "count",
            label: input.title,
            facts: [{ label: "Count", value: String(data.total) }],
            sourceLink: trustedEvryApplicationSourceLink({
              label: "Open source",
              href: input.href,
            }),
          },
        ]
      : data.rows.map((row) => contentItem(row, input.timeZone));
  const artifact = buildEvryReadArtifact({
    title: input.title,
    filters: [
      { label: "Matched records", value: String(data.total) },
      {
        label: "As of",
        value: contentInstantLabel(input.now, input.timeZone ?? "UTC"),
      },
      ...(nextOffset !== null
        ? [{ label: "Next offset", value: String(nextOffset) }]
        : []),
      ...(input.notes ?? []).map((value) => ({ label: "Evidence", value })),
    ],
    exclusions: [],
    items,
    sourceLinks: [
      trustedEvryApplicationSourceLink({
        label: "Open source",
        href: input.href,
      }),
    ],
  });
  return {
    ...artifact,
    resultMode: input.mode,
    counts: { ...artifact.counts, matched: data.total },
  } satisfies EvryReadArtifact;
}
