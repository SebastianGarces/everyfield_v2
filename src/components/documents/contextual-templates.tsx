import { ArrowUpRight, FileText } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { ContextualTemplate } from "@/lib/documents/contextual";

interface ContextualTemplatesProps {
  templates: ContextualTemplate[];
  /** Section heading, e.g. "Vision Meeting Documents". */
  title: string;
  /** Optional one-line explanation under the heading. */
  description?: string;
}

/**
 * Documents offered from inside another feature (DOC-014). Renders nothing at
 * all — no empty section, no dead link — when the context has no matching
 * template.
 */
export function ContextualTemplates({
  templates,
  title,
  description,
}: ContextualTemplatesProps) {
  if (templates.length === 0) return null;

  return (
    <Card data-testid="contextual-templates">
      <CardHeader>
        <h2 className="flex items-center gap-2 text-base leading-none font-semibold">
          <FileText className="text-muted-foreground h-4 w-4 shrink-0" />
          {title}
        </h2>
        {description && (
          <p className="text-muted-foreground text-sm">{description}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {templates.map((template) => (
          <Link
            key={template.id}
            href={template.href}
            data-testid={`contextual-template-${template.id}`}
            className="hover:bg-accent focus-visible:ring-ring group flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-medium">{template.name}</span>
                {template.formats.map((format) => (
                  <Badge
                    key={format}
                    variant="secondary"
                    className="text-xs uppercase"
                  >
                    {format}
                  </Badge>
                ))}
              </div>
              <p className="text-muted-foreground line-clamp-2 text-sm">
                {template.note ?? template.description}
              </p>
            </div>
            <ArrowUpRight className="text-muted-foreground group-hover:text-foreground mt-0.5 h-4 w-4 shrink-0" />
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
