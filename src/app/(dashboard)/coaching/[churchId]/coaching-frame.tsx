import Link from "next/link";
import { HeaderBreadcrumbs } from "@/components/header";
import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
import { Badge } from "@/components/ui/badge";
import type { CoachedPlant } from "@/lib/coaching/read";

export function CoachingFrame({
  plant,
  title,
  children,
}: {
  plant: CoachedPlant;
  title: string;
  children: React.ReactNode;
}) {
  const breadcrumbs = [
    { label: "Coaching" },
    { label: plant.churchName, href: `/coaching/${plant.churchId}` },
    ...(title === plant.churchName ? [] : [{ label: title }]),
  ];
  return (
    <>
      <HeaderBreadcrumbs items={breadcrumbs} />
      <PageCanvas
        frameClassName="mx-auto w-full max-w-5xl"
        contentClassName="space-y-6"
        contextAttachment="attached"
        contextItems={breadcrumbs}
        scrollLayout="flow"
      >
        <WorkspacePanel className="space-y-3 p-4 sm:p-6">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            <Badge variant="outline">Read-only coaching</Badge>
          </div>
          <p className="text-muted-foreground text-sm">
            You are reading{" "}
            <Link
              className="underline underline-offset-4"
              href={`/coaching/${plant.churchId}`}
            >
              {plant.churchName}
            </Link>
            &apos;s records. Personal planter check-ins are private.
          </p>
        </WorkspacePanel>
        {children}
      </PageCanvas>
    </>
  );
}
