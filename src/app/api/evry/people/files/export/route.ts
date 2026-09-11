import { NextResponse } from "next/server";
import { z } from "zod";

import { personSources, personStatuses } from "@/db/schema";
import { authorizeEvryReadCapability } from "@/lib/evry/eligibility/capabilities";
import {
  buildExportFilename,
  serializePeopleToCsv,
  type ExportablePerson,
} from "@/lib/people/export";
import { getPeopleForExport } from "@/lib/people/service";
import { getTagsForPeople } from "@/lib/people/tags";

const querySchema = z.strictObject({
  status: z.array(z.enum(personStatuses)).max(7),
  source: z.array(z.enum(personSources)).max(7),
  search: z.string().max(255).nullable(),
  tagIds: z.array(z.string().uuid()).max(25),
});
const PRIVATE_HEADERS = { "cache-control": "private, no-store" } as const;

export async function GET(request: Request) {
  const authorization = await authorizeEvryReadCapability(
    "people.crm.exports.export-people"
  );
  if (!authorization)
    return new Response("Not found", {
      status: 404,
      headers: PRIVATE_HEADERS,
    });
  const url = new URL(request.url);
  const allowedKeys = new Set(["status", "source", "search", "tag"]);
  if (
    [...url.searchParams.keys()].some((key) => !allowedKeys.has(key)) ||
    url.searchParams.getAll("search").length > 1
  )
    return NextResponse.json(
      { status: "invalid" },
      { status: 400, headers: PRIVATE_HEADERS }
    );
  const parsed = querySchema.safeParse({
    status: url.searchParams.getAll("status"),
    source: url.searchParams.getAll("source"),
    search: url.searchParams.get("search"),
    tagIds: url.searchParams.getAll("tag"),
  });
  if (!parsed.success)
    return NextResponse.json(
      { status: "invalid" },
      { status: 400, headers: PRIVATE_HEADERS }
    );
  const people = await getPeopleForExport(authorization.actor.plantId, {
    status: parsed.data.status.length ? parsed.data.status : undefined,
    source: parsed.data.source.length ? parsed.data.source : undefined,
    search: parsed.data.search ?? undefined,
    tagIds: parsed.data.tagIds.length ? parsed.data.tagIds : undefined,
  });
  const tagMap = await getTagsForPeople(
    authorization.actor.plantId,
    people.map(({ id }) => id)
  );
  const rows: ExportablePerson[] = people.map((person) => ({
    ...person,
    tags: tagMap.get(person.id) ?? [],
  }));
  const filename = buildExportFilename();
  return new Response(serializePeopleToCsv(rows), {
    headers: {
      ...PRIVATE_HEADERS,
      "content-disposition": `attachment; filename="${filename}"`,
      "content-type": "text/csv; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
