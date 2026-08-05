"use client";

// ============================================================================
// TemplateCard — the behaviour, and nothing else.
//
// The card's markup moved to template-card-view.tsx, which is server-safe and
// is now the single definition of what a template card looks like. Import the
// view from there, not through here: this module is a client boundary, so
// anything re-exported through it becomes a client reference and stops being
// renderable on the server.
//
// What is left is the only thing a template card actually *does* — open the
// generate dialog — plus the button that fires it, handed to the view as its
// action slot.
// ============================================================================

import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { DocumentMergeValues, DocumentTemplate } from "@/lib/documents";

import { GenerateDialog } from "./generate-dialog";
import { TemplateCardView } from "./template-card-view";

interface TemplateCardProps {
  template: DocumentTemplate;
  defaults: DocumentMergeValues;
}

export function TemplateCard({ template, defaults }: TemplateCardProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <TemplateCardView
        template={template}
        actionSlot={
          <Button
            className="w-full cursor-pointer"
            onClick={() => setOpen(true)}
          >
            Generate
          </Button>
        }
      />

      <GenerateDialog
        template={template}
        defaults={defaults}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
