"use client";

import { Button } from "@/components/ui/button";
import { peopleListQueryWith } from "@/lib/people/list-params";
import { cn } from "@/lib/utils";

// The URL is what a view IS, so the name comes from the module that reads it.
export type { PeopleView } from "@/lib/people/list-params";
import type { PeopleView } from "@/lib/people/list-params";

interface ViewToggleProps {
  currentView: PeopleView;
  query: string;
  navigate: (destination: string) => void;
}

export function ViewToggle({ currentView, query, navigate }: ViewToggleProps) {
  const handleViewChange = (view: PeopleView) => {
    const params = peopleListQueryWith(query, { view });
    navigate(params.toString());
  };

  return (
    <div
      aria-label="People view"
      className="bg-muted text-foreground/60 flex items-center rounded-lg border p-1"
      role="group"
    >
      <Button
        variant={currentView === "list" ? "secondary" : "ghost"}
        size="sm"
        className={cn(
          "h-7 px-3 text-xs",
          currentView === "list" && "shadow-sm"
        )}
        onClick={() => handleViewChange("list")}
        aria-pressed={currentView === "list"}
      >
        List
      </Button>
      <Button
        variant={currentView === "pipeline" ? "secondary" : "ghost"}
        size="sm"
        className={cn(
          "h-7 px-3 text-xs",
          currentView === "pipeline" && "shadow-sm"
        )}
        onClick={() => handleViewChange("pipeline")}
        aria-pressed={currentView === "pipeline"}
      >
        Pipeline
      </Button>
    </div>
  );
}
