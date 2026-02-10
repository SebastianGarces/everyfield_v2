"use client";

import { useState } from "react";
import { Rocket } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { initializeTeamsAction } from "@/app/(dashboard)/teams/actions";
import {
  TEAM_TEMPLATES,
  type PredefinedTeamKey,
} from "@/lib/ministry-teams/role-templates";

export function InitializeTeamsButton() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<PredefinedTeamKey>>(
    () => new Set(TEAM_TEMPLATES.map((t) => t.teamKey as PredefinedTeamKey))
  );

  function toggleTeam(key: PredefinedTeamKey) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  async function handleConfirm() {
    if (selectedKeys.size === 0) return;
    setLoading(true);
    try {
      await initializeTeamsAction(Array.from(selectedKeys));
      setOpen(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" className="cursor-pointer">
          <Rocket className="mr-2 h-4 w-4" />
          Set Up Ministry Teams
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Set Up Ministry Teams</DialogTitle>
          <DialogDescription>
            Choose which ministry teams to create. You can always add more
            later.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[400px] pr-4">
          <div className="space-y-3 py-2">
            {TEAM_TEMPLATES.map((template) => {
              const key = template.teamKey as PredefinedTeamKey;
              const checked = selectedKeys.has(key);
              return (
                <label
                  key={key}
                  className="flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors hover:bg-accent"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggleTeam(key)}
                    className="mt-0.5"
                  />
                  <div className="flex-1 space-y-0.5">
                    <div className="text-sm font-medium leading-none">
                      {template.teamName}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {template.description}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {template.roles.length} role
                      {template.roles.length !== 1 ? "s" : ""} available
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(false)}
            className="cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={loading || selectedKeys.size === 0}
            className="cursor-pointer"
          >
            {loading
              ? "Setting up teams..."
              : `Set Up ${selectedKeys.size} Team${selectedKeys.size !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
