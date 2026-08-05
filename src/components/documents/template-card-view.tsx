// ============================================================================
// TemplateCardView — one document-template card, as pure markup.
//
// Everything a template card looks like lives here: the file glyph, the name,
// the format/page-count/phase badge row, the description, and the footer that
// holds its one action. What does NOT live here is anything that has to run —
// no "use client", no state, no event handlers, and no import of
// `generate-dialog`, which would drag a dialog, a form and its client bundle
// onto every page that renders a card.
//
// The action is a slot. The app's host (components/documents/template-card.tsx)
// fills it with the real Generate button and mounts the dialog the button
// opens; anyone rendering this card as a *picture* of itself — the marketing
// page's live embed of the Core Group Commitment Card (issue #296) — passes
// nothing and gets the same button, inert. The button is kept in the default
// rather than dropped, because the footer is part of what this card looks like:
// a card ending at its description is a different card, and the landing page is
// supposed to show the product, not a trimmed version of it. Nothing about the
// default is clickable-but-broken — it has no handler, so it opens nothing.
//
// Server-safe on purpose. Card, Badge and Button are all plain styled elements
// (no "use client" in any of them), so a default render of this file ships zero
// client JavaScript. Keep it that way: the only interactivity this card may
// carry arrives through `actionSlot`.
//
// The contract that makes the split worth anything: this is the ONLY definition
// of what a template card looks like. `template-card.tsx` renders this and adds
// the behaviour; it owns no markup of its own.
// ============================================================================

import { FileText } from "lucide-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { DocumentTemplate } from "@/lib/documents";

/**
 * The fields of a template this card actually renders. A full
 * `DocumentTemplate` satisfies it structurally, so the app passes its templates
 * unchanged — but a fixture does not have to invent an `id`, a `category` or a
 * `mergeFields` array to draw the card, none of which reach the markup.
 */
export type TemplateCardData = Pick<
  DocumentTemplate,
  "name" | "description" | "formats" | "pageCount" | "phase"
>;

interface TemplateCardViewProps {
  template: TemplateCardData;
  /**
   * The card's one action, rendered in the footer.
   *
   * A slot rather than a prop pair, because the button is the one thing on this
   * card that cannot be described by data: in the app it opens a generate
   * dialog, on a landing page it is a still frame of the same control. Passing
   * the element itself keeps both of those out of this file — the view never
   * learns that generating a document is a thing that can happen.
   *
   * Omitted, it falls back to the identical button without a handler, so the
   * card renders complete and inert.
   */
  actionSlot?: ReactNode;
}

/**
 * `data-template-card` and `data-phase` are stable, zero-visual hooks, in the
 * same spirit as the task row's `data-status` (components/tasks/task-card-view
 * .tsx) and the CSF tile's `data-standing` (components/phase-engine/csf-
 * scorecard.tsx): they name the card and its journey phase for anything styling
 * or animating it from outside — the marketing embeds — without adding a class
 * the card would then have to keep. `data-phase` is dropped entirely when the
 * template has no phase. Neither attribute changes what this renders.
 *
 * Deliberately NOT `data-slot`: this root is shadcn's `Card`, which sets
 * `data-slot="card"` and then spreads props over it, so naming the hook
 * `data-slot` would silently rename a shadcn contract other styles may key on.
 */
export function TemplateCardView({
  template,
  actionSlot,
}: TemplateCardViewProps) {
  return (
    <Card
      data-template-card=""
      data-phase={template.phase}
      className="flex h-full flex-col"
    >
      <CardHeader>
        <div className="text-muted-foreground mb-2">
          <FileText className="h-6 w-6" />
        </div>
        <CardTitle className="text-base leading-snug">
          {template.name}
        </CardTitle>
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {template.formats.map((format) => (
            <Badge
              key={format}
              variant="secondary"
              className="text-xs uppercase"
            >
              {format}
            </Badge>
          ))}
          <Badge variant="outline" className="text-xs">
            {template.pageCount} page{template.pageCount === 1 ? "" : "s"}
          </Badge>
          {typeof template.phase === "number" && (
            <Badge variant="outline" className="text-xs">
              Phase {template.phase}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1">
        <p className="text-muted-foreground text-sm">{template.description}</p>
      </CardContent>
      <CardFooter>
        {actionSlot ?? (
          <Button className="w-full cursor-pointer">Generate</Button>
        )}
      </CardFooter>
    </Card>
  );
}
