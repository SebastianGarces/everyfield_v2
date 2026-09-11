import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  buildEvryReadArtifact,
  trustedEvryApplicationSourceLink,
} from "@/lib/evry/artifacts/core";
import { readEvryPlantTimeZone } from "@/lib/evry/reads/plant-time-zone";
import {
  resolveEvryDateRange,
  evryDateRangeSchema,
} from "@/lib/evry/reads/date-range";
import { EVRY_READ_ITEM_MAX_FACTS } from "@/lib/evry/conversations/contract";
import { formatDateTimeWithZone } from "@/lib/datetime";
import {
  formatOperationValue,
  operationDisplayFormat,
  operationLabels,
  operationRecordLabel,
  type OperationDisplayFormat,
} from "./operations-display";

export const operationIds = z.array(z.string().uuid()).min(1).max(50);
export const operationSearch = z.string().trim().min(1).max(160);
const cursor = z
  .string()
  .regex(/^\d{1,9}$/)
  .nullable()
  .optional();
export const operationPage = {
  limit: z.number().int().min(1).max(50).default(25),
  cursor,
};

export function operationsMode<
  const S extends [string, ...string[]],
  const G extends [string, ...string[]],
>(sorts: S, groups: G) {
  return z.discriminatedUnion("mode", [
    z.strictObject({
      mode: z.literal("list"),
      ...operationPage,
      sort: z.enum(sorts).default(sorts[0]),
      direction: z.enum(["asc", "desc"]).default("asc"),
    }),
    z.strictObject({ mode: z.literal("count") }),
    z.strictObject({
      mode: z.literal("group"),
      by: z.enum(groups),
      ...operationPage,
    }),
  ]);
}

export function operationsWhere<S extends z.ZodType>(filter: S) {
  return z
    .strictObject({
      all: z.array(filter).max(12).default([]),
      any: z.array(filter).max(12).default([]),
    })
    .default({ all: [], any: [] });
}

export function predicateSet<F>(
  where: { all: F[]; any: F[] },
  compile: (filter: F) => SQL
): SQL {
  const all = where.all.map(compile);
  if (where.any.length)
    all.push(sql`(${sql.join(where.any.map(compile), sql` or `)})`);
  return all.length ? sql`(${sql.join(all, sql` and `)})` : sql`true`;
}

