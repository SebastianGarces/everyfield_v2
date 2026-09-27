"use client";

import Link from "next/link";
import { wikiHref } from "@/lib/wiki/href";
import { wikiSnippetParts } from "@/lib/wiki/search-params";
import type { SearchResult } from "@/lib/wiki/search";

export function WikiSearchResults({
  results,
}: {
  results: (SearchResult & { snippet: string })[];
}) {
  return (
    <ul
      className="divide-y"
      aria-label="Search results"
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        const links = Array.from(
          event.currentTarget.querySelectorAll<HTMLAnchorElement>("a")
        );
        const index = links.findIndex(
          (link) => link === document.activeElement
        );
        if (index < 0) return;
        event.preventDefault();
        links[
          Math.max(
            0,
            Math.min(
              links.length - 1,
              index + (event.key === "ArrowDown" ? 1 : -1)
            )
          )
        ]?.focus();
      }}
    >
      {results.map((result) => (
        <li key={result.id} className="py-5">
          <Link
            href={wikiHref(result.slug)}
            className="text-lg font-medium underline-offset-4 hover:underline focus-visible:underline"
          >
            {result.title}
          </Link>
          <p className="text-muted-foreground mt-1 text-xs">
            {result.phase === null ? "All phases" : `Phase ${result.phase}`} ·{" "}
            {result.contentType.replaceAll("_", " ")} ·{" "}
            {result.slug
              .split("/")
              .slice(0, -1)
              .join(" / ")
              .replaceAll("-", " ")}
          </p>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            {wikiSnippetParts(result.snippet).map((part, index) =>
              part.highlighted ? (
                <mark
                  key={index}
                  className="bg-primary/10 text-foreground rounded-sm"
                >
                  {part.text}
                </mark>
              ) : (
                part.text
              )
            )}
          </p>
        </li>
      ))}
    </ul>
  );
}
