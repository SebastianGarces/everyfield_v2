import { wikiContentTypes, type WikiContentType } from "@/db/schema/wiki";

export const WIKI_SEARCH_PAGE_SIZE = 20;
export type WikiSearchParams = {
  q: string;
  type?: WikiContentType;
  phase?: number;
  sort: "relevance" | "recent";
  page: number;
};

export function parseWikiSearchParams(
  input: Record<string, string | string[] | undefined>
): WikiSearchParams {
  const first = (key: string) =>
    Array.isArray(input[key]) ? input[key][0] : input[key];
  const type = wikiContentTypes.find((type) => type === first("type"));
  const phase = first("phase");
  const page = Number(first("page"));
  return {
    q: (first("q") ?? "").trim().slice(0, 200),
    type,
    phase: phase && /^[0-6]$/.test(phase) ? Number(phase) : undefined,
    sort: first("sort") === "recent" ? "recent" : "relevance",
    page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 1000) : 1,
  };
}

export function wikiSearchHref(params: WikiSearchParams): string {
  const query = new URLSearchParams({ q: params.q });
  if (params.type) query.set("type", params.type);
  if (params.phase !== undefined) query.set("phase", String(params.phase));
  if (params.sort !== "relevance") query.set("sort", params.sort);
  if (params.page > 1) query.set("page", String(params.page));
  return `/wiki/search?${query}`;
}

/** Headline markers become React text/mark nodes, never trusted HTML. */
export function wikiSnippetParts(
  snippet: string
): { text: string; highlighted: boolean }[] {
  return snippet
    .split(/(\uE000[^\uE001]*\uE001)/g)
    .filter(Boolean)
    .map((part) => ({
      text: part.startsWith("\uE000") ? part.slice(1, -1) : part,
      highlighted: part.startsWith("\uE000"),
    }));
}
