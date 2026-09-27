import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { verifySession } from "@/lib/auth";
import { readCoachedPlant } from "@/lib/coaching/read";
import { coachedCollections } from "@/lib/coaching/collections";
import { CoachingFrame } from "./coaching-frame";

export const metadata: Metadata = { title: "Coaching" };
export const dynamic = "force-dynamic";
export default async function CoachedPlantPage({
  params,
}: {
  params: Promise<{ churchId: string }>;
}) {
  const { churchId } = await params;
  const { user } = await verifySession();
  const plant = await readCoachedPlant(user, churchId);
  if (!plant) notFound();
  return (
    <CoachingFrame plant={plant} title={plant.churchName}>
      <div className="grid gap-4 sm:grid-cols-2">
        {Object.entries(coachedCollections).map(([key, collection]) => (
          <Card key={key}>
            <CardContent className="p-6">
              <h2 className="text-lg font-semibold">
                <Link
                  className="underline underline-offset-4"
                  href={`/coaching/${churchId}/${key}`}
                >
                  {collection.label}
                </Link>
              </h2>
              <p className="text-muted-foreground mt-2 text-sm">
                {collection.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </CoachingFrame>
  );
}
