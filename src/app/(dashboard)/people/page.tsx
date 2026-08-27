import { Plus } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { HeaderBreadcrumbs } from "@/components/header";
import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
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
import { DEFAULT_CHURCH_TIME_ZONE } from "@/lib/datetime";
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
  // Pipeline cards hydrate in the browser, so their relative-day label takes
  // one server-minted instant and the church's calendar rather than reading
  // either from the client runtime.
  const now = new Date();

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
      <PageCanvas
        className={isPipelineView ? "overflow-hidden" : undefined}
        context="none"
        contentFocusTarget
        scrollLayout={isPipelineView ? "fixed" : "flow"}
      >
        <WorkspacePanel
          className={
            isPipelineView
              ? "flex h-full flex-col overflow-hidden"
              : "flex min-h-full flex-col overflow-hidden"
          }
        >
          <div className="shrink-0 space-y-6 border-b p-4 sm:p-6 sm:pb-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-tight">
                  People
                </h1>
                {/* Capability-matched header (#668). See @/lib/people/presentation. */}
                <p className="text-muted-foreground">
                  {peopleDirectorySubtitle(canWrite)}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
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

              <div className="flex flex-wrap items-center gap-2">
                <ViewToggle currentView={view} />
                <div className="text-muted-foreground text-sm font-medium tabular-nums">
                  {total} total
                </div>
              </div>
            </div>
          </div>

          <div
            className={
              isPipelineView
                ? "min-h-0 min-w-0 flex-1 overflow-hidden p-4 sm:p-6"
                : "min-w-0 p-4 sm:p-6"
            }
          >
            {isPipelineView && pipelineData ? (
              <PipelineWrapper
                data={pipelineData}
                inactivityThresholds={{
                  warningDays: church?.inactivityWarningDays ?? 7,
                  alertDays: church?.inactivityAlertDays ?? 14,
                }}
                now={now}
                timeZone={church?.timeZone ?? DEFAULT_CHURCH_TIME_ZONE}
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
        </WorkspacePanel>
      </PageCanvas>
    </>
  );
}
