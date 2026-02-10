"use client";

import { useState } from "react";
import { Download } from "lucide-react";

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
import { importRoleTemplatesAction } from "@/app/(dashboard)/teams/actions";
import {
  TEAM_TEMPLATES,
  type PredefinedTeamKey,
} from "@/lib/ministry-teams/role-templates";

interface RoleTemplateImportProps {
  teamId: string;
  teamName: string;
}

export function RoleTemplateImport({
  teamId,
  teamName,
}: RoleTemplateImportProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Find the matching template by team name
  const template = TEAM_TEMPLATES.find(
    (t) => t.teamName.toLowerCase() === teamName.toLowerCase()
  );

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    () => new Set(template?.roles.map((r) => r.key) ?? [])
  );

  if (!template) return null;

  function toggleRole(key: string) {
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

  async function handleImport() {
    if (!template || selectedKeys.size === 0) return;
    setLoading(true);
    try {
      const result = await importRoleTemplatesAction(
        teamId,
        template.teamKey as PredefinedTeamKey,
        Array.from(selectedKeys)
      );
      if (result.success) {
        setOpen(false);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        // Reset selections when dialog opens
        if (value && template) {
          setSelectedKeys(new Set(template.roles.map((r) => r.key)));
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="cursor-pointer">
          <Download className="mr-2 h-4 w-4" />
          Import Templates
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import Role Templates</DialogTitle>
          <DialogDescription>
            Choose which roles to import for the {teamName}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-4">
          <div className="space-y-2">
            {template.roles.map((role) => {
              const checked = selectedKeys.has(role.key);
              return (
                <label
                  key={role.key}
                  className="flex cursor-pointer items-center gap-3 rounded-md border p-2.5 transition-colors hover:bg-accent"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggleRole(role.key)}
                  />
                  <span className="text-sm">{role.roleName}</span>
                  {role.isLeadership && (
                    <span className="text-amber-600 text-xs">(Leadership)</span>
                  )}
                </label>
              );
            })}
          </div>
        </div>
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
            onClick={handleImport}
            disabled={loading || selectedKeys.size === 0}
            className="cursor-pointer"
          >
            {loading
              ? "Importing..."
              : `Import ${selectedKeys.size} of ${template.roles.length} Role${selectedKeys.size !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
