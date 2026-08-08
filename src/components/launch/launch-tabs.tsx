"use client";

// ============================================================================
// The page's main body: Tasks, and History (LS-003/LS-004).
//
// Both panels arrive as ALREADY-RENDERED SERVER NODES. This component owns the
// tab state and nothing else — no data, no fetching, no `useEffect` reaching
// for the other tab when it is selected (memory/contracts/data-patterns.md).
// The server rendered both when it rendered the page, so switching is instant
// and the History tab is as fresh as the Tasks tab.
//
// TAB STATE IS LOCAL, NOT IN THE URL. The page is `force-dynamic`, so routing a
// tab change through `?tab=` would re-run the whole server render — the readiness
// query, the journal, the milestone history — to reveal markup the browser is
// already holding. Deep-linking a tab is not something this page needs.
// ============================================================================

import type { ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface LaunchTabsProps {
  tasks: ReactNode;
  history: ReactNode;
  /** Rows in the history, for the count beside the History label. */
  historyCount: number;
}

export function LaunchTabs({ tasks, history, historyCount }: LaunchTabsProps) {
  return (
    <Tabs defaultValue="tasks">
      <TabsList>
        {/* NO count on Tasks. A number beside a tab labelled "Tasks" reads as a
            number of tasks, and the only count worth showing there is a count
            of MILESTONES — the readiness card two rows below states both
            precisely ("1 of 9 milestones · 20 tasks open"), and a tab that is
            selected on arrival does not need a badge to advertise itself. The
            History count earns its place because it is a row count for a panel
            you cannot see. */}
        <TabsTrigger value="tasks">Tasks</TabsTrigger>
        <TabsTrigger value="history">
          History
          {historyCount > 0 && (
            <span className="bg-foreground/10 ml-2 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums">
              {historyCount}
            </span>
          )}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="tasks" className="mt-6">
        {tasks}
      </TabsContent>

      <TabsContent value="history" className="mt-6">
        {history}
      </TabsContent>
    </Tabs>
  );
}
