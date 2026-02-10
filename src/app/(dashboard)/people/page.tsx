import { Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import {
  ImportWizard,
  PeopleFilters,
  PeopleList,
  PeopleSearch,
  PipelineWrapper,
  QuickAddForm,
  ViewToggle,
  type PeopleView,
} from "@/components/people";
import { Button } from "@/components/ui/button";
import { verifySession } from "@/lib/auth/session";
import { getPipelineData } from "@/lib/people/pipeline";
import { listPeople } from "@/lib/people/service";
import { listTags } from "@/lib/people/tags";
import { PersonSource, PersonStatus } from "@/lib/people/types";

// Force dynamic rendering since we read search params and verify session
export const dynamic = "force-dynamic";

interface PeoplePageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function PeoplePage({ searchParams }: PeoplePageProps) {
  const { user } = await verifySession();

  if (!user.churchId) {
    redirect("/dashboard");
  }

  const params = await searchParams;
  const view = (params.view === "pipeline" ? "pipeline" : "list") as PeopleView;
  const cursor = typeof params.cursor === "string" ? params.cursor : undefined;
  const search = typeof params.search === "string" ? params.search : undefined;

  // Parse status filters
  const statusParam = params.status;
  const status = statusParam
    ? ((Array.isArray(statusParam)
        ? statusParam
        : [statusParam]) as PersonStatus[])
    : undefined;

  // Parse source filters
  const sourceParam = params.source;
  const source = sourceParam
    ? ((Array.isArray(sourceParam)
        ? sourceParam
        : [sourceParam]) as PersonSource[])
    : undefined;

  // Parse tag filters
  const tagParam = params.tag;
  const tags = tagParam
    ? Array.isArray(tagParam)
      ? tagParam
      : [tagParam]
    : undefined;

  // Fetch data based on view
  const isPipelineView = view === "pipeline";

  // For pipeline view, get pipeline data; for list view, get paginated list
  const [listResult, pipelineData, availableTags] = await Promise.all([
    !isPipelineView
      ? listPeople(user.churchId, {
          cursor,
          status,
          source,
          search,
          tagIds: tags,
          limit: 24,
        })
      : Promise.resolve({ people: [], total: 0, nextCursor: null }),
    isPipelineView ? getPipelineData(user.churchId) : Promise.resolve(null),
    listTags(user.churchId),
  ]);

  // Calculate total for display
  const total =
    isPipelineView && pipelineData
      ? pipelineData.columns.reduce((sum, col) => sum + col.count, 0)
      : listResult.total;

  return (
    <>
      <HeaderBreadcrumbs items={[{ label: "People & CRM" }]} />
      <div className="flex h-full flex-col">
        <div className="bg-card space-y-6 p-6 pb-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">People</h1>
              <p className="text-foreground/50">
                Manage your contacts and pipeline
              </p>
            </div>
            <div className="flex items-center gap-2">
              <ImportWizard />
              <QuickAddForm />
              <Button asChild>
                <Link href="/people/new">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Person
                </Link>
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-1 flex-col gap-4 md:flex-row md:items-center">
              {!isPipelineView && (
                <>
                  <PeopleSearch />
                  <PeopleFilters availableTags={availableTags} />
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              <ViewToggle currentView={view} />
              <div className="text-foreground/50 text-sm font-medium">
                {total} total
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6">
          {isPipelineView && pipelineData ? (
            <PipelineWrapper data={pipelineData} />
          ) : (
            <PeopleList
              people={listResult.people}
              total={listResult.total}
              nextCursor={listResult.nextCursor}
            />
          )}
        </div>
      </div>
    </>
  );
}
