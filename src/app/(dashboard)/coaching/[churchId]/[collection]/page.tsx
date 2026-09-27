import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { verifySession } from "@/lib/auth";
import { readCoachedCollection } from "@/lib/coaching/read";
import {
  coachedCollections,
  parseCoachedCollection,
  parseCoachedPage,
} from "@/lib/coaching/collections";
import { CoachingFrame } from "../coaching-frame";
export const dynamic = "force-dynamic";
export default async function CoachedCollectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ churchId: string; collection: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const { churchId, collection: input } = await params;
  const collection = parseCoachedCollection(input);
  const page = parseCoachedPage((await searchParams).page);
  if (!collection || page === null) notFound();
  const { user } = await verifySession();
  const result = await readCoachedCollection(user, churchId, collection, page);
  if (!result) notFound();
  const copy = coachedCollections[collection];
  const base = `/coaching/${churchId}/${collection}`;
  return (
    <CoachingFrame plant={result.plant} title={copy.label}>
      <Link
        className="inline-block underline underline-offset-4"
        href={`/coaching/${churchId}`}
      >
        Back to plant
      </Link>
      <Card>
        <CardContent className="p-4 sm:p-6">
          {result.rows.length === 0 ? (
            <p className="text-muted-foreground">
              {page === 1
                ? copy.empty
                : "There are no more records on this page. Return to the previous page."}
            </p>
          ) : (
            <ul className="divide-y">
              {result.rows.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 py-3"
                >
                  <Link
                    className="min-w-0 font-medium break-words underline underline-offset-4"
                    href={`${base}/${row.id}?page=${page}`}
                  >
                    {row.name}
                  </Link>
                  <span className="text-muted-foreground text-sm">
                    {row.status.replaceAll("_", " ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <nav
        aria-label={`${copy.label} pages`}
        className="flex items-center gap-5"
      >
        {page > 1 && (
          <Link
            className="underline underline-offset-4"
            href={`${base}?page=${page - 1}`}
          >
            Previous page
          </Link>
        )}
        <span className="text-muted-foreground text-sm">Page {page}</span>
        {result.hasNext && (
          <Link
            className="underline underline-offset-4"
            href={`${base}?page=${page + 1}`}
          >
            Next page
          </Link>
        )}
      </nav>
    </CoachingFrame>
  );
}
