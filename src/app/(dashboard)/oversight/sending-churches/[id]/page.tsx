import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
import { Badge } from "@/components/ui/badge";
import { formatPhase } from "@/lib/oversight/presentation";
import { getNetworkSendingChurchDetail } from "@/lib/oversight/sending-church-detail";
import { requireOversightUser } from "@/lib/oversight/session";

export const metadata: Metadata = { title: "Sending church" };

export default async function SendingChurchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user, org } = await requireOversightUser();
  if (org.type !== "network") notFound();
  const { id } = await params;
  const detail = await getNetworkSendingChurchDetail(user, id);
  if (!detail) notFound();
  const breadcrumbs = [
    { label: "Sending churches", href: "/oversight/sending-churches" },
    { label: detail.name },
  ];

  return (
    <>
      <HeaderBreadcrumbs items={breadcrumbs} />
      <PageCanvas
        frameClassName="mx-auto w-full max-w-4xl"
        contentClassName="space-y-6"
        contextAttachment="attached"
        contextItems={breadcrumbs}
        scrollLayout="flow"
      >
        <WorkspacePanel className="space-y-3 p-4 sm:p-6">
          <Link
            href="/oversight/sending-churches"
            className="cursor-pointer text-sm underline underline-offset-4"
          >
            Back to sending churches
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">
            {detail.name}
          </h1>
          <p className="font-medium tabular-nums">
            {detail.plants.length}{" "}
            {detail.plants.length === 1 ? "plant" : "plants"} in your network
          </p>
          <p className="text-muted-foreground max-w-prose text-sm">
            Only plants associated with your network are listed. Each plant
            controls which aggregate details it shares on its page.
          </p>
          <h2 className="text-lg font-semibold">Church plants</h2>
          {detail.plants.length === 0 ? (
            <p className="text-muted-foreground mt-3 text-sm">
              This sending church has no plants associated with your network
              yet.
            </p>
          ) : (
            <ul className="mt-3 divide-y">
              {detail.plants.map((plant) => (
                <li
                  key={plant.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-4"
                >
                  <Link
                    href={`/oversight/plants/${plant.id}`}
                    className="cursor-pointer font-medium underline underline-offset-4"
                  >
                    {plant.name}
                  </Link>
                  <Badge variant="secondary">
                    {formatPhase(plant.currentPhase)}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </WorkspacePanel>
      </PageCanvas>
    </>
  );
}
