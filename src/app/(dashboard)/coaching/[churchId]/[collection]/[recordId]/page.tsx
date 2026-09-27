import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { verifySession } from "@/lib/auth";
import {
  coachedCollections,
  parseCoachedCollection,
  parseCoachedPage,
} from "@/lib/coaching/collections";
import { readCoachedRecord } from "@/lib/coaching/record-read";
import { CoachingFrame } from "../../coaching-frame";
import { RecordContent, recordTitle } from "../../record-content";
export const dynamic = "force-dynamic";
export default async function CoachedRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ churchId: string; collection: string; recordId: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const { churchId, collection: input, recordId } = await params;
  const collection = parseCoachedCollection(input);
  const page = parseCoachedPage((await searchParams).page);
  if (!collection || page === null) notFound();
  const { user } = await verifySession();
  const record = await readCoachedRecord(user, churchId, collection, recordId);
  if (!record) notFound();
  return (
    <CoachingFrame plant={record.plant} title={recordTitle(record)}>
      <Link
        className="inline-block underline underline-offset-4"
        href={`/coaching/${churchId}/${collection}?page=${page}`}
      >
        Back to {coachedCollections[collection].label.toLowerCase()}
      </Link>
      <Card>
        <CardContent className="space-y-6 p-4 sm:p-6">
          <RecordContent record={record} />
        </CardContent>
      </Card>
    </CoachingFrame>
  );
}
