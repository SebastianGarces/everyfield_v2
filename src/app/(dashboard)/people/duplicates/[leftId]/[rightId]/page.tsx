import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { HeaderBreadcrumbs } from "@/components/header";
import { MergeReviewForm } from "@/components/people/merge-review";
import { requireSeat } from "@/lib/auth/seats";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import { getMergeReview } from "@/lib/people/merge";

export default async function ReviewPairPage({
  params,
}: {
  params: Promise<{ leftId: string; rightId: string }>;
}) {
  const { user } = await requireSeat("read");
  if (!user.churchId) redirect("/dashboard");
  const { leftId, rightId } = await params;
  if (
    !z.uuid().safeParse(leftId).success ||
    !z.uuid().safeParse(rightId).success
  )
    notFound();
  const review = await getMergeReview(user.churchId, leftId, rightId);
  if (!review) notFound();
  return (
    <>
      <HeaderBreadcrumbs
        items={[
          { label: "People & CRM", href: "/people" },
          { label: "Potential duplicates", href: "/people/duplicates" },
          { label: "Review pair" },
        ]}
      />
      <PageCanvas scrollLayout="flow" frameClassName="mx-auto w-full max-w-4xl">
        <WorkspacePanel className="space-y-6 p-6">
          <div>
            <h1 className="text-2xl font-semibold">
              Review duplicate profiles
            </h1>
            <p className="text-muted-foreground mt-2">
              Confirm these records describe the same person before combining
              them.
            </p>
          </div>
          <MergeReviewForm
            key={`${review.left.version}:${review.right.version}`}
            review={review}
            canWrite={holdsSeatFor(user, "people.write")}
          />
        </WorkspacePanel>
      </PageCanvas>
    </>
  );
}
