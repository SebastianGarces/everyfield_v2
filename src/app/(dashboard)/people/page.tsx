import { Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import {
  ExportButton,
  ImportWizard,
  PeopleFilters,
  PeopleList,
  PeopleSearch,
  PipelineWrapper,
  QuickAddForm,
  ViewToggle,
} from "@/components/people";
import { Button } from "@/components/ui/button";
import { holdsSeatFor } from "@/lib/auth/seat-rules";
import { verifySession } from "@/lib/auth/session";
import { getCurrentUserChurch } from "@/lib/auth/session";
import {
  parsePeopleListSearchParams,
  PEOPLE_PAGE_SIZE,
} from "@/lib/people/list-params";
import { getPipelineData } from "@/lib/people/pipeline";
import { peopleDirectorySubtitle } from "@/lib/people/presentation";
import { listPeople } from "@/lib/people/service";
import { listTags } from "@/lib/people/tags";

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

  // AS-020: the three create affordances in this header — import, quick add and
  // Add Person — all end in a `people.write` action, so a plant Member is shown
  // none of them. This is a server component holding the session, so it asks
  // the same table `requireSeat` refuses the POST with; the empty state's own
  // call to action is gated in `PeopleList`, and the pipeline's drag in
  // `PipelineView` / `PipelineCard`.
  //
  // EXPORT IS NOT IN THIS SET, deliberately. `exportPeopleAction` is `read`, so
  // hiding it would make this page stricter than the server — the over-hide the
  // sweep must not commit. Search, filters and the view toggle are reads too.
  const canWrite = holdsSeatFor(user, "people.write");

  // Parsed, never cast — and parsed in the module "Load more" reads too, so
  // the appended pages are answers to the same query (`src/lib/people/
  // list-params.ts`).
  const params = await searchParams;
  const { view, cursor, search, status, source, tagIds } =
    parsePeopleListSearchParams(params);

  // Fetch data based on view
  const isPipelineView = view === "pipeline";

  // For pipeline view, get pipeline data + church thresholds; for list view, get paginated list
  const [listResult, pipelineData, availableTags, church] = await Promise.all([
    !isPipelineView
      ? listPeople(user.churchId, {
          cursor,
          status,
          source,
          search,
          tagIds,
          limit: PEOPLE_PAGE_SIZE,
        })
      : Promise.resolve({ people: [], total: 0, nextCursor: null }),
    isPipelineView ? getPipelineData(user.churchId) : Promise.resolve(null),
    listTags(user.churchId),
    isPipelineView ? getCurrentUserChurch() : Promise.resolve(null),
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
              {/* The header is capability-matched too (#668): "Manage" is a
                  write verb in a lower register, and a Member holds no
                  `people.write` to manage anything with. */}
              <p className="text-muted-foreground">
                {peopleDirectorySubtitle(canWrite)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {canWrite && <ImportWizard />}
              <ExportButton />
              {canWrite && <QuickAddForm />}
              {canWrite && (
                <Button asChild>
                  <Link href="/people/new">
                    <Plus className="mr-2 h-4 w-4" />
                    Add Person
                  </Link>
                </Button>
              )}
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
              <div className="text-muted-foreground text-sm font-medium">
                {total} total
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-6">
          {isPipelineView && pipelineData ? (
            <PipelineWrapper
              data={pipelineData}
              inactivityThresholds={{
                warningDays: church?.inactivityWarningDays ?? 7,
                alertDays: church?.inactivityAlertDays ?? 14,
              }}
            />
          ) : (
            <PeopleList
              people={listResult.people}
              total={listResult.total}
              nextCursor={listResult.nextCursor}
              searchParams={params}
            />
          )}
        </div>
      </div>
    </>
  );
}
