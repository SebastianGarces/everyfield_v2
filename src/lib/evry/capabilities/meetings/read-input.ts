import type { EvryResolvedPageContext } from "@/lib/evry/resolvers/contract";

import type { MeetingsEvryReadSelection } from "./selection";

/** Preserve only scope carried by a trusted, plant-resolved route context. */
export function meetingsReadInputForSelection(
  selection: MeetingsEvryReadSelection,
  pageContext: EvryResolvedPageContext | null
): Readonly<Record<string, string>> {
  switch (selection.kind) {
    case "read_list":
      return pageContext?.kind === "team"
        ? { teamId: pageContext.recordId }
        : {};
    case "read_locations":
      return {};
    case "read_detail":
    case "read_analytics":
      return pageContext?.kind === "meeting"
        ? { meetingId: pageContext.recordId }
        : {};
  }
}
