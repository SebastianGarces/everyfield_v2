"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { startTransition, useMemo, useOptimistic, useState } from "react";

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

/**
 * The contextual deep-link parameter (DOC-014): `/documents?template=<id>`.
 * Written by `contextualTemplateHref()`; read here.
 */
export const TEMPLATE_SEARCH_PARAM = "template";

/**
 * The same URL with the deep link removed — every other parameter survives, so
 * clearing the dialog never clears whatever else the URL is carrying.
 */
export function urlWithoutTemplateParam(
  pathname: string,
  searchParams: URLSearchParams | { toString(): string }
): string {
  const params = new URLSearchParams(searchParams.toString());
  params.delete(TEMPLATE_SEARCH_PARAM);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function DocumentsLibrary({ items }: { items: DocumentLibraryItem[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>(ALL);
  const [phase, setPhase] = useState<string>(ALL);
  const [format, setFormat] = useState<string>(ALL);

  // The URL is the only source of truth for "which template is open". Reading
  // it every render — instead of seeding `useState` once — is what makes a
  // second contextual arrival at the same `?template=` URL re-open the dialog,
  // and is what lets the filter state above survive a contextual arrival: the
  // page no longer has to remount this component to change which dialog opens.
  const requestedTemplateId = searchParams.get(TEMPLATE_SEARCH_PARAM);

  // Dismissing the dialog means navigating the deep link away, and that
  // navigation is a server round trip on this force-dynamic route. Optimistic
  // state closes the dialog on the click instead of on the round trip, and
  // unwinds by itself when the navigation commits — no second copy of "open"
  // to fall out of step with the URL.
  const [openTemplateId, dismissDeepLink] = useOptimistic<string | null, null>(
    requestedTemplateId,
    () => null
  );

  // An unknown id opens nothing rather than erroring — a contextual link to a
  // retired template must degrade to the plain library, never a dead end.
  const deepLinked = openTemplateId
    ? (items.find(({ template }) => template.id === openTemplateId) ?? null)
    : null;

  function closeDeepLink() {
    startTransition(() => {
      dismissDeepLink(null);
      router.replace(urlWithoutTemplateParam(pathname, searchParams), {
        scroll: false,
      });
    });
  }

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
          // Keyed by template so arriving at a second deep link starts from
          // that template's own auto-filled values, not the previous one's.
          key={deepLinked.template.id}
          template={deepLinked.template}
          defaults={deepLinked.defaults}
          open
          onOpenChange={(next) => {
            if (!next) closeDeepLink();
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
