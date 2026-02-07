"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRouter, useSearchParams } from "next/navigation";

export type PeopleView = "list" | "pipeline";

interface ViewToggleProps {
  currentView: PeopleView;
}

export function ViewToggle({ currentView }: ViewToggleProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleViewChange = (view: PeopleView) => {
    const params = new URLSearchParams(searchParams.toString());
    if (view === "list") {
      params.delete("view");
    } else {
      params.set("view", view);
    }
    // Clear cursor when switching views
    params.delete("cursor");
    router.push(`/people?${params.toString()}`);
  };

  return (
    <div className="bg-muted text-foreground/60 flex items-center rounded-lg border p-1">
      <Button
        variant={currentView === "list" ? "secondary" : "ghost"}
        size="sm"
        className={cn(
          "h-7 px-3 text-xs",
          currentView === "list" && "shadow-sm"
        )}
        onClick={() => handleViewChange("list")}
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
      >
        Pipeline
      </Button>
    </div>
  );
}