export function inValues(column: SQL, values: readonly string[]): SQL {
  return sql`${column} in (${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `
  )})`;
}

export function datePredicate(
  column: SQL,
  range: z.infer<typeof evryDateRangeSchema>,
  now: Date,
  timeZone: string
): SQL {
  const resolved = resolveEvryDateRange(range, now, timeZone);
  return sql`(${resolved.from ? sql`${column} >= ${resolved.from}::date` : sql`true`} and ${resolved.through ? sql`${column} <= ${resolved.through}::date` : sql`true`})`;
}

export function fact(
  label: string,
  value: SQL,
  options: { modelOnly?: true; format?: OperationDisplayFormat } = {}
): SQL {
  return sql`jsonb_build_object('label', ${label}::text, 'value', coalesce((${value})::text, 'Not recorded')) || ${JSON.stringify(options)}::jsonb`;
}

export function displayLabel(value: SQL, format: string): SQL {
  return sql`case ${value} ${sql.join(
    Object.entries(operationLabels[format]).map(
      ([key, label]) => sql`when ${key} then ${label}`
    ),
    sql` `
  )} else 'Not recorded' end`;
}

export function relatedFact(label: string, display: SQL, identity: SQL): SQL {
  return sql`${fact(label, display)} || jsonb_build_object('modelFact', ${fact(`${label} linkage`, identity, { modelOnly: true })})`;
}

export function facts(...values: SQL[]): SQL {
  return sql`jsonb_build_array(${sql.join(values, sql`, `)})`;
}

type QueryMode =
  | {
      mode: "list";
      limit: number;
      cursor?: string | null;
      sort: string;
      direction: "asc" | "desc";
    }
  | { mode: "count" }
  | { mode: "group"; by: string; limit: number; cursor?: string | null };

/** The source must project one row per resource, never a join-expanded count. */
export function operationsStatement(
  source: SQL,
  mode: QueryMode,
  dimensions: Readonly<Record<string, SQL>>,
  sorts: Readonly<Record<string, SQL>>,
  groupFormats: Readonly<Record<string, OperationDisplayFormat>> = {}
): SQL {
  if (mode.mode === "count")
    return sql`with filtered as (${source}) select count(*)::int as total, '[]'::jsonb as rows, null::text as next_cursor from filtered`;
  const offset = Number(mode.cursor ?? 0);
  if (mode.mode === "group") {
    const dimension = dimensions[mode.by];
    if (!dimension) throw new Error("Unsupported grouping");
    return sql`with filtered as (${source}), grouped as (
      select coalesce((${dimension})::text, 'Not recorded') as key, count(*)::int as amount from filtered group by ${dimension}
    ), page as (select * from grouped order by amount desc, key asc limit ${mode.limit} offset ${offset})
    select (select count(*)::int from filtered) as total,
      coalesce((select jsonb_agg(jsonb_build_object('id', key, 'label', key, 'labelFormat', ${groupFormats[mode.by] ?? null}::text, 'facts', jsonb_build_array(jsonb_build_object('label', 'Count', 'value', amount::text))) order by amount desc, key asc) from page), '[]'::jsonb) as rows,
      case when (select count(*) from grouped) > ${offset + mode.limit} then ${String(offset + mode.limit)} else null end as next_cursor`;
  }
  const sort = sorts[mode.sort];
  if (!sort) throw new Error("Unsupported ordering");
  const direction = mode.direction === "asc" ? sql`asc` : sql`desc`;
  return sql`with filtered as (${source}), page as (
    select *, row_number() over(order by ${sort} ${direction} nulls last, id ${direction}) as position from filtered
    order by ${sort} ${direction} nulls last, id ${direction} limit ${mode.limit} offset ${offset}
  ) select (select count(*)::int from filtered) as total,
    coalesce((select jsonb_agg(jsonb_build_object('id', id, 'label', label, 'facts', facts, 'href', href) order by position) from page), '[]'::jsonb) as rows,
    case when (select count(*) from filtered) > ${offset + mode.limit} then ${String(offset + mode.limit)} else null end as next_cursor`;
}

const rowSchema = z.object({
  id: z.string(),
  label: z.string(),
  labelFormat: operationDisplayFormat.nullable().optional(),
  facts: z.array(
    z.object({
      label: z.string(),
      value: z.string(),
      modelOnly: z.literal(true).optional(),
      format: operationDisplayFormat.optional(),
      modelFact: z
        .object({
          label: z.string(),
          value: z.string(),
          modelOnly: z.literal(true),
        })
        .optional(),
    })
  ),
  href: z.string().nullable().optional(),
});
const resultSchema = z.object({
  total: z.number().int().nonnegative(),
  rows: z.array(rowSchema),
  next_cursor: z.string().nullable(),
});
export type OperationsResult = z.infer<typeof resultSchema>;

const boundaries = {
  async execute(statement: SQL): Promise<unknown> {
    return (await db.execute(statement)).rows[0];
  },
  readTimeZone: readEvryPlantTimeZone,
};
const local = new AsyncLocalStorage<typeof boundaries>();
export function withOperationsBoundaries<T>(
  overrides: Partial<typeof boundaries>,
  run: () => T
): T {
  return local.run({ ...boundaries, ...overrides }, run);
}
export async function operationsTimeZone(plantId: string) {
  return (local.getStore() ?? boundaries).readTimeZone(plantId);
}
export async function executeOperations(
  statement: SQL
): Promise<OperationsResult> {
  return resultSchema.parse(
    await (local.getStore() ?? boundaries).execute(statement)
  );
}

/** Chunk text at the persisted boundary; disclose any remaining preview limit. */
function previewFacts(
  source: readonly { label: string; value: string; modelOnly?: true }[]
) {
  const chunks = source.flatMap((field) => {
    const parts = field.value.match(/[\s\S]{1,500}/g) ?? [""];
    return parts.map((value, index) => ({
      label:
        parts.length > 1
          ? `${field.label.slice(0, 90)} (${index + 1}/${parts.length})`
          : field.label.slice(0, 120),
      value,
      ...(field.modelOnly ? { modelOnly: true as const } : {}),
    }));
  });
  if (chunks.length <= EVRY_READ_ITEM_MAX_FACTS) return chunks;
  const shown = chunks.slice(0, EVRY_READ_ITEM_MAX_FACTS - 1);
  const omitted = chunks
    .slice(shown.length)
    .reduce((total, field) => total + field.value.length, 0);
  return [
    ...shown,
    {
      label: "Preview coverage",
      value: `${shown.length} of ${chunks.length} detail sections shown; ${omitted} characters remain. Open the record for full details, or request fewer related sections.`,
    },
  ];
}

export function operationsArtifact(
  title: string,
  href: string,
  result: OperationsResult,
  _input: unknown,
  now: Date,
  timeZone: string,
  requestedIds?: readonly string[],
  resultMode: "list" | "count" | "group" = "list"
) {
  const link = trustedEvryApplicationSourceLink({
    label: `Open ${title.toLowerCase()}`,
    href,
  });
  const rows: OperationsResult["rows"] = requestedIds
    ? [...new Set(requestedIds)].map(
        (id) =>
          result.rows.find((row) => row.id === id) ?? {
            id,
            label: "Record unavailable",
            facts: [{ label: "Availability", value: "Unavailable" }],
          }
      )
    : result.rows;
  const artifact = buildEvryReadArtifact({
    title,
    exclusions: [],
    filters: [
      { label: "As of", value: formatDateTimeWithZone(now, timeZone) },
      { label: "Time zone", value: timeZone },
      { label: "Total matches", value: String(result.total) },
      {
        label: "Total semantics",
        value: "Exact filtered population before pagination",
      },
      {
        label: "Next page cursor",
        value: result.next_cursor ?? "End of results",
      },
      {
        label: "Coverage",
        value: requestedIds
          ? "Unavailable includes unknown and inaccessible records. Related evidence is separately bounded."
          : "All matching records counted; rows are the requested page.",
      },
    ],
    items: rows.map((rawRow) => {
      const row = {
        ...rawRow,
        label: formatOperationValue(
          rawRow.label,
          rawRow.labelFormat ?? undefined,
          timeZone
        ),
        facts: rawRow.facts.flatMap((field) => [
          {
            label: field.label,
            value: formatOperationValue(field.value, field.format, timeZone),
            ...(field.modelOnly ? { modelOnly: true as const } : {}),
          },
          ...(field.modelFact ? [field.modelFact] : []),
        ]),
      };
      if (rawRow.labelFormat === "record_label") {
        const identity = operationRecordLabel(rawRow.label).id;
        if (identity)
          row.facts.push({
            label: "Group record ID",
            value: identity,
            modelOnly: true,
          });
      }
      return {
        id:
          row.id.length <= 160
            ? row.id
            : createHash("sha256").update(row.id).digest("hex"),
        label: row.label.slice(0, 160),
        facts: previewFacts(
          row.label.length > 160
            ? [{ label: "Full name", value: row.label }, ...row.facts]
            : row.facts
        ),
        sourceLink: row.href
          ? trustedEvryApplicationSourceLink({
              label: row.label.slice(0, 160),
              href: row.href,
            })
          : link,
      };
    }),
    sourceLinks: [link],
  });
  return {
    ...artifact,
    resultMode,
    counts: {
      matched: requestedIds ? rows.length : result.total,
      returned: rows.length,
      excluded: 0,
    },
  };
}
