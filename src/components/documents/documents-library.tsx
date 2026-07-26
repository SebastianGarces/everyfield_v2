"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  FORMAT_LABELS,
  type DocumentCategory,
  type DocumentFormat,
  type DocumentMergeValues,
  type DocumentTemplate,
} from "@/lib/documents";

import { GenerateDialog } from "./generate-dialog";
import { TemplateCard } from "./template-card";

export interface DocumentLibraryItem {
  template: DocumentTemplate;
  defaults: DocumentMergeValues;
}

const ALL = "all";

export function DocumentsLibrary({
  items,
  initialTemplateId,
}: {
  items: DocumentLibraryItem[];
  /** Template to open on arrival — a contextual link from another feature. */
  initialTemplateId?: string;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>(ALL);
  const [phase, setPhase] = useState<string>(ALL);
  const [format, setFormat] = useState<string>(ALL);
  const [deepLinkedId, setDeepLinkedId] = useState<string | null>(
    initialTemplateId ?? null
  );

  const deepLinked =
    items.find(({ template }) => template.id === deepLinkedId) ?? null;

  // Distinct filter options derived from the catalog.
  const { categories, phases, formats } = useMemo(() => {
    const cats = new Set<DocumentCategory>();
    const phs = new Set<number>();
    const fmts = new Set<DocumentFormat>();
    for (const { template } of items) {
      cats.add(template.category);
      if (typeof template.phase === "number") phs.add(template.phase);
      template.formats.forEach((f) => fmts.add(f));
    }
    return {
      categories: CATEGORY_ORDER.filter((c) => cats.has(c)),
      phases: [...phs].sort((a, b) => a - b),
      formats: [...fmts],
    };
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter(({ template }) => {
      if (category !== ALL && template.category !== category) return false;
      if (phase !== ALL && String(template.phase) !== phase) return false;
      if (
        format !== ALL &&
        !template.formats.includes(format as DocumentFormat)
      )
        return false;
      if (
        q &&
        !template.name.toLowerCase().includes(q) &&
        !template.description.toLowerCase().includes(q)
      )
        return false;
      return true;
    });
  }, [items, search, category, phase, format]);

  const groups = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    label: CATEGORY_LABELS[cat],
    items: filtered.filter((i) => i.template.category === cat),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-6">
      {/* Contextual arrival (DOC-014): open the requested template straight away */}
      {deepLinked && (
        <GenerateDialog
          template={deepLinked.template}
          defaults={deepLinked.defaults}
          open
          onOpenChange={(next) => {
            if (!next) setDeepLinkedId(null);
          }}
        />
      )}

      {/* Filter bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search templates..."
            className="pl-9"
          />
        </div>
        <div className="flex gap-2">
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger
              aria-label="Filter templates by category"
              className="w-[160px] cursor-pointer"
            >
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL} className="cursor-pointer">
                All categories
              </SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c} className="cursor-pointer">
                  {CATEGORY_LABELS[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {phases.length > 0 && (
            <Select value={phase} onValueChange={setPhase}>
              <SelectTrigger
                aria-label="Filter templates by phase"
                className="w-[130px] cursor-pointer"
              >
                <SelectValue placeholder="Phase" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL} className="cursor-pointer">
                  All phases
                </SelectItem>
                {phases.map((p) => (
                  <SelectItem
                    key={p}
                    value={String(p)}
                    className="cursor-pointer"
                  >
                    Phase {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Select value={format} onValueChange={setFormat}>
            <SelectTrigger
              aria-label="Filter templates by file format"
              className="w-[120px] cursor-pointer"
            >
              <SelectValue placeholder="Format" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL} className="cursor-pointer">
                All formats
              </SelectItem>
              {formats.map((f) => (
                <SelectItem key={f} value={f} className="cursor-pointer">
                  {FORMAT_LABELS[f]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Results */}
      {groups.length === 0 ? (
        <p className="text-muted-foreground py-12 text-center text-sm">
          No templates match your filters.
        </p>
      ) : (
        groups.map((group) => (
          <section key={group.category} className="space-y-4">
            <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
              {group.label}
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map(({ template, defaults }) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  defaults={defaults}
                />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
