import { authorizeEvryReadCapability } from "@/lib/evry/eligibility/capabilities";
import { generateCsvTemplate } from "@/lib/people/import";

const PRIVATE_HEADERS = { "cache-control": "private, no-store" } as const;

export async function GET(request: Request) {
  const authorization = await authorizeEvryReadCapability(
    "people.crm.imports.download-csv-template"
  );
  if (!authorization)
    return new Response("Not found", {
      status: 404,
      headers: PRIVATE_HEADERS,
    });
  if (new URL(request.url).search.length > 0)
    return new Response("Invalid request", {
      status: 400,
      headers: PRIVATE_HEADERS,
    });
  return new Response(generateCsvTemplate(), {
    headers: {
      ...PRIVATE_HEADERS,
      "content-disposition":
        'attachment; filename="people-import-template.csv"',
      "content-type": "text/csv; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
