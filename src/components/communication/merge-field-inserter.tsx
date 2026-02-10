"use client";

import { MERGE_FIELDS, type MergeFieldDefinition } from "@/lib/communication/merge";
import { Badge } from "@/components/ui/badge";

interface MergeFieldInserterProps {
  /** Called with the merge field token, e.g. "{{first_name}}" */
  onInsert: (token: string) => void;
  /** Which groups to show. Defaults to all. */
  groups?: Array<"person" | "church" | "meeting">;
}

/**
 * Clickable merge field chips. Clicking inserts the field token
 * into whichever input was last focused (subject or body).
 */
export function MergeFieldInserter({
  onInsert,
  groups,
}: MergeFieldInserterProps) {
  const visibleFields = groups
    ? MERGE_FIELDS.filter((f) => groups.includes(f.group))
    : MERGE_FIELDS;

  const grouped = visibleFields.reduce(
    (acc, field) => {
      if (!acc[field.group]) acc[field.group] = [];
      acc[field.group].push(field);
      return acc;
    },
    {} as Record<string, MergeFieldDefinition[]>
  );

  const groupLabels: Record<string, string> = {
    person: "Person",
    church: "Church",
    meeting: "Meeting",
  };

  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs font-medium">
        Insert merge field
      </p>
      {Object.entries(grouped).map(([group, fields]) => (
        <div key={group} className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground mr-1 text-xs">
            {groupLabels[group]}:
          </span>
          {fields.map((field) => (
            <Badge
              key={field.name}
              variant="outline"
              className="cursor-pointer font-mono text-xs transition-colors hover:bg-primary hover:text-primary-foreground"
              onClick={() => onInsert(`{{${field.name}}}`)}
              title={field.description}
            >
              {`{{${field.name}}}`}
            </Badge>
          ))}
        </div>
      ))}
    </div>
  );
}
