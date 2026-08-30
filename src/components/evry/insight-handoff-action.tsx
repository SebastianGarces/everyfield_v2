"use client";

import { ListTodo } from "lucide-react";

import { Button } from "@/components/ui/button";

import { useEvryShell } from "./evry-shell";
import { evryInsightHandoffFor } from "./insight-handoff";

export function InsightToEvryAction({
  insightId,
  title,
}: {
  insightId: string;
  title: string;
}) {
  const { openInsightHandoff } = useEvryShell();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="cursor-pointer active:scale-[0.96]"
      onClick={(event) =>
        openInsightHandoff(
          evryInsightHandoffFor({ insightId, title }),
          event.currentTarget
        )
      }
    >
      <ListTodo aria-hidden="true" />
      Work on this with Evry
    </Button>
  );
}
